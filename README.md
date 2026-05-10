# Shorts Studio — AI YouTube Shorts Maker

A modern, browser-only short-video creator. Generate AI images, sequence them on a timeline, layer trending animations / transitions / audio, then render & download an MP4-compatible WebM ready for YouTube Shorts.

**Stack:** Vite • React 18 • TypeScript • Tailwind CSS • Material UI v6 • Framer Motion

## Why it's cost-optimal

- **No backend.** The whole app runs client-side — zero hosting cost beyond a static page.
- **Free AI image generation** via [Pollinations.ai](https://pollinations.ai) (no API key, no billing). Models: Flux, Flux-Realism, Flux-Anime, Turbo.
- **Native browser video export** via the Canvas + `MediaRecorder` API — no FFmpeg.wasm download (~30 MB), no server transcode, no per-render cost.
- Optional drop-in upgrade path: swap the `generateImage` function for OpenAI / Stability / Replicate if you want premium quality.

## Features

- Vertical 9:16 1080×1920 @ 30 fps canvas (YouTube Shorts spec)
- **AI image generation** with prompt + 4 model options + 6 trending presets
- Multi-image upload (drag in your own JPG/PNG)
- **11 trending effects:** Ken Burns, Zoom In/Out, Pan Left/Right, Fade, RGB Glitch, Shake, Beat Pulse, Blur In, Parallax
- **5 transitions:** Cut, Fade, Slide, Whip Pan, Zoom Blur
- Per-clip duration, captions with stroke (TikTok-style)
- Audio upload with volume control, loops to fit
- Real-time canvas preview with playhead scrubber
- One-click render — outputs `.webm` (VP9/Opus) which YouTube Shorts accepts directly

## Getting started

```powershell
npm install
npm run dev
```

Then open http://localhost:5173.

## How it works

```
┌──────────────┐    ┌──────────────────┐    ┌──────────────────────┐
│  AI / Upload │ -> │  Timeline (clips)│ -> │  Canvas renderer @30fps
└──────────────┘    └──────────────────┘    └──────────┬───────────┘
                                                       │ captureStream()
                                                       ▼
                                          ┌──────────────────────────┐
                                          │ MediaRecorder (VP9+Opus) │
                                          └────────────┬─────────────┘
                                                       ▼
                                                .webm (download)
```

`src/engine/render.ts` is a pure function that paints a single project frame at time `t`. The same renderer drives both the live preview and the recorder, guaranteeing WYSIWYG output.

## Project structure

```
src/
  engine/
    render.ts       # Canvas frame renderer + effects + transitions
    export.ts       # MediaRecorder pipeline
    ai.ts           # Pollinations.ai client
  components/
    PreviewCanvas.tsx
    MediaPanel.tsx  # AI generator + uploader
    Timeline.tsx    # Clip strip + per-clip settings
    AudioPanel.tsx
    ExportButton.tsx
  theme.ts          # MUI v6 dark theme with neon accent
  App.tsx
  main.tsx
  index.css
```

## Tips

- Recording is real-time (a 30 s video takes 30 s to render). Keep the tab focused for stable frame timing.
- Use royalty-free music or your own audio to stay copyright-safe on YouTube.
- For the highest visual quality, use 1080×1920 source images. The AI generator already requests that resolution.

## Roadmap ideas

- Pluggable image providers (OpenAI/Stability/Replicate) selectable in UI
- Auto-captioning via WebSpeech / Whisper-WASM
- Beat-synced cuts (analyze audio with Web Audio API and snap clip boundaries)
- Export to MP4 via WebCodecs (already supported in Chromium)
