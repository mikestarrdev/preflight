import { NextResponse } from 'next/server';
import { z } from 'zod';
import { analyze } from '@/lib/agent/orchestrator';

const BodySchema = z.object({
  copy: z.string().trim().min(1, 'copy must not be empty').max(5000, 'copy too long'),
});

// The run makes several sequential model calls; well over default timeouts.
export const maxDuration = 120;

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'request body must be JSON' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: z.prettifyError(parsed.error) }, { status: 400 });
  }

  try {
    const result = await analyze(parsed.data.copy);
    return NextResponse.json(result);
  } catch (err) {
    console.error('analyze failed:', err);
    return NextResponse.json({ error: 'analysis failed' }, { status: 500 });
  }
}
