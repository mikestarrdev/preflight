// A full run makes several sequential Claude calls and commonly takes 30-60s.
// The orchestrator doesn't expose step-by-step progress (it returns one
// promise at the end), so this is a timed, client-side approximation of the
// real classify/retrieve/adjudicate/rewrite sequence rather than a live
// stream. Good enough to show the pipeline is multi-step, not a spinner.
export const ANALYSIS_STEPS = [
  'Classifying ad',
  'Retrieving policies',
  'Checking against policy',
  'Drafting rewrites',
] as const;

export function StepProgress({ activeIndex }: { activeIndex: number }) {
  return (
    <ol data-sev="clear" aria-live="polite" className="flex flex-col gap-2.5">
      {ANALYSIS_STEPS.map((label, i) => {
        const done = i < activeIndex;
        const active = i === activeIndex;
        return (
          <li key={label} className="flex items-center gap-3">
            <span
              className={
                'flex h-5 w-5 shrink-0 items-center justify-center rounded-[3px] border font-mono text-[10px] ' +
                (done
                  ? 'sev-badge border-transparent'
                  : active
                    ? 'animate-pulse border-line-strong text-ink'
                    : 'border-line text-faint')
              }
            >
              {done ? '✓' : i + 1}
            </span>
            <span className={'text-sm ' + (done || active ? 'text-ink' : 'text-faint')}>
              {label}
            </span>
            <span aria-hidden="true" className="min-w-4 flex-1 border-b border-dotted border-line" />
            <span className={'label-micro shrink-0 ' + (done ? 'sev-text' : '')}>
              {done ? 'Checked' : active ? 'Running' : ''}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
