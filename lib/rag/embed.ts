import OpenAI from 'openai';

// Anthropic doesn't serve an embeddings endpoint; OpenAI is used for
// embeddings only. Reasoning and vision stay on Claude (lib/claude.ts).
export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIMS = 1536;

const BATCH_SIZE = 100;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function embedTexts(texts: string[]): Promise<number[][]> {
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
