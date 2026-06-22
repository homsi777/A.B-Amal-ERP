import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Globe, Monitor, RefreshCw, Smartphone, Wifi } from 'lucide-react';
import { fetchActiveSessions, type ActiveSessionDto } from '../../lib/api/settingsApi';
import { useToast } from '../NonBlockingToast';

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ar-SY', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function isOnlineNow(lastSeenAt: string): boolean {
  const ts = new Date(lastSeenAt).getTime();
  if (Number.isNaN(ts)) return false;
  return Date.now() - ts < 2 * 60 * 1000;
}

function platformIcon(code: ActiveSessionDto['clientPlatform']) {
  switch (code) {
    case 'windows-desktop':
      return Monitor;
    case 'mobile-browser':
      return Smartphone;
    default:
      return Globe;
  }
}

function platformBadgeClass(code: ActiveSessionDto['clientPlatform']): string {
  switch (code) {
    case 'windows-desktop':
      return 'bg-indigo-100 text-indigo-800';
    case 'mobile-browser':
      return 'bg-violet-100 text-violet-800';
    default:
      return 'bg-sky-100 text-sky-800';
  }
}

export const ActiveDevicesPanel: React.FC = () => {
  const { showToast } = useToast();
  const [rows, setRows] = useState<ActiveSessionDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [showIdle, setShowIdle] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchActiveSessions();
      setRows(data);
    } catch (error) {
      showToast({
        type: 'error',
        message: error instanceof Error ? error.message : 'تعذر تحميل الأجهزة النشطة',
      });
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const onlineRows = useMemo(() => rows.filter((row) => isOnlineNow(row.lastSeenAt)), [rows]);
  const visibleRows = useMemo(
    () => (showIdle ? rows : onlineRows),
    [rows, onlineRows, showIdle],
  );

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-xl font-black text-[var(--text-heading)]">الأجهزة النشطة</h3>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            من متصل الآن بالنظام: اسم الحساب، آلية الدخول (ويندوز / موبايل / متصفح)، وعنوان IP.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-2 rounded-xl border border-[var(--border-default)] bg-white px-3 py-2 text-sm font-bold text-slate-700">
            <input
              type="checkbox"
              checked={showIdle}
              onChange={(event) => setShowIdle(event.target.checked)}
              className="accent-[var(--ui-accent)]"
            />
            إظهار الجلسات الخاملة
          </label>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl border border-[var(--border-default)] bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            تحديث
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
          <div className="flex items-center gap-2 text-emerald-800">
            <Wifi className="h-5 w-5" />
            <span className="text-sm font-bold">متصل الآن</span>
          </div>
          <p className="mt-2 text-2xl font-black text-emerald-900">{loading ? '...' : onlineRows.length}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <div className="flex items-center gap-2 text-slate-700">
            <Monitor className="h-5 w-5" />
            <span className="text-sm font-bold">جلسات خلال 5 دقائق</span>
          </div>
          <p className="mt-2 text-2xl font-black text-slate-900">{loading ? '...' : rows.length}</p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--border-default)] bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="p-3 text-right font-black">الحالة</th>
              <th className="p-3 text-right font-black">حساب المستخدم</th>
              <th className="p-3 text-right font-black">الاسم</th>
              <th className="p-3 text-right font-black">آلية الدخول</th>
              <th className="p-3 text-right font-black">عنوان IP</th>
              <th className="p-3 text-right font-black">آخر نشاط</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="p-8 text-center font-bold text-slate-500">
                  جاري التحميل...
                </td>
              </tr>
            ) : visibleRows.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-8 text-center font-bold text-slate-500">
                  {showIdle ? 'لا توجد جلسات نشطة' : 'لا يوجد مستخدم متصل الآن'}
                </td>
              </tr>
            ) : (
              visibleRows.map((row) => {
                const online = isOnlineNow(row.lastSeenAt);
                const PlatformIcon = platformIcon(row.clientPlatform);
                return (
                  <tr key={row.sessionKey} className="border-t border-slate-100">
                    <td className="p-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-black ${
                          online ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                        }`}
                      >
                        {online ? 'متصل الآن' : 'خامل'}
                      </span>
                    </td>
                    <td className="p-3 font-mono text-base font-black text-slate-900">{row.username}</td>
                    <td className="p-3 font-bold text-slate-700">{row.fullName || '—'}</td>
                    <td className="p-3">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-black ${platformBadgeClass(row.clientPlatform)}`}
                      >
                        <PlatformIcon className="h-3.5 w-3.5" />
                        {row.clientPlatformLabel}
                      </span>
                    </td>
                    <td className="p-3 font-mono font-bold text-slate-800" dir="ltr">
                      {row.ip}
                    </td>
                    <td className="p-3 text-slate-700">{formatDateTime(row.lastSeenAt)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-500">
        «متصل الآن» = نشاط خلال آخر دقيقتين. تُزال الجلسة بعد 5 دقائق بدون نشاط.
      </p>
    </div>
  );
};
