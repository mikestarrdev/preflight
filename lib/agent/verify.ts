import type { Element, Finding, PolicyChunk } from '@/lib/types';
import type { AdjudicatedFinding } from './steps/adjudicate';

// Citation verification, in code, not the prompt. Converts "the model says it
// cited a policy" into "the citation is verified against the corpus". A
// finding either cites a real chunk with an exact quote or it is dropped.

// Normalizes whitespace and Unicode quote characters ONLY. Anything more
// forgiving would let paraphrases through.
export function normalizeForMatch(s: string): string {
  return s
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

export type DroppedCitation = {
  policy_id: string;
  reason: 'unknown_policy_id' | 'quote_not_in_chunk';
};

export type VerifyResult = {
  findings: Finding[];
  dropped: DroppedCitation[];
};

export function verifyCitations(
  adjudicated: AdjudicatedFinding[],
  chunks: PolicyChunk[],
  element: Element,
): VerifyResult {
  const byId = new Map(chunks.map((c) => [c.id, c]));
  const findings: Finding[] = [];
  const dropped: DroppedCitation[] = [];

  for (const f of adjudicated) {
    const chunk = byId.get(f.policy_id);
    if (!chunk) {
      dropped.push({ policy_id: f.policy_id, reason: 'unknown_policy_id' });
      continue;
    }
    const quote = normalizeForMatch(f.clause_quote);
    if (quote.length === 0 || !normalizeForMatch(chunk.content).includes(quote)) {
      dropped.push({ policy_id: f.policy_id, reason: 'quote_not_in_chunk' });
      continue;
    }
    findings.push({
      element,
      severity: f.severity,
      policy_id: f.policy_id,
      clause_quote: f.clause_quote,
      source_url: chunk.source_url,
      explanation: f.explanation,
      confidence: f.confidence,
    });
  }

  return { findings, dropped };
}
