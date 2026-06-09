/**
 * Electron packaged: warns when bundled Fastify is not reachable, or when the
 * server is up but PostgreSQL still fails (/api/health ≠ 200).
 */

import React, { useEffect, useState } from 'react';
import type { ElectronBootConnectionInfo } from '../../../electron/types';

export const StartupConnectionBanner: React.FC = () => {
  const [boot, setBoot] = useState<ElectronBootConnectionInfo | null>(null);
  const [dismissHealthy, setDismissHealthy] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryHint, setRetryHint] = useState<string | undefined>();

  useEffect(() => {
    const fa = typeof window !== 'undefined' ? window.fabricApp : undefined;
    if (!fa?.onBootConnectionInfo) return undefined;
    const off = fa.onBootConnectionInfo(setBoot);
    return off;
  }, []);

  async function probeNow(): Promise<void> {
    const fa = window.fabricApp;
    if (!fa?.getApiBaseUrl) return;
    setRetrying(true);
    setRetryHint(undefined);
    try {
      const resolved = await fa.getApiBaseUrl();
      if (!resolved.trim()) {
        setRetryHint('لم يُضبط عنوان الـ API بعد التحقّق المحلي.');
        setRetrying(false);
        return;
      }
      const base = resolved.replace(/\/$/, '');
      const liveUrl = `${base}/api/health/live`;
      const liveR = await fetch(liveUrl, { method: 'GET', signal: AbortSignal.timeout(12000) });
      if (!liveR.ok) {
        setRetryHint(`الخادم لا يستجيب (live HTTP ${liveR.status})`);
        setRetrying(false);
        return;
      }
      const healthUrl = `${base}/api/health`;
      const r = await fetch(healthUrl, { method: 'GET', signal: AbortSignal.timeout(12000) });
      if (r.ok) {
        setDismissHealthy(true);
      } else {
        setRetryHint(`الخادم يعمل لكن قاعدة البيانات غير جاهزة (HTTP ${r.status})`);
      }
    } catch (e) {
      setRetryHint(e instanceof Error ? e.message : String(e));
    } finally {
      setRetrying(false);
    }
  }

  const fa = typeof window !== 'undefined' ? window.fabricApp : undefined;
  const serverListening = Boolean(boot?.apiHealthOk);
  const dbDisconnected = Boolean(boot?.packaged && serverListening && boot.apiDatabaseHealthy === false);

  const show =
    fa?.isElectron &&
    boot &&
    !dismissHealthy &&
    (!serverListening || dbDisconnected);

  if (!show || !boot) return null;

  const apiAddr = boot.apiBaseUrl || '(لم يُضبط عنوان الـ API)';

  if (dbDisconnected) {
    return (
      <div className="fixed top-0 left-0 right-0 z-[10000] rtl text-right px-4 py-3 shadow-md border-b border-amber-900/30 bg-amber-50 text-slate-900 text-sm leading-relaxed">
        <strong className="block text-amber-950 mb-1">تحذير — قاعدة البيانات</strong>
        <p className="mb-2">
          الخادم المحلي يعمل على{' '}
          <code className="bg-white/70 px-1 rounded-sm text-xs break-all">{apiAddr}</code>
          ولكن لم يتم الاتصال بـ PostgreSQL (فحص SSH، النفق، أو كلمة مرور القاعدة).
        </p>
        <ul className="text-xs text-slate-700 mb-2 list-disc pr-5 space-y-1">
          <li>راجع clotex-main.log و clotex-server.log وملف clotex-tunnel.log أو tunnel.log.</li>
          <li>تأكد من أن منفذ قاعدة البيانات المحليّ في الإعداد لا يُستخدم من برنامج آخر.</li>
        </ul>
        {(boot.postgresTunnelError || retryHint) && (
          <p className="text-xs text-slate-500 mb-2" dir="ltr">
            تفنية: {[boot.postgresTunnelError, retryHint].filter(Boolean).join(' • ')}
          </p>
        )}
        <button
          type="button"
          disabled={retrying}
          onClick={() => probeNow()}
          className="text-xs font-bold px-3 py-1.5 rounded-lg bg-amber-700 text-white hover:bg-amber-800 disabled:opacity-60"
        >
          {retrying ? 'جارٍ التحقّق…' : 'إعادة التحقّق من الخادم وقاعدة البيانات'}
        </button>
      </div>
    );
  }

  return (
    <div className="fixed top-0 left-0 right-0 z-[10000] rtl text-right px-4 py-3 shadow-md border-b border-amber-900/30 bg-amber-50 text-slate-900 text-sm leading-relaxed">
      <strong className="block text-amber-950 mb-1">تحذير اتصال — خادم CLOTEX</strong>
      <p className="mb-2">
        تعذّر الاتصال بخادم CLOTEX على العنوان:&nbsp;
        <code className="bg-white/70 px-1 rounded-sm text-xs break-all">{apiAddr}</code>
      </p>
      <ul className="text-xs text-slate-700 mb-2 list-disc pr-5 space-y-1">
        <li>التطبيق يشغّل خادم API محليّاً على هذا الجهاز؛ تحقَّق أن المنفذ 4010 متاح وليس مستخدماً من برنامج آخر.</li>
        <li>الاتصال بقاعدة PostgreSQL على الـ VPS عبر SSH: راجع كلمة مرور SSH و sshHostKey وملف clotex-main.log أو clotex-server.log ضمن مجلّد بيانات التطبيق.</li>
        <li>اختبر شبكة الإنترنت وإعدادات VPS وملفات resources/config بعد التثبيت.</li>
      </ul>
      {boot.apiHealthError || retryHint ? (
        <p className="text-xs text-slate-500 mb-2" dir="ltr">
          تفنية: {[boot.apiHealthError, retryHint].filter(Boolean).join(' • ')}
        </p>
      ) : null}
      <button
        type="button"
        disabled={retrying}
        onClick={() => probeNow()}
        className="text-xs font-bold px-3 py-1.5 rounded-lg bg-amber-700 text-white hover:bg-amber-800 disabled:opacity-60"
      >
        {retrying ? 'جارٍ التحقّق…' : 'إعادة التحقّق من الخادم'}
      </button>
    </div>
  );
};
