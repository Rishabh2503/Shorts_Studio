// AI-driven caption styling.
//
// Given the user's prompt + a per-clip seed, picks an animation style, font,
// color, accent shadow color, and size multiplier so the same caption text
// looks dramatically different across different clips, but stays *deterministic*
// per (prompt, seed) — re-rolling the seed is what produces a fresh look.
//
// The categories mirror the effect picker: action / cyberpunk / cute / etc.
// We bias both the animation pool AND the visual styling (font + color) so
// captions feel cohesive with the underlying scene.

import type { CaptionAnimationId } from '../types';

export interface CaptionStyleAuto {
  animation: CaptionAnimationId;
  /** Primary fill color */
  color: string;
  /** Stroke / outline color */
  stroke: string;
  /** Glow / shadow color (for neon and rainbow modes) */
  accent: string;
  /** Font family with system fallbacks */
  fontFamily: string;
  fontWeight: number;
  /** Multiplier applied to the project's base font size */
  sizeMul: number;
  /** Letter spacing in px (render-space) */
  tracking: number;
}

interface Category {
  /** Lowercased keywords that trigger this category. */
  keywords: string[];
  animations: CaptionAnimationId[];
  palettes: Array<{ color: string; stroke: string; accent: string }>;
  fonts: Array<{ family: string; weight: number; sizeMul: number; tracking: number }>;
}

// System fonts only — no external loads, so the renderer is offline-clean.
const FONT_IMPACT = {
  family: '"Impact", "Haettenschweiler", "Arial Narrow Bold", sans-serif',
  weight: 900,
  sizeMul: 1.15,
  tracking: 2
};
const FONT_BLACK = {
  family: '"Arial Black", "Helvetica Neue", system-ui, sans-serif',
  weight: 900,
  sizeMul: 1.0,
  tracking: 1
};
const FONT_MONO = {
  family: '"Courier New", "Consolas", monospace',
  weight: 800,
  sizeMul: 0.92,
  tracking: 1
};
const FONT_SERIF = {
  family: '"Georgia", "Times New Roman", serif',
  weight: 800,
  sizeMul: 1.0,
  tracking: 0
};
const FONT_INTER = {
  family: 'Inter, system-ui, sans-serif',
  weight: 800,
  sizeMul: 1.0,
  tracking: 0
};
const FONT_COMIC = {
  family: '"Comic Sans MS", "Chalkboard SE", system-ui, sans-serif',
  weight: 800,
  sizeMul: 1.05,
  tracking: 1
};

