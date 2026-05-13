// ---------------------------------------------------------------------------
// Project templates — one-click starting points.
// ---------------------------------------------------------------------------
// Each template returns a *fresh* ProjectState (factory pattern so consumers
// can't accidentally share clip arrays across templates). The templates are
// intentionally lightweight — they pre-fill the script, audio sync mode,
// caption preset and a hint about what kind of imagery the user should
// generate next. We do NOT bake in image URLs because:
//
//   1. Free Pollinations URLs eventually 404 when keys rotate, leaving the
//      template broken for new users.
//   2. The user almost always wants their own visuals — we'd rather hand
//      them a script + style and let them generate from the AI Image
//      Generator panel using the suggested prompts.
//
// To USE a template: create a new library entry from its `make()` output,
// then open it. The "Suggested prompts" array is surfaced in the library
// dialog so the user can click each one to populate the image generator.
// ---------------------------------------------------------------------------

import { DEFAULT_PROJECT, type ProjectState } from '../types';

export interface ProjectTemplate {
  id: string;
  /** Display name for the gallery card. */
  name: string;
  /** Single-line pitch. */
  tagline: string;
  /** Longer description for the card body. */
  description: string;
  /** Emoji icon for the card thumbnail. */
  icon: string;
  /** Pre-baked image prompts the user can click to populate the generator. */
  suggestedPrompts: string[];
  /** Factory that returns a fresh ProjectState. */
  make: () => ProjectState;
}

// Internal helper so each template can clone defaults without aliasing.
function base(overrides: Partial<ProjectState> = {}): ProjectState {
  return {
    ...DEFAULT_PROJECT,
    audio: { ...DEFAULT_PROJECT.audio },
    audio2: { ...DEFAULT_PROJECT.audio2 },
    clips: [],
    script: { ...DEFAULT_PROJECT.script },
    captionStyle: { ...DEFAULT_PROJECT.captionStyle },
    ...overrides
  };
}

export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    id: 'top5-list',
    name: 'Top 5 List',
    tagline: 'Hook + 5 ranked items + outro',
    description:
      'Classic listicle structure. Pre-fills a numbered script and the "MrBeast" caption preset for max retention.',
    icon: '🏆',
    suggestedPrompts: [
      'thumbnail of #1 hero shot, 9:16, ultra dramatic lighting',
      '#2 close-up product shot, vertical, cinematic',
      '#3 lifestyle shot, 9:16, vibrant colors',
      '#4 atmospheric environment, 9:16, mood lighting',
      '#5 punchline reveal, 9:16, high contrast'
    ],
    make: () =>
      base({
        captionsEnabled: true,
        script: {
          ...DEFAULT_PROJECT.script,
          text:
            "Top 5 things you didn't know about [TOPIC]. Number 5 will surprise you. " +
            "Number 5. [item five]. Number 4. [item four]. Number 3. [item three]. " +
            "Number 2. [item two]. And the number one [TOPIC] of all time... " +
            "[item one]. Follow for more.",
          animation: 'pop',
          preset: 'mrbeast',
          karaoke: true
        }
      })
  },
  {
    id: 'before-after',
    name: 'Before / After',
    tagline: 'Transformation reveal',
    description:
      'Side-by-side or sequential reveal. Great for fitness, makeup, room makeovers, etc.',
    icon: '🔄',
    suggestedPrompts: [
      'before state, dull lighting, 9:16, photo realistic',
      'transformation in progress, 9:16, dynamic motion',
      'after state, bright lighting, 9:16, photo realistic',
      'celebration reaction shot, 9:16'
    ],
    make: () =>
      base({
        captionsEnabled: true,
        script: {
          ...DEFAULT_PROJECT.script,
          text:
            "Before. Watch this. And after. Tell me which one is better in the comments.",
          animation: 'slideUp',
          preset: 'hormozi'
        }
      })
  },
  {
    id: 'storytime',
    name: 'Storytime',
    tagline: 'POV / personal story format',
    description:
      'TikTok storytime layout. Karaoke captions, lower-third TikTok-style preset, casual pacing.',
    icon: '🎙️',
    suggestedPrompts: [
      'POV first-person shot of [scene], 9:16, natural lighting',
      'flashback memory blur, 9:16, dreamlike',
      'emotional close-up reaction, 9:16',
      'present-day resolution scene, 9:16'
    ],
    make: () =>
      base({
        captionsEnabled: true,
        script: {
          ...DEFAULT_PROJECT.script,
          text:
            "So this happened to me last week and I'm still not over it. " +
            "[set the scene]. Then out of nowhere [the twist]. " +
            "And get this — [the punchline]. Make it make sense in the comments.",
          animation: 'wordPop',
          preset: 'tiktok',
          karaoke: true,
          syncMode: 'audio'
        }
      })
  },
  {
    id: 'tutorial',
    name: 'How-To Tutorial',
    tagline: 'Step-by-step explainer',
    description:
      "Step 1, 2, 3 walkthrough. Use the AI Script Writer to expand each step from a 1-line outline.",
    icon: '🧠',
    suggestedPrompts: [
      'overhead shot of materials laid out, 9:16, flat-lay photo',
      'hands performing step one, 9:16, instructional',
      'close-up of step two action, 9:16',
      'finished result hero shot, 9:16, glossy magazine style'
    ],
    make: () =>
      base({
        captionsEnabled: true,
        script: {
          ...DEFAULT_PROJECT.script,
          text:
            "Here's how to [skill] in 30 seconds. Step 1: [first step]. " +
            "Step 2: [second step]. Step 3: [third step]. Done. Save this for later.",
          animation: 'slideUp',
          preset: 'aliabdaal'
        }
      })
  },
  {
    id: 'hook-test',
    name: 'Hook Lab',
    tagline: 'Test 3 hooks back-to-back',
    description:
      'Three different opening lines on the same B-roll. Use the AI Hook Generator to fill the variants.',
    icon: '🪝',
    suggestedPrompts: [
      'attention-grabbing hero shot, 9:16, scroll-stopping',
      'continuation B-roll, 9:16, related visual',
      'payoff / CTA shot, 9:16, climactic'
    ],
    make: () =>
      base({
        captionsEnabled: true,
        script: {
          ...DEFAULT_PROJECT.script,
          text: '[Hook variant 1]. [Hook variant 2]. [Hook variant 3].',
          animation: 'pop',
          preset: 'mrbeast'
        }
      })
  },
  {
    id: 'blank',
    name: 'Blank Project',
    tagline: 'Start from scratch',
    description: 'Empty 9:16 canvas with default settings. Build from zero.',
    icon: '⬜',
    suggestedPrompts: [],
    make: () => base()
  }
];

export function getTemplate(id: string): ProjectTemplate | null {
  return PROJECT_TEMPLATES.find((t) => t.id === id) ?? null;
}
