import React, { useEffect, useState } from 'react';
import { CheckCircle2, KeyRound, Loader2, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import { ActivationKeyInput } from './ActivationKeyInput';
import {
  generateActivationKeys,
  getActivationStatus,
  listActivationEvents,
  listActivationKeys,
  revokeActivationKey,
  type ActivationEventDto,
  type ActivationKeyAdminDto,
  type ActivationPlanCode,
  type ActivationStatusDto,
} from '../../lib/api/activationApi';
import { ApiRequestError } from '../../lib/api/client';

const planLabels: Record<ActivationPlanCode, string> = {
  LITE: 'LITE',
  PRO: 'PRO',
  FULL: 'FULL',
};

function formatDate(value?: string | null) {
  if (!value) return '-';
  try {
    return new Intl.DateTimeFormat('ar-SY', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  } catch {
    return value;
  }
}

export function ActivationSettingsPanel() {
  const [status, setStatus] = useState<ActivationStatusDto>({ active: false });
  const [keys, setKeys] = useState<ActivationKeyAdminDto[]>([]);
  const [events, setEvents] = useState<ActivationEventDto[]>([]);
  const [generatedKeys, setGeneratedKeys] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [generateCount, setGenerateCount] = useState(5);
  const [planCode, setPlanCode] = useState<ActivationPlanCode>('FULL');

  const load = async () => {
    setLoading(true);
    setMessage('');
    try {
      const [nextStatus, nextKeys] = await Promise.all([
        getActivationStatus(),
        listActivationKeys().catch(() => []),
      ]);
      const nextEvents = await listActivationEvents().catch(() => []);
      setStatus(nextStatus);
      setKeys(nextKeys);
      setEvents(nextEvents);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'تعذر تحميل حالة التفعيل.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleActivated = (next: ActivationStatusDto) => {
    setStatus(next);
    load();
  };

  const handleGenerate = async () => {
    setBusy(true);
    setMessage('');
    setGeneratedKeys([]);
    try {
      const result = await generateActivationKeys(generateCount, planCode);
      setGeneratedKeys(result.keys);
      setMessage(result.warning);
      await load();
    } catch (error) {
      setMessage(error instanceof ApiRequestError ? error.message : 'تعذر توليد مفاتيح جديدة.');
    } finally {
      setBusy(false);
    }
  };

  const handleRevoke = async (id: string) => {
    setBusy(true);
    setMessage('');
    try {
      await revokeActivationKey(id);
      await load();
      setMessage('تم إيقاف مفتاح التفعيل.');
    } catch (error) {
      setMessage(error instanceof ApiRequestError ? error.message : 'تعذر إيقاف المفتاح.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-[var(--surface-header)] border border-[var(--border-default)] rounded-xl shadow-sm p-6 transition-colors space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-xl font-bold text-[var(--text-heading)] flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-[var(--ui-accent)]" />
            تفعيل النظام
          </h3>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            التفعيل يدار من الخادم فقط: التوليد من لوحة المسؤول أدناه، التخزين في قاعدة البيانات كـ hash، ولا يُستخدم ملف محلي مثل activation-keys.txt. الجدول يعرض لاحقة المفتاح والحالة فقط.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="bg-[var(--surface-header)] border border-[var(--border-default)] text-[var(--text-heading)] px-3 py-2 rounded-lg flex items-center gap-2 hover:bg-[var(--surface-muted-nav)] transition text-sm font-bold disabled:opacity-60"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          تحديث
        </button>
      </div>

      {message && (
        <div className="border border-[var(--border-default)] bg-[var(--surface-muted-nav)] rounded-lg px-3 py-2 text-sm font-bold text-[var(--text-heading)]">
          {message}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="border border-[var(--border-default)] rounded-xl p-4">
          <div className="text-xs text-[var(--text-muted)] font-bold mb-2">حالة التفعيل</div>
          <div className="flex items-center gap-2 text-lg font-black text-[var(--text-heading)]">
            {status.active ? <CheckCircle2 className="w-5 h-5 text-emerald-500" /> : <XCircle className="w-5 h-5 text-rose-500" />}
            {status.active ? 'النظام مفعّل' : 'غير مفعّل'}
          </div>
        </div>
        <div className="border border-[var(--border-default)] rounded-xl p-4">
          <div className="text-xs text-[var(--text-muted)] font-bold mb-2">الخطة</div>
          <div className="text-lg font-black text-[var(--text-heading)]">{status.planCode ? planLabels[status.planCode] : '-'}</div>
        </div>
        <div className="border border-[var(--border-default)] rounded-xl p-4">
          <div className="text-xs text-[var(--text-muted)] font-bold mb-2">تاريخ التفعيل</div>
          <div className="text-sm font-bold text-[var(--text-heading)]">{formatDate(status.activatedAt)}</div>
        </div>
        <div className="border border-[var(--border-default)] rounded-xl p-4">
          <div className="text-xs text-[var(--text-muted)] font-bold mb-2">آخر 4 رموز</div>
          <div className="text-lg font-black text-[var(--ui-accent)] font-mono" dir="ltr">{status.keySuffix ? `****${status.keySuffix}` : '-'}</div>
        </div>
      </div>

      {!status.active && (
        <div className="border border-[var(--border-default)] rounded-xl p-4">
          <ActivationKeyInput onActivated={handleActivated} />
        </div>
      )}

      <div className="border border-[var(--border-default)] rounded-xl overflow-hidden">
        <div className="px-4 py-3 bg-[var(--surface-muted-nav)] border-b border-[var(--border-default)] flex items-center justify-between gap-3 flex-wrap">
          <div className="font-bold text-[var(--text-heading)] flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-[var(--ui-accent)]" />
            مفاتيح التفعيل
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={100}
              value={generateCount}
              onChange={(event) => setGenerateCount(Number(event.target.value))}
              className="w-20 p-2 bg-[var(--surface-header)] border border-[var(--border-default)] rounded-lg text-[var(--text-heading)]"
            />
            <select
              value={planCode}
              onChange={(event) => setPlanCode(event.target.value as ActivationPlanCode)}
              className="p-2 bg-[var(--surface-header)] border border-[var(--border-default)] rounded-lg text-[var(--text-heading)]"
            >
              <option value="FULL">FULL</option>
              <option value="PRO">PRO</option>
              <option value="LITE">LITE</option>
            </select>
            <button type="button" onClick={handleGenerate} disabled={busy} className="bg-[var(--ui-accent)] text-white px-3 py-2 rounded-lg font-bold text-sm disabled:opacity-60">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'توليد'}
            </button>
          </div>
        </div>

        {generatedKeys.length > 0 && (
          <div className="m-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
            <div className="font-black mb-2">انسخ المفاتيح الآن. لن تظهر مرة أخرى.</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 font-mono text-sm" dir="ltr">
              {generatedKeys.map((key) => <div key={key} className="rounded bg-white px-3 py-2 border border-amber-100">{key}</div>)}
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[var(--surface-muted-nav)] text-[var(--text-muted)]">
              <tr>
                <th className="p-3 text-right">آخر 4 رموز</th>
                <th className="p-3 text-right">الحالة</th>
                <th className="p-3 text-right">الخطة</th>
                <th className="p-3 text-right">الاستخدام</th>
                <th className="p-3 text-right">تاريخ التفعيل</th>
                <th className="p-3 text-right">إجراء</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((item) => (
                <tr key={item.id} className="border-t border-[var(--border-subtle)]">
                  <td className="p-3 font-mono text-[var(--ui-accent)]" dir="ltr">****{item.key_suffix}</td>
                  <td className="p-3 font-bold text-[var(--text-heading)]">{item.status}</td>
                  <td className="p-3 text-[var(--text-heading)]">{item.plan_code}</td>
                  <td className="p-3 text-[var(--text-muted)]">{item.activation_count} / {item.max_activations}</td>
                  <td className="p-3 text-[var(--text-muted)]">{formatDate(item.activated_at)}</td>
                  <td className="p-3">
                    <button
                      type="button"
                      disabled={busy || item.status === 'REVOKED'}
                      onClick={() => handleRevoke(item.id)}
                      className="px-3 py-1.5 rounded-lg border border-rose-200 text-rose-700 bg-rose-50 font-bold text-xs disabled:opacity-50"
                    >
                      إيقاف
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && keys.length === 0 && (
                <tr><td colSpan={6} className="p-6 text-center text-[var(--text-muted)]">لا توجد مفاتيح تفعيل.</td></tr>
              )}
              {loading && (
                <tr><td colSpan={6} className="p-6 text-center text-[var(--text-muted)]">جاري التحميل...</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="border border-[var(--border-default)] rounded-xl overflow-hidden">
        <div className="px-4 py-3 bg-[var(--surface-muted-nav)] border-b border-[var(--border-default)] font-bold text-[var(--text-heading)]">
          سجل أحداث التفعيل
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[var(--surface-muted-nav)] text-[var(--text-muted)]">
              <tr>
                <th className="p-3 text-right">الحدث</th>
                <th className="p-3 text-right">آخر 4 رموز</th>
                <th className="p-3 text-right">الرسالة</th>
                <th className="p-3 text-right">التاريخ</th>
              </tr>
            </thead>
            <tbody>
              {events.slice(0, 25).map((event) => (
                <tr key={event.id} className="border-t border-[var(--border-subtle)]">
                  <td className="p-3 font-bold text-[var(--text-heading)]">{event.event_type}</td>
                  <td className="p-3 font-mono text-[var(--ui-accent)]" dir="ltr">{event.key_suffix ? `****${event.key_suffix}` : '-'}</td>
                  <td className="p-3 text-[var(--text-muted)]">{event.message || '-'}</td>
                  <td className="p-3 text-[var(--text-muted)]">{formatDate(event.created_at)}</td>
                </tr>
              ))}
              {!loading && events.length === 0 && (
                <tr><td colSpan={4} className="p-6 text-center text-[var(--text-muted)]">لا توجد أحداث تفعيل.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
