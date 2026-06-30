export type ActivityPayload = {
  type: string;
  path?: string;
  meta?: Record<string, unknown>;
};

const SESSION_KEY = 'shorts-studio:session-id';
const BUFFER_KEY = 'shorts-studio:activity-buffer';
const MAX_BUFFER = 120;
const USE_REMOTE_API = !import.meta.env.DEV || import.meta.env.VITE_USE_VERCEL_API === 'true';

interface BufferedEvent {
  id: string;
  sessionId: string;
  type: string;
  path: string;
  ts: number;
  meta?: Record<string, unknown>;
}

function safeLocalStorageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLocalStorageSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // ignore storage failures in private mode
  }
}

export function getSessionId(): string {
  const existing = safeLocalStorageGet(SESSION_KEY);
  if (existing) return existing;

  const next =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  safeLocalStorageSet(SESSION_KEY, next);
  return next;
}

function readBuffer(): BufferedEvent[] {
  const raw = safeLocalStorageGet(BUFFER_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as BufferedEvent[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeBuffer(events: BufferedEvent[]): void {
  safeLocalStorageSet(BUFFER_KEY, JSON.stringify(events.slice(-MAX_BUFFER)));
}

function sendEvent(event: BufferedEvent): void {
  if (!USE_REMOTE_API) return;

  const body = JSON.stringify(event);
  if (navigator.sendBeacon) {
    const blob = new Blob([body], { type: 'application/json' });
    navigator.sendBeacon('/api/activity/track', blob);
    return;
  }

  fetch('/api/activity/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true
  }).catch(() => {
    // Telemetry must never block UX.
  });
}

export function trackActivity(payload: ActivityPayload): void {
  const event: BufferedEvent = {
    id: crypto.randomUUID(),
    sessionId: getSessionId(),
    type: payload.type,
    path: payload.path ?? window.location.pathname,
    ts: Date.now(),
    meta: payload.meta
  };

  const next = [...readBuffer(), event];
  writeBuffer(next);
  sendEvent(event);
}

export function getRecentActivity(limit = 30): BufferedEvent[] {
  return readBuffer().slice(-limit).reverse();
}

export function getLocalMetricsSnapshot() {
  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;
  const recent = readBuffer().filter((e) => e.ts >= dayAgo);

  const eventBreakdown = recent.reduce<Record<string, number>>((acc, e) => {
    acc[e.type] = (acc[e.type] ?? 0) + 1;
    return acc;
  }, {});

  const activeUsers15m = new Set(
    recent
      .filter((e) => e.ts >= now - 15 * 60 * 1000)
      .map((e) => e.sessionId)
  ).size;

  return {
    generatedAt: now,
    totals: {
      uniqueUsers24h: new Set(recent.map((e) => e.sessionId)).size,
      activeUsers15m,
      events24h: recent.length,
      bugReports24h: eventBreakdown.bug_report_submitted ?? 0,
      bugReportsTotal: eventBreakdown.bug_report_submitted ?? 0
    },
    eventBreakdown,
    recentEvents: [...recent].sort((a, b) => b.ts - a.ts).slice(0, 50),
    recentBugReports: []
  };
}

export function initActivityTracking(): void {
  if (typeof window === 'undefined') return;

  trackActivity({ type: 'session_start' });
  trackActivity({ type: 'page_view' });

  let wasHidden = document.hidden;
  document.addEventListener('visibilitychange', () => {
    if (wasHidden && !document.hidden) {
      trackActivity({ type: 'page_view' });
    }
    wasHidden = document.hidden;
  });

  window.setInterval(() => {
    trackActivity({ type: 'heartbeat' });
  }, 60_000);
}
