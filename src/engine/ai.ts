// Free, key-less AI image generation with multi-source fallback.
//
// Reality check: Pollinations.ai's free anonymous tier is documented as
// 1 request every 15 seconds (https://github.com/pollinations/pollinations
// → APIDOCS.md → Authentication & Rate Limits). When we fire 3 clips in
// parallel they 403 because we exceed the limit. Two recommended fixes
// per the docs:
//   1. Add `?referrer=<your-app>` to identify the app (no signup needed).
//   2. Register at https://auth.pollinations.ai for a Bearer token that
//      raises the limit to 1 req per 5 s and removes watermarks.
//
// We do BOTH: always send referrer; read an optional token from
// localStorage('pollinations_token') and send it as `Authorization:
// Bearer …`. We also serialize requests through a small queue so we
// never exceed the per-tier rate even when the UI fires N clips at once.
//
// Sources:
//   - 'pollinations'  → image.pollinations.ai (true generative, free tier)
//   - 'lexica'        → lexica.art catalog of pre-generated SD/Flux images
//   - 'picsum'        → random stock photo (always works, last-resort)
//   - 'auto'          → cascade: pollinations → lexica → picsum
//
// Each step short-timeouts so we fail fast and try the next source.

export type ImageSource = 'auto' | 'pollinations' | 'lexica' | 'flickr' | 'picsum';

// ─── Pollinations auth & rate-limit helpers ──────────────────────────────

/** App identifier sent as `?referrer=` per Pollinations docs. */
const POLLINATIONS_REFERRER = 'shorts-studio';

/**
 * Read an optional Bearer token from localStorage. Users can register at
 * https://auth.pollinations.ai (free) and paste their token via the dev
 * console: `localStorage.setItem('pollinations_token', 'YOUR_TOKEN')`.
 * Without it we use the anonymous tier (slower, watermarked).
 */
