'use client';

import { useState } from 'react';
import type { Finding } from '@/lib/types';
import { docTitleFromPolicyId } from '@/lib/policy-docs';

const ELEMENT_LABEL: Record<Finding['element'], string> = {
  copy: 'Ad copy',
  image: 'Creative',
  landing_page: 'Landing page',
};

export function FindingCard({
  finding,
  hasOtherFindings = false,
  nested = false,
}: {
  finding: Finding;
  // Whether this finding's rewrite is one of several on the same ad — if so,
  // it fixes only the issue it's attached to, and the others need their own.
  hasOtherFindings?: boolean;
  // Set when the card sits inside a FindingGroupCard, which already shows the
  // severity, the element, and the offending span for every card it holds.
  nested?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const confidence = `${Math.round(finding.confidence * 100)}%`;

  async function copyRewrite() {
    if (!finding.suggested_rewrite) return;
    await navigator.clipboard.writeText(finding.suggested_rewrite);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <li data-sev={finding.severity} className="sev-surface rounded-lg border p-4">
      {!nested && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="sev-badge rounded px-2 py-0.5 font-mono text-[10px] font-semibold tracking-[0.12em] uppercase">
              {finding.severity}
            </span>
            <span className="rounded border border-line-strong px-2 py-0.5 text-xs text-muted">
              {ELEMENT_LABEL[finding.element]}
            </span>
            <span className="ml-auto flex items-baseline gap-1.5">
              <span className="label-micro">Conf</span>
              <span className="font-mono text-xs tabular-nums text-muted">{confidence}</span>
            </span>
          </div>

          {finding.offending_span && (
            <p className="mb-3 text-sm text-muted italic">&ldquo;{finding.offending_span}&rdquo;</p>
          )}
        </>
      )}

      {/* The clause citation is the product's differentiator, so it gets the
          most visual weight on the card: a recessed slab with the severity
          rule down its edge, the policy id stamped above it, and the source
          link right there rather than buried after the prose. */}
      <div className="sev-rule sunken mb-3 rounded-r border-l-[3px] p-3">
        <div className="mb-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="label-micro">{docTitleFromPolicyId(finding.policy_id)}</span>
          <span className="font-mono text-[10px] text-faint">{finding.policy_id}</span>
          {/* Nested cards have no header row of their own, so the per-clause
              confidence rides along with the clause it belongs to. */}
          {nested && (
            <span className="ml-auto flex items-baseline gap-1.5">
              <span className="label-micro">Conf</span>
              <span className="font-mono text-[10px] tabular-nums text-muted">{confidence}</span>
            </span>
          )}
        </div>
        <blockquote className="text-[15px] leading-snug text-ink">
          &ldquo;{finding.clause_quote}&rdquo;
        </blockquote>
        <a
          href={finding.source_url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-block rounded-sm text-xs text-signal hover:underline"
        >
          view source ↗
        </a>
      </div>

      <p className="mb-3 text-sm text-ink/85">{finding.explanation}</p>

      {finding.supporting_example && (
        <p className="mb-3 text-xs text-muted">
          Matched Meta&apos;s own example: &ldquo;{finding.supporting_example.quote}&rdquo;
        </p>
      )}

      {finding.suggested_rewrite && (
        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="label-micro">
              {finding.rewrite_kind === 'guidance' ? 'Guidance' : 'Rewrite for this issue only'}
            </span>
            {finding.rewrite_kind !== 'guidance' && (
              <button
                type="button"
                onClick={copyRewrite}
                className="rounded-sm font-mono text-[10px] tracking-[0.12em] text-signal uppercase hover:underline"
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            )}
          </div>
          {finding.rewrite_kind === 'guidance' ? (
            <p className="text-sm text-ink/85">{finding.suggested_rewrite}</p>
          ) : (
            <pre className="sunken overflow-x-auto rounded border border-line p-3 text-sm whitespace-pre-wrap text-ink">
              {finding.suggested_rewrite}
            </pre>
          )}
          {finding.rewrite_kind !== 'guidance' && hasOtherFindings && (
            <p className="mt-1.5 text-xs text-muted">
              Fixes only the claim above. Other findings on this ad need their own rewrite.
            </p>
          )}
        </div>
      )}
    </li>
  );
}
