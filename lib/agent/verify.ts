import { getChunk, governingRule } from '@/lib/rag/corpus-index';
import type { Element, Finding, PolicyChunk } from '@/lib/types';
import { inDocumentScope } from './scope';
import type { AdjudicatedFinding } from './steps/adjudicate';

// Citation verification, in code, not the prompt. Converts "the model says it
// cited a policy" into "the citation is verified against the corpus". A
// finding either cites a real chunk with an exact quote or it is dropped.
//
// Three Phase 4 additions layered on top:
//   4a parent-rule resolution: a finding that matches an example chunk
//      (Meta's own ✅/❌ line) is redirected to cite the governing rule and
//      carries the example as supporting context. Set EVAL_DISABLE_PARENT_RULE=1
//      to reproduce the pre-fix behavior for a matched before/after.
//   4b explanation grounding: the offending_span the adjudicator quotes from
//      the ad is verified as a verbatim substring of the input, the same
//      discipline clause_quote already gets. Ungrounded spans are stripped and
//      counted, so explanation-grounding.ts can report the rate. A
//      "violation"/"risk" finding on copy or a landing page that never
//      grounds is downgraded to "clear" in code: the model has repeatedly
//      asserted risk in its explanation while describing a clause that
//      plainly does not apply, so the prompt alone cannot be trusted here —
//      a severity above "clear" must point at real text in the ad or it is
//      discarded as an unproven hedge. Images are exempt: a compositional
//      visual violation can be entirely correct with no text worth quoting,
//      so an ungrounded image finding is left at whatever severity the model
//      gave it. Set EVAL_DISABLE_SEVERITY_GROUNDING=1 to reproduce the
//      pre-fix behavior for a matched before/after.
//   scope guard: a finding citing a document whose corpus text states a limited
//      applicability scope (see scope.ts) is dropped when the ad falls outside
//      that scope, so a clause cannot be cited against an ad its own document
//      says it does not cover. Set EVAL_DISABLE_SCOPE_CHECK=1 to reproduce the
//      pre-fix behavior for a matched before/after.

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
const SCOPE_CHECK = process.env.EVAL_DISABLE_SCOPE_CHECK !== '1';
const SEVERITY_GROUNDING = process.env.EVAL_DISABLE_SEVERITY_GROUNDING !== '1';

export type DroppedCitation = {
  policy_id: string;
  reason: 'unknown_policy_id' | 'quote_not_in_chunk';
};

export type VerifyResult = {
  findings: Finding[];
  dropped: DroppedCitation[];
  parent_rule_redirects: number;
  // Findings dropped by the scope guard: cited a document that verified fine
  // but whose corpus text scopes it to categories the ad does not fall into.
  // Kept separate from `dropped` because the citation itself was valid.
  scope_drops: number;
  // Explanation grounding, over the violation/risk findings the model emitted
  // (before the ungrounded ones are downgraded to clear below):
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
  // Ad copy plus its classification (vertical + restricted categories), used by
  // the scope guard to decide whether a scoped document applies to this ad.
  scopeSignals = '',
): VerifyResult {
  const byId = new Map(chunks.map((c) => [c.id, c]));
  const dropped: DroppedCitation[] = [];
  const built: { finding: Finding; redirected: boolean }[] = [];
  const normalizedInput = normalizeForMatch(inputContent);
  const scopeHaystack = `${inputContent} ${scopeSignals}`;
  let scopeDrops = 0;
  let spansTotal = 0;
  let spansGrounded = 0;

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

    // Scope guard: drop a valid citation to a document the ad falls outside of.
    // Runs before the finding is built so it is excluded from every downstream
    // metric (grounding included), the same as any other dropped finding.
    if (SCOPE_CHECK && !inDocumentScope(chunk.doc_slug, scopeHaystack)) {
      scopeDrops += 1;
      console.warn(
        `scope guard dropped ${f.policy_id}: ad falls outside ${chunk.doc_slug}'s stated scope`,
      );
      continue;
    }

    // 4a: redirect a matched example to its governing rule.
    const rule = RESOLVE_PARENT_RULE && isExample(chunk) ? governingRule(chunk) : null;

    // 4b: keep the offending span only if it verifies against the input.
    const span = f.offending_span ? normalizeForMatch(f.offending_span) : '';
    const grounded = span.length > 0 && normalizedInput.includes(span);

    // A "violation" or "risk" the model can't ground in the ad's own text is
    // an unproven hedge, not a finding: downgrade to "clear" regardless of
    // what the explanation argues. This is the mechanical backstop for the
    // "risk with an explanation that says it doesn't apply" failure mode -
    // the prompt asking the model to police its own reasoning was not
    // sufficient on its own. The grounding rate itself (spansTotal/spansGrounded,
    // the explanation-grounding eval metric) is measured the same way for every
    // element, unaffected by the line below.
    const requiresSpan = f.severity === 'violation' || f.severity === 'risk';
    if (requiresSpan) {
      spansTotal += 1;
      if (grounded) spansGrounded += 1;
    }

    // Text-only: a compositional image violation (a depicted object, a
    // before/after shot) can be entirely correct with nothing in the vision
    // description worth quoting as "the offending words" — unlike copy or a
    // landing page, where the ad's own text is the violation, so an
    // ungrounded claim there really is unproven. Downgrading images the same
    // way would discard real violations for a structural property of the
    // element, not evidence the finding is wrong (img-hookah-lounge's
    // tobacco:2.1, a correctly explained paraphernalia violation with no
    // rendered-text span, was lost this way before this exemption).
    const downgrade = SEVERITY_GROUNDING && requiresSpan && !grounded && element !== 'image';
    const severity: Finding['severity'] = downgrade ? 'clear' : f.severity;
    if (downgrade) {
      console.warn(
        `ungrounded ${f.severity} downgraded to clear for ${f.policy_id}: no verbatim offending_span`,
      );
    }

    const finding: Finding = {
      element,
      severity,
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

  return {
    findings,
    dropped,
    parent_rule_redirects: parentRuleRedirects,
    scope_drops: scopeDrops,
    spans_total: spansTotal,
    spans_grounded: spansGrounded,
  };
}
