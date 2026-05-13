import { useState } from 'react';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  LinearProgress,
  MenuItem,
  Stack,
  TextField,
  Typography
} from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import MovieFilterRoundedIcon from '@mui/icons-material/MovieFilterRounded';
import { generateImage, TRENDING_PROMPTS, type ImageSource } from '../engine/ai';
import { extractVideoPoster } from '../engine/videoFrames';

interface Props {
  /**
   * Adds a still image clip. `prompt` is stored on the clip for re-rolls
   * and shown as the timeline tooltip.
   */
  onAddImage: (src: string, prompt?: string) => void;
  /**
   * Adds an uploaded video as a single video-backed clip. The renderer
   * draws live frames from `videoSrc`; `poster` is the still thumbnail
   * shown in the timeline strip and the project library card.
   */
  onAddVideo: (args: {
    videoSrc: string;
    poster: string;
    duration: number;
    name: string;
  }) => void;
}

// Pollinations deprecated `flux-realism` and `flux-anime` (their /models
// endpoint now lists only a single backbone). So instead of exposing model
// names that the API silently ignores, we expose *style presets* which
// inject descriptors into the prompt — that's what actually controls the
// final aesthetic regardless of which underlying model serves the request.
const STYLES: { value: 'auto' | 'realistic' | 'anime' | 'cinematic' | '3d-render' | 'oil-painting' | 'watercolor'; label: string; hint: string }[] = [
  { value: 'auto', label: 'Auto (no style hint)', hint: 'Let the model choose based on prompt' },
  { value: 'realistic', label: 'Photorealistic', hint: '35mm, natural lighting, lifelike' },
  { value: 'anime', label: 'Anime / Manga', hint: 'Cel shading, vibrant 2D art' },
  { value: 'cinematic', label: 'Cinematic film', hint: 'Dramatic lighting, anamorphic' },
  { value: '3d-render', label: '3D render', hint: 'Octane / Blender ray-traced look' },
  { value: 'oil-painting', label: 'Oil painting', hint: 'Rich brush strokes, classical' },
  { value: 'watercolor', label: 'Watercolor', hint: 'Soft washes, paper texture' }
];

const SOURCES: { value: ImageSource; label: string; hint: string }[] = [
  { value: 'auto', label: 'Auto (recommended)', hint: 'Pollinations → Flickr → Picsum (Lexica skipped — currently down)' },
  { value: 'pollinations', label: 'Pollinations AI (true generative)', hint: 'Best quality, sometimes rate-limited' },
  { value: 'lexica', label: 'Lexica catalog (curated AI)', hint: 'Pre-generated AI art — currently 5xx-flaky' },
  { value: 'flickr', label: 'Flickr photos (keyword-relevant)', hint: 'Real photos matching your keywords' },
  { value: 'picsum', label: 'Stock photo (random)', hint: 'Random photo, no AI — last-resort' }
];

