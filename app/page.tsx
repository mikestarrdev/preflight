'use client';

import { useRef, useState } from 'react';
import type { AnalysisResult, Element } from '@/lib/types';
import { EXAMPLE_ADS } from '@/lib/example-ads';
import { MAX_COPY_CHARS } from '@/lib/limits';
import { ANALYSIS_STEPS, StepProgress } from './components/StepProgress';
import { groupFindings, FindingGroupCard } from './components/FindingGroup';
import { HelpModal } from './components/HelpModal';
import { StatusStrip, type StripField } from './components/StatusStrip';
import { ThemeToggle } from './components/ThemeToggle';

// Mirrors lib/agent/orchestrator.ts's RunDiagnostics shape without importing
// that module: the import would be type-only and erased at build time either
// way, but keeping the client bundle decoupled from lib/agent/ internals
// means changes to the pipeline can never accidentally drag server-only code
// into this file.
type RunDiagnostics = {
  step_timings_ms: Record<string, number>;
  findings_emitted: number;
  citation_drops: number;
  scope_drops: number;
  parent_rule_redirects: number;
  explanation_spans_total: number;
  explanation_spans_grounded: number;
  degraded: string[];
};

type AnalyzeResponse = AnalysisResult & { diagnostics: RunDiagnostics };

const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// Short codes for the status strip's ELEMENTS field, which is a fixed-width
// readout rather than prose.
const ELEMENT_CODE: Record<Element, string> = {
  copy: 'COPY',
  image: 'IMG',
  landing_page: 'LP',
};

// Cumulative offsets (ms) at which the simulated progress advances past
// classify / retrieve / adjudicate+verify. Roughly proportional to observed
// step_timings_ms in evals/results/*.json — adjudicate dominates. Rewrite has
// no fixed end; the last step just waits for the response.
const STEP_DURATIONS_MS = [2500, 4000, 20000];

type Status = 'idle' | 'loading' | 'done' | 'error';

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error ?? new Error('failed to read file'));
    reader.readAsDataURL(file);
  });
}

// Formats orchestrator.ts diagnostics.degraded entries, e.g.
// "landing_page:not_checked:<reason>" or "rewrite:<policy_id>" — policy_id
// itself contains colons, so this matches on known prefixes rather than
// splitting positionally.
function degradedMessage(entry: string): string {
  if (entry.startsWith('landing_page:not_checked:')) {
    return `Landing page not checked: ${entry.slice('landing_page:not_checked:'.length)}`;
  }
  if (entry.startsWith('image:failed:')) {
    return `Creative analysis failed: ${entry.slice('image:failed:'.length)}`;
  }
  if (entry.startsWith('landing_page:failed:')) {
    return `Landing page analysis failed: ${entry.slice('landing_page:failed:'.length)}`;
  }
  if (entry.startsWith('copy:failed:')) {
    return `Ad copy analysis failed: ${entry.slice('copy:failed:'.length)}`;
  }
  if (entry.startsWith('rewrite:')) {
    return `Rewrite unavailable for ${entry.slice('rewrite:'.length)}`;
  }
  return entry;
}

// The header mark: a flight progress strip seen end on, which is the same
// object the results render as.
function StripMark() {
  return (
    <svg viewBox="0 0 24 16" aria-hidden="true" className="h-4 w-6 shrink-0 text-signal">
      <rect x="0.7" y="0.7" width="22.6" height="14.6" rx="2.4" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <rect x="2.4" y="2.4" width="3.6" height="11.2" rx="1" fill="currentColor" />
      <path d="M13.5 1.4v13.2M18.4 1.4v13.2" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

// Caps label with a rule running out to the right, for the result sections.
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="label-micro flex items-center gap-3 text-[11px]">
      <span>{children}</span>
      <span aria-hidden="true" className="h-px flex-1 bg-line" />
    </span>
  );
}

