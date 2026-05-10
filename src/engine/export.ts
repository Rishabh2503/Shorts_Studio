// Real-time exporter: drives the canvas frame-by-frame and records via
// MediaRecorder. Audio is mixed in via a WebAudio destination stream.
//
// Output is WebM (VP9/Opus) which is perfectly accepted by YouTube Shorts.

import type { ProjectState } from '../types';
import { preloadClips, renderFrame, totalDuration, type LoadedClip } from './render';
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

  // Setup audio graph if present
  let audioCtx: AudioContext | null = null;
  let audioEl: HTMLAudioElement | null = null;
  let audioDest: MediaStreamAudioDestinationNode | null = null;
  if (project.audio.src) {
    audioCtx = new AudioContext();
    audioEl = new Audio();
    audioEl.crossOrigin = 'anonymous';
    audioEl.src = project.audio.src;
    // Loop only in 'loop' sync mode — the other modes want the audio to
    // play exactly once across the trim window.
    audioEl.loop = project.audio.syncMode === 'loop';
    audioEl.volume = project.audio.volume;
    await new Promise<void>((res, rej) => {
      audioEl!.oncanplaythrough = () => res();
      audioEl!.onerror = () => rej(new Error('Audio failed to load.'));
      audioEl!.load();
    });
    const source = audioCtx.createMediaElementSource(audioEl);
    const gain = audioCtx.createGain();
    gain.gain.value = project.audio.volume;
    audioDest = audioCtx.createMediaStreamDestination();
    source.connect(gain);
    gain.connect(audioDest);
  }

  // Compose stream
  const fps = project.fps;
  const videoStream = canvas.captureStream(fps);
  const tracks = videoStream.getTracks();
  if (audioDest) {
    audioDest.stream.getAudioTracks().forEach((t) => tracks.push(t));
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

  recorder.start(100);
  if (audioEl) {
    // Start at the user's chosen trim window, not file start.
    audioEl.currentTime = project.audio.start;
    // For non-loop modes, hard-stop at the end of the trim window so no
    // extra audio leaks into the export beyond what the user selected.
    if (project.audio.syncMode !== 'loop' && project.audio.end != null) {
      const stopAt = project.audio.end;
      const onTU = () => {
        if (audioEl && audioEl.currentTime >= stopAt - 0.02) {
          audioEl.pause();
          audioEl.removeEventListener('timeupdate', onTU);
        }
      };
      audioEl.addEventListener('timeupdate', onTU);
    }
    await audioEl.play().catch(() => {
      /* ignore — silent video still records */
    });
  }

  onProgress?.({ phase: 'recording', progress: 0, message: 'Recording…' });

  const startTs = performance.now();
  const frameInterval = 1000 / fps;
  let nextFrame = startTs;

  await new Promise<void>((resolve) => {
    function tick(now: number) {
      const elapsed = (now - startTs) / 1000;
      if (elapsed >= dur) {
        // Render final frame and stop
        renderFrame({ ctx, project, clips, audioPeaks, totalDur: dur }, dur);
        resolve();
        return;
      }
      if (now >= nextFrame) {
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
  recorder.stop();
  if (audioEl) audioEl.pause();
  await finished;
  audioCtx?.close().catch(() => {});

  const blob = new Blob(chunks, { type: mimeType });
  const url = URL.createObjectURL(blob);
  const ext = mimeType.includes('webm') ? 'webm' : 'mp4';
  const filename = `shorts-${Date.now()}.${ext}`;

  onProgress?.({ phase: 'done', progress: 1, message: 'Done' });

  return { blob, url, mimeType, filename, durationSec: dur };
}
