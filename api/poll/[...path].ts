/**
 * Vercel Edge function: same-origin proxy for image.pollinations.ai.
 *
 * Why: Pollinations occasionally CORS-blocks browser-origin requests, and
 * blocking on a 3rd-party CORS proxy chain is unreliable. Routing through
 * a same-origin edge function gives us:
 *   - Zero CORS configuration on the client.
 *   - Geographically-close edge cache hits (Vercel runs edge functions in
 *     ~20 regions worldwide).
 *   - Free under Vercel's hobby tier (1M edge requests / month).
 *
 * Path mapping (matches the Vite dev-server proxy in vite.config.ts):
 *   /api/poll/prompt/foo?width=720&height=1280
 *      \u2192 https://image.pollinations.ai/prompt/foo?width=720&height=1280
 *
 * Edge runtime is intentional \u2014 we're forwarding image bytes, no Node
 * APIs needed, and the edge runtime cold-starts in ~50 ms vs ~300 ms for
 * the Node runtime.
 */
export const config = { runtime: 'edge' };

const UPSTREAM = 'https://image.pollinations.ai';
// Only forward requests under these prefixes — stops the proxy being used
// as a generic GET tunnel into arbitrary upstream endpoints.
const ALLOWED_PREFIXES = ['/prompt/', '/models', '/feed'];

export default async function handler(req: Request): Promise<Response> {
  // Only safe, idempotent methods. Blocks the proxy from being abused as a
  // POST/DELETE relay against the upstream.
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response('Method not allowed', {
      status: 405,
      headers: { Allow: 'GET, HEAD' }
    });
  }

  const url = new URL(req.url);
  // Strip the leading "/api/poll" prefix so we hit the upstream's actual path.
  const upstreamPath = url.pathname.replace(/^\/api\/poll/, '') || '/';

  // Path allow-list. Without this the proxy would happily forward
  // /api/poll/anything-at-all through to image.pollinations.ai — fine for
  // legitimate use, but it gives anyone a free same-origin GET tunnel
  // they can use to hit expensive / rate-limited routes through your
  // Vercel edge quota.
  const allowed = ALLOWED_PREFIXES.some((p) => upstreamPath.startsWith(p));
  if (!allowed) {
    return new Response('Forbidden path', { status: 403 });
  }

  const target = `${UPSTREAM}${upstreamPath}${url.search}`;

  // Forward only the headers we trust. We deliberately do NOT forward the
  // client's Authorization header — a malicious page on the same origin
  // could otherwise use the proxy to exfiltrate any bearer token the user
  // pasted into a different app sharing this deployment. If/when upstream
  // auth is required, wire it in here from a server-side env var instead.
  const fwdHeaders: Record<string, string> = {
    Accept: req.headers.get('Accept') ?? 'image/*'
  };

  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers: fwdHeaders,
      redirect: 'follow'
    });

    if (!upstream.ok) {
      // Bubble the upstream status through so the client cascade can decide
      // whether to try the next provider.
      return new Response(`Upstream ${upstream.status}`, {
        status: upstream.status,
        headers: { 'Cache-Control': 'no-store' }
      });
    }

    // Stream the image back with aggressive edge caching \u2014 same prompt
    // + same seed deterministically returns the same image, so caching for
    // a day is safe and dramatically reduces upstream load on re-renders.
    const headers = new Headers();
    const ct = upstream.headers.get('Content-Type') ?? 'image/jpeg';
    headers.set('Content-Type', ct);
    headers.set('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400');
    headers.set('Access-Control-Allow-Origin', '*');

    return new Response(upstream.body, { status: 200, headers });
  } catch (err) {
    return new Response(`Proxy error: ${err instanceof Error ? err.message : 'unknown'}`, {
      status: 502,
      headers: { 'Cache-Control': 'no-store' }
    });
  }
}
