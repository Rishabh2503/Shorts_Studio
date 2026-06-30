const ADMIN_COOKIE_NAME = 'ss_admin';

function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.get('cookie') ?? '';
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (!k) continue;
    out[k] = decodeURIComponent(rest.join('='));
  }
  return out;
}

async function sha256Base64Url(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const arr = Array.from(new Uint8Array(digest));
  let binary = '';
  for (const b of arr) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function getExpectedEmail(): string {
  return (process.env.ADMIN_EMAIL ?? 'gupta.rish2501@gmail.com').trim().toLowerCase();
}

export function getExpectedAdminEmail(): string {
  return getExpectedEmail();
}

export function hasAdminKeyConfigured(): boolean {
  return !!process.env.ADMIN_DASHBOARD_KEY;
}

export function isEmailAllowed(email: string): boolean {
  return email.trim().toLowerCase() === getExpectedEmail();
}

export function validateAdminKey(key: string): boolean {
  const expected = process.env.ADMIN_DASHBOARD_KEY;
  if (!expected) return false;
  return key === expected;
}

async function buildAdminSessionToken(): Promise<string | null> {
  const expected = process.env.ADMIN_DASHBOARD_KEY;
  if (!expected) return null;
  return sha256Base64Url(`${expected}::${getExpectedEmail()}::v1`);
}

export async function isAdminSession(req: Request): Promise<boolean> {
  const token = await buildAdminSessionToken();
  if (!token) return false;
  const cookies = parseCookies(req);
  return cookies[ADMIN_COOKIE_NAME] === token;
}

export async function createAdminCookie(req: Request): Promise<string | null> {
  const token = await buildAdminSessionToken();
  if (!token) return null;
  const secure = new URL(req.url).protocol === 'https:' ? '; Secure' : '';
  return `${ADMIN_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${secure}`;
}

export function clearAdminCookie(req: Request): string {
  const secure = new URL(req.url).protocol === 'https:' ? '; Secure' : '';
  return `${ADMIN_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}
