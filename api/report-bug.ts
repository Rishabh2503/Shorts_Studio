import { addActivity, addBugReport, type ActivityEvent, type BugReportEntry } from './_lib/runtimeStore';

export const config = { runtime: 'edge' };

interface BugReportBody {
  sessionId?: string;
  email?: string;
  title?: string;
  description?: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  path?: string;
  userAgent?: string;
  recentEvents?: ActivityEvent[];
}

function sanitize(value: string | undefined, maxLen: number): string {
  return (value ?? '').trim().slice(0, maxLen);
}

async function sendBugEmail(report: BugReportEntry): Promise<boolean> {
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) return false;

  const to = process.env.BUG_REPORT_TO ?? 'gupta.rish2501@gmail.com';
  const from = process.env.BUG_REPORT_FROM ?? 'onboarding@resend.dev';

  const details = [
    `Severity: ${report.severity}`,
    `Session: ${report.sessionId}`,
    `Path: ${report.path}`,
    `User email: ${report.email || '(not provided)'}`,
    `User agent: ${report.userAgent}`,
    '',
    'Description:',
    report.description,
    '',
    'Recent activity:',
    ...(report.recentEvents ?? []).map((e) => {
      const t = new Date(e.ts).toISOString();
      return `- ${t} | ${e.type} | ${e.path}`;
    })
  ].join('\n');

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from,
      to,
      subject: `[Shorts Studio Bug] ${report.severity.toUpperCase()} - ${report.title}`,
      text: details
    })
  });

  return res.ok;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', {
      status: 405,
      headers: { Allow: 'POST' }
    });
  }

  let body: BugReportBody;
  try {
    body = (await req.json()) as BugReportBody;
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const sessionId = sanitize(body.sessionId, 120);
  const title = sanitize(body.title, 140);
  const description = sanitize(body.description, 5000);
  const severity = body.severity ?? 'medium';

  if (!sessionId || !title || !description) {
    return new Response('sessionId, title, and description are required', { status: 400 });
  }

  const report: BugReportEntry = {
    id: crypto.randomUUID(),
    sessionId,
    email: sanitize(body.email, 240) || undefined,
    title,
    description,
    severity,
    path: sanitize(body.path, 400) || '/',
    userAgent: sanitize(body.userAgent, 500),
    ts: Date.now(),
    recentEvents: Array.isArray(body.recentEvents) ? body.recentEvents.slice(0, 30) : undefined
  };

  addBugReport(report);
  addActivity({
    id: crypto.randomUUID(),
    sessionId: report.sessionId,
    type: 'bug_report_submitted',
    path: report.path,
    ts: report.ts,
    meta: { severity: report.severity }
  });

  const emailed = await sendBugEmail(report);
  return Response.json({ ok: true, emailed });
}
