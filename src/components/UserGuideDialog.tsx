import { useRef } from 'react';
import {
  Box,
  Button,
  Chip,
  Container,
  Dialog,
  DialogContent,
  Divider,
  IconButton,
  Stack,
  Tooltip,
  Typography
} from '@mui/material';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import HelpOutlineRoundedIcon from '@mui/icons-material/HelpOutlineRounded';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import ImageRoundedIcon from '@mui/icons-material/ImageRounded';
import GraphicEqRoundedIcon from '@mui/icons-material/GraphicEqRounded';
import HeadphonesRoundedIcon from '@mui/icons-material/HeadphonesRounded';
import SubtitlesRoundedIcon from '@mui/icons-material/SubtitlesRounded';
import AspectRatioRoundedIcon from '@mui/icons-material/AspectRatioRounded';
import ViewColumnRoundedIcon from '@mui/icons-material/ViewColumnRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import KeyboardRoundedIcon from '@mui/icons-material/KeyboardRounded';
import LightbulbRoundedIcon from '@mui/icons-material/LightbulbRounded';
import MovieFilterRoundedIcon from '@mui/icons-material/MovieFilterRounded';
import PaletteRoundedIcon from '@mui/icons-material/PaletteRounded';
import LibraryAddCheckRoundedIcon from '@mui/icons-material/LibraryAddCheckRounded';
import DesignServicesRoundedIcon from '@mui/icons-material/DesignServicesRounded';
import SwapVertRoundedIcon from '@mui/icons-material/SwapVertRounded';

const WALKTHROUGH_VIDEO_URL =
  import.meta.env.VITE_WALKTHROUGH_VIDEO_URL?.trim() || '/walkthrough.mp4';
const WALKTHROUGH_POSTER_URL =
  import.meta.env.VITE_WALKTHROUGH_POSTER_URL?.trim() || '/walkthrough-poster.jpg';

const WALKTHROUGH_CHAPTERS: Array<{ label: string; atSec: number }> = [
  { label: 'Intro', atSec: 0 },
  { label: 'Generate visuals', atSec: 15 },
  { label: 'Upload media', atSec: 40 },
  { label: 'Audio sync', atSec: 60 },
  { label: 'Captions', atSec: 85 },
  { label: 'Timeline polish', atSec: 110 },
  { label: 'Export', atSec: 130 }
];

/**
 * Information architecture for the user-guide page.
 * Each section is its own card so the page reads like a tutorial \u2014
 * scan the headings, dive into the one that's relevant.
 */
interface GuideSection {
  id: string;
  title: string;
  icon: JSX.Element;
  intro: string;
  steps: string[];
  tip?: string;
}

