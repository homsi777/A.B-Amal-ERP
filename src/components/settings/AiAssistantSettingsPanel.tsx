import React, { useCallback, useEffect, useState } from 'react';
import { Bot, Check, Loader2, Save, ShieldCheck } from 'lucide-react';
import {
  getAiSettings,
  OPENAI_MODEL_OPTIONS,
  testAiConnection,
  updateAiSettings,
  type AiSettingsDto,
} from '../../lib/api/aiApi';

export function AiAssistantSettingsPanel() {
  const [settings, setSettings] = useState<AiSettingsDto | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [model, setModel] = useState('gpt-4o-mini');
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');

  const ringCls = 'focus:outline-none focus:ring-2 focus:ring-[var(--ui-accent)]';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const row = await getAiSettings();
      setSettings(row);
      setEnabled(row.enabled);
      setModel(row.model || 'gpt-4o-mini');
      setApiKey('');
    } catch {
      setStatus('تعذر تحميل إعدادات المساعد.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const notifyChanged = () => {
    window.dispatchEvent(new Event('clotex-ai-settings-changed'));
  };

  const save = async () => {
    setLoading(true);
    setStatus('');
    try {
      if (apiKey.trim() && !apiKey.trim().startsWith('sk-')) {
        setStatus('مفتاح OpenAI غير صالح. يجب أن يبدأ بـ sk-.');
        return;
      }
      const row = await updateAiSettings({
        enabled,
        model,
        apiKey: apiKey.trim() || undefined,
      });
      setSettings(row);
      setApiKey('');
      setStatus('تم حفظ إعدادات مساعد CLOTEX.');
      notifyChanged();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'فشل الحفظ.');
    } finally {
      setLoading(false);
    }
  };

  const testConnection = async () => {
    setLoading(true);
    setStatus('');
    try {
      if (apiKey.trim() && !apiKey.trim().startsWith('sk-')) {
        setStatus('مفتاح OpenAI غير صالح. يجب أن يبدأ بـ sk-.');
        return;
      }
      const result = await testAiConnection(apiKey.trim() || undefined);
      setStatus(`نجح الاتصال — النموذج: ${result.model}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'فشل اختبار الاتصال.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--ui-accent-soft-bg)] text-[var(--ui-accent)]">
          <Bot className="h-5 w-5" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-[var(--text-heading)]">إعدادات مساعد CLOTEX</h3>
          <p className="text-sm text-[var(--text-muted)]">
            مساعد ذكاء اصطناعي خاص ببيانات مشروع الأقمشة فقط — المفتاح يُخزَّن مشفّراً على الخادم.
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-header)] p-5 space-y-5">
        <label className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-[var(--text-heading)]">تفعيل مساعد CLOTEX</span>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-4 accent-[var(--ui-accent)]"
          />
        </label>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-[var(--text-heading)]">
            مفتاح OpenAI API
          </label>
          {settings?.hasApiKey && (
            <p className="mb-2 flex items-center gap-1 text-xs text-[var(--text-muted)]">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
              المفتاح المحفوظ: {settings.maskedApiKey || 'sk-••••••••'}
            </p>
          )}
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={settings?.hasApiKey ? 'اتركه فارغاً للإبقاء على المفتاح المحفوظ' : 'sk-...'}
            autoComplete="off"
            className={`w-full rounded-xl border border-[var(--border-default)] bg-[var(--surface-header)] px-3 py-2.5 text-sm ${ringCls}`}
          />
          <p className="mt-1 text-xs text-[var(--text-muted)]">يُقبل فقط مفاتيح OpenAI التي تبدأ بـ sk-</p>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-[var(--text-heading)]">نموذج OpenAI</label>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className={`w-full rounded-xl border border-[var(--border-default)] bg-[var(--surface-header)] px-3 py-2.5 text-sm ${ringCls}`}
          >
            {OPENAI_MODEL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void testConnection()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--surface-header)] px-4 py-2 text-sm hover:bg-[var(--surface-muted-nav)] disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            اختبار الاتصال
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--ui-accent)] px-4 py-2 text-sm text-white hover:opacity-95 disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            حفظ
          </button>
        </div>

        {status && (
          <p className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-muted-nav)] px-3 py-2 text-sm text-[var(--text-heading)]">
            {status}
          </p>
        )}
      </div>
    </div>
  );
}
