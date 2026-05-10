import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { Alert, Snackbar } from '@mui/material';

export type ToastSeverity = 'success' | 'info' | 'warning' | 'error';

interface ToastItem {
  id: number;
  message: string;
  severity: ToastSeverity;
}

interface ToastApi {
  show: (message: string, severity?: ToastSeverity) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const show = useCallback(
    (message: string, severity: ToastSeverity = 'info') => {
      setItems((prev) => [...prev, { id: Date.now() + Math.random(), message, severity }]);
    },
    []
  );

  const close = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {items.map((t, i) => (
        <Snackbar
          key={t.id}
          open
          autoHideDuration={t.severity === 'error' ? 6000 : 3500}
          onClose={() => close(t.id)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
          sx={{ mb: i * 7 }}
        >
          <Alert
            onClose={() => close(t.id)}
            severity={t.severity}
            variant="filled"
            sx={{ minWidth: 280 }}
          >
            {t.message}
          </Alert>
        </Snackbar>
      ))}
    </ToastContext.Provider>
  );
}

const NOOP_API: ToastApi = { show: () => {} };

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Singleton no-op so the reference is stable when used outside a provider.
    return NOOP_API;
  }
  return ctx;
}
