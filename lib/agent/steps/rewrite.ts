import { z } from 'zod';
import { cachedCallJSON } from '@/lib/agent/llm';
import type { Finding } from '@/lib/types';

const RewriteSchema = z.object({
  suggested_rewrite: z.string(),
});

const SYSTEM = `You rewrite non-compliant ad copy for paid social.

Given the original ad copy, a policy clause it violates, and why, produce a
rewrite of the ad copy that:
- removes the violation described,
- preserves the marketing intent, offer, and tone as much as possible,
- changes only what the violation requires; leave compliant parts intact,
- stays plausible as real ad copy (no disclaimers bolted on unless the clause requires one).

Respond with JSON only: {"suggested_rewrite": "..."}
No markdown fences, no commentary.`;

export async function rewrite(copy: string, finding: Finding): Promise<string> {
  const user = `Original ad copy:\n${copy}\n\nViolated clause (${finding.policy_id}):\n"${finding.clause_quote}"\n\nWhy it violates:\n${finding.explanation}`;
  const result = await cachedCallJSON('rewrite', {
    schema: RewriteSchema,
    system: SYSTEM,
    user,
  });
  return result.suggested_rewrite;
}
