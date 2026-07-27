# Phase 5 — Ship it

**Goal:** a stranger can use the app, read the repo, and understand what was built and why,
without talking to you.

**Done when all four pass:**

1. A deployed URL where someone can paste an ad and get findings back.
2. A README that leads with the engineering and links to the eval report.
3. The repo is public, clean, and the history reads as real work.
4. MCP server, if time allows. It is the only droppable item in this phase.

Nothing here changes the pipeline. If you find yourself editing `lib/agent/`, stop.

---

## 1. Frontend

One page. Resist every instinct to add more.

`app/page.tsx`:

- A textarea for ad copy
- An image upload (drag or click), optional
- A URL field for the landing page, optional
- One Analyze button, disabled until at least one input has content
- Results below

**Results rendering.** Group findings by severity, violations first, then risk, then a
collapsed section for clear. Each finding shows:

- Severity badge
- The offending span from the ad, quoted
- The policy clause quoted verbatim, with the document title and a link to `source_url`
- The explanation
- The rewrite, labeled by `rewrite_kind`: replacement text renders as a copyable block,
  guidance renders as prose

The clause quote and its source link are the most important thing on the page. That is the
product's actual differentiator over every competitor, so make it visually prominent rather
than a footnote under the explanation.

**Loading state matters here.** A full analysis takes 30 to 60 seconds. A spinner for that
long reads as broken. Stream or poll the step names from the orchestrator: classifying,
retrieving policies, checking claims, drafting rewrites. If streaming is more work than it
looks, a static ordered list with the current step highlighted is fine. The point is that
the multi-step pipeline is visible, which is also the thing you want a reviewer to notice.

**Empty state.** Three example ads as one-click fills, drawn from the realistic tier: one
clear violation, one borderline, one clean. A reviewer with no ad copy handy should be able
to see the system work in two clicks. Use cases from the dataset so the output is known-good.

**Styling.** Tailwind, neutral, dense. This is a tool, not a landing page. No hero section,
no marketing copy, no feature grid. Read `/mnt/skills/public/frontend-design/SKILL.md` if
available before writing components.

**Do not build:** accounts, history, saved analyses, settings, dark mode toggle, analytics.

---

## 2. Rate limiting and cost protection

The app is public and every analysis costs money. Before deploying:

- Rate limit the analyze endpoint by IP, something like 5 per hour. In-memory is acceptable
  for a demo; note the limitation in the README.
- Keep the existing 5MB image cap and 10MB request cap.
- A daily spend ceiling in the route, read from an env var, returning a clear "demo limit
  reached" message rather than failing obscurely.

This is not optional. A public endpoint calling a paid API with no ceiling is the kind of
thing that turns into a bill.

---

## 3. Deploy

- Vercel, connected to the GitHub repo.
- Set the Vercel function region to Singapore (`sin1`) to match the Supabase region, so the
  app is not calling a Singapore database from Virginia.
- Environment variables: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`. Do not set `DATABASE_URL` in production; it is a local dev
  tool only.
- Confirm the analyze route's function timeout is long enough for a full pipeline run.
  Vercel's default will not be.
- Add the deployed URL to the GitHub repo's website field.

Smoke test the deployment with all three input types before calling it done.

---

## 4. README

This is what a reviewer reads. Structure, in order:

**Title and one line.** What it does, plainly.

**The eval numbers, immediately.** A compact table: recall, false positive rate, noise rate,
citation accuracy, per tier, dev and holdout. Then a single sentence pointing at
`evals/REPORT.md` for methodology. Leading with measurement rather than features is the
entire positioning of this project.

Include the noise rate in that table, not just the false positive rate. The 100% noise rate
on realistic clean ads is a real finding and burying it would undercut the credibility of
everything else. A reader who finds it themselves in section 8 after the README implied
perfection trusts you less, not more.

**How it works.** The pipeline as a short diagram or list: classify, retrieve, adjudicate,
verify, rewrite. Two paragraphs on the design decisions worth defending: hybrid retrieval
because policy violations turn on exact trigger words that semantic search misses, and
citation verification in code because a model asserting it quoted a policy is not the same
as having quoted it.

**The corpus.** What was scraped, how it was chunked, why clause-level rather than fixed
windows.

**Evals.** Four tiers, why they exist, what the held-out split is for, and the honest note
that Tier 1 is leaked by construction and kept as a floor.

**Stack.** Short list.

**Running it locally.** Clone, env vars, schema, ingest, dev server. Someone should be able
to follow it without asking you anything.

**Limitations.** Pull the short version from `evals/REPORT.md` section 9. Meta only, hedging
calibration, small holdout tiers.

No marketing language. No "revolutionary" or "powerful." A reviewer can tell the difference
between a README written for engineers and one written for a launch post.

---

## 5. REPORT.md addition

Add a summary table at the very top of `evals/REPORT.md`, above section 1: recall, FP at the
violation threshold, and noise rate, per tier, dev and holdout, with one sentence noting that
the leaked verbatim tier is not evidence of generalization. Everything already exists in
section 8; this is so a skimmer sees the tradeoff without reading nine sections to find it.

Do not restructure the rest. It is good as it is.

---

## 6. MCP server (drop this first if time runs out)

`mcp/server.ts`. A thin wrapper over the existing analyze pipeline, exposing one tool:

```
check_ad(copy?: string, image_path?: string, url?: string) -> findings
```

- Use the official MCP TypeScript SDK, stdio transport.
- Reuse `lib/agent/orchestrator.ts` directly. No reimplementation.
- Return findings as readable text, not raw JSON, since the consumer is a chat interface.
- Document the Claude Desktop config JSON in the README so someone can actually run it.

Why it is worth building if there is time: job postings name MCP explicitly, almost no
portfolio has one, and it is a day's work at most on top of an API that already exists.

---

## 7. Final repo pass

- `git ls-files` shows no `.env`, no `.cache/`, no `data/raw/`.
- README links resolve, including the deployed URL.
- A fresh clone installs and typechecks.
- Repo description and topics set on GitHub: `rag`, `llm`, `ai-agents`, `evals`, `claude`,
  `pgvector`, `nextjs`, `typescript`.
- Commit history is clean, human-sounding messages, no AI attribution trailers.

---

## Out of scope

No new features, no new input types, no additional platforms, no prompt tuning, no further
eval iterations. The measurement is frozen. This phase is about making what exists legible
to someone who was not here while it was built.
