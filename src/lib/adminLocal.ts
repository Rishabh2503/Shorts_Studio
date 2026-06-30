const LOCAL_ADMIN_SESSION_KEY = 'ss-local-admin-session';

export function expectedAdminEmail(): string {
  return (import.meta.env.VITE_ADMIN_EMAIL ?? 'gupta.rish2501@gmail.com').trim().toLowerCase();
}

export function canUseLocalAdminMode(): boolean {
  return import.meta.env.DEV && !!import.meta.env.VITE_LOCAL_ADMIN_KEY;
}

export function hasLocalAdminSession(): boolean {
  try {
    return window.sessionStorage.getItem(LOCAL_ADMIN_SESSION_KEY) === '1';
  } catch {
    return false;
  }
}

export function setLocalAdminSession(active: boolean): void {
  try {
    if (active) {
      window.sessionStorage.setItem(LOCAL_ADMIN_SESSION_KEY, '1');
    } else {
      window.sessionStorage.removeItem(LOCAL_ADMIN_SESSION_KEY);
    }
  } catch {
    // ignore storage failures
  }
}

export function validateLocalAdminCredentials(email: string, key: string): boolean {
  const expectedKey = import.meta.env.VITE_LOCAL_ADMIN_KEY;
  if (!expectedKey) return false;
  return (
    email.trim().toLowerCase() === expectedAdminEmail() &&
    key.trim() === expectedKey.trim()
  );
}