export function MediaPanel({ onAddImage, onAddVideo }: Props) {
  const [prompt, setPrompt] = useState('');
  const [style, setStyle] = useState<typeof STYLES[number]['value']>('auto');
  const [source, setSource] = useState<ImageSource>('auto');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  // Video import progress: when a user uploads an MP4/WebM we read the
  // full file as a data URL (so the project library can persist it) and
  // extract a poster frame for the timeline thumbnail. The progress bar
  // surfaces work so users with longer videos don't think the page froze.
  const [videoProgress, setVideoProgress] = useState<{
    name: string;
    pct: number; // 0..100
    stage: string;
  } | null>(null);

  async function handleGenerate(p: string) {
    if (!p.trim()) return;
    setBusy(true);
    setError(null);
    setStatus('Generating…');
    let sanitizedNote: string | null = null;
    try {
      const url = await generateImage({
        prompt: p,
        style,
        source,
        onAttempt: (label, attempt) => {
          if (attempt === 0 && label.startsWith('sanitized:')) {
            // Prompt-rewrite notice. Surface it so the user understands
            // why "batman" came out as a generic vigilante.
            sanitizedNote = label.replace(/^sanitized:\s*/, '');
            setStatus(`Rewrote trademarked term → "${sanitizedNote}…"`);
            return;
          }
          setStatus(
            attempt <= 1
              ? `Generating via ${label}…`
              : `Retrying via ${label} (attempt ${attempt})…`
          );
        }
      });
      onAddImage(url, p);
      setStatus(sanitizedNote ? `Done. Prompt was sanitized for content filters.` : '');
    } catch (e) {
      setError((e as Error).message);
      setStatus('');
    } finally {
      setBusy(false);
    }
  }

  function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;
    const list = Array.from(files);
    // Process sequentially so videos don't all hammer the decoder in
    // parallel. Images go in immediately; videos go through the frame
    // extractor.
    (async () => {
      for (const f of list) {
        try {
          if (f.type.startsWith('video/')) {
            await importVideoFile(f);
          } else if (f.type.startsWith('image/')) {
            await importImageFile(f);
          } else {
            // Fall back to image — some browsers don't reliably set the
            // MIME type for HEIC etc., but the <img> tag will reject if it
            // can't decode.
            await importImageFile(f);
          }
        } catch (err) {
          setError(
            `Couldn't import "${f.name}": ${(err as Error).message ?? 'Unknown error'}`
          );
        }
      }
    })().finally(() => {
      // Reset the file input so re-selecting the same file fires onChange.
      e.target.value = '';
    });
  }

  function importImageFile(file: File): Promise<void> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error ?? new Error('read-failed'));
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          onAddImage(reader.result);
          resolve();
        } else {
          reject(new Error('Unexpected file reader result.'));
        }
      };
      reader.readAsDataURL(file);
    });
  }

  async function importVideoFile(file: File): Promise<void> {
    setError(null);
    setVideoProgress({ name: file.name, pct: 10, stage: 'Reading file…' });
    try {
      // Use a blob: URL instead of a base64 data URL. Reading a 50 MB video
      // as a data URL bloats it to ~67 MB of in-memory string and makes the
      // tab feel locked up for several seconds. Blob URLs reference the
      // underlying File without copying bytes — near-instant, and the
      // browser streams the video from disk on demand.
      //
      // Tradeoff: blob URLs die on page reload, so projects saved with
      // video clips currently re-load with a missing video source. That's
      // a session-scope limitation we'll fix with proper File persistence
      // in IndexedDB later (tracked in BACKLOG).
      const videoSrc = URL.createObjectURL(file);
      setVideoProgress({ name: file.name, pct: 50, stage: 'Capturing thumbnail…' });
      const { poster, duration } = await extractVideoPoster(file, { maxDimension: 1080 });
      onAddVideo({
        videoSrc,
        poster,
        duration,
        name: file.name
      });
      setVideoProgress({ name: file.name, pct: 100, stage: 'Done' });
    } finally {
      setVideoProgress(null);
    }
  }

  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
          AI Image Generator
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Free & key-less. Auto cascades Pollinations → Lexica → stock photo so you always get an image.
        </Typography>
      </Box>

      <TextField
        label="Describe your scene"
        placeholder="e.g. cinematic neon city street, vertical 9:16, ultra detailed"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        multiline
        minRows={2}
        fullWidth
        size="small"
      />

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
        <TextField
          select
          size="small"
          label="Source"
          value={source}
          onChange={(e) => setSource(e.target.value as ImageSource)}
          sx={{ flex: 1 }}
          helperText={SOURCES.find((s) => s.value === source)?.hint}
        >
          {SOURCES.map((s) => (
            <MenuItem key={s.value} value={s.value}>
              {s.label}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label="Style"
          value={style}
          onChange={(e) => setStyle(e.target.value as typeof STYLES[number]['value'])}
          disabled={source === 'picsum'}
          sx={{ flex: 1 }}
          helperText={
            source === 'picsum'
              ? 'N/A for stock photos'
              : (STYLES.find((s) => s.value === style)?.hint ?? 'Style preset')
          }
        >
          {STYLES.map((s) => (
            <MenuItem key={s.value} value={s.value}>
              {s.label}
            </MenuItem>
          ))}
        </TextField>
      </Stack>

      <Button
        variant="contained"
        startIcon={busy ? <CircularProgress size={18} color="inherit" /> : <AutoAwesomeIcon />}
        onClick={() => handleGenerate(prompt)}
        disabled={busy || !prompt.trim()}
      >
        {busy ? 'Generating…' : 'Generate Image'}
      </Button>

      {status && !error && (
        <Typography variant="caption" color="text.secondary">
          {status}
        </Typography>
      )}

      {error && (
        <Typography variant="caption" color="error">
          {error}
        </Typography>
      )}

      <Box>
        <Typography variant="caption" color="text.secondary">
          Trending presets
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 0.5 }}>
          {TRENDING_PROMPTS.map((p) => (
            <Chip
              key={p.label}
              label={p.label}
              size="small"
              onClick={() => {
                setPrompt(p.prompt);
                handleGenerate(p.prompt);
              }}
              disabled={busy}
              sx={{ cursor: 'pointer' }}
            />
          ))}
        </Box>
      </Box>

      <Box sx={{ borderTop: '1px solid rgba(255,255,255,0.08)', pt: 2 }}>
        <Stack spacing={1.25}>
          <Button
            component="label"
            variant="outlined"
            startIcon={
              videoProgress ? (
                <CircularProgress size={18} color="inherit" />
              ) : (
                <UploadFileIcon />
              )
            }
            fullWidth
            disabled={!!videoProgress}
          >
            {videoProgress
              ? `${videoProgress.stage} — ${videoProgress.name}`
              : 'Upload image(s) or video'}
            <input
              type="file"
              accept="image/*,video/*"
              hidden
              multiple
              onChange={handleUpload}
            />
          </Button>

          {videoProgress && (
            <Box>
              <LinearProgress
                variant="determinate"
                value={videoProgress.pct}
                sx={{ height: 6, borderRadius: 3 }}
              />
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: 'block', mt: 0.5 }}
              >
                {`${videoProgress.stage} (${videoProgress.pct}%)`}
              </Typography>
            </Box>
          )}

          <Stack
            direction="row"
            spacing={0.75}
            alignItems="center"
            sx={{ color: 'text.secondary' }}
          >
            <MovieFilterRoundedIcon sx={{ fontSize: 16, opacity: 0.7 }} />
            <Typography variant="caption">
              Videos are sampled into evenly-spaced frames so every clip still
              gets effects, captions and transitions. MP4/WebM work best.
            </Typography>
          </Stack>
        </Stack>
      </Box>
    </Stack>
  );
}
