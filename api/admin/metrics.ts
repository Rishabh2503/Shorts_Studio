import { getMetrics } from '../_lib/runtimeStore';
import { isAdminSession } from '../_lib/adminAuth';

export const config = { runtime: 'edge' };

async function isAuthorized(req: Request): Promise<boolean> {
  if (await isAdminSession(req)) return true;

  const expected = process.env.ADMIN_DASHBOARD_KEY;
  const provided =
    req.headers.get('x-admin-key') ??
    new URL(req.url).searchParams.get('key') ??
    '';

  if (!expected) {
    // Safe local fallback: if no server-side key is configured, reject.
    return false;
  }
  return provided === expected;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') {
    return new Response('Method not allowed', {
      status: 405,
      headers: { Allow: 'GET' }
    });
  }

  if (!(await isAuthorized(req))) {
    return new Response('Unauthorized', { status: 401 });
  }

  return Response.json(getMetrics(), {
    headers: { 'Cache-Control': 'no-store' }
  });
}
