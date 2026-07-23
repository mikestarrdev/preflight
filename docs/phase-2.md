# Phase 2 — Agent loop, copy path, eval harness

**Goal:** paste ad copy, get back `Finding[]` with verified verbatim citations. Plus an eval
harness that runs a seed dataset and prints scores.

**Done when both pass:**

1. `pnpm analyze "Are you struggling with debt? Guaranteed results in 30 days!"` returns at
   least two findings, each citing a real clause, each `clause_quote` an exact substring of
   the chunk it names.
2. `pnpm eval` runs the seed dataset end to end and writes `evals/results/` plus a scores
   table to stdout.

This phase does not need to score *well*. It needs to score *at all*. The numbers it
produces are the "before" in your before/after story.

---

## 1. Model call helper

Extend `lib/claude.ts` with a single structured-output helper that every step uses.

```ts
export async function callJSON<T>(opts: {
  schema: z.ZodType<T>;
  system: string;
  user: string | Anthropic.ContentBlockParam[];
  maxTokens?: number;
  model?: string;
}): Promise<T>
```

Requirements:

- `temperature: 0` always. Non-negotiable, eval deltas are meaningless without it.
- Validate the response with the passed Zod schema.
- On parse or validation failure, retry **once** with the validation error appended to the
  user message. On second failure, throw with the raw response in the error.
- Never regex a model response.
- Log token usage per call behind a `DEBUG_TOKENS` env flag. You will want this when eval
  runs start costing money.

---

## 2. Cache

`lib/cache.ts`. File-backed, keyed by SHA-256 of `{step, model, corpus_version, input}`.

- Store under `.cache/` (gitignored).
- `get(key)` / `set(key, value)`, JSON values.
- Bypass with `NO_CACHE=1`.

This matters more than it looks. Phase 4 re-runs the eval suite many times while you change
prompts. Without a cache, unchanged steps get re-paid every run and you will start avoiding
re-runs, which defeats the point of having evals at all.

---

## 3. Agent steps

Each step is a separate module under `lib/agent/steps/`, independently callable, each with
its own Zod schema.

### 3a. `classify.ts`

Input: raw ad copy.
Output:

```ts
{
  vertical: string;              // free text, e.g. "debt relief", "supplements"
  restricted_categories: string[]; // e.g. ["financial_services", "health"]
  claims: Array<{
    id: string;                  // c1, c2, ...
    text: string;                // verbatim span from the ad
    type: 'assertion_about_viewer' | 'outcome_promise' | 'product_claim'
        | 'urgency' | 'targeting_signal' | 'other';
  }>;
}
```

A "claim" is any span that could independently trigger a policy. Split aggressively. "Are
you struggling with debt? Guaranteed results in 30 days!" is two claims, not one. Under-
splitting is the main failure mode here, because a claim that never gets extracted can never
be checked.

The claim `text` must be a verbatim substring of the input. Verify in code and drop claims
that aren't.

### 3b. `retrieve.ts`

For each claim, call `search()` from Phase 1 with the claim text. Also run one search on the
full ad copy to catch anything claim extraction missed.

- `k: 8` per claim.
- Merge all results, dedupe by chunk id, keep the best score per chunk.
- Cap the merged set at 25 chunks so adjudication prompts stay bounded.
- Return chunks with their ids and which claim(s) surfaced them.

### 3c. `adjudicate.ts`

Input: the ad copy, the extracted claims, and the retrieved chunks (id + heading trail +
verbatim content).

Output: `Finding[]` minus `suggested_rewrite`.

Prompt rules:

- The model may only cite `policy_id` values from the provided chunk set. No outside
  knowledge, no invented ids.
- `clause_quote` must be copied verbatim from the cited chunk. Instruct explicitly that
  paraphrasing is a failure.
- Severity definitions, be specific in the prompt:
  - `violation` — the ad clearly breaks the cited clause
  - `risk` — plausibly breaks it, or depends on context not visible in the copy
    (targeting, landing page, certification status)
  - `clear` — retrieved as potentially relevant but the ad does not breach it
- Return `clear` findings too. You need them for false-positive measurement, and the UI can
  filter them out.
- `confidence` is the model's confidence in the verdict, not the severity.

### 3d. Citation verification (in code, not the prompt)

After adjudication, for every finding:

1. Look up the chunk by `policy_id`. Missing id → drop the finding, log it.
2. Check `clause_quote` is an exact substring of that chunk's `content`, after normalizing
   whitespace and Unicode quote characters only. Not a substring → drop the finding, log it.
3. Count drops per run and expose the number.

