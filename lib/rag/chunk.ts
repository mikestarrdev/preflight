import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import type { ContentType, PolicyChunk } from '@/lib/types';

// Chunking follows document structure, not token counts. Blocks are extracted
// from the rendered page, classified (heading / paragraph / list item /
// example), then grouped into clause-level chunks that never separate a rule
// from its attached list, exception, or example.

export type Block =
  | { kind: 'heading'; level: 2 | 3; text: string }
  | { kind: 'para'; text: string }
  | { kind: 'list_item'; text: string }
  | { kind: 'example'; example: 'compliant' | 'violating'; text: string };

const BLOCK_TAGS = new Set([
  'p', 'div', 'li', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'td', 'th', 'tr', 'table', 'thead', 'tbody', 'blockquote',
  'section', 'article', 'dl', 'dt', 'dd',
]);
const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'svg', 'iframe', 'button', 'nav', 'header', 'footer', 'aside']);
const BLOCK_SELECTOR = [...BLOCK_TAGS].join(',');

// Page chrome that appears inside <main> on transparency.meta.com.
const CHROME_EXACT = new Set(['Policy details', 'CHANGE LOG', 'Today', 'Yesterday']);
const CHROME_PATTERNS = [
  /^[A-Z][a-z]{2} \d{1,2}, \d{4}$/, // change-log dates: "Jun 26, 2024"
  /^Show (more|less)$/i,
  /^For more information, visit the Business Help Center\.?$/i,
];

const TOKEN_CHARS = 4; // rough chars-per-token estimate
const MAX_TOKENS = 600;
const MIN_TOKENS = 200;

const estTokens = (text: string) => Math.ceil(text.length / TOKEN_CHARS);

function isChrome(text: string): boolean {
  return CHROME_EXACT.has(text) || CHROME_PATTERNS.some((re) => re.test(text));
}

function parsePx(v: string | undefined): number | null {
  const n = parseInt(v ?? '', 10);
  return Number.isNaN(n) ? null : n;
}

