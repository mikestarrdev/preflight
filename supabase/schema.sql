-- Run this in the Supabase SQL editor (or psql) once per project.
-- Idempotent: safe to re-run.

create extension if not exists vector;

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
  embedding     vector(1536),
  tsv           tsvector generated always as (to_tsvector('english', content)) stored
);

create index if not exists policy_chunks_embedding_idx
  on policy_chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);
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
  select
    c.id, c.platform, c.doc_slug, c.doc_title, c.clause_path, c.heading_trail,
    c.content, c.content_type, c.source_url, c.fetched_at,
    ts_rank(c.tsv, websearch_to_tsquery('english', query_text)) as rank
  from policy_chunks c
  where c.tsv @@ websearch_to_tsquery('english', query_text)
    and (filter_platform is null or c.platform = filter_platform)
    and (filter_content_types is null or c.content_type = any(filter_content_types))
  order by rank desc
  limit match_count;
$$;
