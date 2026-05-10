import { useState } from 'react';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  MenuItem,
  Stack,
  TextField,
  Typography
} from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import { generateImage, TRENDING_PROMPTS, type ImageSource } from '../engine/ai';

interface Props {
  onAddImage: (src: string, prompt?: string) => void;
}

const MODELS = [
  { value: 'flux', label: 'Flux (default)' },
  { value: 'flux-realism', label: 'Flux Realism' },
  { value: 'flux-anime', label: 'Flux Anime' },
  { value: 'turbo', label: 'Turbo (fastest)' }
];

const SOURCES: { value: ImageSource; label: string; hint: string }[] = [
  { value: 'auto', label: 'Auto (recommended)', hint: 'Pollinations → Lexica → Flickr → Picsum' },
  { value: 'pollinations', label: 'Pollinations AI (true generative)', hint: 'Best quality, sometimes rate-limited' },
  { value: 'lexica', label: 'Lexica catalog (curated AI)', hint: 'Pre-generated AI art, very reliable' },
  { value: 'flickr', label: 'Flickr photos (keyword-relevant)', hint: 'Real photos matching your keywords' },
  { value: 'picsum', label: 'Stock photo (random)', hint: 'Random photo, no AI — last-resort' }
];

export function MediaPanel({ onAddImage }: Props) {
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState('flux');
  const [source, setSource] = useState<ImageSource>('auto');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate(p: string) {
    if (!p.trim()) return;
    setBusy(true);
    setError(null);
    setStatus('Generating…');
    let sanitizedNote: string | null = null;
    try {
      const url = await generateImage({
        prompt: p,
        model,
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
    Array.from(files).forEach((f) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') onAddImage(reader.result);
      };
      reader.readAsDataURL(f);
    });
    e.target.value = '';
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

      <Stack direction="row" spacing={1}>
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
          label="Model"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          disabled={source !== 'auto' && source !== 'pollinations'}
          sx={{ flex: 1 }}
          helperText={
            source === 'lexica' || source === 'picsum' || source === 'flickr'
              ? 'N/A for this source'
              : 'Pollinations model'
          }
        >
          {MODELS.map((m) => (
            <MenuItem key={m.value} value={m.value}>
              {m.label}
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
        <Button
          component="label"
          variant="outlined"
          startIcon={<UploadFileIcon />}
          fullWidth
        >
          Upload your own image(s)
          <input type="file" accept="image/*" hidden multiple onChange={handleUpload} />
        </Button>
      </Box>
    </Stack>
  );
}
