import type { CaseRun } from '../types';

// Of the violation/risk findings a run produced, the share whose explanation
// quotes an offending span that verifies as a verbatim substring of the input.
// The adjudicator can misstate literal values ("$100" for a "$500" ad); this
// is the discipline clause_quote already gets, applied to the explanation. The
// orchestrator strips ungrounded spans and reports the counts in diagnostics;
// this scorer aggregates them. Deterministic, no LLM judge.

export type GroundingScore = {
  grounded: number;
  total: number;
  score: number | null; // null when no flagged findings were produced
};

export function scoreExplanationGrounding(runs: CaseRun[]): GroundingScore {
  let grounded = 0;
  let total = 0;
  for (const r of runs) {
    if (r.result === null) continue;
    total += r.result.diagnostics.explanation_spans_total;
    grounded += r.result.diagnostics.explanation_spans_grounded;
  }
  return {
    grounded,
    total,
    score: total > 0 ? grounded / total : null,
  };
}
