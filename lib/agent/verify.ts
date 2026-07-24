import { getChunk, governingRule } from '@/lib/rag/corpus-index';
import type { Element, Finding, PolicyChunk } from '@/lib/types';
import type { AdjudicatedFinding } from './steps/adjudicate';

// Citation verification, in code, not the prompt. Converts "the model says it
// cited a policy" into "the citation is verified against the corpus". A
// finding either cites a real chunk with an exact quote or it is dropped.
//
// Phase 4 addition layered on top: parent-rule resolution. A finding that
// matches an example chunk (Meta's own ✅/❌ line) is redirected to cite the
// governing rule and carries the example as supporting context. Set
// EVAL_DISABLE_PARENT_RULE=1 to reproduce the pre-fix behavior for a matched
// baseline run.

// Normalizes whitespace and Unicode quote characters ONLY. Anything more
// forgiving would let paraphrases through.
export function normalizeForMatch(s: string): string {
  return s
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

const RESOLVE_PARENT_RULE = process.env.EVAL_DISABLE_PARENT_RULE !== '1';

export type DroppedCitation = {
  policy_id: string;
  reason: 'unknown_policy_id' | 'quote_not_in_chunk';
};

export type VerifyResult = {
  findings: Finding[];
  dropped: DroppedCitation[];
  parent_rule_redirects: number;
};

function isExample(chunk: PolicyChunk): boolean {
  return chunk.content_type === 'example_compliant' || chunk.content_type === 'example_violating';
}

const SEVERITY_RANK: Record<Finding['severity'], number> = { violation: 2, risk: 1, clear: 0 };

export function verifyCitations(
  adjudicated: AdjudicatedFinding[],
  chunks: PolicyChunk[],
  element: Element,
): VerifyResult {
  const byId = new Map(chunks.map((c) => [c.id, c]));
  const dropped: DroppedCitation[] = [];
  const built: { finding: Finding; redirected: boolean }[] = [];

  for (const f of adjudicated) {
    // Prefer the retrieved chunk (identical content); fall back to the corpus
    // index so a cited id that dropped out of the merged set still verifies.
    const chunk = byId.get(f.policy_id) ?? getChunk(f.policy_id);
    if (!chunk) {
      dropped.push({ policy_id: f.policy_id, reason: 'unknown_policy_id' });
      continue;
    }
    const quote = normalizeForMatch(f.clause_quote);
    if (quote.length === 0 || !normalizeForMatch(chunk.content).includes(quote)) {
      dropped.push({ policy_id: f.policy_id, reason: 'quote_not_in_chunk' });
      continue;
    }

    // Redirect a matched example to its governing rule.
    const rule = RESOLVE_PARENT_RULE && isExample(chunk) ? governingRule(chunk) : null;

    const finding: Finding = {
      element,
      severity: f.severity,
      policy_id: rule ? rule.id : chunk.id,
      clause_quote: rule ? rule.content : f.clause_quote,
      source_url: rule ? rule.source_url : chunk.source_url,
      explanation: f.explanation,
      confidence: f.confidence,
      ...(rule
        ? {
            supporting_example: {
              policy_id: chunk.id,
              content_type: chunk.content_type as 'example_compliant' | 'example_violating',
              quote: f.clause_quote,
              source_url: chunk.source_url,
            },
          }
        : {}),
    };
    built.push({ finding, redirected: rule !== null });
  }

  // Redirecting can collapse several matched examples onto one rule. Keep the
  // most severe finding per policy_id (then highest confidence) so a rule is
  // cited once; scoring is unaffected either way.
  const best = new Map<string, { finding: Finding; redirected: boolean }>();
  for (const item of built) {
    const prev = best.get(item.finding.policy_id);
    if (
      !prev ||
      SEVERITY_RANK[item.finding.severity] > SEVERITY_RANK[prev.finding.severity] ||
      (SEVERITY_RANK[item.finding.severity] === SEVERITY_RANK[prev.finding.severity] &&
        item.finding.confidence > prev.finding.confidence)
    ) {
      best.set(item.finding.policy_id, item);
    }
  }

  const findings = [...best.values()].map((b) => b.finding);
  const parentRuleRedirects = [...best.values()].filter((b) => b.redirected).length;

  return {
    findings,
    dropped,
    parent_rule_redirects: parentRuleRedirects,
  };
}
