// Caption text utilities — filler-word filtering, SRT/VTT generation, and
// transcript edit helpers. Pure functions, no DOM / engine deps so the
// renderer, the exporter, and the script editor can all share them.

const BUILT_IN_FILLERS = new Set<string>([
  'uh',
  'um',
  'umm',
  'uhh',
  'er',
  'erm',
  'ah',
  'ahh',
  'eh',
  'mm',
  'mmm',
  'hmm',
  'like',
  'okay',
  'ok',
  'right',
  'so',
  'well',
  'basically',
  'literally',
  'actually',
  'honestly',
  'anyway'
]);

// Phrases (multi-word fillers) we collapse together. Matched after lowercase
// + punctuation strip on the joined text.
const FILLER_PHRASES = [
  'you know',
  'i mean',
  'kind of',
  'sort of',
  'you see'
];

/** Strip leading/trailing punctuation and lowercase a word for matching. */
function normalizeWord(w: string): string {
  return w.toLowerCase().replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, '');
}

export interface FilterResult {
  /** Cleaned text after filtering. */
  text: string;
  /** Cleaned word list (same length as wordTimes/wordEnds). */
  words: string[];
  /** Per-word starts in seconds. */
  wordTimes: number[];
  /** Per-word ends in seconds. */
  wordEnds: number[];
  /** Number of words removed. */
  removed: number;
}

/**
 * Drop filler / profanity words from a transcript while preserving timing.
 *
 * - Built-in filler list always applies when `enabled === true`
 * - Caller may pass extra words (e.g. profanity) via `extra`
 * - Multi-word phrases ("you know") are also collapsed
 *
 * Word timestamps are kept as-is for the surviving words; we don't try to
 * back-fill the gaps because Whisper's timestamps are anchored to actual
 * speech moments — pulling them earlier would push captions out of sync.
 */
export function filterFillerWords(
  text: string,
  wordTimes: number[] | undefined,
  wordEnds: number[] | undefined,
  enabled: boolean,
  extra: string[] = []
): FilterResult {
  const tokens = text.split(/\s+/).filter(Boolean);
  if (!enabled) {
    return {
      text,
      words: tokens,
      wordTimes: wordTimes ?? [],
      wordEnds: wordEnds ?? [],
      removed: 0
    };
  }

  const blocked = new Set<string>(BUILT_IN_FILLERS);
  for (const e of extra) {
    const n = normalizeWord(e);
    if (n) blocked.add(n);
  }

  // First pass: mark indices that are part of a banned 2-word phrase. We
  // do this on lowercased + normalized tokens.
  const norm = tokens.map(normalizeWord);
  const drop = new Array<boolean>(tokens.length).fill(false);
  for (const phrase of FILLER_PHRASES) {
    const parts = phrase.split(/\s+/);
    if (parts.length < 2) continue;
    for (let i = 0; i + parts.length - 1 < norm.length; i++) {
      let match = true;
      for (let k = 0; k < parts.length; k++) {
        if (norm[i + k] !== parts[k]) {
          match = false;
          break;
        }
      }
      if (match) for (let k = 0; k < parts.length; k++) drop[i + k] = true;
    }
  }

  // Second pass: single-word fillers.
  for (let i = 0; i < norm.length; i++) {
    if (drop[i]) continue;
    if (blocked.has(norm[i])) drop[i] = true;
  }

  const outWords: string[] = [];
  const outTimes: number[] = [];
  const outEnds: number[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (drop[i]) continue;
    outWords.push(tokens[i]);
    if (wordTimes && i < wordTimes.length) outTimes.push(wordTimes[i]);
    if (wordEnds && i < wordEnds.length) outEnds.push(wordEnds[i]);
  }

  return {
    text: outWords.join(' '),
    words: outWords,
    wordTimes: outTimes,
    wordEnds: outEnds,
    removed: drop.filter(Boolean).length
  };
}

// ---------------------------------------------------------------------------
// SRT / VTT export
// ---------------------------------------------------------------------------

/** Format seconds as `HH:MM:SS,mmm` (SRT) or `HH:MM:SS.mmm` (VTT). */
function formatTimestamp(sec: number, sep: ',' | '.'): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.round((sec - Math.floor(sec)) * 1000);
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(ms, 3)}`;
}

export interface CaptionCue {
  start: number;
  end: number;
  text: string;
}

/**
 * Group word-timestamped transcripts into displayable cues. Each cue holds
 * up to `wordsPerCue` words and is at most `maxDur` seconds long, so SRT
 * lines stay readable at TikTok pace.
 */
export function buildCues(
  words: string[],
  wordTimes: number[],
  wordEnds: number[],
  totalDur: number,
  wordsPerCue = 6,
  maxDur = 2.4
): CaptionCue[] {
  if (words.length === 0) return [];

  // If we don't have explicit word timings, fall back to even spacing across
  // totalDur — still good enough for a sidecar SRT.
  const haveTimes = wordTimes.length === words.length;
  const haveEnds = wordEnds.length === words.length;

  const cues: CaptionCue[] = [];
  let i = 0;
  while (i < words.length) {
    const groupStart = haveTimes
      ? wordTimes[i]
      : (i / Math.max(1, words.length)) * totalDur;
    let j = i;
    while (
      j < words.length &&
      j - i < wordsPerCue &&
      (!haveTimes ||
        (wordTimes[j] - groupStart < maxDur))
    ) {
      j++;
    }
    if (j === i) j = i + 1;
    const lastIdx = j - 1;
    const end = haveEnds
      ? wordEnds[lastIdx]
      : haveTimes && j < words.length
        ? wordTimes[j]
        : ((lastIdx + 1) / Math.max(1, words.length)) * totalDur;
    cues.push({
      start: groupStart,
      end: Math.max(end, groupStart + 0.3),
      text: words.slice(i, j).join(' ')
    });
    i = j;
  }
  return cues;
}

export function cuesToSRT(cues: CaptionCue[]): string {
  return cues
    .map((c, i) => {
      return `${i + 1}\n${formatTimestamp(c.start, ',')} --> ${formatTimestamp(c.end, ',')}\n${c.text}\n`;
    })
    .join('\n');
}

export function cuesToVTT(cues: CaptionCue[]): string {
  return (
    'WEBVTT\n\n' +
    cues
      .map((c) => {
        return `${formatTimestamp(c.start, '.')} --> ${formatTimestamp(c.end, '.')}\n${c.text}\n`;
      })
      .join('\n')
  );
}