const CATEGORIES: Category[] = [
  {
    keywords: [
      'action', 'fight', 'battle', 'epic', 'explosion', 'chase', 'sport',
      'gym', 'workout', 'fast', 'speed', 'rage', 'fire', 'punch'
    ],
    animations: ['shake', 'glitch', 'pop', 'bounce', 'fall'],
    palettes: [
      { color: '#fff200', stroke: '#000000', accent: '#ff3b00' }, // hi-vis yellow
      { color: '#ffffff', stroke: '#b91c1c', accent: '#ff1744' },
      { color: '#ff3b00', stroke: '#000000', accent: '#fff200' }
    ],
    fonts: [FONT_IMPACT, FONT_BLACK]
  },
  {
    keywords: [
      'cyberpunk', 'cyber', 'neon', 'tech', 'futuristic', 'sci-fi', 'scifi',
      'space', 'galaxy', 'hologram', 'matrix', 'robot', 'cyborg'
    ],
    animations: ['glitch', 'rainbow', 'neon', 'typewriter', 'wave'],
    palettes: [
      { color: '#22d3ee', stroke: '#0b0b18', accent: '#ff3ea5' },
      { color: '#ff3ea5', stroke: '#0b0b18', accent: '#22d3ee' },
      { color: '#a78bfa', stroke: '#000000', accent: '#22d3ee' }
    ],
    fonts: [FONT_MONO, FONT_BLACK]
  },
  {
    keywords: [
      'anime', 'kawaii', 'cute', 'pastel', 'soft', 'dreamy', 'pink',
      'sticker', 'plush', 'cartoon'
    ],
    animations: ['bounce', 'wordPop', 'wave', 'pop'],
    palettes: [
      { color: '#ffffff', stroke: '#ec4899', accent: '#ec4899' },
      { color: '#fde68a', stroke: '#7c3aed', accent: '#ec4899' },
      { color: '#ec4899', stroke: '#ffffff', accent: '#a78bfa' }
    ],
    fonts: [FONT_COMIC, FONT_BLACK]
  },
  {
    keywords: [
      'vintage', 'retro', '70s', '80s', '90s', 'film', 'analog', 'grainy',
      'classic', 'old', 'sepia', 'vinyl'
    ],
    animations: ['typewriter', 'fall', 'pop'],
    palettes: [
      { color: '#fde68a', stroke: '#3f1d00', accent: '#b45309' },
      { color: '#fef3c7', stroke: '#7c2d12', accent: '#dc2626' }
    ],
    fonts: [FONT_SERIF, FONT_MONO]
  },
  {
    keywords: [
      'romantic', 'love', 'heart', 'sunset', 'cozy', 'wedding', 'rose',
      'flower', 'beautiful'
    ],
    animations: ['wordPop', 'wave', 'pop', 'typewriter'],
    palettes: [
      { color: '#ffffff', stroke: '#9d174d', accent: '#ec4899' },
      { color: '#fbcfe8', stroke: '#9d174d', accent: '#ffffff' }
    ],
    fonts: [FONT_SERIF, FONT_INTER]
  },
  {
    keywords: [
      'horror', 'scary', 'dark', 'gothic', 'creepy', 'haunted', 'blood',
      'ghost', 'monster', 'demon', 'nightmare'
    ],
    animations: ['shake', 'glitch', 'fall', 'typewriter'],
    palettes: [
      { color: '#dc2626', stroke: '#000000', accent: '#7f1d1d' },
      { color: '#ffffff', stroke: '#7f1d1d', accent: '#dc2626' },
      { color: '#a3a3a3', stroke: '#000000', accent: '#dc2626' }
    ],
    fonts: [FONT_SERIF, FONT_IMPACT]
  },
  {
    keywords: [
      'travel', 'beach', 'mountain', 'forest', 'nature', 'landscape',
      'ocean', 'sky', 'cloud', 'sunrise'
    ],
    animations: ['slideUp', 'wave', 'wordPop', 'pop'],
    palettes: [
      { color: '#ffffff', stroke: '#0c4a6e', accent: '#22d3ee' },
      { color: '#fef3c7', stroke: '#0c4a6e', accent: '#f59e0b' }
    ],
    fonts: [FONT_INTER, FONT_BLACK]
  },
  {
    keywords: [
      'product', 'studio', 'minimal', 'clean', 'luxury', 'fashion', 'editorial',
      'magazine', 'modern'
    ],
    animations: ['typewriter', 'slideUp', 'pop'],
    palettes: [
      { color: '#ffffff', stroke: '#000000', accent: '#a78bfa' },
      { color: '#000000', stroke: '#ffffff', accent: '#22d3ee' }
    ],
    fonts: [FONT_INTER, FONT_BLACK]
  },
  {
    keywords: [
      'music', 'dance', 'concert', 'club', 'party', 'beat', 'dj', 'rave'
    ],
    animations: ['shake', 'bounce', 'rainbow', 'glitch', 'pop'],
    palettes: [
      { color: '#fff200', stroke: '#7c3aed', accent: '#ff3ea5' },
      { color: '#ffffff', stroke: '#000000', accent: '#22d3ee' },
      { color: '#ff3ea5', stroke: '#000000', accent: '#fff200' }
    ],
    fonts: [FONT_IMPACT, FONT_BLACK]
  }
];

const DEFAULT_CATEGORY: Category = {
  keywords: [],
  animations: ['pop', 'wordPop', 'slideUp', 'typewriter', 'bounce'],
  palettes: [
    { color: '#ffffff', stroke: '#000000', accent: '#22d3ee' },
    { color: '#fff200', stroke: '#000000', accent: '#ff3ea5' },
    { color: '#22d3ee', stroke: '#0b0b18', accent: '#ff3ea5' }
  ],
  fonts: [FONT_INTER, FONT_BLACK, FONT_IMPACT]
};

// xorshift32 — same fast deterministic RNG used by the effect picker.
function rand(seed: number): () => number {
  let s = (seed | 0) || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}

function pickCategory(prompt: string): Category {
  const lower = prompt.toLowerCase();
  for (const cat of CATEGORIES) {
    if (cat.keywords.some((k) => lower.includes(k))) return cat;
  }
  return DEFAULT_CATEGORY;
}

/**
 * Pick a complete caption visual style from the prompt + seed. Re-rolling the
 * seed (e.g. via the dice button) yields a different animation/palette/font
 * combo within the same prompt category.
 */
export function pickCaptionStyle(prompt: string, seed: number): CaptionStyleAuto {
  const cat = pickCategory(prompt);
  const r = rand(seed || 1);
  const animation = cat.animations[Math.floor(r() * cat.animations.length)];
  const palette = cat.palettes[Math.floor(r() * cat.palettes.length)];
  const font = cat.fonts[Math.floor(r() * cat.fonts.length)];
  return {
    animation,
    color: palette.color,
    stroke: palette.stroke,
    accent: palette.accent,
    fontFamily: font.family,
    fontWeight: font.weight,
    sizeMul: font.sizeMul,
    tracking: font.tracking
  };
}

export function newCaptionSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff) || 1;
}
