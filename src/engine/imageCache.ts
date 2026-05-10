// Singleton image cache shared by the preview and the exporter.
// Avoids reloading the same data URL or remote image on every project mutation,
// which was the biggest perf bottleneck in the preview canvas.

const cache = new Map<string, HTMLImageElement>();
const inflight = new Map<string, Promise<HTMLImageElement>>();
const failed = new Set<string>();

export function isCached(src: string): boolean {
  return cache.has(src);
}

export function getCached(src: string): HTMLImageElement | null {
  return cache.get(src) ?? null;
}

export function hasFailed(src: string): boolean {
  return failed.has(src);
}

/** Load an image (or return the cached one). De-duplicates concurrent loads. */
export function loadImageCached(src: string): Promise<HTMLImageElement> {
  const hit = cache.get(src);
  if (hit) return Promise.resolve(hit);
  const pending = inflight.get(src);
  if (pending) return pending;

  const p = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => {
      cache.set(src, img);
      inflight.delete(src);
      failed.delete(src);
      resolve(img);
    };
    img.onerror = () => {
      inflight.delete(src);
      failed.add(src);
      reject(new Error('image-load-failed'));
    };
    img.src = src;
  });
  inflight.set(src, p);
  return p;
}

/** Drop entries that are no longer referenced by any active source list. */
export function pruneCache(activeSources: Iterable<string>): void {
  const keep = new Set(activeSources);
  for (const k of cache.keys()) if (!keep.has(k)) cache.delete(k);
  for (const k of failed) if (!keep.has(k)) failed.delete(k);
}
