# Phase 4 — Dataset, measurement, iteration

**Goal:** turn the baseline into a defensible result. Fix the dataset so the numbers mean
something, set targets before you start optimizing, then iterate and record every change.

**Done when all four pass:**

1. Dataset is expanded and tiered, with leakage documented and quarantined rather than
   hidden.
2. A held-out split exists and is untouched until the final run.
3. Targets are hit on the held-out set, or missed with a written explanation of why.
4. `evals/REPORT.md` tells the full story: baseline, every iteration including the ones that
   failed, and final numbers per tier.

This phase is judged on the report, not the score. A 0.72 recall with an honest account of
how it was reached is worth more than a 0.95 that cannot be explained.

---

## 1. Set targets first

Write these into `evals/REPORT.md` **before** running anything. Setting a target after
seeing results is how people talk themselves into whatever number they got.

| Metric | Target | Rationale |
|---|---|---|
| Recall | ≥ 0.80 | A missed violation means the ad gets rejected anyway and the tool provided no value |
| False positive rate | ≤ 0.05 | A false flag costs the user a rewrite of a legal ad. Worse than useless, actively expensive |
| Citation accuracy | ≥ 0.98 | A citation that does not verify is a hallucination. This is the trust-destroying failure |
| Rewrite quality | ≥ 4.0 / 5 | Below this the rewrite is compliant but commercially unusable |

If you miss a target, say so and explain the tradeoff. Missing recall to protect the false
positive rate is a defensible product decision. Quietly moving the target is not.

---

## 2. Fix the dataset

The Phase 2 dataset has leakage: every input is a verbatim string that also exists in the
corpus, so retrieval finds the exact chunk trivially. The image tier has a related problem:
the fixtures were authored by the same person who designed the flag taxonomy.

Restructure into four tiers, each in its own file, each scored and reported separately.
Never merge them into one headline number.

### Tier 1 — `verbatim.jsonl` (existing, keep as-is)

The 44 Phase 2 cases. Retained as a regression check and as the floor. If a change breaks
these, it broke something basic. Label this tier explicitly as leaked and easy.

### Tier 2 — `paraphrased.jsonl` (new, target ~40 cases)

For each violating example in Tier 1, write two paraphrases that break the same rule without
reusing its wording. Same expected `policy_ids`.

- "Are you Christian?" becomes "Looking for a church home this Sunday? We think you'll fit
  right in here."
- "Are you bankrupt? Check out our services." becomes "Drowning in credit card bills? We can
  help you start over."

Rules for writing these:

- Generate candidates with the model, then **you** verify every label by reading the cited
  clause and confirming it actually governs the paraphrase. A dataset where the model wrote
  both the question and the answer measures nothing.
- No overlapping distinctive phrases with the source example. If the paraphrase shares a
  rare n-gram with the corpus chunk, rewrite it.
- Include hard negatives: paraphrases of the ✅ compliant examples that stay compliant. The
  personal attributes policy turns on subtle distinctions ("Meet Hispanic singles" is fine,
  "Meet other Hispanic singles" is not), and those near-misses are where false positives
  come from.

This tier is the one that measures generalization. Expect the numbers to be worse than Tier
1, and expect that gap to be one of the more interesting things in the report.

### Tier 3 — `realistic.jsonl` (new, target ~30 cases)

Full-length ad copy, the length and messiness real marketers write. Roughly 40 to 120 words,
with a hook, body, and call to action, where the violating span is embedded among compliant
text rather than standing alone.

- 20 with known violations, labeled with expected `policy_ids`.
- 10 clean ads pulled from Meta's Ad Library. These are currently running, therefore
  approved, therefore genuine ground truth for the false positive rate. Store the ad text
  with source URL and retrieval date. Do not store creatives.

The false positive rate on this tier is the number that matters most for the product, since
it is the only one measured against ads a human never wrote to be a test case.

### Tier 4 — `images.jsonl` (expand from 8 to ~20)

Current fixtures were designed around the system's own flag taxonomy. Expand with cases that
were not.

- Creatives where the violation lives in rendered text rather than composition, so the
  `flags` path cannot carry them.
