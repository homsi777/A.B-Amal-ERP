import React, { useEffect, useState } from 'react';
import { Activity } from 'lucide-react';
import { getApiBaseUrl } from '../lib/api/client';
import { fetchHealth } from '../lib/api/systemApi';

/**
 * مؤشر تطويري لاتصال الـ API — لا يؤثر على بيانات Zustand المحلية.
 */
export const BackendConnectionBadge = () => {
  const [status, setStatus] = useState<'idle' | 'ok' | 'down' | 'no-url'>('idle');

  useEffect(() => {
    const base = getApiBaseUrl();
    if (!base) {
      setStatus('no-url');
      return;
    }

    let cancelled = false;

    const run = async () => {
      const h = await fetchHealth();
      if (cancelled) return;
      if (!h) {
        setStatus('down');
        return;
      }
      setStatus(h.ok && h.database === 'connected' ? 'ok' : 'down');
    };

    void run();
    const id = window.setInterval(run, 45_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  if (status === 'idle' || status === 'no-url') {
    return (
      <span
        className="hidden md:inline-flex items-center gap-1.5 text-[11px] font-semibold text-[var(--text-muted)] px-2 py-1 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-muted-nav)]"
        title={status === 'no-url' ? 'لم يُضبط VITE_API_BASE_URL' : ''}
      >
        <Activity className="w-3.5 h-3.5 opacity-60" />
        {status === 'no-url' ? 'API غير مُعرّف' : '…'}
      </span>
    );
  }

  const ok = status === 'ok';
  return (
    <span
      className={`hidden md:inline-flex items-center gap-1.5 text-[11px] font-bold px-2 py-1 rounded-md border ${
        ok
          ? 'text-emerald-800 bg-emerald-50 border-emerald-200'
          : 'text-rose-800 bg-rose-50 border-rose-200'
      }`}
      title="حالة اتصال الخادم الخلفي (تطوير)"
    >
      <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-rose-500'}`} />
      {ok ? 'متصل بالخادم' : 'غير متصل بالخادم'}
    </span>
  );
};