const SECTIONS: GuideSection[] = [
  {
    id: 'quick-start',
    title: 'Quick start \u2014 first video in 60 seconds',
    icon: <AutoAwesomeIcon />,
    intro:
      'Shorts Studio runs entirely in your browser \u2014 no signup, no uploads to a server, no API keys.',
    steps: [
      'Pick your aspect ratio at the top (9:16 for YouTube Shorts / Reels / TikTok).',
      'Use the AI Image Generator on the left to create your first scene.',
      'Drop an audio file (or record one) into the Audio panel \u2014 captions will auto-sync.',
      'Hit the glowing "Render & download" button under the preview to export a WebM.'
    ],
    tip: 'Drag and drop images, video files, or audio anywhere on the page \u2014 the drop zone auto-routes them.'
  },
  {
    id: 'library',
    title: 'Project Library \u2014 save & switch between drafts',
    icon: <LibraryAddCheckRoundedIcon />,
    intro:
      'Save snapshots of your project so you never lose work. Open the library from the bookshelf icon in the header.',
    steps: [
      'Click "Save current as new" to capture the project as a new entry \u2014 your current edits keep going.',
      'Click "Overwrite" on any saved draft to update it with the latest state.',
      'Use "Open" to load a saved draft back into the editor (your current work is auto-saved to the active project first).',
      '"Duplicate" copies a draft to iterate on without touching the original.',
      'Rename, delete, or download any saved project as a .json backup.'
    ],
    tip: 'Save before risky experiments (different audio, restructured timeline) so you can always revert.'
  },
  {
    id: 'templates',
    title: 'Project templates \u2014 start in one click',
    icon: <DesignServicesRoundedIcon />,
    intro:
      'Six ready-to-go scaffolds: Top-5 List, Before/After, Tutorial, Story-time, Quote Reel, and Product Showcase. Each loads a starter script and the right clip count.',
    steps: [
      'In the Script panel, open the AI Writer card.',
      'Click any template chip to scaffold the project.',
      'Edit the placeholder script to match your topic.',
      'Add images / videos to fill in each pre-created clip slot.'
    ],
    tip: 'Templates are also a great way to learn the optimal structure for a 30-second Short.'
  },
  {
    id: 'ai-writer',
    title: 'AI Script Writer + Hook Generator',
    icon: <AutoAwesomeIcon />,
    intro:
      'Type a topic and let AI write a 3-part Short for you (Hook \u2192 Body \u2192 CTA), or generate 5 scroll-stopping hooks to pick from. Free, key-less, via Pollinations.',
    steps: [
      'Open the Script panel and find the "AI Script Writer" card.',
      'Type your topic, e.g. "Why most people fail their morning routine".',
      'Click "Write full script" \u2014 the result drops straight into the script box, already structured.',
      'Or click "5 hooks" to get five different opening lines and pick the strongest.',
      'Once you have a script, hit "Sync pasted text to audio" to align words with your voiceover.'
    ],
    tip: 'The first 3 seconds of a Short decide retention. Spend extra time refining the hook.'
  },
  {
    id: 'aspect',
    title: 'Aspect ratios',
    icon: <AspectRatioRoundedIcon />,
    intro:
      'Choose the canvas size that matches where the video will live. The preview, captions, and final export all switch instantly.',
    steps: [
      '9:16 \u2014 YouTube Shorts, Instagram Reels, TikTok (portrait, 1080\u00d71920).',
      '16:9 \u2014 YouTube landscape, talks, podcasts (1920\u00d71080).',
      '1:1 \u2014 Instagram feed square (1080\u00d71080).',
      '4:5 \u2014 Instagram portrait feed (1080\u00d71350).',
      '4:3 \u2014 Classic / retro look (1440\u00d71080).'
    ]
  },
  {
    id: 'images',
    title: 'AI image generation',
    icon: <ImageRoundedIcon />,
    intro:
      'Free and key-less. The cascade tries Pollinations first, then Lexica, then stock providers so you always get an image.',
    steps: [
      'Type a scene description \u2014 e.g. "cinematic shot of a foggy Tokyo alley at night".',
      'Pick a Source (Auto is best) and an optional Style (Cinematic, Anime, etc.).',
      'Click Generate. The image lands on the timeline as a new clip.',
      'Click the clip to set duration, transitions, motion, and per-clip captions.'
    ],
    tip: 'Trending presets at the bottom are one-tap starting points.'
  },
  {
    id: 'video-upload',
    title: 'Upload your own image or video',
    icon: <MovieFilterRoundedIcon />,
    intro:
      'Bring footage you already have. Images become clips directly; videos are sampled into evenly-spaced frames so every effect, transition, and caption keeps working.',
    steps: [
      'In the Media panel, click "Upload image(s) or video" \u2014 or simply drag the file onto the page.',
      'Images appear immediately on the timeline.',
      'Videos go through a frame extractor: roughly one frame every ~3 seconds (min 2, max 20 frames).',
      'Each extracted frame becomes its own clip with the standard 3-second duration \u2014 edit timing, effects, and captions per-clip as usual.'
    ],
    tip: 'MP4 (H.264) and WebM (VP9) work in every modern browser. AV1 / HEVC may fail in Firefox.'
  },
  {
    id: 'reorder',
    title: 'Drag clips to reorder',
    icon: <SwapVertRoundedIcon />,
    intro:
      'Restructure your video without deleting and re-adding clips.',
    steps: [
      'Grab any clip thumbnail in the timeline.',
      'Drag it left or right \u2014 a dashed outline shows where it will land.',
      'Release to drop. Audio, captions, and word timings all stay in sync.'
    ],
    tip: 'Reordering also works great when paired with the Project Library \u2014 save before rearranging.'
  },
  {
    id: 'split',
    title: 'Split-screen clips',
    icon: <ViewColumnRoundedIcon />,
    intro:
      'Show two images at once \u2014 great for before/after, comparisons, or reaction layouts.',
    steps: [
      'Select any clip in the timeline.',
      'Scroll down to the Split-Screen panel and toggle it on.',
      'Choose Horizontal (side-by-side) or Vertical (stacked).',
      'Upload a second image or AI-generate one with a different prompt.'
    ]
  },
  {
    id: 'audio',
    title: 'Voiceover + background music',
    icon: <GraphicEqRoundedIcon />,
    intro:
      'Two independent audio tracks. The main track drives transcription; the background track is for music.',
    steps: [
      'Drop your voiceover into the first Audio panel (main).',
      'Drop royalty-free music into the second Audio panel (background) to layer a bed.',
      'Use Sync mode to decide whether the clips fit the audio length, the audio loops to fit the clips, or both run independently.',
      'Trim with the in/out sliders \u2014 only the trimmed portion is recorded.'
    ],
    tip: 'Layering a music bed dramatically reduces copyright-claim risk on YouTube Shorts.'
  },
  {
    id: 'captions',
    title: 'AI captions (Whisper, on-device)',
    icon: <SubtitlesRoundedIcon />,
    intro:
      'Word-level captions generated locally with a Whisper model. Nothing leaves your device.',
    steps: [
      'Add a main audio track first.',
      'Click "Transcribe" in the Script panel. The model downloads once (~80 MB) and is cached.',
      'Pick an animation style \u2014 karaoke, pop, slide, typewriter, etc.',
      'Use "Edit words" to fix typos and adjust timings.',
      'Toggle "Captions" in the header / mobile bar to burn them into the export.'
    ],
    tip: 'You can paste a pre-written script and click "Sync to audio" \u2014 the model aligns your words to the timing.'
  },
  {
    id: 'caption-style',
    title: 'Customize caption color, font and position',
    icon: <PaletteRoundedIcon />,
    intro:
      'Lock a specific brand color, font, or screen position \u2014 while keeping AI suggestions for everything else.',
    steps: [
      'Scroll to the bottom of the Script panel: "Customize caption look (optional)".',
      'Pick a fill / stroke color with the OS color picker, or tap one of the suggested swatches.',
      'Choose a font family from the curated dropdown (Inter, Impact, Georgia, etc.). "AI / preset default" returns control to the AI.',
      'Snap caption position to Top / Middle / Lower-third / Bottom, or fine-tune with the 5%\u201395% slider.',
      'Use the reset icon to clear all overrides at once \u2014 AI / preset takes over again.'
    ],
    tip: 'All four fields are independent. Lock just your brand color and let AI keep picking the font + animation.'
  },
  {
    id: 'export',
    title: 'Rendering & downloading',
    icon: <DownloadRoundedIcon />,
    intro:
      'The glowing pill button under the preview records the canvas in real-time with audio mixed in. Output is WebM (VP9 + Opus).',
    steps: [
      'Make sure your preview looks right \u2014 what you see is what you get.',
      'Click "Render & download". A progress overlay appears.',
      'Wait for the full video length \u2014 recording is real-time so audio stays perfectly in sync.',
      'The .webm file is saved automatically. Drop it straight into YouTube Studio.'
    ],
    tip: 'WebM uploads directly to YouTube. For Instagram / TikTok, convert to MP4 with a free tool like CloudConvert. (Native MP4 export is on the roadmap \u2014 see BACKLOG.md in the repo.)'
  }
];

