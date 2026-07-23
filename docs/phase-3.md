# Phase 3 — Image creatives and landing pages

**Goal:** the same pipeline accepts two more input types. An uploaded creative and a landing
page URL each produce text that flows into the existing classify → retrieve → adjudicate →
verify → rewrite loop.

**Done when all three pass:**

1. `pnpm analyze --image ./fixtures/before-after.jpg` returns findings citing the health and
   body image clauses, with verified verbatim quotes.
2. `pnpm analyze --copy "..." --url https://example.com` returns at least one finding when
   the ad promises something the landing page does not deliver.
3. `pnpm eval` still runs green on the Phase 2 dataset with no regression in the four
   baseline metrics. Record the re-run in `evals/REPORT.md` even if nothing moved.

Nothing in this phase changes the agent loop. If you find yourself editing
`orchestrator.ts` beyond adding element handling, stop and re-read this spec.

---

## 1. Vision input

`lib/inputs/vision.ts`

```ts
export async function describeCreative(image: {
  data: string;        // base64
  mediaType: string;   // image/jpeg | image/png | image/webp
}): Promise<CreativeDescription>
```

Output schema:

```ts
{
  rendered_text: string[];        // every piece of text visible IN the image, verbatim
  subjects: string[];             // people, products, objects present
  composition: string;            // one or two sentences on layout
  flags: {
    split_or_comparison: boolean; // side-by-side or before/after framing
    ui_elements: string[];        // fake play button, close X, checkbox, progress bar
    body_focus: boolean;          // close focus on body parts or physique
    prohibited_products: string[];// alcohol, tobacco, vape, weapon, pill, supplement
    graphic_content: boolean;
  };
  description: string;            // neutral paragraph, used as the retrieval query
}
```

Design notes:

- `rendered_text` is the highest-value field. Meta applies text policies to words inside the
  image exactly as it does to ad copy, and marketers routinely forget this. Each extracted
  string is passed into claim classification as if it were copy.
- `flags` exist because some violations are visual rather than linguistic. A before/after
  photo with no text at all still breaks policy, and no amount of semantic search over a
  neutral description will reliably surface that. The booleans give retrieval something
  concrete to key on.
- `description` must be neutral and descriptive, not judgmental. It is a retrieval query,
  not a verdict. "Two side by side photos of a person's torso" is correct. "An inappropriate
  weight loss ad" is not, because it presupposes the answer the pipeline is supposed to
  reach.
- Use `MODEL_VISION` from `lib/claude.ts`, temperature 0, Zod validated, through `callJSON`.
- Cache on SHA-256 of the image bytes. Vision calls are the most expensive step in the
  pipeline and eval runs will hit the same fixtures repeatedly.

### Wiring into the loop

`rendered_text` entries become claims with `element: 'image'`. The `description` plus any
true `flags` become an additional retrieval query. Findings carry `element: 'image'`.

For flags, map each to a short retrieval phrase rather than passing the boolean directly.
`split_or_comparison: true` should search for before and after imagery language.
`ui_elements: ['fake play button']` should search for deceptive functionality language.
Keep the mapping in a small table in code so it is legible and testable.

---

## 2. Landing page input

`lib/inputs/landing-page.ts`

```ts
export async function fetchLandingPage(url: string): Promise<LandingPageContent>
```

Behavior:

- Validate the URL. Reject non-http(s), private and loopback addresses, and anything
  resolving to a local network range. This is a public app accepting user-supplied URLs, so
  server side request forgery protection is not optional.
- 10 second timeout, single retry, no redirect chains longer than 5.
- Playwright if the page needs rendering, plain fetch plus cheerio otherwise. The scraper
  from Phase 1 already has this fallback pattern, reuse it.
- Extract title, meta description, visible body text, and any obvious pricing or offer text.
  Strip navigation, footer, and cookie banners.
- Truncate body text to roughly 4000 tokens, keeping the top of the page, since that is
  where offers live.

