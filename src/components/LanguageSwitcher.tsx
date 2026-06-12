import { Globe } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  applyDocumentLanguage,
  LANGUAGE_STORAGE_KEY,
  type AppLanguage,
} from '../i18n/constants';

const OPTIONS: Array<{ code: AppLanguage; labelKey: 'common:language.ar' | 'common:language.tr' }> = [
  { code: 'ar', labelKey: 'common:language.ar' },
  { code: 'tr', labelKey: 'common:language.tr' },
];

export function LanguageSwitcher() {
  const { i18n, t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = (i18n.language === 'tr' ? 'tr' : 'ar') as AppLanguage;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
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

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative p-2 rounded-lg text-[var(--text-muted)] hover:bg-[var(--surface-muted-nav)] hover:text-[var(--text-heading)] transition border border-transparent hover:border-[var(--border-default)]"
        title={t('language')}
        aria-expanded={open}
        aria-haspopup="true"
      >
        <Globe className="w-5 h-5" strokeWidth={2} />
      </button>
      {open && (
        <div className="absolute end-0 mt-2 min-w-[9rem] rounded-xl border border-[var(--border-default)] bg-[var(--surface-header)] shadow-xl z-[120] overflow-hidden">
          {OPTIONS.map((option) => {
            const active = option.code === current;
            return (
              <button
                key={option.code}
                type="button"
                onClick={() => void setLanguage(option.code)}
                className={`block w-full px-4 py-2.5 text-sm text-start transition ${
                  active
                    ? 'bg-[var(--ui-accent-soft-bg)] text-[var(--ui-accent)] font-bold'
                    : 'text-[var(--text-heading)] hover:bg-[var(--surface-muted-nav)]'
                }`}
              >
                {t(option.labelKey)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
