import { randomUUID } from 'node:crypto';
import { MODEL_REASONING } from '@/lib/claude';
import { corpusVersion } from '@/lib/corpus';
import type { AnalysisResult } from '@/lib/types';
import { verifyCitations } from './verify';
import { adjudicate } from './steps/adjudicate';
import { classify } from './steps/classify';
import { retrieve } from './steps/retrieve';
import { rewrite } from './steps/rewrite';

// Runs classify → retrieve → adjudicate → verify → rewrite. Owns sequencing,
// timing, and partial-failure handling: classify/retrieve/adjudicate failing
// is fatal, rewrite failing degrades (findings survive without rewrites).

export type RunDiagnostics = {
  step_timings_ms: Record<string, number>;
  findings_emitted: number; // adjudicator output count, pre-verification
  citation_drops: number; // findings dropped by citation verification
  degraded: string[]; // non-fatal failures, e.g. "rewrite:meta:health-wellness:2.1"
};

// Extends the core type with diagnostics: the phase spec requires the citation
// drop count to be exposed, and the eval scorers grade on it.
export type AnalyzeOutput = AnalysisResult & { diagnostics: RunDiagnostics };

function debug(step: string, data: Record<string, unknown>): void {
  if (process.env.DEBUG_AGENT) console.error(JSON.stringify({ step, ...data }));
}

export async function analyze(copy: string): Promise<AnalyzeOutput> {
  const started = Date.now();
  const timings: Record<string, number> = {};
  const step = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    const t = Date.now();
    try {
      return await fn();
    } finally {
      timings[name] = Date.now() - t;
    }
  };

  const classification = await step('classify', () => classify(copy));
  debug('classify', {
    vertical: classification.vertical,
    categories: classification.restricted_categories,
    claims: classification.claims.length,
  });

  const chunks = await step('retrieve', () => retrieve(copy, classification.claims));
  debug('retrieve', { chunks: chunks.length });

  const adjudicated = await step('adjudicate', () =>
    adjudicate(copy, classification.claims, chunks),
  );
  debug('adjudicate', { findings: adjudicated.length });

  const { findings, dropped } = verifyCitations(adjudicated, chunks, 'copy');
  for (const d of dropped) {
    console.warn(`citation verification dropped ${d.policy_id}: ${d.reason}`);
  }
  debug('verify', { kept: findings.length, dropped: dropped.length });

  // Rewrites for violations only. A rewrite failure must not lose the finding.
  const degraded: string[] = [];
  await step('rewrite', async () => {
    const violations = findings.filter((f) => f.severity === 'violation');
    await Promise.all(
      violations.map(async (f) => {
        try {
          f.suggested_rewrite = await rewrite(copy, f);
        } catch (err) {
          degraded.push(`rewrite:${f.policy_id}`);
          console.warn(
            `rewrite failed for ${f.policy_id}, returning finding without rewrite:`,
            err instanceof Error ? err.message : err,
          );
        }
      }),
    );
  });
  debug('rewrite', {
    rewritten: findings.filter((f) => f.suggested_rewrite).length,
    degraded: degraded.length,
  });

  return {
    id: randomUUID(),
    findings,
    elements_analyzed: ['copy'],
    model_version: MODEL_REASONING,
    corpus_version: corpusVersion(),
    duration_ms: Date.now() - started,
    diagnostics: {
      step_timings_ms: timings,
      findings_emitted: adjudicated.length,
      citation_drops: dropped.length,
      degraded,
    },
  };
}
