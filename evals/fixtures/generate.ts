import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// Renders the image eval fixtures as 1080x1080 screenshots of hand-written
// HTML. Self-made mockups instead of scraped creatives: this repo is public
// and real ad images would raise copyright questions. Re-run with
// pnpm eval:fixtures after editing a template.

const OUT_DIR = dirname(fileURLToPath(import.meta.url));
const SIZE = 1080;

const BASE_CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: ${SIZE}px; height: ${SIZE}px; overflow: hidden;
    font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    text-align: center;
  }
`;

type Fixture = { file: string; type: 'png' | 'jpeg'; html: string };

const FIXTURES: Fixture[] = [
  {
    // Weight-loss before/after split — visual violation even without text
    file: 'before-after.jpg',
    type: 'jpeg',
    html: `
      <style>${BASE_CSS}
        body { flex-direction: row; align-items: stretch; }
        .half { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 30px; }
        .before { background: #8a97a8; } .after { background: #f2b76c; }
        .half span.person { font-size: 380px; line-height: 1; }
        .before .person { transform: scaleX(1.7); }
        .after .person { transform: scaleX(0.75); }
        .label { font-size: 72px; font-weight: 800; color: #fff; letter-spacing: 6px; }
        .banner { position: absolute; top: 40px; left: 0; right: 0; font-size: 52px; font-weight: 700; color: #333; }
        .divider { width: 6px; background: #fff; }
      </style>
      <div class="banner">12 WEEK TRANSFORMATION</div>
      <div class="half before"><span class="person">🧍</span><div class="label">BEFORE</div></div>
      <div class="divider"></div>
      <div class="half after"><span class="person">🧍</span><div class="label">AFTER</div></div>`,
  },
  {
    // Fake video player UI over a static image
    file: 'fake-play-button.png',
    type: 'png',
    html: `
      <style>${BASE_CSS}
        body { background: linear-gradient(160deg, #274060 0%, #7fb4d6 60%, #e8d9a0 100%); position: relative; }
        .title { position: absolute; top: 60px; left: 0; right: 0; color: #fff; font-size: 56px; font-weight: 700; text-shadow: 0 2px 8px rgba(0,0,0,.5); }
        .play { width: 220px; height: 220px; border-radius: 50%; background: rgba(0,0,0,.55); display: flex; align-items: center; justify-content: center; }
        .play::after { content: ''; border-style: solid; border-width: 60px 0 60px 100px; border-color: transparent transparent transparent #fff; margin-left: 24px; }
        .bar { position: absolute; bottom: 80px; left: 60px; right: 60px; height: 14px; background: rgba(255,255,255,.35); border-radius: 7px; }
        .bar .played { width: 30%; height: 100%; background: #e33; border-radius: 7px; }
        .time { position: absolute; bottom: 30px; right: 70px; color: #fff; font-size: 36px; }
      </style>
      <div class="title">You won't believe what happens next</div>
      <div class="play"></div>
      <div class="bar"><div class="played"></div></div>
      <div class="time">0:47 / 2:31</div>`,
  },
  {
    // Text-in-image outcome promise
    file: 'outcome-promise.png',
    type: 'png',
    html: `
      <style>${BASE_CSS}
        body { background: #fef6e4; gap: 50px; padding: 80px; }
        h1 { font-size: 110px; color: #d6432e; line-height: 1.1; }
        h2 { font-size: 60px; color: #172c66; }
        .cta { background: #2a9d8f; color: #fff; font-size: 54px; font-weight: 700; padding: 30px 70px; border-radius: 16px; }
      </style>
      <h1>LOSE 20 POUNDS IN 2 WEEKS</h1>
      <h2>100% guaranteed. No diet, no exercise.</h2>
      <div class="cta">Claim your bottle</div>`,
  },
  {
    // Visible alcohol products with a promo
    file: 'alcohol-promo.png',
    type: 'png',
    html: `
      <style>${BASE_CSS}
        body { background: #1b1b2b; color: #f5e9cf; gap: 40px; }
        .glasses { font-size: 330px; line-height: 1; }
        h1 { font-size: 90px; } h2 { font-size: 58px; color: #e0b352; }
      </style>
      <div class="glasses">🍾🍷🍸</div>
      <h1>HAPPY HOUR</h1>
      <h2>2-for-1 cocktails every Friday night</h2>`,
  },
  {
    // E-cigarette promotion (unparks meta-tobacco-3.2.1-b)
    file: 'vape-promo.png',
    type: 'png',
    html: `
      <style>${BASE_CSS}
        body { background: #10222c; color: #fff; gap: 44px; }
        .device { width: 560px; height: 110px; background: linear-gradient(90deg, #3d4f5c, #97a8b5); border-radius: 55px; position: relative; }
        .device::after { content: ''; position: absolute; right: -70px; top: 30px; width: 70px; height: 50px; background: #222; border-radius: 0 25px 25px 0; }
        .cloud { font-size: 120px; line-height: 1; opacity: .8; }
        h1 { font-size: 96px; color: #7fe3c0; } h2 { font-size: 54px; }
      </style>
      <div class="cloud">💨</div>
      <div class="device"></div>
      <h1>VAPE NATION</h1>
      <h2>New mango flavor pods — 20% off starter kits</h2>`,
  },
  {
    // Hookah lounge promotion (unparks meta-tobacco-3.2.1-c)
    file: 'hookah-lounge.png',
    type: 'png',
    html: `
      <style>${BASE_CSS}
        body { background: #2a1a3a; color: #f2e6d0; gap: 40px; }
        h1 { font-size: 96px; color: #d9a441; } h2 { font-size: 56px; }
      </style>
      <svg width="420" height="480" viewBox="0 0 210 240">
        <rect x="95" y="20" width="20" height="120" fill="#c9b037"/>
        <path d="M 85 20 Q 105 -10 125 20 Z" fill="#c9b037"/>
        <ellipse cx="105" cy="185" rx="55" ry="50" fill="#8e44ad"/>
        <rect x="75" y="230" width="60" height="10" fill="#c9b037"/>
        <path d="M 150 180 C 200 170 205 100 165 90" stroke="#c0392b" stroke-width="10" fill="none"/>
      </svg>
      <h1>SHISHA NIGHTS</h1>
      <h2>Premium hookah lounge — open till 3am</h2>`,
  },
  {
    // Anti-smoking campaign, compliant per Meta (unparks meta-tobacco-3.1.1-a)
    file: 'anti-smoking.png',
    type: 'png',
    html: `
      <style>${BASE_CSS}
        body { background: #eef7f2; color: #1d3d2f; gap: 44px; }
        .sign { font-size: 340px; line-height: 1; }
        h1 { font-size: 96px; } h2 { font-size: 52px; color: #2e6650; }
      </style>
      <div class="sign">🚭</div>
      <h1>Quit smoking today</h1>
      <h2>Free coaching and support. You've got this.</h2>`,
  },
  {
    // Clean control: generic product ad
    file: 'clean-product.png',
    type: 'png',
    html: `
      <style>${BASE_CSS}
        body { background: #e8f1f8; color: #17324d; gap: 40px; }
        .bottle { width: 200px; height: 460px; background: linear-gradient(180deg, #9cc7e8, #4a90c2); border-radius: 40px 40px 60px 60px; position: relative; }
        .bottle::before { content: ''; position: absolute; top: -60px; left: 60px; width: 80px; height: 60px; background: #17324d; border-radius: 12px 12px 0 0; }
        h1 { font-size: 92px; } h2 { font-size: 54px; color: #33627f; }
      </style>
      <div class="bottle"></div>
      <h1>AquaPure</h1>
      <h2>Stay hydrated all summer — $19.99</h2>`,
  },
];

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } });
  for (const fixture of FIXTURES) {
    await page.setContent(fixture.html, { waitUntil: 'networkidle' });
    const path = join(OUT_DIR, fixture.file);
    await page.screenshot({
      path,
      type: fixture.type,
      ...(fixture.type === 'jpeg' ? { quality: 85 } : {}),
    });
    console.log(`wrote ${path}`);
  }
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
