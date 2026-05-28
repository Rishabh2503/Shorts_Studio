// ---------------------------------------------------------------------------
// Story Scenes — auto-generate a sequence of images from a single topic.
// ---------------------------------------------------------------------------
//
// Idea: the user types "twinkle twinkle little star" (or any topic / script
// snippet), picks how many scenes they want (3..9), and we:
//
//   1. Ask Pollinations text (free) to break the topic into N visually
//      distinct, self-contained image prompts. Each line is one scene.
//   2. Call generateImage() for each scene in order. The existing
//      Pollinations rate-limit queue spaces requests out so we don't get
//      banned. Per-image fallback (Flickr / Picsum) still applies, so we
//      always end up with N images even if the AI provider hiccups.
//
// Everything here uses the same free endpoints already in use elsewhere in
// the app — no new API keys, no paid plan.
// ---------------------------------------------------------------------------

import { generateText, parseNumberedList, cleanModelOutput } from './aiText';
import { generateImage, type GenerateOptions } from './ai';

/** Min/max number of scenes we'll plan for. */
export const MIN_SCENES = 3;
export const MAX_SCENES = 9;

export interface SceneListOptions {
  topic: string;
  count: number;
  /** Abort signal so the user can cancel mid-flight. */
  signal?: AbortSignal;
}

/**
 * Ask the free Pollinations text endpoint to expand a topic into a numbered
 * list of N visual scene prompts. Each entry is a self-contained image
 * prompt of roughly 10-20 words covering subject, action, setting, mood.
 *
 * If the model returns fewer items than requested (it sometimes truncates),
 * we pad the tail with topic-derived fallbacks so callers always get
 * exactly `count` strings.
 */
export async function generateSceneList(
  opts: SceneListOptions
): Promise<string[]> {
  const count = clampCount(opts.count);
  const topic = opts.topic.trim();
  if (!topic) throw new Error('Topic is required.');

  const prompt =
    `You are a visual storyboard director for a short vertical video. ` +
    `Break the following topic into exactly ${count} visually distinct scenes ` +
    `that, played in order, tell a coherent story or illustrate the topic step by step. ` +
    `Each scene must be a self-contained image prompt of 10-20 words covering: ` +
    `subject, action, setting, mood, lighting. ` +
    `Each scene should look obviously different from the others (different angle, ` +
    `time of day, framing, or subject focus) so the final video feels dynamic. ` +
    `Do NOT include any text overlays or watermarks in the descriptions. ` +
    `Output ONLY a numbered list (1. 2. 3. ...) with one scene per line. ` +
    `No preamble, no explanations, no headings.\n\n` +
    `Topic: ${topic}`;

  const raw = await generateText(prompt, { signal: opts.signal });
  const cleaned = cleanModelOutput(raw);
  const scenes = parseNumberedList(cleaned, count);

  // Pad with sensible fallbacks if the model under-delivered. We derive
  // each fallback from the topic so the resulting images are at least
  // on-theme, not random stock photos.
  while (scenes.length < count) {
    scenes.push(`${topic}, cinematic shot, scene ${scenes.length + 1}`);
  }
  return scenes.slice(0, count);
}

export interface GenerateStorySceneImagesOptions {
  scenes: string[];
  /** Pass-through to generateImage so the user's style/source choices apply. */
  imageOpts?: Omit<GenerateOptions, 'prompt' | 'onAttempt'>;
  /** Fired before each scene's image starts loading (1-based index). */
  onSceneStart?: (sceneIndex: number, totalScenes: number, prompt: string) => void;
  /**
   * Fired after a scene's image is ready. The caller usually pushes a clip
   * to the timeline here so users see progress as it happens instead of a
   * single batch insertion at the end.
   */
  onSceneReady?: (sceneIndex: number, totalScenes: number, imageUrl: string, prompt: string) => void;
  /** Per-scene retry attempt label (forwarded from generateImage). */
  onSceneAttempt?: (sceneIndex: number, label: string, attempt: number) => void;
  signal?: AbortSignal;
}

/**
 * Generate one image per scene, sequentially. Returns the list of resolved
 * image URLs (parallel to the input `scenes`).
 *
 * Sequential is intentional: the Pollinations rate-limiter queues all
 * image requests onto a single 5-15s-spaced chain anyway, and going
 * sequential lets us surface clean per-scene progress to the UI. Parallel
 * would just stack inside the queue with no real speed-up.
 *
 * Individual scene failures are NOT fatal — generateImage's own cascade
 * (Pollinations -> Lexica -> Flickr -> Picsum) almost always returns
 * something, but if every provider 5xx's at once we record an empty
 * string at that index and continue. Callers can filter the empties out.
 */
export async function generateStorySceneImages(
  opts: GenerateStorySceneImagesOptions
): Promise<string[]> {
  const out: string[] = [];
  const total = opts.scenes.length;
  for (let i = 0; i < opts.scenes.length; i++) {
    if (opts.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    const prompt = opts.scenes[i];
    opts.onSceneStart?.(i + 1, total, prompt);
    try {
      const url = await generateImage({
        ...(opts.imageOpts ?? {}),
        prompt,
        onAttempt: (label, attempt) => opts.onSceneAttempt?.(i + 1, label, attempt)
      });
      out.push(url);
      opts.onSceneReady?.(i + 1, total, url, prompt);
    } catch (err) {
      // Re-throw cancellation so the caller can short-circuit cleanly.
      if (err instanceof Error && err.name === 'AbortError') throw err;
      // Otherwise record an empty slot and keep going — partial success is
      // better than no scenes when one provider is misbehaving.
      out.push('');
    }
  }
  return out;
}

function clampCount(n: number): number {
  if (!Number.isFinite(n)) return 5;
  return Math.max(MIN_SCENES, Math.min(MAX_SCENES, Math.round(n)));
}