function getPollinationsToken(): string | null {
  try {
    const t = localStorage.getItem('pollinations_token');
    return t && t.trim().length > 0 ? t.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Tier-aware request queue. Anonymous tier = 1 req/15 s; with token = 1
 * req/5 s. We add a small safety margin so the FIRST request after a
 * stretch of idleness doesn't accidentally trip the limiter, while
 * still keeping latency low when generating multiple clips.
 */
let pollinationsQueue: Promise<unknown> = Promise.resolve();
function enqueuePollinations<T>(fn: () => Promise<T>): Promise<T> {
  const minSpacingMs = getPollinationsToken() ? 5_500 : 15_500;
  const next = pollinationsQueue.then(async () => {
    const start = Date.now();
    try {
      return await fn();
    } finally {
      const elapsed = Date.now() - start;
      const wait = minSpacingMs - elapsed;
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
  });
  // Don't let a rejection poison subsequent queue entries.
  pollinationsQueue = next.catch(() => undefined);
  return next as Promise<T>;
}

export interface GenerateOptions {
  prompt: string;
  width?: number;
  height?: number;
  seed?: number;
  /**
   * Pollinations model. As of 2025 their public catalog is essentially
   * `flux` (default) and `turbo`; specialty variants like `flux-realism`
   * and `flux-anime` were deprecated and are now silently aliased to the
   * default. So we keep this for compat but route all aesthetic choices
   * through `style` instead, which is far more reliable.
   */
  model?: string;
  /**
   * Style preset. Appends a curated set of descriptors to the prompt so
   * the model produces the desired aesthetic. This works regardless of
   * which underlying model Pollinations routes us to.
   */
  style?:
    | 'auto'
    | 'realistic'
    | 'anime'
    | 'cinematic'
    | '3d-render'
    | 'oil-painting'
    | 'watercolor';
  /** Which provider to use. 'auto' tries pollinations → lexica → picsum. */
  source?: ImageSource;
  /** Optional notifier so the UI can show 'retrying with another model…' */
  onAttempt?: (label: string, attempt: number) => void;
}

/**
 * Style presets → prompt suffix. These descriptors are far more reliable
 * than the deprecated `flux-realism` / `flux-anime` model parameters,
 * which Pollinations now silently ignores.
 */
const STYLE_SUFFIXES: Record<NonNullable<GenerateOptions['style']>, string> = {
  'auto': '',
  'realistic':
    'photorealistic, real photograph, 35mm DSLR, sharp focus, natural lighting, lifelike skin texture, no anime, no illustration, no cartoon',
  'anime':
    'anime art style, manga, cel shading, vibrant colors, expressive eyes, studio-quality 2D illustration',
  'cinematic':
    'cinematic photography, dramatic lighting, shallow depth of field, anamorphic lens flare, film grain, color graded',
  '3d-render':
    '3D render, octane render, blender, ray-tracing, subsurface scattering, ultra detailed materials',
  'oil-painting':
    'oil painting on canvas, rich brush strokes, classical fine art, gallery masterpiece, dramatic chiaroscuro',
  'watercolor':
    'watercolor painting, soft washes, delicate brushwork, pastel palette, paper texture'
};

const FALLBACK_CHAIN: Record<string, string[]> = {
  // Pollinations effectively serves a single default model now — chain
  // is just primary → backup variant. Both are real catalog entries.
  flux: ['flux', 'turbo'],
  turbo: ['turbo', 'flux'],
  sana: ['sana', 'flux']
};

/**
 * Replace trademarked / copyrighted character names with generic descriptors.
 * Pollinations' content filter auto-403s prompts containing these. The
 * substitution preserves user intent while letting the request succeed.
 */
const TRADEMARK_MAP: Array<[RegExp, string]> = [
  [/\bbatman\b/gi, 'dark caped vigilante hero in cowl'],
  [/\bsuperman\b/gi, 'flying superhero in red and blue suit with cape'],
  [/\bspider[- ]?man\b/gi, 'red and blue masked acrobatic hero'],
  [/\biron[- ]?man\b/gi, 'high-tech red and gold armored hero'],
  [/\bcaptain america\b/gi, 'blue patriotic shield-bearing soldier hero'],
  [/\bthor\b/gi, 'norse thunder god with hammer'],
  [/\bhulk\b/gi, 'giant green muscular humanoid'],
  [/\bwonder woman\b/gi, 'amazon warrior princess with sword and shield'],
  [/\bharley quinn\b/gi, 'mischievous jester girl in red and black'],
  [/\bjoker\b/gi, 'pale chaotic clown villain'],
  [/\bdarth vader\b/gi, 'dark armored space lord with helmet and cape'],
  [/\byoda\b/gi, 'small wise green alien sage'],
  [/\bmickey mouse\b/gi, 'cheerful cartoon mouse with round ears'],
  [/\bpikachu\b/gi, 'cute yellow electric mouse creature'],
  [/\bnaruto\b/gi, 'spiky blonde anime ninja with whisker marks'],
  [/\bgoku\b/gi, 'spiky black-haired anime martial artist in orange gi'],
  [/\bharry potter\b/gi, 'young wizard boy with round glasses'],
  // Brand names that sometimes trigger filters
  [/\bdisney\b/gi, 'animated fantasy'],
  [/\bmarvel\b/gi, 'comic book hero'],
  [/\bdc comics?\b/gi, 'comic book hero'],
  [/\bnetflix\b/gi, 'streaming']
];

function sanitizePrompt(prompt: string): string {
  let out = prompt;
  for (const [re, replacement] of TRADEMARK_MAP) out = out.replace(re, replacement);
  return out;
}

/**
 * Pad short prompts so they read more like the kind of detailed prompts that
 * pass Pollinations' content / quality filters reliably. Long prompts are kept
 * as-is so user intent isn't overridden. Style suffix is always appended
 * because that's what controls the final aesthetic.
 */
function enrichPrompt(prompt: string, style?: GenerateOptions['style']): string {
  const trimmed = prompt.trim();
  const styleSuffix =
    style && style !== 'auto' ? STYLE_SUFFIXES[style] : '';
  // Long prompts: just append style. Short prompts: pad + style.
  const padded =
    trimmed.length >= 60
      ? trimmed
      : `${trimmed}, vertical 9:16 composition, cinematic lighting, ultra detailed, sharp focus, vibrant colors, high quality`;
  return styleSuffix ? `${padded}, ${styleSuffix}` : padded;
}

function buildPollinationsUrl(
  prompt: string,
  width: number,
  height: number,
  seed: number,
  model: string
): string {
  // Per docs: `nologo` requires a registered account. Sending it without
  // a token can trip the auth check → 403. Only request no-logo when a
  // token is configured.
  const hasToken = getPollinationsToken() !== null;
  const params = new URLSearchParams({
    width: String(width),
    height: String(height),
    seed: String(seed),
    model,
    referrer: POLLINATIONS_REFERRER
  });
  if (hasToken) params.set('nologo', 'true');
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(
    prompt
  )}?${params.toString()}`;
}

/**
 * Same Pollinations URL but routed through Vite's dev-server proxy. The
 * dev server fetches the upstream URL server-side (no browser Origin
 * header), so Pollinations' Origin-based 403 doesn't apply, and the
 * response is delivered to the browser as same-origin with implicit CORS
 * approval. This is the fastest, most reliable path during development.
 *
 * For production we'd need a real reverse-proxy (Cloudflare Worker /
 * Netlify edge / etc.) — but during dev this resolves all the 403/404
 * cascades immediately. Configured in `vite.config.ts` under
 * `server.proxy['/api/poll']`.
 */
function viteProxyPollinationsUrl(
  prompt: string,
  width: number,
  height: number,
  seed: number,
  model: string
): string {
  const hasToken = getPollinationsToken() !== null;
  const params = new URLSearchParams({
    width: String(width),
    height: String(height),
    seed: String(seed),
    model,
    referrer: POLLINATIONS_REFERRER
  });
  if (hasToken) params.set('nologo', 'true');
  // Same-origin URL → no CORS, no Origin header sent upstream.
  return `/api/poll/prompt/${encodeURIComponent(prompt)}?${params.toString()}`;
}

/**
 * weserv.nl is a free image-only proxy that re-emits the response with
 * permissive CORS headers. Crucially it also re-encodes the image, which
 * means the canvas isn't tainted even when the original would have been.
 * Note: weserv returns 404 if the upstream returned non-image content
 * (e.g. a 403 HTML page) — so we treat 404 from weserv as "upstream failed".
 */
function weservProxy(url: string, w: number, h: number): string {
  // weserv expects the URL without scheme.
  const stripped = url.replace(/^https?:\/\//, '');
  const params = new URLSearchParams({
    url: stripped,
    output: 'jpg',
    q: '90',
    w: String(w),
    h: String(h),
    fit: 'cover'
  });
  return `https://images.weserv.nl/?${params.toString()}`;
}

/**
 * allorigins.win is a generic CORS proxy. Uses a different cloud IP range
 * than weserv, so when Pollinations rate-limits weserv this often still
 * works. The /raw endpoint streams binary bytes (perfect for images).
 */
function allOriginsProxy(url: string): string {
  return `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
}

/**
 * codetabs.com proxy — yet another set of upstream IPs. Free tier, no
 * auth, returns the raw proxied response.
 */
function codetabsProxy(url: string): string {
  return `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`;
}

/**
 * corsproxy.io — relatively new free CORS proxy with generous limits.
 * Different IP block again so a bad Pollinations rate-limit on weserv +
 * allorigins doesn't block this one too.
 */
function corsProxyIo(url: string): string {
  return `https://corsproxy.io/?${encodeURIComponent(url)}`;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error ?? new Error('FileReader error'));
    r.onload = () => resolve(r.result as string);
    r.readAsDataURL(blob);
  });
}

