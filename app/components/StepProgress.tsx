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
    <ol aria-live="polite" className="flex flex-col gap-2.5">
      {ANALYSIS_STEPS.map((label, i) => {
        const done = i < activeIndex;
        const active = i === activeIndex;
        return (
          <li key={label} className="flex items-center gap-3">
            <span
              className={
                'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] ' +
                (done
                  ? 'border-emerald-600 bg-emerald-600 text-white dark:border-emerald-500 dark:bg-emerald-500'
                  : active
                    ? 'animate-pulse border-neutral-900 text-neutral-900 dark:border-neutral-100 dark:text-neutral-100'
                    : 'border-neutral-300 text-neutral-300 dark:border-neutral-700 dark:text-neutral-700')
              }
            >
              {done ? '✓' : i + 1}
            </span>
            <span
              className={
                'text-sm ' +
                (done || active
                  ? 'text-neutral-900 dark:text-neutral-100'
                  : 'text-neutral-400 dark:text-neutral-600')
              }
            >
              {label}
              {active ? '…' : ''}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