Failure must degrade. A page that times out, blocks the request, or requires login returns
a result with `fetched: false` and a reason. The run continues with copy and image analysis
and the response notes the landing page could not be checked. Never fail the whole analysis
because a URL was unreachable.

---

## 3. Claim mismatch check

`lib/agent/steps/mismatch.ts`. This runs only when both ad copy and landing page content are
present.

Input: the claims extracted from the ad, plus the landing page content.

Output:

```ts
Array<{
  claim_id: string;
  status: 'supported' | 'unsupported' | 'contradicted';
  evidence: string;    // verbatim span from the landing page, or empty
  reasoning: string;
}>
```

`unsupported` and `contradicted` results are converted into retrieval queries and passed
through adjudication like any other claim, producing findings with
`element: 'landing_page'`.

Retrieval target note: Meta reorganized its ad standards and there is no longer a standalone
destination or landing page policy page. The governing clauses now live in **Unacceptable
Business Practices** and **Fraud, Scams and Deceptive Practices**, both of which are already
in the corpus. Do not add a new document for this.

Keep the scope narrow. This step checks whether the ad promises something the page does not
deliver. It is not a general audit of the landing page.

---

## 4. Rewrite for non-copy elements

`rewrite.ts` currently produces replacement text. Extend it so the output type depends on the
element:

- `copy` — a compliant replacement string, unchanged from Phase 2.
- `image` — textual guidance describing what to change. Do not attempt to generate or edit
  an image. "Replace the side by side comparison with a single product photo" is the shape.
- `landing_page` — guidance on either softening the ad claim or adding the missing support
  to the page, whichever is the smaller change.

Add a `rewrite_kind: 'replacement' | 'guidance'` field to `Finding` so the UI in Phase 5 can
render them differently. This is the only change to the core type in this phase.

---

## 5. Entry points

`scripts/analyze.ts` gains flags:

```
pnpm analyze --copy "text"
pnpm analyze --image ./path/to.jpg
pnpm analyze --url https://example.com
```

Any combination, at least one required. Multiple elements analyze in a single run and return
one `AnalysisResult` with findings across all elements.

`app/api/analyze/route.ts` accepts `{ copy?, image?, url? }` where `image` is base64. Enforce
a request size limit of 10MB and reject images above 5MB. Return 400 with a clear message if
all three are absent.

---

## 6. Eval additions

Do not build the full image dataset here. That is Phase 4. Build only enough to prove the
scoring path works on non-copy elements.

- Unpark the image example lines that Phase 2's seed generator skipped, the ones describing
  a creative rather than quoting ad text. Meta's tobacco page has several. They are labels
  without images, so they cannot be scored directly, but they name the expected policy and
  become the labels for fixtures you supply.
- Create `evals/fixtures/` with six to eight images you make yourself. Simple mockups are
  fine and preferable to scraped creatives, since they avoid copyright questions in a public
  repo. Cover: a before and after comparison, a fake play button overlay, text in image
  making an outcome promise, a visible alcohol product, and two clean controls.
- Extend the dataset schema so `input` accepts `{ copy?, image_path?, url? }`. The runner
  loads image fixtures from disk and base64 encodes them.
- The four existing scorers work unchanged on image cases. Do not write new ones.

Re-run the Phase 2 dataset after all changes and confirm no regression. Record both the
copy-only numbers and the new image numbers separately in `evals/REPORT.md`. Do not merge
them into a single headline figure, since the tiers measure different things.

---

## Out of scope for Phase 3

No UI, no MCP server, no prompt tuning to improve scores, no expansion of the copy dataset,
no paraphrase generation, no Ad Library sampling. Those are Phases 4 and 5.

The temptation in this phase is to start fixing the 0.14 recall once you see it again in the
re-run. Do not. Phase 4 exists for that, and it needs an unmodified baseline to measure
against.
