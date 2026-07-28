import { NextResponse } from 'next/server';
import { z } from 'zod';
import { analyze } from '@/lib/agent/orchestrator';
import { usageCostUSD } from '@/lib/claude';
import { IMAGE_MEDIA_TYPES } from '@/lib/inputs/vision';
import { MAX_COPY_CHARS } from '@/lib/limits';
import { checkRateLimit, dailySpendRemainingUSD, recordSpend } from '@/lib/rate-limit';

const MAX_REQUEST_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

const BodySchema = z
  .object({
    copy: z
      .string()
      .trim()
      .min(1, 'copy must not be empty')
      .max(MAX_COPY_CHARS, `copy is too long (${MAX_COPY_CHARS.toLocaleString()} characters max)`)
      .optional(),
    image: z
      .object({
        data: z.base64('image data must be base64'),
        media_type: z.enum(IMAGE_MEDIA_TYPES),
      })
      .optional(),
    url: z.url('url must be a valid http(s) URL').optional(),
  })
  .refine((b) => b.copy !== undefined || b.image !== undefined || b.url !== undefined, {
    message: 'provide at least one of copy, image, url',
  });

// The run makes several sequential model calls; well over default timeouts.
export const maxDuration = 120;

export async function POST(req: Request) {
  const ip = clientIp(req);
  const rateLimit = checkRateLimit(ip);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: `rate limit exceeded — try again in ${rateLimit.retryAfterSeconds}s` },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    );
  }
  if (dailySpendRemainingUSD() <= 0) {
    return NextResponse.json(
      { error: 'demo daily limit reached — check back tomorrow' },
      { status: 503 },
    );
  }

  const text = await req.text();
  if (text.length > MAX_REQUEST_BYTES) {
    return NextResponse.json({ error: 'request too large (10MB max)' }, { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: 'request body must be JSON' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join('; ');
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const { copy, image, url } = parsed.data;
  if (image && image.data.length * 0.75 > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: 'image too large (5MB max)' }, { status: 400 });
  }

  const costBefore = usageCostUSD();

  // The orchestrator runs several sequential model calls and can take up to
  // ~90s. With no bytes on the wire in that window, VPNs and corporate
  // proxies that kill idle connections past ~60s drop the client before the
  // response ever arrives, even though the request succeeds server-side.
  // Sending a periodic heartbeat keeps the connection alive end to end.
  const HEARTBEAT_MS = 10000;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      const interval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode('\n'));
        } catch {
          // controller already closed; next tick's clearInterval will stop this
        }
      }, HEARTBEAT_MS);

      (async () => {
        try {
          const result = await analyze({
            copy,
            image: image ? { data: image.data, mediaType: image.media_type } : undefined,
            url,
          });
          controller.enqueue(encoder.encode(JSON.stringify(result) + '\n'));
        } catch (err) {
          console.error('analyze failed:', err);
          controller.enqueue(encoder.encode(JSON.stringify({ error: 'analysis failed' }) + '\n'));
        } finally {
          clearInterval(interval);
          recordSpend(usageCostUSD() - costBefore);
          controller.close();
        }
      })();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
