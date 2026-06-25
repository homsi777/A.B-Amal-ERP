import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, Check, ExternalLink, Loader2, Save, ShieldCheck } from 'lucide-react';
import {
  AI_KEY_HINTS,
  AI_MODEL_OPTIONS,
  AI_PROVIDER_OPTIONS,
  apiKeyValidationMessage,
  getAiSettings,
  isValidApiKeyForProvider,
  testAiConnection,
  updateAiSettings,
  type AiProvider,
  type AiSettingsDto,
} from '../../lib/api/aiApi';

export function AiAssistantSettingsPanel() {
  const [settings, setSettings] = useState<AiSettingsDto | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [provider, setProvider] = useState<AiProvider>('gemini');
  const [model, setModel] = useState('gemini-2.0-flash');
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [statusKind, setStatusKind] = useState<'ok' | 'error' | ''>('');

  const ringCls = 'focus:outline-none focus:ring-2 focus:ring-[var(--ui-accent)]';
  const modelOptions = useMemo(() => AI_MODEL_OPTIONS[provider], [provider]);
  const providerMeta = useMemo(
    () => AI_PROVIDER_OPTIONS.find((p) => p.value === provider) ?? AI_PROVIDER_OPTIONS[0],
    [provider],
  );
  const keyMeta = AI_KEY_HINTS[provider];

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const row = await getAiSettings();
      setSettings(row);
      setEnabled(row.enabled);
      setProvider(row.provider || 'gemini');
      setModel(row.model || AI_MODEL_OPTIONS[row.provider || 'gemini'][0].value);
      setApiKey('');
    } catch {
      setStatusKind('error');
      setStatus('تعذر تحميل إعدادات المساعد.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onProviderChange = (next: AiProvider) => {
    setProvider(next);
    setModel(AI_MODEL_OPTIONS[next][0].value);
    setApiKey('');
  };

  const notifyChanged = () => {
    window.dispatchEvent(new Event('clotex-ai-settings-changed'));
  };

  const save = async () => {
    setLoading(true);
    setStatus('');
    setStatusKind('');
    try {
      if (apiKey.trim() && !isValidApiKeyForProvider(provider, apiKey)) {
        setStatusKind('error');
        setStatus(apiKeyValidationMessage(provider));
        return;
      }
      const row = await updateAiSettings({
        enabled,
        provider,
        model,
        apiKey: apiKey.trim() || undefined,
      });
      setSettings(row);
      setApiKey('');
      setStatusKind('ok');
      setStatus('تم حفظ إعدادات مساعد CLOTEX.');
      notifyChanged();
    } catch (error) {
      setStatusKind('error');
      setStatus(error instanceof Error ? error.message : 'فشل الحفظ.');
    } finally {
      setLoading(false);
    }
  };

  const testConnection = async () => {
    setLoading(true);
    setStatus('');
    setStatusKind('');
    try {
      if (apiKey.trim() && !isValidApiKeyForProvider(provider, apiKey)) {
        setStatusKind('error');
        setStatus(apiKeyValidationMessage(provider));
        return;
      }
      const result = await testAiConnection(apiKey.trim() || undefined, model, provider);
      if (result.success) {
        setStatusKind('ok');
        setStatus(`نجح الاتصال — ${providerMeta.label} — النموذج: ${result.model}`);
      } else {
        setStatusKind('error');
        setStatus(result.message);
      }
    } catch (error) {
      setStatusKind('error');
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
            مساعد ذكاء اصطناعي خاص ببيانات مشروع الأقمشة — المفتاح يُخزَّن مشفّراً على الخادم.
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
          <label className="mb-1.5 block text-sm font-medium text-[var(--text-heading)]">مزود الذكاء الاصطناعي</label>
          <select
            value={provider}
            onChange={(e) => onProviderChange(e.target.value as AiProvider)}
            className={`w-full rounded-xl border border-[var(--border-default)] bg-[var(--surface-header)] px-3 py-2.5 text-sm ${ringCls}`}
          >
            {AI_PROVIDER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <a
            href={providerMeta.docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1.5 inline-flex items-center gap-1 text-xs text-[var(--ui-accent)] hover:underline"
          >
            إنشاء مفتاح API
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-[var(--text-heading)]">مفتاح API</label>
          {settings?.hasApiKey && (
            <p className="mb-2 flex items-center gap-1 text-xs text-[var(--text-muted)]">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
              المفتاح المحفوظ: {settings.maskedApiKey || '••••••••'}
            </p>
          )}
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={settings?.hasApiKey ? 'اتركه فارغاً للإبقاء على المفتاح المحفوظ' : keyMeta.placeholder}
            autoComplete="off"
            className={`w-full rounded-xl border border-[var(--border-default)] bg-[var(--surface-header)] px-3 py-2.5 text-sm ${ringCls}`}
          />
          <p className="mt-1 text-xs text-[var(--text-muted)]">{keyMeta.hint}</p>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-[var(--text-heading)]">النموذج</label>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className={`w-full rounded-xl border border-[var(--border-default)] bg-[var(--surface-header)] px-3 py-2.5 text-sm ${ringCls}`}
          >
            {modelOptions.map((opt) => (
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
          <p
            className={`rounded-lg border px-3 py-2 text-sm ${
              statusKind === 'ok'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                : statusKind === 'error'
                  ? 'border-red-200 bg-red-50 text-red-800'
                  : 'border-[var(--border-subtle)] bg-[var(--surface-muted-nav)] text-[var(--text-heading)]'
            }`}
            role="status"
          >
            {status}
          </p>
        )}
      </div>
    </div>
  );
}
