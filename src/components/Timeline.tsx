import { useMemo, useState, useEffect, memo } from 'react';
import {
  Autocomplete,
  Box,
  Chip,
  IconButton,
  InputAdornment,
  MenuItem,
  Slider,
  Stack,
  TextField,
  Tooltip,
  Typography
} from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import CasinoIcon from '@mui/icons-material/Casino';
import {
  CAPTION_ANIM_GROUPS,
  CAPTION_ANIM_LABELS,
  EFFECT_GROUPS,
  EFFECT_LABELS,
  TRANSITION_LABELS,
  type CaptionAnimationId,
  type EffectId,
  type ImageClip,
  type TransitionId
} from '../types';
import { getResolvedEffect } from '../engine/render';
import { newEffectSeed } from '../engine/effectPicker';
import { newCaptionSeed } from '../engine/captionAi';
import { SplitScreenPanel } from './SplitScreenPanel';

interface Props {
  clips: ImageClip[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onUpdate: (id: string, patch: Partial<ImageClip>) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onDuplicate: (id: string) => void;
  /**
   * Reorder a clip via drag-and-drop. `from` and `to` are indexes into
   * the clips array. Owner is expected to splice the array and persist.
   */
  onReorder?: (from: number, to: number) => void;
  /** Whether the global animated-caption overlay is enabled. */
  captionsEnabled: boolean;
}

const MIN_DURATION = 0.5;
const MAX_DURATION = 30;

/** Autocomplete option model with category metadata for grouped UI. */
interface EffectOption {
  id: EffectId;
  label: string;
  group: string;
}

/** Build the flat option list with "AI Auto-pick" pinned to the top. */
const EFFECT_OPTIONS: EffectOption[] = [
  { id: 'auto', label: EFFECT_LABELS.auto, group: 'Smart' },
  ...EFFECT_GROUPS.flatMap((g) =>
    g.effects.map((id) => ({ id, label: EFFECT_LABELS[id], group: g.label }))
  )
];

function fmt(t: number): string {
  if (!isFinite(t)) return '0.0s';
  if (t < 60) return `${t.toFixed(1)}s`;
  const m = Math.floor(t / 60);
  const s = (t - m * 60).toFixed(1);
  return `${m}:${s.padStart(4, '0')}`;
}

/** Numeric duration input with debounced commit + validation. */
function DurationInput({
  value,
  onCommit
}: {
  value: number;
  onCommit: (v: number) => void;
}) {
  const [draft, setDraft] = useState(value.toFixed(2));
  useEffect(() => setDraft(value.toFixed(2)), [value]);

  function commit() {
    const n = parseFloat(draft);
    if (isFinite(n)) {
      const clamped = Math.max(MIN_DURATION, Math.min(MAX_DURATION, n));
      if (clamped !== value) onCommit(clamped);
      setDraft(clamped.toFixed(2));
    } else {
      setDraft(value.toFixed(2));
    }
  }

  return (
    <TextField
      size="small"
      type="number"
      label="Duration"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
      inputProps={{ step: 0.1, min: MIN_DURATION, max: MAX_DURATION }}
      InputProps={{
        endAdornment: <InputAdornment position="end">s</InputAdornment>
      }}
      sx={{ width: 140 }}
    />
  );
}

interface CaptionAnimOption {
  id: CaptionAnimationId;
  label: string;
  group: string;
}

const CAPTION_ANIM_OPTIONS: CaptionAnimOption[] = CAPTION_ANIM_GROUPS.flatMap((g) =>
  g.animations.map((id) => ({ id, label: CAPTION_ANIM_LABELS[id], group: g.label }))
);

/**
 * Single thumbnail in the timeline strip. Pulled out as a memoized component
 * so editing one clip's duration / caption / split mode does NOT re-render
 * every other thumbnail \u2014 important once a project has 20+ clips, since
 * each thumbnail mounts an `<img>` and a couple of nested Boxes.
 *
 * The custom equality check is intentional: we compare only the fields the
 * thumbnail actually paints. Mutating an unrelated field on the clip (e.g.
 * `effectSeed`) shouldn't trigger a re-render here.
 */
interface ClipThumbProps {
  clip: ImageClip;
  index: number;
  start: number;
  end: number;
  selected: boolean;
  onSelect: (id: string) => void;
  /** Drag handlers — only present when reorder is enabled. */
  draggable?: boolean;
  isDragging?: boolean;
  isDropTarget?: boolean;
  onDragStart?: (index: number) => void;
  onDragEnter?: (index: number) => void;
  onDragEnd?: () => void;
  onDrop?: (index: number) => void;
}

const ClipThumb = memo(
  function ClipThumb({
    clip,
    index,
    start,
    end,
    selected,
    onSelect,
    draggable,
    isDragging,
    isDropTarget,
    onDragStart,
    onDragEnter,
    onDragEnd,
    onDrop
  }: ClipThumbProps) {
    return (
      <Tooltip
        title={`#${index + 1} \u2022 ${fmt(start)} \u2192 ${fmt(end)} (${fmt(clip.duration)})`}
        arrow
      >
        <Box
          onClick={() => onSelect(clip.id)}
          draggable={draggable}
          onDragStart={(e) => {
            if (!draggable || !onDragStart) return;
            // Use a custom MIME so non-Timeline drop targets (file dropzone)
            // ignore us. Without setData() Firefox silently aborts the drag.
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('application/x-shorts-clip', String(index));
            onDragStart(index);
          }}
          onDragEnter={(e) => {
            if (!draggable || !onDragEnter) return;
            e.preventDefault();
            onDragEnter(index);
          }}
          onDragOver={(e) => {
            if (!draggable) return;
            // Required for onDrop to fire.
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
          }}
          onDragEnd={() => {
            if (!draggable || !onDragEnd) return;
            onDragEnd();
          }}
          onDrop={(e) => {
            if (!draggable || !onDrop) return;
            e.preventDefault();
            e.stopPropagation();
            onDrop(index);
          }}
          sx={{
            position: 'relative',
            flex: '0 0 auto',
            width: 72,
            height: 96,
            borderRadius: 2,
            overflow: 'hidden',
            cursor: draggable ? 'grab' : 'pointer',
            opacity: isDragging ? 0.4 : 1,
            // Visual indicator where the dragged clip will land.
            outline: isDropTarget && !isDragging ? '2px dashed #22d3ee' : 'none',
            outlineOffset: 1,
            border: selected
              ? '2px solid #a78bfa'
              : '1px solid rgba(255,255,255,0.12)',
            boxShadow: selected ? '0 0 0 4px rgba(167,139,250,0.18)' : 'none',
            transition: 'opacity 120ms, outline-color 120ms, border-color 120ms'
          }}
        >
          <img
            src={clip.src}
            alt=""
            loading="lazy"
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block'
            }}
            onError={(e) => {
              (e.target as HTMLImageElement).style.opacity = '0.3';
            }}
          />
          <Box
            sx={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: 0,
              px: 0.5,
              py: 0.25,
              background:
                'linear-gradient(180deg, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0) 100%)',
              fontSize: 10,
              color: '#fff',
              fontFamily: 'ui-monospace, monospace'
            }}
          >
            {fmt(start)}
          </Box>
          <Box
            sx={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              px: 0.5,
              py: 0.25,
              background:
                'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.85) 100%)',
              fontSize: 10,
              color: '#fff',
              display: 'flex',
              justifyContent: 'space-between',
              fontFamily: 'ui-monospace, monospace'
            }}
          >
            <span>#{index + 1}</span>
            <span>{clip.duration.toFixed(1)}s</span>
          </Box>
        </Box>
      </Tooltip>
    );
  },
  (prev, next) =>
    prev.clip.id === next.clip.id &&
    prev.clip.src === next.clip.src &&
    prev.clip.duration === next.clip.duration &&
    prev.index === next.index &&
    prev.start === next.start &&
    prev.end === next.end &&
    prev.selected === next.selected &&
    prev.onSelect === next.onSelect &&
    prev.draggable === next.draggable &&
    prev.isDragging === next.isDragging &&
    prev.isDropTarget === next.isDropTarget
);

