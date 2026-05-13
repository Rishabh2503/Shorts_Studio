# Shorts Studio — Feature Backlog

This file tracks **planned but not-yet-implemented** features. Each entry
lists the value, rough effort, and dependencies / implementation notes so
they're ready to grab when you have time.

> ✅ items are already shipped. ⏳ items are explicitly deferred.
> Priorities are rough: 🟢 high impact / low effort, 🟡 medium, 🔴 large effort.

---

## Recently shipped (in this branch)

- ✅ **Video upload with frame extraction** — drop a `.mp4`/`.webm` and it
  auto-splits into still frames for the timeline.
- ✅ **Caption customization** — color, stroke, font family, vertical
  position overrides that layer on top of the AI/preset styling.
- ✅ **Project library (multi-save)** — save the current project as a
  named copy, browse/load/rename/delete snapshots, all in IDB. Header
  folder icon ➜ dialog.
- ✅ **Project templates** — 6 starter templates (Top 5, Before/After,
  Storytime, Tutorial, Hook Lab, Blank) with pre-filled script + caption
  preset + suggested image prompts.
- ✅ **AI Script Writer** — generate a full 30-second script or 5 hook
  variants from a topic via Pollinations text endpoint. Lives inside
  ScriptPanel "Option B".
- ✅ **Drag-to-reorder clips** — HTML5 drag-and-drop in the timeline,
  with cyan drop-indicator outline.

---

## High value, ready to build (🟢)

### MP4 export (replace WebM screen-record)
- **Why:** WebM doesn't play natively in iOS Safari or Twitter previews.
  An MP4 download removes the "convert manually" step from the user flow.
