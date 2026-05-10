// In-browser speech-to-text using Whisper via @huggingface/transformers.
//
// Why this exists:
//   - The user wants captions to follow what's actually spoken in the audio,
//     not just rough volume peaks.
//   - We avoid any cloud API / API key — everything runs locally in the
//     browser using WebAssembly + WebGPU when available.
//
// First call downloads ~40MB (whisper-tiny.en) into the browser's IndexedDB
// model cache. Subsequent runs are instant. Languages other than English
// would need whisper-tiny (multilingual, ~75MB); we default to English-only
// for size + accuracy, and let callers pass a model override if needed.
//
// Output is word-level timestamps so the caption renderer can reveal each
// word at the exact moment it's spoken.
//
// Implementation note: the entire @huggingface/transformers SDK (incl. its
// ONNX runtime + WASM) is *dynamically imported* inside `getPipeline()` so
// it lands in its own Vite chunk. That keeps the initial app bundle small
// — users who never transcribe pay zero cost.

export interface STTWord {
  word: string;
  start: number; // seconds, relative to audio file t=0
  end: number;
}

export interface STTResult {
  text: string;
  words: STTWord[];
  language: string;
  duration: number;
}

export interface STTProgress {
  stage: 'load-model' | 'decode-audio' | 'transcribe' | 'done';
  /** 0..1 when known, undefined otherwise */
  progress?: number;
  /** Bytes loaded / total when stage === 'load-model' */
  loaded?: number;
  total?: number;
  message?: string;
}

const MODEL_ID = 'Xenova/whisper-tiny.en';
const TARGET_SAMPLE_RATE = 16000; // Whisper expects 16 kHz mono float32

// Module-level singleton. Building the pipeline downloads weights and
// instantiates the runtime — we want that to happen exactly once.
// Type left as `unknown` here because the SDK is dynamic-imported below
// (so it ends up in its own Vite chunk).
let pipelinePromise: Promise<unknown> | null = null;

async function getPipeline(
  onProgress?: (p: STTProgress) => void
): Promise<(input: Float32Array, opts: object) => Promise<unknown>> {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      onProgress?.({ stage: 'load-model', message: 'Loading Whisper model\u2026' });
      // Dynamic import keeps transformers.js + ONNX runtime out of the main bundle.
      const { pipeline, env } = await import('@huggingface/transformers');

      // Force CDN downloads (defaults are fine, but be explicit so cached
      // partial-failures from earlier sessions can be re-fetched cleanly).
      env.allowLocalModels = false;

      // -------------------------------------------------------------------
      // dtype selection notes
      // -------------------------------------------------------------------
      // The default Whisper q4 quantization triggers this ORT bug:
      //   "qdq_actions.cc:137 TransposeDQWeightsForMatMulNBits
      //    Missing required scale: ... weight_merged_0_scale"
      // on many Chromium builds. The flat-string dtype form (e.g. 'q8') gets
      // silently downgraded to q4 for sub-models that lack a q8 variant on
      // the HuggingFace Hub — which is exactly what bit us. The merged
      // decoder for whisper-tiny.en only ships in q4 / q4f16 / fp16 / fp32,
      // so we MUST use the per-submodel object form to force a non-q4
      // variant on `decoder_model_merged`.
      //
      // Try the smaller fp16 split first (encoder fp16 ≈ 30MB, decoder fp32
      // ≈ 110MB). If that combo fails for any reason, fall back to full
      // fp32 across the board (most reliable, ~160MB).
      type DtypeMap = {
        encoder_model: 'fp16' | 'fp32';
        decoder_model_merged: 'fp16' | 'fp32';
      };
      const dtypeAttempts: Array<DtypeMap | 'fp32'> = [
        { encoder_model: 'fp16', decoder_model_merged: 'fp32' },
        'fp32'
      ];

      const progressForward = (data: unknown) => {
        const d = data as {
          status?: string;
          loaded?: number;
          total?: number;
          progress?: number;
        };
        if (d.status === 'progress' && d.total) {
          onProgress?.({
            stage: 'load-model',
            progress: (d.loaded ?? 0) / d.total,
            loaded: d.loaded,
            total: d.total
          });
        } else if (d.status === 'ready' || d.status === 'done') {
          onProgress?.({ stage: 'load-model', progress: 1 });
        }
      };

      let lastErr: unknown = null;
      for (let i = 0; i < dtypeAttempts.length; i++) {
        const dtype = dtypeAttempts[i];
        try {
          const pipe = await pipeline('automatic-speech-recognition', MODEL_ID, {
            dtype,
            progress_callback: progressForward
          });
          return pipe;
        } catch (err) {
          lastErr = err;
          // ONNX session-creation failures throw with strings containing
          // "Can't create a session" or "qdq_actions". Only retry on those —
          // network/permission errors should fail fast.
          const msg = String((err as Error)?.message ?? err);
          const retryable =
            /create a session|qdq_actions|MatMulNBits|missing required scale|protobuf parsing failed|model load failed/i.test(
              msg
            );
          if (!retryable || i === dtypeAttempts.length - 1) throw err;
          const dtypeLabel =
            typeof dtype === 'string' ? dtype : JSON.stringify(dtype);
          // eslint-disable-next-line no-console
          console.warn(
            `[speechToText] Whisper load failed with dtype ${dtypeLabel} — retrying with full fp32. (${msg.slice(0, 160)})`
          );
        }
      }
      // Should be unreachable — the loop either returns or throws.
      throw lastErr ?? new Error('Whisper pipeline failed to load.');
    })();
    // If the load fails, drop the cached promise so the next attempt retries.
    pipelinePromise.catch(() => {
      pipelinePromise = null;
    });
  }
  return (await pipelinePromise) as (
    input: Float32Array,
    opts: object
  ) => Promise<unknown>;
}