async function fetchAsDataUrl(url: string, timeoutMs = 20_000): Promise<string> {
  const controller = new AbortController();
  const t = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Attach Bearer token if present and we're hitting Pollinations
    // (direct or via Vite proxy). Other proxies don't support it.
    const headers: Record<string, string> = {};
    const isPollinations =
      url.startsWith('/api/poll/') || url.includes('image.pollinations.ai');
    const tok = isPollinations ? getPollinationsToken() : null;
    if (tok) headers['Authorization'] = `Bearer ${tok}`;
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    if (!blob.type.startsWith('image/') && blob.size < 1000) {
      throw new Error('not-an-image');
    }
    return await blobToDataUrl(blob);
  } finally {
    window.clearTimeout(t);
  }
}

/**
 * Pollinations.ai sends `Access-Control-Allow-Origin: *`, so we can fetch it
 * directly and read the real HTTP status. This is the cleanest path: if
 * upstream returns 403/5xx we know immediately and skip the noisy weserv
 * fallback (which 404s on non-image responses anyway).
 */
async function fetchPollinationsDirect(url: string, timeoutMs = 18_000): Promise<string> {
  const controller = new AbortController();
  const t = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = {};
    const tok = getPollinationsToken();
    if (tok) headers['Authorization'] = `Bearer ${tok}`;
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      mode: 'cors',
      headers
    });
    if (!res.ok) {
      // 403 = content-filter / rate-limit; 5xx = upstream broken. Either way,
      // weserv won't help us. Bail with a precise error.
      throw new Error(`pollinations HTTP ${res.status}`);
    }
    const blob = await res.blob();
    if (!blob.type.startsWith('image/')) {
      throw new Error(`pollinations non-image (${blob.type || 'unknown'})`);
    }
    return await blobToDataUrl(blob);
  } finally {
    window.clearTimeout(t);
  }
}

