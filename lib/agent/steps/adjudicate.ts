import { z } from 'zod';
import { cachedCallJSON } from '@/lib/agent/llm';
import type { Element } from '@/lib/types';
import type { Claim } from './classify';
import type { RetrievedChunk } from './retrieve';

const AdjudicatedFindingSchema = z.object({
  policy_id: z.string(),
  severity: z.enum(['violation', 'risk', 'clear']),
  clause_quote: z.string(),
  explanation: z.string(),
  confidence: z.number().min(0).max(1),
  // 4b: the verbatim ad span the verdict rests on, verified downstream. Optional
  // in the schema so pre-4b cached adjudications (which never emit it) still
  // validate; the prompt only asks for it in the grounded variant.
  offending_span: z.string().optional(),
});

const AdjudicationSchema = z.object({
  findings: z.array(AdjudicatedFindingSchema),
});

export type AdjudicatedFinding = z.infer<typeof AdjudicatedFindingSchema>;

// The prompt is templated per element. Phase 4 (4b) added the offending_span
// requirement, which intentionally changed the prompt and invalidated the
// Phase 2/3 adjudication cache; the pre-4b baseline is preserved as recorded
// numbers in evals/REPORT.md rather than as reproducible cache entries.
const SUBJECT: Record<Element, { what: string; visible: string; label: string }> = {
  copy: {
    what: 'paid social ad copy',
    visible: 'the copy',
    label: 'Ad copy',
  },
  image: {
    what: 'a paid social ad creative, working from a vision model description of the image,',
    visible: 'the image',
    label: 'Ad creative (vision model description of the image)',
  },
  landing_page: {
    what: "paid social ad claims that the ad's landing page fails to deliver",
    visible: 'the ad or page',
    label: 'Ad claims not delivered by the landing page',
  },
};

const system = (element: Element) => `You adjudicate ${SUBJECT[element].what} against retrieved policy clauses.

For each retrieved clause that is relevant to the ad, emit a finding:
{
  "findings": [
    {
      "policy_id": "...",       // id of the clause, copied exactly from the provided set
      "severity": "violation" | "risk" | "clear",
      "clause_quote": "...",    // the specific sentence(s) of the clause the verdict rests on
      "explanation": "...",     // why this ad does or does not breach this clause, referencing the ad's own wording
      "offending_span": "...",  // for "violation"/"risk": the exact words from the ad above that breach the clause, verbatim; "" for "clear"
      "confidence": 0.0-1.0     // confidence in the VERDICT, not the severity level
    }
  ]
}

Severity definitions:
- "violation": the ad clearly breaks the cited clause as written.
- "risk": the ad plausibly breaks the clause, or the verdict depends on context not visible in ${SUBJECT[element].visible} (targeting settings, landing page content, certification or licensing status, viewer age).
- "clear": the clause was retrieved as potentially relevant, but the ad does not breach it. Emit these too — they are needed for measurement and are filtered downstream.

Hard rules:
- Cite only policy_id values from the provided clause set. Never invent an id, never use outside knowledge of platform policy.
- "clause_quote" must be copied verbatim, character for character, from the cited clause's text. Paraphrasing, summarizing, or stitching separate sentences together is a failure: findings with quotes that are not exact substrings of the cited clause are discarded.
- Quote only the part of the clause that supports the verdict, not the entire clause.
- For "violation" and "risk" findings, "offending_span" must be copied verbatim, character for character, from the ad shown above: the exact words that breach the clause. It is verified against the ad the same way clause_quote is verified against the policy, and a span that is not an exact substring is dropped. Quote only the offending words, not the whole ad. Use "" for "clear" findings.
- If no clause in the set is relevant to any part of the ad, return {"findings": []}.

Respond with the JSON object only. No markdown fences, no commentary.`;

export async function adjudicate(
  content: string,
  claims: Claim[],
  chunks: RetrievedChunk[],
  element: Element,
): Promise<AdjudicatedFinding[]> {
  const claimsBlock = claims
    .map((c) => `- ${c.id} [${c.type}]: ${c.text}`)
    .join('\n');
  const chunksBlock = chunks
    .map(
      (c) =>
        `<clause id="${c.id}">\nSection: ${c.heading_trail.join(' > ')}\n${c.content}\n</clause>`,
    )
    .join('\n\n');

  const user = `${SUBJECT[element].label}:\n${content}\n\nExtracted claims:\n${claimsBlock || '(none extracted)'}\n\nRetrieved policy clauses:\n${chunksBlock}`;

  const result = await cachedCallJSON('adjudicate', {
    schema: AdjudicationSchema,
    system: system(element),
    user,
    maxTokens: 8000,
  });
  return result.findings;
}
