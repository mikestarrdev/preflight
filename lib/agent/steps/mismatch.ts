import { z } from 'zod';
import { cachedCallJSON } from '@/lib/agent/llm';
import { normalizeForMatch } from '@/lib/agent/verify';
import type { FetchedLandingPage } from '@/lib/inputs/landing-page';
import type { Claim } from './classify';

// Checks whether the landing page delivers what the ad promises. Runs only
// when both ad copy and a fetched page are present. Deliberately narrow: it is
// not a general audit of the landing page.

const ClaimMismatchSchema = z.object({
  claim_id: z.string(),
  status: z.enum(['supported', 'unsupported', 'contradicted']),
  evidence: z.string(), // verbatim span from the landing page, or empty
  reasoning: z.string(),
});

const MismatchResponseSchema = z.object({
  results: z.array(ClaimMismatchSchema),
});

export type ClaimMismatch = z.infer<typeof ClaimMismatchSchema>;

const SYSTEM = `You check whether a landing page delivers what an ad promises.

Given claims extracted from ad copy and the text content of the ad's landing page, return JSON:
{
  "results": [
    {
      "claim_id": "...",     // id of the claim, copied exactly as provided
      "status": "supported" | "unsupported" | "contradicted",
      "evidence": "...",     // verbatim span from the landing page text, or "" if none
      "reasoning": "..."     // one or two sentences
    }
  ]
}

Status definitions:
- "supported": the landing page delivers or substantiates the claim.
- "unsupported": the landing page contains nothing that backs the claim.
- "contradicted": the landing page states something incompatible with the claim.

Hard rules:
- Return one result per claim, with claim_id copied exactly.
- "evidence" must be copied character for character from the landing page content. If no span is relevant, use "".
- Judge only whether the page delivers each claim. Do not report other problems with the page.
- Specific offers, prices, discounts, guarantees, and promised items or outcomes must actually appear on the page to count as supported. General product descriptions are supported by the page offering that product.

Respond with the JSON object only. No markdown fences, no commentary.`;

export async function checkClaims(
  claims: Claim[],
  page: FetchedLandingPage,
): Promise<ClaimMismatch[]> {
  const claimsBlock = claims.map((c) => `- ${c.id} [${c.type}]: "${c.text}"`).join('\n');
  const offersBlock = page.offer_text.length
    ? `Offer and pricing text:\n${page.offer_text.map((o) => `- ${o}`).join('\n')}\n\n`
    : '';
  const user = `Ad claims:\n${claimsBlock}\n\nLanding page (${page.final_url}):\nTitle: ${page.title}\nMeta description: ${page.meta_description}\n\n${offersBlock}Page text:\n${page.body_text}`;

  const result = await cachedCallJSON('mismatch', {
    schema: MismatchResponseSchema,
    system: SYSTEM,
    user,
    maxTokens: 6000,
  });

  // Enforced in code, not the prompt: evidence must be a verbatim span of the
  // page, and every claim_id must be one we sent.
  const knownIds = new Set(claims.map((c) => c.id));
  const haystack = normalizeForMatch(
    [page.title, page.meta_description, page.body_text, ...page.offer_text].join(' '),
  );
  const results = result.results.filter((r) => {
    if (!knownIds.has(r.claim_id)) {
      console.warn(`mismatch: dropped result for unknown claim id ${r.claim_id}`);
      return false;
    }
    return true;
  });
  for (const r of results) {
    if (r.evidence && !haystack.includes(normalizeForMatch(r.evidence))) {
      console.warn(`mismatch: evidence for ${r.claim_id} not found verbatim on page, cleared`);
      r.evidence = '';
    }
  }
  return results;
}

// The mismatch results as adjudication input for landing_page findings.
export function serializeMismatch(
  copy: string,
  page: FetchedLandingPage,
  problems: ClaimMismatch[],
  claimsById: Map<string, Claim>,
): string {
  const lines = problems.map((m) => {
    const claim = claimsById.get(m.claim_id);
    const evidence = m.evidence ? `\n  page evidence: "${m.evidence}"` : '';
    return `- ${m.claim_id} [${m.status}]: "${claim?.text ?? ''}"\n  reasoning: ${m.reasoning}${evidence}`;
  });
  return `Ad copy:\n${copy}\n\nLanding page: ${page.final_url} — "${page.title}"\n\nAd claims the landing page does not deliver:\n${lines.join('\n')}`;
}
