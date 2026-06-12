import { Globe } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  applyDocumentLanguage,
  LANGUAGE_STORAGE_KEY,
  type AppLanguage,
} from '../i18n/constants';

const MENU_MIN_WIDTH = 144;

const OPTIONS: Array<{ code: AppLanguage; labelKey: 'common:language.ar' | 'common:language.tr' }> = [
  { code: 'ar', labelKey: 'common:language.ar' },
  { code: 'tr', labelKey: 'common:language.tr' },
];

type LanguageSwitcherProps = {
  /** Login page uses a dark background without theme CSS variables. */
  variant?: 'default' | 'dark';
};

export function LanguageSwitcher({ variant = 'default' }: LanguageSwitcherProps) {
  const { i18n, t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const ref = useRef<HTMLDivElement>(null);
  const current = (i18n.language === 'tr' ? 'tr' : 'ar') as AppLanguage;
  const isDark = variant === 'dark';

  const updateMenuPosition = () => {
    const anchor = ref.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const gap = 8;
    const padding = 8;
    let left = rect.left;
    if (left + MENU_MIN_WIDTH > window.innerWidth - padding) {
      left = window.innerWidth - MENU_MIN_WIDTH - padding;
    }
    if (left < padding) left = padding;
    setMenuStyle({
      position: 'fixed',
      top: rect.bottom + gap,
      left,
      minWidth: MENU_MIN_WIDTH,
      zIndex: 9999,
    });
  };

  useLayoutEffect(() => {
    if (!open) return;
    updateMenuPosition();
    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', updateMenuPosition, true);
    return () => {
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        const menu = document.getElementById('language-switcher-menu');
        if (menu && menu.contains(e.target as Node)) return;
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const setLanguage = async (language: AppLanguage) => {
    if (language === current) {
      setOpen(false);
      return;
    }
    await i18n.changeLanguage(language);
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    applyDocumentLanguage(language);
    setOpen(false);
  };

  const buttonClass = isDark
    ? 'relative p-2 rounded-lg text-slate-300 hover:bg-white/10 hover:text-white transition border border-transparent hover:border-white/15'
    : 'relative p-2 rounded-lg text-[var(--text-muted)] hover:bg-[var(--surface-muted-nav)] hover:text-[var(--text-heading)] transition border border-transparent hover:border-[var(--border-default)]';

  const menuClass = isDark
    ? 'rounded-xl border border-white/15 bg-[#1a1035]/98 shadow-2xl shadow-black/40 backdrop-blur-md overflow-hidden'
    : 'rounded-xl border border-[var(--border-default)] bg-[var(--surface-header)] shadow-xl overflow-hidden';

  const menu = open
    ? createPortal(
        <div id="language-switcher-menu" style={menuStyle} className={menuClass}>
          {OPTIONS.map((option) => {
            const active = option.code === current;
            const itemClass = isDark
              ? active
                ? 'bg-indigo-500/25 text-indigo-100 font-bold'
                : 'text-slate-100 hover:bg-white/10'
              : active
                ? 'bg-[var(--ui-accent-soft-bg)] text-[var(--ui-accent)] font-bold'
                : 'text-[var(--text-heading)] hover:bg-[var(--surface-muted-nav)]';
            return (
              <button
                key={option.code}
                type="button"
                onClick={() => void setLanguage(option.code)}
                className={`block w-full px-4 py-2.5 text-sm text-start transition ${itemClass}`}
              >
                {t(option.labelKey)}
              </button>
            );
          })}
        </div>,
        document.body,
      )
    : null;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={buttonClass}
        title={t('language')}
        aria-expanded={open}
        aria-haspopup="true"
      >
        <Globe className="w-5 h-5" strokeWidth={2} />
      </button>
      {menu}
    </div>
  );
}
