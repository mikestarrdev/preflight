import type { CaseRun } from '../types';

// Of cases with should_flag: false, the share that produced any finding at
// violation severity. Deterministic.

export type FalsePositiveScore = {
  false_positives: number;
  total: number;
  rate: number | null; // null when no applicable cases ran
};

export function scoreFalsePositives(runs: CaseRun[]): FalsePositiveScore {
  const applicable = runs.filter((r) => !r.eval_case.expected.should_flag && r.result !== null);
  let falsePositives = 0;
  for (const r of applicable) {
    if (r.result!.findings.some((f) => f.severity === 'violation')) falsePositives += 1;
  }
  return {
    false_positives: falsePositives,
    total: applicable.length,
    rate: applicable.length > 0 ? falsePositives / applicable.length : null,
  };
}