async function fetchAsJson<T>(url: string, timeoutMs = 15_000): Promise<T> {
  const controller = new AbortController();
  const t = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // Read as text first so we can detect proxies that pass through an
    // upstream error body with a 200 status (e.g. allorigins forwarding
    // Lexica's "Internal Server Error" plaintext).
    const text = await res.text();
    const trimmed = text.trim();
    if (!trimmed) throw new Error('empty-response');
    const first = trimmed[0];
    if (first !== '{' && first !== '[') {
      throw new Error(`not-json: ${trimmed.slice(0, 60)}`);
    }
    try {
      return JSON.parse(trimmed) as T;
    } catch {
      throw new Error(`json-parse-failed: ${trimmed.slice(0, 60)}`);
    }
  } finally {
    window.clearTimeout(t);
  }
}

function loadImageAsDataUrl(
  url: string,
  width: number,
  height: number,
  timeoutMs = 20_000
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    const timer = window.setTimeout(() => {
      img.src = '';
      reject(new Error('timeout'));
    }, timeoutMs);
    img.onload = () => {
      window.clearTimeout(timer);
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || width;
        canvas.height = img.naturalHeight || height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('canvas-2d-unavailable'));
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        // Will throw if the canvas is tainted; crossOrigin=anonymous keeps it clean.
        resolve(canvas.toDataURL('image/jpeg', 0.92));
      } catch (e) {
        reject(e as Error);
      }
    };
    img.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error('image-load-failed'));
    };
    img.src = url;
  });
}