export function Timeline({
  clips,
  selectedId,
  onSelect,
  onUpdate,
  onRemove,
  onMove,
  onDuplicate,
  onReorder,
  captionsEnabled
}: Props) {
  const selected = clips.find((c) => c.id === selectedId) ?? null;

  // ---- Drag-to-reorder state -------------------------------------------
  // We use plain React state (no library) — HTML5 drag-and-drop is plenty
  // for a horizontal list of <= a few dozen items, and avoids adding a
  // 200KB dependency for one feature.
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);
  const canReorder = !!onReorder;

  // Compute cumulative start/end timestamps once per clip-list change.
  const timestamps = useMemo(() => {
    let acc = 0;
    return clips.map((c) => {
      const start = acc;
      acc += c.duration;
      return { id: c.id, start, end: acc };
    });
  }, [clips]);

  const totalDur = timestamps.length ? timestamps[timestamps.length - 1].end : 0;
  const selectedTs = selected ? timestamps.find((t) => t.id === selected.id) : null;

  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
          Timeline
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {clips.length} clip{clips.length === 1 ? '' : 's'} • {fmt(totalDur)} total
          {canReorder && clips.length > 1 && (
            <span style={{ opacity: 0.6 }}> &nbsp;•&nbsp; drag a clip to reorder</span>
          )}
        </Typography>
      </Box>

      <Box
        sx={{
          display: 'flex',
          gap: 1,
          overflowX: 'auto',
          pb: 1,
          minHeight: 96
        }}
      >
        {clips.length === 0 && (
          <Box
            sx={{
              flex: 1,
              minHeight: 80,
              border: '1px dashed rgba(255,255,255,0.18)',
              borderRadius: 2,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'text.secondary',
              fontSize: 13
            }}
          >
            No clips yet — generate, upload, or drag-and-drop images
          </Box>
        )}
        {clips.map((c, i) => {
          const ts = timestamps[i];
          return (
            <ClipThumb
              key={c.id}
              clip={c}
              index={i}
              start={ts.start}
              end={ts.end}
              selected={selectedId === c.id}
              onSelect={onSelect}
              draggable={canReorder}
              isDragging={dragIdx === i}
              isDropTarget={dropIdx === i && dragIdx !== null && dropIdx !== dragIdx}
              onDragStart={(idx) => setDragIdx(idx)}
              onDragEnter={(idx) => setDropIdx(idx)}
              onDragEnd={() => {
                setDragIdx(null);
                setDropIdx(null);
              }}
              onDrop={(idx) => {
                if (
                  onReorder &&
                  dragIdx !== null &&
                  dragIdx !== idx &&
                  dragIdx >= 0 &&
                  idx >= 0
                ) {
                  onReorder(dragIdx, idx);
                }
                setDragIdx(null);
                setDropIdx(null);
              }}
            />
          );
        })}
      </Box>

      {selected && selectedTs && (
        <Box className="glass" sx={{ p: 2 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
            <Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                Clip settings
              </Typography>
              <Typography
                variant="caption"
                sx={{ fontFamily: 'ui-monospace, monospace', color: 'text.secondary' }}
              >
                Start {fmt(selectedTs.start)} → End {fmt(selectedTs.end)}
              </Typography>
            </Box>
            <Stack direction="row" spacing={0.5}>
              <Tooltip title="Move left">
                <span>
                  <IconButton
                    size="small"
                    onClick={() => onMove(selected.id, -1)}
                    disabled={clips.indexOf(selected) === 0}
                  >
                    <ArrowUpwardIcon
                      fontSize="small"
                      sx={{ transform: 'rotate(-90deg)' }}
                    />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title="Move right">
                <span>
                  <IconButton
                    size="small"
                    onClick={() => onMove(selected.id, 1)}
                    disabled={clips.indexOf(selected) === clips.length - 1}
                  >
                    <ArrowDownwardIcon
                      fontSize="small"
                      sx={{ transform: 'rotate(-90deg)' }}
                    />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title="Duplicate">
                <IconButton size="small" onClick={() => onDuplicate(selected.id)}>
                  <ContentCopyIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="Delete">
                <IconButton
                  size="small"
                  color="error"
                  onClick={() => onRemove(selected.id)}
                >
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
          </Stack>

          <Stack spacing={2}>
            <Stack direction="row" spacing={2} alignItems="center">
              <DurationInput
                value={selected.duration}
                onCommit={(v) => onUpdate(selected.id, { duration: v })}
              />
              <Box sx={{ flex: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  Drag to adjust ({MIN_DURATION}s – {MAX_DURATION}s)
                </Typography>
                <Slider
                  size="small"
                  min={MIN_DURATION}
                  max={Math.min(MAX_DURATION, 12)}
                  step={0.1}
                  value={selected.duration}
                  onChange={(_, v) => onUpdate(selected.id, { duration: v as number })}
                />
              </Box>
            </Stack>

            <Box>
              <Stack direction="row" spacing={1} alignItems="center" mb={0.5}>
                <Typography variant="caption" color="text.secondary">
                  Effect
                </Typography>
                {selected.effect === 'auto' && (
                  <Tooltip title="The AI picked this effect from your prompt. Click the dice to re-roll.">
                    <Chip
                      icon={<AutoAwesomeIcon sx={{ fontSize: 14 }} />}
                      label={`AI: ${EFFECT_LABELS[getResolvedEffect(selected)]}`}
                      size="small"
                      color="secondary"
                      variant="outlined"
                      sx={{ height: 22 }}
                    />
                  </Tooltip>
                )}
              </Stack>
              <Stack direction="row" spacing={1} alignItems="center">
                <Autocomplete
                  fullWidth
                  size="small"
                  options={EFFECT_OPTIONS}
                  groupBy={(opt) => opt.group}
                  getOptionLabel={(opt) => opt.label}
                  isOptionEqualToValue={(a, b) => a.id === b.id}
                  value={
                    EFFECT_OPTIONS.find((o) => o.id === selected.effect) ?? EFFECT_OPTIONS[0]
                  }
                  onChange={(_, v) => {
                    if (!v) return;
                    onUpdate(selected.id, {
                      effect: v.id,
                      // Give a fresh seed when switching back to auto so the
                      // resolved effect changes from before.
                      ...(v.id === 'auto' ? { effectSeed: newEffectSeed() } : {})
                    });
                  }}
                  renderOption={(props, opt) => (
                    <li {...props} key={opt.id}>
                      <Stack direction="row" alignItems="center" spacing={1}>
                        {opt.id === 'auto' && (
                          <AutoAwesomeIcon sx={{ fontSize: 16, color: '#22d3ee' }} />
                        )}
                        <span>{opt.label}</span>
                      </Stack>
                    </li>
                  )}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      placeholder="Type to search 45+ effects…"
                    />
                  )}
                />
                {selected.effect === 'auto' && (
                  <Tooltip title="Re-roll AI effect">
                    <IconButton
                      size="small"
                      onClick={() =>
                        onUpdate(selected.id, { effectSeed: newEffectSeed() })
                      }
                      sx={{
                        background:
                          'linear-gradient(135deg,#7c3aed 0%,#22d3ee 100%)',
                        color: '#fff',
                        '&:hover': { opacity: 0.9 }
                      }}
                    >
                      <CasinoIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
              </Stack>
            </Box>

            <TextField
              select
              size="small"
              label="Transition to next"
              value={selected.transition}
              onChange={(e) =>
                onUpdate(selected.id, { transition: e.target.value as TransitionId })
              }
            >
              {Object.entries(TRANSITION_LABELS).map(([k, v]) => (
                <MenuItem key={k} value={k}>
                  {v}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              size="small"
              label="Caption (optional)"
              value={selected.caption ?? ''}
              onChange={(e) => {
                const text = e.target.value;
                const patch: Partial<ImageClip> = { caption: text };
                // Seed the caption AI on first text entry so an 'auto'
                // animation immediately resolves to a concrete style.
                if (text && selected.captionStyleSeed == null) {
                  patch.captionStyleSeed = newCaptionSeed();
                }
                if (text && !selected.captionAnim) {
                  patch.captionAnim = 'auto';
                }
                onUpdate(selected.id, patch);
              }}
              multiline
              minRows={2}
              placeholder="POV: you found the secret"
              helperText={
                captionsEnabled
                  ? 'Animated overlay enabled — each word reveals with the chosen style.'
                  : 'Static caption. Toggle "Animated Captions" in the header to enable motion.'
              }
            />

            {selected.caption && captionsEnabled && (
              <Stack direction="row" spacing={1} alignItems="flex-end">
                <Autocomplete
                  size="small"
                  options={CAPTION_ANIM_OPTIONS}
                  groupBy={(opt) => opt.group}
                  value={
                    CAPTION_ANIM_OPTIONS.find(
                      (o) => o.id === (selected.captionAnim ?? 'auto')
                    ) ?? CAPTION_ANIM_OPTIONS[0]
                  }
                  onChange={(_, v) => {
                    if (!v) return;
                    const patch: Partial<ImageClip> = { captionAnim: v.id };
                    if (selected.captionStyleSeed == null) {
                      patch.captionStyleSeed = newCaptionSeed();
                    }
                    onUpdate(selected.id, patch);
                  }}
                  disableClearable
                  isOptionEqualToValue={(o, v) => o.id === v.id}
                  getOptionLabel={(o) => o.label}
                  renderOption={(props, opt) => (
                    <li {...props} key={opt.id}>
                      <Stack direction="row" spacing={1} alignItems="center">
                        {opt.id === 'auto' && (
                          <AutoAwesomeIcon
                            fontSize="small"
                            sx={{ color: '#a78bfa' }}
                          />
                        )}
                        <span>{opt.label}</span>
                      </Stack>
                    </li>
                  )}
                  renderInput={(params) => (
                    <TextField {...params} label="Caption animation" />
                  )}
                  sx={{ flex: 1 }}
                />
                {(selected.captionAnim ?? 'auto') === 'auto' && (
                  <Tooltip title="Re-roll AI caption style (font + color + animation)">
                    <IconButton
                      size="small"
                      onClick={() =>
                        onUpdate(selected.id, { captionStyleSeed: newCaptionSeed() })
                      }
                      sx={{
                        background:
                          'linear-gradient(135deg,#7c3aed 0%,#22d3ee 100%)',
                        color: '#fff',
                        '&:hover': { opacity: 0.9 }
                      }}
                    >
                      <CasinoIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
              </Stack>
            )}

            {/*
              Split-screen editor. Self-contained mini panel that lets the
              user attach a second image (upload or AI-generate) so the
              renderer draws both halves side-by-side with the same effect.
            */}
            <SplitScreenPanel
              clip={selected}
              onChange={(patch) => onUpdate(selected.id, patch)}
            />
          </Stack>
        </Box>
      )}
    </Stack>
  );
}
