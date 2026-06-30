import {
  clearAdminCookie,
  createAdminCookie,
  getExpectedAdminEmail,
  hasAdminKeyConfigured,
  isAdminSession,
  isEmailAllowed,
  validateAdminKey
} from '../_lib/adminAuth';

export const config = { runtime: 'edge' };

interface LoginBody {
  email?: string;
  key?: string;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') {
    const authenticated = await isAdminSession(req);
    return Response.json(
      {
        authenticated,
        adminEmail: getExpectedAdminEmail(),
        configured: hasAdminKeyConfigured()
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }

  if (req.method === 'POST') {
    let body: LoginBody;
    try {
      body = (await req.json()) as LoginBody;
    } catch {
      return new Response('Invalid JSON', { status: 400 });
    }

    const email = (body.email ?? '').trim().toLowerCase();
    const key = (body.key ?? '').trim();

    if (!isEmailAllowed(email) || !validateAdminKey(key)) {
      return new Response('Unauthorized', { status: 401 });
    }

    const setCookie = await createAdminCookie(req);
    if (!setCookie) {
      return new Response('Admin key not configured', { status: 500 });
    }

    return Response.json(
      { authenticated: true },
      {
        headers: {
          'Set-Cookie': setCookie,
          'Cache-Control': 'no-store'
        }
      }
    );
  }

  if (req.method === 'DELETE') {
    return Response.json(
      { authenticated: false },
      {
        headers: {
          'Set-Cookie': clearAdminCookie(req),
          'Cache-Control': 'no-store'
        }
      }
    );
  }

  return new Response('Method not allowed', {
    status: 405,
    headers: { Allow: 'GET, POST, DELETE' }
  });
}
