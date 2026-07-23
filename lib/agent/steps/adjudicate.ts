import { z } from 'zod';
import { cachedCallJSON } from '@/lib/agent/llm';
import type { Claim } from './classify';
import type { RetrievedChunk } from './retrieve';

const AdjudicatedFindingSchema = z.object({
  policy_id: z.string(),
  severity: z.enum(['violation', 'risk', 'clear']),
  clause_quote: z.string(),
  explanation: z.string(),
  confidence: z.number().min(0).max(1),
});

const AdjudicationSchema = z.object({
  findings: z.array(AdjudicatedFindingSchema),
});

export type AdjudicatedFinding = z.infer<typeof AdjudicatedFindingSchema>;

const SYSTEM = `You adjudicate paid social ad copy against retrieved policy clauses.

For each retrieved clause that is relevant to the ad, emit a finding:
{
  "findings": [
    {
      "policy_id": "...",       // id of the clause, copied exactly from the provided set
      "severity": "violation" | "risk" | "clear",
      "clause_quote": "...",    // the specific sentence(s) of the clause the verdict rests on
      "explanation": "...",     // why this ad does or does not breach this clause, referencing the ad's own wording
      "confidence": 0.0-1.0     // confidence in the VERDICT, not the severity level
    }
  ]
}

Severity definitions:
- "violation": the ad clearly breaks the cited clause as written.
- "risk": the ad plausibly breaks the clause, or the verdict depends on context not visible in the copy (targeting settings, landing page content, certification or licensing status, viewer age).
- "clear": the clause was retrieved as potentially relevant, but the ad does not breach it. Emit these too — they are needed for measurement and are filtered downstream.

Hard rules:
- Cite only policy_id values from the provided clause set. Never invent an id, never use outside knowledge of platform policy.
- "clause_quote" must be copied verbatim, character for character, from the cited clause's text. Paraphrasing, summarizing, or stitching separate sentences together is a failure: findings with quotes that are not exact substrings of the cited clause are discarded.
- Quote only the part of the clause that supports the verdict, not the entire clause.
- If no clause in the set is relevant to any part of the ad, return {"findings": []}.

Respond with the JSON object only. No markdown fences, no commentary.`;

export async function adjudicate(
  copy: string,
  claims: Claim[],
  chunks: RetrievedChunk[],
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

  const user = `Ad copy:\n${copy}\n\nExtracted claims:\n${claimsBlock || '(none extracted)'}\n\nRetrieved policy clauses:\n${chunksBlock}`;

  const result = await cachedCallJSON('adjudicate', {
    schema: AdjudicationSchema,
    system: SYSTEM,
    user,
    maxTokens: 8000,
  });
  return result.findings;
}
