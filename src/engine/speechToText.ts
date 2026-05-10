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

/**
 * Whisper model variants we expose in the UI.
 *  - 'en'   : English-only (fastest, ~150 MB fp32)
 *  - 'multi': 99-language model (auto-detects + transcribes; ~290 MB fp32)
 */
export type WhisperModelKind = 'en' | 'multi';

export interface TranscribeOptions {
  /** Optional [start, end] window in seconds. */
  trim?: { start?: number; end?: number };
  /** Model to use — default 'en'. */
  model?: WhisperModelKind;
  /**
   * Spoken language hint for the multilingual model. ISO-639-1 like 'en',
   * 'es', 'hi'… or 'auto' to let Whisper detect. Ignored for the en-only
   * model.
   */
  language?: string;
  onProgress?: (p: STTProgress) => void;
}

const MODEL_IDS: Record<WhisperModelKind, string> = {
  // Newer, transformers.js v3-native ports avoid the qdq / SimplifiedLayerNorm
  // bugs that the original `Xenova/*` exports trigger on current Chromium.
  en: 'onnx-community/whisper-tiny.en',
  multi: 'onnx-community/whisper-base'
};
const TARGET_SAMPLE_RATE = 16000; // Whisper expects 16 kHz mono float32

// Module-level cache. We key by model kind so switching between en-only
// and multilingual loads cleanly without colliding. The runtime + WASM
// shards download exactly once per kind and are reused thereafter.
const pipelineCache = new Map<WhisperModelKind, Promise<unknown>>();

