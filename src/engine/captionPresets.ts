// Caption visual presets — saved style packs the user can pick from a
// dropdown. Each preset overrides what the AI auto-style picker would
// otherwise produce, so creators can lock a consistent "look" across all
// their videos without fighting the AI.
//
// The shape mirrors `CaptionStyleAuto` in `render.ts` (we duplicate a few
// fields here so this module has zero runtime imports — it's safe to ship
// the preset list to the UI and the engine alike).

import type { CaptionAnimationId } from '../types';

export interface CaptionPreset {
  /** Stable key stored on the project. */
  id: string;
  /** Human-readable label shown in the dropdown. */
  label: string;
  /** Short description used as the dropdown subtitle. */
  description: string;
  /** Visual style overrides applied on top of the base captionStyle. */
  style: {
    fontFamily: string;
    fontWeight: number;
    fillColor: string;
    strokeColor: string;
    /** Multiplier applied to base.size (1.0 = unchanged). */
    sizeMul: number;
    /** Stroke width in px (render space). */
    strokeWidth: number;
    /** Glow color used in karaoke highlight (CSS color string). */
    glow: string;
    /** Optional background pill behind text. null = no pill. */
    pill: string | null;
    /** Optional fixed animation, otherwise 'auto' lets the AI pick. */
    animation: CaptionAnimationId;
    /** Letter-spacing override in px. */
    letterSpacing?: number;
    /** Force ALL CAPS for this preset. */
    uppercase?: boolean;
  };
}

// ---------------------------------------------------------------------------
// Preset library. Order is the order shown in the UI.
// ---------------------------------------------------------------------------
export const CAPTION_PRESETS: CaptionPreset[] = [
  {
    id: 'auto',
    label: 'AI Auto-style',
    description: 'Let the AI pick a font + color from the script mood.',
    style: {
      fontFamily: 'Inter, system-ui, sans-serif',
      fontWeight: 800,
      fillColor: '#ffffff',
      strokeColor: '#000000',
      sizeMul: 1.0,
      strokeWidth: 8,
      glow: '#22d3ee',
      pill: null,
      animation: 'auto'
    }
  },
  {
    id: 'mrbeast',
    label: 'MrBeast',
    description: 'Bright yellow + thick black stroke. Pop animation.',
    style: {
      fontFamily: '"Komika Axis","Bangers","Inter",system-ui,sans-serif',
      fontWeight: 900,
      fillColor: '#ffd400',
      strokeColor: '#000000',
      sizeMul: 1.15,
      strokeWidth: 14,
      glow: '#ffd400',
      pill: null,
      animation: 'wordPop',
      uppercase: true,
      letterSpacing: 2
    }
  },
  {
    id: 'hormozi',
    label: 'Hormozi',
    description: 'White text, heavy black stroke, no animation noise.',
    style: {
      fontFamily: '"Inter","Helvetica Neue",system-ui,sans-serif',
      fontWeight: 900,
      fillColor: '#ffffff',
      strokeColor: '#000000',
      sizeMul: 1.05,
      strokeWidth: 12,
      glow: '#ffffff',
      pill: null,
      animation: 'pop',
      uppercase: true,
      letterSpacing: 1
    }
  },
  {
    id: 'aliabdaal',
    label: 'Ali Abdaal',
    description: 'Soft white sans, subtle entrance. Calm, premium.',
    style: {
      fontFamily: '"Inter","SF Pro Text",system-ui,sans-serif',
      fontWeight: 700,
      fillColor: '#ffffff',
      strokeColor: '#0f172a',
      sizeMul: 0.95,
      strokeWidth: 4,
      glow: '#a5b4fc',
      pill: null,
      animation: 'slideUp'
    }
  },
  {
    id: 'tiktok',
    label: 'TikTok Live',
    description: 'White on translucent pill. Karaoke-ready.',
    style: {
      fontFamily: '"Inter","Segoe UI",system-ui,sans-serif',
      fontWeight: 800,
      fillColor: '#ffffff',
      strokeColor: '#000000',
      sizeMul: 1.0,
      strokeWidth: 0,
      glow: '#22d3ee',
      pill: 'rgba(0,0,0,0.55)',
      animation: 'pop'
    }
  },
  {
    id: 'neon',
    label: 'Neon Glow',
    description: 'Cyan neon, no stroke, soft glow. Synthwave vibes.',
    style: {
      fontFamily: '"Audiowide","Inter",system-ui,sans-serif',
      fontWeight: 700,
      fillColor: '#a5f3fc',
      strokeColor: '#0e7490',
      sizeMul: 1.0,
      strokeWidth: 2,
      glow: '#22d3ee',
      pill: null,
      animation: 'neon'
    }
  },
  {
    id: 'comic',
    label: 'Comic Pop',
    description: 'Bouncy comic-book vibe with magenta accents.',
    style: {
      fontFamily: '"Bangers","Komika Axis","Inter",system-ui,sans-serif',
      fontWeight: 800,
      fillColor: '#ffffff',
      strokeColor: '#1f1147',
      sizeMul: 1.1,
      strokeWidth: 10,
      glow: '#f472b6',
      pill: null,
      animation: 'bounce',
      letterSpacing: 1
    }
  },
  {
    id: 'cinema',
    label: 'Cinema',
    description: 'Letterboxed serif. Slow, dramatic reveals.',
    style: {
      fontFamily: '"Playfair Display","Times New Roman",serif',
      fontWeight: 700,
      fillColor: '#fef3c7',
      strokeColor: '#000000',
      sizeMul: 0.9,
      strokeWidth: 3,
      glow: '#fbbf24',
      pill: null,
      animation: 'fall'
    }
  }
];

export function getPreset(id: string | undefined | null): CaptionPreset | null {
  if (!id) return null;
  return CAPTION_PRESETS.find((p) => p.id === id) ?? null;
}