export default function Home() {
  const [copy, setCopy] = useState('');
  const [url, setUrl] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const [status, setStatus] = useState<Status>('idle');
  const [stepIndex, setStepIndex] = useState(0);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  function clearTimers() {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }

  function pickImage(file: File | null) {
    setImageError(null);
    if (!file) {
      setImageFile(null);
      setImagePreview(null);
      return;
    }
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setImageError('unsupported file type, use JPG, PNG, or WebP');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setImageError('image too large, 5MB max');
      return;
    }
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  }

  function loadExample(id: string) {
    const example = EXAMPLE_ADS.find((e) => e.id === id);
    if (!example) return;
    setCopy(example.copy);
    setUrl('');
    pickImage(null);
    setResult(null);
    setStatus('idle');
    setErrorMsg(null);
  }

  function reset() {
    setCopy('');
    setUrl('');
    pickImage(null);
    setResult(null);
    setStatus('idle');
    setErrorMsg(null);
  }

  const hasInput = copy.trim().length > 0 || url.trim().length > 0 || imageFile !== null;
  const copyTooLong = copy.length > MAX_COPY_CHARS;

  async function analyze() {
    setStatus('loading');
    setErrorMsg(null);
    setResult(null);
    setStepIndex(0);
    clearTimers();
    let elapsed = 0;
    STEP_DURATIONS_MS.forEach((duration, i) => {
      elapsed += duration;
      timers.current.push(setTimeout(() => setStepIndex(i + 1), elapsed));
    });

    try {
      const body: Record<string, unknown> = {};
      if (copy.trim()) body.copy = copy.trim();
      if (url.trim()) body.url = url.trim();
      if (imageFile) {
        body.image = { data: await fileToBase64(imageFile), media_type: imageFile.type };
      }

      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? `request failed (${res.status})`);
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let text = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
      }

      const lines = text.split('\n').filter((line) => line.length > 0);
      const lastLine = lines[lines.length - 1];
      if (!lastLine) throw new Error('empty response from server');

      const parsed = JSON.parse(lastLine);
      if (parsed.error) throw new Error(parsed.error);

      clearTimers();
      setResult(parsed as AnalyzeResponse);
      setStatus('done');
    } catch (err) {
      clearTimers();
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  }

  const violations = result?.findings.filter((f) => f.severity === 'violation') ?? [];
  const risks = result?.findings.filter((f) => f.severity === 'risk') ?? [];
  const clears = result?.findings.filter((f) => f.severity === 'clear') ?? [];
  // Each rewrite only addresses the one finding it's attached to. Whenever
  // there's more than one flagged finding, that needs saying out loud, or a
  // copied rewrite reads as "the ad, fixed" instead of "this one issue, fixed."
  const hasOtherFindings = violations.length + risks.length > 1;

  // Grouped per severity section, so every group's members share one
  // severity and the badge on a FindingGroupCard needs no separate lookup.
  const violationGroups = groupFindings(violations);
  const riskGroups = groupFindings(risks);
  const clearGroups = groupFindings(clears);

  // The strip's fixed fields: what was checked, how long it took, and against
  // which corpus. Provenance, not verdict.
  const stripFields: StripField[] = result
    ? [
        {
          label: 'Elements',
          value: result.elements_analyzed.map((e) => ELEMENT_CODE[e]).join(' · '),
        },
        { label: 'Run time', value: `${(result.duration_ms / 1000).toFixed(1)}s` },
        { label: 'Corpus', value: result.corpus_version },
      ]
    : [];

  const countsLine = result ? (
    <>
      {result.findings.length} {result.findings.length === 1 ? 'finding' : 'findings'}:{' '}
      {violations.length} violation{violations.length === 1 ? '' : 's'} · {risks.length} risk
      {risks.length === 1 ? '' : 's'} · {clears.length} clear
    </>
  ) : null;

  return (
    <div className="mx-auto min-h-screen max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
      <header className="mb-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <StripMark />
            <h1 className="text-xl font-bold tracking-tight text-ink">Preflight</h1>
            <span className="label-micro rounded border border-line px-1.5 py-0.5">Meta</span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setHelpOpen(true)}
              aria-label="How it works"
              className="flex h-7 w-7 items-center justify-center rounded-md border border-line text-xs text-muted hover:bg-sunken hover:text-ink"
            >
              ?
            </button>
            <ThemeToggle />
          </div>
        </div>
        <p className="mt-2.5 max-w-2xl text-sm text-muted">
          Pre-flight compliance checking for Meta ads. Paste copy, upload a creative, or check a
          landing page, and get back policy findings cited to the exact clause, plus a compliant
          rewrite.
        </p>
      </header>

      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />

      <section className="rounded-lg border border-line bg-panel p-4 shadow-[var(--lift)] sm:p-5">
        <div className="mb-1.5 flex items-baseline justify-between gap-3">
          <label htmlFor="copy" className="label-micro">
            Ad copy
          </label>
          <span
            className={
              'font-mono text-[10px] tabular-nums ' + (copyTooLong ? 'text-violation' : 'text-faint')
            }
          >
            {copy.length.toLocaleString()} / {MAX_COPY_CHARS.toLocaleString()}
          </span>
        </div>
        <textarea
          id="copy"
          value={copy}
          onChange={(e) => setCopy(e.target.value)}
          placeholder="Paste your ad copy here..."
          rows={6}
          className="sunken w-full rounded-md border border-line p-3 text-sm text-ink placeholder:text-faint focus:border-line-strong focus:outline-none"
        />

        {copyTooLong && (
          <p className="mt-1.5 text-xs text-violation">
            Copy is over the {MAX_COPY_CHARS.toLocaleString()}-character limit. Trim it before
            analyzing.
          </p>
        )}

        {status === 'idle' && !hasInput && (
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <span className="label-micro">Try an example</span>
            {EXAMPLE_ADS.map((ex) => (
              <button
                key={ex.id}
                type="button"
                onClick={() => loadExample(ex.id)}
                className="rounded-md border border-line px-2.5 py-1 text-xs text-muted hover:border-line-strong hover:text-ink"
              >
                {ex.label}
              </button>
            ))}
          </div>
        )}

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <span className="label-micro mb-1.5 block">Creative (optional)</span>
            <div
              role="button"
              tabIndex={0}
              aria-label="Upload creative image"
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click();
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                pickImage(e.dataTransfer.files[0] ?? null);
              }}
              className={
                'sunken flex h-[88px] cursor-pointer flex-col items-center justify-center rounded-md border border-dashed p-3 text-center text-xs ' +
                (dragOver ? 'border-signal text-ink' : 'border-line-strong text-muted')
              }
            >
              {imagePreview ? (
                <div className="flex items-center gap-2.5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={imagePreview} alt="" className="h-12 w-12 rounded object-cover" />
                  <div className="text-left">
                    <p className="text-ink">{imageFile?.name}</p>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        pickImage(null);
                      }}
                      className="rounded-sm text-signal hover:underline"
                    >
                      remove
                    </button>
                  </div>
                </div>
              ) : (
                <p>
                  Drag an image here or click to upload
                  <br />
                  <span className="text-faint">JPG, PNG, or WebP, up to 5MB</span>
                </p>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_IMAGE_TYPES.join(',')}
              onChange={(e) => pickImage(e.target.files?.[0] ?? null)}
              className="hidden"
            />
            {imageError && <p className="mt-1.5 text-xs text-violation">{imageError}</p>}
          </div>

          <div>
            <label htmlFor="url" className="label-micro mb-1.5 block">
              Landing page (optional)
            </label>
            <input
              id="url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/landing"
              className="sunken h-10 w-full rounded-md border border-line px-3 text-sm text-ink placeholder:text-faint focus:border-line-strong focus:outline-none"
            />
            <p className="mt-1.5 text-xs text-faint">Fetched and checked against the ad&apos;s claims.</p>
          </div>
        </div>

        <div className="mt-4 border-t border-line pt-4">
          <button
            type="button"
            onClick={analyze}
            disabled={!hasInput || copyTooLong || status === 'loading'}
            className="w-full rounded-md bg-ink py-2.5 text-sm font-semibold text-paper disabled:cursor-not-allowed disabled:bg-line disabled:text-muted"
          >
            {status === 'loading' ? 'Analyzing…' : 'Analyze'}
          </button>
        </div>
      </section>

      {status === 'loading' && (
        <div className="mt-6 rounded-lg border border-line bg-panel p-4 shadow-[var(--lift)]">
          <StepProgress activeIndex={stepIndex} />
          <p className="mt-3.5 border-t border-line pt-3 text-xs text-muted">
            A full run makes several model calls across {ANALYSIS_STEPS.length} steps and can take
            30-60s.
          </p>
        </div>
      )}

      {status === 'error' && errorMsg && (
        <div
          data-sev="violation"
          className="sev-surface mt-6 rounded-lg border p-4 text-sm text-violation"
        >
          {errorMsg}
        </div>
      )}

      {status === 'done' && result && (
        <div className="mt-6">
          {result.diagnostics.degraded.length > 0 && (
            <div
              data-sev="risk"
              className="sev-surface mb-4 rounded-lg border p-3 text-xs text-risk"
            >
              {result.diagnostics.degraded.map((d, i) => (
                <p key={i}>{degradedMessage(d)}</p>
              ))}
            </div>
          )}

          {result.findings.length === 0 ? (
            <StatusStrip
              severity="clear"
              headline="No policy findings for the elements analyzed."
              fields={stripFields}
            />
          ) : (
            <>
              {violationGroups.length > 0 ? (
                <StatusStrip
                  severity="violation"
                  headline={
                    <>
                      {violationGroups.length}{' '}
                      {violationGroups.length === 1 ? 'problem needs' : 'problems need'} attention
                      before you publish.
                    </>
                  }
                  subline={countsLine}
                  fields={stripFields}
                />
              ) : riskGroups.length > 0 ? (
                <StatusStrip
                  severity="risk"
                  headline={
                    <>
                      No clear violations. {riskGroups.length}{' '}
                      {riskGroups.length === 1 ? 'area' : 'areas'} worth reviewing before you
                      publish.
                    </>
                  }
                  subline={countsLine}
                  fields={stripFields}
                />
              ) : (
                <StatusStrip
                  severity="clear"
                  headline={
                    <>
                      No violations found. {clearGroups.length}{' '}
                      {clearGroups.length === 1 ? 'policy area' : 'policy areas'} checked against
                      Meta&apos;s advertising standards.
                    </>
                  }
                  subline={countsLine}
                  fields={stripFields}
                />
              )}

              <div className="mt-6 flex flex-col gap-6">
                {violations.length > 0 && (
                  <div>
                    <h2 className="mb-2.5">
                      <SectionLabel>Violations ({violations.length})</SectionLabel>
                    </h2>
                    <ul className="flex flex-col gap-3">
                      {violationGroups.map((g) => (
                        <FindingGroupCard key={g.key} group={g} hasOtherFindings={hasOtherFindings} />
                      ))}
                    </ul>
                  </div>
                )}
                {risks.length > 0 && (
                  <div>
                    <h2 className="mb-1.5">
                      <SectionLabel>Worth a second look ({risks.length})</SectionLabel>
                    </h2>
                    <p className="mb-2.5 text-xs text-muted">
                      These aren&apos;t confirmed violations. They&apos;re findings the model
                      couldn&apos;t resolve from the ad alone and need a human judgment call.
                    </p>
                    <ul className="flex flex-col gap-3">
                      {riskGroups.map((g) => (
                        <FindingGroupCard key={g.key} group={g} hasOtherFindings={hasOtherFindings} />
                      ))}
                    </ul>
                  </div>
                )}
                {clears.length > 0 && (
                  <details className="group">
                    <summary className="cursor-pointer list-none rounded-sm [&::-webkit-details-marker]:hidden">
                      <span className="label-micro flex items-center gap-3 text-[11px]">
                        <svg
                          viewBox="0 0 8 8"
                          aria-hidden="true"
                          className="h-2 w-2 shrink-0 transition-transform group-open:rotate-90"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M2.5 1 6 4l-3.5 3" />
                        </svg>
                        <span>Clear ({clears.length})</span>
                        <span aria-hidden="true" className="h-px flex-1 bg-line" />
                      </span>
                    </summary>
                    <ul className="mt-2.5 flex flex-col gap-3">
                      {clearGroups.map((g) => (
                        <FindingGroupCard key={g.key} group={g} hasOtherFindings={hasOtherFindings} />
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            </>
          )}

          <div className="mt-6 flex items-center justify-between gap-3 border-t border-line pt-3">
            <span className="font-mono text-[10px] text-faint">{result.model_version}</span>
            <button
              type="button"
              onClick={reset}
              className="rounded-sm text-xs text-signal hover:underline"
            >
              analyze another ad
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
