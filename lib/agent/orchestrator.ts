import { randomUUID } from 'node:crypto';
import { MODEL_REASONING } from '@/lib/claude';
import { corpusVersion } from '@/lib/corpus';
import { fetchLandingPage } from '@/lib/inputs/landing-page';
import {
  creativeRetrievalQueries,
  describeCreative,
  serializeCreative,
  type CreativeImage,
} from '@/lib/inputs/vision';
import type { AnalysisResult, Element, Finding } from '@/lib/types';
import { verifyCitations } from './verify';
import { adjudicate } from './steps/adjudicate';
import { classify, type Claim } from './steps/classify';
import { checkClaims, serializeMismatch } from './steps/mismatch';
import { retrieve } from './steps/retrieve';
import { rewrite } from './steps/rewrite';

// Runs classify → retrieve → adjudicate → verify → rewrite for each input
// element. Owns sequencing, timing, and partial-failure handling: one
// element's pipeline failing degrades the run to the surviving elements, an
// unreachable landing page degrades to a note, rewrite failing degrades
// (findings survive without rewrites). Only a run where nothing could be
// analyzed is fatal.

export type AnalyzeInput = {
  copy?: string;
  image?: CreativeImage;
  url?: string;
};

export type RunDiagnostics = {
  step_timings_ms: Record<string, number>;
  findings_emitted: number; // adjudicator output count, pre-verification
  citation_drops: number; // findings dropped by citation verification
  parent_rule_redirects: number; // findings redirected from a matched example to its rule (4a)
  explanation_spans_total: number; // violation/risk findings, the grounding denominator (4b)
  explanation_spans_grounded: number; // of those, ones with a verbatim offending_span
  degraded: string[]; // non-fatal failures, e.g. "rewrite:meta:health-wellness:2.1"
};

// Extends the core type with diagnostics: the phase spec requires the citation
// drop count to be exposed, and the eval scorers grade on it.
export type AnalyzeOutput = AnalysisResult & { diagnostics: RunDiagnostics };