- **Effort:** Medium (1–2 days).
- **Approach:** Lazy-load
  [`@ffmpeg/ffmpeg`](https://github.com/ffmpegwasm/ffmpeg.wasm) on first
  export. Reuse the existing MediaRecorder → WebM blob, then ffmpeg-WASM
  transcodes to `libx264` + `aac` H.264 MP4. About a 30 MB one-time wasm
  download — gate behind an "Export as MP4 (downloads encoder once)"
  toggle so users know what's coming.
- **Watch out:** ffmpeg.wasm needs cross-origin isolation headers
  (`COOP: same-origin`, `COEP: require-corp`). Add them in `vercel.json`.

### Background remover for clip images (RMBG-1.4)
- **Why:** Lets users layer subjects on AI backgrounds without manual
  Photoshopping. Huge for "react over screenshot" videos.
- **Effort:** Medium (1 day).
- **Approach:** `@huggingface/transformers` already in deps. Add a
  "Remove background" button on the selected clip; runs the
  `Xenova/modnet` or `briaai/RMBG-1.4` ONNX model on the image and
  replaces `clip.src` with a transparent PNG. Show progress bar (model
  is ~85 MB on first load).
- **Cache:** Reuse the existing transformers.js cache so subsequent
  removes are instant.

### AI voiceover (TTS)
- **Why:** Letting users type the script and get a voice means no
  microphone, no recording, instant final video.
- **Effort:** Medium (2 days).
- **Approach:** Use [Piper WASM](https://github.com/wide-video/piper-wasm)
  or [Coqui XTTS](https://huggingface.co/coqui/XTTS-v2). Piper has 8–12
  high-quality voices at <30 MB each. UI: an "AI voice" toggle next to
  "Auto-transcribe" in ScriptPanel → pick voice + tone → generates an
  audio Blob and drops it into the audio slot.

### Royalty-free music library
- **Why:** Manually finding non-copyrighted music is the #1 reason
  creators abandon a tool. A curated in-app library kills that friction.
- **Effort:** Small (1 day).
- **Approach:** Curate 30–50 short loopable tracks (Pixabay Music,
  Uppbeat free tier, or Mubert API). Store URLs + tags in a JSON file;
  add a "Browse music" button to AudioPanel that opens a gallery with
  preview-on-hover and a one-click "Use this".

### Hashtag + description generator
- **Why:** Pairs perfectly with the AI Script Writer — users want to
  copy/paste a full upload-ready description.
- **Effort:** Tiny (3 hrs).
- **Approach:** `generateDescription(script)` already exists in
  [src/engine/aiText.ts](src/engine/aiText.ts). Add a "Generate
  description & hashtags" button to the export panel; show output in a
  copyable text block with "Copy" icon.

### Keyboard-shortcut overlay
- **Why:** Power users (the kind who batch-create 10 shorts a week) live
  on hotkeys. Currently undocumented.
- **Effort:** Tiny (2 hrs).
- **Approach:** Press `?` to open a dialog with: Space = play/pause,
  ←/→ = step clip, Delete = remove clip, ⌘S = save copy, etc. Most of
  these handlers already exist; just need the help dialog.

---

## Medium impact (🟡)

### Per-clip trim handles
- **Why:** Currently users set a duration number; visually trimming the
  in/out points on the timeline is faster.
- **Effort:** Medium (2 days).
- **Approach:** Add draggable left/right edges on each ClipThumb (in
  expanded "ruler" mode). On drag, update `clip.duration` live.

### Sticker / emoji overlay layer
- **Why:** Modern Shorts almost always have at least one animated emoji
  reaction.
- **Effort:** Medium (2 days).
- **Approach:** Add a `clip.stickers: Sticker[]` field (`{emoji, x, y,
  scale, t0, t1, animation}`). Render in the canvas after the image but
  before captions. Use existing animation library for entrance/exit.

### Text / title overlay (separate from captions)
- **Why:** Distinct from animated word captions — a static title card
  ("HOW I GAINED 100K SUBS IN 30 DAYS") at the start.
- **Effort:** Medium (2 days).
- **Approach:** `project.overlays: TextOverlay[]` with positioning,
  timing, font, and entrance animation. Render after captions for
  z-order priority.

### Brand kit (persistent colors/fonts/logo)
- **Why:** Creators with established brands want every video to use
  their exact palette without re-picking it each project.
- **Effort:** Small (1 day).
- **Approach:** Store under `kv:brand-kit` in IDB. Settings dialog:
  primary/accent colors, default font, optional watermark logo data
  URL. Pre-fills new projects.

### Caption translation (multi-language .srt export)
- **Why:** International reach. Creator records once, exports captions
  in 5 languages, uploads as alternate tracks.
- **Effort:** Medium (1 day).
- **Approach:** Use the Pollinations text endpoint with a translate
  prompt per cue. Add language dropdown to the SRT download menu.

### Caption contrast warning
- **Why:** Accessibility — captions are unreadable if they share a
  color with the background.
- **Effort:** Tiny (4 hrs).
- **Approach:** Sample the canvas pixels behind the caption rect every
  frame; compute WCAG contrast against the current caption color. Show
  a yellow ⚠ badge in the ScriptPanel "Customize" section when contrast
  drops below 4.5:1.

### Auto volume normalize (-14 LUFS)
- **Why:** YouTube auto-normalizes to -14 LUFS at upload — videos that
  are too loud get reduced and sound muffled. Pre-normalizing makes
  exports sound consistent.
- **Effort:** Medium (1 day).
- **Approach:** Use Web Audio API offline context to analyze the merged
  audio buffer, compute integrated loudness (ITU-R BS.1770-4), and
  apply linear gain. Most of this is already in npm packages
  (`loudness-meter`).

---

## Lower priority (🔴 or niche)

### Multi-aspect batch export
- One project → exports as 9:16, 1:1, and 16:9 simultaneously. Useful
  but rebuilds the render pipeline for parallel canvases. Large effort.

### Shareable preview link
- Upload the rendered video to Vercel Blob (or Cloudflare R2) and
  return a shareable URL. Requires backend + storage costs.

### Watermark toggle
- Optional "Made with Shorts Studio" watermark on free tier. Niche
  until/unless a pro tier exists.

### Real-time collaboration
- Multiple users editing one project at once via Y.js / Liveblocks.
  Massive scope, not yet justified.

### Asset library (saved B-roll)
- Store frequently-used images in a global "My Assets" library across
  projects. Layered on top of the current per-project model.

### A/B hook tester
- Render the same project with three different hooks (script + opening
  image) so the creator can post all three and see which performs best.
  Useful once analytics integration exists.

---

## Performance / polish (always-on)

- 🟡 **Caption preview is choppy on long videos** — `requestAnimationFrame`
  re-renders the whole transcript every tick. Memoize by current word
  index. Effort: 2 hrs.
- 🟡 **First image generation feels slow** — show a "Warming up" spinner
  while the Pollinations connection establishes. Effort: 1 hr.
- 🟢 **`vercel.json` cross-origin isolation headers** — needed for
  ffmpeg.wasm; harmless to add now even before MP4 export lands. Effort:
  10 min.
- 🟢 **Loading skeletons for clips during generation** — currently shows
  a generic spinner. A pulsing 9:16 placeholder matching the target
  aspect ratio reads better. Effort: 2 hrs.

---

## How to grab one

1. Pick a row, read the **Approach** and **Watch out** notes.
2. Update its status to ⏳ here (so others know it's in flight).
3. Build it on a feature branch named `feat/<slug>` for clean PRs.
4. Move it under "Recently shipped" when merged.

If adding a new backlog item, follow the same format: a short rationale,
effort estimate, and concrete-enough approach that future-you can pick
it up cold.
