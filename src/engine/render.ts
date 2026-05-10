// Pure rendering engine: draws a single frame for the project at time `t` (seconds)
// onto a target 2D canvas. Used both for live preview and for export recording.

import type {
  CaptionAnimationId,
  EffectId,
  ImageClip,
  ProjectScript,
  ProjectState,
  TransitionId
} from '../types';
import { pickEffectForPrompt } from './effectPicker';
import { pickCaptionStyle, type CaptionStyleAuto } from './captionAi';
import { distributeRevealTimes } from './audioAnalyzer';
import { loadImageCached } from './imageCache';
import { getPreset } from './captionPresets';
import { filterFillerWords } from './captionText';

export interface LoadedClip extends ImageClip {
  image: HTMLImageElement;
}

export async function loadImage(src: string): Promise<HTMLImageElement> {
  return loadImageCached(src);
}

export async function preloadClips(clips: ImageClip[]): Promise<LoadedClip[]> {
  // Load in parallel; skip broken sources so one bad image doesn't kill preview.
  const results = await Promise.allSettled(
    clips.map(async (c) => ({ ...c, image: await loadImageCached(c.src) }))
  );
  const out: LoadedClip[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') out.push(r.value);
  }
  return out;
}

/** Total project duration in seconds. */
export function totalDuration(clips: ImageClip[]): number {
  return clips.reduce((s, c) => s + c.duration, 0);
}

/** Easing helpers */
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * Resolve an effect id, expanding 'auto' to a concrete effect chosen by the
 * AI auto-picker. The seed comes from the clip so it stays stable across
 * frames but varies between clips.
 */
function resolveEffect(clip: ImageClip): EffectId {
  if (clip.effect !== 'auto') return clip.effect;
  return pickEffectForPrompt(clip.prompt ?? clip.caption ?? '', clip.effectSeed ?? 1);
}

/** Public version of {@link resolveEffect} for UI display. */
export function getResolvedEffect(clip: ImageClip): EffectId {
  return resolveEffect(clip);
}

/** Extended draw-time transform covering all 45+ effects. */
interface DrawTransform {
  // Geometry
  scale: number;
  tx: number; // -1..1 normalized of canvas width
  ty: number;
  rotate: number; // radians
  flipX: 1 | -1;
  flipY: 1 | -1;
  // Compositing
  alpha: number;
  // CSS-filter pipeline
  blur: number; // px
  hueRotate: number; // deg
  saturate: number; // 1 = neutral
  brightness: number; // 1 = neutral
  contrast: number; // 1 = neutral
  sepia: number; // 0..1
  grayscale: number; // 0..1
  invert: number; // 0..1
  // Specials
  rgbSplit: number; // px
  pixelSize: number; // 0 = off
  scanlines: number; // 0..1 strength
  vignette: number; // 0..1 strength
  vhsRoll: number; // px y-shift on banded rows
  mirror: boolean; // mirror right half
  /** RGBA color overlay drawn on top after the image. */
  overlay?: { r: number; g: number; b: number; a: number };
  /** Optional duotone color. When set, applies a color-mapped tint. */
  duotone?: { dark: string; light: string; strength: number };
}

function identity(): DrawTransform {
  return {
    scale: 1,
    tx: 0,
    ty: 0,
    rotate: 0,
    flipX: 1,
    flipY: 1,
    alpha: 1,
    blur: 0,
    hueRotate: 0,
    saturate: 1,
    brightness: 1,
    contrast: 1,
    sepia: 0,
    grayscale: 0,
    invert: 0,
    rgbSplit: 0,
    pixelSize: 0,
    scanlines: 0,
    vignette: 0,
    vhsRoll: 0,
    mirror: false
  };
}

/** Tiny PRNG for deterministic-but-varied per-frame jitter. */
function rng(seed: number): number {
  let x = (seed * 9301 + 49297) % 233280;
  return x / 233280;
}

