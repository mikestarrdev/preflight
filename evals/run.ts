import { config } from 'dotenv';
config({ path: '.env.local' });

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CaseRun, EvalCase } from './types';

const DATASET_DIR = 'evals/dataset';
const RESULTS_DIR = 'evals/results';
const CONCURRENCY = 4;

function loadCases(filterTag: string | null): EvalCase[] {
  const files = readdirSync(DATASET_DIR).filter(
    // parked-* files hold cases the current pipeline can't run (image examples)
    (f) => f.endsWith('.jsonl') && !f.startsWith('parked'),
  );
  if (files.length === 0) {
    console.error(`no dataset files in ${DATASET_DIR}/ — run pnpm eval:seed first`);
    process.exit(1);
  }
  const cases = files.flatMap((f) =>
    readFileSync(join(DATASET_DIR, f), 'utf8')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as EvalCase),
  );
  return filterTag ? cases.filter((c) => c.tags.includes(filterTag)) : cases;
}

// Fixed-size worker pool; results land at their case's index.
async function runPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
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
  const filterArg = process.argv.find((a) => a.startsWith('--filter='));
  const filterTag = filterArg ? filterArg.slice('--filter='.length) : null;

  const cases = loadCases(filterTag);
  console.log(`${cases.length} cases${filterTag ? ` (tag: ${filterTag})` : ''}, concurrency ${CONCURRENCY}\n`);
  if (cases.length === 0) process.exit(1);

  // import after dotenv so env vars are set before clients initialize
  const { analyze } = await import('../lib/agent/orchestrator');
  const { getUsage, usageCostUSD, MODEL_REASONING } = await import('../lib/claude');
  const { corpusVersion } = await import('../lib/corpus');
  const { scoreRecall } = await import('./scorers/recall');
  const { scoreFalsePositives } = await import('./scorers/false-positive');
  const { scoreCitations } = await import('./scorers/citation');
  const { scoreRewrites } = await import('./scorers/rewrite');

  const started = Date.now();
  let done = 0;

  // A failure in one case must not kill the run: record the error, continue.
  const runs: CaseRun[] = await runPool(cases, CONCURRENCY, async (evalCase) => {
    const t = Date.now();
    let run: CaseRun;
    try {
      const result = await analyze(evalCase.input.copy);
      run = { eval_case: evalCase, result, duration_ms: Date.now() - t };
    } catch (err) {
      run = {
        eval_case: evalCase,
        result: null,
        error: err instanceof Error ? err.message : String(err),
        duration_ms: Date.now() - t,
      };
    }
    done += 1;
    const status = run.result
      ? `${run.result.findings.length} findings`
      : `ERROR: ${run.error?.split('\n')[0]}`;
    console.log(`[${done}/${cases.length}] ${evalCase.id} (${run.duration_ms}ms) ${status}`);
    return run;
  });

  const recall = scoreRecall(runs);
  const falsePositive = scoreFalsePositives(runs);
  const citation = scoreCitations(runs);
  console.log('\njudging rewrites...');
  const rewriteScore = await scoreRewrites(runs);

  const errors = runs.filter((r) => r.result === null);
  const usage = getUsage();
  const durationMs = Date.now() - started;

  const record = {
    timestamp: new Date().toISOString(),
    model_version: MODEL_REASONING,
    corpus_version: corpusVersion(),
    filter: filterTag,
    scores: {
      recall,
      false_positive: falsePositive,
      citation,
      rewrite: rewriteScore,
    },
    totals: {
      cases: runs.length,
      errors: errors.length,
      duration_ms: durationMs,
      cost_usd: Number(usageCostUSD().toFixed(4)),
      usage,
    },
    cases: runs.map((r) => ({
      id: r.eval_case.id,
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

  console.log(`\n=== results (model ${MODEL_REASONING}, corpus ${corpusVersion()}) ===\n`);
  console.log(`recall               ${fmt(recall.score)}   (${recall.hits}/${recall.total} flagged cases cite an expected clause)`);
  console.log(`false positive rate  ${fmt(falsePositive.rate)}   (${falsePositive.false_positives}/${falsePositive.total} clean cases produced a violation)`);
  console.log(`citation accuracy    ${fmt(citation.score)}   (${citation.verified}/${citation.emitted} emitted findings verified verbatim)`);
  console.log(`rewrite quality      ${rewriteScore.mean_score === null ? 'n/a' : `${rewriteScore.mean_score.toFixed(2)}/5`}  (judge: ${rewriteScore.judge_model}, n=${rewriteScore.judged})`);
  console.log(`errors               ${errors.length}/${runs.length} cases`);
  console.log(`cost                 $${usageCostUSD().toFixed(2)}  (${usage.calls} calls, in ${usage.input_tokens} tok, out ${usage.output_tokens} tok — cache hits cost nothing)`);
  console.log(`duration             ${(durationMs / 1000).toFixed(0)}s`);
  console.log(`\nwrote ${outPath}`);

  if (errors.length > 0) {
    console.log('\nerrored cases:');
    for (const r of errors) console.log(`  ${r.eval_case.id}: ${r.error?.split('\n')[0]}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
