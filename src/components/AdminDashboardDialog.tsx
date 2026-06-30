import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  Stack,
  TextField,
  Typography
} from '@mui/material';
import { getLocalMetricsSnapshot, trackActivity } from '../lib/activity';
import {
  canUseLocalAdminMode,
  hasLocalAdminSession,
  setLocalAdminSession,
  validateLocalAdminCredentials
} from '../lib/adminLocal';

interface MetricsResponse {
  generatedAt: number;
  totals: {
    uniqueUsers24h: number;
    activeUsers15m: number;
    events24h: number;
    bugReports24h: number;
    bugReportsTotal: number;
  };
  eventBreakdown: Record<string, number>;
  recentEvents: Array<{ id: string; type: string; path: string; ts: number }>;
  recentBugReports: Array<{ id: string; title: string; severity: string; ts: number; path: string; email?: string }>;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

const ADMIN_EMAIL = import.meta.env.VITE_ADMIN_EMAIL ?? 'gupta.rish2501@gmail.com';

interface SessionResponse {
  authenticated: boolean;
  adminEmail: string;
  configured: boolean;
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <Box sx={{ p: 1.5, borderRadius: 2, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.02)' }}>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="h6" sx={{ mt: 0.4, fontWeight: 700 }}>{value}</Typography>
    </Box>
  );
}

export function AdminDashboardDialog({ open, onClose }: Props) {
  const [email, setEmail] = useState('');
  const [adminKey, setAdminKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionChecking, setSessionChecking] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);

