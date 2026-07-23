import { z } from 'zod';
import { cachedCallJSON } from '@/lib/agent/llm';

const ClaimSchema = z.object({
  id: z.string(),
  text: z.string(),
  type: z.enum([
    'assertion_about_viewer',
    'outcome_promise',
    'product_claim',
    'urgency',
    'targeting_signal',
    'other',
  ]),
});

const ClassificationSchema = z.object({
  vertical: z.string(),
  restricted_categories: z.array(z.string()),
  claims: z.array(ClaimSchema),
});

export type Claim = z.infer<typeof ClaimSchema>;
export type Classification = z.infer<typeof ClassificationSchema>;

const SYSTEM = `You classify paid social ad copy for compliance review.

Given ad copy, return JSON with exactly these fields:
{
  "vertical": string,                 // what is being advertised, free text, e.g. "debt relief", "weight loss supplements"
  "restricted_categories": string[],  // regulated/restricted areas the ad touches, e.g. ["financial_services", "health"]
  "claims": [{ "id": "c1", "text": "...", "type": "..." }]
}

A claim is any span of the copy that could independently trigger an ad policy.
Split aggressively: a question addressed to the viewer and a promised outcome
are two claims even if they sit in one sentence. A claim that is never
extracted can never be checked, so over-splitting is safer than under-splitting.

Rules for claims:
- "text" must be copied verbatim from the ad copy, character for character. Never paraphrase, trim words, or fix typos.
- "id" values are c1, c2, c3, ... in order of appearance.
- "type" is one of: assertion_about_viewer (implies something about the viewer's traits or situation), outcome_promise (promises a result), product_claim (asserts something about the product/service), urgency (pressure to act now), targeting_signal (implies who the ad targets), other.

Respond with the JSON object only. No markdown fences, no commentary.`;

export async function classify(copy: string): Promise<Classification> {
  const result = await cachedCallJSON('classify', {
    schema: ClassificationSchema,
    system: SYSTEM,
    user: `Ad copy:\n${copy}`,
  });

  // A claim must be a verbatim substring of the input or it can't be traced
  // back to the copy. Enforced in code, not the prompt.
  const verbatim = result.claims.filter((c) => copy.includes(c.text));
  const dropped = result.claims.length - verbatim.length;
  if (dropped > 0) {
    console.warn(`classify: dropped ${dropped} claim(s) not found verbatim in the copy`);
  }
  return { ...result, claims: verbatim };
}
