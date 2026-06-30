import { useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  IconButton,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography
} from '@mui/material';
import UploadIcon from '@mui/icons-material/Upload';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import ClearIcon from '@mui/icons-material/Clear';
import { generateImage } from '../engine/ai';
import type { ImageClip, SplitMode } from '../types';

interface Props {
  clip: ImageClip;
  onChange: (patch: Partial<ImageClip>) => void;
}

/**
 * Compact split-screen editor that lives inside the Timeline clip-settings
 * panel. Lets the user attach a second image to a clip so the renderer
 * draws both side-by-side (or stacked). Sources:
 *   - Upload a local image file (data URL).
 *   - Generate one with the AI image pipeline using a short prompt.
 * The two halves share the clip's motion effect so they animate in sync.
 */
export function SplitScreenPanel({ clip, onChange }: Props) {
  const enabled = !!(clip.splitMode && clip.splitMode !== 'none');
  const [prompt, setPrompt] = useState(clip.splitPrompt ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        onChange({
          splitSrc: reader.result,
          splitMode: clip.splitMode && clip.splitMode !== 'none' ? clip.splitMode : 'horizontal'
        });
      }
    };
    reader.readAsDataURL(f);
    e.target.value = '';
  }

  async function handleGenerate() {
    const p = prompt.trim();
    if (!p) {
      setErr('Enter a prompt for the second image.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const src = await generateImage({ prompt: p });
      onChange({
        splitSrc: src,
        splitPrompt: p,
        splitMode: clip.splitMode && clip.splitMode !== 'none' ? clip.splitMode : 'horizontal'
      });
    } catch (e) {
      setErr((e as Error).message || 'Generation failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box
      sx={{
        border: '1px dashed rgba(255,255,255,0.16)',
        borderRadius: 2,
        p: 1.5,
        background: 'rgba(34, 211, 238, 0.04)'
      }}
    >
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Box>
          <Typography variant="caption" sx={{ fontWeight: 700, letterSpacing: 0.3 }}>
            Split screen
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block">
            Two images sharing one frame, animated together.
          </Typography>
        </Box>
        <Switch
          size="small"
          checked={enabled}
          onChange={(_, v) => {
            if (v) {
              onChange({ splitMode: clip.splitMode && clip.splitMode !== 'none' ? clip.splitMode : 'horizontal' });
            } else {
              onChange({ splitMode: 'none' });
            }
          }}
        />
      </Stack>

      {enabled && (
        <Stack spacing={1.25} mt={1.25}>
          <TextField
            select
            size="small"
            label="Layout"
            value={clip.splitMode ?? 'horizontal'}
            onChange={(e) => onChange({ splitMode: e.target.value as SplitMode })}
          >
            <MenuItem value="horizontal">Side by side (left / right)</MenuItem>
            <MenuItem value="vertical">Stacked (top / bottom)</MenuItem>
          </TextField>

          {/* Preview of the second image with quick-clear. */}
          {clip.splitSrc && (
            <Stack direction="row" spacing={1} alignItems="center">
              <Box
                sx={{
                  width: 64,
                  height: 64,
                  borderRadius: 1.5,
                  overflow: 'hidden',
                  border: '1px solid rgba(255,255,255,0.12)',
                  flex: '0 0 auto'
                }}
              >
                <img
                  src={clip.splitSrc}
                  alt=""
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              </Box>
              <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
                Second image attached. Both panels animate with the clip's effect.
              </Typography>
              <Tooltip title="Remove second image">
                <IconButton
                  size="small"
                  onClick={() => onChange({ splitSrc: undefined, splitPrompt: undefined })}
                >
                  <ClearIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
          )}

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <Button
              component="label"
              variant="outlined"
              size="small"
              startIcon={<UploadIcon />}
              fullWidth
            >
              Upload image
              <input
                type="file"
                accept="image/*"
                hidden
                onChange={handleUpload}
              />
            </Button>
          </Stack>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'stretch' }}>
            <TextField
              size="small"
              fullWidth
              placeholder="e.g. cinematic alley with neon signs at night"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !busy) handleGenerate();
              }}
            />
            <Button
              variant="contained"
              size="small"
              onClick={handleGenerate}
              disabled={busy || !prompt.trim()}
              startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <AutoFixHighIcon />}
              sx={{ minWidth: 120 }}
            >
              {busy ? 'Generating' : 'AI Generate'}
            </Button>
          </Stack>

          {err && (
            <Typography variant="caption" color="error.main">
              {err}
            </Typography>
          )}
        </Stack>
      )}
    </Box>
  );
}
