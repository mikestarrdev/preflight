# Preflight

Pre-flight compliance checking for paid social ads. Paste ad copy, upload a creative, or
point at a landing page — get back policy violations cited to the exact clause that was
broken, plus a compliant rewrite.

**v1 covers Meta (Facebook/Instagram) only.** The architecture is multi-platform from day
one (every corpus chunk carries a `platform` field); other platforms are a corpus ingest,
not a refactor.

---

## What this project is actually demonstrating

This is a portfolio project for AI engineering roles. The engineering story matters more
than the product story. Three things must be visible in the repo:

1. **Retrieval over a real, messy corpus** — hybrid search, clause-level chunking, verbatim
   citations back to source.
2. **A multi-step agent loop** — classify → retrieve → adjudicate → rewrite, with tool calls
   and structured state between steps. Not a single prompt.
3. **A real eval suite** — labeled dataset, automated scoring, recorded before/after numbers
   in `evals/REPORT.md`.

**The evals are not optional and are not a final polish step.** If scope has to be cut,
cut features, never evals. A working app with no eval numbers fails the purpose of this
project.

Non-goals for v1: user accounts, billing, multi-tenancy, an admin panel, batch processing,
a browser extension. Do not build these. Do not suggest building these.

---

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router), TypeScript strict |
| Hosting | Vercel |
| DB / vectors | Supabase Postgres + pgvector |
| Reasoning + vision | Claude API — `claude-sonnet-4-6` (pinned) |
| Embeddings | OpenAI `text-embedding-3-small` (1536 dims) |
| Styling | Tailwind |
| Scraping | Playwright for JS-rendered policy pages, plain fetch + cheerio otherwise |

Model IDs are pinned snapshots, never evergreen pointers. All model IDs live in
`lib/claude.ts` as exported constants — never inline a model string anywhere else.
Anthropic does not serve an embeddings endpoint; using OpenAI for embeddings only is
deliberate and does not change the "built on Claude" story.

---

## Architecture

```
input (copy | image | landing page URL)
  ↓ normalize      image → vision description; URL → fetched + cleaned text
  ↓ classify       vertical, ad category, extracted claims          [Claude → JSON]
  ↓ retrieve       hybrid search, per extracted claim               [pgvector + BM25]
  ↓ adjudicate     each (element × clause) → verdict + citation     [Claude → JSON]
  ↓ rewrite        compliant alternative per violation              [Claude]
  ↓ Finding[]
```

Each step is a separate module under `lib/agent/steps/`, independently callable and
independently testable. The orchestrator in `lib/agent/orchestrator.ts` owns sequencing,
state, retries, and partial-failure handling — a failed landing-page fetch must degrade
gracefully, not kill the run.

### Two design decisions to preserve

**Hybrid retrieval, not pure vector.** Policy violations often turn on exact trigger words
("guaranteed", "cure", "you", "before and after"). Semantic search alone misses literal
matches. Run pgvector similarity and Postgres full-text/BM25 in parallel, merge and
deduplicate by chunk id, keep the union.

**Chunk by policy clause, not fixed token windows.** Policies have natural clause
boundaries with exceptions attached. A fixed-size window splits a rule from its exception
and produces a citation that does not support the claim being made. Chunk boundaries follow
document structure (headings, list items, numbered clauses).

---

## The core type

Everything hangs off this. Define it before anything else; the eval scorers grade against
these fields.

```ts
export type Severity = 'violation' | 'risk' | 'clear';
export type Element = 'copy' | 'image' | 'landing_page';

export type Finding = {
  element: Element;
  severity: Severity;
  policy_id: string;        // stable id of the clause chunk
  clause_quote: string;     // VERBATIM text from the corpus — never paraphrased
  source_url: string;       // deep link to the policy page
  explanation: string;      // why this ad element violates this clause
  confidence: number;       // 0-1
  suggested_rewrite?: string;
};

export type AnalysisResult = {
  id: string;
  findings: Finding[];
  elements_analyzed: Element[];
  model_version: string;
  corpus_version: string;   // hash/date of the ingested corpus
  duration_ms: number;
};
```

