// Audio analysis: decode the audio file once and compute (a) the true total
// duration and (b) a list of timestamps at which the volume envelope spikes —
// these are *probably* the start of spoken syllables / words / drum hits.
// We use these timestamps to align caption-word reveals with the actual
// rhythm of the audio, without needing a real speech-to-text model.
//
// Decoding happens entirely client-side via the standard Web Audio
// `decodeAudioData` API. No keys, no network, no server.
//
// Results are cached per src so re-uploading the same audio doesn't redo the
// work, and so multiple components (caption renderer, AudioPanel trim slider)
// can share the same analysis.

export interface AudioAnalysis {
  /** Total audio duration in seconds. */
  duration: number;
  /**
   * Energy peak times (seconds, monotonically increasing). Each entry is a
   * timestamp where we detected an onset — a sudden rise in short-term RMS
   * energy. Useful as word-boundary candidates.
   */
  peaks: number[];
  /**
   * Coarse RMS-volume waveform sampled at ~30Hz. Useful for drawing the
   * trim slider's preview wave and for smoother text-energy visualisations.
   * Length ~= duration * 30. Values are 0..1.
   */
  waveform: number[];
}

const cache = new Map<string, Promise<AudioAnalysis>>();

/**
 * Analyze an audio source (dataURL or remote URL). The result is cached so
 * subsequent calls with the same src return immediately.
 */
export function analyzeAudio(src: string): Promise<AudioAnalysis> {
  const hit = cache.get(src);
  if (hit) return hit;
  const p = doAnalyze(src).catch((e) => {
    // Don't poison the cache on transient errors — let the next call retry.
    cache.delete(src);
    throw e;
  });
  cache.set(src, p);
  return p;
}

/** Drop a cached analysis if the user replaces the audio file. */
export function invalidateAudioAnalysis(src: string | null | undefined) {
  if (!src) return;
  cache.delete(src);
}

