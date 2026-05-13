// ---------------------------------------------------------------------------
// Project Library — multi-save dialog.
// ---------------------------------------------------------------------------
// A single dialog with three sections (vertical, no fancy tabs — keeps the
// design surface minimal as requested):
//
//   1. Save current — snapshot the active project under a name. The
//      original (autosaved) project is NEVER touched, so users can keep
//      working without fear of losing their last edit.
//   2. Saved projects — gallery of previous snapshots with Load / Rename /
//      Delete actions. Each card shows a thumbnail, name, clip count,
//      duration, and "last edited" timestamp.
//   3. Start from a template — six pre-baked starting points (Top 5,
//      Before/After, Storytime, Tutorial, Hook Lab, Blank). Clicking one
//      creates a fresh library entry and loads it into the editor.
//
// All IDB I/O is delegated to `engine/projectLibrary.ts` so this file is
// pure UI + glue.
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import SaveAltRoundedIcon from '@mui/icons-material/SaveAltRounded';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import AutoAwesomeMosaicRoundedIcon from '@mui/icons-material/AutoAwesomeMosaicRounded';
import type { ProjectState } from '../types';
import {
  deleteProject,
  listProjects,
  loadProject,
  renameProject,
  saveAsNew,
  type ProjectListEntry
} from '../engine/projectLibrary';
import { PROJECT_TEMPLATES, type ProjectTemplate } from '../data/templates';

interface Props {
  open: boolean;
  onClose: () => void;
  /** The currently-active project — the source for "Save current". */
  currentProject: ProjectState;
  /** Replace the active project with the loaded one. */
  onLoad: (project: ProjectState, source: { id?: string; templateId?: string }) => void;
  /** Lightweight notification (snackbar) hook from the host app. */
  onNotify?: (msg: string, level?: 'success' | 'info' | 'error') => void;
}

