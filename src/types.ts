// Shared types for the Shorts Studio editor.

/**
 * 45+ animation effects, plus the special 'auto' value which lets the AI
 * pick one based on the prompt + a per-clip seed (so the same prompt can
 * still surface different motion across regenerations).
 */
export type EffectId =
  | 'auto'
  // Camera moves
  | 'kenburns'
  | 'kenburnsReverse'
  | 'zoomIn'
  | 'zoomOut'
  | 'zoomInFast'
  | 'zoomOutFast'
  | 'panLeft'
  | 'panRight'
  | 'panUp'
  | 'panDown'
  | 'dollyIn'
  | 'dollyOut'
  | 'orbit'
  | 'parallax'
  | 'parallaxReverse'
  // Energy / impact
  | 'shake'
  | 'shakeHard'
  | 'pulse'
  | 'pulseFast'
  | 'beatDrop'
  | 'bounce'
  | 'wiggle'
  | 'rotateCW'
  | 'rotateCCW'
  | 'tilt'
  | 'sway'
  // Transforms
  | 'flipH'
  | 'flipV'
  | 'mirror'
  // Color / light
  | 'fade'
  | 'fadeBlackIn'
  | 'fadeWhiteIn'
  | 'flash'
  | 'strobe'
  | 'vignettePulse'
  | 'colorPop'
  | 'desaturate'
  | 'duotone'
  | 'sepia'
  | 'invert'
  | 'hueShift'
  // Glitch / digital
  | 'glitch'
  | 'glitchHard'
  | 'rgbSplit'
  | 'scanlines'
  | 'pixelate'
  | 'vhsRoll'
  // Focus / blur
  | 'blurIn'
  | 'blurOut'
  | 'focusPull'
  | 'tiltShift';

export type TransitionId =
  | 'cut'
  | 'fade'
  | 'slide'
  | 'whip'
  | 'zoomBlur';

/**
 * Caption animation styles. Like effects, 'auto' lets the AI pick a style
 * (color/font/animation/accent) per clip from the prompt + a per-clip seed.
 * 'none' disables animation but still draws a static caption (legacy look).
 */
export type CaptionAnimationId =
  | 'auto'
  | 'none'
  | 'pop'
  | 'wordPop'
  | 'typewriter'
  | 'slideUp'
  | 'fall'
  | 'bounce'
  | 'wave'
  | 'shake'
  | 'glitch'
  | 'rainbow'
  | 'neon';

export interface ImageClip {
  id: string;
  /** dataURL or remote URL of the image */
  src: string;
  /** seconds */
  duration: number;
  effect: EffectId;
  transition: TransitionId;
  caption?: string;
  /** Animation used to render the caption when captions are enabled. */
  captionAnim?: CaptionAnimationId;
  /**
   * Seed used by the caption AI picker so 'auto' captions get deterministic
   * but varied styling per clip. Re-rolling generates a fresh visual look.
   */
  captionStyleSeed?: number;
  /** prompt used if generated via AI, for re-rolls */
  prompt?: string;
  /**
   * Stable random seed used by the AI auto-effect picker so each clip with
   * `effect: 'auto'` resolves to a deterministic but varied concrete effect.
   * Without this, two clips with the same prompt would always pick the same
   * effect — defeating the "not fixed every time" goal.
   */
  effectSeed?: number;
}

export interface ProjectAudio {
  /** dataURL or URL */
  src: string | null;
  name: string;
  volume: number; // 0..1
  /**
   * Trim window inside the source audio file (seconds). The preview & export
   * use this slice instead of the full track. Defaults to the whole file
   * (start=0, end=duration). `duration` is filled in once the audio is
   * decoded; until then it's `null` and the renderer treats it as "full file".
   */
  start: number;
  end: number | null;
  /** Total duration of the source file in seconds (decoded once). */
  duration: number | null;
  /**
   * How audio + video lengths are reconciled.
   *  - 'loop'      : audio loops to fill video length (default, legacy behavior)
   *  - 'fitVideo'  : audio plays exactly the trimmed range, video stretches to match
   *  - 'fitAudio'  : video plays at its sum-of-clip-durations length, audio range trims to match
   */
  syncMode: 'loop' | 'fitVideo' | 'fitAudio';
}

