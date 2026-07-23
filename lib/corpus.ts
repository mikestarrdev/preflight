import { readFileSync } from 'node:fs';

const MANIFEST_PATH = 'data/corpus-version.json';

// The manifest is written by scripts/ingest.ts. Its version hash stamps every
// AnalysisResult and every cache key — results are meaningless without knowing
// which corpus produced them.
let cached: string | null = null;

export function corpusVersion(): string {
  if (cached) return cached;
  let manifest: { version?: unknown };
  try {
    manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  } catch {
    throw new Error(`${MANIFEST_PATH} not found — run pnpm ingest first`);
  }
  if (typeof manifest.version !== 'string' || manifest.version.length === 0) {
    throw new Error(`${MANIFEST_PATH} has no version field — re-run pnpm ingest`);
  }
  cached = manifest.version;
  return cached;
}