/**
 * Wipe the in-browser model cache and reset our pipeline singleton.
 *
 * The first transcription attempt sometimes leaves a partial / corrupt
 * shard in IndexedDB after a network blip. The next load then hits the
 * broken cached file and fails forever. This utility lets the UI offer a
 * "Clear cache & retry" button so users can recover without DevTools.
 */
export async function clearWhisperCache(): Promise<void> {
  pipelinePromise = null;
  if (typeof indexedDB === 'undefined') return;
  // The library uses a Cache Storage entry named 'transformers-cache'.
  // We also kill any IndexedDB databases that look related, just in case.
  try {
    if (typeof caches !== 'undefined') {
      await caches.delete('transformers-cache');
    }
  } catch {
    /* ignore */
  }
  try {
    // Older versions used IDB; iterate and drop anything Hugging Face owned.
    if ('databases' in indexedDB) {
      const dbs = await (indexedDB as unknown as {
        databases: () => Promise<{ name?: string }[]>;
      }).databases();
      await Promise.all(
        dbs
          .filter((d) => d.name && /transformers|huggingface|whisper|onnx/i.test(d.name))
          .map(
            (d) =>
              new Promise<void>((resolve) => {
                const req = indexedDB.deleteDatabase(d.name!);
                req.onsuccess = () => resolve();
                req.onerror = () => resolve();
                req.onblocked = () => resolve();
              })
          )
      );
    }
  } catch {
    /* ignore */
  }
}

/**
 * Decode an audio source (data URL, blob URL, or http URL) into a 16kHz mono
 * Float32Array, which is what Whisper expects.
 */