`clause_quote` must be copied verbatim from the retrieved chunk, never generated. If the
model cannot produce an exact substring match against the retrieved chunk, drop the finding
rather than emitting an unverifiable citation. Enforce this in code, not in the prompt.

---

## Repo layout

```
├── app/
│   ├── page.tsx
│   └── api/analyze/route.ts
├── lib/
│   ├── agent/
│   │   ├── orchestrator.ts
│   │   └── steps/{classify,retrieve,adjudicate,rewrite}.ts
│   ├── inputs/{vision,landing-page}.ts
│   ├── rag/{chunk,embed,search}.ts
│   ├── claude.ts
│   ├── cache.ts
│   └── types.ts
├── scripts/{scrape-policies,ingest}.ts
├── evals/
│   ├── dataset/*.jsonl
│   ├── scorers/{recall,false-positive,citation,rewrite}.ts
│   ├── run.ts
│   ├── results/
│   └── REPORT.md
├── mcp/server.ts
├── docs/phase-*.md
└── CLAUDE.md
```

---

## Conventions

- **Temperature 0** on every model call. Non-deterministic output makes eval deltas
  meaningless.
- **Cache by content hash** (`lib/cache.ts`) on vision descriptions and analysis results.
  Eval runs get re-run many times; without a cache the cost discourages iteration, which
  defeats the point of having evals.
- **Structured output**: every Claude step returns JSON validated with Zod. Never regex a
  model response. On parse failure, retry once with the validation error appended, then
  fail loudly.
- **No secrets in the repo.** `.env.local` only; `.env.example` documents required keys.
- **This repo is public.** No API keys, no scraped content dumps that could raise IP
  questions — store policy text with its source URL and fetch date, and keep the scraper
  reproducible so the corpus can be rebuilt rather than shipped.
- Typed end to end. `any` requires a comment justifying it.

---

## Phase map

Build in order. Each phase has a spec in `docs/`. Do not start a phase before its spec
exists; do not skip ahead to UI work.

| Phase | Scope | Doc |
|---|---|---|
| 1 | Policy corpus: scrape, clause-chunk, embed, hybrid retrieval, verified by CLI | `docs/phase-1.md` |
| 2 | Agent loop + copy path end-to-end + eval harness skeleton | `docs/phase-2.md` |
| 3 | Vision path (creatives) + landing page fetch and claim-mismatch check | `docs/phase-3.md` |
| 4 | Eval dataset build, full scoring run, iterate on prompts/chunking, record before/after | `docs/phase-4.md` |
| 5 | Frontend, deploy, README with eval numbers, MCP server | `docs/phase-5.md` |

The eval harness lands in Phase 2, before the extra input surfaces, so every later change is
measured rather than eyeballed.

---

## Working agreement

- Read this file and the current phase doc before writing code.
- Implement the phase in the doc. Do not scope-creep into later phases.
- When a decision in this file conflicts with something you'd otherwise do, follow this file
  or flag the conflict explicitly — don't silently deviate.
- Prefer boring, legible code. This repo will be read by hiring managers.

## Git

This repo is public and serves as a portfolio piece. The commit history gets read.

- Write commit messages a human would write. Short, plain, specific.
- Subject line under 60 chars, imperative mood: "add clause chunker", not
  "Added clause chunker" or "feat(rag): implement clause-based chunking strategy".
- Body only when the why isn't obvious from the diff. Most commits don't need one.
- No em dashes, no emoji, no AI-tell phrasing ("comprehensive", "robust",
  "leverages", "seamlessly").
- No Claude Code attribution or co-author trailers.
- Commit at logical units of work, not one giant dump per phase. A reviewer
  should be able to follow how the project was built.
