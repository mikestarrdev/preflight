# Phase 1 — Policy corpus and retrieval

**Goal:** a queryable Meta advertising policy corpus with working hybrid retrieval, proven
from a CLI script. No UI, no agent loop, no Claude calls yet except where noted.

**Done when:** running `pnpm tsx scripts/query.ts "before and after weight loss photo"`
returns the Meta clauses that actually govern that, with verbatim text and a working deep
link, in under a second.

---

## 1. Project setup

- `pnpm create next-app` — TypeScript, App Router, Tailwind, ESLint, src-less layout
  (`app/` at root)
- Dependencies: `@anthropic-ai/sdk`, `openai`, `@supabase/supabase-js`, `zod`, `cheerio`,
  `playwright`, `tsx`, `dotenv`
- `.env.example` with: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`
- `lib/types.ts` — paste the `Finding` / `AnalysisResult` types from `CLAUDE.md` verbatim.
  Define these now even though nothing consumes them until Phase 2.
- `lib/claude.ts` — client init plus exported model constants:
  ```ts
  export const MODEL_REASONING = 'claude-sonnet-4-6';
  export const MODEL_VISION = 'claude-sonnet-4-6';
  ```

---

## 2. Database schema

Enable pgvector in Supabase, then:

```sql
create extension if not exists vector;

create table policy_chunks (
  id            text primary key,          -- stable: {platform}:{doc_slug}:{clause_path}
  platform      text not null default 'meta',
  doc_slug      text not null,             -- e.g. 'personal-attributes'
  doc_title     text not null,
  clause_path   text not null,             -- e.g. '2.1.3' or heading breadcrumb
  heading_trail text[] not null,           -- ancestor headings, outermost first
  content       text not null,             -- verbatim clause text
  content_type  text not null,             -- 'rule' | 'example_compliant' | 'example_violating' | 'definition'
  source_url    text not null,             -- deep link, with #anchor where available
  fetched_at    timestamptz not null,
  embedding     vector(1536),
  tsv           tsvector generated always as (to_tsvector('english', content)) stored
);

create index on policy_chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);
create index on policy_chunks using gin (tsv);
create index on policy_chunks (platform, doc_slug);
```

`content_type` matters: Meta's policy pages include explicit compliant / non-compliant
examples. Those become labeled eval cases in Phase 4 — tag them correctly now so they can be
extracted later without re-scraping.

---

## 3. Scraper — `scripts/scrape-policies.ts`

Target Meta's Advertising Standards. Start with the highest-rejection-rate policies:

- Personal attributes
- Misleading claims / deceptive practices
- Health, body image, and weight loss
- Adult content and nudity
- Prohibited and restricted content (alcohol, tobacco, weapons, supplements, financial
  products, crypto)
- Unacceptable business practices
- Circumventing systems
- Landing page / destination requirements

Behavior:

- Playwright for pages that render client-side; cheerio for static ones. Detect and fall
  back automatically.
- Write raw HTML to `data/raw/{doc_slug}.html` with a fetch timestamp. Never re-scrape
  during development — parse from disk. Only `--refresh` re-fetches.
- Emit `data/parsed/{doc_slug}.json` matching the `policy_chunks` shape minus the embedding.
- Polite: 1 req/sec, real user agent, respect robots.

Scraping is brittle. Log per-document chunk counts and fail loudly if a document yields
zero chunks — silent partial corpora are the failure mode that will quietly wreck the eval
numbers in Phase 4.

---

## 4. Clause chunking — `lib/rag/chunk.ts`

Follow document structure, not token counts.

- Split on headings and list/clause boundaries. Each chunk keeps its full `heading_trail`
  so context isn't lost.
- Target 200–600 tokens. If a clause exceeds 600, split on sentence boundaries and mark the
  parts with a shared `clause_path` prefix so they can be re-joined at retrieval time.
- Never split a rule from its immediately attached exception or example — if a clause is
  followed by "For example:" or "This does not apply when…", it stays in the chunk.
- Detect example blocks and tag `content_type` as `example_compliant` or
  `example_violating` (Meta typically marks these with explicit do/don't language or
  paired columns).
- Prepend the heading trail to the text used for embedding (not to `content`, which stays
  verbatim for citation).

---

## 5. Ingest — `scripts/ingest.ts`

- Read `data/parsed/*.json`
- Embed with `text-embedding-3-small`, batched (100 per request), on the
  heading-trail-prefixed text
- Upsert to `policy_chunks` by `id` so re-ingest is idempotent
- Write a corpus manifest to `data/corpus-version.json`: chunk count per doc, fetch dates,
  and a content hash. This becomes `corpus_version` on `AnalysisResult` — eval numbers are
  meaningless without knowing which corpus produced them.

---

## 6. Hybrid search — `lib/rag/search.ts`

```ts
search(query: string, opts?: {
  platform?: string;
  k?: number;              // default 8
  contentTypes?: string[];
}): Promise<ScoredChunk[]>
```

- Run in parallel: pgvector cosine similarity (top 20) and Postgres full-text `ts_rank`
  (top 20)
- Merge with Reciprocal Rank Fusion (`1/(60+rank)` summed per chunk), dedupe by id, return
  top `k`
- Return each chunk with its individual vector score, text score, fused score, and which
  retriever(s) found it. This is worth the small extra effort — Phase 4 will need to
  diagnose *why* retrieval missed something, and per-retriever scores are how you tell a
  keyword miss from a semantic miss.

---

## 7. Verification — `scripts/query.ts`

CLI: takes a query string, prints ranked results with doc title, clause path, first ~200
chars, scores, and source URL.

Sanity queries that must return sensible clauses before Phase 1 is done:

1. `"before and after weight loss photo"` → body image / health policies
2. `"are you struggling with debt"` → personal attributes
3. `"guaranteed results in 30 days"` → misleading claims
4. `"fake play button on image"` → deceptive/circumvention
5. `"CBD gummies"` → restricted content

If any of these return unrelated clauses, fix chunking or the query construction before
moving to Phase 2. Do not paper over a retrieval problem with prompt engineering later —
that's the mistake that makes the whole eval story unconvincing.

---

## Out of scope for Phase 1

No API route, no UI, no Claude reasoning calls, no vision, no landing page fetching, no
eval harness. Those are Phases 2–5.