This is the single most important piece of the phase. It converts "the model says it cited a
policy" into "the citation is verified against the corpus." It is also a deterministic,
free eval metric, no LLM judge needed. Do not implement it as a prompt instruction and hope.

### 3e. `rewrite.ts`

For each finding with severity `violation`, produce a compliant rewrite of the offending
span that preserves the marketing intent. Input is the ad copy, the offending claim, and the
cited clause. Skip `risk` and `clear`.

---

## 4. Orchestrator

`lib/agent/orchestrator.ts`. Runs classify → retrieve → adjudicate → verify → rewrite.

- Returns `AnalysisResult` from `lib/types.ts`, stamped with `model_version`,
  `corpus_version` (read from `data/corpus-version.json`), and `duration_ms`.
- Per-step timing recorded.
- Partial failure handling: rewrite failing must not lose the findings. Return findings
  without rewrites and note the degradation. Classify or adjudicate failing is fatal.
- Structured step logs behind `DEBUG_AGENT`.

---

## 5. Entry points

`app/api/analyze/route.ts` — POST `{ copy: string }` returns `AnalysisResult`. Validate the
body with Zod. No UI yet.

`scripts/analyze.ts` — CLI wrapper, `pnpm analyze "ad text"`, pretty-prints findings grouped
by severity with clause quotes and URLs. Remember `--env-file=.env.local` in the package
script.

---

## 6. Eval harness

Skeleton only. The full dataset is Phase 4. Build it now so every later change is measured.

### 6a. Dataset format

`evals/dataset/*.jsonl`, one case per line:

```json
{
  "id": "meta-pa-2.3.2-a",
  "input": { "copy": "Are you Christian?" },
  "expected": {
    "should_flag": true,
    "policy_ids": ["meta:personal-attributes:2.1"],
    "notes": "asserts religious attribute of viewer"
  },
  "source": "meta_example",
  "tags": ["personal_attributes"]
}
```

`policy_ids` is the set of clauses that *should* be cited. A finding citing any of them
counts as a hit.

### 6b. Seed dataset generator

`evals/build-seed.ts`. Your corpus already contains labeled ground truth: chunks tagged
`example_compliant` and `example_violating`, straight from Meta.

- For each `example_violating` chunk, emit a case per ❌ line with `should_flag: true`,
  `policy_ids` set to the governing rule chunk in the same section (walk up `clause_path`).
- For each `example_compliant` chunk, emit a case per ✅ line with `should_flag: false`.
- **Exclude `meta:personal-attributes:2.8.1`.** Meta's page has a copy-paste error there:
  the vulnerable-financial-status ✅ example shows a cancer sentence that also appears as a
  ❌ example in section 2.7. The label is not trustworthy. Hardcode the exclusion with a
  comment explaining why.
- Strip Meta's own typos in the example text (a stray trailing character in the diabetes
  line, a missing opening quote in the bankruptcy line).
- Skip lines that describe an image rather than quote ad text (e.g. "This image promotes an
  e-cigarette"). Those are Phase 3 cases. Tag and park them in a separate file.

Print how many cases were generated, split by flag/no-flag. Report the number.

### 6c. Scorers

`evals/scorers/`, each pure and independently testable.

| Scorer | Method | Metric |
|---|---|---|
| `recall.ts` | deterministic | of cases with `should_flag: true`, share where a finding cites an expected `policy_id` at `violation` or `risk` |
| `false-positive.ts` | deterministic | of cases with `should_flag: false`, share that produced any `violation` |
| `citation.ts` | deterministic | share of emitted findings whose `clause_quote` verifies as an exact substring |
| `rewrite.ts` | LLM judge | 1–5: does the rewrite remove the violation while preserving intent? Only on `violation` findings |

Three of four are deterministic. That is deliberate. Only reach for a judge where the
property genuinely can't be checked in code, and say so in the README, because "I used an
LLM judge only where necessary" is a stronger signal than using one everywhere.

The judge runs on a pinned model, recorded in the results, and its prompt lives in a
separate file so changes to it are visible in git history.

### 6d. Runner

`evals/run.ts`, `pnpm eval`.

- Loads all cases, runs the orchestrator on each, concurrency 4.
- Writes `evals/results/{timestamp}.json` with per-case results, aggregate scores,
  `model_version`, `corpus_version`, and total cost/duration.
- Prints a summary table.
- `--filter=<tag>` to run a subset while iterating.
- Failures in one case must not kill the run. Record and continue.

---

## Out of scope for Phase 2

No vision, no landing page fetching, no UI, no MCP server, no prompt tuning to chase better
numbers. Get the first honest measurement, commit it, and stop. Optimization is Phase 4, and
it only counts if there's a recorded baseline to compare against.
