import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Divider,
  IconButton,
  LinearProgress,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography
} from '@mui/material';
import CasinoIcon from '@mui/icons-material/Casino';
import RecordVoiceOverIcon from '@mui/icons-material/RecordVoiceOver';
import EditNoteIcon from '@mui/icons-material/EditNote';
import RefreshIcon from '@mui/icons-material/Refresh';
import {
  CAPTION_ANIM_GROUPS,
  CAPTION_ANIM_LABELS,
  type CaptionAnimationId,
  type ProjectScript
} from '../types';
import { newCaptionSeed } from '../engine/captionAi';
import type { STTProgress } from '../engine/speechToText';

interface Props {
  script: ProjectScript;
  onChange: (script: ProjectScript) => void;
  /** True when the project has audio loaded — enables transcribe + audio peaks. */
  hasAudio: boolean;
  /** True when audio peak analysis is available — enables 'audio' sync. */
  hasPeaks: boolean;
  /**
   * Option A: run Whisper on the audio to extract a script with exact
   * per-word timestamps. Owner runs the actual STT call.
   */
  onTranscribe?: () => void;
  /**
   * Option B: take whatever text the user already pasted and align it to
   * the audio (using audio peaks) — also stretches the video to match the
   * audio length so captions don't race ahead of the spoken words.
   */
  onSyncPastedScript?: () => void;
  /**
   * Drop the cached Whisper model + retry. Shown when transcription fails
   * with a session-creation error (likely a corrupt cached shard).
   */
  onClearCache?: () => void;
  /** True while transcription is in progress. */
  transcribing?: boolean;
  /** Latest progress event from the transcriber. */
  transcribeProgress?: STTProgress | null;
  /** Last transcription error (if any) — surfaces the cache-clear button. */
  transcribeError?: string | null;
}

interface AnimOption {
  id: CaptionAnimationId;
  label: string;
  group: string;
}

const ANIM_OPTIONS: AnimOption[] = CAPTION_ANIM_GROUPS.flatMap((g) =>
  g.animations.map((id) => ({ id, label: CAPTION_ANIM_LABELS[id], group: g.label }))
);

/**
 * Project-wide script (transcript) editor.
 *
 * Two clear paths:
 *   A. **Auto-transcribe** — Whisper runs locally and lifts the script
 *      with exact per-word timestamps from the audio.
 *   B. **Use my own script** — paste text, click "Sync pasted text to
 *      audio" to align word reveals with audio peaks and stretch the video
 *      to the audio length so captions don't race ahead.
 */
