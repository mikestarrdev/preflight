import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// File-backed cache keyed by SHA-256 of {step, model, corpus_version, input}.
// Eval runs get re-run many times while prompts change; without a cache the
// cost discourages iteration, which defeats the point of having evals.
// Bypass with NO_CACHE=1.

const CACHE_DIR = '.cache';

export type CacheKeyParts = {
  step: string;
  model: string;
  corpus_version: string;
  input: unknown;
};

export function cacheKey(parts: CacheKeyParts): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

export function cacheGet<T>(key: string): T | null {
  if (process.env.NO_CACHE === '1') return null;
  const path = join(CACHE_DIR, `${key}.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null; // corrupted entry: treat as a miss, it will be rewritten
  }
}

export function cacheSet(key: string, value: unknown): void {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(join(CACHE_DIR, `${key}.json`), JSON.stringify(value));
}

export async function cached<T>(parts: CacheKeyParts, fn: () => Promise<T>): Promise<T> {
  const key = cacheKey(parts);
  const hit = cacheGet<T>(key);
  if (hit !== null) return hit;
  const value = await fn();
  cacheSet(key, value);
  return value;
}