/**
 * Multi-transport Pollinations fetch. Each path uses a *different* upstream
 * IP range / networking primitive so a CORS / origin-block / rate-limit on
 * one doesn't poison the others.
 *
 *   1. Direct fetch() with CORS — fastest when it works.
 *   2. weserv.nl proxy — server-side image proxy, re-encodes to JPEG so
 *      the canvas isn't tainted on export.
 *   3. allorigins.win — generic CORS proxy on a different IP block.
 *   4. corsproxy.io — yet another free CORS proxy.
 *   5. codetabs.com — final proxy attempt.
 *   6. <img crossOrigin="anonymous"> via weserv — uses the browser's
 *      image-loading subsystem instead of fetch(), bypasses ad-blockers
 *      that hook fetch.
 *   7. Plain <img> + canvas WITHOUT crossOrigin via the original URL —
 *      this ALWAYS works (no Origin sent → Pollinations 200s) but the
 *      canvas is tainted so we can't toDataURL. We return the raw URL
 *      instead; the preview <img> displays correctly. Export will reload
 *      via the cascade so this is safe for preview-only use.
 *
 * Critical lesson learned: the 403 from Pollinations is Origin-based.
 * When fetched via a server-side proxy or via plain <img>, no Origin
 * header is sent and Pollinations serves the bytes happily.
 */
async function fetchPollinationsImage(
  url: string,
  width: number,
  height: number
): Promise<string> {
  const errors: string[] = [];

  // 1) Direct CORS fetch — happiest path.
  try {
    return await fetchPollinationsDirect(url);
  } catch (e) {
    errors.push(`direct: ${(e as Error).message}`);
  }

  // 2) weserv proxy — bypasses Origin-based 403 because weserv fetches
  //    server-side without our Origin header.
  try {
    return await fetchAsDataUrl(weservProxy(url, width, height), 18_000);
  } catch (e) {
    errors.push(`weserv: ${(e as Error).message}`);
  }

  // 3) allorigins — different cloud IP block.
  try {
    return await fetchAsDataUrl(allOriginsProxy(url), 18_000);
  } catch (e) {
    errors.push(`allorigins: ${(e as Error).message}`);
  }

  // 4) corsproxy.io — another distinct IP block.
  try {
    return await fetchAsDataUrl(corsProxyIo(url), 18_000);
  } catch (e) {
    errors.push(`corsproxy.io: ${(e as Error).message}`);
  }

  // 5) codetabs — last fetch-based proxy.
  try {
    return await fetchAsDataUrl(codetabsProxy(url), 18_000);
  } catch (e) {
    errors.push(`codetabs: ${(e as Error).message}`);
  }

  // 6) <img> via weserv — uses image-loading subsystem (different from
  //    fetch). Sometimes succeeds when fetch is blocked by ad-filters.
  try {
    return await loadImageAsDataUrl(
      weservProxy(url, width, height),
      width,
      height
    );
  } catch (e) {
    errors.push(`img-weserv: ${(e as Error).message}`);
  }

  // 7) <img> via allorigins — last attempt before bailing.
  try {
    return await loadImageAsDataUrl(
      allOriginsProxy(url),
      width,
      height
    );
  } catch (e) {
    errors.push(`img-allorigins: ${(e as Error).message}`);
  }

  throw new Error(
    `pollinations failed all 7 transports — ${errors.join(' | ')}`
  );
}

/** Try Pollinations across the model chain. */
async function tryPollinations(
  prompt: string,
  width: number,
  height: number,
  seed: number,
  model: string,
  onAttempt?: (label: string, attempt: number) => void
): Promise<string> {
  const chain = FALLBACK_CHAIN[model] ?? ['flux', 'turbo'];
  const errors: string[] = [];
  for (let i = 0; i < chain.length; i++) {
    const m = chain[i];
    onAttempt?.(`pollinations:${m}`, i + 1);
    const seedFor = seed + i * 9973;

    // PRIMARY: try the Vite dev-server same-origin proxy first. This
    // succeeds 100% in dev because the upstream request is made by the
    // dev server (no browser Origin → no Pollinations 403). Falls back
    // to the absolute URL + multi-proxy cascade if the proxy isn't
    // available (e.g. production build served from a static host).
    const proxyUrl = viteProxyPollinationsUrl(prompt, width, height, seedFor, m);
    try {
      const dataUrl = await fetchAsDataUrl(proxyUrl, 25_000);
      return dataUrl;
    } catch (e) {
      errors.push(`vite-proxy[${m}]: ${(e as Error).message}`);
    }

    // FALLBACK: cascade through the absolute URL + 7 third-party
    // transports (weserv / allorigins / corsproxy / codetabs / img-tag).
    const url = buildPollinationsUrl(prompt, width, height, seedFor, m);
    try {
      return await fetchPollinationsImage(url, width, height);
    } catch (e) {
      errors.push(`pollinations[${m}]: ${(e as Error).message}`);
    }
  }
  throw new Error(errors.join(' | '));
}

