import { NextResponse } from 'next/server';
import { z } from 'zod';
import { analyze } from '@/lib/agent/orchestrator';
import { IMAGE_MEDIA_TYPES } from '@/lib/inputs/vision';

const MAX_REQUEST_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const BodySchema = z
  .object({
    copy: z.string().trim().min(1, 'copy must not be empty').max(5000, 'copy too long').optional(),
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
    return NextResponse.json({ error: z.prettifyError(parsed.error) }, { status: 400 });
  }

  const { copy, image, url } = parsed.data;
  if (image && image.data.length * 0.75 > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: 'image too large (5MB max)' }, { status: 400 });
  }

  try {
    const result = await analyze({
      copy,
      image: image ? { data: image.data, mediaType: image.media_type } : undefined,
      url,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error('analyze failed:', err);
    return NextResponse.json({ error: 'analysis failed' }, { status: 500 });
  }
}