- Creatives where a flag fires but the ad is compliant, for example a legitimate side by side
  product comparison that is not a before and after body shot. These test whether flags are
  being treated as evidence rather than verdicts.
- At least 5 clean controls.
- Still self-made. Do not scrape creatives into a public repo.

---

## 3. Held-out split

This is the piece that makes the whole result credible.

- Split each tier 70 / 30 into `dev` and `holdout`. Split by stratified random sample so
  both halves cover the same policy areas.
- Iterate against **dev only**. `pnpm eval` defaults to dev.
- `pnpm eval --holdout` is run at most twice: once at the start to establish a matched
  baseline, once at the very end.
- Record both dev and holdout numbers in the final report.

The reason: if you tune prompts against the same cases you report on, you have no way to
distinguish real improvement from fitting the test set. The gap between final dev and final
holdout numbers is itself a result worth reporting. A small gap means the changes generalized.
A large gap means you overfit, and saying so is more valuable than hiding it.

Enforce it in code. The runner should refuse to load holdout cases unless `--holdout` is
passed, so it cannot happen by accident.

---

## 4. Known issues to fix

### 4a. Citation targeting (the 0.14 recall)

Findings cite the near-identical ❌ example chunk rather than the governing rule. The
diagnosis and reasoning are already in `evals/REPORT.md`.

Implement the parent-rule resolution: when adjudication cites a chunk with `content_type`
of `example_violating` or `example_compliant`, walk up `clause_path` within the same document
to find the governing `rule` chunk, cite that, and attach the example as supporting context
in a new optional `Finding.supporting_example` field.

Try the retrieval-side weighting as a separate experiment, and report which worked better.
Two attempts with a comparison is a better story than one that happened to work.

### 4b. Explanation accuracy

The adjudicator sometimes misstates literal values from the ad ("$100" for a "$500" ad).
Citations are unaffected, but the explanation is what users read.

Fix by requiring the explanation to quote the offending span verbatim, then verifying that
span against the input in code, the same way `clause_quote` is verified. Drop or flag
explanations that fail. Add a fifth deterministic scorer, `explanation-grounding.ts`, and
report it.

---

## 5. Iteration protocol

Every change follows the same loop, and the loop is the thing being demonstrated:

1. Form a hypothesis about what is failing and why.
2. Change **one** thing.
3. Run `pnpm eval` on dev.
4. Record in `evals/REPORT.md`: what changed, the hypothesis, the before and after numbers,
   and whether it worked.
5. Keep it or revert it.

Record failed experiments. A report showing four changes where two helped, one did nothing,
and one made things worse is far more convincing than a clean upward march, because the
clean version reads as either luck or omission.

Use `--filter=<tag>` while iterating so you are not paying for full runs on every hypothesis.
Full runs at checkpoints only.

---

## 6. Cost control

The cache from Phase 2 keys on `{step, model, corpus_version, input}`. Prompt changes will
invalidate everything downstream of the changed step, which is correct but expensive.

- Run `--filter` subsets while iterating.
- Full dev run at checkpoints, not after every tweak.
- Track cumulative eval spend and report it in `REPORT.md`. Cost per eval run is a real
  engineering concern and showing you tracked it is a point in your favor.

---

## 7. The report

`evals/REPORT.md` is the primary deliverable of this project. Structure:

1. What the system does, in three sentences.
2. The four metrics, what each measures, and which user-facing failure mode it maps to.
3. Why three are deterministic and only rewrite quality uses a judge.
4. Dataset construction, including the tiers, why they exist, and the leakage problem
   quarantined in Tier 1.
5. The held-out methodology and why it is there.
6. Baseline numbers.
7. Iteration log: every change, hypothesis, result, kept or reverted.
8. Final numbers, per tier, dev and holdout side by side.
9. Known limitations and what you would do with more time.

Write it so a reader who has never seen the repo understands what was measured and why they
should believe it.

---

## Out of scope for Phase 4

No UI, no MCP server, no new input types, no corpus expansion to other platforms. Those are
Phase 5 or later.

Do not add features to raise a metric. If recall is short, fix the retrieval or the prompt.
Adding a keyword pre-filter that hardcodes trigger words would raise the number and hollow
out the result, since the point is a system that generalizes, not one that passes its own
test set.
