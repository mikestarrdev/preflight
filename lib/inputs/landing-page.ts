import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';

// Fetches and extracts a user-supplied landing page URL. This is a public app
// accepting arbitrary URLs, so every hostname is resolved and checked against
// private ranges before any request — including each redirect hop, since a
// public URL redirecting to an internal address is the classic SSRF bypass.
// Failure always degrades to { fetched: false, reason }; it never throws.

const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;
// ~4000 tokens at ~4 chars/token, keeping the top of the page (where offers live).
const MAX_BODY_CHARS = 16_000;
const MAX_OFFER_LINES = 10;
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';

export type FetchedLandingPage = {
  fetched: true;
  url: string; // as requested
  final_url: string; // after redirects
  title: string;
  meta_description: string;
  body_text: string;
  offer_text: string[]; // lines with obvious pricing or offer language
  renderer: 'static' | 'playwright';
};

export type LandingPageContent =
  | FetchedLandingPage
  | { fetched: false; url: string; reason: string };

function isPrivateIPv4(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local, incl. cloud metadata endpoints
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224 // multicast and reserved
  );
}

function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) return isPrivateIPv4(ip);
  const v6 = ip.toLowerCase();
  if (v6 === '::' || v6 === '::1') return true;
  if (v6.startsWith('::ffff:')) return isPrivateIPv4(v6.slice('::ffff:'.length));
  return v6.startsWith('fe80') || v6.startsWith('fc') || v6.startsWith('fd');
}

// Throws with a reason when the URL must not be fetched. Note the residual
// DNS-rebinding window: the fetch resolves the name again after this check.
// Closing it needs a pinned-IP dispatcher, out of scope for v1.
async function validateUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('not a valid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`protocol ${url.protocol} not allowed`);
  }
  const host = url.hostname;
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new Error('address is in a private range');
    return url;
  }
  let addresses;
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    throw new Error(`hostname ${host} did not resolve`);
  }
  if (addresses.some((a) => isPrivateAddress(a.address))) {
    throw new Error(`hostname ${host} resolves to a private address`);
  }
  return url;
}

async function fetchStaticChain(
  startUrl: string,
): Promise<{ html: string; finalUrl: string }> {
  let url = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await validateUrl(url);
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) throw new Error(`redirect (${res.status}) without location header`);
      url = new URL(location, url).toString();
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const contentType = res.headers.get('content-type') ?? '';
    if (contentType && !/text\/html|application\/xhtml/.test(contentType)) {
      throw new Error(`not an HTML page (${contentType.split(';')[0]})`);
    }
    return { html: await res.text(), finalUrl: url };
  }
  throw new Error(`more than ${MAX_REDIRECTS} redirects`);
}

// Playwright fallback for pages that arrive as a JS shell. Same pattern as
// scripts/scrape-policies.ts, plus main-frame navigation checks so redirects
// inside the browser get the same SSRF validation as the static path.
async function fetchRendered(url: string): Promise<{ html: string; finalUrl: string }> {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ userAgent: USER_AGENT });
    await page.route('**/*', async (route) => {
      const req = route.request();
      if (req.isNavigationRequest() && req.frame() === page.mainFrame()) {
        try {
          await validateUrl(req.url());
        } catch {
          return route.abort();
        }
      }
      return route.continue();
    });
    const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
    if (!res || res.status() >= 400) {
      throw new Error(`HTTP ${res?.status() ?? 'no response'}`);
    }
    let hops = 0;
    for (let r = res.request().redirectedFrom(); r; r = r.redirectedFrom()) hops++;
    if (hops > MAX_REDIRECTS) throw new Error(`more than ${MAX_REDIRECTS} redirects`);
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
    return { html: await page.content(), finalUrl: page.url() };
  } finally {
    await browser.close();
  }
}

const OFFER_RE =
  /[$€£]\s?\d|\b\d+\s?%\s?off\b|\bfree\s+(trial|shipping|gift|quote)\b|\b(sale|discount|save)\b/i;

function extractOffers($: cheerio.CheerioAPI, root: cheerio.Cheerio<AnyNode>): string[] {
  const offers = new Set<string>();
  root.find('h1,h2,h3,h4,p,li,a,button,span,strong,em,td,div').each((_, el) => {
    const $el = $(el);
    if ($el.children().length > 0) return; // leaf nodes only, avoids nested duplicates
    const text = $el.text().replace(/\s+/g, ' ').trim();
    if (text.length >= 2 && text.length <= 200 && OFFER_RE.test(text)) offers.add(text);
  });
  return [...offers].slice(0, MAX_OFFER_LINES);
}

function extract(
  html: string,
  requestedUrl: string,
  finalUrl: string,
  renderer: 'static' | 'playwright',
): FetchedLandingPage {
  const $ = cheerio.load(html);
  const title = $('title').first().text().trim();
  const metaDescription = $('meta[name="description"]').attr('content')?.trim() ?? '';

  $('script,style,noscript,svg,iframe,template').remove();
  $('nav,footer,[role="navigation"],[role="contentinfo"],[aria-hidden="true"]').remove();
  $('[id*="cookie" i],[class*="cookie" i],[id*="consent" i],[class*="consent" i],[id*="gdpr" i],[class*="gdpr" i]').remove();

  const root = $('main').length ? $('main') : $('body');
  const bodyText = root.text().replace(/\s+/g, ' ').trim().slice(0, MAX_BODY_CHARS);

  return {
    fetched: true,
    url: requestedUrl,
    final_url: finalUrl,
    title,
    meta_description: metaDescription,
    body_text: bodyText,
    offer_text: extractOffers($, root),
    renderer,
  };
}

// A static page is usable when it actually carries content; a near-empty body
// means a JS shell that needs rendering.
function staticUsable(page: FetchedLandingPage): boolean {
  return page.body_text.length >= 100;
}

async function fetchOnce(rawUrl: string): Promise<FetchedLandingPage> {
  const staticResult = await fetchStaticChain(rawUrl).catch(() => null);
  if (staticResult) {
    const page = extract(staticResult.html, rawUrl, staticResult.finalUrl, 'static');
    if (staticUsable(page)) return page;
  }
  const rendered = await fetchRendered(staticResult?.finalUrl ?? rawUrl);
  return extract(rendered.html, rawUrl, rendered.finalUrl, 'playwright');
}

export async function fetchLandingPage(rawUrl: string): Promise<LandingPageContent> {
  try {
    await validateUrl(rawUrl);
  } catch (err) {
    return {
      fetched: false,
      url: rawUrl,
      reason: err instanceof Error ? err.message : String(err),
    };
  }

  // 10s timeout per request, one retry of the whole fetch on failure.
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await fetchOnce(rawUrl);
    } catch (err) {
      lastError = err;
    }
  }
  return {
    fetched: false,
    url: rawUrl,
    reason: lastError instanceof Error ? lastError.message : String(lastError),
  };
}
