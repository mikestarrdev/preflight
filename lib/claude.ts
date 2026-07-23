import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

// Pinned snapshots, never evergreen pointers. Every model string in the
// codebase must come from here.
export const MODEL_REASONING = 'claude-sonnet-4-6';
export const MODEL_VISION = 'claude-sonnet-4-6';

// USD per million tokens for MODEL_REASONING. Used by the eval runner to
// report cost per run.
export const PRICE_PER_MTOK = { input: 3, output: 15 };

let _client: Anthropic | null = null;

export function anthropic(): Anthropic {
  if (!_client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
    _client = new Anthropic({ apiKey });
  }
  return _client;
}

// Process-wide token accounting so an eval run can report what it cost.
// Counts actual API calls only; cache hits add nothing.
const usage = { input_tokens: 0, output_tokens: 0, calls: 0 };

export function getUsage(): typeof usage {
  return { ...usage };
}

export function usageCostUSD(): number {
  return (
    (usage.input_tokens / 1_000_000) * PRICE_PER_MTOK.input +
    (usage.output_tokens / 1_000_000) * PRICE_PER_MTOK.output
  );
}

// Structured-output helper used by every agent step. Prompts for raw JSON,
// parses, validates with the given Zod schema. On parse or validation failure,
// retries once with the error appended to the user message; on second failure,
// throws with the raw response included. Never regex a model response.
export async function callJSON<T>(opts: {
  schema: z.ZodType<T>;
  system: string;
  user: string | Anthropic.ContentBlockParam[];
  maxTokens?: number;
  model?: string;
}): Promise<T> {
  const { schema, system, maxTokens = 4000, model = MODEL_REASONING } = opts;
  const client = anthropic();
  const baseContent: Anthropic.ContentBlockParam[] =
    typeof opts.user === 'string' ? [{ type: 'text', text: opts.user }] : opts.user;

  let feedback: string | null = null;
  let lastError = '';
  let raw = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const content = feedback
      ? [...baseContent, { type: 'text' as const, text: feedback }]
      : baseContent;
    const res = await client.messages.create({
      model,
      max_tokens: maxTokens,
      // Temperature 0 on every call: non-deterministic output makes eval
      // deltas meaningless.
      temperature: 0,
      system,
      messages: [{ role: 'user', content }],
    });
    usage.input_tokens += res.usage.input_tokens;
    usage.output_tokens += res.usage.output_tokens;
    usage.calls += 1;
    if (process.env.DEBUG_TOKENS) {
      console.error(
        `[tokens] in=${res.usage.input_tokens} out=${res.usage.output_tokens} model=${model}`,
      );
    }
    if (res.stop_reason === 'max_tokens') {
      throw new Error(`callJSON: response truncated at ${maxTokens} tokens — raise maxTokens`);
    }

    raw = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.trim());
    } catch (err) {
      lastError = `response was not valid JSON: ${err instanceof Error ? err.message : String(err)}`;
      feedback = `Your previous response failed: ${lastError}\nRespond again with a single valid JSON object and nothing else — no markdown fences, no commentary.`;
      continue;
    }
    const result = schema.safeParse(parsed);
    if (result.success) return result.data;
    lastError = z.prettifyError(result.error);
    feedback = `Your previous response failed schema validation:\n${lastError}\nRespond again with a single JSON object that fixes these errors. Same shape, corrected values.`;
  }
  throw new Error(`callJSON: failed after retry.\nlast error: ${lastError}\nraw response:\n${raw}`);
}
