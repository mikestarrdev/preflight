import { config } from 'dotenv';
config({ path: '.env.local' });

async function main() {
  const query = process.argv.slice(2).join(' ').trim();
  if (!query) {
    console.error('usage: pnpm tsx scripts/query.ts "<query>"');
    process.exit(1);
  }

  // import after dotenv so env vars are set before clients initialize
  const { search } = await import('../lib/rag/search');

  const start = Date.now();
  const results = await search(query, { platform: 'meta' });
  const elapsed = Date.now() - start;

  console.log(`\n"${query}" — ${results.length} results in ${elapsed}ms\n`);
  results.forEach((r, i) => {
    const scores = [
      `fused ${r.fused_score.toFixed(4)}`,
      r.vector_score !== null ? `vec ${r.vector_score.toFixed(3)}` : 'vec —',
      r.text_score !== null ? `txt ${r.text_score.toFixed(3)}` : 'txt —',
      r.found_by.join('+'),
    ].join(' | ');
    console.log(`${i + 1}. ${r.doc_title} [${r.clause_path}] (${r.content_type})`);
    console.log(`   ${scores}`);
    console.log(`   ${r.content.slice(0, 200).replace(/\n/g, ' ')}${r.content.length > 200 ? '…' : ''}`);
    console.log(`   ${r.source_url}\n`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
