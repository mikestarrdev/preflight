import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as cheerio from 'cheerio';
import { chromium, type Browser } from 'playwright';
import { chunkDocument } from '../lib/rag/chunk';

// Meta Advertising Standards pages with the highest ad-rejection relevance.
// doc_slug is ours (stable, short); the URL path is Meta's current taxonomy.
const DOCS: { slug: string; url: string }[] = [
  { slug: 'personal-attributes', url: 'https://transparency.meta.com/policies/ad-standards/objectionable-content/privacy-violations-personal-attributes/' },
  { slug: 'deceptive-practices', url: 'https://transparency.meta.com/policies/ad-standards/fraud-scams/fraud-scams-deceptive-practices/' },
  { slug: 'unacceptable-business-practices', url: 'https://transparency.meta.com/policies/ad-standards/fraud-scams/unacceptable-business-practices/' },
  { slug: 'health-wellness', url: 'https://transparency.meta.com/policies/ad-standards/restricted-goods-services/health-wellness/' },
  { slug: 'adult-nudity', url: 'https://transparency.meta.com/policies/ad-standards/objectionable-content/adult-nudity-and-sexual-activity/' },
  { slug: 'adult-solicitation', url: 'https://transparency.meta.com/policies/ad-standards/objectionable-content/adult-sexual-solicitation-and-sexually-explicit-language/' },
  { slug: 'alcohol', url: 'https://transparency.meta.com/policies/ad-standards/restricted-goods-services/alcohol/' },
  { slug: 'tobacco', url: 'https://transparency.meta.com/policies/ad-standards/restricted-goods-services/tobacco-related-products/' },
  { slug: 'weapons', url: 'https://transparency.meta.com/policies/ad-standards/restricted-goods-services/weapons-ammunitions-explosives/' },
  { slug: 'drugs-pharmaceuticals', url: 'https://transparency.meta.com/policies/ad-standards/restricted-goods-services/drugs-pharmaceuticals/' },
  { slug: 'financial-services', url: 'https://transparency.meta.com/policies/ad-standards/restricted-goods-services/financial-services/' },
  { slug: 'cryptocurrency', url: 'https://transparency.meta.com/policies/ad-standards/restricted-goods-services/cryptocurrency-products-and-services/' },
  { slug: 'account-integrity', url: 'https://transparency.meta.com/policies/ad-standards/business-assets/account-integrity/' },
  { slug: 'inauthentic-behavior', url: 'https://transparency.meta.com/policies/ad-standards/business-assets/inauthentic-behavior/' },
  { slug: 'discriminatory-practices', url: 'https://transparency.meta.com/policies/ad-standards/unacceptable-content/discriminatory-practices/' },
  // Ads must comply with the Community Standards, and several ad policies
  // defer to them for the substantive rules (e.g. deceptive functionality).
  { slug: 'cs-fraud-scams', url: 'https://transparency.meta.com/policies/community-standards/fraud-scams/' },
  { slug: 'cs-spam', url: 'https://transparency.meta.com/policies/community-standards/spam/' },
];

const RAW_DIR = 'data/raw';
const PARSED_DIR = 'data/parsed';
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';
const REQUEST_GAP_MS = 1000;

type FetchMeta = { url: string; fetched_at: string; renderer: 'static' | 'playwright' };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A static fetch is good enough when the page arrives with its content
// server-rendered. Meta's transparency pages don't, so this usually falls
// through to Playwright — but detect rather than assume.
function staticFetchUsable(html: string): boolean {
  const $ = cheerio.load(html);
  $('script,style,noscript').remove();
  const root = $('main').length ? $('main') : $('body');
  return root.text().replace(/\s+/g, ' ').trim().length > 1500;
}

async function fetchStatic(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const html = await res.text();
    return staticFetchUsable(html) ? html : null;
  } catch {
    return null;
  }
}