// Meta's transparency pages use atomic CSS classes served from a CDN, so the
// saved HTML alone cannot distinguish a heading div from a body div. The
// scraper stamps computed font-size/weight onto every element as data-pf-fs /
// data-pf-fw before saving, and classification reads those. Pages fetched
// statically (no stamps) fall back to semantic h1-h6 tags.
export function extractBlocks(html: string): { docTitle: string; blocks: Block[] } {
  const $ = cheerio.load(html);
  $('style,script,noscript,svg,iframe').remove();

  const root = $('main').length ? $('main') : $('body');
  const docTitle = $('h1').first().text().replace(/\s+/g, ' ').trim();
  const blocks: Block[] = [];

  // A text run: consecutive text nodes and inline elements under one block
  // element, flushed whenever a block-level child interrupts.
  type Run = { text: string; fontSize: number | null; fontWeight: number | null };

  const emit = (run: Run, containerTag: string, inListItem: boolean) => {
    const text = run.text.replace(/\s+/g, ' ').trim();
    if (text.length < 3 || text === docTitle || isChrome(text)) return;
    if (run.fontSize !== null && run.fontSize < 16) return; // breadcrumbs, card labels

    const exampleMark = text.match(/^([✅❌])\s*/u);
    if (exampleMark) {
      blocks.push({
        kind: 'example',
        example: exampleMark[1] === '✅' ? 'compliant' : 'violating',
        text,
      });
      return;
    }
    if (containerTag === 'h2') {
      blocks.push({ kind: 'heading', level: 2, text });
      return;
    }
    if (['h3', 'h4', 'h5', 'h6'].includes(containerTag)) {
      blocks.push({ kind: 'heading', level: 3, text });
      return;
    }
    if (run.fontSize !== null && run.fontSize >= 20 && text.length <= 120) {
      blocks.push({ kind: 'heading', level: 2, text });
      return;
    }
    if (
      run.fontSize !== null &&
      run.fontWeight !== null &&
      run.fontWeight >= 600 &&
      text.length <= 80 &&
      !/[.!?]$/.test(text)
    ) {
      blocks.push({ kind: 'heading', level: 3, text });
      return;
    }
    if (inListItem) {
      blocks.push({ kind: 'list_item', text });
      return;
    }
    blocks.push({ kind: 'para', text });
  };

  const walk = (node: AnyNode, inListItem: boolean) => {
    const el = $(node);
    const tag = 'tagName' in node && node.tagName ? node.tagName.toLowerCase() : '';
    if (SKIP_TAGS.has(tag) || tag === 'h1') return;
    if (el.attr('role') === 'button' || el.attr('aria-hidden') === 'true') return;
    // A link wrapping block content is a navigation card, not policy text.
    if (tag === 'a' && el.find(BLOCK_SELECTOR).length > 0) return;
    // ...and so is a container whose direct-child link wraps block content.
    const cardLink = el.children('a').filter((_, a) => $(a).find(BLOCK_SELECTOR).length > 0);
    if (cardLink.length > 0) return;

    const ownMetrics = {
      fontSize: parsePx(el.attr('data-pf-fs')),
      fontWeight: parsePx(el.attr('data-pf-fw')),
    };
    let run: Run = { text: '', ...ownMetrics };
    const flush = () => {
      if (run.text.trim()) emit(run, tag, inListItem);
      run = { text: '', ...ownMetrics };
    };

    for (const child of el.contents().toArray()) {
      if (child.type === 'text') {
        run.text += $(child).text();
        continue;
      }
      if (child.type !== 'tag') continue;
      const childTag = child.tagName.toLowerCase();
      if (SKIP_TAGS.has(childTag)) continue;
      const childEl = $(child);
      const childIsBlock = BLOCK_TAGS.has(childTag) || childEl.find(BLOCK_SELECTOR).length > 0;
      if (childIsBlock) {
        flush();
        walk(child, inListItem || childTag === 'li');
      } else {
        // inline element: fold its text into the run, taking font metrics
        // from the first styled inline node (wrappers carry stale values)
        if (!run.text.trim()) {
          const fs = parsePx(childEl.attr('data-pf-fs'));
          const fw = parsePx(childEl.attr('data-pf-fw'));
          if (fs !== null) run.fontSize = fs;
          if (fw !== null) run.fontWeight = fw;
        }
        run.text += childEl.text();
      }
    }
    flush();
  };

  walk(root[0], false);
  return { docTitle, blocks };
}

// A unit is the smallest piece that must never be split: a paragraph together
// with the list it introduces, or a run of same-type examples.
type Unit =
  | { kind: 'text'; parts: string[] }
  | { kind: 'example'; example: 'compliant' | 'violating'; parts: string[] };

