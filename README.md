# Preflight

Pre-flight compliance checking for paid social ads. Paste ad copy, upload a creative, or
point at a landing page — get back policy violations cited to the exact clause that was
broken, plus a compliant rewrite.

v1 covers Meta (Facebook/Instagram). The corpus schema is multi-platform; adding another
platform is an ingest, not a refactor.

## How it works

```
input (copy | image | landing page URL)
  ↓ normalize      image → vision description; URL → fetched + cleaned text
  ↓ classify       vertical, ad category, extracted claims          [Claude]
  ↓ retrieve       hybrid search, per extracted claim               [pgvector + full-text]
  ↓ adjudicate     each (element × clause) → verdict + citation     [Claude]
  ↓ rewrite        compliant alternative per violation              [Claude]
```

Retrieval is hybrid because policy violations often turn on exact trigger words
("guaranteed", "cure", "before and after") that semantic search alone misses. The corpus
is chunked by policy clause, not fixed token windows, so a rule is never separated from
its exception and every citation quotes the clause verbatim with a link to the source.

## Status

Phase 1 of 5: policy corpus and retrieval. The scraper, clause chunker, ingest pipeline,
and hybrid search are in place. Agent loop, vision, evals, and UI are later phases —
see `docs/`.

## Stack

Next.js 15 / TypeScript, Supabase Postgres + pgvector, Claude (reasoning + vision),
OpenAI embeddings, Playwright.

## Running the corpus pipeline

```sh
pnpm install
cp .env.example .env.local   # fill in keys
# apply supabase/schema.sql in the Supabase SQL editor
pnpm scrape                  # fetch + parse Meta ad policies → data/parsed/
pnpm ingest                  # embed + upsert → policy_chunks
pnpm query "before and after weight loss photo"
```

Scraped policy text stays out of the repo; the scraper is reproducible and polite
(1 req/s, parses from disk after the first fetch).
