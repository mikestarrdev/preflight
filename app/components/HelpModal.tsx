'use client';

import { useEffect, useRef } from 'react';
import type { Severity } from '@/lib/types';

const LEGEND: { severity: Severity; text: string }[] = [
  { severity: 'violation', text: 'Violation: likely breaks a specific policy clause as written.' },
  { severity: 'risk', text: 'Risk: could draw review, worth a second look before spending.' },
  { severity: 'clear', text: 'Clear: checked against relevant policy, no issue found.' },
];

export function HelpModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
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
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 px-4 py-10"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-modal-title"
        className="w-full max-w-lg rounded-lg border border-line bg-panel p-5 text-ink shadow-lg"
      >
        <div className="mb-4 flex items-center justify-between border-b border-line pb-3">
          <h2 id="help-modal-title" className="label-micro">
            How it works
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-sunken hover:text-ink"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-4 text-sm">
          <section>
            <h3 className="mb-1 font-semibold">Running a check</h3>
            <p className="text-muted">
              Paste ad copy, upload a creative, or point at a landing page, in any combination. Only
              the elements you provide get analyzed.
            </p>
          </section>

          <section>
            <h3 className="mb-1.5 font-semibold">Reading the results</h3>
            <ul className="flex flex-col gap-1.5 text-muted">
              {LEGEND.map((item) => (
                <li key={item.severity} data-sev={item.severity} className="flex items-center gap-2.5">
                  <span
                    aria-hidden="true"
                    className="h-2.5 w-4 shrink-0 rounded-[2px] bg-[var(--sev-lamp)]"
                  />
                  <span>{item.text}</span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h3 className="mb-1 font-semibold">About rewrites</h3>
            <p className="text-muted">
              A rewrite only fixes the one finding it&apos;s attached to, not the whole ad. If there
              are several findings, each needs its own fix.
            </p>
          </section>

          <section>
            <h3 className="mb-1 font-semibold">Limits worth knowing</h3>
            <p className="text-muted">
              This is a policy-matching aid, not legal or compliance sign-off. Always apply your own
              review before spending on media. Results can also vary between runs on the same ad,
              since the model doesn&apos;t answer identically every time.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
