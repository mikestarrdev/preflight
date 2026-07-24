import { config } from 'dotenv';
config({ path: '.env.local' });

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import type { CaseRun, EvalCase, LoadedCase, Split } from './types';

const DATASET_DIR = 'evals/dataset';
const RESULTS_DIR = 'evals/results';
const CONCURRENCY = 4;
// Extrapolate a full-run cost once this many cases have completed, so a run
// that is going to be expensive announces itself early instead of at the end.
const PROJECT_AFTER = 5;

// Per-run safety valve. A run that blows past this aborts rather than draining
// the budget on a bad prompt. Default $3; override with EVAL_MAX_COST_USD.
const MAX_COST_USD = Number(process.env.EVAL_MAX_COST_USD ?? 3);

function loadCases(split: Split, filterTag: string | null): LoadedCase[] {
  const files = readdirSync(DATASET_DIR).filter(
    // parked-* files hold cases the pipeline can't run yet
    (f) => f.endsWith('.jsonl') && !f.startsWith('parked'),
  );
  if (files.length === 0) {
    console.error(`no dataset files in ${DATASET_DIR}/ — run pnpm eval:seed first`);
    process.exit(1);
  }
  const loaded: LoadedCase[] = [];
  for (const f of files) {
    const tier = basename(f, '.jsonl');
    const lines = readFileSync(join(DATASET_DIR, f), 'utf8')
      .split('\n')
      .filter((line) => line.trim().length > 0);
    for (const line of lines) {
      const evalCase = JSON.parse(line) as EvalCase;
      if (evalCase.split === undefined) {
        console.error(`${f}: case ${evalCase.id} has no split — run pnpm eval:split first`);
        process.exit(1);
      }
      // The runner never loads holdout unless --holdout is passed, so the
      // held-out set cannot leak into an iteration run by accident.
      if (evalCase.split !== split) continue;
      if (filterTag && !evalCase.tags.includes(filterTag)) continue;
      loaded.push({ evalCase, tier });
    }
  }
  return loaded;
}