function applyEffect(effect: EffectId, p: number): DrawTransform {
  const tr = identity();
  switch (effect) {
    case 'auto':
      // Should be resolved before this is called, but treat as kenburns.
      return applyEffect('kenburns', p);

    // ─── Camera ──────────────────────────────────────────────────────
    case 'kenburns': {
      const e = easeInOut(p);
      tr.scale = 1.05 + 0.15 * e;
      tr.tx = -0.05 + 0.1 * e;
      tr.ty = 0.04 - 0.08 * e;
      break;
    }
    case 'kenburnsReverse': {
      const e = easeInOut(p);
      tr.scale = 1.2 - 0.15 * e;
      tr.tx = 0.05 - 0.1 * e;
      tr.ty = -0.04 + 0.08 * e;
      break;
    }
    case 'zoomIn':
      tr.scale = 1.0 + 0.25 * easeOut(p);
      break;
    case 'zoomOut':
      tr.scale = 1.25 - 0.25 * easeOut(p);
      break;
    case 'zoomInFast':
      tr.scale = 1.0 + 0.5 * easeOut(Math.min(1, p * 2));
      break;
    case 'zoomOutFast':
      tr.scale = 1.5 - 0.5 * easeOut(Math.min(1, p * 2));
      break;
    case 'panLeft':
      tr.scale = 1.15;
      tr.tx = 0.1 - 0.2 * easeInOut(p);
      break;
    case 'panRight':
      tr.scale = 1.15;
      tr.tx = -0.1 + 0.2 * easeInOut(p);
      break;
    case 'panUp':
      tr.scale = 1.15;
      tr.ty = 0.1 - 0.2 * easeInOut(p);
      break;
    case 'panDown':
      tr.scale = 1.15;
      tr.ty = -0.1 + 0.2 * easeInOut(p);
      break;
    case 'dollyIn': {
      const e = easeInOut(p);
      tr.scale = 1.0 + 0.4 * e;
      tr.blur = (1 - e) * 4;
      break;
    }
    case 'dollyOut': {
      const e = easeInOut(p);
      tr.scale = 1.4 - 0.4 * e;
      tr.blur = e * 4;
      break;
    }
    case 'orbit': {
      tr.scale = 1.18;
      tr.rotate = Math.sin(p * Math.PI) * 0.06;
      tr.tx = Math.sin(p * Math.PI * 2) * 0.04;
      tr.ty = Math.cos(p * Math.PI * 2) * 0.03;
      break;
    }
    case 'parallax': {
      const e = easeInOut(p);
      tr.scale = 1.2;
      tr.tx = -0.08 + 0.16 * e;
      tr.ty = 0.04 * Math.sin(p * Math.PI * 2);
      break;
    }
    case 'parallaxReverse': {
      const e = easeInOut(p);
      tr.scale = 1.2;
      tr.tx = 0.08 - 0.16 * e;
      tr.ty = -0.04 * Math.sin(p * Math.PI * 2);
      break;
    }

    // ─── Energy / impact ──────────────────────────────────────────────
    case 'shake':
      tr.scale = 1.1;
      tr.tx = Math.sin(p * 60) * 0.008;
      tr.ty = Math.cos(p * 70) * 0.008;
      tr.rotate = Math.sin(p * 40) * 0.01;
      break;
    case 'shakeHard':
      tr.scale = 1.15;
      tr.tx = Math.sin(p * 120) * 0.02 + (rng(p * 1000) - 0.5) * 0.01;
      tr.ty = Math.cos(p * 130) * 0.02 + (rng(p * 1100) - 0.5) * 0.01;
      tr.rotate = Math.sin(p * 100) * 0.03;
      break;
    case 'pulse': {
      const beat = 0.5 + 0.5 * Math.sin(p * Math.PI * 8);
      tr.scale = 1.05 + 0.06 * beat;
      break;
    }
    case 'pulseFast': {
      const beat = 0.5 + 0.5 * Math.sin(p * Math.PI * 16);
      tr.scale = 1.05 + 0.08 * beat;
      tr.brightness = 1 + 0.15 * beat;
      break;
    }
    case 'beatDrop': {
      // Big punch at start, settles to gentle pulse.
      const punch = Math.exp(-p * 6);
      const beat = 0.5 + 0.5 * Math.sin(p * Math.PI * 10);
      tr.scale = 1.05 + 0.2 * punch + 0.05 * beat;
      tr.brightness = 1 + 0.25 * punch;
      tr.rgbSplit = 12 * punch;
      break;
    }
    case 'bounce': {
      const b = Math.abs(Math.sin(p * Math.PI * 4));
      tr.scale = 1.08;
      tr.ty = -0.04 * b;
      break;
    }
    case 'wiggle':
      tr.scale = 1.08;
      tr.rotate = Math.sin(p * Math.PI * 8) * 0.04;
      break;
    case 'rotateCW':
      tr.scale = 1.2;
      tr.rotate = p * Math.PI * 0.25;
      break;
    case 'rotateCCW':
      tr.scale = 1.2;
      tr.rotate = -p * Math.PI * 0.25;
      break;
    case 'tilt':
      tr.scale = 1.1;
      tr.rotate = (p < 0.5 ? p / 0.5 : (1 - p) / 0.5) * 0.06;
      break;
    case 'sway':
      tr.scale = 1.1;
      tr.rotate = Math.sin(p * Math.PI * 2) * 0.03;
      tr.tx = Math.sin(p * Math.PI * 2) * 0.02;
      break;

    // ─── Transforms ───────────────────────────────────────────────────
    case 'flipH':
      tr.scale = 1.05;
      // Briefly flip with a fade through 0 around the midpoint.
      if (p > 0.5) tr.flipX = -1;
      tr.alpha = 1 - Math.pow(Math.abs(p - 0.5) * 2 - 1, 2) * 0;
      break;
    case 'flipV':
      tr.scale = 1.05;
      if (p > 0.5) tr.flipY = -1;
      break;
    case 'mirror':
      tr.scale = 1.05;
      tr.mirror = true;
      break;

    // ─── Color & light ────────────────────────────────────────────────
    case 'fade':
      tr.scale = 1.05;
      tr.alpha = Math.min(1, p < 0.15 ? p / 0.15 : p > 0.85 ? (1 - p) / 0.15 : 1);
      break;
    case 'fadeBlackIn': {
      const a = p < 0.25 ? p / 0.25 : 1;
      tr.scale = 1.08;
      tr.brightness = a;
      break;
    }
    case 'fadeWhiteIn': {
      const a = p < 0.25 ? 1 - p / 0.25 : 0;
      tr.scale = 1.08;
      tr.overlay = { r: 255, g: 255, b: 255, a };
      break;
    }
    case 'flash': {
      const flashAt = [0.05, 0.45, 0.9];
      let a = 0;
      for (const f of flashAt) a = Math.max(a, Math.exp(-Math.abs(p - f) * 80));
      tr.scale = 1.08;
      tr.brightness = 1 + a * 0.6;
      tr.overlay = { r: 255, g: 255, b: 255, a: a * 0.45 };
      break;
    }
    case 'strobe': {
      tr.scale = 1.1;
      const onOff = Math.floor(p * 18) % 2;
      tr.brightness = onOff ? 1.3 : 0.7;
      break;
    }
    case 'vignettePulse': {
      const beat = 0.5 + 0.5 * Math.sin(p * Math.PI * 4);
      tr.scale = 1.06;
      tr.vignette = 0.4 + 0.3 * beat;
      break;
    }
    case 'colorPop': {
      const beat = 0.5 + 0.5 * Math.sin(p * Math.PI * 4);
      tr.scale = 1.08;
      tr.saturate = 1.2 + 0.6 * beat;
      tr.contrast = 1.05 + 0.1 * beat;
      break;
    }
    case 'desaturate':
      tr.scale = 1.06;
      tr.saturate = 1 - 0.85 * easeInOut(p);
      tr.contrast = 1.05;
      break;
    case 'duotone':
      tr.scale = 1.06;
      tr.duotone = { dark: '#1a0033', light: '#ff3ea5', strength: 0.7 };
      tr.contrast = 1.1;
      break;
    case 'sepia':
      tr.scale = 1.06;
      tr.sepia = 0.8;
      tr.contrast = 1.05;
      break;
    case 'invert':
      tr.scale = 1.06;
      tr.invert = 1;
      break;
    case 'hueShift':
      tr.scale = 1.08;
      tr.hueRotate = p * 360;
      tr.saturate = 1.3;
      break;

    // ─── Glitch / digital ─────────────────────────────────────────────
    case 'glitch': {
      const phase = Math.floor(p * 30);
      tr.scale = 1.08;
      tr.tx = Math.sin(phase) * 0.005;
      tr.rgbSplit = (phase % 5 === 0 ? 14 : 4) * (1 - Math.abs(0.5 - p));
      break;
    }
    case 'glitchHard': {
      const phase = Math.floor(p * 60);
      tr.scale = 1.1;
      tr.tx = (rng(phase) - 0.5) * 0.05;
      tr.ty = (rng(phase + 7) - 0.5) * 0.02;
      tr.rgbSplit = 18 + (rng(phase + 13) - 0.5) * 20;
      tr.vhsRoll = (rng(phase + 19) - 0.5) * 30;
      break;
    }
    case 'rgbSplit': {
      tr.scale = 1.08;
      tr.rgbSplit = 8 + Math.sin(p * Math.PI * 4) * 8;
      break;
    }
    case 'scanlines':
      tr.scale = 1.06;
      tr.scanlines = 0.55;
      tr.brightness = 1.05;
      break;
    case 'pixelate': {
      const e = easeInOut(p);
      tr.scale = 1.05;
      tr.pixelSize = Math.max(1, 32 * (1 - e)); // un-pixelate over time
      break;
    }
    case 'vhsRoll':
      tr.scale = 1.08;
      tr.vhsRoll = Math.sin(p * Math.PI * 6) * 12;
      tr.rgbSplit = 4;
      tr.scanlines = 0.25;
      tr.saturate = 0.85;
      break;

    // ─── Focus / blur ─────────────────────────────────────────────────
    case 'blurIn':
      tr.scale = 1.05 + 0.05 * (1 - p);
      tr.blur = Math.max(0, 18 - p * 30);
      break;
    case 'blurOut':
      tr.scale = 1.05 + 0.05 * p;
      tr.blur = p * 18;
      break;
    case 'focusPull': {
      // Blur high → 0 → high, sharp at midpoint.
      tr.scale = 1.08;
      tr.blur = Math.abs(p - 0.5) * 24;
      break;
    }
    case 'tiltShift':
      tr.scale = 1.08;
      tr.vignette = 0.3;
      tr.saturate = 1.25;
      tr.contrast = 1.05;
      // Simulated band blur: not full per-row blur (too expensive each frame),
      // but a soft global blur breathing.
      tr.blur = 1.5 + Math.sin(p * Math.PI) * 0.5;
      break;
  }
  return tr;
}