  useEffect(() => {
    if (!open) return;

    if (canUseLocalAdminMode()) {
      setSessionChecking(false);
      setConfigured(true);
      setAuthenticated(hasLocalAdminSession());
      setEmail((curr) => curr || ADMIN_EMAIL);
      return;
    }

    let alive = true;
    setSessionChecking(true);
    fetch('/api/admin/session', { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to verify admin session (${res.status})`);
        const data = (await res.json()) as SessionResponse;
        if (!alive) return;
        setAuthenticated(data.authenticated);
        setConfigured(data.configured);
        setEmail((curr) => curr || data.adminEmail || ADMIN_EMAIL);
      })
      .catch((err) => {
        if (!alive) return;
        setAuthError((err as Error).message);
      })
      .finally(() => {
        if (!alive) return;
        setSessionChecking(false);
      });

    return () => {
      alive = false;
    };
  }, [open]);

  const maxBreakdown = useMemo(() => {
    if (!metrics) return 1;
    const values = Object.values(metrics.eventBreakdown);
    return Math.max(1, ...values);
  }, [metrics]);

  async function loadMetrics(force = false) {
    if (canUseLocalAdminMode()) {
      if (!authenticated && !force) {
        setAuthError('Sign in as admin first.');
        return;
      }
      setMetrics(getLocalMetricsSnapshot() as MetricsResponse);
      trackActivity({ type: 'admin_view_opened' });
      return;
    }

    if (!authenticated && !force) {
      setAuthError('Sign in as admin first.');
      return;
    }
    setLoading(true);
    setAuthError(null);
    try {
      const res = await fetch('/api/admin/metrics', {
        cache: 'no-store'
      });
      if (!res.ok) throw new Error(`Unauthorized (${res.status})`);
      const data = (await res.json()) as MetricsResponse;
      setMetrics(data);
      trackActivity({ type: 'admin_view_opened' });
    } catch (err) {
      setAuthError((err as Error).message);
      setMetrics(null);
    } finally {
      setLoading(false);
    }
  }

  async function handleLogin() {
    if (canUseLocalAdminMode()) {
      if (!validateLocalAdminCredentials(email, adminKey)) {
        setAuthError('Admin unlock failed. Check email/key.');
        return;
      }
      setLocalAdminSession(true);
      setAuthenticated(true);
      setAdminKey('');
      await loadMetrics(true);
      return;
    }

    if (email.trim().toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
      setAuthError('This admin panel is restricted to the configured admin email.');
      return;
    }
    setLoading(true);
    setAuthError(null);
    try {
      const res = await fetch('/api/admin/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, key: adminKey })
      });
      if (!res.ok) throw new Error(`Unauthorized (${res.status})`);
      setAuthenticated(true);
      setAdminKey('');
      await loadMetrics(true);
    } catch (err) {
      setAuthError((err as Error).message);
      setMetrics(null);
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    if (canUseLocalAdminMode()) {
      setLocalAdminSession(false);
      setAuthenticated(false);
      setMetrics(null);
      return;
    }

    setLoading(true);
    setAuthError(null);
    try {
      await fetch('/api/admin/session', { method: 'DELETE' });
      setAuthenticated(false);
      setMetrics(null);
    } catch (err) {
      setAuthError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Admin dashboard</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} mt={0.5}>
          <Alert severity="info">
            Configure server env ADMIN_DASHBOARD_KEY and optional VITE_ADMIN_EMAIL for restricted access.
          </Alert>

          {!configured && (
            <Alert severity="error">
              ADMIN_DASHBOARD_KEY is not configured on the server.
            </Alert>
          )}

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <TextField
              label="Admin email"
              size="small"
              fullWidth
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="gupta.rish2501@gmail.com"
              disabled={authenticated || sessionChecking}
            />
            <TextField
              label="Admin access key"
              size="small"
              type="password"
              fullWidth
              value={adminKey}
              onChange={(e) => setAdminKey(e.target.value)}
              disabled={authenticated || sessionChecking}
            />
            {!authenticated ? (
              <Button variant="contained" onClick={handleLogin} disabled={loading || sessionChecking || !adminKey.trim() || !configured}>
                {loading ? 'Signing in…' : 'Sign in'}
              </Button>
            ) : (
              <Stack direction="row" spacing={1}>
                <Button variant="contained" onClick={() => { void loadMetrics(); }} disabled={loading}>
                  {loading ? 'Refreshing…' : 'Refresh'}
                </Button>
                <Button variant="outlined" onClick={handleLogout} disabled={loading}>
                  Logout
                </Button>
              </Stack>
            )}
          </Stack>

          {authError && <Alert severity="error">{authError}</Alert>}

          {authenticated && metrics && (
            <>
              <Grid container spacing={1.2}>
                <Grid item xs={6} md={4}><MetricCard label="Unique users (24h)" value={metrics.totals.uniqueUsers24h} /></Grid>
                <Grid item xs={6} md={4}><MetricCard label="Active users (15m)" value={metrics.totals.activeUsers15m} /></Grid>
                <Grid item xs={6} md={4}><MetricCard label="Events (24h)" value={metrics.totals.events24h} /></Grid>
                <Grid item xs={6} md={4}><MetricCard label="Bug reports (24h)" value={metrics.totals.bugReports24h} /></Grid>
                <Grid item xs={12} md={4}><MetricCard label="Bug reports total" value={metrics.totals.bugReportsTotal} /></Grid>
              </Grid>

              <Box>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>Event breakdown</Typography>
                <Stack spacing={0.8}>
                  {Object.entries(metrics.eventBreakdown).map(([key, value]) => {
                    const pct = (value / maxBreakdown) * 100;
                    return (
                      <Box key={key}>
                        <Stack direction="row" justifyContent="space-between">
                          <Typography variant="caption">{key}</Typography>
                          <Typography variant="caption" color="text.secondary">{value}</Typography>
                        </Stack>
                        <Box sx={{ mt: 0.4, height: 8, borderRadius: 999, background: 'rgba(255,255,255,0.12)', overflow: 'hidden' }}>
                          <Box sx={{ width: `${pct}%`, height: '100%', background: 'linear-gradient(90deg,#22d3ee,#6366f1)' }} />
                        </Box>
                      </Box>
                    );
                  })}
                </Stack>
              </Box>

              <Divider />

              <Box>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>Recent bug reports</Typography>
                <Stack spacing={0.8} sx={{ maxHeight: 180, overflowY: 'auto' }}>
                  {metrics.recentBugReports.length === 0 && (
                    <Typography variant="caption" color="text.secondary">No bug reports yet.</Typography>
                  )}
                  {metrics.recentBugReports.map((r) => (
                    <Box key={r.id} sx={{ p: 1, borderRadius: 1.5, border: '1px solid rgba(255,255,255,0.08)' }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{r.title}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {new Date(r.ts).toLocaleString()} • {r.severity} • {r.path} • {r.email || 'anonymous'}
                      </Typography>
                    </Box>
                  ))}
                </Stack>
              </Box>
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
