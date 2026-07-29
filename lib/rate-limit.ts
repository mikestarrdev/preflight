// In-memory demo-cost protection for the public analyze endpoint: a per-IP
// request cap and a daily spend ceiling. Both live in process memory, so a
// redeploy, a cold start, or Vercel routing a request to a different instance
// resets or fragments the counters — a determined abuser could get around
// this. Acceptable for a portfolio demo; see README for the caveat.

import { timingSafeEqual } from 'node:crypto';

const BYPASS_HEADER = 'x-preflight-bypass';

// Shared-secret escape hatch for running the test suite against prod without
// tripping the per-IP limit — an IP allowlist doesn't work behind a rotating
// VPN. Header only, never a query param, so it can't end up in access logs
// or browser history. Unset/empty token means the bypass is off; it must
// never fall open.
export function hasValidBypassToken(req: Request): boolean {
  const expected = process.env.RATE_LIMIT_BYPASS_TOKEN;
  if (!expected) return false;

  const provided = req.headers.get(BYPASS_HEADER);
  if (!provided) return false;

  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  if (expectedBuf.length !== providedBuf.length) return false;

  return timingSafeEqual(expectedBuf, providedBuf);
}

const WINDOW_MS = 60 * 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 5;

const LOCALHOST_IPS = new Set(['127.0.0.1', '::1']);

const requestLog = new Map<string, number[]>();

function isBypassed(ip: string): boolean {
  if (process.env.DISABLE_RATE_LIMIT === '1') return true;
  if (process.env.NODE_ENV === 'development') return true;
  return LOCALHOST_IPS.has(ip);
}

export function checkRateLimit(ip: string): { allowed: boolean; retryAfterSeconds: number } {
  if (isBypassed(ip)) return { allowed: true, retryAfterSeconds: 0 };
  const now = Date.now();
  const recent = (requestLog.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_REQUESTS_PER_WINDOW) {
    const retryAfterSeconds = Math.ceil((recent[0] + WINDOW_MS - now) / 1000);
    return { allowed: false, retryAfterSeconds };
  }
  recent.push(now);
  requestLog.set(ip, recent);
  return { allowed: true, retryAfterSeconds: 0 };
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function defaultCeilingUSD(): number {
  const raw = Number(process.env.DEMO_DAILY_SPEND_CEILING_USD);
  return Number.isFinite(raw) && raw > 0 ? raw : 5;
}

let spendDate = today();
let spentTodayUSD = 0;

function rollDay(): void {
  const d = today();
  if (d !== spendDate) {
    spendDate = d;
    spentTodayUSD = 0;
  }
}

export function dailySpendRemainingUSD(): number {
  rollDay();
  return defaultCeilingUSD() - spentTodayUSD;
}

export function recordSpend(usd: number): void {
  rollDay();
  spentTodayUSD += usd;
}
