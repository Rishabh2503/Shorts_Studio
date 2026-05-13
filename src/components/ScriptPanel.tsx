import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Divider,
  FormControlLabel,
  IconButton,
  LinearProgress,
  MenuItem,
  Slider,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography
} from '@mui/material';
import CasinoIcon from '@mui/icons-material/Casino';
import RecordVoiceOverIcon from '@mui/icons-material/RecordVoiceOver';
import EditNoteIcon from '@mui/icons-material/EditNote';
import RefreshIcon from '@mui/icons-material/Refresh';
import DownloadIcon from '@mui/icons-material/Download';
import TuneIcon from '@mui/icons-material/Tune';
import PaletteRoundedIcon from '@mui/icons-material/PaletteRounded';
import RestartAltRoundedIcon from '@mui/icons-material/RestartAltRounded';
import {
  CAPTION_ANIM_GROUPS,
  CAPTION_ANIM_LABELS,
  type CaptionAnimationId,
  type ProjectScript
} from '../types';
import { newCaptionSeed } from '../engine/captionAi';
import type { STTProgress } from '../engine/speechToText';
import { CAPTION_PRESETS } from '../engine/captionPresets';

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
  /**
   * Open the per-word transcript editor (table). Owner manages the dialog.
   */
  onEditTranscript?: () => void;
  /** Download an .srt sidecar of the current script + word timings. */
  onDownloadSRT?: () => void;
}

interface AnimOption {
  id: CaptionAnimationId;
  label: string;
  group: string;
}

const ANIM_OPTIONS: AnimOption[] = CAPTION_ANIM_GROUPS.flatMap((g) =>
  g.animations.map((id) => ({ id, label: CAPTION_ANIM_LABELS[id], group: g.label }))
);

