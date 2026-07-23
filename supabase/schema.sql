-- Run this in the Supabase SQL editor (or psql) once per project.
-- Idempotent: safe to re-run. Re-running also adopts the text-search config
-- below, so an existing project is fixed by re-applying this file (no reingest
-- needed -- tsv is regenerated from the stored content).

create extension if not exists vector;

-- Text-search config for the full-text leg of hybrid search.
--
-- The stock `english` config does two things: it stems (good -- "guaranteed"
-- should match "guarantee") and it strips a stop-word list (bad here). The
-- policy trigger words this leg exists to catch include stop words -- "you",
-- "before and after" -- so `english` silently dropped them, and the full-text
-- leg matched nothing for exactly the queries it was added for. A snowball
-- dictionary with no StopWords option stems without dropping anything.
do $$
begin
  if not exists (select 1 from pg_ts_dict where dictname = 'english_stem_nostop') then
    create text search dictionary english_stem_nostop (
      template = snowball,
      language = english
      -- no StopWords: keep every lexeme
    );
  end if;
  if not exists (select 1 from pg_ts_config where cfgname = 'english_nostop') then
    create text search configuration english_nostop (copy = english);
    alter text search configuration english_nostop
      alter mapping for asciiword, asciihword, hword_asciipart, word, hword, hword_part
      with english_stem_nostop;
  end if;
end
$$;

create table if not exists policy_chunks (
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
  embedding     vector(1536)
);

-- Full-text column, kept in sync with content by the generator. Dropped and
-- re-added on every run so re-applying this file adopts the current config;
-- a generated column's expression can't be altered in place before PG17.
-- Backfills instantly at this corpus size, no reingest required.
alter table policy_chunks drop column if exists tsv;
alter table policy_chunks
  add column tsv tsvector
  generated always as (to_tsvector('english_nostop', content)) stored;

-- No vector index: at this corpus size (hundreds of chunks) exact search is
-- fast and avoids approximate-recall loss. Add an hnsw index if the corpus
-- grows past ~10k chunks.
create index if not exists policy_chunks_tsv_idx
  on policy_chunks using gin (tsv);
create index if not exists policy_chunks_platform_doc_idx
  on policy_chunks (platform, doc_slug);

-- Vector leg of hybrid search. Called via supabase.rpc from lib/rag/search.ts.
create or replace function match_policy_chunks(
  query_embedding vector(1536),
  match_count int default 20,
  filter_platform text default null,
  filter_content_types text[] default null
)
returns table (
  id text,
  platform text,
  doc_slug text,
  doc_title text,
  clause_path text,
  heading_trail text[],
  content text,
  content_type text,
  source_url text,
  fetched_at timestamptz,
  similarity float
)
language sql stable
as $$
  select
    c.id, c.platform, c.doc_slug, c.doc_title, c.clause_path, c.heading_trail,
    c.content, c.content_type, c.source_url, c.fetched_at,
    1 - (c.embedding <=> query_embedding) as similarity
  from policy_chunks c
  where c.embedding is not null
    and (filter_platform is null or c.platform = filter_platform)
    and (filter_content_types is null or c.content_type = any(filter_content_types))
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

-- Full-text leg of hybrid search.
--
-- Terms are OR'd, not AND'd. websearch_to_tsquery/plainto_tsquery both AND
-- their terms, which requires every query word to appear in one chunk; clauses
-- are short single rules, so a multi-word query ("before and after weight loss
-- photo") almost never has all terms in one clause and the leg returned
-- nothing. OR lets a chunk match on any term and ts_rank orders by how many/how
-- strongly it matched -- which is what the fusion step wants.
--
-- The tsquery is built from the query's own lexemes (to_tsvector -> lexemes ->
-- to_tsquery) rather than by string-substitution, so raw punctuation in the
-- query can't inject tsquery operators or throw a syntax error.
create or replace function search_policy_chunks_text(
  query_text text,
  match_count int default 20,
  filter_platform text default null,
  filter_content_types text[] default null
)
returns table (
  id text,
  platform text,
  doc_slug text,
  doc_title text,
  clause_path text,
  heading_trail text[],
  content text,
  content_type text,
  source_url text,
  fetched_at timestamptz,
  rank real
)
language sql stable
as $$
  with q as (
    select to_tsquery('english_nostop', string_agg(lexeme, ' | ')) as tsq
    from unnest(to_tsvector('english_nostop', query_text))
  )
  select
    c.id, c.platform, c.doc_slug, c.doc_title, c.clause_path, c.heading_trail,
    c.content, c.content_type, c.source_url, c.fetched_at,
    ts_rank(c.tsv, q.tsq) as rank
  from policy_chunks c, q
  where q.tsq is not null
    and c.tsv @@ q.tsq
    and (filter_platform is null or c.platform = filter_platform)
    and (filter_content_types is null or c.content_type = any(filter_content_types))
  order by rank desc
  limit match_count;
$$;
