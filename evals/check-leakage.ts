import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { PolicyChunk } from '../lib/types';
import type { EvalCase } from './types';

// Leakage check for the paraphrased tier. Tier 1 inputs are verbatim corpus
// substrings by construction; Tier 2 exists to measure generalization, so a
// paraphrase that still shares a distinctive word n-gram with a corpus chunk
// defeats its purpose. This flags any 4+ word overlap between a case's copy and
// the corpus so it can be rewritten. Not a pass/fail gate — a reviewer's tool.
//
// Usage: pnpm eval:leakage [file.jsonl]  (default: paraphrased.jsonl)

const DATASET_DIR = 'evals/dataset';
const PARSED_DIR = 'data/parsed';
const NGRAM_SIZES = [4, 5, 6];

function words(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

function ngrams(tokens: string[], n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i + n <= tokens.length; i++) out.push(tokens.slice(i, i + n).join(' '));
  return out;
}

function main() {
  const file = process.argv[2] ?? 'paraphrased.jsonl';

  const chunks: PolicyChunk[] = readdirSync(PARSED_DIR)
    .filter((f) => f.endsWith('.json'))
    .flatMap((f) => JSON.parse(readFileSync(join(PARSED_DIR, f), 'utf8')));

  // Every corpus n-gram -> the chunk ids it appears in.
  const corpus = new Map<string, Set<string>>();
  for (const c of chunks) {
    const toks = words(c.content);
    for (const n of NGRAM_SIZES) {
      for (const g of ngrams(toks, n)) {
        corpus.set(g, (corpus.get(g) ?? new Set()).add(c.id));
      }
    }
  }

  const cases = readFileSync(join(DATASET_DIR, file), 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as EvalCase);

  let flagged = 0;
  for (const c of cases) {
    const text = c.input.copy;
    if (!text) continue;
    const toks = words(text);
    const hits: { gram: string; chunks: string[] }[] = [];
    const seen = new Set<string>();
    for (const n of NGRAM_SIZES) {
      for (const g of ngrams(toks, n)) {
        const inChunks = corpus.get(g);
        // Skip shorter grams already covered by a longer overlap starting here.
        if (inChunks && !seen.has(g)) {
          hits.push({ gram: g, chunks: [...inChunks] });
          seen.add(g);
        }
      }
    }
    if (hits.length > 0) {
      flagged += 1;
      console.log(`\nLEAK ${c.id}`);
      console.log(`  copy: ${JSON.stringify(text)}`);
      for (const h of hits) console.log(`  shares "${h.gram}" with ${h.chunks.join(', ')}`);
    }
  }

  console.log(
    `\n${flagged}/${cases.length} cases share a 4+ word n-gram with the corpus` +
      (flagged === 0 ? ' — clean' : ' — rewrite these'),
  );
  if (flagged > 0) process.exit(1);
}

main();