async function decodeTo16kMono(src: string): Promise<{ samples: Float32Array; duration: number }> {
  const res = await fetch(src);
  if (!res.ok) throw new Error(`Failed to fetch audio (${res.status})`);
  const buf = await res.arrayBuffer();

  // Decode at native sample rate first (using a temporary AudioContext);
  // then resample to 16kHz with OfflineAudioContext for an exact result.
  const tmpCtx = new (window.AudioContext || (window as unknown as {
    webkitAudioContext: typeof AudioContext;
  }).webkitAudioContext)();
  let decoded: AudioBuffer;
  try {
    decoded = await tmpCtx.decodeAudioData(buf.slice(0));
  } finally {
    // Closing keeps Chrome from running out of AudioContext slots.
    void tmpCtx.close();
  }

  const duration = decoded.duration;
  const targetLen = Math.ceil(duration * TARGET_SAMPLE_RATE);
  const off = new OfflineAudioContext(1, targetLen, TARGET_SAMPLE_RATE);
  const srcNode = off.createBufferSource();
  srcNode.buffer = decoded;
  // Mix down to mono by averaging channels via a ChannelMergerNode/gain
  // chain — but the simplest path is: buffer source -> destination, since
  // OfflineAudioContext with `numberOfChannels = 1` already downmixes.
  srcNode.connect(off.destination);
  srcNode.start();
  const rendered = await off.startRendering();
  const samples = rendered.getChannelData(0).slice(); // copy out of the buffer
  return { samples, duration };
}

/**
 * Transcribe an audio file with word-level timestamps.
 *
 * @param src         Audio source URL (data:, blob:, or http(s):)
 * @param trim        Optional [start, end] window in seconds. Only audio in
 *                    this window is sent to Whisper, which is much faster
 *                    for long files and prevents transcribing material the
 *                    user has trimmed out. Word timestamps in the result
 *                    are still expressed in audio-file time (i.e. shifted
 *                    by `trim.start`) so callers can keep treating them as
 *                    absolute.
 * @param onProgress  Optional UI progress hook
 */
export async function transcribeAudio(
  src: string,
  trim?: { start?: number; end?: number },
  onProgress?: (p: STTProgress) => void
): Promise<STTResult> {
  if (!src) throw new Error('No audio source provided.');

  onProgress?.({ stage: 'decode-audio', message: 'Decoding audio\u2026' });
  const { samples, duration } = await decodeTo16kMono(src);

  // Slice to the trim window if requested. We keep `offsetSec` so we can
  // shift the returned word timestamps back into audio-file time below.
  let workingSamples = samples;
  let offsetSec = 0;
  let workingDuration = duration;
  if (trim) {
    const startSec = Math.max(0, trim.start ?? 0);
    const endSec = Math.min(duration, trim.end ?? duration);
    if (endSec > startSec + 0.05) {
      const startSample = Math.max(0, Math.floor(startSec * TARGET_SAMPLE_RATE));
      const endSample = Math.min(
        samples.length,
        Math.ceil(endSec * TARGET_SAMPLE_RATE)
      );
      workingSamples = samples.slice(startSample, endSample);
      offsetSec = startSec;
      workingDuration = endSec - startSec;
    }
  }

  const pipe = await getPipeline(onProgress);

  onProgress?.({ stage: 'transcribe', message: 'Transcribing\u2026' });
  // `return_timestamps: 'word'` gives us per-word [start, end] timestamps.
  // chunk_length_s + stride_length_s let Whisper handle long audio (>30s).
  const out = (await pipe(workingSamples, {
    return_timestamps: 'word',
    chunk_length_s: 30,
    stride_length_s: 5
  })) as { text: string; chunks?: { text: string; timestamp: [number, number | null] }[] };

  const chunks = out.chunks ?? [];
  const words: STTWord[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    const w = (c.text ?? '').trim();
    if (!w) continue;
    const rawStart = c.timestamp[0] ?? 0;
    const start = rawStart + offsetSec;
    // If end is null (last token), fall back to the next word's start or +0.3s.
    const rawEnd =
      c.timestamp[1] ??
      (i + 1 < chunks.length ? chunks[i + 1].timestamp[0] ?? rawStart + 0.3 : rawStart + 0.3);
    const end = rawEnd + offsetSec;
    words.push({ word: w, start, end });
  }

  onProgress?.({ stage: 'done', progress: 1 });
  return {
    text: (out.text ?? '').trim(),
    words,
    language: 'en',
    duration: workingDuration
  };
}