/** Build a CSS filter string from the transform's filter fields. */
function buildFilterString(t: DrawTransform): string {
  const parts: string[] = [];
  if (t.blur > 0) parts.push(`blur(${t.blur}px)`);
  if (t.hueRotate) parts.push(`hue-rotate(${t.hueRotate}deg)`);
  if (t.saturate !== 1) parts.push(`saturate(${t.saturate})`);
  if (t.brightness !== 1) parts.push(`brightness(${t.brightness})`);
  if (t.contrast !== 1) parts.push(`contrast(${t.contrast})`);
  if (t.sepia > 0) parts.push(`sepia(${t.sepia})`);
  if (t.grayscale > 0) parts.push(`grayscale(${t.grayscale})`);
  if (t.invert > 0) parts.push(`invert(${t.invert})`);
  return parts.length ? parts.join(' ') : 'none';
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  W: number,
  H: number,
  t: DrawTransform
) {
  const ar = img.width / img.height;
  const canvasAr = W / H;
  let dw: number, dh: number;
  if (ar > canvasAr) {
    dh = H * t.scale;
    dw = dh * ar;
  } else {
    dw = W * t.scale;
    dh = dw / ar;
  }
  const dx = (W - dw) / 2 + t.tx * W;
  const dy = (H - dh) / 2 + t.ty * H;

  ctx.save();
  ctx.globalAlpha = t.alpha;
  ctx.filter = buildFilterString(t);

  // Geometric transforms around the canvas center.
  if (t.rotate || t.flipX !== 1 || t.flipY !== 1) {
    ctx.translate(W / 2, H / 2);
    if (t.rotate) ctx.rotate(t.rotate);
    if (t.flipX !== 1 || t.flipY !== 1) ctx.scale(t.flipX, t.flipY);
    ctx.translate(-W / 2, -H / 2);
  }

  // Pixelate path: render to small offscreen, then upscale with smoothing off.
  if (t.pixelSize > 1) {
    const ps = Math.max(2, Math.floor(t.pixelSize));
    const sw = Math.max(2, Math.floor(W / ps));
    const sh = Math.max(2, Math.floor(H / ps));
    const off = document.createElement('canvas');
    off.width = sw;
    off.height = sh;
    const oc = off.getContext('2d');
    if (oc) {
      oc.imageSmoothingEnabled = true;
      oc.drawImage(img, (dx * sw) / W, (dy * sh) / H, (dw * sw) / W, (dh * sh) / H);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(off, 0, 0, W, H);
      ctx.imageSmoothingEnabled = true;
    } else {
      ctx.drawImage(img, dx, dy, dw, dh);
    }
  } else if (t.rgbSplit > 0) {
    const o = t.rgbSplit;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = t.alpha * 0.85;
    // Simple approximation: 3 offset draws with color tints via filter.
    ctx.save();
    ctx.filter = `${buildFilterString(t)} drop-shadow(0 0 0 #f0f)`;
    ctx.drawImage(img, dx - o, dy, dw, dh);
    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.drawImage(img, dx + o, dy, dw, dh);
    ctx.restore();
  } else if (t.vhsRoll !== 0) {
    // Split into two horizontal bands and offset them.
    const half = H / 2;
    ctx.drawImage(img, 0, 0, img.width, img.height / 2, dx, dy + t.vhsRoll, dw, dh / 2);
    ctx.drawImage(
      img,
      0,
      img.height / 2,
      img.width,
      img.height / 2,
      dx,
      dy + half - t.vhsRoll,
      dw,
      dh / 2
    );
  } else if (t.mirror) {
    // Draw left half normally, then mirror it onto the right.
    ctx.save();
    // left
    ctx.beginPath();
    ctx.rect(0, 0, W / 2, H);
    ctx.clip();
    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.restore();
    ctx.save();
    // right (mirror of left)
    ctx.translate(W, 0);
    ctx.scale(-1, 1);
    ctx.beginPath();
    ctx.rect(0, 0, W / 2, H);
    ctx.clip();
    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.restore();
  } else {
    ctx.drawImage(img, dx, dy, dw, dh);
  }

  // Reset filter before drawing overlays.
  ctx.filter = 'none';
  ctx.globalCompositeOperation = 'source-over';

  // Duotone overlay: composite a vertical gradient with multiply.
  if (t.duotone) {
    ctx.save();
    ctx.globalAlpha = t.duotone.strength;
    ctx.globalCompositeOperation = 'multiply';
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, t.duotone.light);
    g.addColorStop(1, t.duotone.dark);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  // Scanline overlay.
  if (t.scanlines > 0) {
    ctx.save();
    ctx.globalAlpha = Math.min(0.7, t.scanlines);
    ctx.fillStyle = '#000';
    const step = 4;
    for (let y = 0; y < H; y += step) {
      ctx.fillRect(0, y, W, Math.max(1, step / 2));
    }
    ctx.restore();
  }

  // Vignette.
  if (t.vignette > 0) {
    const grad = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.7);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, `rgba(0,0,0,${Math.min(1, t.vignette)})`);
    ctx.save();
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  // Color overlay (flash, fadeWhite, etc.).
  if (t.overlay && t.overlay.a > 0.001) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, t.overlay.a);
    ctx.fillStyle = `rgb(${t.overlay.r},${t.overlay.g},${t.overlay.b})`;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  ctx.restore();
}

