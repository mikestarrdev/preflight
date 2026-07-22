import { config } from 'dotenv';
config({ path: '.env.local' });

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { supabaseAdmin } from '../lib/db';
import { embeddingInput } from '../lib/rag/chunk';
import { embedTexts } from '../lib/rag/embed';
import type { PolicyChunk } from '../lib/types';

const PARSED_DIR = 'data/parsed';
const MANIFEST_PATH = 'data/corpus-version.json';
const UPSERT_BATCH = 100;

async function main() {
  const files = readdirSync(PARSED_DIR).filter((f) => f.endsWith('.json'));
  if (files.length === 0) {
    console.error(`no parsed documents in ${PARSED_DIR}/ — run scripts/scrape-policies.ts first`);
    process.exit(1);
  }

  const chunks: PolicyChunk[] = files.flatMap((f) =>
    JSON.parse(readFileSync(join(PARSED_DIR, f), 'utf8')),
  );
  console.log(`${chunks.length} chunks from ${files.length} documents`);

  console.log('embedding...');
  const embeddings = await embedTexts(chunks.map(embeddingInput));

  const supabase = supabaseAdmin();
  console.log('upserting...');
  for (let i = 0; i < chunks.length; i += UPSERT_BATCH) {
    const batch = chunks.slice(i, i + UPSERT_BATCH).map((chunk, j) => ({
      ...chunk,
      embedding: embeddings[i + j],
    }));
    const { error } = await supabase.from('policy_chunks').upsert(batch);
    if (error) {
      console.error(`upsert failed at batch ${i / UPSERT_BATCH}:`, error.message);
      process.exit(1);
    }
  }

  // The manifest becomes corpus_version on AnalysisResult — eval numbers are
  // meaningless without knowing which corpus produced them.
  const sorted = [...chunks].sort((a, b) => a.id.localeCompare(b.id));
  const hash = createHash('sha256');
  for (const c of sorted) hash.update(c.id).update('\0').update(c.content).update('\0');
  const docs: Record<string, { chunks: number; fetched_at: string }> = {};
  for (const c of sorted) {
    docs[c.doc_slug] ??= { chunks: 0, fetched_at: c.fetched_at };
    docs[c.doc_slug].chunks += 1;
  }
  const manifest = {
    version: hash.digest('hex').slice(0, 12),
    created_at: new Date().toISOString(),
    total_chunks: chunks.length,
    docs,
  };
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`ok — corpus version ${manifest.version} (${chunks.length} chunks) → ${MANIFEST_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