const GLUE_TO_PREVIOUS = /^(for example|e\.g\.|this (does not|doesn't) apply|except|note:)/i;

function groupUnits(blocks: Block[]): Unit[] {
  const units: Unit[] = [];
  let listOpen = false; // last text unit ended in (or is collecting) a list

  for (const block of blocks) {
    const last = units[units.length - 1];

    if (block.kind === 'example') {
      if (last?.kind === 'example' && last.example === block.example) {
        last.parts.push(block.text);
      } else {
        units.push({ kind: 'example', example: block.example, parts: [block.text] });
      }
      listOpen = false;
      continue;
    }

    if (block.kind === 'list_item') {
      if (last?.kind === 'text') {
        last.parts.push(block.text);
        listOpen = true;
      } else {
        units.push({ kind: 'text', parts: [block.text] });
        listOpen = true;
      }
      continue;
    }

    // paragraph
    const gluesBack = last?.kind === 'text' && GLUE_TO_PREVIOUS.test(block.text);
    const opensList = /:$/.test(block.text);
    if (gluesBack && last?.kind === 'text') {
      last.parts.push(block.text);
    } else if (listOpen && last?.kind === 'text' && opensList) {
      // e.g. "Ads cannot:" list followed directly by "Ads can:" — keep the
      // section's paired lists apart only if the previous list closed cleanly
      units.push({ kind: 'text', parts: [block.text] });
    } else {
      units.push({ kind: 'text', parts: [block.text] });
    }
    listOpen = false;
  }
  return units;
}

function splitLongText(text: string): string[] {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const parts: string[] = [];
  let buf = '';
  for (const s of sentences) {
    if (buf && estTokens(buf) + estTokens(s) > MAX_TOKENS - 100) {
      parts.push(buf);
      buf = s;
    } else {
      buf = buf ? `${buf} ${s}` : s;
    }
  }
  if (buf) parts.push(buf);
  return parts;
}

export type ChunkDocumentInput = {
  html: string;
  platform: string;
  docSlug: string;
  sourceUrl: string;
  fetchedAt: string;
};

export function chunkDocument(input: ChunkDocumentInput): PolicyChunk[] {
  const { docTitle, blocks } = extractBlocks(input.html);
  const chunks: PolicyChunk[] = [];

  // Section = run of blocks under the same heading trail.
  let l2 = 0;
  let l3 = 0;
  let trail: string[] = [docTitle];
  let sectionUnits: Block[] = [];

  const flushSection = (pathPrefix: string, sectionTrail: string[]) => {
    const units = groupUnits(sectionUnits);
    sectionUnits = [];

    // pack text units into 200-600 token chunks; example units stand alone
    type Pending = { contentType: ContentType; parts: string[] };
    const pending: Pending[] = [];
    for (const unit of units) {
      if (unit.kind === 'example') {
        pending.push({
          contentType: unit.example === 'compliant' ? 'example_compliant' : 'example_violating',
          parts: unit.parts,
        });
        continue;
      }
      const contentType: ContentType = /definition/i.test(sectionTrail.join(' '))
        ? 'definition'
        : 'rule';
      const unitText = unit.parts.join('\n');
      const last = pending[pending.length - 1];
      if (
        last &&
        last.contentType === contentType &&
        estTokens(last.parts.join('\n')) < MIN_TOKENS &&
        estTokens(last.parts.join('\n')) + estTokens(unitText) <= MAX_TOKENS
      ) {
        last.parts.push(unitText);
      } else {
        pending.push({ contentType, parts: [unitText] });
      }
    }

    let n = 0;
    for (const p of pending) {
      const content = p.parts.join('\n');
      n += 1;
      if (estTokens(content) > MAX_TOKENS && p.contentType !== 'example_compliant' && p.contentType !== 'example_violating') {
        const parts = splitLongText(content);
        parts.forEach((part, i) => {
          const clausePath = `${pathPrefix}.${n}.s${i + 1}`;
          chunks.push(makeChunk(input, docTitle, sectionTrail, clausePath, part, p.contentType));
        });
      } else {
        const clausePath = `${pathPrefix}.${n}`;
        chunks.push(makeChunk(input, docTitle, sectionTrail, clausePath, content, p.contentType));
      }
    }
  };

  let currentPath = '0';
  for (const block of blocks) {
    if (block.kind === 'heading') {
      flushSection(currentPath, trail);
      if (block.level === 2) {
        l2 += 1;
        l3 = 0;
        trail = [docTitle, block.text];
        currentPath = `${l2}`;
      } else {
        l3 += 1;
        trail = [trail[0], ...(l2 > 0 ? [trail[1]] : []), block.text].filter(Boolean);
        currentPath = l2 > 0 ? `${l2}.${l3}` : `0.${l3}`;
      }
      continue;
    }
    sectionUnits.push(block);
  }
  flushSection(currentPath, trail);

  return chunks;
}

function makeChunk(
  input: ChunkDocumentInput,
  docTitle: string,
  trail: string[],
  clausePath: string,
  content: string,
  contentType: ContentType,
): PolicyChunk {
  return {
    id: `${input.platform}:${input.docSlug}:${clausePath}`,
    platform: input.platform,
    doc_slug: input.docSlug,
    doc_title: docTitle,
    clause_path: clausePath,
    heading_trail: trail,
    content,
    content_type: contentType,
    source_url: input.sourceUrl,
    fetched_at: input.fetchedAt,
  };
}

// Text used for embedding: heading context plus the clause. `content` itself
// stays verbatim for citation.
export function embeddingInput(chunk: PolicyChunk): string {
  return `${chunk.heading_trail.join(' > ')}\n\n${chunk.content}`;
}
