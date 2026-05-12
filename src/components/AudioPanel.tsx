import {
  Box,
  Button,
  IconButton,
  MenuItem,
  Slider,
  Stack,
  TextField,
  Tooltip,
  Typography
} from '@mui/material';
import MusicNoteIcon from '@mui/icons-material/MusicNote';
import HeadphonesIcon from '@mui/icons-material/Headphones';
import ClearIcon from '@mui/icons-material/Clear';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import type { ProjectAudio } from '../types';

interface Props {
  audio: ProjectAudio;
  onChange: (audio: ProjectAudio) => void;
  /** Called when user clicks "Restart" — host should rewind playhead to 0. */
  onRestart?: () => void;
  /**
   * 'main' (default) renders the full transcript-capable panel with the
   * Loop / Fit-video / Fit-audio sync modes. 'background' renders a slim
   * panel for the secondary track — only volume, trim, and a Loop/Play-once
   * choice. Background tracks are never transcribed and never drive
   * project duration; they just mix in alongside the main audio so the user
   * can layer royalty-free music with their voiceover to avoid copyright
   * strikes.
   */
  role?: 'main' | 'background';
}

/** Format a seconds value as `m:ss.t` for compact captions. */
function fmt(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

export function AudioPanel({ audio, onChange, onRestart, role = 'main' }: Props) {
  const isBackground = role === 'background';
  function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        // Reset trim state so the analyzer can fill in fresh metadata.
        onChange({
          ...audio,
          src: reader.result,
          name: f.name,
          start: 0,
          end: null,
          duration: null
        });
      }
    };
    reader.readAsDataURL(f);
    e.target.value = '';
  }

  // The trim slider needs concrete bounds. While the audio is still being
  // analyzed (`duration === null`) we hide the slider and show a hint.
  const dur = audio.duration ?? 0;
  const start = audio.start;
  const end = audio.end ?? dur;
  const trimRange = Math.max(0, end - start);

  return (
    <Stack spacing={1.5}>
      <Stack direction="row" spacing={0.75} alignItems="center">
        {isBackground ? (
          <HeadphonesIcon fontSize="small" sx={{ color: '#22d3ee' }} />
        ) : (
          <MusicNoteIcon fontSize="small" sx={{ color: '#a78bfa' }} />
        )}
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          {isBackground ? 'Background audio' : 'Audio'}
        </Typography>
      </Stack>
      <Typography variant="caption" color="text.secondary">
        {isBackground
          ? 'Optional second track that plays in parallel — add a royalty-free music bed to avoid copyright strikes. Not used for transcription.'
          : 'Upload a track, then trim and choose how it syncs with the video.'}
      </Typography>

      <Stack direction="row" spacing={1}>
        <Button
          component="label"
          variant="outlined"
          startIcon={isBackground ? <HeadphonesIcon /> : <MusicNoteIcon />}
          fullWidth
        >
          {audio.src
            ? 'Replace track'
            : isBackground
              ? 'Add background music'
              : 'Upload audio'}
          <input
            type="file"
            accept="audio/*"
            hidden
            onChange={handleUpload}
          />
        </Button>
        {audio.src && (
          <Button
            color="error"
            variant="outlined"
            onClick={() =>
              onChange({
                ...audio,
                src: null,
                name: '',
                start: 0,
                end: null,
                duration: null
              })
            }
            startIcon={<ClearIcon />}
          >
            Remove
          </Button>
        )}
      </Stack>

      {audio.src && (
        <Box>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="caption" color="text.secondary" noWrap sx={{ flex: 1 }}>
              {audio.name || 'Track loaded'}
            </Typography>
            {onRestart && (
              <Tooltip title="Restart audio from selected start">
                <IconButton size="small" onClick={onRestart}>
                  <RestartAltIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
          </Stack>
          <audio src={audio.src} controls style={{ width: '100%', marginTop: 6 }} />

          {/* Volume */}
          <Box mt={1}>
            <Typography variant="caption" color="text.secondary">
              Volume: {Math.round(audio.volume * 100)}%
            </Typography>
            <Slider
              size="small"
              min={0}
              max={1}
              step={0.05}
              value={audio.volume}
              onChange={(_, v) => onChange({ ...audio, volume: v as number })}
            />
          </Box>

          {/* Trim window */}
          <Box mt={1}>
            <Typography variant="caption" color="text.secondary">
              Trim:&nbsp;
              {dur > 0
                ? `${fmt(start)} \u2013 ${fmt(end)}  (${fmt(trimRange)})`
                : 'Analyzing track\u2026'}
            </Typography>
            {dur > 0 && (
              <Slider
                size="small"
                min={0}
                max={dur}
                step={0.05}
                value={[start, end]}
                onChange={(_, v) => {
                  const arr = v as number[];
                  // Enforce ordering and a minimum 0.5s window so the slider
                  // can't collapse to zero (which would silence playback).
                  let s = Math.max(0, Math.min(arr[0], dur - 0.5));
                  let e = Math.max(s + 0.5, Math.min(arr[1], dur));
                  onChange({ ...audio, start: s, end: e });
                }}
                disableSwap
              />
            )}
          </Box>

          {/* Sync mode */}
          <Box mt={1}>
            {isBackground ? (
              <TextField
                select
                size="small"
                fullWidth
                label="Background behavior"
                value={audio.syncMode === 'loop' ? 'loop' : 'fitAudio'}
                onChange={(e) =>
                  onChange({
                    ...audio,
                    // Background only supports loop or play-once. Storing as
                    // ProjectAudio['syncMode'] keeps the export logic uniform.
                    syncMode: e.target.value as ProjectAudio['syncMode']
                  })
                }
                helperText={
                  audio.syncMode === 'loop'
                    ? 'Loops the trimmed range until the video ends.'
                    : 'Plays the trimmed range once, then goes silent.'
                }
              >
                <MenuItem value="loop">Loop until video ends</MenuItem>
                <MenuItem value="fitAudio">Play once (no loop)</MenuItem>
              </TextField>
            ) : (
              <TextField
                select
                size="small"
                fullWidth
                label="Sync with video"
                value={audio.syncMode}
                onChange={(e) =>
                  onChange({
                    ...audio,
                    syncMode: e.target.value as ProjectAudio['syncMode']
                  })
                }
                helperText={
                  audio.syncMode === 'loop'
                    ? 'Audio loops to fill the video length.'
                    : audio.syncMode === 'fitVideo'
                      ? 'Video stretches to match the audio trim length.'
                      : 'Audio plays once across the trimmed range; video keeps its own length.'
                }
              >
                <MenuItem value="loop">Loop audio to video</MenuItem>
                <MenuItem value="fitVideo">Fit video to audio length</MenuItem>
                <MenuItem value="fitAudio">Play audio once (no loop)</MenuItem>
              </TextField>
            )}
          </Box>
        </Box>
      )}
    </Stack>
  );
}
