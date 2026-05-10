import { useEffect, useState } from 'react';
import { Box, Stack, Typography } from '@mui/material';
import CloudUploadRoundedIcon from '@mui/icons-material/CloudUploadRounded';

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
          const url = await fileToDataUrl(f);
          if (f.type.startsWith('image/')) {
            onImage(url, f.name);
          } else if (f.type.startsWith('audio/') && onAudio) {
            onAudio(url, f.name);
          }
        } catch {
          // ignore individual file failures
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

  if (!active) return null;
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
          boxShadow: '0 20px 60px rgba(124,58,237,0.4)'
        }}
      >
        <CloudUploadRoundedIcon sx={{ fontSize: 56, color: '#a78bfa' }} />
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          Drop to add
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Images become clips • Audio replaces the soundtrack
        </Typography>
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