function applyTransition(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  trans: TransitionId,
  /** 0..1 within the transition window */
  p: number,
  draw: () => void,
  drawNext?: () => void
) {
  switch (trans) {
    case 'cut':
      draw();
      break;
    case 'fade': {
      ctx.save();
      ctx.globalAlpha = 1 - p;
      draw();
      ctx.restore();
      if (drawNext) {
        ctx.save();
        ctx.globalAlpha = p;
        drawNext();
        ctx.restore();
      }
      break;
    }
    case 'slide': {
      ctx.save();
      ctx.translate(-W * p, 0);
      draw();
      ctx.restore();
      if (drawNext) {
        ctx.save();
        ctx.translate(W * (1 - p), 0);
        drawNext();
        ctx.restore();
      }
      break;
    }
    case 'whip': {
      const blur = 30 * Math.sin(p * Math.PI);
      ctx.save();
      ctx.filter = `blur(${blur}px)`;
      ctx.translate(-W * p * 1.2, 0);
      draw();
      ctx.restore();
      if (drawNext) {
        ctx.save();
        ctx.filter = `blur(${blur}px)`;
        ctx.translate(W * (1 - p) * 1.2, 0);
        drawNext();
        ctx.restore();
      }
      break;
    }
    case 'zoomBlur': {
      const blur = 24 * Math.sin(p * Math.PI);
      const s = 1 + 0.3 * p;
      ctx.save();
      ctx.filter = `blur(${blur}px)`;
      ctx.translate(W / 2, H / 2);
      ctx.scale(s, s);
      ctx.translate(-W / 2, -H / 2);
      ctx.globalAlpha = 1 - p;
      draw();
      ctx.restore();
      if (drawNext) {
        ctx.save();
        ctx.filter = `blur(${blur}px)`;
        ctx.translate(W / 2, H / 2);
        const s2 = 1.3 - 0.3 * p;
        ctx.scale(s2, s2);
        ctx.translate(-W / 2, -H / 2);
        ctx.globalAlpha = p;
        drawNext();
        ctx.restore();
      }
      break;
    }
  }
}

