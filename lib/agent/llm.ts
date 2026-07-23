import { z } from 'zod';
import { cached } from '@/lib/cache';
import { MODEL_REASONING, callJSON } from '@/lib/claude';
import { corpusVersion } from '@/lib/corpus';

// callJSON wrapped in the file cache. The cache key includes the full prompt
// text, so editing a step's prompt invalidates that step's entries and nothing
// else — which is exactly what Phase 4 prompt iteration needs.
export async function cachedCallJSON<T>(
  step: string,
  opts: {
    schema: z.ZodType<T>;
    system: string;
    user: string;
    maxTokens?: number;
    model?: string;
  },
): Promise<T> {
  const model = opts.model ?? MODEL_REASONING;
  const value = await cached(
    {
      step,
      model,
      corpus_version: corpusVersion(),
      input: { system: opts.system, user: opts.user },
    },
    () => callJSON({ ...opts, model }),
  );
  // Cached values come from disk; re-validate so a stale entry fails loudly.
  return opts.schema.parse(value);
}