async function fetchRendered(browser: Browser, url: string): Promise<string> {
  const page = await browser.newPage({
    userAgent: USER_AGENT,
    viewport: { width: 1440, height: 900 },
  });
  try {
    const res = await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
    if (!res || res.status() >= 400) {
      throw new Error(`HTTP ${res?.status()} for ${url}`);
    }
    // Sections hydrate progressively after networkidle, some only once
    // scrolled into view. Scroll through the page, then wait until the main
    // text stops growing — a missing section silently truncates the corpus.
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 600) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 150));
      }
      window.scrollTo(0, 0);
    });
    let prevLen = -1;
    let stable = 0;
    for (let i = 0; i < 25; i++) {
      await page.waitForTimeout(1000);
      const len = await page.evaluate(
        () => document.querySelector('main')?.textContent?.length ?? 0,
      );
      stable = len === prevLen ? stable + 1 : 0;
      if (stable >= 3 && i >= 5) break;
      prevLen = len;
    }
    // Stamp computed font metrics onto the DOM so the clause chunker can
    // classify headings offline. Meta's atomic CSS lives on a CDN, so the
    // saved HTML alone carries no usable style information.
    await page.evaluate(() => {
      const main = document.querySelector('main');
      if (!main) return;
      for (const el of main.querySelectorAll('*')) {
        const cs = getComputedStyle(el);
        el.setAttribute('data-pf-fs', cs.fontSize);
        el.setAttribute('data-pf-fw', cs.fontWeight);
      }
    });
    return await page.content();
  } finally {
    await page.close();
  }
}

async function main() {
  const refresh = process.argv.includes('--refresh');
  const onlyIdx = process.argv.indexOf('--only');
  const only = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : null;
  const docs = only ? DOCS.filter((d) => d.slug === only) : DOCS;
  if (docs.length === 0) {
    console.error(`unknown slug: ${only}`);
    process.exit(1);
  }

  mkdirSync(RAW_DIR, { recursive: true });
  mkdirSync(PARSED_DIR, { recursive: true });

  let browser: Browser | null = null;
  const failures: string[] = [];

  for (const doc of docs) {
    const rawPath = join(RAW_DIR, `${doc.slug}.html`);
    const metaPath = join(RAW_DIR, `${doc.slug}.meta.json`);

    // Fetch (or reuse what's on disk — never re-scrape during development)
    if (refresh || !existsSync(rawPath)) {
      const fetchedAt = new Date().toISOString();
      let html = await fetchStatic(doc.url);
      let renderer: FetchMeta['renderer'] = 'static';
      if (!html) {
        browser ??= await chromium.launch();
        html = await fetchRendered(browser, doc.url);
        renderer = 'playwright';
      }
      writeFileSync(rawPath, html);
      const meta: FetchMeta = { url: doc.url, fetched_at: fetchedAt, renderer };
      writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n');
      console.log(`fetched ${doc.slug} (${renderer})`);
      await sleep(REQUEST_GAP_MS);
    }

    // Parse from disk
    const html = readFileSync(rawPath, 'utf8');
    const meta: FetchMeta = JSON.parse(readFileSync(metaPath, 'utf8'));
    const chunks = chunkDocument({
      html,
      platform: 'meta',
      docSlug: doc.slug,
      sourceUrl: doc.url,
      fetchedAt: meta.fetched_at,
    });

    const byType = chunks.reduce<Record<string, number>>((acc, c) => {
      acc[c.content_type] = (acc[c.content_type] ?? 0) + 1;
      return acc;
    }, {});
    console.log(
      `${doc.slug}: ${chunks.length} chunks`,
      JSON.stringify(byType),
    );

    if (chunks.length === 0) {
      failures.push(doc.slug);
      continue;
    }
    writeFileSync(join(PARSED_DIR, `${doc.slug}.json`), JSON.stringify(chunks, null, 2) + '\n');
  }

  await browser?.close();

  if (failures.length > 0) {
    console.error(`\nFAILED — zero chunks for: ${failures.join(', ')}`);
    console.error('A silent partial corpus wrecks eval numbers later. Fix before ingesting.');
    process.exit(1);
  }
  console.log(`\nok — ${docs.length} documents parsed into ${PARSED_DIR}/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