// Fixed-size worker pool; results land at their case's index. A worker stops
// pulling new items once stop() returns true (the cost ceiling tripped), so an
// abort drains in-flight work without starting more.
async function runPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
  stop: () => boolean,
): Promise<(R | undefined)[]> {
  const out: (R | undefined)[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      if (stop()) return;
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

function fmt(score: number | null, digits = 2): string {
  return score === null ? 'n/a' : score.toFixed(digits);
}

async function main() {
  const holdout = process.argv.includes('--holdout');
  const split: Split = holdout ? 'holdout' : 'dev';
  const filterArg = process.argv.find((a) => a.startsWith('--filter='));
  const filterTag = filterArg ? filterArg.slice('--filter='.length) : null;

  const loaded = loadCases(split, filterTag);
  console.log(
    `${loaded.length} cases [split: ${split}]${filterTag ? ` (tag: ${filterTag})` : ''}, ` +
      `concurrency ${CONCURRENCY}, per-run ceiling $${MAX_COST_USD.toFixed(2)}\n`,
  );
  if (loaded.length === 0) process.exit(1);

  // imports after dotenv so env vars are set before clients initialize
  const { analyze } = await import('../lib/agent/orchestrator');
  const { MEDIA_TYPE_BY_EXT } = await import('../lib/inputs/vision');
  const { getUsage, usageCostUSD, MODEL_REASONING } = await import('../lib/claude');
  const { corpusVersion } = await import('../lib/corpus');
  const { scoreRecall } = await import('./scorers/recall');
  const { scoreFalsePositives } = await import('./scorers/false-positive');
  const { scoreCitations } = await import('./scorers/citation');
  const { scoreExplanationGrounding } = await import('./scorers/explanation-grounding');
  const { scoreRewrites } = await import('./scorers/rewrite');

  const toInput = (evalCase: EvalCase) => {
    const { copy, image_path, url } = evalCase.input;
    let image;
    if (image_path) {
      const mediaType = MEDIA_TYPE_BY_EXT[extname(image_path).toLowerCase()];
      if (!mediaType) throw new Error(`${evalCase.id}: unsupported fixture type ${image_path}`);
      image = { data: readFileSync(image_path).toString('base64'), mediaType };
    }
    return { copy, image, url };
  };

  const started = Date.now();
  let done = 0;
  let aborted = false;

  // A failure in one case must not kill the run: record the error, continue.
  const maybeRuns: (CaseRun | undefined)[] = await runPool(
    loaded,
    CONCURRENCY,
    async ({ evalCase, tier }) => {
      const t = Date.now();
      let run: CaseRun;
      try {
        const result = await analyze(toInput(evalCase));
        run = { eval_case: evalCase, tier, result, duration_ms: Date.now() - t };
      } catch (err) {
        run = {
          eval_case: evalCase,
          tier,
          result: null,
          error: err instanceof Error ? err.message : String(err),
          duration_ms: Date.now() - t,
        };
      }
      done += 1;
      const status = run.result
        ? `${run.result.findings.length} findings`
        : `ERROR: ${run.error?.split('\n')[0]}`;
      console.log(`[${done}/${loaded.length}] ${evalCase.id} (${run.duration_ms}ms) ${status}`);

      // Project a full-run cost from the first few completed cases. Cache hits
      // cost nothing, so a warm run reads near $0 here, which is the point.
      if (done === PROJECT_AFTER) {
        const spent = usageCostUSD();
        const projected = (spent / done) * loaded.length;
        console.log(
          `  ~ projected full-run cost from first ${done}: $${projected.toFixed(2)} ` +
            `($${spent.toFixed(2)} so far${spent < 0.01 ? ', mostly cache hits' : ''})`,
        );
      }

      // Trip the per-run ceiling. In-flight cases finish; no new ones start.
      if (!aborted && usageCostUSD() > MAX_COST_USD) {
        aborted = true;
        console.error(
          `\n!! ABORTING: cost $${usageCostUSD().toFixed(2)} exceeded ` +
            `EVAL_MAX_COST_USD=$${MAX_COST_USD.toFixed(2)} after ${done}/${loaded.length} cases`,
        );
      }
      return run;
    },
    () => aborted,
  );

  const runs: CaseRun[] = maybeRuns.filter((r): r is CaseRun => r !== undefined);
  const skipped = loaded.length - runs.length;

  // One tier per dataset file; scored separately, never merged.
  const tierNames = [...new Set(runs.map((r) => r.tier))].sort();
  const tiers = tierNames.map((name) => ({ name, runs: runs.filter((r) => r.tier === name) }));

  console.log('\njudging rewrites...');
  const tierScores = [];
  for (const tier of tiers) {
    tierScores.push({
      name: tier.name,
      cases: tier.runs.length,
      recall: scoreRecall(tier.runs),
      false_positive: scoreFalsePositives(tier.runs),
      citation: scoreCitations(tier.runs),
      explanation_grounding: scoreExplanationGrounding(tier.runs),
      rewrite: await scoreRewrites(tier.runs),
    });
  }

  const errors = runs.filter((r) => r.result === null);
  const usage = getUsage();
  const durationMs = Date.now() - started;

  const record = {
    timestamp: new Date().toISOString(),
    model_version: MODEL_REASONING,
    corpus_version: corpusVersion(),
    split,
    filter: filterTag,
    aborted,
    parent_rule_resolution: process.env.EVAL_DISABLE_PARENT_RULE !== '1',
    scores: Object.fromEntries(tierScores.map((t) => [t.name, t])),
    totals: {
      cases: runs.length,
      skipped,
      errors: errors.length,
      duration_ms: durationMs,
      cost_usd: Number(usageCostUSD().toFixed(4)),
      usage,
    },
    cases: runs.map((r) => ({
      id: r.eval_case.id,
      tier: r.tier,
      tags: r.eval_case.tags,
      expected: r.eval_case.expected,
      error: r.error ?? null,
      duration_ms: r.duration_ms,
      findings: r.result?.findings ?? null,
      diagnostics: r.result?.diagnostics ?? null,
    })),
  };

  mkdirSync(RESULTS_DIR, { recursive: true });
  const outPath = join(RESULTS_DIR, `${record.timestamp.replace(/[:.]/g, '-')}.json`);
  writeFileSync(outPath, JSON.stringify(record, null, 2) + '\n');

  console.log(`\n=== results [split: ${split}] (model ${MODEL_REASONING}, corpus ${corpusVersion()}) ===`);
  for (const t of tierScores) {
    console.log(`\n--- ${t.name} tier (${t.cases} cases) ---`);
    console.log(`recall               ${fmt(t.recall.score)}   (${t.recall.hits}/${t.recall.total} flagged cases cite an expected clause)`);
    console.log(`false positive rate  ${fmt(t.false_positive.rate)}   (${t.false_positive.false_positives}/${t.false_positive.total} clean cases produced a violation)`);
    console.log(`citation accuracy    ${fmt(t.citation.score)}   (${t.citation.verified}/${t.citation.emitted} emitted findings verified verbatim)`);
    console.log(`explanation grounding ${fmt(t.explanation_grounding.score)}  (${t.explanation_grounding.grounded}/${t.explanation_grounding.total} flagged findings quote a verbatim ad span)`);
    console.log(`rewrite quality      ${t.rewrite.mean_score === null ? 'n/a' : `${t.rewrite.mean_score.toFixed(2)}/5`}  (judge: ${t.rewrite.judge_model}, n=${t.rewrite.judged})`);
  }
  console.log(`\nerrors               ${errors.length}/${runs.length} cases`);
  if (skipped > 0) console.log(`skipped              ${skipped} cases (run aborted on cost ceiling)`);
  console.log(`cost                 $${usageCostUSD().toFixed(2)}  (${usage.calls} calls, in ${usage.input_tokens} tok, out ${usage.output_tokens} tok — cache hits cost nothing)`);
  console.log(`duration             ${(durationMs / 1000).toFixed(0)}s`);
  console.log(`\nwrote ${outPath}`);

  if (errors.length > 0) {
    console.log('\nerrored cases:');
    for (const r of errors) console.log(`  ${r.eval_case.id}: ${r.error?.split('\n')[0]}`);
  }

  if (aborted) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
