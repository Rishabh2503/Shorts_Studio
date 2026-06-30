// Real-time exporter: drives the canvas frame-by-frame and records via
// MediaRecorder. Audio is mixed in via a WebAudio destination stream.
//
// Output is WebM (VP9/Opus) on Chromium/Firefox, MP4 (H.264/AAC) on Safari
// — both are accepted by YouTube Shorts and TikTok uploaders.

import type { ProjectState } from '../types';
import { preloadClips, renderFrame, syncVideoPlayback, totalDuration, type LoadedClip } from './render';
import { analyzeAudio } from './audioAnalyzer';
import fixWebmDuration from 'fix-webm-duration';

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

/**
 * Pick the best supported recorder mime type for this browser. Order matters:
 *   - VP9/Opus is the best quality/size tradeoff (Chromium, Firefox).
 *   - VP8/Opus is a safe Chromium/Firefox fallback.
 *   - H.264/AAC in MP4 is the ONLY option on Safari — without an mp4
 *     candidate here Safari users hit "Recorder error" and assume the
 *     app is broken.
 *   - Plain 'video/webm' is the spec default; many browsers accept it.
 */
function pickMimeType(): { mimeType: string; ext: 'webm' | 'mp4' } {
  // MP4 is tried FIRST because it plays out-of-the-box in every desktop
  // player (Windows Movies & TV, VLC, QuickTime), every video editor, and
  // every social-media uploader (YouTube Shorts, Instagram Reels, TikTok).
  // Chrome 110+ (Jan 2023) and Safari support MP4 MediaRecorder output
  // directly. We only fall back to WebM on browsers that can't produce
  // MP4 (older Firefox, older Chromium). The WebM output is then patched
  // with fix-webm-duration so it at least plays in Chromium-based players.
  //
  // Codec choices:
  //   - avc3.42E01F = H.264 Baseline @ Level 3.1 with IN-BAND parameter
  //     sets. CRITICAL over `avc1`: when the canvas content changes mid-
  //     recording (mixing AI images of different intrinsic resolutions,
  //     an imported video clip, effects that scale, etc.) Chromium may
  //     re-emit codec configuration mid-stream. `avc1` forbids this and
  //     the recorder silently dies after a few seconds — producing a
  //     truncated file with the imported video clip missing and a
  //     duration shorter than the project. `avc3` stores codec config
  //     in every sample, so dynamic changes are legal and the recorder
  //     never aborts. Same H.264 video, same compatibility everywhere.
  //   - avc1.42E01F = legacy fallback for browsers that don't expose
  //     avc3 support yet.
  //   - mp4a.40.2 = AAC LC, the universal audio codec for MP4.
  //   - vp9/opus = best WebM quality where MP4 isn't available.
  const candidates: Array<{ mimeType: string; ext: 'webm' | 'mp4' }> = [
    { mimeType: 'video/mp4;codecs=avc3.42E01F,mp4a.40.2', ext: 'mp4' },
    { mimeType: 'video/mp4;codecs=avc3.42E01E,mp4a.40.2', ext: 'mp4' },
    { mimeType: 'video/mp4;codecs=avc1.42E01F,mp4a.40.2', ext: 'mp4' },
    { mimeType: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', ext: 'mp4' },
    { mimeType: 'video/mp4;codecs=h264,aac', ext: 'mp4' },
    { mimeType: 'video/mp4', ext: 'mp4' },
    { mimeType: 'video/webm;codecs=vp9,opus', ext: 'webm' },
    { mimeType: 'video/webm;codecs=vp8,opus', ext: 'webm' },
    { mimeType: 'video/webm', ext: 'webm' }
  ];
  if (typeof MediaRecorder === 'undefined') {
    return { mimeType: 'video/webm', ext: 'webm' };
  }
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c.mimeType)) return c;
  }
  // Last-resort: let the browser pick its default.
  return { mimeType: '', ext: 'webm' };
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

  // Recorder is declared up front so the `finally` block can stop it on any
  // failure path. Without this, a throw between `new MediaRecorder()` and
  // `recorder.stop()` would leak the encoder, the MediaStream tracks, and
  // the AudioContext for the life of the tab.
  let recorder: MediaRecorder | null = null;

  /** Tear down every resource we created. Idempotent and exception-safe. */
  function cleanup() {
    try {
      if (recorder && recorder.state !== 'inactive') recorder.stop();
    } catch { /* ignore */ }
    for (const el of audio.els) {
      try {
        el.pause();
        el.src = '';
        el.load();
      } catch { /* ignore */ }
    }
    audio.els.length = 0;
    if (audio.ctx && audio.ctx.state !== 'closed') {
      audio.ctx.close().catch(() => { /* ignore */ });
    }
    audio.ctx = null;
    audio.dest = null;
  }

  try {

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
    el.preload = 'auto';
    el.src = slot.src;
    // We manage looping ourselves via the trim-window timeupdate listener
    // below, so the native loop flag stays off.
    el.loop = false;
    el.volume = slot.volume;
    // Wait for the element to have enough data to play. We listen for the
    // FIRST of `canplay` / `loadeddata` (both fire when at least some
    // playable data is buffered) instead of `canplaythrough`, which
    // historically never fires for some data: URLs and cached blobs and
    // would hang the export indefinitely. A 10s safety timeout fails the
    // export with a clear message rather than hanging forever.
    await new Promise<void>((res, rej) => {
      let done = false;
      const onReady = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        el.removeEventListener('canplay', onReady);
        el.removeEventListener('loadeddata', onReady);
        el.removeEventListener('error', onErr);
        res();
      };
      const onErr = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        rej(new Error(`${label} audio failed to load.`));
      };
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        rej(new Error(`${label} audio took too long to load (10s).`));
      }, 10_000);
      el.addEventListener('canplay', onReady);
      el.addEventListener('loadeddata', onReady);
      el.addEventListener('error', onErr);
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

  // CRITICAL: Resume the AudioContext if it's suspended. Modern browsers
  // start an AudioContext suspended when it wasn't created in response to
  // a user gesture. While suspended, NO audio data flows from
  // MediaElementAudioSource through the graph to the
  // MediaStreamAudioDestinationNode — so the recorded WebM ends up with
  // a track of pure silence even though the <audio> element is playing.
  // This was the #1 cause of "my exported video has no sound" reports.
  if (audio.ctx && audio.ctx.state === 'suspended') {
    try {
      await audio.ctx.resume();
    } catch (e) {
      onProgress?.({
        phase: 'preparing',
        progress: 0,
        message: `Audio context resume failed: ${(e as Error).message}`
      });
    }
  }

  // Compose stream. We add audio tracks to the existing video stream
  // instead of constructing `new MediaStream(tracks)` — some Chromium
  // versions mis-report the active state of a freshly-constructed
  // MediaStream which caused MediaRecorder to stop emitting data partway
  // through long exports (the user-visible "video cuts off halfway" bug).
  const fps = project.fps;
  const videoStream = canvas.captureStream(fps);
  const videoTrack = videoStream.getVideoTracks()[0] as
    | (CanvasCaptureMediaStreamTrack & { requestFrame?: () => void })
    | undefined;
  if (audio.dest) {
    for (const t of audio.dest.stream.getAudioTracks()) {
      videoStream.addTrack(t);
    }
  }
  const stream = videoStream;

  const picked = pickMimeType();
  const mimeType = picked.mimeType;
  const ext = picked.ext;
  if (!mimeType) {
    throw new Error(
      'This browser does not support video recording (MediaRecorder). ' +
        'Try the latest Chrome, Edge, Firefox, or Safari 14.1+.'
    );
  }
  // DIAGNOSTIC: log the chosen format + browser MediaRecorder support map
  // so issues filed by users include exactly what the browser is doing.
  // This is intentionally cheap and runs once per export.
   
  console.log('[Shorts export] picked', { mimeType, ext, dur, fps });
   
  console.log('[Shorts export] MediaRecorder support', {
    mp4_avc3: typeof MediaRecorder !== 'undefined'
      && MediaRecorder.isTypeSupported('video/mp4;codecs=avc3.42E01F,mp4a.40.2'),
    mp4_avc1: typeof MediaRecorder !== 'undefined'
      && MediaRecorder.isTypeSupported('video/mp4;codecs=avc1.42E01F,mp4a.40.2'),
    mp4_plain: typeof MediaRecorder !== 'undefined'
      && MediaRecorder.isTypeSupported('video/mp4'),
    webm_vp9: typeof MediaRecorder !== 'undefined'
      && MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus'),
    webm_vp8: typeof MediaRecorder !== 'undefined'
      && MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus'),
    userAgent: navigator.userAgent
  });
  try {
    recorder = new MediaRecorder(stream, {
      mimeType,
      // 6 Mbps is the YouTube-recommended target for 1080p30 (canvas
      // source has nowhere near the spatial detail of camera footage so
      // we don't need the higher 8 Mbps that was producing encoder
      // back-pressure on mid-range machines — which manifested as the
      // recording loop falling behind, frames being dropped, and the
      // exported file appearing to lag or skip).
      videoBitsPerSecond: 6_000_000,
      // Without an explicit audioBitsPerSecond, several Chromium versions
      // default to ~64 kbps Opus which sounds muddy under music + voice.
      // 128 kbps is YouTube-recommended and roughly doubles audio quality
      // for ~16 KB/s more bandwidth.
      audioBitsPerSecond: 128_000
    });
  } catch (err) {
    throw new Error(
      `Couldn't start the recorder (${
        (err as Error).message || 'unknown error'
      }). Try a different browser or a smaller canvas size.`
    );
  }
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  const finished = new Promise<void>((resolve, reject) => {
    recorder!.onstop = () => resolve();
    // MediaRecorder fires a MediaRecorderErrorEvent (NOT a generic
    // ErrorEvent) on encoder failures. The payload's `.error` is a
    // DOMException with a useful `.message` — surface that instead of the
    // opaque 'Recorder error' fallback we used before.
    recorder!.onerror = (e: Event) => {
      const err = (e as unknown as { error?: DOMException }).error;
       
      console.error('[Shorts export] MediaRecorder error', err, e);
      reject(
        err
          ? new Error(`Recorder error: ${err.name} — ${err.message}`)
          : new Error('Recorder error')
      );
    };
  });

  // Start with a 1-second timeslice. Each timeslice produces a self-
  // contained WebM/MP4 cluster that the browser flushes to the
  // ondataavailable handler immediately, so:
  //   - Long exports don't hold the entire recording in memory until stop
  //     (the old behavior OOM'd on low-end devices for videos > 30s).
  //   - If the tab is backgrounded mid-export, already-emitted chunks are
  //     safe; we lose only the in-flight cluster instead of everything.
  //   - Concatenating timed clusters via `new Blob(chunks)` is spec-safe
  //     for both WebM and fragmented MP4, unlike concatenating a
  //     requestData() blob with a stop() blob (which is what produced the
  //     "video plays for 5s then breaks" corruption reported by users).
  try {
    recorder.start(1000);
  } catch (err) {
    throw new Error(
      `Recorder failed to start: ${(err as Error).message || 'unknown error'}.`
    );
  }
  // Seek + play each attached audio source. The trim window is enforced
  // manually for BOTH slots (loop ⇒ wrap to slot.start, otherwise pause)
  // because the native HTMLAudioElement `loop` flag loops the *entire*
  // file and ignores the user's trim range. Without this, exports with
  // looped audio replayed the full track on every wrap.
  async function startSlot(
    el: HTMLAudioElement | null,
    slot: ProjectState['audio']
  ) {
    if (!el) return;
    el.currentTime = slot.start;
    el.loop = false; // we manage looping ourselves below
    const end = slot.end ?? slot.duration ?? null;
    if (end != null) {
      const onTU = () => {
        if (el.currentTime >= end - 0.02) {
          if (slot.syncMode === 'loop') {
            // Wrap inside the trim window so background beds repeat
            // [start..end] cleanly for the whole export duration.
            el.currentTime = slot.start;
          } else {
            el.pause();
            el.removeEventListener('timeupdate', onTU);
          }
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

  // Pre-warm every video-backed clip's <video> element. The order here
  // matters: we SEEK first to the trim start, then play+pause, so the
  // decoder produces and caches frames at `videoStart`. The previous
  // order (play → pause → seek) re-initialised the decoder AFTER pause,
  // leaving it cold at `videoStart` — the first real `.play()` issued
  // by `syncVideoPlayback` then had to wait for the decoder to spin up,
  // and during that latency the renderer painted the poster image
  // instead of video frames. That's the "imported video doesn't appear
  // in the export" bug.
  await Promise.all(
    clips.map(async (c) => {
      if (c.kind !== 'video' || !c.video) return;
      const v = c.video;
      try {
        // Seek to start of trim window first.
        const targetT = c.videoStart ?? 0;
        if (Math.abs(v.currentTime - targetT) > 0.05) {
          await new Promise<void>((resolve) => {
            const onSeeked = () => { v.removeEventListener('seeked', onSeeked); resolve(); };
            v.addEventListener('seeked', onSeeked, { once: true });
            try { v.currentTime = targetT; } catch { resolve(); }
            // Fail-safe — some browsers don't fire `seeked` if currentTime
            // didn't actually change.
            setTimeout(() => { v.removeEventListener('seeked', onSeeked); resolve(); }, 500);
          });
        }
        // Briefly play to spin up the decoder, then pause. The decoder
        // is now warm AT videoStart and ready to produce frames the
        // instant syncVideoPlayback issues its first real .play().
        const playPromise = v.play();
        if (playPromise && typeof playPromise.then === 'function') {
          await playPromise;
        }
        v.pause();
      } catch {
        /* poster fallback will be used */
      }
    })
  );

  // DIAGNOSTIC: log the state of every video clip just before recording
  // starts. If any of them shows readyState < 2 or videoWidth=0 we
  // already know that clip will record as a still image instead of
  // playing video.
  const videoClips = clips.filter((c) => c.kind === 'video');
  if (videoClips.length > 0) {
     
    console.log('[Shorts export] video clips pre-record state', videoClips.map((c) => ({
      src: c.videoSrc?.slice(0, 60),
      hasVideoEl: !!c.video,
      readyState: c.video?.readyState,
      videoWidth: c.video?.videoWidth,
      videoHeight: c.video?.videoHeight,
      duration: c.video?.duration,
      currentTime: c.video?.currentTime,
      paused: c.video?.paused,
      inDOM: c.video ? document.body.contains(c.video) : false
    })));
  }

  onProgress?.({ phase: 'recording', progress: 0, message: 'Recording…' });

  const startTs = performance.now();
  const frameInterval = 1000 / fps;
  let nextFrame = startTs;
  // After the main duration is reached we keep redrawing the LAST frame for
  // a short tail so canvas.captureStream(fps) has fresh frames to sample
  // and flush into the encoder before we stop. Without this the trailing
  // ~200-400ms of the video was either missing or showed a frozen frame
  // that wouldn't seek.
  const TAIL_MS = 400;

  await new Promise<void>((resolve) => {
    function tick(now: number) {
      const elapsed = (now - startTs) / 1000;
      const tailElapsed = (now - startTs) / 1000 - dur;
      if (tailElapsed >= TAIL_MS / 1000) {
        // We've redrawn the final frame for TAIL_MS already — safe to stop.
        syncVideoPlayback(clips, dur, false);
        renderFrame({ ctx, project, clips, audioPeaks, totalDur: dur }, dur);
        videoTrack?.requestFrame?.();
        resolve();
        return;
      }
      if (now >= nextFrame) {
        const drawT = Math.min(elapsed, dur);
        // Keep every video-backed clip's HTMLVideoElement playing in real
        // time alongside the canvas, so the recorder captures decoded
        // frames instead of a single frozen poster. Once we're past dur
        // we pause them to freeze the final composition for the tail.
        syncVideoPlayback(clips, drawT, elapsed < dur);
        renderFrame({ ctx, project, clips, audioPeaks, totalDur: dur }, drawT);
        // Force a sample on browsers that expose `requestFrame()`
        // (Chromium-based). Without this, `captureStream(fps)` may skip
        // emitting a frame when consecutive draws produce visually-
        // identical pixels (e.g. a paused video clip), which drifts the
        // recorded timestamps and can truncate the tail.
        videoTrack?.requestFrame?.();
        nextFrame += frameInterval;
        if (elapsed < dur) {
          onProgress?.({
            phase: 'recording',
            progress: Math.min(1, elapsed / dur),
            message: `Recording ${elapsed.toFixed(1)}s / ${dur.toFixed(1)}s`
          });
        }
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });

  onProgress?.({ phase: 'finalizing', progress: 0.98, message: 'Finalizing video…' });
  // Pause audio first so the encoder doesn't keep mixing in audio frames
  // while we wait for the final video clusters to flush.
  for (const el of audio.els) {
    try { el.pause(); } catch { /* ignore */ }
  }
  // We deliberately do NOT call `recorder.requestData()` here. Combining a
  // requestData() blob with the stop() blob produced a recording with two
  // back-to-back WebM init segments which corrupted playback past the
  // first segment on most players. With timeslice=1000 the encoder is
  // already emitting clusters every second, so the only data we're
  // waiting on at this point is the in-progress final cluster which
  // `stop()` flushes for us automatically.
  try {
    recorder.stop();
  } catch (err) {
    throw new Error(
      `Recorder failed to stop cleanly: ${(err as Error).message || 'unknown'}.`
    );
  }
  await finished;

  const rawBlob = new Blob(chunks, { type: mimeType });
  // A zero-byte blob means the encoder never produced any chunks — almost
  // always due to the canvas never being painted (e.g. all clip images
  // failed to load) or the MediaRecorder being stopped before the first
  // timeslice fired. Throw a clear error instead of handing the user a
  // useless 0-byte download.
  if (rawBlob.size === 0) {
    throw new Error(
      'Export produced an empty file. This usually means the recorder ' +
        'stopped before any frames were captured — try a longer project ' +
        'or refresh the page and retry.'
    );
  }

  // CRITICAL: MediaRecorder writes WebM with `Segment size = unknown` and
  // omits the Duration element entirely. Chromium <video> tags decode it
  // anyway, but Windows Media Player / Movies & TV, most desktop players,
  // and social-media uploaders (YouTube Shorts, Instagram Reels, TikTok)
  // refuse the file or display 0s duration — which users report as
  // "corrupted" / "won't play". We post-process the blob to inject the
  // missing Duration metadata. (MP4 from Safari already includes proper
  // duration in its moov atom, so we skip this step for non-WebM output.)
  let blob = rawBlob;
  if (mimeType.startsWith('video/webm')) {
    onProgress?.({
      phase: 'finalizing',
      progress: 0.99,
      message: 'Repairing duration metadata…'
    });
    // Use the INTENDED project duration (in ms), not `performance.now() -
    // startTs`. The wall-clock value includes the 400ms tail flush, the
    // post-stop `await finished` wait, plus any rAF throttling that
    // happened during recording (a backgrounded or busy tab can inflate
    // this several-fold). Writing a Duration larger than the actual
    // encoded content causes VLC and Windows Media Player to read past
    // the last cluster, hit EOF, and report the file as broken. The
    // encoder produces clusters covering exactly `dur` seconds of
    // timeline content, so `dur * 1000` is the correct value.
    const recordedMs = Math.max(1, Math.round(dur * 1000));
    try {
      blob = await fixWebmDuration(rawBlob, recordedMs, { logger: false });
    } catch {
      // If the patcher fails for any reason fall back to the raw blob —
      // it will still play in Chromium-based browsers.
      blob = rawBlob;
    }
  }
  // DIAGNOSTIC: final file stats. Compare blob.size vs dur to spot
  // "0-byte" / "way too small" exports at a glance.
   
  console.log('[Shorts export] finished', {
    mimeType,
    ext,
    durationSec: dur,
    rawBytes: rawBlob.size,
    finalBytes: blob.size,
    chunkCount: chunks.length
  });

  const url = URL.createObjectURL(blob);
  const filename = `shorts-${Date.now()}.${ext}`;

  onProgress?.({ phase: 'done', progress: 1, message: 'Done' });

  return { blob, url, mimeType, filename, durationSec: dur };
  } finally {
    // Always release the AudioContext, all <audio> elements, and the
    // MediaRecorder. Without this, a thrown error between setup and
    // `recorder.stop()` leaked an AudioContext per failed export —
    // browsers cap these per page and refuse to create new ones after
    // ~6 leaks, which manifested as "export does nothing" with no error.
    cleanup();
  }
}
