// ---------------------------------------------------------------------------
// AI text generation — Pollinations text endpoint.
// ---------------------------------------------------------------------------
// Pollinations exposes a free, key-less text-completion endpoint at
//
//     https://text.pollinations.ai/{prompt}
//
// It accepts URL-encoded prompts and an optional `model=` query parameter.
// The response is the raw model output text (not JSON) — perfect for our
// "fill the textarea" use cases.
//
// Why not stream? Stream support is half-baked across the providers and
// adds a worker for parsing. For ~200-token outputs the latency difference
// is invisible; we just await the full body.
//
// Like the image endpoint, we proxy through `/api/poll/*` in production
// (configured in vercel.json + api/poll/[...path].ts) so CORS and edge
// caching are handled by Vercel. In dev we hit the public endpoint
// directly.
// ---------------------------------------------------------------------------

// Pollinations' text endpoint advertises permissive CORS for browser
// origins (unlike the image endpoint which we proxy through Edge), so we
// can hit it directly without an `/api/text/...` Edge function. If a
// future CORS regression appears, switch this to a same-origin proxy path
// mirroring `api/poll/[...path].ts`.
const POLLINATIONS_TEXT_ENDPOINT = 'https://text.pollinations.ai';

function endpoint(): string {
  return POLLINATIONS_TEXT_ENDPOINT;
}

export interface GenerateTextOptions {
  /** Optional model id (Pollinations supports several). Falls back to default. */
  model?: string;
  /** Abort signal for user-cancelled generation. */
  signal?: AbortSignal;
  /** Random seed for deterministic outputs across calls. Omit for fresh each time. */
  seed?: number;
}

/**
 * Send a prompt to Pollinations text and return the raw response body.
 * Retries once on transient 5xx errors before failing — the public tier
 * occasionally rejects bursts even within rate limits.
 */
export async function generateText(
  prompt: string,
  opts: GenerateTextOptions = {}
): Promise<string> {
  const url = buildUrl(prompt, opts);
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { signal: opts.signal });
      if (res.ok) {
        const text = await res.text();
        if (text.trim().length === 0) throw new Error('Empty response from text model.');
        return text.trim();
      }
      // Retry only on transient server errors. 4xx is permanent (bad prompt
      // / forbidden content) so we surface those immediately.
      if (res.status >= 500 && attempt === 0) {
        lastError = new Error(`Text endpoint returned ${res.status}.`);
        await sleep(800);
        continue;
      }
      throw new Error(`Text endpoint returned ${res.status}.`);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') throw err;
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt === 0) {
        await sleep(800);
        continue;
      }
    }
  }
  throw lastError ?? new Error('Unknown text-generation failure.');
}

