/**
 * Vercel Edge function: same-origin proxy for lexica.art's search API.
 * Twin of /api/poll \u2014 see that file for the rationale.
 *
 * Path mapping:
 *   /api/lexica/v1/search?q=cat
 *      \u2192 https://lexica.art/api/v1/search?q=cat
 */
export const config = { runtime: 'edge' };

const UPSTREAM = 'https://lexica.art/api';
// Only the search endpoint is needed by the client.
const ALLOWED_PREFIXES = ['/v1/search'];

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response('Method not allowed', {
      status: 405,
      headers: { Allow: 'GET, HEAD' }
    });
  }

  const url = new URL(req.url);
  const upstreamPath = url.pathname.replace(/^\/api\/lexica/, '') || '/';
  if (!ALLOWED_PREFIXES.some((p) => upstreamPath.startsWith(p))) {
    return new Response('Forbidden path', { status: 403 });
  }
  const target = `${UPSTREAM}${upstreamPath}${url.search}`;

  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers: { Accept: 'application/json' },
      redirect: 'follow'
    });

    if (!upstream.ok) {
      return new Response(`Upstream ${upstream.status}`, {
        status: upstream.status,
        headers: { 'Cache-Control': 'no-store' }
      });
    }

    const body = await upstream.text();
    const headers = new Headers();
    headers.set('Content-Type', upstream.headers.get('Content-Type') ?? 'application/json');
    // Lexica search results for the same query are stable enough that
    // 1 hour at the edge is a good tradeoff between freshness and cost.
    headers.set('Cache-Control', 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400');
    headers.set('Access-Control-Allow-Origin', '*');

    return new Response(body, { status: 200, headers });
  } catch (err) {
    return new Response(`Proxy error: ${err instanceof Error ? err.message : 'unknown'}`, {
      status: 502,
      headers: { 'Cache-Control': 'no-store' }
    });
  }
}
