'use client';

import { useEffect, useRef } from 'react';

export function HelpModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={backdropRef}
      onClick={(e) => {
        if (e.target === backdropRef.current) onClose();
      }}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-10"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-modal-title"
        className="w-full max-w-lg rounded-lg border border-neutral-200 bg-white p-5 text-neutral-900 shadow-lg dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id="help-modal-title" className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            How it works
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-6 w-6 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-4 text-sm">
          <section>
            <h3 className="mb-1 font-medium text-neutral-700 dark:text-neutral-300">Running a check</h3>
            <p className="text-neutral-600 dark:text-neutral-400">
              Paste ad copy, upload a creative, or point at a landing page, in any combination.
              Only the elements you provide get analyzed.
            </p>
          </section>

          <section>
            <h3 className="mb-1 font-medium text-neutral-700 dark:text-neutral-300">Reading the results</h3>
            <ul className="flex flex-col gap-1.5 text-neutral-600 dark:text-neutral-400">
              <li className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-red-600" />
                <span>Violation: likely breaks a specific policy clause as written.</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-amber-500" />
                <span>Risk: could draw review, worth a second look before spending.</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-neutral-400 dark:bg-neutral-600" />
                <span>Clear: checked against relevant policy, no issue found.</span>
              </li>
            </ul>
          </section>

          <section>
            <h3 className="mb-1 font-medium text-neutral-700 dark:text-neutral-300">About rewrites</h3>
            <p className="text-neutral-600 dark:text-neutral-400">
              A rewrite only fixes the one finding it&apos;s attached to, not the whole ad. If there
              are several findings, each needs its own fix.
            </p>
          </section>

          <section>
            <h3 className="mb-1 font-medium text-neutral-700 dark:text-neutral-300">Limits worth knowing</h3>
            <p className="text-neutral-600 dark:text-neutral-400">
              This is a policy-matching aid, not legal or compliance sign-off. Always apply your
              own review before spending on media. Results can also vary between runs on the
              same ad, since the model doesn&apos;t answer identically every time.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
