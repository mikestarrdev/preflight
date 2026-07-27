# Preflight

Pre-flight compliance checking for paid social ads. Paste ad copy, upload a creative, or
point at a landing page — get back policy findings cited to the exact clause that was
broken, plus a compliant rewrite.

*v1 covers Meta (Facebook/Instagram) only. Every corpus chunk carries a `platform` field,
so another platform is a corpus ingest, not a refactor.*

## Results

Four eval tiers, dev / holdout, at the frozen system described in `evals/REPORT.md`:

| Tier | Recall | FP rate | Noise rate | Citation accuracy |
|---|---|---|---|---|
| Verbatim (leaked — floor only) | 1.00 / 1.00 | 0.00 / 0.00 | 27% / 0% | 1.00 / 1.00 |
| Paraphrased | 1.00 / 1.00 | 0.00 / 0.00 | 46% / 60% | 0.98 / 0.96 |
| Realistic | 1.00 / 1.00 | 0.17 / 0.00 | 100% / 100% | 0.98 / 0.96 |
| Images | 1.00 / 1.00 | 0.00 / 0.00 | 25% / 50% | 0.99 / 1.00 |

FP rate counts only confident `violation` findings on a compliant ad. **Noise rate is
stricter** — any `violation` *or* `risk` finding on a compliant ad — and it is not a typo:
the model hedges to `risk` often enough that most compliant near-miss ads in the realistic
tier draw at least a yellow flag. That is a real finding, not a bug in the table, and it is
the main thing to know before trusting the recall numbers above it.

Full methodology, targets, the iteration log, and what didn't work are in
[`evals/REPORT.md`](evals/REPORT.md). The verbatim tier's inputs are lifted verbatim from
the corpus, so retrieval finds them trivially — it is kept as a regression floor, not
evidence that the system generalizes; paraphrased and realistic are.

## How it works

```
input (copy | image | landing page URL)
  → normalize      image → vision description; URL → fetched + cleaned text
  → classify       vertical, ad category, extracted claims          [Claude]
  → retrieve       hybrid search, per extracted claim               [pgvector + full-text]
  → adjudicate     each (element × clause) → verdict + citation     [Claude]
  → verify         citation checked against the corpus, in code
  → rewrite        compliant alternative per violation              [Claude]
```

**Retrieval is hybrid, not pure vector.** pgvector cosine similarity and Postgres
full-text search run in parallel and get merged by chunk id, keeping the union. Policy
violations often turn on exact trigger words — "guaranteed", "cure", "before and after" —
that semantic search alone can under-rank; full-text search catches the literal match that
embedding similarity sometimes misses.

**Citation verification happens in code, not the prompt.** Every finding's `clause_quote`
is checked as a verbatim substring of the chunk it cites before it's ever returned. A model
asserting that it quoted a policy is not the same as having quoted it, and asking nicely in
the prompt is not verification. If the quote doesn't match exactly, the finding is dropped
rather than shown with a citation that doesn't hold up (`lib/agent/verify.ts`) — which is
exactly what the eval suite's citation-accuracy metric is measuring.

## The corpus

Scraped from Meta's public Ad Standards and Restricted Goods pages (17 documents — health &
wellness, financial services, personal attributes, alcohol, weapons, and more) with
`scripts/scrape-policies.ts`, stored with source URL and fetch date, then chunked with
`lib/rag/chunk.ts`. Chunk boundaries follow the document's own structure — headings,
numbered clauses, list items — instead of a fixed token window, because policies routinely
attach an exception to a rule in the next line or two; a fixed-size window can split the two
apart and produce a citation that doesn't actually support the claim being made. Every chunk
keeps its heading trail, a content type (rule / compliant example / violating example /
definition), and a `platform` field.

Raw and parsed policy text are not committed (`data/raw/`, `data/parsed/` are gitignored),
so the repo doesn't ship a scraped content dump. The scraper is polite (1 req/s) and
reproducible, so the corpus rebuilds from source rather than needing to be shipped.

## Evals

Four tiers, in `evals/dataset/`, scored separately rather than blended into one number,
because they measure different things:

