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
import SubtitlesIcon from '@mui/icons-material/Subtitles';
import { exportVideo, type ExportProgress, type ExportResult } from '../engine/export';
import { totalDuration } from '../engine/render';
import { filterFillerWords, buildCues, cuesToSRT } from '../engine/captionText';
import { ASPECT_RATIOS, type ProjectState } from '../types';

interface Props {
  project: ProjectState;
  /**
   * Visual variant.
   *  - 'hero' (default): full-width gradient button with a moving sheen,
   *    designed to sit just below the preview as the primary call-to-action.
   *  - 'compact': dense pill that fits a toolbar / header row.
   * Both variants open the exact same export dialog.
   */
  variant?: 'hero' | 'compact';
  /** Override the displayed label. Useful for compact mode ("Export"). */
  label?: string;
}

export function ExportButton({ project, variant = 'hero', label }: Props) {
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
  const isHero = variant === 'hero';
  const buttonText = label ?? (busy ? 'Rendering…' : 'Render & Download');

  // Animated sheen for the hero variant. A gradient ~3x the button's width
  // slides horizontally on an infinite loop, giving the CTA a premium
  // "this is the action" feel without distracting from the preview.
  const heroSx = isHero
    ? {
        width: '100%',
        py: 1.4,
        fontSize: '1rem',
        fontWeight: 700,
        letterSpacing: 0.4,
        borderRadius: 2.5,
        color: '#fff',
        textTransform: 'none',
        position: 'relative',
        overflow: 'hidden',
        backgroundImage:
          'linear-gradient(90deg, #7c3aed 0%, #22d3ee 33%, #ff3ea5 66%, #7c3aed 100%)',
        backgroundSize: '300% 100%',
        boxShadow: '0 10px 28px rgba(124,58,237,0.35), 0 0 0 1px rgba(255,255,255,0.06) inset',
        animation: 'cta-shimmer 6s linear infinite',
        '@keyframes cta-shimmer': {
          '0%': { backgroundPosition: '0% 50%' },
          '100%': { backgroundPosition: '300% 50%' }
        },
        '&:hover': {
          backgroundImage:
            'linear-gradient(90deg, #7c3aed 0%, #22d3ee 33%, #ff3ea5 66%, #7c3aed 100%)',
          filter: 'brightness(1.08)',
          boxShadow: '0 12px 32px rgba(124,58,237,0.5), 0 0 0 1px rgba(255,255,255,0.1) inset'
        },
        '&:focus-visible': {
          outline: '2px solid #fff',
          outlineOffset: 2
        },
        '&.Mui-disabled': {
          color: 'rgba(255,255,255,0.55)',
          opacity: 0.55
        }
      }
    : {
        textTransform: 'none' as const
      };

  return (
    <>
      <Button
        variant="contained"
        size={isHero ? 'large' : 'medium'}
        startIcon={busy ? <CircularProgress size={isHero ? 20 : 16} color="inherit" /> : <MovieFilterIcon />}
        onClick={handleExport}
        disabled={disabled || busy}
        aria-label={busy ? 'Rendering video' : 'Render and download video'}
        sx={heroSx}
      >
        {buttonText}
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
                  // Preview box matches the project's aspect ratio so a 16:9
                  // export doesn't get squished into a 9:16 thumbnail.
                  width: project.width >= project.height ? 320 : 200,
                  aspectRatio: ASPECT_RATIOS[project.aspectRatio].css,
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
              {/*
                Sidecar SRT download. Always offered when there's a script,
                but especially useful when the user disabled "Burn-in" so
                the video file ships without burned captions.
              */}
              {project.script.text.trim() && (
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<SubtitlesIcon />}
                  onClick={() => {
                    const filtered = filterFillerWords(
                      project.script.text,
                      project.script.wordTimes,
                      project.script.wordEnds,
                      !!project.script.filterFillers,
                      project.script.customFillers ?? []
                    );
                    const cues = buildCues(
                      filtered.words,
                      filtered.wordTimes,
                      filtered.wordEnds,
                      Math.max(1, totalDuration(project.clips))
                    );
                    const blob = new Blob([cuesToSRT(cues)], {
                      type: 'text/plain;charset=utf-8'
                    });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = result.filename.replace(/\.[^.]+$/, '') + '.srt';
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                  }}
                >
                  Download .srt sidecar
                </Button>
              )}
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
