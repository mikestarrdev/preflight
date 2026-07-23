import type { CaseRun } from '../types';

// Of cases with should_flag: true, the share where a finding cites an
// expected policy_id at violation or risk severity. Deterministic.

export type RecallScore = {
  hits: number;
  total: number;
  score: number | null; // null when no applicable cases ran
};

export function scoreRecall(runs: CaseRun[]): RecallScore {
  const applicable = runs.filter((r) => r.eval_case.expected.should_flag && r.result !== null);
  let hits = 0;
  for (const r of applicable) {
    const expected = new Set(r.eval_case.expected.policy_ids);
    const hit = r.result!.findings.some(
      (f) => (f.severity === 'violation' || f.severity === 'risk') && expected.has(f.policy_id),
    );
    if (hit) hits += 1;
  }
  return {
    hits,
    total: applicable.length,
    score: applicable.length > 0 ? hits / applicable.length : null,
  };
}