function debug(step: string, data: Record<string, unknown>): void {
  if (process.env.DEBUG_AGENT) console.error(JSON.stringify({ step, ...data }));
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function analyze(input: AnalyzeInput): Promise<AnalyzeOutput> {
  if (!input.copy && !input.image && !input.url) {
    throw new Error('analyze: provide at least one of copy, image, url');
  }
  const started = Date.now();
  const timings: Record<string, number> = {};
  const step = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    const t = Date.now();
    try {
      return await fn();
    } finally {
      timings[name] = Date.now() - t;
    }
  };

  const elements: Element[] = [];
  const findings: Finding[] = [];
  const degraded: string[] = [];
  let findingsEmitted = 0;
  let citationDrops = 0;
  let parentRuleRedirects = 0;
  let spansTotal = 0;
  let spansGrounded = 0;
  let failedElements = 0;

  const collect = (result: ReturnType<typeof verifyCitations>, emitted: number): void => {
    for (const d of result.dropped) {
      console.warn(`citation verification dropped ${d.policy_id}: ${d.reason}`);
    }
    findings.push(...result.findings);
    findingsEmitted += emitted;
    citationDrops += result.dropped.length;
    parentRuleRedirects += result.parent_rule_redirects;
    spansTotal += result.spans_total;
    spansGrounded += result.spans_grounded;
  };

  // Rewrite input per element: the copy itself, the serialized creative, or
  // the mismatch summary.
  const rewriteContent: Partial<Record<Element, string>> = {};

  // Normalize the non-text inputs first; the two are independent.
  const [creative, page] = await Promise.all([
    input.image
      ? step('image:vision', () => describeCreative(input.image!)).catch((err) => {
          failedElements += 1;
          degraded.push(`image:failed:${message(err)}`);
          return null;
        })
      : Promise.resolve(null),
    input.url ? step('landing_page:fetch', () => fetchLandingPage(input.url!)) : Promise.resolve(null),
  ]);

  // --- copy ---
  let copyClaims: Claim[] = [];
  if (input.copy) {
    const copy = input.copy;
    rewriteContent.copy = copy;
    try {
      const classification = await step('copy:classify', () => classify(copy));
      copyClaims = classification.claims;
      debug('classify', {
        element: 'copy',
        vertical: classification.vertical,
        categories: classification.restricted_categories,
        claims: classification.claims.length,
      });

      const chunks = await step('copy:retrieve', () => retrieve(copy, copyClaims));
      debug('retrieve', { element: 'copy', chunks: chunks.length });

      const adjudicated = await step('copy:adjudicate', () =>
        adjudicate(copy, copyClaims, chunks, 'copy'),
      );
      debug('adjudicate', { element: 'copy', findings: adjudicated.length });

      collect(verifyCitations(adjudicated, chunks, 'copy', copy), adjudicated.length);
      elements.push('copy');
    } catch (err) {
      failedElements += 1;
      degraded.push(`copy:failed:${message(err)}`);
    }
  }

  // --- image ---
  if (creative) {
    try {
      const imageText = creative.rendered_text.join('\n');
      // Text rendered in the image is policy-checked as if it were copy.
      const imageClaims = imageText.trim().length
        ? (await step('image:classify', () => classify(imageText))).claims
        : [];
      debug('classify', { element: 'image', claims: imageClaims.length });

      const chunks = await step('image:retrieve', () =>
        retrieve(imageText, imageClaims, creativeRetrievalQueries(creative)),
      );
      debug('retrieve', { element: 'image', chunks: chunks.length });

      const content = serializeCreative(creative);
      rewriteContent.image = content;
      const adjudicated = await step('image:adjudicate', () =>
        adjudicate(content, imageClaims, chunks, 'image'),
      );
      debug('adjudicate', { element: 'image', findings: adjudicated.length });

      collect(verifyCitations(adjudicated, chunks, 'image', content), adjudicated.length);
      elements.push('image');
    } catch (err) {
      failedElements += 1;
      degraded.push(`image:failed:${message(err)}`);
    }
  }

  // --- landing page ---
  // The mismatch check needs both the page and claims from the ad copy; with
  // either missing the page goes unchecked and the run says so.
  if (page) {
    if (!page.fetched) {
      degraded.push(`landing_page:not_checked:${page.reason}`);
    } else if (copyClaims.length === 0) {
      degraded.push('landing_page:not_checked:no ad copy claims to compare against');
    } else {
      try {
        const mismatches = await step('landing_page:mismatch', () => checkClaims(copyClaims, page));
        const problems = mismatches.filter((m) => m.status !== 'supported');
        debug('mismatch', { checked: mismatches.length, problems: problems.length });
        elements.push('landing_page');

        if (problems.length > 0) {
          const claimsById = new Map(copyClaims.map((c) => [c.id, c]));
          const queries = problems.map((m) => ({
            label: `mismatch:${m.claim_id}`,
            text: `ad promises "${claimsById.get(m.claim_id)?.text}" but the landing page does not deliver it — misleading or deceptive claims`,
          }));
          const problemClaims = problems
            .map((m) => claimsById.get(m.claim_id))
            .filter((c): c is Claim => c !== undefined);

          const chunks = await step('landing_page:retrieve', () => retrieve('', [], queries));
          debug('retrieve', { element: 'landing_page', chunks: chunks.length });

          const content = serializeMismatch(input.copy!, page, problems, claimsById);
          rewriteContent.landing_page = content;
          const adjudicated = await step('landing_page:adjudicate', () =>
            adjudicate(content, problemClaims, chunks, 'landing_page'),
          );
          debug('adjudicate', { element: 'landing_page', findings: adjudicated.length });

          collect(verifyCitations(adjudicated, chunks, 'landing_page', content), adjudicated.length);
        }
      } catch (err) {
        failedElements += 1;
        degraded.push(`landing_page:failed:${message(err)}`);
      }
    }
  }

  if (elements.length === 0 && failedElements > 0) {
    throw new Error(`analyze: no element could be analyzed — ${degraded.join('; ')}`);
  }

  // Rewrites for violations only. A rewrite failure must not lose the finding.
  await step('rewrite', async () => {
    const violations = findings.filter((f) => f.severity === 'violation');
    await Promise.all(
      violations.map(async (f) => {
        const content = rewriteContent[f.element];
        if (content === undefined) return;
        try {
          f.suggested_rewrite = await rewrite(content, f);
          f.rewrite_kind = f.element === 'copy' ? 'replacement' : 'guidance';
        } catch (err) {
          degraded.push(`rewrite:${f.policy_id}`);
          console.warn(
            `rewrite failed for ${f.policy_id}, returning finding without rewrite:`,
            message(err),
          );
        }
      }),
    );
  });
  debug('rewrite', {
    rewritten: findings.filter((f) => f.suggested_rewrite).length,
    degraded: degraded.length,
  });

  return {
    id: randomUUID(),
    findings,
    elements_analyzed: elements,
    model_version: MODEL_REASONING,
    corpus_version: corpusVersion(),
    duration_ms: Date.now() - started,
    diagnostics: {
      step_timings_ms: timings,
      findings_emitted: findingsEmitted,
      citation_drops: citationDrops,
      parent_rule_redirects: parentRuleRedirects,
      explanation_spans_total: spansTotal,
      explanation_spans_grounded: spansGrounded,
      degraded,
    },
  };
}
