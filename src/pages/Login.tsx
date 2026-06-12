import React, { useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  LogIn,
  Eye,
  EyeOff,
  Boxes,
  ShoppingCart,
  BarChart3,
  Printer,
  ShieldCheck,
  Loader2,
  KeyRound,
  X,
} from 'lucide-react';
import { loginApi } from '../lib/api/authApi';
import { ApiRequestError } from '../lib/api/client';
import { BackendConnectionBadge } from '../components/BackendConnectionBadge';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { BRAND } from '../branding';
import { ActivationKeyInput } from '../components/activation/ActivationKeyInput';
import { getActivationStatus, type ActivationStatusDto } from '../lib/api/activationApi';

export const Login = () => {
  const { t, i18n } = useTranslation('login');
  const pageDir = i18n.language === 'tr' ? 'ltr' : 'rtl';
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [activationStatus, setActivationStatus] = useState<ActivationStatusDto | null>(null);
  const [activationChecked, setActivationChecked] = useState(false);
  const [activationStatusError, setActivationStatusError] = useState('');
  const [activationModalOpen, setActivationModalOpen] = useState(false);
  const activationModalTitleId = useId();

  const features = useMemo(
    () => [
      { icon: Boxes, titleKey: 'feature.rolls.title', descriptionKey: 'feature.rolls.description' },
      { icon: ShoppingCart, titleKey: 'feature.purchase.title', descriptionKey: 'feature.purchase.description' },
      { icon: BarChart3, titleKey: 'feature.reports.title', descriptionKey: 'feature.reports.description' },
      { icon: Printer, titleKey: 'feature.print.title', descriptionKey: 'feature.print.description' },
    ],
    [],
  );

  const loadActivationStatus = async () => {
    try {
      setActivationStatusError('');
      setActivationStatus(await getActivationStatus());
    } catch (err) {
      setActivationStatus(null);
      setActivationStatusError(err instanceof Error ? err.message : t('activation.statusError'));
    } finally {
      setActivationChecked(true);
    }
  };

  useEffect(() => {
    loadActivationStatus();
  }, []);

  const isActivated = activationStatus?.active === true;
  const canLogin = activationChecked && isActivated && !activationStatusError;

  useEffect(() => {
    if (!activationModalOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActivationModalOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activationModalOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canLogin) return;
    setError('');
    setLoading(true);
    try {
      await loginApi(username, password);
      const requestedRedirect = searchParams.get('redirect') ?? '';
      const safeRedirect =
        requestedRedirect.startsWith('/') && !requestedRedirect.startsWith('//')
          ? requestedRedirect
          : '/';
      navigate(safeRedirect, { replace: true });
    } catch (err) {
      const msg =
        err instanceof ApiRequestError
          ? err.message
          : t('loginFailed');
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const inputDisabledClass =
    'disabled:cursor-not-allowed disabled:border-white/5 disabled:bg-white/[0.03] disabled:text-slate-500 disabled:placeholder:text-slate-600';

  return (
    <div
      dir={pageDir}
      className="relative min-h-screen w-full overflow-hidden bg-[#0b0820] text-slate-100"
    >
      {/* ── Activation entry (top-left) ───────────────────────────────────── */}
      <button
        type="button"
        onClick={() => setActivationModalOpen(true)}
        className={`fixed left-6 top-6 z-[60] flex items-center gap-2 rounded-full border px-3 py-2 shadow-lg backdrop-blur-md transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0820] ${
          !activationChecked
            ? 'border-white/15 bg-white/10 text-slate-200'
            : isActivated
              ? 'border-emerald-400/45 bg-emerald-500/[0.12] text-emerald-100 shadow-emerald-900/20'
              : 'border-amber-400/45 bg-amber-500/[0.12] text-amber-100 shadow-amber-900/25'
        }`}
        title={isActivated ? t('activation.activated') : t('activation.activateTitle')}
        aria-label={isActivated ? t('activation.activatedAria') : t('activation.activateAria')}
      >
        {!activationChecked ? (
          <Loader2 className="h-5 w-5 shrink-0 animate-spin opacity-90" aria-hidden />
        ) : (
          <KeyRound className="h-5 w-5 shrink-0 opacity-95" aria-hidden />
        )}
        {activationChecked && isActivated && (
          <span className="hidden text-[11px] font-bold tracking-wide sm:inline" dir="ltr">
            {t('activation.activatedBadge')}
          </span>
        )}
        {activationChecked && !isActivated && (
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-50" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-300" />
          </span>
        )}
      </button>

      {/* ── Background gradient + soft light orbs ─────────────────────────── */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(1200px 700px at 85% 15%, rgba(99,102,241,0.32), transparent 60%),' +
            'radial-gradient(900px 600px at 10% 90%, rgba(139,92,246,0.22), transparent 65%),' +
            'linear-gradient(160deg, #0b0820 0%, #120a36 55%, #1a0d4d 100%)',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.18]"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(255,255,255,0.06) 1px, transparent 1px),' +
            'linear-gradient(to bottom, rgba(255,255,255,0.06) 1px, transparent 1px)',
          backgroundSize: '56px 56px',
          maskImage:
            'radial-gradient(ellipse at center, rgba(0,0,0,0.6), transparent 70%)',
        }}
      />

      {/* ── Top utility bar ───────────────────────────────────────────────── */}
      <header className="relative z-10 flex items-center justify-between px-8 py-5">
        <div className="flex items-center gap-3 rounded-full border border-white/10 bg-white/5 px-4 py-2 backdrop-blur-md">
          <div className="grid h-12 w-12 place-items-center rounded-xl bg-white shadow-lg shadow-indigo-500/20">
            <img
              src={BRAND.logoPng}
              alt={BRAND.name}
              className="h-10 w-10 object-contain"
              draggable={false}
            />
          </div>
          <div className="text-[13px] leading-tight">
            <div className="font-bold text-white tracking-wider">{BRAND.name}</div>
            <div className="text-[10px] uppercase text-slate-300 tracking-[0.2em]">
              {BRAND.tagline}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          <div className="hidden md:block">
            <div className="rounded-full bg-white/5 px-1 py-1 backdrop-blur-md ring-1 ring-white/10">
              <BackendConnectionBadge />
            </div>
          </div>
        </div>
      </header>

      {/* ── Main split layout ─────────────────────────────────────────────── */}
      <main
        className="relative z-10 mx-auto grid min-h-[calc(100vh-100px)] max-w-7xl grid-cols-1 items-center gap-12 px-8 pb-16 lg:grid-cols-[minmax(0,440px)_1fr]"
      >
        {/* ── Left: login card ────────────────────────────────────────────── */}
        <section className="order-2 lg:order-1">
          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-8 shadow-2xl shadow-indigo-950/40 backdrop-blur-2xl sm:p-10">
            <div className="mb-7 flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-500/40">
                <LogIn className="h-5 w-5 text-white" strokeWidth={2.4} />
              </div>
              <div>
                <h1 className="text-2xl font-black text-white">{t('welcomeTitle')}</h1>
                <p className="text-sm text-slate-300">{t('welcomeSubtitle')}</p>
              </div>
            </div>

            {!activationChecked && (
              <div
                role="status"
                className="mb-4 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-[13px] text-slate-300"
              >
                {t('activation.checking')}
              </div>
            )}

            {activationChecked && activationStatusError && (
              <div
                role="alert"
                className="mb-4 rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2.5 text-[13px] leading-relaxed text-rose-200"
              >
                {t('activation.dbError')}
              </div>
            )}

            {activationChecked && !activationStatusError && !isActivated && (
              <div
                role="alert"
                className="mb-4 rounded-xl border border-amber-400/25 bg-amber-500/[0.08] px-3 py-2.5 text-[13px] leading-relaxed text-amber-100"
              >
                {t('activation.required')}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="username"
                  className={`text-[13px] font-medium ${canLogin ? 'text-slate-200' : 'text-slate-500'}`}
                >
                  {t('username')}
                </label>
                <input
                  id="username"
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={!canLogin}
                  className={`block w-full rounded-xl border border-white/10 bg-white/[0.06] px-4 py-3 text-[15px] text-white placeholder:text-slate-500 outline-none transition focus:border-indigo-400/60 focus:bg-white/[0.08] focus:ring-4 focus:ring-indigo-500/20 ${inputDisabledClass}`}
                  placeholder="admin"
                  dir="ltr"
                  required={canLogin}
                  aria-disabled={!canLogin}
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="password"
                  className={`text-[13px] font-medium ${canLogin ? 'text-slate-200' : 'text-slate-500'}`}
                >
                  {t('password')}
                </label>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={!canLogin}
                    className={`block w-full rounded-xl border border-white/10 bg-white/[0.06] px-4 py-3 pl-12 text-[15px] text-white placeholder:text-slate-500 outline-none transition focus:border-indigo-400/60 focus:bg-white/[0.08] focus:ring-4 focus:ring-indigo-500/20 ${inputDisabledClass}`}
                    placeholder="••••••••"
                    dir="ltr"
                    required={canLogin}
                    aria-disabled={!canLogin}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    disabled={!canLogin}
                    className="absolute inset-y-0 left-2 flex items-center justify-center rounded-lg px-2 text-slate-400 transition hover:text-white disabled:pointer-events-none disabled:opacity-40"
                    aria-label={showPassword ? t('hidePassword') : t('showPassword')}
                    tabIndex={canLogin ? 0 : -1}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              {error && (
                <div
                  role="alert"
                  className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2.5 text-[13px] leading-relaxed text-rose-200"
                >
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !canLogin || !username || !password}
                className="group relative inline-flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-gradient-to-l from-indigo-500 via-indigo-500 to-violet-600 px-4 py-3 text-[15px] font-bold text-white shadow-lg shadow-indigo-600/30 transition hover:shadow-indigo-500/50 disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none disabled:saturate-75"
              >
                {loading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <LogIn className="h-5 w-5" />
                )}
                {loading ? t('loggingIn') : t('loginBtn')}
              </button>
            </form>

            <div className="mt-6 flex items-center justify-between text-[12px] text-slate-400">
              <span className="text-slate-500">
                {t('loginRequiredNote')}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                {t('secureConnection')}
              </span>
            </div>
          </div>

          <p className="mt-5 text-center text-[12px] text-slate-400 lg:text-start">
            {t('helpText')}
          </p>
        </section>

        {/* ── Right: brand identity + feature highlights ──────────────────── */}
        <section className="order-1 lg:order-2">
          <div className="relative max-w-xl lg:ms-auto">
            <div className="mb-7 inline-flex items-center gap-4 rounded-2xl bg-white px-6 py-5 shadow-2xl shadow-indigo-950/40 ring-1 ring-white/10">
              <img
                src={BRAND.logoPng}
                alt={BRAND.name}
                className="h-20 w-auto select-none"
                draggable={false}
              />
            </div>

            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[12px] font-medium text-slate-200 backdrop-blur-md">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
              </span>
              {BRAND.descriptionAr}
            </span>

            <h2 className="mt-6 text-4xl font-black leading-[1.15] text-white sm:text-5xl">
              {t('heroTitle1')}
              <br />
              <span className="bg-gradient-to-l from-indigo-300 via-violet-300 to-fuchsia-300 bg-clip-text text-transparent">
                {t('heroTitle2')}
              </span>
            </h2>
            <p className="mt-4 max-w-md text-[15px] leading-relaxed text-slate-300">
              {t('heroDescription')}
            </p>

            <div className="mt-10 grid gap-3">
              {features.map((feature) => {
                const Icon = feature.icon;
                return (
                  <div
                    key={feature.titleKey}
                    className="group flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4 transition hover:border-indigo-400/30 hover:bg-white/[0.07]"
                  >
                    <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-indigo-500/30 to-violet-600/30 text-indigo-200 ring-1 ring-inset ring-white/10 group-hover:text-white">
                      <Icon className="h-5 w-5" strokeWidth={2.2} />
                    </div>
                    <div className="min-w-0">
                      <div className="text-[15px] font-bold text-white">
                        {t(feature.titleKey)}
                      </div>
                      <div className="text-[12.5px] text-slate-400">
                        {t(feature.descriptionKey)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </main>

      {/* ── Footer line ───────────────────────────────────────────────────── */}
      <footer className="relative z-10 px-8 pb-6 text-center text-[11.5px] text-slate-500">
        © {new Date().getFullYear()} {BRAND.copyrightHolder} — {BRAND.tagline}. {t('footerRights')}
      </footer>

      {/* ── Activation modal ──────────────────────────────────────────────── */}
      {activationModalOpen && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center p-4"
          role="presentation"
        >
          <button
            type="button"
            className="absolute inset-0 bg-slate-950/75 backdrop-blur-[3px]"
            aria-label={t('activation.modalClose')}
            onClick={() => setActivationModalOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={activationModalTitleId}
            className="relative z-[71] w-full max-w-md rounded-2xl border border-white/10 bg-[#0f0a28]/95 p-6 shadow-2xl shadow-black/50 backdrop-blur-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-5 flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-indigo-500/40 to-violet-600/40 ring-1 ring-white/10">
                  <KeyRound className="h-5 w-5 text-indigo-100" />
                </div>
                <h2 id={activationModalTitleId} className="text-lg font-black text-white">
                  {t('activation.modalTitle')}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setActivationModalOpen(false)}
                className="rounded-lg p-2 text-slate-400 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/80"
                aria-label={t('activation.modalCloseBtn')}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {activationStatusError ? (
              <div className="space-y-4">
                <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2.5 text-[13px] font-bold text-rose-100">
                  {t('activation.readError')}
                </div>
                <button
                  type="button"
                  onClick={loadActivationStatus}
                  className="w-full rounded-xl border border-white/15 bg-white/[0.06] py-2.5 text-sm font-bold text-white transition hover:bg-white/[0.1]"
                >
                  {t('activation.retry')}
                </button>
              </div>
            ) : activationStatus?.active ? (
              <div className="space-y-4">
                <div className="rounded-xl border border-emerald-400/25 bg-emerald-500/[0.1] px-3 py-2.5 text-[13px] font-bold text-emerald-100">
                  <span className="inline-flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-emerald-300" />
                    {t('activation.activated')}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[13px] text-slate-300">
                  <span className="rounded-md bg-white/5 px-2 py-1 font-mono text-xs" dir="ltr">
                    {activationStatus.planCode ?? 'FULL'}
                  </span>
                  <span className="text-slate-400">·</span>
                  <span className="font-mono text-xs tracking-wide" dir="ltr">
                    ****{activationStatus.keySuffix ?? '----'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setActivationModalOpen(false)}
                  className="w-full rounded-xl border border-white/15 bg-white/[0.06] py-2.5 text-sm font-bold text-white transition hover:bg-white/[0.1]"
                >
                  {t('activation.modalCloseBtn')}
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-xl border border-amber-400/25 bg-amber-500/[0.08] px-3 py-2.5 text-[13px] text-amber-100">
                  {t('activation.notActivated')}
                </div>
                <p className="text-[13px] leading-relaxed text-slate-400">
                  {t('activation.enterKey')}
                </p>
                <ActivationKeyInput
                  compact
                  autoFocus
                  onActivated={(next) => {
                    setActivationStatus(next);
                    window.setTimeout(() => setActivationModalOpen(false), 1400);
                  }}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