function drawCaption(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  text: string,
  style: ProjectState['captionStyle'],
  /** clip progress 0..1 used for entry pop */
  p: number
) {
  if (!text) return;
  const pop = p < 0.2 ? p / 0.2 : 1;
  const y = H * 0.82;
  ctx.save();
  ctx.translate(W / 2, y);
  ctx.scale(pop, pop);
  ctx.font = `${style.weight} ${style.size}px ${style.fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = Math.max(6, style.size / 10);
  ctx.strokeStyle = style.stroke;
  ctx.fillStyle = style.color;
  // Wrap manually
  const maxWidth = W * 0.85;
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  const lh = style.size * 1.15;
  const total = lines.length * lh;
  lines.forEach((l, i) => {
    const yy = -total / 2 + i * lh + lh / 2;
    ctx.strokeText(l, 0, yy);
    ctx.fillText(l, 0, yy);
  });
  ctx.restore();
}

// =====================================================================
//  Animated captions
// =====================================================================
//
// Word-by-word reveal with per-animation entrance behaviour. Designed for
// readability first (always padded inside the frame, big stroke for contrast)
// and eye-catching motion second. The AI picker supplies font/color/animation
// from the prompt; the renderer here implements the actual motion.

interface WrappedLine {
  /** Word tokens for this line (empty string entries are spaces). */
  words: string[];
  /** Pre-measured x positions for each word (relative to line center, before tracking applied per-char). */
  width: number;
}

/**
 * Greedy line-wrap that returns word arrays per line. We keep the words intact
 * so animations can target individual words.
 */
function wrapWords(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): WrappedLine[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: WrappedLine[] = [];
  let cur: string[] = [];
  let curWidth = 0;
  for (const w of words) {
    const candidate = cur.length ? cur.concat(w) : [w];
    const candidateWidth = ctx.measureText(candidate.join(' ')).width;
    if (cur.length && candidateWidth > maxWidth) {
      lines.push({ words: cur, width: curWidth });
      cur = [w];
      curWidth = ctx.measureText(w).width;
    } else {
      cur = candidate;
      curWidth = candidateWidth;
    }
  }
  if (cur.length) lines.push({ words: cur, width: curWidth });
  return lines;
}

/** Smooth ease-out for entrance animations. */
function easeOutCaption(t: number): number {
  return 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3);
}
/** Springy overshoot ease used by 'bounce' / 'pop'. */
function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const x = Math.max(0, Math.min(1, t));
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

function resolveCaptionStyle(
  clip: ImageClip,
  base: ProjectState['captionStyle']
): CaptionStyleAuto {
  const animKey = clip.captionAnim ?? 'auto';
  const seed = clip.captionStyleSeed ?? 1;
  const promptForPick = clip.prompt ?? clip.caption ?? '';
  const aiPick = pickCaptionStyle(promptForPick, seed);
  // If user explicitly chose an animation, honour it but keep AI font/color.
  if (animKey !== 'auto') {
    return { ...aiPick, animation: animKey };
  }
  // Pure auto — use AI choice as-is.
  // Apply project's base size as the canonical size; sizeMul scales it.
  void base;
  return aiPick;
}

/**
 * Pick a vertical position based on animation. Most animations sit in the
 * lower third (TikTok/Reels safe zone above the UI), but 'fall' starts
 * higher so the fall arc reads.
 */
function captionAnchorY(animation: CaptionAnimationId, H: number): number {
  switch (animation) {
    case 'fall':
      return H * 0.35;
    case 'wave':
    case 'rainbow':
    case 'neon':
      return H * 0.5;
    case 'slideUp':
      return H * 0.78;
    default:
      return H * 0.78;
  }
}

/** Convert hex / rgb to rgba(…, alpha) for shadow tinting. */
function toRgba(color: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (m) {
    const r = parseInt(m[1].slice(0, 2), 16);
    const g = parseInt(m[1].slice(2, 4), 16);
    const b = parseInt(m[1].slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  return color;
}

/**
 * Animated caption renderer. Replaces the static one when
 * `project.captionsEnabled` is true. Supports word-by-word reveal, multiple
 * eye-catching animations, and AI-picked styling per clip. All drawing is
 * clamped inside a 90% safe-area so text never escapes the frame.
 */
function drawAnimatedCaption(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  clip: ImageClip,
  localT: number,
  duration: number,
  base: ProjectState['captionStyle']
) {
  const text = clip.caption?.trim();
  if (!text) return;
  const style = resolveCaptionStyle(clip, base);
  if (style.animation === 'none') {
    // Render static (legacy look) but still with AI font/color.
    return drawStaticAiCaption(ctx, W, H, text, base, style);
  }

  // ---------- Layout (auto-fit) ----------
  const safeWidth = W * 0.86;
  const baseSize = Math.round(base.size * style.sizeMul);
  let size = baseSize;
  let lines: WrappedLine[] = [];
  // Try the picked size; if any single word exceeds the safe width, shrink
  // until it fits. This guarantees no overflow without truncating.
  for (let attempt = 0; attempt < 6; attempt++) {
    ctx.font = `${style.fontWeight} ${size}px ${style.fontFamily}`;
    lines = wrapWords(ctx, text, safeWidth);
    const widest = lines.reduce((m, l) => Math.max(m, l.width), 0);
    if (widest <= safeWidth) break;
    size = Math.floor(size * 0.85);
  }
  const lineHeight = Math.round(size * 1.15);
  const totalHeight = lines.length * lineHeight;
  // Re-clamp font after wrapping in case loop exited early.
  ctx.font = `${style.fontWeight} ${size}px ${style.fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Anchor the block. For 'fall' we anchor higher so the descent reads.
  const cy = captionAnchorY(style.animation, H);
  const blockTop = cy - totalHeight / 2;

  // ---------- Word timing ----------
  // Total visible words across all lines.
  const allWords: { text: string; line: number; col: number }[] = [];
  for (let li = 0; li < lines.length; li++) {
    for (let ci = 0; ci < lines[li].words.length; ci++) {
      allWords.push({ text: lines[li].words[ci], line: li, col: ci });
    }
  }
  const wordCount = Math.max(1, allWords.length);
  // Reveal pacing: 70% of the clip duration, leaving 30% for breathing room.
  const revealWindow = Math.max(0.4, duration * 0.7);
  const wordSlot = revealWindow / wordCount;
  const wordEntrance = Math.min(0.45, Math.max(0.18, wordSlot * 1.1));

  ctx.save();
  // Common stroke setup.
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;

  // Per-word render with the chosen animation.
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const lineY = blockTop + li * lineHeight + lineHeight / 2;
    // Pre-measure each word so we can place them with the chosen tracking.
    const measured = line.words.map((w) => ctx.measureText(w).width);
    const spaceWidth = ctx.measureText(' ').width;
    const lineWidth =
      measured.reduce((s, w) => s + w, 0) + spaceWidth * Math.max(0, line.words.length - 1);
    let cursor = -lineWidth / 2;
    // Index of the first word on this line in the global ordering.
    const lineStartGlobal = allWords.findIndex((aw) => aw.line === li);

    for (let ci = 0; ci < line.words.length; ci++) {
      const word = line.words[ci];
      const wordWidth = measured[ci];
      const cx = cursor + wordWidth / 2;
      cursor += wordWidth + spaceWidth;

      const globalIdx = lineStartGlobal + ci;
      const wStart = globalIdx * wordSlot;
      const wLocal = (localT - wStart) / wordEntrance; // 0..1+ entrance progress
      if (wLocal < 0 && requiresEntrance(style.animation)) continue;
      const enter = Math.min(1, Math.max(0, wLocal));

      drawAnimatedWord(
        ctx,
        word,
        W / 2 + cx,
        lineY,
        size,
        enter,
        localT,
        globalIdx,
        style
      );
    }
  }

  ctx.restore();
}

/** Whether an animation hides the word until its entrance window starts. */
function requiresEntrance(anim: CaptionAnimationId): boolean {
  return (
    anim === 'pop' ||
    anim === 'wordPop' ||
    anim === 'typewriter' ||
    anim === 'slideUp' ||
    anim === 'fall' ||
    anim === 'bounce'
  );
}

