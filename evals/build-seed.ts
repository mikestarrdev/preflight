import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PolicyChunk } from '../lib/types';
import type { EvalCase } from './types';

// Seed dataset generator. The corpus already contains labeled ground truth:
// chunks tagged example_compliant (✅ lines) and example_violating (❌ lines),
// straight from Meta's policy pages. Each usable line becomes one eval case.

const PARSED_DIR = 'data/parsed';
const SEED_PATH = 'evals/dataset/seed.jsonl';
// Lines that describe an image rather than quote ad text are Phase 3 cases.
// Parked here; the runner skips parked-* files.
const PARKED_PATH = 'evals/dataset/parked-image-cases.jsonl';

// Meta's page has a copy-paste error at personal-attributes 2.8.1: the
// vulnerable-financial-status ✅ example shows a cancer sentence that also
// appears as a ❌ example in section 2.7. The label is not trustworthy.
const EXCLUDED_CHUNK_IDS = new Set(['meta:personal-attributes:2.8.1']);

const DQUOTE = /[“”"]/;

// Extract quotable ad copy from one example line (marker already stripped).
// Meta's example lines wrap real ad copy in quotes; unquoted lines are
// descriptions of patterns ("Text referencing or alluding to..."), not ad
// copy, and can't be run through the copy path. Extraction between the outer
// double quotes also strips Meta's own typos (the stray trailing character in
// the diabetes line, the doubled closing quote in the camp line), and the
// single-trailing-quote branch repairs the missing opening quote in the
// bankruptcy line.
function extractCopy(line: string): string | null {
  const idxs = [...line].reduce<number[]>((acc, ch, i) => {
    if (DQUOTE.test(ch)) acc.push(i);
    return acc;
  }, []);
  if (idxs.length >= 2 && idxs[0] === 0) {
    const inner = line
      .slice(1, idxs[idxs.length - 1])
      .replace(/^[“”"\s]+/, '')
      .replace(/[“”"\s]+$/, '');
    return inner.length > 1 ? inner : null;
  }
  if (idxs.length === 1 && idxs[0] === line.length - 1) {
    const inner = line.slice(0, -1).trim();
    return inner.length > 1 ? inner : null;
  }
  return null; // descriptive line, not quoted ad copy
}

// Walk up clause_path to the governing rule chunk. Exact parent first
// (tobacco 3.2.1 → 3.2). Where the scraper produced no parent chunk
// (personal-attributes 2.7.2 → no 2.7, no 2), fall back to the single rule
// chunk directly under the ancestor prefix (2 → 2.1).
function governingRule(chunk: PolicyChunk, byDoc: Map<string, PolicyChunk[]>): PolicyChunk | null {
  const siblings = byDoc.get(chunk.doc_slug) ?? [];
  const rules = siblings.filter((c) => c.content_type === 'rule');
  const segments = chunk.clause_path.split('.');
  while (segments.length > 1) {
    segments.pop();
    const prefix = segments.join('.');
    const exact = rules.find((r) => r.clause_path === prefix);
    if (exact) return exact;
    const under = rules.filter((r) => {
      const rest = r.clause_path.startsWith(`${prefix}.`)
        ? r.clause_path.slice(prefix.length + 1)
        : null;
      return rest !== null && !rest.includes('.');
    });
    if (under.length === 1) return under[0];
  }
  return null;
}

function main() {
  const files = readdirSync(PARSED_DIR).filter((f) => f.endsWith('.json'));
  if (files.length === 0) {
    console.error(`no parsed documents in ${PARSED_DIR}/ — run pnpm scrape first`);
    process.exit(1);
  }
  const chunks: PolicyChunk[] = files.flatMap((f) =>
    JSON.parse(readFileSync(join(PARSED_DIR, f), 'utf8')),
  );
  const byDoc = new Map<string, PolicyChunk[]>();
  for (const c of chunks) {
    byDoc.set(c.doc_slug, [...(byDoc.get(c.doc_slug) ?? []), c]);
  }

  const cases: EvalCase[] = [];
  const parked: EvalCase[] = [];
  let skippedDescriptive = 0;
  let skippedNoRule = 0;

  const examples = chunks.filter(
    (c) => c.content_type === 'example_compliant' || c.content_type === 'example_violating',
  );
  for (const chunk of examples) {
    if (EXCLUDED_CHUNK_IDS.has(chunk.id)) {
      console.warn(`excluding ${chunk.id}: untrustworthy label (Meta copy-paste error)`);
      continue;
    }
    const shouldFlag = chunk.content_type === 'example_violating';

    const lines = chunk.content
      .split('\n')
      .map((l) => l.replace(/^[✅❌]\s*/, '').trim())
      .filter((l) => l.length > 0);

    lines.forEach((line, i) => {
      const caseId = `meta-${chunk.doc_slug}-${chunk.clause_path}-${String.fromCharCode(97 + i)}`;

      if (/this image/i.test(line)) {
        parked.push({
          id: caseId,
          input: { copy: line },
          expected: { should_flag: shouldFlag, policy_ids: [], notes: 'image example, needs vision path' },
          source: 'meta_example',
          tags: [chunk.doc_slug.replace(/-/g, '_'), 'image'],
        });
        return;
      }

      const copy = extractCopy(line);
      if (copy === null) {
        skippedDescriptive += 1;
        return;
      }

      let policyIds: string[] = [];
      if (shouldFlag) {
        const rule = governingRule(chunk, byDoc);
        if (!rule) {
          console.warn(`no governing rule found for ${chunk.id}, skipping "${copy}"`);
          skippedNoRule += 1;
          return;
        }
        policyIds = [rule.id];
      }

      cases.push({
        id: caseId,
        input: { copy },
        expected: {
          should_flag: shouldFlag,
          policy_ids: policyIds,
          notes: chunk.heading_trail[chunk.heading_trail.length - 1],
        },
        source: 'meta_example',
        tags: [chunk.doc_slug.replace(/-/g, '_')],
      });
    });
  }

  cases.sort((a, b) => a.id.localeCompare(b.id));
  parked.sort((a, b) => a.id.localeCompare(b.id));
  writeFileSync(SEED_PATH, cases.map((c) => JSON.stringify(c)).join('\n') + '\n');
  writeFileSync(PARKED_PATH, parked.map((c) => JSON.stringify(c)).join('\n') + '\n');

  const flag = cases.filter((c) => c.expected.should_flag).length;
  console.log(`\n${cases.length} cases → ${SEED_PATH}`);
  console.log(`  should_flag: ${flag}, clean: ${cases.length - flag}`);
  console.log(`${parked.length} image cases parked → ${PARKED_PATH}`);
  console.log(`skipped: ${skippedDescriptive} descriptive lines, ${skippedNoRule} with no governing rule`);
}

main();