async function getPipeline(
  kind: WhisperModelKind,
  onProgress?: (p: STTProgress) => void
): Promise<(input: Float32Array, opts: object) => Promise<unknown>> {
  if (!pipelineCache.has(kind)) {
    const p = (async () => {
      onProgress?.({ stage: 'load-model', message: 'Loading Whisper model\u2026' });
      // Dynamic import keeps transformers.js + ONNX runtime out of the main bundle.
      const { pipeline, env } = await import('@huggingface/transformers');

      env.allowLocalModels = false;

      // -------------------------------------------------------------------
      // dtype + device strategy (battle-tested order)
      // -------------------------------------------------------------------
      // CRITICAL discovery (May 2026): passing `dtype: 'fp32'` as a SINGLE
      // STRING does NOT cascade to all whisper sub-models. transformers.js
      // v3 silently keeps the merged decoder at q4, then ORT-Web throws
      //   "qdq_actions.cc:137 TransposeDQWeightsForMatMulNBits Missing
      //    required scale: ...weight_merged_0_scale..."
      // The fix is to pass `dtype` as a per-component dict so the encoder
      // and decoder_model_merged each get an explicit precision. This is
      // also the pattern documented on onnx-community model cards.
      //
      // Working combos on Chromium / WASM:
      //   * encoder=fp32,  decoder_merged=fp32  — most stable, biggest
      //   * encoder=fp32,  decoder_merged=q4    — much smaller, sometimes
      //                                          breaks on Windows ORT
      //
      // Broken combos to AVOID:
      //   * Any `fp16` encoder (SimplifiedLayerNormFusion crash)
      //   * `q8`/`int8` anywhere (qdq_actions / MatMulNBits crash)
      //   * Single-string dtype (silent q4 cascade — the bug above)
      type DtypeDict = {
        encoder_model: 'fp32' | 'q4';
        decoder_model_merged: 'fp32' | 'q4';
      };
      type Attempt = {
        device: 'webgpu' | 'wasm';
        dtype: DtypeDict;
        label: string;
      };

      const isWindows =
        typeof navigator !== 'undefined' &&
        /Windows/i.test(navigator.userAgent || '');
      const hasWebGPU =
        typeof navigator !== 'undefined' &&
        'gpu' in navigator &&
        (navigator as Navigator & { gpu?: unknown }).gpu != null;

      const attempts: Attempt[] = [
        // 1) Full fp32 — heaviest but bulletproof on every backend.
        {
          device: 'wasm',
          dtype: { encoder_model: 'fp32', decoder_model_merged: 'fp32' },
          label: 'wasm fp32 encoder + fp32 decoder (stable)'
        },
        // 2) fp32 encoder + q4 decoder — half the bytes; works when q4 is
        //    supported by the host OS but encoder still must stay fp32.
        {
          device: 'wasm',
          dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
          label: 'wasm fp32 encoder + q4 decoder (compact)'
        }
      ];
      if (hasWebGPU && !isWindows) {
        // WebGPU only on non-Windows where powerPreference is honoured.
        attempts.unshift({
          device: 'webgpu',
          dtype: { encoder_model: 'fp32', decoder_model_merged: 'fp32' },
          label: 'webgpu fp32 (GPU accelerated)'
        });
      }

      const progressForward = (data: unknown) => {
        const d = data as {
          status?: string;
          file?: string;
          loaded?: number;
          total?: number;
          progress?: number;
        };
        if (d.status === 'progress' && d.total) {
          onProgress?.({
            stage: 'load-model',
            progress: (d.loaded ?? 0) / d.total,
            loaded: d.loaded,
            total: d.total,
            message: d.file
              ? `Downloading ${d.file} (${((d.loaded ?? 0) / 1048576).toFixed(1)} / ${(d.total / 1048576).toFixed(1)} MB)`
              : undefined
          });
        } else if (d.status === 'ready' || d.status === 'done') {
          onProgress?.({ stage: 'load-model', progress: 1 });
        }
      };

      let lastErr: unknown = null;
      // Track whether we've already auto-purged the HTTP/IDB cache during
      // this load attempt so we never loop forever if the network itself
      // is the problem.
      let autoPurged = false;
      for (let i = 0; i < attempts.length; i++) {
        const a = attempts[i];
        onProgress?.({
          stage: 'load-model',
          message: `Trying ${a.label}\u2026`
        });
        try {
          // eslint-disable-next-line no-console
          console.info(`[speechToText] Attempt ${i + 1}/${attempts.length}: ${a.label} on ${MODEL_IDS[kind]}`);
          const pipe = await pipeline(
            'automatic-speech-recognition',
            MODEL_IDS[kind],
            {
              dtype: a.dtype,
              device: a.device,
              progress_callback: progressForward
            }
          );
          // eslint-disable-next-line no-console
          console.info(`[speechToText] \u2713 Loaded ${a.label}`);
          return pipe;
        } catch (err) {
          lastErr = err;
          const msg = String((err as Error)?.message ?? err);
          const isPoisonedCache =
            /qdq_actions|MatMulNBits|Missing required scale|SimplifiedLayerNormFusion|InsertedPrecisionFreeCast/i.test(
              msg
            );

          // Self-heal: if we hit the qdq / fusion bugs and we haven't yet
          // wiped the HTTP cache this run, purge it and re-try the SAME
          // attempt once. These errors usually mean the browser cached a
          // half-broken weight file from an earlier session.
          if (isPoisonedCache && !autoPurged) {
            autoPurged = true;
            // eslint-disable-next-line no-console
            console.warn(
              `[speechToText] Detected poisoned cache for ${MODEL_IDS[kind]}. Auto-purging Cache Storage + IndexedDB and retrying ${a.label}\u2026`
            );
            onProgress?.({
              stage: 'load-model',
              message: 'Cleaning corrupt model cache and retrying\u2026'
            });
            try {
              if (typeof caches !== 'undefined') {
                await caches.delete('transformers-cache');
              }
              if (typeof indexedDB !== 'undefined' && 'databases' in indexedDB) {
                const dbs = await (
                  indexedDB as unknown as {
                    databases: () => Promise<{ name?: string }[]>;
                  }
                ).databases();
                await Promise.all(
                  dbs
                    .filter(
                      (d) =>
                        d.name &&
                        /transformers|huggingface|whisper|onnx/i.test(d.name)
                    )
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
            // Replay the same attempt by decrementing i.
            i -= 1;
            continue;
          }

          const isLast = i === attempts.length - 1;
          // eslint-disable-next-line no-console
          console.warn(
            `[speechToText] ${a.label} failed${isLast ? '' : ' \u2014 falling back'}. (${msg.slice(0, 200)})`
          );
          if (isLast) {
            // Throw a friendly composite error instead of the raw ORT one.
            throw new Error(
              `Whisper failed to load on every backend. Last error: ${msg.slice(0, 240)}`
            );
          }
        }
      }
      throw lastErr ?? new Error('Whisper pipeline failed to load.');
    })();
    pipelineCache.set(kind, p);
    // If the load fails, drop the cached promise so the next attempt retries.
    p.catch(() => pipelineCache.delete(kind));
  }
  return (await pipelineCache.get(kind)!) as (
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
  pipelineCache.clear();
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
 * Accepts a single options object so callers can mix model + trim + language
 * + progress freely without positional argument soup.
 */
export async function transcribeAudio(
  src: string,
  options: TranscribeOptions = {}
): Promise<STTResult> {
  if (!src) throw new Error('No audio source provided.');

  const { trim, model = 'en', language = 'auto', onProgress } = options;

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
  // eslint-disable-next-line no-console
  console.info(
    `[speechToText] Sending ${workingDuration.toFixed(2)}s (${workingSamples.length} samples @ 16 kHz, ` +
      `${(workingSamples.byteLength / 1048576).toFixed(2)} MB) to Whisper. ` +
      `Trim window: [${(trim?.start ?? 0).toFixed(2)}s\u2013${(trim?.end ?? duration).toFixed(2)}s] of ${duration.toFixed(2)}s file.`
  );

  const pipe = await getPipeline(model, onProgress);

  onProgress?.({ stage: 'transcribe', message: 'Transcribing\u2026' });
  // `return_timestamps: 'word'` gives us per-word [start, end] timestamps.
  // chunk_length_s + stride_length_s let Whisper handle long audio (>30s).
  // For the multilingual model we also honour a language hint (or 'auto'
  // which lets Whisper detect from the first chunk).
  const callOpts: Record<string, unknown> = {
    return_timestamps: 'word',
    chunk_length_s: 30,
    stride_length_s: 5
  };
  if (model === 'multi') {
    if (language && language !== 'auto') callOpts.language = language;
    callOpts.task = 'transcribe';
  }
  let out: { text: string; chunks?: { text: string; timestamp: [number, number | null] }[] };
  try {
    out = (await pipe(workingSamples, callOpts)) as typeof out;
  } catch (err) {
    // Inference failed AFTER the model loaded. The pipeline is now in a
    // half-broken state (especially on WebGPU OOM); evict so a retry
    // re-attempts with a fresh device/dtype combo.
    pipelineCache.delete(model);
    const msg = String((err as Error)?.message ?? err);
    throw new Error(
      `Transcription failed during inference. Try again, or click "Clear cache & retry". (${msg.slice(0, 200)})`
    );
  }

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
    language: model === 'en' ? 'en' : language || 'auto',
    duration: workingDuration
  };
}
