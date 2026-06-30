export type ActivityType =
  | 'session_start'
  | 'page_view'
  | 'heartbeat'
  | 'bug_report_submitted'
  | 'admin_view_opened'
  | 'user_action';

export interface ActivityEvent {
  id: string;
  sessionId: string;
  type: ActivityType | string;
  path: string;
  ts: number;
  meta?: Record<string, unknown>;
}

export interface BugReportEntry {
  id: string;
  sessionId: string;
  email?: string;
  title: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  path: string;
  userAgent: string;
  ts: number;
  recentEvents?: ActivityEvent[];
}

interface RuntimeStore {
  events: ActivityEvent[];
  bugReports: BugReportEntry[];
  sessions: Record<string, number>;
}

const STORE_KEY = '__shorts_studio_runtime_store__';

function getStore(): RuntimeStore {
  const g = globalThis as typeof globalThis & { [STORE_KEY]?: RuntimeStore };
  if (!g[STORE_KEY]) {
    g[STORE_KEY] = {
      events: [],
      bugReports: [],
      sessions: {}
    };
  }
  return g[STORE_KEY] as RuntimeStore;
}

function pruneStore(store: RuntimeStore): void {
  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;

  store.events = store.events.filter((e) => e.ts >= dayAgo).slice(-3000);
  store.bugReports = store.bugReports.filter((b) => b.ts >= dayAgo * 7).slice(-1000);

  const nextSessions: Record<string, number> = {};
  for (const [sessionId, lastSeen] of Object.entries(store.sessions)) {
    if (lastSeen >= dayAgo) nextSessions[sessionId] = lastSeen;
  }
  store.sessions = nextSessions;
}

export function addActivity(event: ActivityEvent): void {
  const store = getStore();
  store.events.push(event);
  store.sessions[event.sessionId] = event.ts;
  pruneStore(store);
}

export function addBugReport(report: BugReportEntry): void {
  const store = getStore();
  store.bugReports.push(report);
  store.sessions[report.sessionId] = report.ts;
  pruneStore(store);
}

export function getMetrics() {
  const store = getStore();
  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;
  const active15m = now - 15 * 60 * 1000;

  const events24h = store.events.filter((e) => e.ts >= dayAgo);
  const bugReports24h = store.bugReports.filter((b) => b.ts >= dayAgo);

  const eventBreakdown = events24h.reduce<Record<string, number>>((acc, e) => {
    acc[e.type] = (acc[e.type] ?? 0) + 1;
    return acc;
  }, {});

  const uniqueUsers24h = new Set(events24h.map((e) => e.sessionId)).size;
  const activeUsers15m = Object.values(store.sessions).filter((ts) => ts >= active15m).length;

  return {
    generatedAt: now,
    totals: {
      uniqueUsers24h,
      activeUsers15m,
      events24h: events24h.length,
      bugReports24h: bugReports24h.length,
      bugReportsTotal: store.bugReports.length
    },
    eventBreakdown,
    recentEvents: [...events24h].sort((a, b) => b.ts - a.ts).slice(0, 50),
    recentBugReports: [...store.bugReports].sort((a, b) => b.ts - a.ts).slice(0, 20)
  };
}
