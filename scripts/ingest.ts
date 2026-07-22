import { config } from 'dotenv';
config({ path: '.env.local' });

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { supabaseAdmin } from '../lib/db';
import { embeddingInput } from '../lib/rag/chunk';
import { EMBEDDING_DIMS, embedTexts } from '../lib/rag/embed';
import type { PolicyChunk } from '../lib/types';

const PARSED_DIR = 'data/parsed';
const MANIFEST_PATH = 'data/corpus-version.json';
const UPSERT_BATCH = 20;
const BATCH_TIMEOUT_MS = 30_000;

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

  // A malformed embedding (wrong length, NaN/Infinity from a truncated API
  // response) won't necessarily surface as a Supabase error — pgvector may
  // reject it in a way that reads as a hang under load. Check before sending.
  embeddings.forEach((vec, i) => {
    if (vec.length !== EMBEDDING_DIMS) {
      console.error(`embedding ${i} (${chunks[i].id}) has ${vec.length} dims, expected ${EMBEDDING_DIMS}`);
      process.exit(1);
    }
    if (vec.some((n) => !Number.isFinite(n))) {
      console.error(`embedding ${i} (${chunks[i].id}) contains non-finite values`);
      process.exit(1);
    }
  });

  const supabase = supabaseAdmin();
  const totalBatches = Math.ceil(chunks.length / UPSERT_BATCH);
  console.log(`upserting ${chunks.length} rows in ${totalBatches} batches of ${UPSERT_BATCH}...`);
  let totalUpserted = 0;
  for (let i = 0; i < chunks.length; i += UPSERT_BATCH) {
    const batch = chunks.slice(i, i + UPSERT_BATCH).map((chunk, j) => ({
      ...chunk,
      embedding: embeddings[i + j],
    }));
    const batchNum = i / UPSERT_BATCH + 1;
    const label = `batch ${batchNum}/${totalBatches} (rows ${i}-${i + batch.length - 1})`;
    const started = Date.now();
    console.log(`${label}: sending...`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), BATCH_TIMEOUT_MS);
    let result;
    try {
      result = await supabase
        .from('policy_chunks')
        .upsert(batch)
        .select('id')
        .abortSignal(controller.signal);
    } catch (err) {
      clearTimeout(timeout);
      const elapsed = Date.now() - started;
      if (controller.signal.aborted) {
        console.error(`${label}: TIMED OUT after ${elapsed}ms (no response from Supabase)`);
      } else {
        console.error(`${label}: threw after ${elapsed}ms:`, err);
      }
      process.exit(1);
    }
    clearTimeout(timeout);
    const { data, error } = result;

    if (error) {
      console.error(`${label}: upsert failed after ${Date.now() - started}ms`);
      console.error(`  message: ${error.message}`);
      console.error(`  code:    ${error.code}`);
      console.error(`  details: ${error.details}`);
      console.error(`  hint:    ${error.hint}`);
      process.exit(1);
    }
    if (!data || data.length !== batch.length) {
      console.error(
        `${label}: returned ${data?.length ?? 0} rows, expected ${batch.length} — ` +
          'no error was reported but rows are missing (check RLS policies on policy_chunks)',
      );
      process.exit(1);
    }
    totalUpserted += data.length;
    console.log(`${label}: ok in ${Date.now() - started}ms (${totalUpserted}/${chunks.length} total)`);
  }
  console.log(`upserted ${totalUpserted} rows`);

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
