import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Globe, LogOut, Monitor, RefreshCw, Smartphone, Wifi } from 'lucide-react';
import {
  fetchActiveSessions,
  revokeActiveSession,
  type ActiveSessionDto,
} from '../../lib/api/settingsApi';
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
  const [currentSessionKey, setCurrentSessionKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [revokingKey, setRevokingKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchActiveSessions();
      setRows(res.data);
      setCurrentSessionKey(res.currentSessionKey);
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
  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const aOnline = isOnlineNow(a.lastSeenAt) ? 1 : 0;
      const bOnline = isOnlineNow(b.lastSeenAt) ? 1 : 0;
      if (aOnline !== bOnline) return bOnline - aOnline;
      return new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime();
    });
  }, [rows]);

  const handleRevoke = async (row: ActiveSessionDto) => {
    const isSelf = row.sessionKey === currentSessionKey;
    const label = isSelf ? 'جلستك الحالية' : `حساب ${row.username}`;
    const ok = window.confirm(`تسجيل خروج ${label} من هذا الجهاز؟`);
    if (!ok) return;

    setRevokingKey(row.sessionKey);
    try {
      await revokeActiveSession(row.sessionKey);
      showToast({ type: 'success', message: `تم تسجيل خروج ${row.username} من الجهاز` });
      await load();
    } catch (error) {
      showToast({
        type: 'error',
        message: error instanceof Error ? error.message : 'تعذر تسجيل الخروج عن الجهاز',
      });
    } finally {
      setRevokingKey(null);
    }
  };

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-xl font-black text-[var(--text-heading)]">الأجهزة النشطة</h3>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            جميع الأجهزة المتصلة خلال آخر 5 دقائق — مع إمكانية تسجيل الخروج عن أي جهاز.
          </p>
        </div>
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
            <span className="text-sm font-bold">إجمالي الجلسات (5 دقائق)</span>
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
              <th className="p-3 text-center font-black">إجراء</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="p-8 text-center font-bold text-slate-500">
                  جاري التحميل...
                </td>
              </tr>
            ) : sortedRows.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-8 text-center font-bold text-slate-500">
                  لا توجد أجهزة نشطة حالياً
                </td>
              </tr>
            ) : (
              sortedRows.map((row) => {
                const online = isOnlineNow(row.lastSeenAt);
                const isSelf = row.sessionKey === currentSessionKey;
                const PlatformIcon = platformIcon(row.clientPlatform);
                return (
                  <tr
                    key={row.sessionKey}
                    className={`border-t border-slate-100 ${isSelf ? 'bg-indigo-50/40' : ''}`}
                  >
                    <td className="p-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-black ${
                          online ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                        }`}
                      >
                        {online ? 'متصل الآن' : 'خامل'}
                      </span>
                      {isSelf && (
                        <span className="mr-2 inline-flex rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-black text-indigo-700">
                          جهازك
                        </span>
                      )}
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
                    <td className="p-3 text-center">
                      <button
                        type="button"
                        disabled={revokingKey === row.sessionKey}
                        onClick={() => void handleRevoke(row)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-black text-rose-700 hover:bg-rose-100 disabled:opacity-60"
                        title={isSelf ? 'تسجيل خروج من هذا الجهاز' : `تسجيل خروج ${row.username}`}
                      >
                        <LogOut className="h-3.5 w-3.5" />
                        {revokingKey === row.sessionKey ? 'جاري...' : 'تسجيل خروج'}
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-500">
        يُحدَّث النشاط تلقائياً كل 45 ثانية لكل مستخدم داخل النظام. تُزال الجلسة بعد 5 دقائق بدون نشاط.
      </p>
    </div>
  );
};
