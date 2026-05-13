// Real-time exporter: drives the canvas frame-by-frame and records via
// MediaRecorder. Audio is mixed in via a WebAudio destination stream.
//
// Output is WebM (VP9/Opus) which is perfectly accepted by YouTube Shorts.

import type { ProjectState } from '../types';
import { preloadClips, renderFrame, syncVideoPlayback, totalDuration, type LoadedClip } from './render';
import { analyzeAudio } from './audioAnalyzer';

export interface ExportProgress {
  phase: 'preparing' | 'recording' | 'finalizing' | 'done' | 'error';
  /** 0..1 */
  progress: number;
  message?: string;
}

export interface ExportOptions {
  project: ProjectState;
  /** Optional: hi-res render canvas. Created internally if omitted. */
  canvas?: HTMLCanvasElement;
  onProgress?: (p: ExportProgress) => void;
}

export interface ExportResult {
  blob: Blob;
  url: string;
  mimeType: string;
  filename: string;
  durationSec: number;
}

function pickMimeType(): string {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm'
  ];
  for (const c of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c)) return c;
  }
  return 'video/webm';
}

export async function exportVideo(opts: ExportOptions): Promise<ExportResult> {
  const { project, onProgress } = opts;
  const videoDur = totalDuration(project.clips);
  if (project.clips.length === 0 || videoDur <= 0) {
    throw new Error('Add at least one clip before exporting.');
  }

  // Resolve effective duration the same way the preview does: when the user
  // chose 'fitVideo', the audio range determines length; otherwise the video
  // sum does.
  const audioRange =
    project.audio.src && project.audio.end != null
      ? Math.max(0, project.audio.end - project.audio.start)
      : 0;
  const dur =
    project.audio.syncMode === 'fitVideo' && audioRange > 0 ? audioRange : videoDur;

  onProgress?.({ phase: 'preparing', progress: 0, message: 'Loading images…' });
  const clips: LoadedClip[] = await preloadClips(project.clips);
  if (clips.length === 0) throw new Error('No images could be loaded.');

  // Pre-compute audio peaks so the project-script renderer aligns word
  // reveals with vocal beats during export too. Failures here are non-fatal
  // — we just fall back to even spacing.
  let audioPeaks: number[] | undefined;
  if (project.audio.src && project.script.text.trim() && project.script.syncMode === 'audio') {
    try {
      const info = await analyzeAudio(project.audio.src);
      // Shift peaks to the trimmed range (peaks are absolute file times).
      audioPeaks = info.peaks
        .filter((p) => p >= project.audio.start && p < (project.audio.end ?? info.duration))
        .map((p) => p - project.audio.start);
    } catch {
      audioPeaks = undefined;
    }
  }

  const canvas = opts.canvas ?? document.createElement('canvas');
  canvas.width = project.width;
  canvas.height = project.height;
  const ctx2d = canvas.getContext('2d');
  if (!ctx2d) throw new Error('Canvas 2D context unavailable.');
  const ctx: CanvasRenderingContext2D = ctx2d;

  // Setup audio graph if present. Two tracks may be present: the main one
  // (transcript source) and an optional second one (background bed). Both
  // are routed through their own gain nodes into the same MediaStream
  // destination so they're mixed into the recorded WebM.
  //
  // We track the shared graph in an `audio` object instead of two `let`
  // bindings because TS's control-flow analysis doesn't follow `let`
  // mutations across closure calls — using a single object reference keeps
  // narrowing intact downstream.
  const audio: {
    ctx: AudioContext | null;
    dest: MediaStreamAudioDestinationNode | null;
    els: HTMLAudioElement[];
  } = { ctx: null, dest: null, els: [] };

  /**
   * Build a single source/gain branch for one ProjectAudio slot. Resolves
   * when the element is ready to play. Returns null if the slot is empty
   * (so a missing audio2 doesn't block export). Lazily initializes the
   * shared AudioContext / destination on first call.
   */
  async function attachAudio(
    slot: ProjectState['audio'],
    label: 'main' | 'background'
  ): Promise<HTMLAudioElement | null> {
    if (!slot.src) return null;
    if (!audio.ctx) audio.ctx = new AudioContext();
    if (!audio.dest) audio.dest = audio.ctx.createMediaStreamDestination();
    const aCtx = audio.ctx;
    const aDest = audio.dest;
    const el = new Audio();
    el.crossOrigin = 'anonymous';
    el.src = slot.src;
    el.loop = slot.syncMode === 'loop';
    el.volume = slot.volume;
    await new Promise<void>((res, rej) => {
      el.oncanplaythrough = () => res();
      el.onerror = () => rej(new Error(`${label} audio failed to load.`));
      el.load();
    });
    const source = aCtx.createMediaElementSource(el);
    const gain = aCtx.createGain();
    gain.gain.value = slot.volume;
    source.connect(gain);
    gain.connect(aDest);
    audio.els.push(el);
    return el;
  }

  const audioElMain = await attachAudio(project.audio, 'main');
  // Background is best-effort — if it fails to load, we still export the
  // main track + video so the user isn't blocked by a broken bed.
  let audioElBg: HTMLAudioElement | null = null;
  try {
    audioElBg = await attachAudio(project.audio2, 'background');
  } catch (e) {
    onProgress?.({
      phase: 'preparing',
      progress: 0,
      message: `Background audio skipped: ${(e as Error).message}`
    });
  }

  // Compose stream
  const fps = project.fps;
  const videoStream = canvas.captureStream(fps);
  const tracks = videoStream.getTracks();
  if (audio.dest) {
    audio.dest.stream.getAudioTracks().forEach((t) => tracks.push(t));
  }
  const stream = new MediaStream(tracks);

  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 8_000_000
  });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  const finished = new Promise<void>((resolve, reject) => {
    recorder.onstop = () => resolve();
    recorder.onerror = (e) => reject((e as ErrorEvent).error ?? new Error('Recorder error'));
  });

  // We deliberately omit the timeslice argument so the encoder emits a single
  // contiguous WebM blob on stop() instead of many small chunks. Some
  // Chromium builds produce corrupted tail bytes when many small chunks are
  // concatenated client-side, which manifested as a "broken" exported video
  // that wouldn't seek past the last few seconds in some players.
  recorder.start();
  // Seek + play each attached audio source. The main slot drives the trim
  // logic that hard-stops at audio.end for non-loop modes; the background
  // slot just plays from its own trim start (looped or not per its sync
  // mode) until the recorder stops.
  async function startSlot(
    el: HTMLAudioElement | null,
    slot: ProjectState['audio']
  ) {
    if (!el) return;
    el.currentTime = slot.start;
    if (slot.syncMode !== 'loop' && slot.end != null) {
      const stopAt = slot.end;
      const onTU = () => {
        if (el.currentTime >= stopAt - 0.02) {
          el.pause();
          el.removeEventListener('timeupdate', onTU);
        }
      };
      el.addEventListener('timeupdate', onTU);
    }
    await el.play().catch(() => {
      /* ignore — silent video still records */
    });
  }
  await Promise.all([
    startSlot(audioElMain, project.audio),
    startSlot(audioElBg, project.audio2)
  ]);

  onProgress?.({ phase: 'recording', progress: 0, message: 'Recording…' });

  const startTs = performance.now();
  const frameInterval = 1000 / fps;
  let nextFrame = startTs;

  await new Promise<void>((resolve) => {
    function tick(now: number) {
      const elapsed = (now - startTs) / 1000;
      if (elapsed >= dur) {
        // Render final frame and stop. We pause any playing video clips
        // explicitly so the encoder doesn't keep receiving frames after
        // the last canvas draw.
        syncVideoPlayback(clips, dur, false);
        renderFrame({ ctx, project, clips, audioPeaks, totalDur: dur }, dur);
        resolve();
        return;
      }
      if (now >= nextFrame) {
        // Keep every video-backed clip's HTMLVideoElement playing in real
        // time alongside the canvas, so the recorder captures decoded
        // frames instead of a single frozen poster.
        syncVideoPlayback(clips, elapsed, true);
        renderFrame({ ctx, project, clips, audioPeaks, totalDur: dur }, elapsed);
        nextFrame += frameInterval;
        onProgress?.({
          phase: 'recording',
          progress: Math.min(1, elapsed / dur),
          message: `Recording ${elapsed.toFixed(1)}s / ${dur.toFixed(1)}s`
        });
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });

  onProgress?.({ phase: 'finalizing', progress: 0.98, message: 'Finalizing video…' });
  // Give the canvas captureStream + MediaRecorder pipeline time to flush
  // the very last frames into the encoder before we tear it down. Without
  // this settle window the recorder.stop() races the trailing frames and
  // the resulting WebM is missing/garbling the final ~200ms of video,
  // which users perceive as a "corrupted" output.
  await new Promise<void>((r) => setTimeout(r, 250));
  // Defensive flush — asks the encoder to emit any buffered chunk now,
  // BEFORE we call stop(). On Chromium with no timeslice this is a no-op
  // until stop, but on Firefox / Safari it ensures we don't lose the tail.
  try {
    recorder.requestData();
  } catch {
    /* not all browsers support requestData; safe to ignore */
  }
  recorder.stop();
  for (const el of audio.els) el.pause();
  await finished;
  // Cleanup. Reading `audio.ctx` through the wrapper object preserves the
  // narrowed type — using a bare `let audioCtx` would have left TS unable
  // to track mutations performed inside `attachAudio`.
  if (audio.ctx) {
    audio.ctx.close().catch(() => {});
  }

  const blob = new Blob(chunks, { type: mimeType });
  const url = URL.createObjectURL(blob);
  const ext = mimeType.includes('webm') ? 'webm' : 'mp4';
  const filename = `shorts-${Date.now()}.${ext}`;

  onProgress?.({ phase: 'done', progress: 1, message: 'Done' });

  return { blob, url, mimeType, filename, durationSec: dur };
}
