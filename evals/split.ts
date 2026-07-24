import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { EvalCase } from './types';

// Assigns each case a dev/holdout split, 70/30, stratified so both halves cover
// the same policy areas. Idempotent: a case that already has a split keeps it,
// and only unassigned cases are placed. That keeps the held-out set frozen as
// new cases (e.g. the Ad Library clean ads) are added later — the whole point of
// a held-out split is that it does not move under you.

const DATASET_DIR = 'evals/dataset';
const HOLDOUT_FRACTION = 0.3;

// Stratum: violating cases by the policy doc they target, clean cases by their
// primary tag. Balances flag/clean and policy area across the two halves.
function stratum(c: EvalCase): string {
  if (c.expected.should_flag && c.expected.policy_ids.length > 0) {
    const parts = c.expected.policy_ids[0].split(':');
    return `flag:${parts[1] ?? parts[0]}`;
  }
  return `clean:${c.tags[0] ?? 'general'}`;
}

// Stable, decorrelated ordering so which cases land in holdout does not track
// case-id ordering.
function hashRank(id: string): string {
  return createHash('sha256').update(id).digest('hex').slice(0, 12);
}

function main() {
  const files = readdirSync(DATASET_DIR).filter(
    (f) => f.endsWith('.jsonl') && !f.startsWith('parked'),
  );
  for (const f of files) {
    const path = join(DATASET_DIR, f);
    const lines = readFileSync(path, 'utf8')
      .split('\n')
      .filter((l) => l.trim().length > 0);
    const cases = lines.map((l) => JSON.parse(l) as EvalCase);

    const strata = new Map<string, number[]>();
    cases.forEach((c, i) => {
      const key = stratum(c);
      strata.set(key, [...(strata.get(key) ?? []), i]);
    });

    for (const indices of strata.values()) {
      const target = Math.round(HOLDOUT_FRACTION * indices.length);
      const alreadyHoldout = indices.filter((i) => cases[i].split === 'holdout').length;
      const unassigned = indices
        .filter((i) => cases[i].split === undefined)
        .sort((a, b) => hashRank(cases[a].id).localeCompare(hashRank(cases[b].id)));
      const needed = Math.max(0, Math.min(target - alreadyHoldout, unassigned.length));
      const holdout = new Set(unassigned.slice(0, needed));
      for (const i of unassigned) {
        cases[i].split = holdout.has(i) ? 'holdout' : 'dev';
      }
    }

    writeFileSync(path, cases.map((c) => JSON.stringify(c)).join('\n') + '\n');
    const dev = cases.filter((c) => c.split === 'dev').length;
    const held = cases.filter((c) => c.split === 'holdout').length;
    console.log(`${basename(f)}: ${cases.length} cases -> ${dev} dev / ${held} holdout`);
  }
}

main();
