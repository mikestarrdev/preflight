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

  // --- Phase 4 additions: cases not built around the flag taxonomy. ---

  // (a) Violation carried entirely in rendered text. No split, no body focus,
  // no visible prohibited product — the flags path stays empty, so the check
  // has to come from transcribing and policy-checking the text.
  {
    file: 'text-diabetes-cure.png',
    type: 'png',
    html: `
      <style>${BASE_CSS}
        body { background: #e7f4ea; color: #14361f; gap: 40px; padding: 80px; }
        h1 { font-size: 104px; color: #1f7a3d; line-height: 1.05; }
        h2 { font-size: 56px; color: #2a2a2a; }
        .cta { background: #1f7a3d; color: #fff; font-size: 50px; font-weight: 700; padding: 28px 64px; border-radius: 14px; }
        .small { font-size: 34px; color: #5a6b5f; }
      </style>
      <h1>CURE YOUR TYPE 2 DIABETES IN 30 DAYS</h1>
      <h2>Doctors are stunned. Throw away your metformin for good.</h2>
      <div class="cta">Discover the secret</div>
      <div class="small">GlucoHerb natural formula</div>`,
  },
  {
    file: 'text-guaranteed-loan.png',
    type: 'png',
    html: `
      <style>${BASE_CSS}
        body { background: #101d33; color: #fff; gap: 44px; padding: 80px; }
        h1 { font-size: 150px; color: #ffd24d; }
        h2 { font-size: 54px; letter-spacing: 2px; }
        .cta { background: #ffd24d; color: #101d33; font-size: 52px; font-weight: 800; padding: 28px 70px; border-radius: 14px; }
      </style>
      <h1>GET $5,000 TODAY</h1>
      <h2>GUARANTEED APPROVAL — NO CREDIT CHECK — EVERYONE QUALIFIES</h2>
      <div class="cta">Apply in 2 minutes</div>`,
  },
  {
    file: 'text-debt-erase.png',
    type: 'png',
    html: `
      <style>${BASE_CSS}
        body { background: #0f3b3a; color: #eafaf7; gap: 40px; padding: 80px; }
        h1 { font-size: 118px; color: #5fe0c0; }
        h2 { font-size: 56px; }
        .cta { background: #5fe0c0; color: #0f3b3a; font-size: 50px; font-weight: 800; padding: 28px 66px; border-radius: 14px; }
      </style>
      <h1>ERASE 90% OF YOUR DEBT</h1>
      <h2>Guaranteed in 6 months, or you pay us nothing.</h2>
      <div class="cta">Free consultation</div>`,
  },
  {
    file: 'text-crypto-returns.png',
    type: 'png',
    html: `
      <style>${BASE_CSS}
        body { background: #0b0b12; color: #f7e9c6; gap: 44px; padding: 80px; }
        h1 { font-size: 120px; color: #f0c14b; }
        h2 { font-size: 58px; }
        .cta { background: #f0c14b; color: #0b0b12; font-size: 52px; font-weight: 800; padding: 28px 66px; border-radius: 14px; }
      </style>
      <h1>$500 into $50,000 in 90 DAYS</h1>
      <h2>Returns 100% guaranteed. Zero risk.</h2>
      <div class="cta">Start earning now</div>`,
  },
  {
    file: 'text-payday.png',
    type: 'png',
    html: `
      <style>${BASE_CSS}
        body { background: #f4711f; color: #fff; gap: 40px; padding: 80px; }
        h1 { font-size: 130px; }
        h2 { font-size: 54px; }
        .cta { background: #fff; color: #f4711f; font-size: 52px; font-weight: 800; padding: 28px 66px; border-radius: 14px; }
      </style>
      <h1>CASH BEFORE PAYDAY</h1>
      <h2>Payday advance in your account in 15 minutes. Repay on your next paycheck.</h2>
      <div class="cta">Get funded today</div>`,
  },

  // (b) A flag fires but the ad is compliant. These test that a flag is
  // evidence, not a verdict: the same split framing as the weight-loss
  // before/after, on a laundry stain, is fine.
  {
    file: 'comparison-detergent.png',
    type: 'png',
    html: `
      <style>${BASE_CSS}
        body { flex-direction: row; align-items: stretch; }
        .half { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 30px; }
        .before { background: #c9bfa8; } .after { background: #dff0f7; }
        .shirt { font-size: 300px; line-height: 1; position: relative; }
        .stain { position: absolute; left: 52%; top: 46%; width: 120px; height: 120px; background: #6b4422; border-radius: 50%; opacity: .85; }
        .label { font-size: 70px; font-weight: 800; color: #333; letter-spacing: 6px; }
        .divider { width: 6px; background: #fff; }
        .banner { position: absolute; top: 40px; left: 0; right: 0; font-size: 52px; font-weight: 700; color: #222; }
        .brand { position: absolute; bottom: 40px; left: 0; right: 0; font-size: 44px; color: #333; }
      </style>
      <div class="banner">SPARKLEWASH STAIN REMOVER</div>
      <div class="half before"><div class="shirt">👕<div class="stain"></div></div><div class="label">BEFORE</div></div>
      <div class="divider"></div>
      <div class="half after"><div class="shirt">👕</div><div class="label">AFTER</div></div>
      <div class="brand">Tough on coffee, wine and grass stains</div>`,
  },
  {
    file: 'comparison-phones.png',
    type: 'png',
    html: `
      <style>${BASE_CSS}
        body { background: #f0f2f5; color: #1a2230; gap: 36px; padding: 70px; }
        .row { display: flex; gap: 80px; align-items: center; }
        .phone { width: 230px; height: 470px; background: #1a2230; border-radius: 36px; border: 10px solid #333; }
        .phone.pro { background: #3a4a63; }
        .spec { font-size: 40px; }
        h1 { font-size: 78px; } .name { font-size: 48px; font-weight: 700; margin-top: 16px; }
        .vs { font-size: 70px; font-weight: 800; color: #888; }
      </style>
      <h1>WHICH ONE IS RIGHT FOR YOU?</h1>
      <div class="row">
        <div><div class="phone"></div><div class="name">Nova 5</div></div>
        <div class="vs">vs</div>
        <div><div class="phone pro"></div><div class="name">Nova 5 Pro</div></div>
      </div>
      <div class="spec">Bigger screen • Longer battery • Better camera</div>`,
  },
  {
    file: 'pilates-class.png',
    type: 'png',
    html: `
      <style>${BASE_CSS}
        body { background: #f6eef6; color: #3a2340; gap: 40px; padding: 80px; }
        .pose { font-size: 360px; line-height: 1; }
        h1 { font-size: 96px; color: #7a3f86; }
        h2 { font-size: 54px; }
        .cta { background: #7a3f86; color: #fff; font-size: 48px; font-weight: 700; padding: 26px 60px; border-radius: 14px; }
      </style>
      <div class="pose">🧘</div>
      <h1>PILATES FOR EVERY BODY</h1>
      <h2>Small-group reformer classes. Your first session is free.</h2>
      <div class="cta">Book a class</div>`,
  },

  // (c) Clean controls in verticals other than the existing two.
  {
    file: 'clean-coffee.png',
    type: 'png',
    html: `
      <style>${BASE_CSS}
        body { background: #3b2a1e; color: #f3e5d3; gap: 40px; }
        .cup { font-size: 360px; line-height: 1; }
        h1 { font-size: 104px; } h2 { font-size: 54px; color: #d9b892; }
      </style>
      <div class="cup">☕</div>
      <h1>FRESH ROASTED DAILY</h1>
      <h2>Downtown Coffee Co. — open 7am to 6pm</h2>`,
  },
  {
    file: 'clean-bookstore.png',
    type: 'png',
    html: `
      <style>${BASE_CSS}
        body { background: #12324a; color: #eaf2f8; gap: 40px; }
        .b { font-size: 340px; } h1 { font-size: 104px; } h2 { font-size: 56px; color: #8fc0e0; }
      </style>
      <div class="b">📚</div>
      <h1>SUMMER READING SALE</h1>
      <h2>20% off every paperback this week</h2>`,
  },
  {
    file: 'clean-plants.png',
    type: 'png',
    html: `
      <style>${BASE_CSS}
        body { background: #e9f3e4; color: #26401f; gap: 40px; }
        .p { font-size: 340px; } h1 { font-size: 104px; color: #3f7a2e; } h2 { font-size: 56px; }
      </style>
      <div class="p">🪴</div>
      <h1>THE PLANT SHOP</h1>
      <h2>New arrivals every Friday</h2>`,
  },
  {
    file: 'clean-shoes.png',
    type: 'png',
    html: `
      <style>${BASE_CSS}
        body { background: #1c1c24; color: #fff; gap: 40px; }
        .s { font-size: 320px; } h1 { font-size: 110px; color: #f05a3c; } h2 { font-size: 54px; }
      </style>
      <div class="s">👟</div>
      <h1>NEW ARRIVALS</h1>
      <h2>Trailblazer running shoes — $89</h2>`,
  },
  {
    file: 'clean-insurance.png',
    type: 'png',
    html: `
      <style>${BASE_CSS}
        body { background: #eef2fb; color: #1b2a4a; gap: 40px; padding: 80px; }
        .h { font-size: 300px; } h1 { font-size: 96px; color: #2c4c8c; } h2 { font-size: 54px; }
        .cta { background: #2c4c8c; color: #fff; font-size: 48px; font-weight: 700; padding: 26px 60px; border-radius: 14px; }
      </style>
      <div class="h">🏠</div>
      <h1>COMPARE HOME INSURANCE</h1>
      <h2>See quotes from top providers in minutes</h2>
      <div class="cta">Get a quote</div>`,
  },
];

async function main() {
  // Optional filename args render only those fixtures, so adding new ones does
  // not re-screenshot the existing files (which would change their bytes and
  // invalidate the recorded vision cache and image-tier baseline).
  const only = new Set(process.argv.slice(2));
  const selected = only.size > 0 ? FIXTURES.filter((f) => only.has(f.file)) : FIXTURES;
  if (only.size > 0 && selected.length !== only.size) {
    const known = new Set(FIXTURES.map((f) => f.file));
    const missing = [...only].filter((f) => !known.has(f));
    throw new Error(`unknown fixture(s): ${missing.join(', ')}`);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } });
  for (const fixture of selected) {
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
