import { useEffect, useState } from 'react';
import { Box, LinearProgress, Stack, Typography } from '@mui/material';
import CloudUploadRoundedIcon from '@mui/icons-material/CloudUploadRounded';
import { extractVideoFrames } from '../engine/videoFrames';

interface Props {
  /** Called once per accepted image with its data URL + filename. */
  onImage: (dataUrl: string, name: string) => void;
  /** Called with audio data URL + filename when an audio file is dropped. */
  onAudio?: (dataUrl: string, name: string) => void;
}

/**
 * Whole-window drag-and-drop overlay. Only renders the visual on a real drag-over
 * with files; otherwise it's an invisible event sink so nothing is intercepted.
 */
export function DropZone({ onImage, onAudio }: Props) {
  const [active, setActive] = useState(false);
  // When a video is being processed we show an overlay with progress so the
  // user knows the drop succeeded even after the drag-over visual fades.
  const [videoStatus, setVideoStatus] = useState<{
    name: string;
    pct: number;
    captured: number;
    total: number;
  } | null>(null);

  useEffect(() => {
    let dragCounter = 0;

    function hasFiles(e: DragEvent) {
      return Array.from(e.dataTransfer?.types ?? []).includes('Files');
    }
    function onDragEnter(e: DragEvent) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragCounter++;
      setActive(true);
    }
    function onDragLeave(e: DragEvent) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragCounter = Math.max(0, dragCounter - 1);
      if (dragCounter === 0) setActive(false);
    }
    function onDragOver(e: DragEvent) {
      if (!hasFiles(e)) return;
      e.preventDefault();
    }
    async function onDrop(e: DragEvent) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragCounter = 0;
      setActive(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      for (const f of files) {
        try {
          if (f.type.startsWith('video/')) {
            setVideoStatus({ name: f.name, pct: 0, captured: 0, total: 0 });
            const frames = await extractVideoFrames(f, {
              secondsPerFrame: 3,
              minFrames: 2,
              maxFrames: 20,
              maxDimension: 1080,
              onProgress: (p, captured, total) =>
                setVideoStatus({
                  name: f.name,
                  pct: Math.round(p * 100),
                  captured,
                  total
                })
            });
            for (const frame of frames) {
              onImage(
                frame.dataUrl,
                `${f.name} @ ${frame.sourceTime.toFixed(1)}s`
              );
            }
          } else if (f.type.startsWith('image/')) {
            const url = await fileToDataUrl(f);
            onImage(url, f.name);
          } else if (f.type.startsWith('audio/') && onAudio) {
            const url = await fileToDataUrl(f);
            onAudio(url, f.name);
          }
        } catch {
          // ignore individual file failures — the user can re-try from the
          // sidebar where errors are surfaced inline.
        } finally {
          setVideoStatus(null);
        }
      }
    }

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [onImage, onAudio]);

  if (!active && !videoStatus) return null;
  return (
    <Box
      sx={{
        position: 'fixed',
        inset: 0,
        zIndex: 2000,
        backdropFilter: 'blur(6px)',
        background:
          'radial-gradient(60% 60% at 50% 50%, rgba(124,58,237,0.35), rgba(0,0,0,0.65))',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none'
      }}
    >
      <Stack
        spacing={1.5}
        alignItems="center"
        sx={{
          px: 6,
          py: 5,
          borderRadius: 4,
          border: '2px dashed rgba(167,139,250,0.7)',
          background: 'rgba(16,16,30,0.85)',
          boxShadow: '0 20px 60px rgba(124,58,237,0.4)',
          minWidth: 320
        }}
      >
        <CloudUploadRoundedIcon sx={{ fontSize: 56, color: '#a78bfa' }} />
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          {videoStatus ? 'Importing video\u2026' : 'Drop to add'}
        </Typography>
        {videoStatus ? (
          <Stack spacing={1} sx={{ width: '100%' }}>
            <LinearProgress
              variant="determinate"
              value={videoStatus.pct}
              sx={{ height: 6, borderRadius: 3 }}
            />
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ textAlign: 'center' }}
            >
              {videoStatus.total > 0
                ? `Captured ${videoStatus.captured} of ${videoStatus.total} frames`
                : `Decoding ${videoStatus.name}\u2026`}
            </Typography>
          </Stack>
        ) : (
          <Typography variant="body2" color="text.secondary">
            Images & videos become clips • Audio replaces the soundtrack
          </Typography>
        )}
      </Stack>
    </Box>
  );
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error ?? new Error('read-failed'));
    r.onload = () => resolve(r.result as string);
    r.readAsDataURL(file);
  });
}
