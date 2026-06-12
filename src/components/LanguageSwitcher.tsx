import { Globe } from 'lucide-react';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  applyDocumentLanguage,
  LANGUAGE_STORAGE_KEY,
  type AppLanguage,
} from '../i18n/constants';

const MENU_MIN_WIDTH = 152;
const SUPPRESS_CLOSE_MS = 280;

const OPTIONS: Array<{ code: AppLanguage; labelKey: 'common:language.ar' | 'common:language.tr' }> = [
  { code: 'ar', labelKey: 'common:language.ar' },
  { code: 'tr', labelKey: 'common:language.tr' },
];

type LanguageSwitcherProps = {
  /** Login page uses a dark background without theme CSS variables. */
  variant?: 'default' | 'dark';
};

function isInside(node: Node | null | undefined, target: EventTarget | null): boolean {
  return Boolean(node && target instanceof Node && node.contains(target));
}

export function LanguageSwitcher({ variant = 'default' }: LanguageSwitcherProps) {
  const { i18n, t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const anchorRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const suppressCloseUntilRef = useRef(0);
  const current = (i18n.language === 'tr' ? 'tr' : 'ar') as AppLanguage;
  const isDark = variant === 'dark';

  const updateMenuPosition = () => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const gap = 4;
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

  const openMenu = () => {
    suppressCloseUntilRef.current = Date.now() + SUPPRESS_CLOSE_MS;
    setOpen(true);
  };

  const closeMenu = () => setOpen(false);

  const handleToggle = (e: ReactMouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (open) closeMenu();
    else openMenu();
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
    const onPointerDown = (e: PointerEvent) => {
      if (Date.now() < suppressCloseUntilRef.current) return;
      if (isInside(anchorRef.current, e.target) || isInside(menuRef.current, e.target)) return;
      closeMenu();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const setLanguage = async (language: AppLanguage) => {
    suppressCloseUntilRef.current = Date.now() + SUPPRESS_CLOSE_MS;
    if (language === current) {
      closeMenu();
      return;
    }
    await i18n.changeLanguage(language);
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    applyDocumentLanguage(language);
    closeMenu();
  };

  const buttonClass = isDark
    ? 'relative min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-slate-300 hover:bg-white/10 hover:text-white transition border border-transparent hover:border-white/15 touch-manipulation'
    : 'relative min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--surface-muted-nav)] hover:text-[var(--text-heading)] transition border border-transparent hover:border-[var(--border-default)] touch-manipulation';

  const menuClass = isDark
    ? 'rounded-xl border border-white/15 bg-[#1a1035]/98 shadow-2xl shadow-black/40 backdrop-blur-md overflow-hidden touch-manipulation'
    : 'rounded-xl border border-[var(--border-default)] bg-[var(--surface-header)] shadow-xl overflow-hidden touch-manipulation';

  const menu = open
    ? createPortal(
        <div
          ref={menuRef}
          style={menuStyle}
          className={menuClass}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {OPTIONS.map((option) => {
            const active = option.code === current;
            const itemClass = isDark
              ? active
                ? 'bg-indigo-500/25 text-indigo-100 font-bold'
                : 'text-slate-100 hover:bg-white/10 active:bg-white/15'
              : active
                ? 'bg-[var(--ui-accent-soft-bg)] text-[var(--ui-accent)] font-bold'
                : 'text-[var(--text-heading)] hover:bg-[var(--surface-muted-nav)] active:bg-[var(--border-subtle)]';
            return (
              <button
                key={option.code}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void setLanguage(option.code);
                }}
                className={`block w-full min-h-[44px] px-4 py-3 text-sm text-start transition select-none ${itemClass}`}
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
    <div ref={anchorRef} className="relative">
      <button
        type="button"
        onClick={handleToggle}
        onPointerDown={(e) => e.stopPropagation()}
        className={buttonClass}
        title={t('language')}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={t('language')}
      >
        <Globe className="w-5 h-5" strokeWidth={2} />
      </button>
      {menu}
    </div>
  );
}
