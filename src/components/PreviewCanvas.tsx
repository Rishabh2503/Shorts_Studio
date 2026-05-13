import { useEffect, useRef, useState } from 'react';
import { preloadClips, renderFrame, syncVideoPlayback, type LoadedClip } from '../engine/render';
import type { ProjectState } from '../types';

interface Props {
  project: ProjectState;
  /** absolute playhead seconds */
  time: number;
  /**
   * Whether the timeline is currently playing. When true, video-backed
   * clips run via native .play() so frames decode smoothly. When false
   * (scrubbing), they're paused and seeked precisely to the playhead.
   */
  isPlaying?: boolean;
  /**
   * Optional audio onset peaks (relative to project t=0). Forwarded to the
   * renderer so the project-script caption track can align word reveals to
   * the actual rhythm of the loaded audio.
   */
  audioPeaks?: number[] | null;
  /** Optional: notify parent when canvas is ready (for export reuse). */
  onReady?: (canvas: HTMLCanvasElement) => void;
  /** Notify if any image fails to load (for toast). */
  onLoadError?: (count: number) => void;
}

/**
 * Live preview canvas.
 *  - Loads images via the shared cache, so repeats are free.
 *  - Re-renders synchronously on time / clip / project changes — simple and
 *    deterministic. The cache keeps it fast even though the effect runs
 *    on every frame during playback.
 */
export function PreviewCanvas({
  project,
  time,
  isPlaying,
  audioPeaks,
  onReady,
  onLoadError
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [loaded, setLoaded] = useState<LoadedClip[]>([]);

  // Reload clips when the source set changes. preloadClips is cached, so this
  // is near-instant for already-seen URLs. It also doesn't drop clips from
  // `loaded` if their src is unchanged — the cache makes them resolve in the
  // same microtask.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await preloadClips(project.clips);
      if (cancelled) return;
      setLoaded(result);
      const missing = project.clips.length - result.length;
      if (missing > 0) onLoadError?.(missing);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.clips]);

  // Draw the current frame on every relevant change. This effect runs on
  // every parent re-render that changes `time` (i.e. each playback frame).
  // renderFrame is cheap and the canvas blits in microseconds.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    // Drive video element play/pause/seek state BEFORE drawing so the
    // canvas paints from a video that's already showing the right frame.
    syncVideoPlayback(loaded, time, !!isPlaying);
    renderFrame(
      { ctx, project, clips: loaded, audioPeaks: audioPeaks ?? undefined },
      time
    );
  }, [time, project, loaded, audioPeaks, isPlaying]);

  // When this component unmounts (or the loaded set changes), pause any
  // video elements that may still be playing so they don't keep producing
  // audible decoded frames in the background.
  useEffect(() => {
    return () => {
      for (const c of loaded) {
        if (c.kind === 'video' && c.video && !c.video.paused) c.video.pause();
      }
    };
  }, [loaded]);

  // Notify parent of canvas element (used by exporter to reuse the same canvas).
  useEffect(() => {
    if (canvasRef.current) onReady?.(canvasRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <canvas
      ref={canvasRef}
      width={project.width}
      height={project.height}
      className="rounded-2xl shadow-glow"
      style={{
        width: '100%',
        height: '100%',
        objectFit: 'contain',
        background: '#000'
      }}
    />
  );
}
