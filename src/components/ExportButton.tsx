import { useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Stack,
  Typography
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import MovieFilterIcon from '@mui/icons-material/MovieFilter';
import { exportVideo, type ExportProgress, type ExportResult } from '../engine/export';
import type { ProjectState } from '../types';

interface Props {
  project: ProjectState;
}

export function ExportButton({ project }: Props) {
  const [open, setOpen] = useState(false);
  const [progress, setProgress] = useState<ExportProgress>({
    phase: 'preparing',
    progress: 0
  });
  const [result, setResult] = useState<ExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleExport() {
    setBusy(true);
    setError(null);
    setResult(null);
    setOpen(true);
    setProgress({ phase: 'preparing', progress: 0, message: 'Preparing…' });
    try {
      const r = await exportVideo({
        project,
        onProgress: (p) => setProgress(p)
      });
      setResult(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const disabled = project.clips.length === 0;

  return (
    <>
      <Button
        variant="contained"
        size="large"
        startIcon={busy ? <CircularProgress size={18} color="inherit" /> : <MovieFilterIcon />}
        onClick={handleExport}
        disabled={disabled || busy}
      >
        {busy ? 'Rendering…' : 'Render & Download'}
      </Button>

      <Dialog
        open={open}
        onClose={() => !busy && setOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Exporting your Short</DialogTitle>
        <DialogContent>
          {error && (
            <Typography color="error" variant="body2">
              {error}
            </Typography>
          )}
          {!error && !result && (
            <Stack spacing={2}>
              <Typography variant="body2" color="text.secondary">
                {progress.message ?? 'Working…'}
              </Typography>
              <LinearProgress
                variant="determinate"
                value={Math.round(progress.progress * 100)}
              />
              <Typography variant="caption" color="text.secondary">
                Recording happens in real-time so playback stays in sync with audio.
                Please keep this tab focused.
              </Typography>
            </Stack>
          )}
          {result && (
            <Stack spacing={2} alignItems="center">
              <Box
                sx={{
                  width: 200,
                  aspectRatio: '9 / 16',
                  borderRadius: 2,
                  overflow: 'hidden',
                  border: '1px solid rgba(255,255,255,0.1)'
                }}
              >
                <video
                  src={result.url}
                  controls
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              </Box>
              <Typography variant="caption" color="text.secondary">
                {result.mimeType} • {result.durationSec.toFixed(1)}s •{' '}
                {(result.blob.size / (1024 * 1024)).toFixed(1)} MB
              </Typography>
              <Button
                variant="contained"
                startIcon={<DownloadIcon />}
                href={result.url}
                download={result.filename}
              >
                Download {result.filename}
              </Button>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)} disabled={busy}>
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