// Curated font list for the "Customize → Font" picker. We use only widely
// available system / web-safe fonts so a fresh visitor on Vercel sees the
// same look you previewed locally. The first entry resets to AI/preset.
const FONT_CHOICES: { label: string; value: string }[] = [
  { label: 'AI / preset (default)', value: '' },
  { label: 'Inter — modern sans', value: 'Inter, system-ui, sans-serif' },
  { label: 'System UI', value: 'system-ui, -apple-system, sans-serif' },
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Helvetica Neue', value: '"Helvetica Neue", Helvetica, Arial, sans-serif' },
  { label: 'Impact — bold display', value: 'Impact, "Arial Black", sans-serif' },
  { label: 'Trebuchet MS', value: '"Trebuchet MS", sans-serif' },
  { label: 'Georgia — classic serif', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Times New Roman', value: '"Times New Roman", Times, serif' },
  { label: 'Courier New — mono', value: '"Courier New", Courier, monospace' },
  { label: 'Comic Sans MS — playful', value: '"Comic Sans MS", "Comic Sans", cursive' }
];

// Suggested caption colors. The first set is "fill" colors; the AI picks
// from a similar palette so these double as inspiration when users want a
// concrete brand color. Strokes default to black for fill colors below.
const COLOR_SUGGESTIONS: string[] = [
  '#ffffff',
  '#ffd400',
  '#22d3ee',
  '#a78bfa',
  '#f472b6',
  '#34d399',
  '#fb923c',
  '#ef4444',
  '#fef3c7',
  '#0f172a'
];

// Vertical-position presets. The renderer accepts any 0..1 float — these
// are just the three most common picks (top, middle, bottom-third).
const POSITION_PRESETS: { label: string; value: number | undefined }[] = [
  { label: 'AI default', value: undefined },
  { label: 'Top', value: 0.18 },
  { label: 'Middle', value: 0.5 },
  { label: 'Lower-third (TikTok)', value: 0.78 },
  { label: 'Bottom', value: 0.9 }
];

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
  transcribeError,
  onEditTranscript,
  onDownloadSRT
}: Props) {
  const animValue =
    ANIM_OPTIONS.find((o) => o.id === script.animation) ?? ANIM_OPTIONS[0];
  const hasTranscript =
    script.syncMode === 'transcript' && (script.wordTimes?.length ?? 0) > 0;
  const hasPastedText = script.text.trim().length > 0 && !hasTranscript;

  // Compose a friendly status line for the loader. First-time users wait on
  // the model download (~40-150MB depending on quantization), so we want a
  // clear progress indicator with the actual file + MB if the engine has it.
  let progressText = '';
  let progressValue: number | undefined;
  if (transcribing && transcribeProgress) {
    if (transcribeProgress.stage === 'load-model') {
      const pct =
        transcribeProgress.progress != null
          ? ` ${Math.round(transcribeProgress.progress * 100)}%`
          : '';
      // Engine emits a richer message when it knows the file + bytes. Prefer it.
      progressText =
        transcribeProgress.message ??
        `Loading speech model${pct}\u2026 (one-time, ~40\u2013150 MB)`;
      progressValue = transcribeProgress.progress;
    } else if (transcribeProgress.stage === 'decode-audio') {
      progressText = transcribeProgress.message ?? 'Decoding audio\u2026';
    } else if (transcribeProgress.stage === 'transcribe') {
      progressText = transcribeProgress.message ?? 'Transcribing speech\u2026';
    }
  }

  // Detect cache-corruption / transient errors so we can offer a one-click
  // cleanup. We're permissive — better to surface the button too often than
  // hide it when the user actually needs it.
  const errorIsRetryable =
    !!transcribeError &&
    /create a session|qdq_actions|MatMulNBits|missing required scale|SimplifiedLayerNormFusion|InsertedPrecisionFreeCast|inference|failed to load|backend|webgpu|wasm/i.test(
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
          {/* Model + language pickers — swap the engine + spoken language. */}
          <TextField
            select
            size="small"
            label="Model"
            value={script.sttModel ?? 'en'}
            onChange={(e) =>
              onChange({
                ...script,
                sttModel: e.target.value as 'en' | 'multi'
              })
            }
            sx={{ minWidth: 130 }}
            disabled={transcribing}
          >
            <MenuItem value="en">English (fast)</MenuItem>
            <MenuItem value="multi">Multilingual</MenuItem>
          </TextField>
          {script.sttModel === 'multi' && (
            <TextField
              select
              size="small"
              label="Language"
              value={script.sttLanguage ?? 'auto'}
              onChange={(e) =>
                onChange({ ...script, sttLanguage: e.target.value })
              }
              sx={{ minWidth: 130 }}
              disabled={transcribing}
            >
              <MenuItem value="auto">Auto-detect</MenuItem>
              <MenuItem value="en">English</MenuItem>
              <MenuItem value="es">Spanish</MenuItem>
              <MenuItem value="fr">French</MenuItem>
              <MenuItem value="de">German</MenuItem>
              <MenuItem value="hi">Hindi</MenuItem>
              <MenuItem value="pt">Portuguese</MenuItem>
              <MenuItem value="it">Italian</MenuItem>
              <MenuItem value="ja">Japanese</MenuItem>
              <MenuItem value="ko">Korean</MenuItem>
              <MenuItem value="zh">Chinese</MenuItem>
              <MenuItem value="ar">Arabic</MenuItem>
              <MenuItem value="ru">Russian</MenuItem>
              <MenuItem value="tr">Turkish</MenuItem>
              <MenuItem value="nl">Dutch</MenuItem>
              <MenuItem value="pl">Polish</MenuItem>
            </TextField>
          )}
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
          {hasTranscript && onEditTranscript && (
            <Button
              variant="text"
              size="small"
              startIcon={<TuneIcon fontSize="small" />}
              onClick={onEditTranscript}
            >
              Edit words
            </Button>
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
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'flex-start' }}>
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

      {/* ============== Caption preset + karaoke + filler ============== */}
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
        <TextField
          select
          size="small"
          label="Preset"
          sx={{ minWidth: 200 }}
          value={script.preset ?? 'auto'}
          onChange={(e) =>
            onChange({ ...script, preset: e.target.value || undefined })
          }
        >
          {CAPTION_PRESETS.map((p) => (
            <MenuItem key={p.id} value={p.id}>
              <Stack>
                <Typography variant="body2">{p.label}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {p.description}
                </Typography>
              </Stack>
            </MenuItem>
          ))}
        </TextField>

        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={!!script.karaoke}
              onChange={(e) =>
                onChange({ ...script, karaoke: e.target.checked })
              }
            />
          }
          label={<Typography variant="caption">Karaoke highlight</Typography>}
        />

        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={!!script.filterFillers}
              onChange={(e) =>
                onChange({ ...script, filterFillers: e.target.checked })
              }
            />
          }
          label={
            <Tooltip title="Strip uh, um, like, you-know\u2026 from captions">
              <Typography variant="caption">Strip fillers</Typography>
            </Tooltip>
          }
        />

        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={script.burnIn !== false}
              onChange={(e) =>
                onChange({ ...script, burnIn: e.target.checked })
              }
            />
          }
          label={
            <Tooltip title="Off = export captions as a separate .srt file instead of pixels">
              <Typography variant="caption">Burn-in</Typography>
            </Tooltip>
          }
        />

        {onDownloadSRT && (
          <Button
            size="small"
            variant="text"
            startIcon={<DownloadIcon fontSize="small" />}
            onClick={onDownloadSRT}
            disabled={!script.text.trim()}
          >
            .srt
          </Button>
        )}
      </Stack>

      {/* ============== Customize (optional overrides) ==============
          All three fields below are optional. Leave them at "AI / preset
          default" to keep the existing AI auto-style picker running; set
          one to lock that specific aspect (brand color, font family,
          vertical position) while leaving the rest AI-driven. */}
      <Divider sx={{ my: 0.5 }} />
      <Stack spacing={1.25}>
        <Stack direction="row" spacing={0.75} alignItems="center">
          <PaletteRoundedIcon fontSize="small" sx={{ color: '#a78bfa' }} />
          <Typography variant="caption" sx={{ fontWeight: 700 }}>
            Customize caption look (optional)
          </Typography>
          <Tooltip title="Reset all custom overrides — AI / preset takes over again">
            <span>
              <IconButton
                size="small"
                disabled={
                  !script.customColor &&
                  !script.customStrokeColor &&
                  !script.customFontFamily &&
                  script.customPositionY == null
                }
                onClick={() =>
                  onChange({
                    ...script,
                    customColor: undefined,
                    customStrokeColor: undefined,
                    customFontFamily: undefined,
                    customPositionY: undefined
                  })
                }
              >
                <RestartAltRoundedIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>

        {/* Color row: native color picker + quick-pick swatches. */}
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
          <Box
            component="label"
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.75,
              cursor: 'pointer'
            }}
          >
            <Typography variant="caption" color="text.secondary">
              Color
            </Typography>
            {/* Native input gives us a real OS picker with zero deps. */}
            <input
              type="color"
              value={script.customColor ?? '#ffffff'}
              onChange={(e) =>
                onChange({ ...script, customColor: e.target.value })
              }
              style={{
                width: 28,
                height: 28,
                padding: 0,
                border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: 6,
                background: 'transparent',
                cursor: 'pointer'
              }}
            />
          </Box>
          <Box
            component="label"
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.75,
              cursor: 'pointer'
            }}
          >
            <Typography variant="caption" color="text.secondary">
              Stroke
            </Typography>
            <input
              type="color"
              value={script.customStrokeColor ?? '#000000'}
              onChange={(e) =>
                onChange({ ...script, customStrokeColor: e.target.value })
              }
              style={{
                width: 28,
                height: 28,
                padding: 0,
                border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: 6,
                background: 'transparent',
                cursor: 'pointer'
              }}
            />
          </Box>
          <Stack
            direction="row"
            spacing={0.5}
            sx={{ flexWrap: 'wrap', rowGap: 0.5 }}
          >
            {COLOR_SUGGESTIONS.map((c) => (
              <Tooltip key={c} title={c}>
                <Box
                  onClick={() => onChange({ ...script, customColor: c })}
                  sx={{
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    background: c,
                    cursor: 'pointer',
                    border:
                      script.customColor === c
                        ? '2px solid #fff'
                        : '1px solid rgba(255,255,255,0.25)',
                    transition: 'transform 120ms',
                    '&:hover': { transform: 'scale(1.15)' }
                  }}
                />
              </Tooltip>
            ))}
          </Stack>
        </Stack>

        {/* Font row. */}
        <TextField
          select
          size="small"
          label="Font family (AI suggests when blank)"
          value={script.customFontFamily ?? ''}
          onChange={(e) =>
            onChange({
              ...script,
              customFontFamily: e.target.value || undefined
            })
          }
          fullWidth
        >
          {FONT_CHOICES.map((f) => (
            <MenuItem
              key={f.label}
              value={f.value}
              sx={{ fontFamily: f.value || undefined }}
            >
              {f.label}
            </MenuItem>
          ))}
        </TextField>

        {/* Position row: preset buttons + fine slider. */}
        <Stack spacing={0.75}>
          <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap">
            <Typography variant="caption" color="text.secondary">
              Position
            </Typography>
            {POSITION_PRESETS.map((p) => {
              const active =
                (p.value == null && script.customPositionY == null) ||
                (p.value != null &&
                  script.customPositionY != null &&
                  Math.abs(script.customPositionY - p.value) < 0.005);
              return (
                <Button
                  key={p.label}
                  size="small"
                  variant={active ? 'contained' : 'outlined'}
                  onClick={() =>
                    onChange({ ...script, customPositionY: p.value })
                  }
                  sx={{ py: 0.25, px: 1, minWidth: 0, textTransform: 'none' }}
                >
                  {p.label}
                </Button>
              );
            })}
          </Stack>
          {script.customPositionY != null && (
            <Box sx={{ px: 1 }}>
              <Slider
                size="small"
                value={Math.round(script.customPositionY * 100)}
                min={5}
                max={95}
                step={1}
                valueLabelDisplay="auto"
                valueLabelFormat={(v) => `${v}%`}
                onChange={(_, v) => {
                  const next = Array.isArray(v) ? v[0] : v;
                  onChange({ ...script, customPositionY: next / 100 });
                }}
              />
            </Box>
          )}
        </Stack>
      </Stack>
    </Stack>
  );
}
