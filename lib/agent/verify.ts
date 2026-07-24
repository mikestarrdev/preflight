import { getChunk, governingRule } from '@/lib/rag/corpus-index';
import type { Element, Finding, PolicyChunk } from '@/lib/types';
import type { AdjudicatedFinding } from './steps/adjudicate';

// Citation verification, in code, not the prompt. Converts "the model says it
// cited a policy" into "the citation is verified against the corpus". A
// finding either cites a real chunk with an exact quote or it is dropped.
//
// Two Phase 4 additions layered on top:
//   4a parent-rule resolution: a finding that matches an example chunk
//      (Meta's own ✅/❌ line) is redirected to cite the governing rule and
//      carries the example as supporting context. Set EVAL_DISABLE_PARENT_RULE=1
//      to reproduce the pre-fix behavior for a matched before/after.
//   4b explanation grounding: the offending_span the adjudicator quotes from
//      the ad is verified as a verbatim substring of the input, the same
//      discipline clause_quote already gets. Ungrounded spans are stripped and
//      counted, so explanation-grounding.ts can report the rate.

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
  // Explanation grounding, over the violation/risk findings that survived:
  spans_total: number;
  spans_grounded: number;
};

function isExample(chunk: PolicyChunk): boolean {
  return chunk.content_type === 'example_compliant' || chunk.content_type === 'example_violating';
}

const SEVERITY_RANK: Record<Finding['severity'], number> = { violation: 2, risk: 1, clear: 0 };

export function verifyCitations(
  adjudicated: AdjudicatedFinding[],
  chunks: PolicyChunk[],
  element: Element,
  inputContent: string,
): VerifyResult {
  const byId = new Map(chunks.map((c) => [c.id, c]));
  const dropped: DroppedCitation[] = [];
  const built: { finding: Finding; redirected: boolean }[] = [];
  const normalizedInput = normalizeForMatch(inputContent);

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

    // 4a: redirect a matched example to its governing rule.
    const rule = RESOLVE_PARENT_RULE && isExample(chunk) ? governingRule(chunk) : null;

    // 4b: keep the offending span only if it verifies against the input.
    const span = f.offending_span ? normalizeForMatch(f.offending_span) : '';
    const grounded = span.length > 0 && normalizedInput.includes(span);

    const finding: Finding = {
      element,
      severity: f.severity,
      policy_id: rule ? rule.id : chunk.id,
      clause_quote: rule ? rule.content : f.clause_quote,
      source_url: rule ? rule.source_url : chunk.source_url,
      explanation: f.explanation,
      confidence: f.confidence,
      ...(grounded ? { offending_span: f.offending_span } : {}),
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

  // Grounding is measured over what users act on: violation and risk findings.
  const flagged = findings.filter((f) => f.severity === 'violation' || f.severity === 'risk');
  const spansGrounded = flagged.filter((f) => f.offending_span !== undefined).length;

  return {
    findings,
    dropped,
    parent_rule_redirects: parentRuleRedirects,
    spans_total: flagged.length,
    spans_grounded: spansGrounded,
  };
}
