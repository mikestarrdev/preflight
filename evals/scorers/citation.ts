import type { CaseRun } from '../types';

// Share of emitted findings whose clause_quote verified as an exact substring
// of the cited chunk. The orchestrator already drops unverified findings and
// reports the counts in diagnostics; this scorer just aggregates them.
// Deterministic, no LLM judge.

export type CitationScore = {
  verified: number;
  emitted: number;
  score: number | null; // null when no findings were emitted
};

export function scoreCitations(runs: CaseRun[]): CitationScore {
  let emitted = 0;
  let drops = 0;
  for (const r of runs) {
    if (r.result === null) continue;
    emitted += r.result.diagnostics.findings_emitted;
    drops += r.result.diagnostics.citation_drops;
  }
  return {
    verified: emitted - drops,
    emitted,
    score: emitted > 0 ? (emitted - drops) / emitted : null,
  };
}
