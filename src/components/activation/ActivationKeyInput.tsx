import React, { useMemo, useState } from 'react';
import { KeyRound, Loader2 } from 'lucide-react';
import { activateProject, type ActivationStatusDto } from '../../lib/api/activationApi';
import { ApiRequestError } from '../../lib/api/client';

const KEY_REGEX = /^[A-Z0-9]{4}\.[A-Z0-9]{4}\.[A-Z0-9]{4}\.[A-Z0-9]{4}$/;

export function formatActivationKey(value: string): string {
  const normalized = value
    .toUpperCase()
    .replace(/-/g, '.')
    .replace(/[^A-Z0-9.]/g, '')
    .replace(/\.+/g, '.');

  const compact = normalized.replace(/\./g, '').slice(0, 16);
  return compact.match(/.{1,4}/g)?.join('.') ?? compact;
}

type ActivationKeyInputProps = {
  onActivated?: (status: ActivationStatusDto) => void;
  compact?: boolean;
  className?: string;
  /** Focus key field when mounted (e.g. login activation modal). */
  autoFocus?: boolean;
};

export function ActivationKeyInput({
  onActivated,
  compact = false,
  className = '',
  autoFocus = false,
}: ActivationKeyInputProps) {
  const [key, setKey] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const isValid = useMemo(() => KEY_REGEX.test(key), [key]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setStatus('');
    if (!isValid) {
      setError('صيغة المفتاح يجب أن تكون XXXX.XXXX.XXXX.XXXX');
      return;
    }

    setLoading(true);
    try {
      const result = await activateProject(key);
      setStatus('تم تفعيل النظام بنجاح.');
      setKey('');
      window.dispatchEvent(new CustomEvent('clotex:activation-updated'));
      window.setTimeout(() => onActivated?.(result), 400);
    } catch (err) {
      const message = err instanceof ApiRequestError ? err.message : 'تعذر تفعيل النظام. تحقق من المفتاح وحاول مجدداً.';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className={`space-y-3 ${className}`}>
      <label className="space-y-1.5 block">
        <span className={`font-bold ${compact ? 'text-xs text-slate-200' : 'text-sm text-[var(--text-heading)]'}`}>
          مفتاح التفعيل
        </span>
        <div className="relative">
          <input
            type="text"
            inputMode="text"
            autoComplete="off"
            autoFocus={autoFocus}
            value={key}
            onChange={(event) => setKey(formatActivationKey(event.target.value))}
            placeholder="XXXX.XXXX.XXXX.XXXX"
            className={`w-full rounded-xl border px-4 py-3 pl-11 font-mono text-[15px] tracking-[0.08em] outline-none transition ${
              compact
                ? 'border-white/10 bg-white/[0.06] text-white placeholder:text-slate-500 focus:border-indigo-400/60 focus:ring-4 focus:ring-indigo-500/20'
                : 'border-[var(--border-default)] bg-[var(--surface-header)] text-[var(--text-heading)] placeholder:text-[var(--text-muted)] focus:ring-2 focus:ring-[var(--ui-accent)]'
            }`}
            dir="ltr"
            maxLength={19}
          />
          <KeyRound className={`absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 ${compact ? 'text-slate-400' : 'text-[var(--text-muted)]'}`} />
        </div>
      </label>

      {error && (
        <div role="alert" className={`rounded-xl px-3 py-2 text-[13px] font-bold ${compact ? 'border border-rose-400/30 bg-rose-500/10 text-rose-200' : 'border border-rose-200 bg-rose-50 text-rose-700'}`}>
          {error}
        </div>
      )}
      {status && (
        <div className={`rounded-xl px-3 py-2 text-[13px] font-bold ${compact ? 'border border-emerald-400/30 bg-emerald-500/10 text-emerald-200' : 'border border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
          {status}
        </div>
      )}

      <button
        type="submit"
        disabled={loading || !isValid}
        className={`inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-60 ${
          compact
            ? 'bg-gradient-to-l from-emerald-500 to-teal-500 text-white shadow-lg shadow-emerald-600/20'
            : 'bg-[var(--ui-accent)] text-white hover:opacity-95'
        }`}
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
        تفعيل النظام
      </button>
    </form>
  );
}
