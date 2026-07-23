import { cached } from '@/lib/cache';
import { corpusVersion } from '@/lib/corpus';
import { EMBEDDING_MODEL } from '@/lib/rag/embed';
import { search } from '@/lib/rag/search';
import type { PolicyChunk } from '@/lib/types';
import type { Claim } from './classify';

const K_PER_QUERY = 8;
// Cap the merged set so adjudication prompts stay bounded.
const MAX_CHUNKS = 25;

export type RetrievedChunk = PolicyChunk & {
  fused_score: number; // best score across the queries that surfaced it
  surfaced_by: string[]; // claim ids, plus 'full_copy' for the whole-ad search
};

export type RetrievalQuery = { label: string; text: string };

export async function retrieve(
  content: string,
  claims: Claim[],
  extraQueries: RetrievalQuery[] = [],
): Promise<RetrievedChunk[]> {
  return cached(
    {
      step: 'retrieve',
      model: EMBEDDING_MODEL,
      corpus_version: corpusVersion(),
      // extra_queries joins the key only when present so Phase 2 copy-path
      // cache entries stay valid.
      input: {
        copy: content,
        claims: claims.map((c) => c.text),
        ...(extraQueries.length > 0 ? { extra_queries: extraQueries.map((q) => q.text) } : {}),
      },
    },
    async () => {
      // One search per claim, plus one on the full content to catch anything
      // claim extraction missed. Image and landing page elements add extra
      // queries (creative description, flag phrases, mismatch phrasings).
      const queries = [
        ...claims.map((c) => ({ label: c.id, text: c.text })),
        ...(content.trim().length > 0 ? [{ label: 'full_copy', text: content }] : []),
        ...extraQueries,
      ];
      const results = await Promise.all(
        queries.map((q) => search(q.text, { platform: 'meta', k: K_PER_QUERY })),
      );

      const merged = new Map<string, RetrievedChunk>();
      queries.forEach((q, i) => {
        for (const scored of results[i]) {
          const existing = merged.get(scored.id);
          if (existing) {
            existing.fused_score = Math.max(existing.fused_score, scored.fused_score);
            existing.surfaced_by.push(q.label);
          } else {
            merged.set(scored.id, {
              id: scored.id,
              platform: scored.platform,
              doc_slug: scored.doc_slug,
              doc_title: scored.doc_title,
              clause_path: scored.clause_path,
              heading_trail: scored.heading_trail,
              content: scored.content,
              content_type: scored.content_type,
              source_url: scored.source_url,
              fetched_at: scored.fetched_at,
              fused_score: scored.fused_score,
              surfaced_by: [q.label],
            });
          }
        }
      });

      return [...merged.values()]
        .sort((a, b) => b.fused_score - a.fused_score)
        .slice(0, MAX_CHUNKS);
    },
  );
}
