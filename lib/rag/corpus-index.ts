import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { PolicyChunk } from '@/lib/types';

// In-memory index over the parsed corpus (data/parsed/*.json). Used where the
// pipeline needs a chunk it may not have retrieved: the parent-rule resolution
// walks from a matched example chunk up to its governing rule, which retrieval
// does not always surface. Loaded once, lazily. build-seed.ts uses the same
// governingRule walk so the eval labels and the runtime resolution agree.

const PARSED_DIR = 'data/parsed';

let byId: Map<string, PolicyChunk> | null = null;
let byDoc: Map<string, PolicyChunk[]> | null = null;

function load(): void {
  if (byId) return;
  byId = new Map();
  byDoc = new Map();
  const files = readdirSync(PARSED_DIR).filter((f) => f.endsWith('.json'));
  if (files.length === 0) {
    throw new Error(`no parsed documents in ${PARSED_DIR}/ — run pnpm scrape first`);
  }
  for (const f of files) {
    const chunks: PolicyChunk[] = JSON.parse(readFileSync(join(PARSED_DIR, f), 'utf8'));
    for (const c of chunks) {
      byId.set(c.id, c);
      byDoc.set(c.doc_slug, [...(byDoc.get(c.doc_slug) ?? []), c]);
    }
  }
}

export function getChunk(id: string): PolicyChunk | undefined {
  load();
  return byId!.get(id);
}

// Walk up clause_path to the governing rule chunk. Exact parent first
// (tobacco 3.2.1 -> 3.2). Where the scraper produced no parent chunk
// (personal-attributes 2.7.2 -> no 2.7, no 2), fall back to the single rule
// chunk directly under the ancestor prefix (2 -> 2.1).
export function governingRule(chunk: PolicyChunk): PolicyChunk | null {
  load();
  const siblings = byDoc!.get(chunk.doc_slug) ?? [];
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