export interface ProjectScript {
  /**
   * Full transcript / script for the video. Words are revealed across the
   * whole timeline (not stuck on one clip) when captions are enabled and
   * a script is provided. Empty = use per-clip captions instead.
   */
  text: string;
  /**
   * 'even'        — distribute words evenly across the full duration
   * 'audio'       — align word reveals to detected audio volume peaks (rough rhythm)
   * 'transcript'  — use exact word timestamps from speech-to-text (most accurate)
   */
  syncMode: 'even' | 'audio' | 'transcript';
  /** Caption animation override for the whole script. */
  animation: CaptionAnimationId;
  /** Seed for the AI styling picker (font / colors). */
  styleSeed: number;
  /**
   * Per-word *start* times (seconds, relative to project t=0) produced by
   * speech-to-text. Index matches the i-th word in `text` after splitting on
   * whitespace. When present and syncMode === 'transcript', the renderer
   * snaps each word's reveal to its exact spoken time.
   */
  wordTimes?: number[];
  /**
   * Per-word end times paired with `wordTimes`. Optional — used to clip
   * extra-fast utterances so reveal animations don't overlap awkwardly.
   */
  wordEnds?: number[];
  /**
   * Whisper model to use when transcribing. 'en' (English-only, fast) or
   * 'multi' (99-language). Stored on the project so re-transcribes use the
   * same model the user picked last time.
   */
  sttModel?: 'en' | 'multi';
  /**
   * Spoken language hint for the multilingual model. ISO-639-1 code or
   * 'auto' to detect.
   */
  sttLanguage?: string;
  /**
   * Karaoke highlight on the currently-spoken word. Off by default — when
   * on, the active word gets a glow + slight scale and surrounding words
   * dim, like TikTok / Reels live captions.
   */
  karaoke?: boolean;
  /**
   * Visual preset key. Overrides the AI style picker when set. See
   * CAPTION_PRESETS in `src/engine/captionPresets.ts`.
   */
  preset?: string;
  /**
   * Drop common filler words (uh, um, like, you-know\u2026) from the rendered
   * captions. Word timings are re-paced so the remaining words still align
   * with the underlying audio.
   */
  filterFillers?: boolean;
  /** Custom additional words to drop alongside the built-in filler list. */
  customFillers?: string[];
  /**
   * Burn captions into the video pixels (default true). When false, the
   * exporter skips drawing captions on the canvas and instead writes a
   * sidecar .srt / .vtt file alongside the .webm download.
   */
  burnIn?: boolean;
}

export interface ProjectState {
  clips: ImageClip[];
  audio: ProjectAudio;
  width: number; // 1080
  height: number; // 1920
  fps: number; // 30
  /**
   * Master switch for the animated-caption overlay. Defaults off so users who
   * upgrade don't get unexpected text on their existing projects.
   */
  captionsEnabled: boolean;
  /**
   * Project-level script that spans the full video (all clips). When set
   * (and captionsEnabled is true), this overrides per-clip captions and is
   * rendered with word-by-word reveals across the entire timeline. Use this
   * when the script is in the audio (e.g. voiceover) so text aligns with
   * speech instead of getting stuck on the first clip.
   */
  script: ProjectScript;
  /** Global caption style */
  captionStyle: {
    fontFamily: string;
    color: string;
    stroke: string;
    size: number; // px in render space
    weight: number;
  };
}

export const DEFAULT_PROJECT: ProjectState = {
  clips: [],
  audio: {
    src: null,
    name: '',
    volume: 0.8,
    start: 0,
    end: null,
    duration: null,
    syncMode: 'loop'
  },
  width: 1080,
  height: 1920,
  fps: 30,
  captionsEnabled: false,
  script: {
    text: '',
    syncMode: 'even',
    animation: 'auto',
    styleSeed: 1
  },
  captionStyle: {
    fontFamily: 'Inter, system-ui, sans-serif',
    color: '#ffffff',
    stroke: '#000000',
    size: 72,
    weight: 800
  }
};