const SHORTCUTS: Array<{ keys: string; action: string }> = [
  { keys: 'Space', action: 'Play / pause preview' },
  { keys: 'Home', action: 'Restart from beginning' },
  { keys: 'L', action: 'Toggle loop' },
  { keys: 'Drag a file', action: 'Auto-add image or audio anywhere on the page' }
];

interface UserGuideProps {
  open: boolean;
  onClose: () => void;
}

export function UserGuideDialog({ open, onClose }: UserGuideProps) {
  const walkthroughVideoRef = useRef<HTMLVideoElement | null>(null);

  function jumpToChapter(atSec: number): void {
    const el = walkthroughVideoRef.current;
    if (!el) return;
    el.currentTime = atSec;
    void el.play().catch(() => {
      // Ignore autoplay restrictions; user can press play manually.
    });
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="md"
      aria-labelledby="user-guide-title"
      slotProps={{
        paper: {
          sx: {
            backgroundImage:
              'linear-gradient(180deg, rgba(124,58,237,0.08) 0%, rgba(15,23,42,0) 60%)',
            // Phones get a near-fullscreen sheet, desktop a centred dialog.
            m: { xs: 1, sm: 3 },
            maxHeight: { xs: 'calc(100vh - 16px)', sm: 'calc(100vh - 64px)' }
          }
        }
      }}
    >
      {/* Sticky header so the close button stays reachable while scrolling. */}
      <Box
        sx={{
          position: 'sticky',
          top: 0,
          zIndex: 2,
          background: 'rgba(15,23,42,0.92)',
          backdropFilter: 'blur(8px)',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          px: { xs: 2, sm: 3 },
          py: 1.5
        }}
      >
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Box
              sx={{
                width: 36,
                height: 36,
                borderRadius: 2,
                background:
                  'linear-gradient(135deg,#7c3aed 0%,#22d3ee 60%,#ff3ea5 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <HelpOutlineRoundedIcon sx={{ color: '#fff' }} />
            </Box>
            <Box>
              <Typography
                id="user-guide-title"
                variant="h6"
                sx={{ lineHeight: 1, fontWeight: 700 }}
              >
                User guide
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Everything you can do with Shorts Studio.
              </Typography>
            </Box>
          </Stack>
          <Tooltip title="Close" arrow>
            <IconButton
              onClick={onClose}
              aria-label="Close user guide"
              size="small"
            >
              <CloseRoundedIcon />
            </IconButton>
          </Tooltip>
        </Stack>
      </Box>

      <DialogContent sx={{ p: 0 }}>
        <Container maxWidth="md" sx={{ py: { xs: 2, sm: 3 } }}>
          {/* Walkthrough video first so new users can learn the full flow fast. */}
          <Box
            sx={{
              mb: 3,
              p: { xs: 2, sm: 2.5 },
              borderRadius: 2,
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.06)'
            }}
          >
            <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1 }}>
              <Box
                sx={{
                  width: 36,
                  height: 36,
                  borderRadius: 2,
                  background: 'rgba(34,211,238,0.15)',
                  color: '#22d3ee',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <MovieFilterRoundedIcon />
              </Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                Walkthrough video
              </Typography>
            </Stack>

            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.25 }}>
              Watch this quick end-to-end demo to learn the full workflow from prompt to export.
            </Typography>

            <Box
              sx={{
                borderRadius: 2,
                overflow: 'hidden',
                border: '1px solid rgba(255,255,255,0.1)',
                background: 'rgba(0,0,0,0.3)'
              }}
            >
              <Box
                component="video"
                ref={walkthroughVideoRef}
                controls
                preload="metadata"
                src={WALKTHROUGH_VIDEO_URL}
                poster={WALKTHROUGH_POSTER_URL}
                sx={{ width: '100%', display: 'block', aspectRatio: '16 / 9' }}
              />
            </Box>

            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mt: 1.25 }}>
              {WALKTHROUGH_CHAPTERS.map((chapter) => (
                <Chip
                  key={chapter.label}
                  label={`${chapter.label} (${Math.floor(chapter.atSec / 60)}:${String(chapter.atSec % 60).padStart(2, '0')})`}
                  size="small"
                  variant="outlined"
                  clickable
                  onClick={() => jumpToChapter(chapter.atSec)}
                  sx={{ borderColor: 'rgba(34,211,238,0.4)' }}
                />
              ))}
            </Stack>

            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
              Tip: place media at public/walkthrough.mp4 and public/walkthrough-poster.jpg, or set VITE_WALKTHROUGH_VIDEO_URL and VITE_WALKTHROUGH_POSTER_URL.
            </Typography>
          </Box>

          {/* Section quick-jump chips. Anchors scroll inside the dialog. */}
          <Stack
            direction="row"
            spacing={1}
            flexWrap="wrap"
            useFlexGap
            sx={{ mb: 3 }}
          >
            {SECTIONS.map((s) => (
              <Chip
                key={s.id}
                label={s.title.split(' \u2014 ')[0]}
                size="small"
                variant="outlined"
                clickable
                onClick={() => {
                  const el = document.getElementById(`guide-${s.id}`);
                  el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
                sx={{ borderColor: 'rgba(167,139,250,0.4)' }}
              />
            ))}
          </Stack>

          <Stack spacing={3}>
            {SECTIONS.map((s) => (
              <Box
                key={s.id}
                id={`guide-${s.id}`}
                sx={{
                  // Scroll-margin keeps the heading visible below the sticky
                  // header when the user clicks a quick-jump chip.
                  scrollMarginTop: 80,
                  p: { xs: 2, sm: 2.5 },
                  borderRadius: 2,
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.06)'
                }}
              >
                <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1 }}>
                  <Box
                    sx={{
                      width: 36,
                      height: 36,
                      borderRadius: 2,
                      background: 'rgba(124,58,237,0.15)',
                      color: '#a78bfa',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    {s.icon}
                  </Box>
                  <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                    {s.title}
                  </Typography>
                </Stack>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mb: 1.5 }}
                >
                  {s.intro}
                </Typography>
                <Box
                  component="ol"
                  sx={{
                    pl: 2.5,
                    m: 0,
                    '& li': {
                      mb: 0.75,
                      fontSize: 14,
                      lineHeight: 1.6,
                      color: 'rgba(255,255,255,0.85)'
                    },
                    '& li::marker': { color: '#a78bfa', fontWeight: 700 }
                  }}
                >
                  {s.steps.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </Box>
                {s.tip && (
                  <Stack
                    direction="row"
                    spacing={1}
                    alignItems="flex-start"
                    sx={{
                      mt: 2,
                      p: 1.25,
                      borderRadius: 1.5,
                      background: 'rgba(245,158,11,0.08)',
                      border: '1px solid rgba(245,158,11,0.18)'
                    }}
                  >
                    <LightbulbRoundedIcon
                      sx={{ color: '#f59e0b', fontSize: 18, mt: 0.25 }}
                    />
                    <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.85)' }}>
                      <strong>Pro tip:</strong> {s.tip}
                    </Typography>
                  </Stack>
                )}
              </Box>
            ))}

            <Divider sx={{ my: 1 }} />

            {/* Keyboard shortcut cheat-sheet. */}
            <Box
              sx={{
                p: { xs: 2, sm: 2.5 },
                borderRadius: 2,
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.06)'
              }}
            >
              <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1.5 }}>
                <Box
                  sx={{
                    width: 36,
                    height: 36,
                    borderRadius: 2,
                    background: 'rgba(34,211,238,0.15)',
                    color: '#22d3ee',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  <KeyboardRoundedIcon />
                </Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                  Handy shortcuts
                </Typography>
              </Stack>
              <Stack spacing={1}>
                {SHORTCUTS.map((s) => (
                  <Stack
                    key={s.action}
                    direction="row"
                    alignItems="center"
                    spacing={2}
                    sx={{ fontSize: 14 }}
                  >
                    <Chip
                      label={s.keys}
                      size="small"
                      sx={{
                        fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                        fontWeight: 700,
                        minWidth: 100,
                        background: 'rgba(255,255,255,0.06)',
                        borderRadius: 1
                      }}
                    />
                    <Typography variant="body2" color="text.secondary">
                      {s.action}
                    </Typography>
                  </Stack>
                ))}
              </Stack>
            </Box>

            {/* Privacy reassurance. Important context for first-time users. */}
            <Box
              sx={{
                p: 2,
                borderRadius: 2,
                background:
                  'linear-gradient(135deg, rgba(124,58,237,0.12) 0%, rgba(34,211,238,0.08) 100%)',
                border: '1px solid rgba(167,139,250,0.25)'
              }}
            >
              <Stack direction="row" spacing={1.5} alignItems="flex-start">
                <HeadphonesRoundedIcon sx={{ color: '#a78bfa', mt: 0.5 }} />
                <Box>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
                    100% in your browser
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Your audio, images, and transcripts never leave your device. Whisper
                    runs locally, the canvas renders locally, and the WebM is created on
                    your machine. The only network calls are to fetch AI-generated
                    images and the Whisper model itself.
                  </Typography>
                </Box>
              </Stack>
            </Box>

            <Box sx={{ textAlign: 'center', pt: 1 }}>
              <Button variant="contained" color="secondary" onClick={onClose}>
                {"Got it \u2014 let's create"}
              </Button>
            </Box>
          </Stack>
        </Container>
      </DialogContent>
    </Dialog>
  );
}