function buildUrl(prompt: string, opts: GenerateTextOptions): string {
  const params = new URLSearchParams();
  params.set('referrer', 'shorts-studio');
  if (opts.model) params.set('model', opts.model);
  if (opts.seed != null) params.set('seed', String(opts.seed));
  return `${endpoint()}/${encodeURIComponent(prompt)}?${params.toString()}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// High-level helpers tuned for Shorts content.
// ---------------------------------------------------------------------------

/**
 * Generate a complete short-form script from a topic. Returns a clean
 * paragraph (no markdown headings, no quoted dialogue tags) that's
 * ready to paste into the script textarea.
 *
 * @param topic   What the video is about, e.g. "iPhone battery tips".
 * @param length  Target length in seconds (controls word count). Default 35.
 */
export async function generateShortsScript(
  topic: string,
  length = 35,
  opts: GenerateTextOptions = {}
): Promise<string> {
  // Aim for ~2 words per second of speech (typical mid-pace voiceover).
  const targetWords = Math.round(length * 2);
  const prompt =
    `Write a viral YouTube Shorts script about: ${topic}. ` +
    `Structure it as: (1) a 1-sentence hook that stops the scroll, ` +
    `(2) 3-4 sentences of substance with concrete details, ` +
    `(3) a one-line call-to-action ending in "follow for more". ` +
    `Total length should be roughly ${targetWords} words. ` +
    `Plain prose only — no headings, no asterisks, no markdown, no quotes around lines. ` +
    `Avoid clichés like "buckle up" or "let's dive in". ` +
    `Write it as one paragraph the creator can read aloud directly.`;
  const out = await generateText(prompt, opts);
  return cleanModelOutput(out);
}

/**
 * Generate N variant opening hooks for a topic. Returns an array of one-line
 * strings, parsed from the model's numbered list.
 */
export async function generateHooks(
  topic: string,
  count = 5,
  opts: GenerateTextOptions = {}
): Promise<string[]> {
  const prompt =
    `Write ${count} different opening hooks for a YouTube Shorts video about: ${topic}. ` +
    `Each hook should be a single sentence, under 12 words, designed to stop the scroll in the first second. ` +
    `Mix the styles: at least one shocking statistic, one bold claim, one POV question, ` +
    `one "I tried X for Y days" framing. ` +
    `Return ONLY the hooks as a numbered list (1. 2. 3. ...). ` +
    `No preamble, no commentary, no explanations.`;
  const raw = await generateText(prompt, opts);
  return parseNumberedList(raw, count);
}

/**
 * Generate hashtags and a YouTube description from the finished script.
 * Returns `{ description, hashtags }` where hashtags include the `#` prefix.
 */
export async function generateDescription(
  script: string,
  opts: GenerateTextOptions = {}
): Promise<{ description: string; hashtags: string[] }> {
  const prompt =
    `Below is a YouTube Shorts script. Write: ` +
    `(A) A 2-sentence video description that hooks viewers and includes the key topic. ` +
    `(B) 12 highly-relevant hashtags for YouTube Shorts and TikTok. ` +
    `Format the response as:\n` +
    `DESCRIPTION:\n<the description>\n\nHASHTAGS:\n#tag1 #tag2 #tag3 ...\n\n` +
    `Script:\n${script}`;
  const raw = await generateText(prompt, opts);
  const [, descPart = '', tagPart = ''] =
    raw.match(/DESCRIPTION:\s*([\s\S]*?)\s*HASHTAGS:\s*([\s\S]*)/i) ?? [];
  const description = descPart.trim() || raw.split('\n')[0]?.trim() || '';
  const hashtags = (tagPart.match(/#[\w]+/g) ?? []).slice(0, 20);
  return { description, hashtags };
}

// ---------------------------------------------------------------------------
// Output cleanup
// ---------------------------------------------------------------------------

/**
 * Strip common LLM artifacts that don't belong in a paste-ready script:
 *   - Markdown bullets / numbered lists
 *   - Bolded markers (**word**)
 *   - Wrapping quotes
 *   - Stage directions like "(pause)" or "[transition]"
 *   - Leading "Sure, here's..." preambles
 */
export function cleanModelOutput(text: string): string {
  let out = text.trim();
  // Drop any "Sure! Here's your..." preamble before the first sentence.
  out = out.replace(/^[^.\n]*\b(here is|here's|sure[,!]?)[^.\n]*\.\s*/i, '');
  // Markdown headings & bullets.
  out = out.replace(/^#{1,6}\s+/gm, '');
  out = out.replace(/^\s*[-*•]\s+/gm, '');
  out = out.replace(/^\s*\d+[.)]\s+/gm, '');
  // Bold / italic markers.
  out = out.replace(/\*\*(.*?)\*\*/g, '$1');
  out = out.replace(/__(.*?)__/g, '$1');
  // Stage directions in parens / brackets that don't belong in the read.
  // Keep [TOPIC] / [PLACEHOLDER] (uppercase) for template substitution.
  out = out.replace(/\([^()A-Z]{0,40}\)/g, ' ');
  // Wrapping quotes.
  out = out.replace(/^["']|["']$/g, '');
  // Collapse whitespace.
  out = out.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return out;
}

export function parseNumberedList(text: string, expected: number): string[] {
  // Match "1. ..." or "1) ..." anchors. Capture everything up to the next
  // numbered anchor or end of string.
  const items: string[] = [];
  const regex = /^\s*\d+[.)]\s*([^\n]+?)\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    const item = m[1].trim().replace(/^["']|["']$/g, '');
    if (item) items.push(item);
  }
  if (items.length === 0) {
    // Fallback: split by newline, take first N non-empty lines.
    return text
      .split(/\n+/)
      .map((s) => s.replace(/^\s*\d+[.)]\s*/, '').trim())
      .filter(Boolean)
      .slice(0, expected);
  }
  return items.slice(0, expected);
}