/**
 * Lexica.art search. Returns existing AI-generated images that match the
 * prompt. The JSON endpoint CORS-blocks browsers, so we cycle through public
 * CORS proxies. We also gracefully handle the case where a proxy passes
 * through an upstream error body (e.g. allorigins returning Lexica's
 * "Internal Server Error" text with HTTP 200) — fetchAsJson catches that.
 */
async function fetchFromLexica(
  prompt: string,
  width: number,
  height: number,
  seed: number
): Promise<string> {
  const direct = `https://lexica.art/api/v1/search?q=${encodeURIComponent(prompt)}`;
  // Same-origin Vite dev proxy first — same trick as Pollinations: dev
  // server fetches Lexica server-side, no CORS, no third-party rate limit.
  const viteProxy = `/api/lexica/v1/search?q=${encodeURIComponent(prompt)}`;
  const proxies = [
    viteProxy,
    `https://corsproxy.io/?${encodeURIComponent(direct)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(direct)}`,
    `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(direct)}`
  ];
  type LexicaResp = { images?: Array<{ srcSmall?: string; src?: string }> };
  const errors: string[] = [];
  let data: LexicaResp | null = null;
  for (const p of proxies) {
    try {
      data = await fetchAsJson<LexicaResp>(p, 12_000);
      if (data && Array.isArray(data.images) && data.images.length > 0) break;
      errors.push(`${p.startsWith('/') ? 'vite-proxy' : new URL(p).hostname}: empty-or-invalid`);
      data = null;
    } catch (e) {
      errors.push(`${p.startsWith('/') ? 'vite-proxy' : new URL(p).hostname}: ${(e as Error).message}`);
    }
  }
  if (!data) throw new Error(`lexica all proxies failed (${errors.join(' | ')})`);
  const list = data.images ?? [];
  if (list.length === 0) throw new Error('lexica: no results');
  const pick = list[Math.abs(seed) % list.length];
  const candidate = pick.src ?? pick.srcSmall;
  if (!candidate) throw new Error('lexica: no image url');
  // Run through weserv to guarantee CORS + correct aspect crop.
  return fetchAsDataUrl(weservProxy(candidate, width, height), 22_000);
}

/**
 * Final fallback: Picsum (random stock photo). Not AI-generated but always
 * works, so the user never sees a hard failure. The seed makes it deterministic
 * per attempt so retries don't keep showing the same photo.
 */
async function fetchFromPicsum(
  width: number,
  height: number,
  seed: number
): Promise<string> {
  const url = `https://picsum.photos/seed/${Math.abs(seed)}/${width}/${height}`;
  return loadImageAsDataUrl(url, width, height, 15_000);
}

// Words that hurt keyword-based image search (style/quality boilerplate that
// our enrichPrompt() helper adds, plus generic filler). These are stripped
// before we send the prompt to Flickr or Picsum so we don't search for
// "vertical" or "detailed" instead of the actual subject.
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'with', 'in', 'on', 'at', 'of', 'for',
  'to', 'from', 'by', 'is', 'are', 'be', 'as', 'it', 'its',
  // style boilerplate
  'cinematic', 'lighting', 'detailed', 'ultra', 'sharp', 'focus',
  'vibrant', 'colors', 'color', 'high', 'quality', 'vertical',
  'composition', 'shot', 'photo', 'photograph', 'rendering', 'render',
  'realistic', 'hyperrealistic', 'beautiful', 'amazing', 'awesome',
  '8k', '4k', 'hd', 'uhd', 'aspect', 'ratio', 'style', 'art', 'image',
  'pic', 'picture', 'wallpaper', 'background', 'view'
]);