/** Pretty labels for every effect, for the picker UI. */
export const EFFECT_LABELS: Record<EffectId, string> = {
  auto: 'AI Auto-pick',
  // Camera
  kenburns: 'Ken Burns',
  kenburnsReverse: 'Ken Burns Reverse',
  zoomIn: 'Zoom In',
  zoomOut: 'Zoom Out',
  zoomInFast: 'Zoom In (Fast)',
  zoomOutFast: 'Zoom Out (Fast)',
  panLeft: 'Pan Left',
  panRight: 'Pan Right',
  panUp: 'Pan Up',
  panDown: 'Pan Down',
  dollyIn: 'Dolly In',
  dollyOut: 'Dolly Out',
  orbit: 'Orbit',
  parallax: 'Parallax',
  parallaxReverse: 'Parallax Reverse',
  // Energy
  shake: 'Shake',
  shakeHard: 'Shake (Hard)',
  pulse: 'Beat Pulse',
  pulseFast: 'Beat Pulse (Fast)',
  beatDrop: 'Beat Drop',
  bounce: 'Bounce',
  wiggle: 'Wiggle',
  rotateCW: 'Rotate CW',
  rotateCCW: 'Rotate CCW',
  tilt: 'Tilt',
  sway: 'Sway',
  // Transforms
  flipH: 'Flip Horizontal',
  flipV: 'Flip Vertical',
  mirror: 'Mirror',
  // Color
  fade: 'Fade',
  fadeBlackIn: 'Fade From Black',
  fadeWhiteIn: 'Fade From White',
  flash: 'Flash',
  strobe: 'Strobe',
  vignettePulse: 'Vignette Pulse',
  colorPop: 'Color Pop',
  desaturate: 'Desaturate',
  duotone: 'Duotone',
  sepia: 'Sepia',
  invert: 'Invert',
  hueShift: 'Hue Shift',
  // Glitch
  glitch: 'RGB Glitch',
  glitchHard: 'Hard Glitch',
  rgbSplit: 'RGB Split',
  scanlines: 'Scanlines',
  pixelate: 'Pixelate',
  vhsRoll: 'VHS Roll',
  // Focus
  blurIn: 'Blur In',
  blurOut: 'Blur Out',
  focusPull: 'Focus Pull',
  tiltShift: 'Tilt-Shift'
};

/**
 * Effects grouped by category, used by the picker UI to render section headers
 * and by the AI auto-picker to bias selections by prompt mood.
 */
export const EFFECT_GROUPS: { label: string; effects: EffectId[] }[] = [
  {
    label: 'Camera',
    effects: [
      'kenburns',
      'kenburnsReverse',
      'zoomIn',
      'zoomOut',
      'zoomInFast',
      'zoomOutFast',
      'panLeft',
      'panRight',
      'panUp',
      'panDown',
      'dollyIn',
      'dollyOut',
      'orbit',
      'parallax',
      'parallaxReverse'
    ]
  },
  {
    label: 'Energy',
    effects: [
      'shake',
      'shakeHard',
      'pulse',
      'pulseFast',
      'beatDrop',
      'bounce',
      'wiggle',
      'rotateCW',
      'rotateCCW',
      'tilt',
      'sway'
    ]
  },
  {
    label: 'Transform',
    effects: ['flipH', 'flipV', 'mirror']
  },
  {
    label: 'Color & Light',
    effects: [
      'fade',
      'fadeBlackIn',
      'fadeWhiteIn',
      'flash',
      'strobe',
      'vignettePulse',
      'colorPop',
      'desaturate',
      'duotone',
      'sepia',
      'invert',
      'hueShift'
    ]
  },
  {
    label: 'Glitch & Digital',
    effects: ['glitch', 'glitchHard', 'rgbSplit', 'scanlines', 'pixelate', 'vhsRoll']
  },
  {
    label: 'Focus & Blur',
    effects: ['blurIn', 'blurOut', 'focusPull', 'tiltShift']
  }
];

export const TRANSITION_LABELS: Record<TransitionId, string> = {
  cut: 'Cut',
  fade: 'Fade',
  slide: 'Slide',
  whip: 'Whip Pan',
  zoomBlur: 'Zoom Blur'
};

export const CAPTION_ANIM_LABELS: Record<CaptionAnimationId, string> = {
  auto: 'AI Auto-pick',
  none: 'Static (no animation)',
  pop: 'Pop In',
  wordPop: 'Word Pop',
  typewriter: 'Typewriter',
  slideUp: 'Slide Up',
  fall: 'Fall From Top',
  bounce: 'Bounce',
  wave: 'Wave',
  shake: 'Shake',
  glitch: 'Glitch',
  rainbow: 'Rainbow',
  neon: 'Neon Glow'
};

export const CAPTION_ANIM_GROUPS: { label: string; animations: CaptionAnimationId[] }[] = [
  { label: 'Smart', animations: ['auto'] },
  { label: 'Entrance', animations: ['pop', 'wordPop', 'typewriter', 'slideUp', 'fall', 'bounce'] },
  { label: 'Continuous', animations: ['wave', 'shake', 'glitch', 'rainbow', 'neon'] },
  { label: 'Plain', animations: ['none'] }
];
