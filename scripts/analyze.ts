import { config } from 'dotenv';
config({ path: '.env.local' });

import type { Finding } from '../lib/types';

const SEVERITY_ORDER = ['violation', 'risk', 'clear'] as const;
const SEVERITY_MARK = { violation: '✗', risk: '~', clear: '✓' } as const;

function printFinding(f: Finding): void {
  console.log(`  ${SEVERITY_MARK[f.severity]} ${f.policy_id} (confidence ${f.confidence.toFixed(2)})`);
  console.log(`    clause:  "${f.clause_quote}"`);
  console.log(`    why:     ${f.explanation}`);
  if (f.suggested_rewrite) {
    console.log(`    rewrite: ${f.suggested_rewrite}`);
  }
  console.log(`    ${f.source_url}\n`);
}

async function main() {
  const copy = process.argv.slice(2).join(' ').trim();
  if (!copy) {
    console.error('usage: pnpm analyze "<ad copy>"');
    process.exit(1);
  }

  // import after dotenv so env vars are set before clients initialize
  const { analyze } = await import('../lib/agent/orchestrator');

  const result = await analyze(copy);

  console.log(`\nanalyzed in ${result.duration_ms}ms — model ${result.model_version}, corpus ${result.corpus_version}\n`);

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
