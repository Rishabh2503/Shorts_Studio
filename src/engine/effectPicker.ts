// AI auto-effect picker.
//
// Given a prompt and a per-clip seed, return a concrete effect that "fits"
// the prompt's mood. The mapping is keyword-driven so it's deterministic and
// transparent — no model call required, zero cost, instant.
//
// To avoid every clip with the same prompt picking the same effect, each
// clip carries an `effectSeed` and we use it to pseudo-randomly pick from the
// matched category's pool. This means regenerating with the same prompt
// surfaces *different* motion each time, which is what shipping with
// surprise feels like.

import type { EffectId } from '../types';

interface Category {
  /** Lowercased keyword fragments. Match if any are present in the prompt. */
  keywords: string[];
  /** Pool of effects that suit this category. Picker chooses among these. */
  pool: EffectId[];
}

/**
 * Categories are evaluated in order. The first matching category wins. The
 * fallback "default" pool is used when nothing matches — it's a balanced mix
 * of crowd-pleasing motion that looks good on almost any image.
 */
const CATEGORIES: Category[] = [
  // High-energy / action
  {
    keywords: [
      'action',
      'fight',
      'explosion',
      'crash',
      'race',
      'speed',
      'chase',
      'attack',
      'battle',
      'storm',
      'lightning',
      'fire',
      'intense',
      'epic'
    ],
    pool: [
      'shakeHard',
      'shake',
      'beatDrop',
      'zoomInFast',
      'zoomOutFast',
      'flash',
      'strobe',
      'glitchHard',
      'rgbSplit',
      'bounce'
    ]
  },
  // Cyberpunk / sci-fi / tech / futuristic / digital → glitchy aesthetic
  {
    keywords: [
      'cyberpunk',
      'sci-fi',
      'sci fi',
      'futuristic',
      'neon',
      'tech',
      'hologram',
      'cyber',
      'digital',
      'matrix',
      'glitch',
      'vaporwave',
      'synthwave',
      'robot',
      'ai ',
      'space'
    ],
    pool: [
      'glitch',
      'glitchHard',
      'rgbSplit',
      'scanlines',
      'pixelate',
      'vhsRoll',
      'hueShift',
      'invert',
      'colorPop',
      'duotone'
    ]
  },
  // Anime / cartoon / playful
  {
    keywords: [
      'anime',
      'manga',
      'cartoon',
      'kawaii',
      'chibi',
      'cute',
      'playful',
      'fun',
      'happy',
      'cheerful',
      'colorful'
    ],
    pool: [
      'bounce',
      'wiggle',
      'pulse',
      'pulseFast',
      'colorPop',
      'flipH',
      'kenburns',
      'tilt',
      'sway',
      'parallax'
    ]
  },
  // Vintage / retro / film / old / classic
  {
    keywords: [
      'vintage',
      'retro',
      'old',
      '70s',
      '80s',
      '90s',
      'film',
      'classic',
      'antique',
      'memory',
      'nostalgia',
      'polaroid',
      'sepia'
    ],
    pool: ['sepia', 'desaturate', 'vhsRoll', 'scanlines', 'fadeBlackIn', 'vignettePulse', 'duotone', 'kenburns']
  },
  // Romantic / dreamy / soft / portrait / fashion
  {
    keywords: [
      'romantic',
      'dreamy',
      'soft',
      'pastel',
      'beautiful',
      'wedding',
      'love',
      'flower',
      'rose',
      'spring',
      'sunset',
      'sunrise',
      'golden hour',
      'portrait',
      'fashion',
      'editorial',
      'model',
      'face'
    ],
    pool: [
      'kenburns',
      'kenburnsReverse',
      'fade',
      'fadeWhiteIn',
      'blurIn',
      'focusPull',
      'parallax',
      'tiltShift',
      'colorPop',
      'pulse'
    ]
  },
  // Cinematic / movie / film noir / dramatic
  {
    keywords: [
      'cinematic',
      'cinema',
      'movie',
      'film noir',
      'dramatic',
      'noir',
      'thriller',
      'mystery',
      'shadow',
      'atmospheric',
      'moody'
    ],
    pool: [
      'kenburns',
      'dollyIn',
      'dollyOut',
      'parallax',
      'parallaxReverse',
      'fadeBlackIn',
      'vignettePulse',
      'focusPull',
      'tiltShift',
      'orbit'
    ]
  },
  // Travel / landscape / nature / scenic
  {
    keywords: [
      'travel',
      'landscape',
      'nature',
      'mountain',
      'beach',
      'ocean',
      'forest',
      'desert',
      'sky',
      'cloud',
      'aerial',
      'scenic',
      'horizon',
      'lake',
      'river',
      'island'
    ],
    pool: [
      'kenburns',
      'kenburnsReverse',
      'panLeft',
      'panRight',
      'panUp',
      'panDown',
      'parallax',
      'dollyIn',
      'dollyOut',
      'tiltShift',
      'orbit'
    ]
  },
  // Product / studio / minimal
  {
    keywords: [
      'product',
      'studio',
      'minimal',
      'clean',
      'commercial',
      'logo',
      'brand',
      'showcase'
    ],
    pool: ['rotateCW', 'rotateCCW', 'orbit', 'zoomIn', 'zoomOut', 'pulse', 'colorPop', 'mirror', 'flipH']
  },
  // Music / dance / party
  {
    keywords: [
      'music',
      'dance',
      'party',
      'beat',
      'concert',
      'club',
      'rhythm',
      'dj',
      'festival'
    ],
    pool: ['beatDrop', 'pulseFast', 'strobe', 'flash', 'shakeHard', 'bounce', 'rgbSplit', 'colorPop']
  },
  // Spooky / horror / dark
  {
    keywords: [
      'horror',
      'spooky',
      'scary',
      'creepy',
      'dark',
      'ghost',
      'demon',
      'evil',
      'haunted',
      'nightmare',
      'gothic'
    ],
    pool: [
      'shakeHard',
      'glitchHard',
      'flash',
      'strobe',
      'invert',
      'desaturate',
      'fadeBlackIn',
      'vignettePulse',
      'rgbSplit',
      'scanlines'
    ]
  }
];

const DEFAULT_POOL: EffectId[] = [
  'kenburns',
  'kenburnsReverse',
  'zoomIn',
  'zoomOut',
  'panLeft',
  'panRight',
  'panUp',
  'panDown',
  'parallax',
  'dollyIn',
  'pulse',
  'fade',
  'colorPop',
  'tiltShift',
  'orbit',
  'rotateCW'
];

/** xorshift32 → deterministic, fast, good enough for picking. */
function rand(seed: number): number {
  let x = seed | 0 || 1;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return ((x >>> 0) / 0xffffffff);
}

function categoryFor(prompt: string): EffectId[] {
  const p = prompt.toLowerCase();
  for (const c of CATEGORIES) {
    if (c.keywords.some((k) => p.includes(k))) return c.pool;
  }
  return DEFAULT_POOL;
}

/**
 * Pick a concrete effect for the given prompt + seed. Same (prompt, seed)
 * always produces the same result — different seeds give different effects
 * within the matched category, so two clips can have the same prompt but
 * different motion.
 */
export function pickEffectForPrompt(prompt: string, seed = Date.now()): EffectId {
  const pool = categoryFor(prompt ?? '');
  const r = rand(seed);
  const idx = Math.floor(r * pool.length) % pool.length;
  return pool[idx];
}

/** Generate a fresh effect seed for new clips. */
export function newEffectSeed(): number {
  return (Math.random() * 0xffffffff) | 0;
}