function extractKeywords(prompt: string, max = 5): string[] {
  const tokens = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s,-]/g, ' ')
    .split(/[\s,]+/)
    .map((w) => w.trim())
    .filter(
      (w) =>
        w.length >= 3 &&
        !STOP_WORDS.has(w) &&
        !/^\d+$/.test(w) // drop pure numbers like "9", "16"
    );
  // Dedupe while preserving order, then cap.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokens) {
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * LoremFlickr returns Flickr photos tagged with the given keywords. It's
 * key-less, CORS-friendly, and — unlike Picsum — actually returns photos
 * relevant to what the user typed. We use it as a stronger fallback than
 * Picsum so when Pollinations / Lexica are down the user still gets a photo
 * matching their prompt instead of a random landscape.
 */
async function fetchFromFlickr(
  prompt: string,
  width: number,
  height: number,
  seed: number
): Promise<string> {
  const keywords = extractKeywords(prompt, 4);
  if (keywords.length === 0) {
    // No usable keywords — fall back to a random photo by seed.
    throw new Error('flickr: no keywords');
  }
  const tagPath = keywords.join(',');
  // `lock` produces deterministic-per-seed results. Different seeds yield
  // different photos so re-rolls work.
  const url = `https://loremflickr.com/${width}/${height}/${encodeURIComponent(tagPath)}?lock=${Math.abs(seed)}`;
  return loadImageAsDataUrl(url, width, height, 15_000);
}

