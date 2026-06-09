import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type NonBlockingToastType = 'success' | 'warning' | 'error';

type ToastRecord = { id: number; message: string; type: NonBlockingToastType };

type ShowToastOptions = {
  message: string;
  type: NonBlockingToastType;
  /** Auto-dismiss delay; default 4200ms */
  durationMs?: number;
};

type ToastContextValue = {
  showToast: (opts: ShowToastOptions) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

/** Prevents Outlet + page subtree re-renders when only toast list changes (stable `children` from parent). */
const ToastOutletPassthrough = React.memo(function ToastOutletPassthrough({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
});

export function restoreAccidentalInteractionLocks() {
  if (typeof document === 'undefined') return;
  if (document.body.style.pointerEvents === 'none') document.body.style.pointerEvents = '';
  if (document.documentElement.style.pointerEvents === 'none') document.documentElement.style.pointerEvents = '';
  if (document.body.style.overflow === 'hidden') document.body.style.overflow = '';
  if (document.documentElement.style.overflow === 'hidden') document.documentElement.style.overflow = '';

  const appRoots = [
    document.getElementById('root'),
    document.querySelector('[data-reactroot]'),
  ].filter((el): el is HTMLElement => Boolean(el));

  appRoots.forEach((root) => {
    if (root.hasAttribute('inert')) root.removeAttribute('inert');
    if (root.getAttribute('aria-hidden') === 'true') root.removeAttribute('aria-hidden');
  });
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const idRef = useRef(0);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismissToast = useCallback((id: number) => {
    const timer = timersRef.current.get(id);
    if (timer) window.clearTimeout(timer);
    timersRef.current.delete(id);
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const showToast = useCallback((opts: ShowToastOptions) => {
    const id = ++idRef.current;
    const duration = opts.durationMs ?? 4200;
    restoreAccidentalInteractionLocks();
    setToasts((prev) => [...prev.slice(-4), { id, message: opts.message, type: opts.type }]);
    const t = window.setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== id));
      timersRef.current.delete(id);
      window.setTimeout(restoreAccidentalInteractionLocks, 0);
    }, duration);
    timersRef.current.set(id, t);
  }, []);

  useEffect(
    () => () => {
      timersRef.current.forEach((t) => window.clearTimeout(t));
      timersRef.current.clear();
      restoreAccidentalInteractionLocks();
    },
    [],
  );

  useEffect(() => {
    if (toasts.length === 0) {
      restoreAccidentalInteractionLocks();
    }
  }, [toasts.length]);

  const toneClass: Record<NonBlockingToastType, string> = {
    success: 'bg-emerald-700 text-white border-emerald-800/40',
    warning: 'bg-amber-600 text-white border-amber-800/40',
    error: 'bg-rose-600 text-white border-rose-900/30',
  };

  /** Stable context reference — avoids re-rendering every `useToast()` consumer on each toast tick. */
  const contextValue = useMemo(() => ({ showToast }), [showToast]);

  const toastLayer =
    typeof document !== 'undefined' ? (
      createPortal(
        <div
          data-app-toast-layer="true"
          className="pointer-events-none fixed top-4 left-1/2 z-[9999] flex max-w-[min(100vw-2rem,28rem)] -translate-x-1/2 flex-col gap-2"
          style={{ pointerEvents: 'none' }}
          dir="rtl"
          aria-live="polite"
        >
          {toasts.map((t) => (
            <div
              key={t.id}
              role="status"
              className={`pointer-events-auto flex items-start gap-3 rounded-lg border px-4 py-3 text-sm font-bold shadow-lg ${toneClass[t.type]}`}
            >
              <span className="min-w-0 flex-1">{t.message}</span>
              <button
                type="button"
                onClick={() => dismissToast(t.id)}
                className="shrink-0 rounded px-1.5 leading-5 text-white/85 hover:bg-white/15 hover:text-white focus:outline-none focus:ring-2 focus:ring-white/50"
                aria-label="إغلاق التنبيه"
              >
                ×
              </button>
            </div>
          ))}
        </div>,
        document.body,
      )
    ) : null;

  return (
    <ToastContext.Provider value={contextValue}>
      <ToastOutletPassthrough>{children}</ToastOutletPassthrough>
      {/* Portal to body: no accidental hit-box inside layout/overflow/transform ancestors; clicks pass through. */}
      {toastLayer}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return ctx;
}