export function ProjectLibraryDialog({
  open,
  onClose,
  currentProject,
  onLoad,
  onNotify
}: Props) {
  const [entries, setEntries] = useState<ProjectListEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saving, setSaving] = useState(false);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [err, setErr] = useState<string | null>(null);

  // Reload the project list every time the dialog opens. Cheap (metadata
  // only) and gives us "you closed and reopened — show fresh".
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const list = await listProjects();
        if (!cancelled) setEntries(list);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Default the save-name input to a friendly timestamp every time the
  // dialog opens. Users can overwrite it.
  useEffect(() => {
    if (open) {
      const stamp = new Date().toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
      setSaveName(`Draft ${stamp}`);
      setErr(null);
    }
  }, [open]);

  async function handleSaveCurrent() {
    if (currentProject.clips.length === 0 && !currentProject.script.text.trim()) {
      setErr(
        'Nothing to save yet — add a clip or some script text first.'
      );
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const entry = await saveAsNew(saveName, currentProject);
      setEntries((prev) => [entry, ...prev]);
      onNotify?.(`Saved "${entry.name}" to your library`, 'success');
    } catch (e) {
      const msg = (e as Error).message || 'Failed to save project.';
      setErr(msg);
      onNotify?.(msg, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleLoad(entry: ProjectListEntry) {
    try {
      const p = await loadProject(entry.id);
      if (!p) {
        setErr('Project payload missing — it may have been deleted.');
        return;
      }
      onLoad(p, { id: entry.id });
      onNotify?.(`Loaded "${entry.name}"`, 'info');
      onClose();
    } catch (e) {
      setErr((e as Error).message || 'Failed to load project.');
    }
  }

  async function handleDelete(entry: ProjectListEntry) {
    if (
      !window.confirm(
        `Delete "${entry.name}"? This removes the saved copy from your library. Your CURRENT working project is untouched.`
      )
    ) {
      return;
    }
    try {
      await deleteProject(entry.id);
      setEntries((prev) => prev.filter((e) => e.id !== entry.id));
      onNotify?.(`Deleted "${entry.name}"`, 'info');
    } catch (e) {
      setErr((e as Error).message || 'Failed to delete project.');
    }
  }

  async function handleRename(entry: ProjectListEntry) {
    if (!renameValue.trim() || renameValue.trim() === entry.name) {
      setRenameId(null);
      return;
    }
    try {
      const updated = await renameProject(entry.id, renameValue.trim());
      if (updated) {
        setEntries((prev) =>
          prev.map((e) => (e.id === entry.id ? updated : e))
        );
      }
    } catch (e) {
      setErr((e as Error).message || 'Failed to rename.');
    } finally {
      setRenameId(null);
    }
  }

  function handleTemplate(t: ProjectTemplate) {
    const fresh = t.make();
    onLoad(fresh, { templateId: t.id });
    onNotify?.(`Started new project from "${t.name}"`, 'success');
    onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: {
          background:
            'linear-gradient(180deg, rgba(20,20,40,0.96) 0%, rgba(10,10,25,0.96) 100%)',
          border: '1px solid rgba(255,255,255,0.08)'
        }
      }}
    >
      <DialogTitle sx={{ pr: 6 }}>
        <Stack direction="row" alignItems="center" spacing={1.5}>
          <AutoAwesomeMosaicRoundedIcon sx={{ color: '#a78bfa' }} />
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            Project library
          </Typography>
        </Stack>
        <Typography variant="caption" color="text.secondary">
          Save snapshots of your video — switch between them without ever
          losing the last edit. Your current work is auto-saved separately
          and is never overwritten by library actions.
        </Typography>
        <IconButton
          onClick={onClose}
          sx={{ position: 'absolute', right: 12, top: 12 }}
          aria-label="Close"
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5}>
          {err && <Alert severity="error">{err}</Alert>}

          {/* --- Save current --- */}
          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
              Save current project as a new copy
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
              <TextField
                size="small"
                label="Name"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                fullWidth
                disabled={saving}
              />
              <Button
                variant="contained"
                startIcon={
                  saving ? <CircularProgress size={16} color="inherit" /> : <SaveAltRoundedIcon />
                }
                onClick={handleSaveCurrent}
                disabled={saving}
                sx={{
                  background:
                    'linear-gradient(135deg,#7c3aed 0%,#22d3ee 100%)',
                  whiteSpace: 'nowrap'
                }}
              >
                {saving ? 'Saving…' : 'Save copy'}
              </Button>
            </Stack>
            <Typography variant="caption" color="text.secondary" mt={0.5} display="block">
              Current project: {currentProject.clips.length} clip
              {currentProject.clips.length === 1 ? '' : 's'}
              {currentProject.audio.src ? ' • has audio' : ''}
              {currentProject.script.text.trim() ? ' • has script' : ''}
            </Typography>
          </Box>

          <Divider />

          {/* --- Saved projects --- */}
          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
              Your saved projects {entries.length > 0 && `(${entries.length})`}
            </Typography>
            {loading && (
              <Stack alignItems="center" py={2}>
                <CircularProgress size={20} />
              </Stack>
            )}
            {!loading && entries.length === 0 && (
              <Typography variant="caption" color="text.secondary">
                No saved projects yet. Click "Save copy" above to make your
                first snapshot — or start fresh from one of the templates
                below.
              </Typography>
            )}
            {!loading && entries.length > 0 && (
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: {
                    xs: '1fr',
                    sm: 'repeat(2, 1fr)',
                    md: 'repeat(3, 1fr)'
                  },
                  gap: 1.25
                }}
              >
                {entries.map((entry) => (
                  <Box
                    key={entry.id}
                    sx={{
                      p: 1.25,
                      borderRadius: 2,
                      border: '1px solid rgba(255,255,255,0.08)',
                      background: 'rgba(255,255,255,0.02)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 0.75
                    }}
                  >
                    <Box
                      sx={{
                        aspectRatio: '9 / 16',
                        borderRadius: 1.5,
                        overflow: 'hidden',
                        background:
                          'linear-gradient(135deg,#1a1133 0%,#0b0820 100%)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                    >
                      {entry.thumbnail ? (
                        <img
                          src={entry.thumbnail}
                          alt=""
                          style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover'
                          }}
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      ) : (
                        <Typography variant="caption" color="text.secondary">
                          no preview
                        </Typography>
                      )}
                    </Box>

                    {renameId === entry.id ? (
                      <TextField
                        size="small"
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={() => handleRename(entry)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleRename(entry);
                          if (e.key === 'Escape') setRenameId(null);
                        }}
                      />
                    ) : (
                      <Typography
                        variant="body2"
                        sx={{ fontWeight: 600, lineHeight: 1.2 }}
                      >
                        {entry.name}
                      </Typography>
                    )}

                    <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap' }}>
                      <Chip
                        size="small"
                        label={`${entry.clipCount} clip${entry.clipCount === 1 ? '' : 's'}`}
                        sx={{ height: 18, '& .MuiChip-label': { px: 0.75, fontSize: 10 } }}
                      />
                      <Chip
                        size="small"
                        label={`${entry.durationSec.toFixed(1)}s`}
                        sx={{ height: 18, '& .MuiChip-label': { px: 0.75, fontSize: 10 } }}
                      />
                      {entry.templateId && (
                        <Chip
                          size="small"
                          color="secondary"
                          variant="outlined"
                          label="template"
                          sx={{ height: 18, '& .MuiChip-label': { px: 0.75, fontSize: 10 } }}
                        />
                      )}
                    </Stack>

                    <Typography variant="caption" color="text.secondary">
                      Updated {relTime(entry.updatedAt)}
                    </Typography>

                    <Stack direction="row" spacing={0.5} mt="auto">
                      <Tooltip title="Load into editor (replaces current)">
                        <IconButton
                          size="small"
                          onClick={() => handleLoad(entry)}
                          sx={{ color: '#a78bfa' }}
                        >
                          <OpenInNewRoundedIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Rename">
                        <IconButton
                          size="small"
                          onClick={() => {
                            setRenameId(entry.id);
                            setRenameValue(entry.name);
                          }}
                        >
                          <EditRoundedIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Delete">
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => handleDelete(entry)}
                        >
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  </Box>
                ))}
              </Box>
            )}
          </Box>

          <Divider />

          {/* --- Templates --- */}
          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
              Start from a template
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block" mb={1.25}>
              Each template pre-fills a script structure & caption preset. The
              suggested prompts populate the AI Image Generator so you only
              need to click "Generate".
            </Typography>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: {
                  xs: '1fr',
                  sm: 'repeat(2, 1fr)',
                  md: 'repeat(3, 1fr)'
                },
                gap: 1.25
              }}
            >
              {PROJECT_TEMPLATES.map((t) => (
                <Box
                  key={t.id}
                  onClick={() => handleTemplate(t)}
                  sx={{
                    p: 1.25,
                    borderRadius: 2,
                    border: '1px solid rgba(124,58,237,0.25)',
                    background:
                      'linear-gradient(135deg, rgba(124,58,237,0.08), rgba(34,211,238,0.04))',
                    cursor: 'pointer',
                    transition: 'all 140ms',
                    '&:hover': {
                      transform: 'translateY(-2px)',
                      borderColor: 'rgba(124,58,237,0.55)',
                      background:
                        'linear-gradient(135deg, rgba(124,58,237,0.18), rgba(34,211,238,0.08))'
                    }
                  }}
                >
                  <Typography variant="h5" sx={{ lineHeight: 1, mb: 0.5 }}>
                    {t.icon}
                  </Typography>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                    {t.name}
                  </Typography>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    display="block"
                    sx={{ minHeight: 32 }}
                  >
                    {t.tagline}
                  </Typography>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    display="block"
                    sx={{ mt: 0.5, fontSize: 10.5 }}
                  >
                    {t.description}
                  </Typography>
                </Box>
              ))}
            </Box>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

/** Format a timestamp as "12 min ago" / "3 hr ago" / "yesterday" / date. */
function relTime(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} hr ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} days ago`;
  return new Date(ms).toLocaleDateString();
}