- **Verbatim** (44 cases) — Meta's own ✅/❌ example lines. Leaked by construction; kept as
  a regression floor, not generalization evidence.
- **Paraphrased** (40 cases) — the same violations reworded, plus hard negatives that stay
  compliant despite looking similar. Near-miss false positives live here.
- **Realistic** (31 cases) — full ad copy with a hook, body, and CTA, the violation embedded
  in otherwise-compliant text. 11 of these are real ads pulled from Meta's Ad Library rather
  than authored as test cases, and carry the tier's false-positive signal as a result.
- **Images** (21 cases) — creatives, including cases deliberately built outside the vision
  step's own flag taxonomy, so a flag can't be mistaken for a verdict.

Each tier is split 70/30 into dev and holdout once and frozen. Iteration happens against dev
only; holdout is touched at most twice — once for a baseline, once at the end — enforced in
the runner rather than left to discipline. The gap between dev and holdout is reported
because a small gap means a change generalized and a large one means it didn't; averaging
that away would hide the more useful of the two numbers.

## Stack

Next.js 15 (App Router) / TypeScript, Supabase Postgres + pgvector, Claude
(`claude-sonnet-4-6`, reasoning and vision) via the Anthropic API, OpenAI
`text-embedding-3-small` for embeddings, Tailwind, Playwright for JS-rendered policy pages.

## Running it locally

```sh
pnpm install
cp .env.example .env.local   # fill in ANTHROPIC_API_KEY, OPENAI_API_KEY, SUPABASE_URL,
                              # SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL
pnpm db:push                 # apply supabase/schema.sql
pnpm scrape                  # fetch + parse Meta ad policies -> data/parsed/
pnpm ingest                  # embed + upsert -> policy_chunks
pnpm dev                     # http://localhost:3000
```

Optional, from the CLI:

```sh
pnpm query "before and after weight loss photo"              # sanity-check retrieval
pnpm analyze --copy "lose 30 pounds in 30 days, guaranteed"  # run the full pipeline
pnpm eval                                                     # score against evals/dataset
```

## MCP server

`mcp/server.ts` is a thin wrapper over the same `analyze()` pipeline the API route calls,
exposed as one MCP tool over stdio:

```
check_ad(copy?: string, image_path?: string, url?: string) -> findings, as readable text
```

No separate implementation — it imports `lib/agent/orchestrator.ts` directly, so a finding
from the MCP tool and a finding from the web app are produced by the same code. Run it
standalone with `pnpm mcp`, or point a client at it. For Claude Desktop, add to
`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "preflight": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/preflight/mcp/server.ts"]
    }
  }
}
```

Replace the path with your clone's location and restart Claude Desktop. The server pins its
own working directory to the project root on startup, so it resolves `.env.local` and the
corpus manifest correctly regardless of the client's cwd.

## Limitations

- **Meta only.** Every chunk carries a `platform` field and retrieval filters on it, so
  another platform is an ingest, not a refactor — it just isn't in this corpus yet.
- **The model hedges.** On paraphrased violations only 22% of findings land at `violation`
  rather than `risk`; on compliant near-misses the noise rate runs 25-100% across tiers even
  though the false-positive rate at the `violation` threshold is much lower. See the
  eval report's severity-mix section for what that looks like case by case.
- **One hedged claim crossed the line.** On the realistic dev split, one compliant ad's
  hedged financial claim was called a confident `violation` (1/6 clean cases) — the one
  miss against the false-positive target.
- **Holdout tiers are small** (5-13 cases), so a single case moves a tier's number by
  several points. Treat holdout as a generalization check, not a precise estimate.
- **Grounding is inherently soft for visual-only violations** — an image with no text has
  no verbatim span for the explanation to quote.
- **Some labels are authored, not independently sourced.** Tier 2 and half of tier 3 were
  written to test a specific rule, then verified against it; a second human read is the
  remaining step. The other half of tier 3 (11 Meta Ad Library ads) is independently
  sourced.
- **The public demo's rate limit and daily spend ceiling are in-memory** — per-instance,
  best-effort, and reset on redeploy or cold start. Fine for a portfolio demo, not a
  production control.
