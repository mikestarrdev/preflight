'use client';

import type { Finding } from '@/lib/types';
import { FindingCard } from './FindingCard';

export type FindingGroup = {
  key: string;
  offendingSpan: string | null;
  findings: Finding[]; // sorted by confidence descending; findings[0] is the highest-confidence member
};

// Groups by offending_span, exact match after trimming. Findings without a
// span (legitimate for image findings) can't be merged with anything, so
// each becomes its own single-member group rather than one shared bucket.
export function groupFindings(findings: Finding[]): FindingGroup[] {
  const bySpan = new Map<string, Finding[]>();
  const singles: FindingGroup[] = [];

  findings.forEach((f, i) => {
    const span = f.offending_span?.trim();
    if (!span) {
      singles.push({ key: `single:${f.element}:${f.policy_id}:${i}`, offendingSpan: null, findings: [f] });
      return;
    }
    const existing = bySpan.get(span);
    if (existing) existing.push(f);
    else bySpan.set(span, [f]);
  });

  const groups: FindingGroup[] = [
    ...Array.from(bySpan.entries()).map(([span, fs]) => ({
      key: `span:${span}`,
      offendingSpan: span,
      findings: fs,
    })),
    ...singles,
  ];

  for (const g of groups) {
    g.findings.sort((a, b) => b.confidence - a.confidence);
  }
  groups.sort((a, b) => b.findings[0].confidence - a.findings[0].confidence);

  return groups;
}

// The summary's distinct-issue count, unlike the per-section groups below,
// counts a span once even if it recurs at more than one severity — a claim
// that's a violation via one clause and a risk via another is one issue, not
// two, so this must dedupe across all findings rather than sum group counts
// computed per severity.
export function countDistinctIssues(findings: Finding[]): number {
  const spans = new Set<string>();
  let ungroupedCount = 0;
  for (const f of findings) {
    const span = f.offending_span?.trim();
    if (!span) {
      ungroupedCount++;
      continue;
    }
    spans.add(span);
  }
  return spans.size + ungroupedCount;
}

const ELEMENT_LABEL: Record<Finding['element'], string> = {
  copy: 'Ad copy',
  image: 'Creative',
  landing_page: 'Landing page',
};

const SEVERITY_BADGE: Record<Finding['severity'], string> = {
  violation: 'bg-red-600 text-white',
  risk: 'bg-amber-500 text-black',
  clear: 'bg-neutral-400 text-white dark:bg-neutral-600',
};

export function FindingGroupCard({
  group,
  hasOtherFindings,
}: {
  group: FindingGroup;
  hasOtherFindings: boolean;
}) {
  const [primary, ...rest] = group.findings;

  if (!group.offendingSpan) {
    return <FindingCard finding={primary} hasOtherFindings={hasOtherFindings} />;
  }

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
      <p className="text-sm text-neutral-600 italic dark:text-neutral-400">
        &ldquo;{group.offendingSpan}&rdquo;
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded px-2 py-0.5 text-xs font-semibold tracking-wide uppercase ${SEVERITY_BADGE[primary.severity]}`}
        >
          {primary.severity}
        </span>
        <span className="rounded border border-neutral-300 px-2 py-0.5 text-xs text-neutral-600 dark:border-neutral-700 dark:text-neutral-400">
          {ELEMENT_LABEL[primary.element]}
        </span>
        <span className="text-xs text-neutral-500 dark:text-neutral-500">
          {group.findings.length} {group.findings.length === 1 ? 'clause cites' : 'clauses cite'} this
          text
        </span>
      </div>
      <ul className="flex flex-col gap-3">
        <FindingCard finding={primary} hasOtherFindings={hasOtherFindings} />
      </ul>
      {rest.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs text-neutral-500 hover:underline dark:text-neutral-500">
            {rest.length} more {rest.length === 1 ? 'clause cites' : 'clauses cite'} this text
          </summary>
          <ul className="mt-2 flex flex-col gap-3">
            {rest.map((f, i) => (
              <FindingCard
                key={`${f.element}:${f.policy_id}:${i}`}
                finding={f}
                hasOtherFindings={hasOtherFindings}
              />
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}
