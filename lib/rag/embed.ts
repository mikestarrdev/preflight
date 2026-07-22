import OpenAI from 'openai';

// Anthropic doesn't serve an embeddings endpoint; OpenAI is used for
// embeddings only. Reasoning and vision stay on Claude (lib/claude.ts).
export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIMS = 1536;

const BATCH_SIZE = 100;

// Built lazily, not at module load: scripts call dotenv's config() as their
// first statement, but bundler-driven import ordering doesn't guarantee this
// module evaluates after that call. Reading process.env inside the function
// call (as lib/db.ts's supabaseAdmin() already does) sidesteps that entirely.
let client: OpenAI | null = null;
function openaiClient(): OpenAI {
  client ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const openai = openaiClient();
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const res = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: batch,
    });
    for (const item of res.data) out.push(item.embedding);
  }
  return out;
}

export async function embedText(text: string): Promise<number[]> {
  const [embedding] = await embedTexts([text]);
  return embedding;
}
