import { useMemo, useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography
} from '@mui/material';
import { getRecentActivity, getSessionId, trackActivity } from '../lib/activity';

interface Props {
  open: boolean;
  onClose: () => void;
  onNotify: (message: string, level?: 'success' | 'error' | 'warning' | 'info') => void;
}

type Severity = 'low' | 'medium' | 'high' | 'critical';

export function BugReportDialog({ open, onClose, onNotify }: Props) {
  const [email, setEmail] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<Severity>('medium');
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = useMemo(() => title.trim().length >= 5 && description.trim().length >= 15, [title, description]);

  async function handleSubmit() {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/report-bug', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: getSessionId(),
          email: email.trim() || undefined,
          title: title.trim(),
          description: description.trim(),
          severity,
          path: window.location.pathname,
          userAgent: navigator.userAgent,
          recentEvents: getRecentActivity(25)
        })
      });

      if (!res.ok) {
        throw new Error(`Failed (${res.status})`);
      }

      const data = (await res.json()) as { emailed?: boolean };
      trackActivity({ type: 'bug_report_submitted', meta: { severity } });
      onNotify(
        data.emailed
          ? 'Bug report sent. You are notified by email.'
          : 'Bug report saved. Configure RESEND_API_KEY to enable email notifications.',
        data.emailed ? 'success' : 'warning'
      );
      setTitle('');
      setDescription('');
      setSeverity('medium');
      onClose();
    } catch (err) {
      onNotify(`Could not submit bug report: ${(err as Error).message}`, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Report a bug</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} mt={0.5}>
          <Typography variant="caption" color="text.secondary">
            Reports are sent to gupta.rish2501@gmail.com and attached with recent activity context.
          </Typography>

          <TextField
            label="Your email (optional)"
            size="small"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@example.com"
          />

          <TextField
            select
            label="Severity"
            size="small"
            value={severity}
            onChange={(e) => setSeverity(e.target.value as Severity)}
          >
            <MenuItem value="low">Low</MenuItem>
            <MenuItem value="medium">Medium</MenuItem>
            <MenuItem value="high">High</MenuItem>
            <MenuItem value="critical">Critical</MenuItem>
          </TextField>

          <TextField
            label="Title"
            size="small"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What broke?"
            helperText="At least 5 characters"
          />

          <TextField
            label="What happened?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            minRows={5}
            multiline
            placeholder="Steps to reproduce, expected vs actual behavior, and anything else useful."
            helperText="At least 15 characters"
          />

          <Box sx={{ p: 1, borderRadius: 1.5, background: 'rgba(34,211,238,0.08)' }}>
            <Typography variant="caption" color="text.secondary">
              Tip: include what you were doing right before the issue. This reduces fix time significantly.
            </Typography>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={submitting}>Cancel</Button>
        <Button onClick={handleSubmit} variant="contained" disabled={!canSubmit || submitting}>
          {submitting ? 'Submitting…' : 'Submit report'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