async function doAnalyze(src: string): Promise<AudioAnalysis> {
  // Fetch as ArrayBuffer. `fetch()` works on dataURLs in modern browsers.
  const res = await fetch(src);
  const buf = await res.arrayBuffer();

  // OfflineAudioContext is used purely for decoding — we only need the raw
  // samples, not real-time playback. We pick 44.1kHz mono for analysis even
  // if the source is stereo / different rate; decodeAudioData handles
  // resampling implicitly via the AudioContext sample rate.
  const Ctx = window.OfflineAudioContext || (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  // Some browsers refuse 0-length OfflineAudioContext at construction; we
  // need a temp AudioContext for decoding instead.
  const tmp = new (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)();
  let audio: AudioBuffer;
  try {
    audio = await tmp.decodeAudioData(buf.slice(0));
  } finally {
    tmp.close().catch(() => {});
  }
  void Ctx;

  const duration = audio.duration;
  // Mix down to mono: average channel data.
  const channelCount = audio.numberOfChannels;
  const length = audio.length;
  const sr = audio.sampleRate;
  const mono = new Float32Array(length);
  for (let ch = 0; ch < channelCount; ch++) {
    const data = audio.getChannelData(ch);
    for (let i = 0; i < length; i++) mono[i] += data[i];
  }
  if (channelCount > 1) for (let i = 0; i < length; i++) mono[i] /= channelCount;

  // ---------- RMS waveform (30 Hz) ----------
  const wfHz = 30;
  const wfLen = Math.max(1, Math.floor(duration * wfHz));
  const wfWindow = Math.max(1, Math.floor(sr / wfHz));
  const waveform = new Array<number>(wfLen);
  let maxRms = 0;
  for (let i = 0; i < wfLen; i++) {
    const start = i * wfWindow;
    const end = Math.min(length, start + wfWindow);
    let sumSq = 0;
    for (let j = start; j < end; j++) sumSq += mono[j] * mono[j];
    const rms = Math.sqrt(sumSq / Math.max(1, end - start));
    waveform[i] = rms;
    if (rms > maxRms) maxRms = rms;
  }
  // Normalize 0..1
  const norm = maxRms > 0 ? 1 / maxRms : 1;
  for (let i = 0; i < wfLen; i++) waveform[i] = Math.min(1, waveform[i] * norm);

  // ---------- Peak detection ----------
  // We want onset peaks: sudden energy increases. Compute a short-term energy
  // signal at ~100Hz, then find points where the energy is much higher than
  // the recent average AND a local maximum.
  const peakHz = 100;
  const peakWindow = Math.max(1, Math.floor(sr / peakHz));
  const peLen = Math.max(1, Math.floor(duration * peakHz));
  const energy = new Float32Array(peLen);
  for (let i = 0; i < peLen; i++) {
    const start = i * peakWindow;
    const end = Math.min(length, start + peakWindow);
    let sumSq = 0;
    for (let j = start; j < end; j++) sumSq += mono[j] * mono[j];
    energy[i] = Math.sqrt(sumSq / Math.max(1, end - start));
  }
  // Smoothed running average (50ms = 5 frames at 100Hz).
  const avgWin = 5;
  const avg = new Float32Array(peLen);
  let runSum = 0;
  for (let i = 0; i < peLen; i++) {
    runSum += energy[i];
    if (i >= avgWin) runSum -= energy[i - avgWin];
    avg[i] = runSum / Math.min(i + 1, avgWin);
  }
  // Onset = energy >> recent average. Pick threshold relative to global max.
  let globalMax = 0;
  for (let i = 0; i < peLen; i++) if (energy[i] > globalMax) globalMax = energy[i];
  const noiseFloor = globalMax * 0.08; // ignore quiet sections
  const peaks: number[] = [];
  // Minimum gap between picked peaks = 120ms (so we don't over-pick on busy music).
  const minGapFrames = Math.floor(0.12 * peakHz);
  let lastPeak = -minGapFrames;
  for (let i = 1; i < peLen - 1; i++) {
    const e = energy[i];
    if (e < noiseFloor) continue;
    if (e <= avg[i] * 1.35) continue; // not a strong rise
    if (e <= energy[i - 1] || e <= energy[i + 1]) continue; // not a local max
    if (i - lastPeak < minGapFrames) continue;
    peaks.push(i / peakHz);
    lastPeak = i;
  }

  return { duration, peaks, waveform };
}

/**
 * Distribute `n` reveal-times across [start, end] using detected peaks when
 * possible, falling back to even spacing. The returned array has exactly `n`
 * monotonically increasing timestamps inside [start, end).
 *
 * Strategy:
 *   - filter peaks inside the window
 *   - if we have >= n peaks, pick `n` of them spaced as evenly as possible
 *     (so e.g. 8 words on 30 peaks land on every ~4th peak rather than all
 *     squashed at the front)
 *   - if fewer peaks than words, blend: use peaks where available and fill
 *     remaining slots with even spacing
 */
export function distributeRevealTimes(
  peaks: number[],
  n: number,
  start: number,
  end: number
): number[] {
  const span = Math.max(0.001, end - start);
  if (n <= 0) return [];
  // Always include even-spaced fallback.
  const even = Array.from({ length: n }, (_, i) => start + ((i + 0.5) / n) * span);
  const inWindow = peaks.filter((p) => p >= start && p < end);
  if (inWindow.length === 0) return even;
  if (inWindow.length >= n) {
    // Pick n evenly-spaced peaks.
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const idx = Math.floor(((i + 0.5) / n) * inWindow.length);
      out.push(inWindow[Math.min(inWindow.length - 1, idx)]);
    }
    // Ensure strictly increasing.
    for (let i = 1; i < out.length; i++) if (out[i] <= out[i - 1]) out[i] = out[i - 1] + 0.001;
    return out;
  }
  // Mix mode: use peaks but fill gaps with even spacing.
  const out = even.slice();
  for (let i = 0; i < inWindow.length; i++) {
    const slot = Math.floor((inWindow[i] - start) / span * n);
    if (slot >= 0 && slot < n) out[slot] = inWindow[i];
  }
  out.sort((a, b) => a - b);
  for (let i = 1; i < out.length; i++) if (out[i] <= out[i - 1]) out[i] = out[i - 1] + 0.001;
  return out;
}
