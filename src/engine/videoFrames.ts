// ---------------------------------------------------------------------------
// Video → frame extractor
// ---------------------------------------------------------------------------
// The Shorts Studio render pipeline is built around still images (each clip
// is an HTMLImageElement). Native video clip support would require a major
// rewrite of `render.ts`, the preview canvas and the export loop. As a
// pragmatic alternative we let users upload videos by *extracting evenly-
// spaced frames* from them. The frames are added as normal image clips, so
// every existing effect/transition/caption/style picker keeps working.
//
// We extract one frame roughly every ~`secondsPerFrame` seconds, clamped
// between `minFrames` and `maxFrames`, so a short 6-second clip still gets
// at least a few frames, and a long 5-minute video can't accidentally
// generate hundreds of clips.
// ---------------------------------------------------------------------------

export interface ExtractedFrame {
  /** PNG data URL of the rendered frame */
  dataUrl: string;
  /** Source video timestamp (seconds) this frame was captured at */
  sourceTime: number;
}

export interface ExtractOptions {
  /** Target time gap between extracted frames, in seconds. Default 3. */
  secondsPerFrame?: number;
  /** Lower bound on frame count, even for tiny videos. Default 1. */
  minFrames?: number;
  /** Upper bound on frame count to avoid runaway uploads. Default 20. */
  maxFrames?: number;
  /** Max pixel width / height of extracted PNG. Default 1080. */
  maxDimension?: number;
  /** Reports progress 0..1 as frames are captured. */
  onProgress?: (progress: number, captured: number, total: number) => void;
}

/**
 * Extracts evenly-spaced frames from a video File via an off-screen
 * HTMLVideoElement + canvas. Returns a list of PNG data URLs in source-time
 * order. Works in modern Chromium / Safari / Firefox.
 *
 * Important caveats:
 *   - Browsers won't decode every format. MP4 (H.264) and WebM (VP9) are
 *     near-universal; AV1 / HEVC may fail in Firefox. We surface the
 *     underlying error so the caller can show it to the user.
 *   - `seekable` start may not be 0 for some streamed files. We respect
 *     `video.seekable` if present and otherwise fall back to 0..duration.
 */
export async function extractVideoFrames(
  file: File,
  opts: ExtractOptions = {}
): Promise<ExtractedFrame[]> {
  const {
    secondsPerFrame = 3,
    minFrames = 1,
    maxFrames = 20,
    maxDimension = 1080,
    onProgress
  } = opts;

  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  // Required for canvas .drawImage() with blob: sources in some browsers.
  video.crossOrigin = 'anonymous';
  video.playsInline = true;
  video.src = url;

  try {
    await waitForMetadata(video);
    const duration = isFinite(video.duration) ? video.duration : 0;
    if (duration <= 0) {
      throw new Error('Video has no measurable duration (corrupt or empty file).');
    }

    // How many frames to extract.
    const ideal = Math.round(duration / Math.max(0.5, secondsPerFrame));
    const count = Math.max(minFrames, Math.min(maxFrames, ideal || minFrames));

    // Evenly-spaced timestamps. For N frames we sample at the center of
    // each Nth of the duration, so a 12s video with 4 frames captures at
    // 1.5s, 4.5s, 7.5s, 10.5s — never the very first or last frame which
    // are often black / fade-ins.
    const times: number[] = [];
    for (let i = 0; i < count; i++) {
      const t = ((i + 0.5) / count) * duration;
      // Clamp inside seekable range when the browser reports one.
      times.push(clampToSeekable(video, t));
    }

    // Size the canvas, preserving aspect ratio.
    const { vw, vh } = videoSize(video);
    const scale = Math.min(1, maxDimension / Math.max(vw, vh));
    const cw = Math.max(1, Math.round(vw * scale));
    const ch = Math.max(1, Math.round(vh * scale));
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Browser does not support 2D canvas.');

    const frames: ExtractedFrame[] = [];
    for (let i = 0; i < times.length; i++) {
      const t = times[i];
      await seekTo(video, t);
      ctx.drawImage(video, 0, 0, cw, ch);
      // PNG keeps maximum fidelity; the engine compresses on demand. JPEG
      // would be smaller but every clip then needs decoding which costs the
      // preview frame rate. PNG is the safer default.
      const dataUrl = canvas.toDataURL('image/png');
      frames.push({ dataUrl, sourceTime: t });
      onProgress?.((i + 1) / times.length, i + 1, times.length);
    }
    return frames;
  } finally {
    // Clean up the object URL and tear down the element so the GC can
    // reclaim the decoded video buffer.
    URL.revokeObjectURL(url);
    video.removeAttribute('src');
    video.load();
  }
}

function waitForMetadata(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve, reject) => {
    if (video.readyState >= 1 /* HAVE_METADATA */) {
      resolve();
      return;
    }
    const onLoaded = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(
        new Error(
          'Failed to decode video. Try MP4 (H.264) or WebM (VP9) — some codecs (AV1/HEVC) are not supported in this browser.'
        )
      );
    };
    function cleanup() {
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('error', onError);
    }
    video.addEventListener('loadedmetadata', onLoaded);
    video.addEventListener('error', onError);
  });
}

function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(`Failed to seek video to ${time.toFixed(2)}s.`));
    };
    function cleanup() {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
    }
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError);
    // Setting currentTime triggers a 'seeked' event when the decoder is ready.
    try {
      video.currentTime = time;
    } catch (e) {
      cleanup();
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

function videoSize(video: HTMLVideoElement): { vw: number; vh: number } {
  const vw = video.videoWidth || 1080;
  const vh = video.videoHeight || 1920;
  return { vw, vh };
}

function clampToSeekable(video: HTMLVideoElement, t: number): number {
  try {
    if (video.seekable && video.seekable.length > 0) {
      const min = video.seekable.start(0);
      const max = video.seekable.end(video.seekable.length - 1);
      return Math.max(min, Math.min(max, t));
    }
  } catch {
    // Some streams throw on .start/.end before ready — fall through.
  }
  return Math.max(0, Math.min(video.duration || t, t));
}
