import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { cachedCallJSON } from '@/lib/agent/llm';
import { MODEL_REASONING } from '@/lib/claude';
import type { CaseRun } from '../types';

// LLM judge: does the rewrite remove the violation while preserving intent?
// The only non-deterministic scorer, used because "preserves marketing
// intent" genuinely can't be checked in code. Runs on a pinned model; the
// prompt lives in rewrite-judge-prompt.md so changes to it show up in git
// history. Only violation findings with a rewrite are judged.

export const JUDGE_MODEL = MODEL_REASONING;
const PROMPT_PATH = 'evals/scorers/rewrite-judge-prompt.md';

const JudgeSchema = z.object({
  score: z.number().int().min(1).max(5),
  reason: z.string(),
});

export type RewriteScore = {
  mean_score: number | null; // null when there was nothing to judge
  judged: number;
  judge_model: string;
};

export async function scoreRewrites(runs: CaseRun[]): Promise<RewriteScore> {
  const system = readFileSync(PROMPT_PATH, 'utf8');

  const items: { copy: string; clause: string; explanation: string; rewrite: string }[] = [];
  for (const r of runs) {
    if (r.result === null) continue;
    for (const f of r.result.findings) {
      // Replacement rewrites only: guidance (image/landing page findings) is
      // instructions, not ad copy, and this judge prompt can't grade it.
      if (f.severity === 'violation' && f.suggested_rewrite && f.rewrite_kind !== 'guidance') {
        items.push({
          copy: r.eval_case.input.copy ?? '',
          clause: f.clause_quote,
          explanation: f.explanation,
          rewrite: f.suggested_rewrite,
        });
      }
    }
  }
  if (items.length === 0) return { mean_score: null, judged: 0, judge_model: JUDGE_MODEL };

  const scores = await Promise.all(
    items.map(async (item) => {
      const user = `Original ad copy:\n${item.copy}\n\nViolated clause:\n"${item.clause}"\n\nWhy it violated:\n${item.explanation}\n\nSuggested rewrite:\n${item.rewrite}`;
      const judged = await cachedCallJSON('rewrite-judge', {
        schema: JudgeSchema,
        system,
        user,
        model: JUDGE_MODEL,
      });
      return judged.score;
    }),
  );

  return {
    mean_score: scores.reduce((a, b) => a + b, 0) / scores.length,
    judged: scores.length,
    judge_model: JUDGE_MODEL,
  };
}