/** Draws a single word at (x,y) with the chosen animation. */
function drawAnimatedWord(
  ctx: CanvasRenderingContext2D,
  word: string,
  x: number,
  y: number,
  size: number,
  /** entrance 0..1 */
  enter: number,
  /** clip-local time in seconds (for continuous animations) */
  t: number,
  /** global word index for staggering continuous effects */
  idx: number,
  style: CaptionStyleAuto
) {
  ctx.save();
  const strokeW = Math.max(4, size / 12);
  ctx.lineWidth = strokeW;
  ctx.strokeStyle = style.stroke;
  ctx.fillStyle = style.color;

  // Shadow / glow setups for relevant animations.
  const shadowColor = toRgba(style.accent, 0.85);

  let dx = 0;
  let dy = 0;
  let scale = 1;
  let alpha = 1;
  const eOut = easeOutCaption(enter);
  const eBack = easeOutBack(enter);

  switch (style.animation) {
    case 'pop':
      scale = 0.6 + 0.4 * eBack;
      alpha = eOut;
      break;
    case 'wordPop':
      // Each word pops independently with springy overshoot.
      scale = 0.4 + 0.6 * eBack;
      alpha = eOut;
      break;
    case 'slideUp':
      dy = (1 - eOut) * size * 1.4;
      alpha = eOut;
      break;
    case 'fall':
      // Drop from above with bounce.
      dy = -(1 - eBack) * size * 2.5;
      alpha = eOut;
      break;
    case 'bounce': {
      // Larger overshoot, then small settle wobble.
      scale = 0.5 + 0.5 * eBack;
      const wob = enter >= 1 ? Math.sin(t * 8 + idx) * 0.02 : 0;
      scale += wob;
      alpha = eOut;
      break;
    }
    case 'wave': {
      // Continuous vertical sine; staggered per word.
      dy = Math.sin(t * 4 + idx * 0.6) * size * 0.12;
      break;
    }
    case 'shake': {
      // Continuous high-frequency jitter while visible.
      dx = (Math.random() - 0.5) * size * 0.06;
      dy = (Math.random() - 0.5) * size * 0.06;
      break;
    }
    case 'glitch': {
      // RGB-split glitch: draw red + cyan offset copies, then main fill.
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const off = size * (0.04 + Math.random() * 0.03);
      ctx.fillStyle = '#ff0040';
      ctx.fillText(word, x - off, y);
      ctx.fillStyle = '#00e5ff';
      ctx.fillText(word, x + off, y);
      ctx.restore();
      // Occasional horizontal slice jitter.
      dx = Math.random() < 0.15 ? (Math.random() - 0.5) * size * 0.4 : 0;
      break;
    }
    case 'rainbow': {
      // Animate hue per character; drawn below as a per-char loop.
      // Don't apply a flat fill in the main path.
      drawRainbowWord(ctx, word, x, y, size, t, idx, style);
      ctx.restore();
      return;
    }
    case 'neon': {
      // Strong glow with subtle pulse.
      const pulse = 1 + Math.sin(t * 3 + idx) * 0.08;
      ctx.shadowColor = shadowColor;
      ctx.shadowBlur = size * 0.6 * pulse;
      break;
    }
    case 'typewriter': {
      // Reveal characters one by one within the entrance window.
      drawTypewriterWord(ctx, word, x, y, enter);
      ctx.restore();
      return;
    }
    default:
      alpha = 1;
  }

  ctx.globalAlpha = alpha;
  ctx.translate(x + dx, y + dy);
  if (scale !== 1) ctx.scale(scale, scale);
  // Stroke first (under), then fill (over) for the chunky TikTok look.
  ctx.strokeText(word, 0, 0);
  ctx.fillText(word, 0, 0);
  ctx.restore();
}

function drawRainbowWord(
  ctx: CanvasRenderingContext2D,
  word: string,
  x: number,
  y: number,
  size: number,
  t: number,
  idx: number,
  style: CaptionStyleAuto
) {
  ctx.save();
  ctx.lineWidth = Math.max(4, size / 12);
  ctx.strokeStyle = '#000000';
  // Measure each char to position separately.
  const chars = Array.from(word);
  const widths = chars.map((c) => ctx.measureText(c).width);
  const total = widths.reduce((a, b) => a + b, 0);
  let cursor = -total / 2;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    const w = widths[i];
    const cx = cursor + w / 2;
    cursor += w;
    const hue = ((t * 60 + (idx + i) * 30) % 360 + 360) % 360;
    ctx.fillStyle = `hsl(${hue}, 95%, 60%)`;
    ctx.strokeText(c, x + cx, y);
    ctx.fillText(c, x + cx, y);
  }
  // Suppress unused style warning.
  void style;
  ctx.restore();
}

function drawTypewriterWord(
  ctx: CanvasRenderingContext2D,
  word: string,
  x: number,
  y: number,
  enter: number
) {
  // Reveal characters proportionally to enter (0..1).
  const visible = Math.max(0, Math.min(word.length, Math.floor(enter * word.length + 0.0001)));
  if (visible <= 0) return;
  const sliced = word.slice(0, visible);
  ctx.strokeText(sliced, x, y);
  ctx.fillText(sliced, x, y);
}