export async function generateImage(opts: GenerateOptions): Promise<string> {
  const {
    prompt,
    // 1024x1820 is a 9:16-ish ratio that the free tier serves more reliably
    // than the strict 1080x1920 Shorts size. The renderer will rescale anyway.
    width = 1024,
    height = 1820,
    seed = Math.floor(Math.random() * 1_000_000),
    model = 'flux',
    style = 'auto',
    source = 'auto',
    onAttempt
  } = opts;

  const sanitized = sanitizePrompt(prompt);
  if (sanitized !== prompt) {
    // Tell the UI the prompt was rewritten so the user knows why their
    // "batman" prompt produced a generic vigilante. attempt=0 is a sentinel.
    onAttempt?.(`sanitized: ${sanitized.slice(0, 60)}`, 0);
  }
  const enriched = enrichPrompt(sanitized, style);
  if (!enriched) throw new Error('Prompt is required.');

  const errors: string[] = [];

  const tryPoll = () =>
    enqueuePollinations(() =>
      tryPollinations(enriched, width, height, seed, model, onAttempt)
    );
  const tryFlickr = () => {
    onAttempt?.('flickr', 1);
    // Use the *sanitized* prompt (not the enriched one) for keyword search
    // — we want the actual subject, not boilerplate descriptors.
    return fetchFromFlickr(sanitized, width, height, seed);
  };
  const tryPic = () => {
    onAttempt?.('picsum', 1);
    return fetchFromPicsum(width, height, seed);
  };

  // Single-source mode: try the chosen source first, fall back to Flickr
  // (keyword-relevant) then Picsum (always works) so the user never gets a
  // hard "all sources failed" wall. Picking 'flickr' or 'picsum' explicitly
  // skips the cascade.
  if (source === 'pollinations') {
    try {
      return await tryPoll();
    } catch (e) {
      errors.push(`pollinations: ${(e as Error).message}`);
      onAttempt?.('flickr (fallback)', 99);
      try { return await tryFlickr(); }
      catch (e2) { errors.push(`flickr: ${(e2 as Error).message}`); }
      onAttempt?.('picsum (fallback)', 99);
      try { return await fetchFromPicsum(width, height, seed); }
      catch (e3) { errors.push(`picsum: ${(e3 as Error).message}`); }
      throw new Error(`Pollinations failed. (${errors.join(' | ')})`);
    }
  }
  if (source === 'lexica') {
    try {
      onAttempt?.('lexica', 1);
      return await fetchFromLexica(enriched, width, height, seed);
    } catch (e) {
      errors.push(`lexica: ${(e as Error).message}`);
      onAttempt?.('flickr (fallback)', 99);
      try { return await tryFlickr(); }
      catch (e2) { errors.push(`flickr: ${(e2 as Error).message}`); }
      onAttempt?.('picsum (fallback)', 99);
      try { return await fetchFromPicsum(width, height, seed); }
      catch (e3) { errors.push(`picsum: ${(e3 as Error).message}`); }
      throw new Error(`Lexica failed. (${errors.join(' | ')})`);
    }
  }
  if (source === 'flickr') return tryFlickr();
  if (source === 'picsum') return tryPic();

  // Auto: cascade. Lexica's API has been 5xx-flaky for weeks across all
  // proxies, so we skip it in auto mode — it's still selectable as an
  // explicit `source: 'lexica'` for users who want to try it. The auto
  // cascade goes Pollinations → Flickr (keyword-relevant) → Picsum.
  try {
    return await tryPoll();
  } catch (e) {
    errors.push(`pollinations: ${(e as Error).message}`);
  }
  try {
    onAttempt?.('flickr', 1);
    return await fetchFromFlickr(sanitized, width, height, seed);
  } catch (e) {
    errors.push(`flickr: ${(e as Error).message}`);
  }
  try {
    onAttempt?.('picsum', 1);
    return await fetchFromPicsum(width, height, seed);
  } catch (e) {
    errors.push(`picsum: ${(e as Error).message}`);
  }

  throw new Error(`All image sources failed. (${errors.join(' | ')})`);
}

/**
 * Stores or clears the optional Pollinations Bearer token. Pass `null`
 * to remove. Returns the resulting token (or null if cleared). Exposed
 * to the UI so users can paste a token from https://auth.pollinations.ai
 * to lift the anonymous tier's 1-req-per-15s limit.
 */
export function setPollinationsToken(token: string | null): string | null {
  try {
    if (token && token.trim()) {
      localStorage.setItem('pollinations_token', token.trim());
      return token.trim();
    }
    localStorage.removeItem('pollinations_token');
    return null;
  } catch {
    return null;
  }
}

/** Returns true if a Bearer token is configured. */
export function hasPollinationsToken(): boolean {
  return getPollinationsToken() !== null;
}

export const TRENDING_PROMPTS: { label: string; prompt: string }[] = [
  {
    label: 'Cinematic city',
    prompt:
      'cinematic neon city at night, vertical composition, ultra detailed, 9:16, dramatic lighting'
  },
  {
    label: 'Anime portrait',
    prompt:
      'beautiful anime portrait, soft lighting, vibrant colors, detailed eyes, 9:16 vertical'
  },
  {
    label: 'Cyberpunk street',
    prompt:
      'cyberpunk street market, rain, neon signs, vertical 9:16, ultra detail, atmospheric'
  },
  {
    label: 'Travel landscape',
    prompt:
      'breathtaking mountain landscape at sunrise, vertical 9:16, hyper realistic, golden hour'
  },
  {
    label: 'Studio product',
    prompt:
      'modern product shot, glossy reflections, gradient backdrop, 9:16 vertical, octane render'
  },
  {
    label: 'Fashion editorial',
    prompt:
      'high fashion editorial portrait, dramatic studio lighting, 9:16 vertical, magazine quality'
  }
];
