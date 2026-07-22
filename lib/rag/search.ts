import { supabaseAdmin } from '@/lib/db';
import { embedText } from '@/lib/rag/embed';
import type { PolicyChunk, ScoredChunk } from '@/lib/types';

// Hybrid retrieval: pgvector cosine similarity and Postgres full-text search
// run in parallel, merged with Reciprocal Rank Fusion. Policy violations often
// turn on exact trigger words ("guaranteed", "cure", "before and after") that
// semantic search alone misses.

const CANDIDATES_PER_RETRIEVER = 20;
const RRF_K = 60;

export type SearchOptions = {
  platform?: string;
  k?: number;
  contentTypes?: string[];
};

type VectorRow = PolicyChunk & { similarity: number };
type TextRow = PolicyChunk & { rank: number };

export async function search(query: string, opts: SearchOptions = {}): Promise<ScoredChunk[]> {
  const { platform, k = 8, contentTypes } = opts;
  const supabase = supabaseAdmin();

  const embedding = await embedText(query);
  const [vectorRes, textRes] = await Promise.all([
    supabase.rpc('match_policy_chunks', {
      query_embedding: embedding,
      match_count: CANDIDATES_PER_RETRIEVER,
      filter_platform: platform ?? null,
      filter_content_types: contentTypes ?? null,
    }),
    supabase.rpc('search_policy_chunks_text', {
      query_text: query,
      match_count: CANDIDATES_PER_RETRIEVER,
      filter_platform: platform ?? null,
      filter_content_types: contentTypes ?? null,
    }),
  ]);
  if (vectorRes.error) throw new Error(`vector search: ${vectorRes.error.message}`);
  if (textRes.error) throw new Error(`text search: ${textRes.error.message}`);

  const vectorRows = (vectorRes.data ?? []) as VectorRow[];
  const textRows = (textRes.data ?? []) as TextRow[];

  // Per-retriever scores are kept so a retrieval miss can be diagnosed as a
  // keyword miss vs a semantic miss.
  const merged = new Map<string, ScoredChunk>();
  vectorRows.forEach((row, i) => {
    const { similarity, ...chunk } = row;
    merged.set(row.id, {
      ...chunk,
      vector_score: similarity,
      text_score: null,
      fused_score: 1 / (RRF_K + i + 1),
      found_by: ['vector'],
    });
  });
  textRows.forEach((row, i) => {
    const { rank, ...chunk } = row;
    const existing = merged.get(row.id);
    if (existing) {
      existing.text_score = rank;
      existing.fused_score += 1 / (RRF_K + i + 1);
      existing.found_by.push('text');
    } else {
      merged.set(row.id, {
        ...chunk,
        vector_score: null,
        text_score: rank,
        fused_score: 1 / (RRF_K + i + 1),
        found_by: ['text'],
      });
    }
  });

  return [...merged.values()]
    .sort((a, b) => b.fused_score - a.fused_score)
    .slice(0, k);
}