/** Static caption renderer used when animation is 'none' (still uses AI font/color). */
function drawStaticAiCaption(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  text: string,
  base: ProjectState['captionStyle'],
  style: CaptionStyleAuto
) {
  ctx.save();
  const size = Math.round(base.size * style.sizeMul);
  ctx.font = `${style.fontWeight} ${size}px ${style.fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = Math.max(6, size / 10);
  ctx.strokeStyle = style.stroke;
  ctx.fillStyle = style.color;
  const lines = wrapWords(ctx, text, W * 0.86);
  const lh = Math.round(size * 1.15);
  const total = lines.length * lh;
  const cy = H * 0.78;
  for (let i = 0; i < lines.length; i++) {
    const yy = cy - total / 2 + i * lh + lh / 2;
    const lineText = lines[i].words.join(' ');
    ctx.strokeText(lineText, W / 2, yy);
    ctx.fillText(lineText, W / 2, yy);
  }
  ctx.restore();
}

// =====================================================================
//  Project-level script (transcript) renderer
// =====================================================================
//
// Spans the *whole* video. Each word reveal is timed against either even
// distribution across the total duration, or detected audio onset peaks
// when the user picks 'audio' sync mode. Only a small window of words
// (the most recent ~6) stays visible so the screen never fills with a wall
// of text — mimics the TikTok / Reels live-caption style.

const SCRIPT_VISIBLE_WORDS = 6;

function drawProjectScript(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  script: ProjectScript,
  t: number,
  totalDur: number,
  base: ProjectState['captionStyle'],
  audioPeaks?: number[]
) {
  const rawText = script.text.trim();
  if (!rawText || totalDur <= 0) return;

  // ---------- Filler/profanity filter ----------
  // Apply BEFORE picking the visible window so filler words don't reserve
  // slots. Word timestamps stay anchored to the surviving words' real
  // spoken times (we never back-fill gaps — that would push captions out
  // of sync with the underlying speech).
  const filtered = filterFillerWords(
    rawText,
    script.wordTimes,
    script.wordEnds,
    !!script.filterFillers,
    script.customFillers ?? []
  );
  const text = filtered.text;
  const words = filtered.words;
  if (words.length === 0) return;
  const filteredWordTimes =
    filtered.wordTimes.length === words.length ? filtered.wordTimes : undefined;
  const filteredWordEnds =
    filtered.wordEnds.length === words.length ? filtered.wordEnds : undefined;

  // ---------- Style: preset > AI auto > user-picked animation ----------
  const preset = getPreset(script.preset);
  const aiPick = pickCaptionStyle(text, script.styleSeed || 1);
  let style: CaptionStyleAuto;
  if (preset) {
    style = {
      animation:
        script.animation !== 'auto'
          ? script.animation
          : preset.style.animation === 'auto'
            ? aiPick.animation
            : preset.style.animation,
      color: preset.style.fillColor,
      stroke: preset.style.strokeColor,
      accent: preset.style.glow,
      fontFamily: preset.style.fontFamily,
      fontWeight: preset.style.fontWeight,
      sizeMul: preset.style.sizeMul,
      tracking: preset.style.letterSpacing ?? 1
    };
  } else {
    style =
      script.animation === 'auto'
        ? aiPick
        : { ...aiPick, animation: script.animation };
  }
  const uppercase = preset?.style.uppercase ?? false;
  const presetPill = preset?.style.pill ?? null;
  const presetStrokeWidth = preset?.style.strokeWidth;
  const karaoke = !!script.karaoke;

  // ---------- Reveal schedule ----------
  // We compute the *start time* of each word. Word stays on screen until
  // SCRIPT_VISIBLE_WORDS later words have appeared (then it scrolls off).
  //
  // Three sync modes, in order of accuracy:
  //   1. 'transcript' — exact per-word timestamps from speech-to-text. Most
  //      accurate, used when the user clicked "Transcribe audio".
  //   2. 'audio'      — align word reveals to detected onset peaks (rough
  //      rhythm; works without STT).
  //   3. 'even'       — fallback, distribute words evenly across the timeline.
  // We use the *filtered* word times so reveals stay in sync after
  // dropping fillers.
  const wt = filteredWordTimes;
  const wEnds = filteredWordEnds;
  const useTranscript =
    script.syncMode === 'transcript' &&
    Array.isArray(wt) &&
    wt.length === words.length;
  const useAudio =
    !useTranscript &&
    script.syncMode === 'audio' &&
    audioPeaks &&
    audioPeaks.length > 0;
  const starts: number[] = useTranscript
    ? wt!.slice()
    : useAudio
      ? distributeRevealTimes(audioPeaks!, words.length, 0, totalDur)
      : Array.from({ length: words.length }, (_, i) => ((i + 0.5) / words.length) * totalDur);

  // Per-word entrance window: short, lively (max 0.35s). When the timing is
  // exact (transcript) or rhythmic (audio peaks) we keep it tight so the
  // word visually "hits" precisely with the speech.
  const entrance = useTranscript ? 0.18 : useAudio ? 0.22 : 0.32;

  // ---------- Layout ----------
  const safeWidth = W * 0.86;
  let size = Math.round(base.size * style.sizeMul);
  ctx.font = `${style.fontWeight} ${size}px ${style.fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;

  // Build the visible window: words whose start <= t and that haven't been
  // pushed off by SCRIPT_VISIBLE_WORDS later words appearing.
  const visible: { idx: number; enter: number }[] = [];
  for (let i = 0; i < words.length; i++) {
    if (starts[i] > t) break;
    const wEnter = Math.min(1, Math.max(0, (t - starts[i]) / entrance));
    visible.push({ idx: i, enter: wEnter });
  }
  // Keep only the last SCRIPT_VISIBLE_WORDS so older words scroll off.
  while (visible.length > SCRIPT_VISIBLE_WORDS) visible.shift();
  if (visible.length === 0) return;

  // Wrap visible words to fit the safe width. Shrink size if needed.
  let lines: WrappedLine[] = [];
  const phraseWords = visible.map((v) => {
    const w = words[v.idx];
    return uppercase ? w.toUpperCase() : w;
  });
  for (let attempt = 0; attempt < 5; attempt++) {
    ctx.font = `${style.fontWeight} ${size}px ${style.fontFamily}`;
    lines = wrapWords(ctx, phraseWords.join(' '), safeWidth);
    const widest = lines.reduce((m, l) => Math.max(m, l.width), 0);
    if (widest <= safeWidth) break;
    size = Math.floor(size * 0.85);
  }
  ctx.font = `${style.fontWeight} ${size}px ${style.fontFamily}`;

  const lineHeight = Math.round(size * 1.15);
  const totalHeight = lines.length * lineHeight;
  const cy = captionAnchorY(style.animation, H);
  const blockTop = cy - totalHeight / 2;

  // We need to know the position of every word in the wrapped layout.
  // Build a flat list of word entries with their (line, col, x, y).
  type WordPos = { word: string; x: number; y: number; visIdx: number };
  const positions: WordPos[] = [];
  let visibleCursor = 0; // index into `visible` array
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const lineY = blockTop + li * lineHeight + lineHeight / 2;
    const measured = line.words.map((w) => ctx.measureText(w).width);
    const spaceWidth = ctx.measureText(' ').width;
    const lineWidth =
      measured.reduce((s, w) => s + w, 0) +
      spaceWidth * Math.max(0, line.words.length - 1);
    let cursor = -lineWidth / 2;
    for (let ci = 0; ci < line.words.length; ci++) {
      const word = line.words[ci];
      const wWidth = measured[ci];
      const cx = cursor + wWidth / 2;
      cursor += wWidth + spaceWidth;
      positions.push({
        word,
        x: W / 2 + cx,
        y: lineY,
        visIdx: visibleCursor
      });
      visibleCursor++;
    }
  }

  // Render each visible word with its entrance + a fade trail for older words.
  ctx.save();

  // Optional pill background (TikTok-style). Drawn behind text so it sits
  // under all the words.
  if (presetPill) {
    ctx.save();
    const padX = Math.round(size * 0.45);
    const padY = Math.round(size * 0.18);
    for (let li = 0; li < lines.length; li++) {
      const lineY = blockTop + li * lineHeight + lineHeight / 2;
      const w = lines[li].width;
      ctx.fillStyle = presetPill;
      const x = W / 2 - w / 2 - padX;
      const y = lineY - lineHeight / 2 - padY * 0.3;
      const ww = w + padX * 2;
      const hh = lineHeight + padY;
      const r = Math.min(hh / 2, 24);
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + ww, y, x + ww, y + hh, r);
      ctx.arcTo(x + ww, y + hh, x, y + hh, r);
      ctx.arcTo(x, y + hh, x, y, r);
      ctx.arcTo(x, y, x + ww, y, r);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  // Karaoke: figure out which visible word is currently being spoken (so we
  // can highlight it). A word is "current" while t is between its start and
  // its end (or up to the next word's start when end is unknown).
  let karaokeActiveVisIdx = -1;
  if (karaoke) {
    for (let i = visible.length - 1; i >= 0; i--) {
      const v = visible[i];
      const wStart = starts[v.idx];
      const wEnd =
        wEnds && wEnds.length === words.length
          ? wEnds[v.idx]
          : v.idx + 1 < starts.length
            ? starts[v.idx + 1]
            : wStart + 0.4;
      if (t >= wStart && t < wEnd + 0.05) {
        karaokeActiveVisIdx = i;
        break;
      }
    }
    // No active match (silence between words) — highlight the most recently
    // started word instead so the eye has a focal point.
    if (karaokeActiveVisIdx === -1) karaokeActiveVisIdx = visible.length - 1;
  }

  for (const pos of positions) {
    const v = visible[pos.visIdx];
    if (!v) continue;
    // Older words fade slightly so the *current* word visually pops more.
    const ageFromCurrent = visible.length - 1 - pos.visIdx;
    const isActive = karaoke && pos.visIdx === karaokeActiveVisIdx;
    let ageAlpha = Math.max(0.45, 1 - ageFromCurrent * 0.12);
    if (karaoke && !isActive) ageAlpha *= 0.55; // dim non-active words harder

    ctx.save();
    ctx.globalAlpha = ageAlpha;

    if (isActive) {
      // Glow + slight scale for the karaoke-active word.
      ctx.save();
      ctx.shadowColor = style.accent;
      ctx.shadowBlur = Math.round(size * 0.55);
      ctx.translate(pos.x, pos.y);
      ctx.scale(1.08, 1.08);
      ctx.translate(-pos.x, -pos.y);
    }

    // Override stroke width when a preset asked for one.
    if (presetStrokeWidth != null) {
      ctx.lineWidth = presetStrokeWidth;
    }

    drawAnimatedWord(
      ctx,
      pos.word,
      pos.x,
      pos.y,
      size,
      v.enter,
      t,
      v.idx,
      style
    );

    if (isActive) ctx.restore();
    ctx.restore();
  }
  ctx.restore();
}

/** Background fill that's never empty (cover effects with letterboxing fill). */
function drawBackground(ctx: CanvasRenderingContext2D, W: number, H: number) {
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#0b0b18');
  g.addColorStop(1, '#1a1030');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

export interface RenderContext {
  ctx: CanvasRenderingContext2D;
  project: ProjectState;
  clips: LoadedClip[];
  /**
   * Optional audio onset peak timestamps (seconds, relative to the start of
   * the *trimmed* audio range / start of the video). When present, the
   * project-script renderer aligns word reveals to these instead of even
   * time slots so the text lands on the actual rhythm of speech / beats.
   */
  audioPeaks?: number[];
  /** Pre-computed total project duration in seconds (so callers don't recompute). */
  totalDur?: number;
}

const TRANSITION_DURATION = 0.4; // seconds

/** Render the project at absolute time `t` to the canvas. */
export function renderFrame(rc: RenderContext, t: number): void {
  const { ctx, project, clips, audioPeaks } = rc;
  const W = project.width;
  const H = project.height;

  drawBackground(ctx, W, H);

  if (clips.length === 0) {
    drawPlaceholder(ctx, W, H);
    return;
  }

  // Find current clip + local time
  let acc = 0;
  let idx = 0;
  for (let i = 0; i < clips.length; i++) {
    if (t < acc + clips[i].duration) {
      idx = i;
      break;
    }
    acc += clips[i].duration;
    if (i === clips.length - 1) {
      idx = i;
      acc -= clips[i].duration; // clamp on final
    }
  }
  const clip = clips[idx];
  const local = Math.max(0, Math.min(clip.duration, t - acc));
  const progress = local / clip.duration;

  const drawCurrent = () => {
    const tr = applyEffect(resolveEffect(clip), progress);
    drawCover(ctx, clip.image, W, H, tr);
  };

  // Are we in a transition into the next clip?
  const next = clips[idx + 1];
  const remaining = clip.duration - local;
  if (next && clip.transition !== 'cut' && remaining < TRANSITION_DURATION) {
    const tp = 1 - remaining / TRANSITION_DURATION;
    const drawNext = () => {
      const tr = applyEffect(resolveEffect(next), 0);
      drawCover(ctx, next.image, W, H, tr);
    };
    applyTransition(ctx, W, H, clip.transition, tp, drawCurrent, drawNext);
  } else {
    drawCurrent();
  }

  // Caption layer. Project-level script (if set) wins because the user has
  // explicitly written a single transcript that spans all clips. Per-clip
  // captions still work for the legacy / mixed flow.
  //
  // `script.burnIn === false` means the user wants captions exported as a
  // sidecar .srt instead of pixel-burned, so we skip the draw entirely. The
  // toggle defaults to `true` (and `undefined` is treated as `true`) so old
  // projects keep their burned captions.
  const scriptText = project.script?.text?.trim();
  const burnIn = project.script?.burnIn !== false;
  if (project.captionsEnabled && scriptText && burnIn) {
    const dur = rc.totalDur ?? totalDuration(project.clips);
    drawProjectScript(
      ctx,
      W,
      H,
      project.script,
      t,
      dur,
      project.captionStyle,
      audioPeaks
    );
  } else if (clip.caption && burnIn) {
    if (project.captionsEnabled) {
      drawAnimatedCaption(ctx, W, H, clip, local, clip.duration, project.captionStyle);
    } else {
      drawCaption(ctx, W, H, clip.caption, project.captionStyle, progress);
    }
  }
}

function drawPlaceholder(ctx: CanvasRenderingContext2D, W: number, H: number) {
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  ctx.font = '600 56px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Add or generate an image to begin', W / 2, H / 2 - 40);
  ctx.font = '500 36px Inter, system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fillText('YouTube Shorts • 9:16 • 1080×1920', W / 2, H / 2 + 30);
  ctx.restore();
}
