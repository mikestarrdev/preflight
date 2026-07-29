'use client';

import { useRef, useState } from 'react';
import type { AnalysisResult } from '@/lib/types';
import { EXAMPLE_ADS } from '@/lib/example-ads';
import { MAX_COPY_CHARS } from '@/lib/limits';
import { ANALYSIS_STEPS, StepProgress } from './components/StepProgress';
import { groupFindings, FindingGroupCard } from './components/FindingGroup';
import { HelpModal } from './components/HelpModal';

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

  return (
    <div className="mx-auto min-h-screen max-w-3xl px-4 py-10 sm:px-6">
      <header className="mb-8">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
            Pre<span className="text-emerald-600 dark:text-emerald-500">flight</span>
          </h1>
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            aria-label="How it works"
            className="flex h-5 w-5 items-center justify-center rounded-full border border-neutral-300 text-[11px] text-neutral-500 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
          >
            ?
          </button>
        </div>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          Pre-flight compliance checking for Meta ads. Paste copy, upload a creative, or check a
          landing page, and get back policy findings cited to the exact clause, plus a compliant
          rewrite.
        </p>
      </header>

      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />

      <section className="mb-6">
        <label
          htmlFor="copy"
          className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
        >
          Ad copy
        </label>
        <textarea
          id="copy"
          value={copy}
          onChange={(e) => setCopy(e.target.value)}
          placeholder="Paste your ad copy here..."
          rows={6}
          className="w-full rounded-md border border-neutral-300 bg-white p-3 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
        />

        <div className="mt-1 flex justify-end">
          <span
            className={
              'text-xs ' +
              (copyTooLong
                ? 'text-red-600 dark:text-red-400'
                : 'text-neutral-400 dark:text-neutral-600')
            }
          >
            {copy.length.toLocaleString()} / {MAX_COPY_CHARS.toLocaleString()} characters
          </span>
        </div>
        {copyTooLong && (
          <p className="mt-1 text-xs text-red-600 dark:text-red-400">
            Copy is over the {MAX_COPY_CHARS.toLocaleString()}-character limit. Trim it before
            analyzing.
          </p>
        )}

        {status === 'idle' && !hasInput && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-xs text-neutral-500 dark:text-neutral-500">Try an example:</span>
            {EXAMPLE_ADS.map((ex) => (
              <button
                key={ex.id}
                type="button"
                onClick={() => loadExample(ex.id)}
                className="rounded-full border border-neutral-300 px-3 py-1 text-xs text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                {ex.label}
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="mb-6 grid gap-4 sm:grid-cols-2">
        <div>
          <span className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
            Creative <span className="font-normal text-neutral-400">(optional)</span>
          </span>
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
              'flex h-[88px] cursor-pointer flex-col items-center justify-center rounded-md border border-dashed p-3 text-center text-xs ' +
              (dragOver
                ? 'border-neutral-500 bg-neutral-100 dark:bg-neutral-800'
                : 'border-neutral-300 text-neutral-500 dark:border-neutral-700 dark:text-neutral-500')
            }
          >
            {imagePreview ? (
              <div className="flex items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imagePreview} alt="" className="h-12 w-12 rounded object-cover" />
                <div className="text-left">
                  <p className="text-neutral-700 dark:text-neutral-300">{imageFile?.name}</p>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      pickImage(null);
                    }}
                    className="text-blue-700 hover:underline dark:text-blue-400"
                  >
                    remove
                  </button>
                </div>
              </div>
            ) : (
              <p>
                Drag an image here or click to upload
                <br />
                JPG, PNG, or WebP, up to 5MB
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
          {imageError && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{imageError}</p>}
        </div>

        <div>
          <label
            htmlFor="url"
            className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
          >
            Landing page <span className="font-normal text-neutral-400">(optional)</span>
          </label>
          <input
            id="url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/landing"
            className="h-[88px] w-full rounded-md border border-neutral-300 bg-white p-3 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
          />
        </div>
      </section>

      <button
        type="button"
        onClick={analyze}
        disabled={!hasInput || copyTooLong || status === 'loading'}
        className="w-full rounded-md bg-neutral-900 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
      >
        {status === 'loading' ? 'Analyzing…' : 'Analyze'}
      </button>

      {status === 'loading' && (
        <div className="mt-8 rounded-md border border-neutral-200 p-4 dark:border-neutral-800">
          <StepProgress activeIndex={stepIndex} />
          <p className="mt-3 text-xs text-neutral-500 dark:text-neutral-500">
            A full run makes several model calls across {ANALYSIS_STEPS.length} steps and can take
            30-60s.
          </p>
        </div>
      )}

      {status === 'error' && errorMsg && (
        <div className="mt-8 rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
          {errorMsg}
        </div>
      )}

      {status === 'done' && result && (
        <div className="mt-8">
          {result.diagnostics.degraded.length > 0 && (
            <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-300">
              {result.diagnostics.degraded.map((d, i) => (
                <p key={i}>{degradedMessage(d)}</p>
              ))}
            </div>
          )}

          {result.findings.length === 0 ? (
            <p className="text-sm text-neutral-600 dark:text-neutral-400">
              No policy findings for the elements analyzed.
            </p>
          ) : (
            <>
              {violationGroups.length > 0 ? (
                <div className="mb-4">
                  <p className="text-base font-semibold text-red-700 dark:text-red-400">
                    {violationGroups.length}{' '}
                    {violationGroups.length === 1 ? 'problem needs' : 'problems need'} attention
                    before you publish.
                  </p>
                  <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
                    {result.findings.length} {result.findings.length === 1 ? 'finding' : 'findings'}:{' '}
                    <span className="text-neutral-400 dark:text-neutral-600">
                      {violations.length} violation{violations.length === 1 ? '' : 's'} ·{' '}
                      {risks.length} risk{risks.length === 1 ? '' : 's'} ·{' '}
                      {clears.length} clear
                    </span>
                  </p>
                </div>
              ) : riskGroups.length > 0 ? (
                <div className="mb-4">
                  <p className="text-base font-semibold text-amber-700 dark:text-amber-400">
                    No clear violations. {riskGroups.length}{' '}
                    {riskGroups.length === 1 ? 'area' : 'areas'} worth reviewing before you publish.
                  </p>
                  <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
                    {result.findings.length} {result.findings.length === 1 ? 'finding' : 'findings'}:{' '}
                    <span className="text-neutral-400 dark:text-neutral-600">
                      {violations.length} violation{violations.length === 1 ? '' : 's'} ·{' '}
                      {risks.length} risk{risks.length === 1 ? '' : 's'} ·{' '}
                      {clears.length} clear
                    </span>
                  </p>
                </div>
              ) : (
                <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900/60 dark:bg-emerald-950/20">
                  <p className="text-base font-semibold text-emerald-800 dark:text-emerald-300">
                    No violations found. {clearGroups.length}{' '}
                    {clearGroups.length === 1 ? 'policy area' : 'policy areas'} checked against
                    Meta&apos;s advertising standards.
                  </p>
                  <p className="mt-1 text-sm text-emerald-700/80 dark:text-emerald-400/70">
                    {result.findings.length} {result.findings.length === 1 ? 'finding' : 'findings'}:{' '}
                    {violations.length} violation{violations.length === 1 ? '' : 's'} ·{' '}
                    {risks.length} risk{risks.length === 1 ? '' : 's'} · {clears.length}{' '}
                    clear
                  </p>
                </div>
              )}
              <div className="flex flex-col gap-6">
                {violations.length > 0 && (
                  <div>
                    <h2 className="mb-2 text-sm font-semibold text-neutral-500 dark:text-neutral-400">
                      Violations ({violations.length})
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
                    <h2 className="mb-1 text-sm font-semibold text-neutral-500 dark:text-neutral-400">
                      Worth a second look ({risks.length})
                    </h2>
                    <p className="mb-2 text-xs text-neutral-500 dark:text-neutral-500">
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
                    <summary className="cursor-pointer text-sm font-semibold text-neutral-500 dark:text-neutral-400">
                      Clear ({clears.length})
                    </summary>
                    <ul className="mt-2 flex flex-col gap-3">
                      {clearGroups.map((g) => (
                        <FindingGroupCard key={g.key} group={g} hasOtherFindings={hasOtherFindings} />
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            </>
          )}

          <div className="mt-6 flex items-center justify-between text-xs text-neutral-400 dark:text-neutral-600">
            <span>
              {result.duration_ms}ms · {result.model_version} · corpus {result.corpus_version}
            </span>
            <button
              type="button"
              onClick={reset}
              className="text-blue-700 hover:underline dark:text-blue-400"
            >
              analyze another ad
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
