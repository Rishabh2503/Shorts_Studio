// Per-word transcript editor — opens as a dialog from the ScriptPanel.
//
// Whisper occasionally hears the wrong word or splits a contraction
// awkwardly ("don't" → "don" + "'t"). This editor lets the user fix the
// text in place AND nudge each word's start time so captions stay perfectly
// synced after the edit.
//
// Design constraints:
//   - Word count is preserved on text-only edits. Splitting a word into
//     two is allowed (we duplicate the timing slot); merging two words
//     drops the second slot.
//   - Time edits are clamped between the previous word's end and the next
//     word's start so the schedule stays monotonic.
//   - Cancel discards all edits; Save commits to the project script.

import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography
} from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import AddIcon from '@mui/icons-material/Add';
import type { ProjectScript } from '../types';

interface Props {
  open: boolean;
  script: ProjectScript;
  onClose: () => void;
  onSave: (next: ProjectScript) => void;
}

interface WordRow {
  word: string;
  /** Start time in *project* seconds */
  start: number;
  /** End time in project seconds */
  end: number;
}

/**
 * Build editable rows from the project script. We require word timestamps —
 * the dialog won't be useful without them.
 */
function rowsFromScript(s: ProjectScript): WordRow[] {
  const tokens = s.text.split(/\s+/).filter(Boolean);
  const wt = s.wordTimes ?? [];
  const we = s.wordEnds ?? [];
  return tokens.map((w, i) => ({
    word: w,
    start: i < wt.length ? wt[i] : i * 0.4,
    end: i < we.length ? we[i] : (i < wt.length ? wt[i] : i * 0.4) + 0.35
  }));
}

function formatSeconds(s: number): string {
  if (!Number.isFinite(s)) return '0.00';
  return s.toFixed(2);
}

export function TranscriptEditorDialog({ open, script, onClose, onSave }: Props) {
  const [rows, setRows] = useState<WordRow[]>(() => rowsFromScript(script));

  // Reset whenever the dialog re-opens with a (possibly) different script.
  useEffect(() => {
    if (open) setRows(rowsFromScript(script));
  }, [open, script]);

  const totalCount = rows.length;
  const isUnchanged = useMemo(() => {
    const original = rowsFromScript(script);
    if (original.length !== rows.length) return false;
    for (let i = 0; i < rows.length; i++) {
      if (
        original[i].word !== rows[i].word ||
        Math.abs(original[i].start - rows[i].start) > 0.005 ||
        Math.abs(original[i].end - rows[i].end) > 0.005
      ) return false;
    }
    return true;
  }, [rows, script]);

  /** Clamp a time edit so the schedule remains monotonic. */
  const clampStart = (idx: number, value: number): number => {
    const prevEnd = idx > 0 ? rows[idx - 1].end : 0;
    const nextStart = idx + 1 < rows.length ? rows[idx + 1].start : value + 5;
    return Math.min(Math.max(prevEnd, value), nextStart - 0.05);
  };
  const clampEnd = (idx: number, value: number): number => {
    const start = rows[idx].start;
    const nextStart = idx + 1 < rows.length ? rows[idx + 1].start : value + 5;
    return Math.min(Math.max(start + 0.05, value), nextStart);
  };

  const updateWord = (idx: number, word: string) => {
    setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, word } : r)));
  };
  const updateStart = (idx: number, value: number) => {
    setRows((rs) =>
      rs.map((r, i) => (i === idx ? { ...r, start: clampStart(idx, value) } : r))
    );
  };
  const updateEnd = (idx: number, value: number) => {
    setRows((rs) =>
      rs.map((r, i) => (i === idx ? { ...r, end: clampEnd(idx, value) } : r))
    );
  };
  const deleteRow = (idx: number) => {
    setRows((rs) => rs.filter((_, i) => i !== idx));
  };
  const insertAfter = (idx: number) => {
    setRows((rs) => {
      const here = rs[idx];
      const next = rs[idx + 1];
      const midStart = next ? (here.end + next.start) / 2 : here.end + 0.2;
      const newRow: WordRow = {
        word: '…',
        start: midStart,
        end: midStart + 0.2
      };
      return [...rs.slice(0, idx + 1), newRow, ...rs.slice(idx + 1)];
    });
  };

  const handleSave = () => {
    // Drop any rows the user blanked out.
    const kept = rows.filter((r) => r.word.trim().length > 0);
    onSave({
      ...script,
      text: kept.map((r) => r.word.trim()).join(' '),
      wordTimes: kept.map((r) => Math.max(0, r.start)),
      wordEnds: kept.map((r) => Math.max(0, r.end)),
      // Preserve transcript mode if we still have timestamps.
      syncMode: kept.length > 0 ? 'transcript' : script.syncMode
    });
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Typography variant="h6">Edit transcript</Typography>
          <Typography variant="caption" color="text.secondary">
            {totalCount} word{totalCount === 1 ? '' : 's'}
          </Typography>
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        <Typography variant="caption" color="text.secondary" mb={1} display="block">
          Edit a word to fix transcription mistakes, or nudge its start/end
          time (in seconds) to re-sync captions with the audio. Times are
          clamped so the order stays correct.
        </Typography>
        <Stack spacing={0.5}>
          <Stack direction="row" spacing={1} sx={{ px: 1, opacity: 0.65 }}>
            <Typography variant="caption" sx={{ width: 32, textAlign: 'right' }}>
              #
            </Typography>
            <Typography variant="caption" sx={{ flex: 1 }}>
              Word
            </Typography>
            <Typography variant="caption" sx={{ width: 90, textAlign: 'right' }}>
              Start (s)
            </Typography>
            <Typography variant="caption" sx={{ width: 90, textAlign: 'right' }}>
              End (s)
            </Typography>
            <Box sx={{ width: 80 }} />
          </Stack>
          <Box
            sx={{
              maxHeight: 480,
              overflowY: 'auto',
              borderRadius: 1,
              border: '1px solid rgba(255,255,255,0.08)',
              p: 1
            }}
          >
            {rows.map((r, i) => (
              <Stack
                key={i}
                direction="row"
                spacing={1}
                alignItems="center"
                sx={{ mb: 0.5 }}
              >
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ width: 32, textAlign: 'right' }}
                >
                  {i + 1}
                </Typography>
                <TextField
                  size="small"
                  value={r.word}
                  onChange={(e) => updateWord(i, e.target.value)}
                  sx={{ flex: 1 }}
                />
                <TextField
                  size="small"
                  type="number"
                  inputProps={{ step: 0.05, min: 0 }}
                  value={formatSeconds(r.start)}
                  onChange={(e) =>
                    updateStart(i, parseFloat(e.target.value) || 0)
                  }
                  sx={{ width: 90 }}
                />
                <TextField
                  size="small"
                  type="number"
                  inputProps={{ step: 0.05, min: 0 }}
                  value={formatSeconds(r.end)}
                  onChange={(e) =>
                    updateEnd(i, parseFloat(e.target.value) || 0)
                  }
                  sx={{ width: 90 }}
                />
                <Stack direction="row">
                  <Tooltip title="Insert a word after this one">
                    <IconButton size="small" onClick={() => insertAfter(i)}>
                      <AddIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Delete this word">
                    <IconButton size="small" onClick={() => deleteRow(i)}>
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Stack>
              </Stack>
            ))}
            {rows.length === 0 && (
              <Typography variant="caption" color="text.secondary">
                No words yet. Transcribe audio or paste a script first.
              </Typography>
            )}
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSave} disabled={isUnchanged}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
