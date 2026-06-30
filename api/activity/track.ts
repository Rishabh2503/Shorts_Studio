import { addActivity, type ActivityEvent } from '../_lib/runtimeStore';

export const config = { runtime: 'edge' };

interface TrackBody {
  sessionId?: string;
  type?: string;
  path?: string;
  ts?: number;
  meta?: Record<string, unknown>;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', {
      status: 405,
      headers: { Allow: 'POST' }
    });
  }

  let body: TrackBody;
  try {
    body = (await req.json()) as TrackBody;
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  if (!body.sessionId || !body.type) {
    return new Response('Missing sessionId/type', { status: 400 });
  }

  const event: ActivityEvent = {
    id: crypto.randomUUID(),
    sessionId: body.sessionId,
    type: body.type,
    path: body.path ?? '/',
    ts: typeof body.ts === 'number' ? body.ts : Date.now(),
    meta: body.meta
  };

  addActivity(event);

  return Response.json({ ok: true });
}
