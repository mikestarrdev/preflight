import type { Severity } from '@/lib/types';

export type StripField = { label: string; value: string };

// The status strip: one annunciator lamp, the verdict, and the run's fixed
// fields, read left to right. Modeled on an air traffic control flight progress
// strip, which is the same job in paper form. The verdict text is passed in
// whole so this component never decides what the result says.
export function StatusStrip({
  severity,
  headline,
  subline,
  fields,
}: {
  severity: Severity;
  headline: React.ReactNode;
  subline?: React.ReactNode;
  fields: StripField[];
}) {
  return (
    <section
      data-sev={severity}
      className="overflow-hidden rounded-lg border border-line bg-panel shadow-[var(--lift)]"
    >
      {/* Narrow viewports get the lamp as a lit edge across the top; there is
          no room for a bezel cell beside three fields and a sentence. */}
      <span aria-hidden="true" className="lamp block h-1.5 w-full sm:hidden" />

      <div className="flex flex-col sm:flex-row">
        <div
          aria-hidden="true"
          className="sunken hidden w-12 shrink-0 items-center justify-center border-r border-line sm:flex"
        >
          <span className="lamp h-9 w-2.5 rounded-[3px]" />
        </div>

        <div className="min-w-0 flex-1 bg-[var(--sev-tint)] px-4 py-3.5">
          <p className="label-micro">Status</p>
          <p className="sev-text mt-1.5 text-[15px] leading-snug font-semibold">{headline}</p>
          {subline && <p className="mt-1 text-sm text-muted">{subline}</p>}
        </div>

        {/* Narrow viewports read the fields as label/value rows: three columns
            at 375px truncates both the element list and the corpus hash. */}
        <dl className="flex flex-col border-t border-line sm:flex-row sm:border-t-0 sm:border-l">
          {fields.map((field) => (
            <div
              key={field.label}
              className="flex items-baseline justify-between gap-3 border-b border-line px-4 py-2 last:border-b-0 sm:min-w-[96px] sm:flex-col sm:items-start sm:justify-start sm:border-r sm:border-b-0 sm:py-3.5 sm:last:border-r-0"
            >
              <dt className="label-micro">{field.label}</dt>
              <dd className="font-mono text-[13px] tabular-nums text-ink sm:mt-1.5">
                {field.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