export function ScriptPanel({
  script,
  onChange,
  hasAudio,
  hasPeaks,
  onTranscribe,
  onSyncPastedScript,
  onClearCache,
  transcribing,
  transcribeProgress,
  transcribeError
}: Props) {
  const animValue =
    ANIM_OPTIONS.find((o) => o.id === script.animation) ?? ANIM_OPTIONS[0];
  const hasTranscript =
    script.syncMode === 'transcript' && (script.wordTimes?.length ?? 0) > 0;
  const hasPastedText = script.text.trim().length > 0 && !hasTranscript;

  // Compose a friendly status line for the loader. First-time users wait on
  // the model download (~50MB), so we want a clear progress indicator.
  let progressText = '';
  let progressValue: number | undefined;
  if (transcribing && transcribeProgress) {
    if (transcribeProgress.stage === 'load-model') {
      const pct =
        transcribeProgress.progress != null
          ? ` ${Math.round(transcribeProgress.progress * 100)}%`
          : '';
      progressText = `Loading speech model${pct}\u2026 (one-time, ~50MB)`;
      progressValue = transcribeProgress.progress;
    } else if (transcribeProgress.stage === 'decode-audio') {
      progressText = 'Decoding audio\u2026';
    } else if (transcribeProgress.stage === 'transcribe') {
      progressText = 'Transcribing speech\u2026';
    }
  }

  // Detect cache-corruption errors so we can offer a one-click cleanup.
  const errorIsRetryable =
    !!transcribeError &&
    /create a session|qdq_actions|MatMulNBits|missing required scale/i.test(
      transcribeError
    );

  return (
    <Stack spacing={1.5}>
      <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
        Video script
      </Typography>
      <Typography variant="caption" color="text.secondary">
        Pick one of the two options below. Words appear across the whole
        video so captions aren't stuck on one frame.
      </Typography>

      {/* ============== OPTION A: Auto-transcribe ============== */}
      <Box
        sx={{
          p: 1.25,
          borderRadius: 2,
          border: '1px solid rgba(124,58,237,0.35)',
          background:
            'linear-gradient(135deg, rgba(124,58,237,0.10), rgba(34,211,238,0.05))'
        }}
      >
        <Stack direction="row" spacing={1} alignItems="center" mb={0.5}>
          <RecordVoiceOverIcon sx={{ color: '#a78bfa' }} fontSize="small" />
          <Typography variant="caption" sx={{ fontWeight: 700 }}>
            Option A &mdash; Auto-transcribe audio
          </Typography>
        </Stack>
        <Typography variant="caption" color="text.secondary" display="block" mb={1}>
          Best accuracy. Whisper runs in your browser and produces a script with
          exact per-word timing.
        </Typography>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
          <Button
            variant="contained"
            size="small"
            startIcon={<RecordVoiceOverIcon />}
            onClick={onTranscribe}
            disabled={!hasAudio || transcribing}
            sx={{
              background:
                'linear-gradient(135deg,#7c3aed 0%,#22d3ee 100%)',
              '&:hover': { opacity: 0.9 }
            }}
          >
            {transcribing ? 'Transcribing\u2026' : 'Transcribe audio'}
          </Button>
          {hasTranscript && (
            <Tooltip title="Word timing from speech-to-text is active">
              <Typography
                variant="caption"
                sx={{
                  alignSelf: 'center',
                  color: '#22d3ee',
                  fontWeight: 600
                }}
              >
                {'\u2713 word-synced'}
              </Typography>
            </Tooltip>
          )}
        </Stack>
        {transcribing && (
          <Box mt={1}>
            <LinearProgress
              variant={progressValue != null ? 'determinate' : 'indeterminate'}
              value={progressValue != null ? progressValue * 100 : undefined}
            />
            <Typography variant="caption" color="text.secondary">
              {progressText}
            </Typography>
          </Box>
        )}
        {transcribeError && !transcribing && (
          <Alert
            severity="error"
            sx={{ mt: 1, fontSize: 12 }}
            action={
              errorIsRetryable && onClearCache ? (
                <Button
                  color="inherit"
                  size="small"
                  startIcon={<RefreshIcon fontSize="small" />}
                  onClick={onClearCache}
                >
                  Clear cache &amp; retry
                </Button>
              ) : undefined
            }
          >
            {transcribeError}
          </Alert>
        )}
      </Box>

      {/* ============== OPTION B: Paste your own ============== */}
      <Box
        sx={{
          p: 1.25,
          borderRadius: 2,
          border: '1px solid rgba(34,211,238,0.35)',
          background:
            'linear-gradient(135deg, rgba(34,211,238,0.08), rgba(124,58,237,0.04))'
        }}
      >
        <Stack direction="row" spacing={1} alignItems="center" mb={0.5}>
          <EditNoteIcon sx={{ color: '#22d3ee' }} fontSize="small" />
          <Typography variant="caption" sx={{ fontWeight: 700 }}>
            Option B &mdash; I have my own script
          </Typography>
        </Stack>
        <Typography variant="caption" color="text.secondary" display="block" mb={1}>
          Paste the script below, then click <em>Sync pasted text to audio</em>.
          The video stretches to the audio length and words follow the speech
          rhythm so captions stay in step.
        </Typography>
        <TextField
          multiline
          minRows={3}
          maxRows={8}
          fullWidth
          size="small"
          placeholder="Paste your script here&hellip;"
          value={script.text}
          onChange={(e) =>
            // Editing the text invalidates STT word timestamps (indexes drift).
            // Drop them and fall back to a non-transcript mode.
            onChange({
              ...script,
              text: e.target.value,
              wordTimes: undefined,
              wordEnds: undefined,
              syncMode: script.syncMode === 'transcript' ? 'even' : script.syncMode
            })
          }
        />
        <Stack direction="row" spacing={1} mt={1} alignItems="center" flexWrap="wrap">
          <Button
            variant="outlined"
            size="small"
            startIcon={<EditNoteIcon />}
            onClick={onSyncPastedScript}
            disabled={!hasAudio || !hasPastedText}
            sx={{
              borderColor: '#22d3ee',
              color: '#22d3ee',
              '&:hover': { borderColor: '#67e8f9', background: 'rgba(34,211,238,0.08)' }
            }}
          >
            Sync pasted text to audio
          </Button>
          {!hasAudio && (
            <Typography variant="caption" color="text.secondary">
              Load audio first.
            </Typography>
          )}
        </Stack>
      </Box>

      <Divider flexItem sx={{ opacity: 0.3 }} />

      {/* ============== Sync mode + animation ============== */}
      <Stack direction="row" spacing={1} alignItems="flex-start">
        <TextField
          select
          size="small"
          label="Sync"
          sx={{ minWidth: 170 }}
          value={script.syncMode}
          onChange={(e) =>
            onChange({
              ...script,
              syncMode: e.target.value as ProjectScript['syncMode']
            })
          }
        >
          <MenuItem value="even">Even spacing</MenuItem>
          <MenuItem value="audio" disabled={!hasAudio || !hasPeaks}>
            Audio peaks{!hasAudio ? ' (load audio)' : !hasPeaks ? ' (analyzing\u2026)' : ''}
          </MenuItem>
          <MenuItem value="transcript" disabled={!hasTranscript}>
            Word-by-word{!hasTranscript ? ' (transcribe first)' : ''}
          </MenuItem>
        </TextField>

        <Box sx={{ flex: 1 }}>
          <Autocomplete
            size="small"
            options={ANIM_OPTIONS}
            value={animValue}
            disableClearable
            groupBy={(o) => o.group}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            getOptionLabel={(o) => o.label}
            onChange={(_, v) =>
              v && onChange({ ...script, animation: v.id })
            }
            renderInput={(params) => (
              <TextField {...params} label="Animation" />
            )}
          />
        </Box>

        <Tooltip title="Re-roll AI style (font / color / animation when set to Auto)">
          <IconButton
            size="small"
            onClick={() => onChange({ ...script, styleSeed: newCaptionSeed() })}
            sx={{ mt: 0.5 }}
          >
            <CasinoIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
    </Stack>
  );
}
