'use client';

import { useState } from 'react';
import type { Finding } from '@/lib/types';
import { docTitleFromPolicyId } from '@/lib/policy-docs';

const SEVERITY_CARD: Record<Finding['severity'], string> = {
  violation: 'border-red-200 bg-red-50 dark:border-red-900/60 dark:bg-red-950/20',
  risk: 'border-amber-200 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/20',
  clear: 'border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900/40',
};

const SEVERITY_BADGE: Record<Finding['severity'], string> = {
  violation: 'bg-red-600 text-white',
  risk: 'bg-amber-500 text-black',
  clear: 'bg-neutral-400 text-white dark:bg-neutral-600',
};

const SEVERITY_ACCENT: Record<Finding['severity'], string> = {
  violation: 'border-l-red-500',
  risk: 'border-l-amber-500',
  clear: 'border-l-neutral-400 dark:border-l-neutral-600',
};

const ELEMENT_LABEL: Record<Finding['element'], string> = {
  copy: 'Ad copy',
  image: 'Creative',
  landing_page: 'Landing page',
};

export function FindingCard({
  finding,
  hasOtherFindings = false,
}: {
  finding: Finding;
  // Whether this finding's rewrite is one of several on the same ad — if so,
  // it fixes only the issue it's attached to, and the others need their own.
  hasOtherFindings?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  async function copyRewrite() {
    if (!finding.suggested_rewrite) return;
    await navigator.clipboard.writeText(finding.suggested_rewrite);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <li className={`rounded-lg border p-4 ${SEVERITY_CARD[finding.severity]}`}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span
          className={`rounded px-2 py-0.5 text-xs font-semibold tracking-wide uppercase ${SEVERITY_BADGE[finding.severity]}`}
        >
          {finding.severity}
        </span>
        <span className="rounded border border-neutral-300 px-2 py-0.5 text-xs text-neutral-600 dark:border-neutral-700 dark:text-neutral-400">
          {ELEMENT_LABEL[finding.element]}
        </span>
        <span className="ml-auto text-xs text-neutral-500 dark:text-neutral-500">
          confidence {Math.round(finding.confidence * 100)}%
        </span>
      </div>

      {finding.offending_span && (
        <p className="mb-3 text-sm text-neutral-600 italic dark:text-neutral-400">
          &ldquo;{finding.offending_span}&rdquo;
        </p>
      )}

      {/* The clause citation is the product's differentiator, so it gets the
          most visual weight on the card: bigger text, a colored accent bar,
          the source link right there rather than buried after the prose. */}
      <div
        className={`mb-3 border-l-4 bg-white p-3 dark:bg-neutral-950 ${SEVERITY_ACCENT[finding.severity]}`}
      >
        <div className="mb-1 text-xs font-medium text-neutral-500 dark:text-neutral-400">
          {docTitleFromPolicyId(finding.policy_id)} <span className="text-neutral-400 dark:text-neutral-600">· {finding.policy_id}</span>
        </div>
        <blockquote className="text-[15px] leading-snug text-neutral-900 dark:text-neutral-100">
          &ldquo;{finding.clause_quote}&rdquo;
        </blockquote>
        <a
          href={finding.source_url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-block text-xs text-blue-700 hover:underline dark:text-blue-400"
        >
          view source ↗
        </a>
      </div>

      <p className="mb-3 text-sm text-neutral-700 dark:text-neutral-300">{finding.explanation}</p>

      {finding.supporting_example && (
        <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-500">
          Matched Meta&apos;s own example: &ldquo;{finding.supporting_example.quote}&rdquo;
        </p>
      )}

      {finding.suggested_rewrite && (
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
              {finding.rewrite_kind === 'guidance' ? 'Guidance' : 'Rewrite for this issue only'}
            </span>
            {finding.rewrite_kind !== 'guidance' && (
              <button
                onClick={copyRewrite}
                className="text-xs text-blue-700 hover:underline dark:text-blue-400"
              >
                {copied ? 'copied' : 'copy'}
              </button>
            )}
          </div>
          {finding.rewrite_kind === 'guidance' ? (
            <p className="text-sm text-neutral-700 dark:text-neutral-300">{finding.suggested_rewrite}</p>
          ) : (
            <pre className="overflow-x-auto rounded border border-neutral-300 bg-neutral-100 p-3 text-sm whitespace-pre-wrap text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100">
              {finding.suggested_rewrite}
            </pre>
          )}
          {finding.rewrite_kind !== 'guidance' && hasOtherFindings && (
            <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-500">
              Fixes only the claim above. Other findings on this ad need their own rewrite.
            </p>
          )}
        </div>
      )}
    </li>
  );
}
