import { config } from 'dotenv';
config({ path: '.env.local' });

import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import type { Finding } from '../lib/types';

const SEVERITY_ORDER = ['violation', 'risk', 'clear'] as const;
const SEVERITY_MARK = { violation: '✗', risk: '~', clear: '✓' } as const;

const USAGE = `usage: pnpm analyze [--copy "<ad copy>"] [--image <path>] [--url <landing page url>]
any combination, at least one required`;

function usage(): never {
  console.error(USAGE);
  process.exit(1);
}

function parseArgs(argv: string[]): { copy?: string; imagePath?: string; url?: string } {
  const out: { copy?: string; imagePath?: string; url?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i + 1];
    if (value === undefined) usage();
    switch (argv[i]) {
      case '--copy':
        out.copy = value;
        break;
      case '--image':
        out.imagePath = value;
        break;
      case '--url':
        out.url = value;
        break;
      default:
        usage();
    }
    i++;
  }
  if (!out.copy && !out.imagePath && !out.url) usage();
  return out;
}

function printFinding(f: Finding): void {
  console.log(`  ${SEVERITY_MARK[f.severity]} [${f.element}] ${f.policy_id} (confidence ${f.confidence.toFixed(2)})`);
  console.log(`    clause:  "${f.clause_quote}"`);
  console.log(`    why:     ${f.explanation}`);
  if (f.suggested_rewrite) {
    const label = f.rewrite_kind === 'guidance' ? 'guidance' : 'rewrite';
    console.log(`    ${label}: ${f.suggested_rewrite}`);
  }
  console.log(`    ${f.source_url}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // imports after dotenv so env vars are set before clients initialize
  const { analyze } = await import('../lib/agent/orchestrator');
  const { MEDIA_TYPE_BY_EXT } = await import('../lib/inputs/vision');

  let image;
  if (args.imagePath) {
    const mediaType = MEDIA_TYPE_BY_EXT[extname(args.imagePath).toLowerCase()];
    if (!mediaType) {
      console.error(`unsupported image type: ${args.imagePath} (jpg, png, webp)`);
      process.exit(1);
    }
    image = { data: readFileSync(args.imagePath).toString('base64'), mediaType };
  }

  const result = await analyze({ copy: args.copy, image, url: args.url });

  console.log(`\nanalyzed in ${result.duration_ms}ms — model ${result.model_version}, corpus ${result.corpus_version}`);
  console.log(`elements: ${result.elements_analyzed.join(', ') || 'none'}\n`);

  for (const severity of SEVERITY_ORDER) {
    const group = result.findings.filter((f) => f.severity === severity);
    if (group.length === 0) continue;
    console.log(`${severity.toUpperCase()} (${group.length})\n`);
    group.forEach(printFinding);
  }
  if (result.findings.length === 0) {
    console.log('no findings\n');
  }

  const d = result.diagnostics;
  const timings = Object.entries(d.step_timings_ms)
    .map(([k, v]) => `${k} ${v}ms`)
    .join(', ');
  console.log(`steps: ${timings}`);
  console.log(`citations: ${d.findings_emitted} emitted, ${d.citation_drops} dropped by verification`);
  if (d.degraded.length > 0) console.log(`degraded: ${d.degraded.join(', ')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
