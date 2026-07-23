import { z } from 'zod';
import { cachedCallJSON } from '@/lib/agent/llm';
import type { Finding } from '@/lib/types';

const RewriteSchema = z.object({
  suggested_rewrite: z.string(),
});

// Copy findings get a drop-in replacement; image and landing page findings get
// guidance, because generated text can't be the fix there. The copy prompt
// must stay byte-identical to Phase 2: cached rewrites and the recorded
// baseline depend on it.

const SYSTEM_COPY = `You rewrite non-compliant ad copy for paid social.

Given the original ad copy, a policy clause it violates, and why, produce a
rewrite of the ad copy that:
- removes the violation described,
- preserves the marketing intent, offer, and tone as much as possible,
- changes only what the violation requires; leave compliant parts intact,
- stays plausible as real ad copy (no disclaimers bolted on unless the clause requires one).

Respond with JSON only: {"suggested_rewrite": "..."}
No markdown fences, no commentary.`;

const SYSTEM_IMAGE = `You write remediation guidance for non-compliant paid social ad creatives.

Given a description of an ad image, a policy clause it violates, and why,
describe the smallest concrete change to the creative that removes the
violation:
- name the specific visual or text element to remove, replace, or change, and what to put in its place,
- preserve the marketing intent of the creative as much as possible,
- do not attempt to produce the new image; the output is direction a designer can follow,
- one to three sentences, in the shape of "Replace the side-by-side comparison with a single photo of the product."

Respond with JSON only: {"suggested_rewrite": "..."}
No markdown fences, no commentary.`;

const SYSTEM_LANDING_PAGE = `You write remediation guidance for ads whose claims are not delivered by their landing page.

Given the ad copy, the claims the landing page fails to deliver, the violated
clause, and why, recommend whichever is the smaller change:
- soften or remove the unsupported claim in the ad copy, quoting the replacement wording, or
- add the missing substantiation to the landing page, naming exactly what must appear there.

Pick one, be concrete, two sentences at most.

Respond with JSON only: {"suggested_rewrite": "..."}
No markdown fences, no commentary.`;

function promptFor(content: string, finding: Finding): { system: string; user: string } {
  const violation = `Violated clause (${finding.policy_id}):\n"${finding.clause_quote}"\n\nWhy it violates:\n${finding.explanation}`;
  switch (finding.element) {
    case 'copy':
      return { system: SYSTEM_COPY, user: `Original ad copy:\n${content}\n\n${violation}` };
    case 'image':
      return { system: SYSTEM_IMAGE, user: `Creative description:\n${content}\n\n${violation}` };
    case 'landing_page':
      // content already carries the ad copy and the undelivered claims
      return { system: SYSTEM_LANDING_PAGE, user: `${content}\n\n${violation}` };
  }
}

export async function rewrite(content: string, finding: Finding): Promise<string> {
  const { system, user } = promptFor(content, finding);
  const result = await cachedCallJSON('rewrite', {
    schema: RewriteSchema,
    system,
    user,
  });
  return result.suggested_rewrite;
}
