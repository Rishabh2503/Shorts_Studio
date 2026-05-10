// Free, key-less AI image generation with multi-source fallback.
//
// Reality check: Pollinations.ai's free tier 403s aggressively for some IPs,
// some prompts (content / copyright filters), and some seeds. CORS proxies
// can't bypass an upstream 403 — they just pass it through. So instead of
// trying ever more proxies, we cascade through *different* image sources
// and let the user pick which one to use as primary.
//
// Sources:
//   - 'pollinations'  → image.pollinations.ai (true generative, free tier)
//   - 'lexica'        → lexica.art catalog of pre-generated SD/Flux images
//   - 'picsum'        → random stock photo (always works, last-resort)
//   - 'auto'          → cascade: pollinations → lexica → picsum
//
// Each step short-timeouts so we fail fast and try the next source.

export type ImageSource = 'auto' | 'pollinations' | 'lexica' | 'flickr' | 'picsum';

export interface GenerateOptions {
  prompt: string;
  width?: number;
  height?: number;
  seed?: number;
  /** Preferred Pollinations model: 'flux' | 'flux-realism' | 'flux-anime' | 'turbo' */
  model?: string;
  /** Which provider to use. 'auto' tries pollinations → lexica → picsum. */
  source?: ImageSource;
  /** Optional notifier so the UI can show 'retrying with another model…' */
  onAttempt?: (label: string, attempt: number) => void;
}

const FALLBACK_CHAIN: Record<string, string[]> = {
  flux: ['flux', 'turbo'],
  'flux-realism': ['flux-realism', 'flux', 'turbo'],
  'flux-anime': ['flux-anime', 'flux', 'turbo'],
  turbo: ['turbo', 'flux']
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
 * as-is so user intent isn't overridden.
 */
function enrichPrompt(prompt: string): string {
  const trimmed = prompt.trim();
  if (trimmed.length >= 60) return trimmed;
  return `${trimmed}, vertical 9:16 composition, cinematic lighting, ultra detailed, sharp focus, vibrant colors, high quality`;
}

function buildPollinationsUrl(
  prompt: string,
  width: number,
  height: number,
  seed: number,
  model: string
): string {
  const params = new URLSearchParams({
    width: String(width),
    height: String(height),
    seed: String(seed),
    model,
    nologo: 'true'
  });
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(
    prompt
  )}?${params.toString()}`;
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
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow' });
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
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow', mode: 'cors' });
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
 * Two-stage Pollinations fetch:
 *   1. Direct CORS fetch — if upstream is 200 we're done in one round-trip.
 *      If it's 4xx/5xx we throw immediately (weserv would just 404).
 *   2. Only on actual network/CORS error (not on HTTP error status) do we
 *      try weserv as a fallback transport.
 * This eliminates the noisy weserv 404s when Pollinations 403s.
 */
async function fetchPollinationsImage(
  url: string,
  width: number,
  height: number
): Promise<string> {
  try {
    return await fetchPollinationsDirect(url);
  } catch (e) {
    const msg = (e as Error).message || '';
    // Don't bother with weserv on HTTP errors — weserv refuses non-image
    // bodies and just 404s. Propagate the original error so the caller can
    // try the next model in the chain.
    if (/HTTP (4\d\d|5\d\d)/.test(msg) || msg.includes('non-image')) {
      throw e;
    }
    // Likely network / CORS / timeout — try weserv as a transport fallback.
    return fetchAsDataUrl(weservProxy(url, width, height), 18_000);
  }
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
    const url = buildPollinationsUrl(prompt, width, height, seed + i * 9973, m);
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
  const proxies = [
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
      errors.push(`${new URL(p).hostname}: empty-or-invalid`);
      data = null;
    } catch (e) {
      errors.push(`${new URL(p).hostname}: ${(e as Error).message}`);
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
    source = 'auto',
    onAttempt
  } = opts;

  const sanitized = sanitizePrompt(prompt);
  if (sanitized !== prompt) {
    // Tell the UI the prompt was rewritten so the user knows why their
    // "batman" prompt produced a generic vigilante. attempt=0 is a sentinel.
    onAttempt?.(`sanitized: ${sanitized.slice(0, 60)}`, 0);
  }
  const enriched = enrichPrompt(sanitized);
  if (!enriched) throw new Error('Prompt is required.');

  const errors: string[] = [];

  const tryPoll = () => tryPollinations(enriched, width, height, seed, model, onAttempt);
  const tryLex = () => {
    onAttempt?.('lexica', 1);
    return fetchFromLexica(enriched, width, height, seed);
  };
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
      return await tryLex();
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

  // Auto: full cascade — generative first, then keyword-relevant photo,
  // then random photo as absolute last resort.
  try {
    return await tryPoll();
  } catch (e) {
    errors.push(`pollinations: ${(e as Error).message}`);
  }
  try {
    onAttempt?.('lexica', 1);
    return await fetchFromLexica(enriched, width, height, seed);
  } catch (e) {
    errors.push(`lexica: ${(e as Error).message}`);
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
