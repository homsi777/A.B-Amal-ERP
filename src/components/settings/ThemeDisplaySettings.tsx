import React from 'react';
import {
  Check,
  Contrast,
  Languages,
  MonitorSmartphone,
  MoonStar,
  Sparkles,
  SunMedium,
  Type,
  Weight
} from 'lucide-react';
import {
  ARABIC_FONT_LABELS,
  THEME_META,
  type ArabicFontId,
  type ThemePresetId
} from '../../theme/themeTokens';
import { useUiPreferences } from '../../theme/uiPreferencesStore';

const FONT_IDS = Object.keys(ARABIC_FONT_LABELS) as ArabicFontId[];
const THEME_IDS = Object.keys(THEME_META) as ThemePresetId[];

export const ThemeDisplaySettings = () => {
  const themeId = useUiPreferences((s) => s.themeId);
  const appearance = useUiPreferences((s) => s.appearance);
  const arabicFontId = useUiPreferences((s) => s.arabicFontId);
  const fontWeight = useUiPreferences((s) => s.fontWeight);
  const letterSpacingEm = useUiPreferences((s) => s.letterSpacingEm);
  const setThemeId = useUiPreferences((s) => s.setThemeId);
  const setAppearance = useUiPreferences((s) => s.setAppearance);
  const setArabicFontId = useUiPreferences((s) => s.setArabicFontId);
  const setFontWeight = useUiPreferences((s) => s.setFontWeight);
  const setLetterSpacingEm = useUiPreferences((s) => s.setLetterSpacingEm);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-xl font-bold text-[var(--text-heading)] flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-[var(--ui-accent)]" />
            الثيمات والعرض
          </h3>
          <p className="text-[var(--text-muted)] mt-1 text-sm">
            تخصيص ألوان الواجهة والخط العربي مع الحفاظ على تناسق الجداول والبطاقات الحالية في النظام.
          </p>
        </div>
        <span className="text-xs font-medium px-3 py-1 rounded-full bg-[var(--ui-accent-soft-bg)] text-[var(--ui-accent)] border border-[var(--ui-accent-border)]">
          يُحفظ تلقائياً على هذا المتصفح
        </span>
      </div>

      {/* الوضع الليلي */}
      <section className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-header)] shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--border-subtle)] bg-[var(--surface-muted-nav)] flex items-center gap-2">
          <Contrast className="w-5 h-5 text-[var(--ui-accent)]" />
          <h4 className="font-bold text-[var(--text-heading)]">المظهر العام</h4>
        </div>
        <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <button
            type="button"
            onClick={() => setAppearance('light')}
            className={`relative flex flex-col items-start gap-2 rounded-xl border-2 p-4 text-right transition-all ${
              appearance === 'light'
                ? 'border-[var(--ui-accent)] bg-[var(--ui-accent-soft-bg)] shadow-md ring-2 ring-[var(--ui-accent)]/25'
                : 'border-[var(--border-default)] hover:border-[var(--ui-accent-border)] bg-[var(--page-bg)]'
            }`}
          >
            <SunMedium className="w-8 h-8 text-amber-500" />
            <span className="font-bold text-[var(--text-heading)]">نهاري</span>
            <span className="text-xs text-[var(--text-muted)] leading-relaxed">
              خلفيات فاتحة مع المحافظة على بطاقات المحتوى كما هي في النظام.
            </span>
            {appearance === 'light' && (
              <Check className="absolute left-3 top-3 w-5 h-5 text-[var(--ui-accent)]" aria-hidden />
            )}
          </button>

          <button
            type="button"
            onClick={() => setAppearance('dark')}
            className={`relative flex flex-col items-start gap-2 rounded-xl border-2 p-4 text-right transition-all ${
              appearance === 'dark'
                ? 'border-[var(--ui-accent)] bg-[var(--ui-accent-soft-bg)] shadow-md ring-2 ring-[var(--ui-accent)]/25'
                : 'border-[var(--border-default)] hover:border-[var(--ui-accent-border)] bg-[var(--page-bg)]'
            }`}
          >
            <MoonStar className="w-8 h-8 text-indigo-400" />
            <span className="font-bold text-[var(--text-heading)]">ليلي</span>
            <span className="text-xs text-[var(--text-muted)] leading-relaxed">
              إطار داكن للشريط والخلفية؛ الشاشات الداخلية تحافظ على بطاقاتها الفاتحة للقراءة.
            </span>
            {appearance === 'dark' && (
              <Check className="absolute left-3 top-3 w-5 h-5 text-[var(--ui-accent)]" aria-hidden />
            )}
          </button>
        </div>
      </section>

      {/* الثيمات الأربعة */}
      <section className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-header)] shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--border-subtle)] bg-[var(--surface-muted-nav)] flex items-center gap-2">
          <MonitorSmartphone className="w-5 h-5 text-[var(--ui-accent)]" />
          <h4 className="font-bold text-[var(--text-heading)]">لوحة الألوان (٤ ثيمات)</h4>
        </div>
        <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          {THEME_IDS.map((id) => {
            const meta = THEME_META[id];
            const selected = themeId === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setThemeId(id)}
                className={`relative flex flex-col rounded-xl border-2 overflow-hidden text-right transition-all ${
                  selected
                    ? 'border-[var(--ui-accent)] shadow-lg ring-2 ring-[var(--ui-accent)]/30'
                    : 'border-[var(--border-default)] hover:border-[var(--ui-accent-border)]'
                }`}
              >
                <div
                  className="h-14 w-full shrink-0 border-b border-black/5"
                  style={{ background: meta.previewGradient }}
                  aria-hidden
                />
                <div className="p-4 bg-[var(--page-bg)] flex flex-col gap-2 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-bold text-[var(--text-heading)]">{meta.labelAr}</span>
                    {selected && (
                      <span className="flex items-center gap-1 text-xs font-semibold text-[var(--ui-accent)] shrink-0">
                        <Check className="w-4 h-4" /> نشط
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[var(--text-muted)] leading-relaxed">{meta.descriptionAr}</p>
                  <div className="flex gap-2 mt-auto pt-2 opacity-90">
                    <span className="w-8 h-8 rounded-lg bg-[var(--ui-accent-soft-bg)] border border-[var(--ui-accent-border)] flex items-center justify-center">
                      <span className="w-4 h-4 rounded bg-[var(--ui-accent)]" aria-hidden />
                    </span>
                    <span className="flex-1 rounded-lg border border-[var(--border-default)] bg-[var(--surface-header)] px-2 py-1 text-[10px] text-[var(--text-muted)] flex items-center justify-center">
                      معاينة أيقونة
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* الخط العربي */}
      <section className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-header)] shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--border-subtle)] bg-[var(--surface-muted-nav)] flex items-center gap-2">
          <Languages className="w-5 h-5 text-[var(--ui-accent)]" />
          <h4 className="font-bold text-[var(--text-heading)]">خط اللغة العربية</h4>
        </div>
        <div className="p-5 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {FONT_IDS.map((fid) => (
              <button
                key={fid}
                type="button"
                onClick={() => setArabicFontId(fid)}
                className={`rounded-xl border-2 px-4 py-3 text-right transition-all ${
                  arabicFontId === fid
                    ? 'border-[var(--ui-accent)] bg-[var(--ui-accent-soft-bg)] shadow-md'
                    : 'border-[var(--border-default)] hover:border-[var(--ui-accent-border)] bg-[var(--page-bg)]'
                }`}
              >
                <div className="font-semibold text-[var(--text-heading)]">{ARABIC_FONT_LABELS[fid]}</div>
              </button>
            ))}
          </div>

          <div className="rounded-xl border border-[var(--border-default)] bg-[var(--page-bg)] p-5 space-y-3">
            <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">معاينة حية</p>
            <p
              className="text-lg leading-relaxed text-[var(--text-heading)]"
              style={{
                fontFamily: `var(--ui-font-family)`,
                fontWeight,
                letterSpacing: `${letterSpacingEm}em`
              }}
            >
              هذه معاينة لنص عربي طويل: إدارة مستودعات الأقمشة، فواتير البيع والشراء، وتقارير المخزون — لتقييم الخط قبل الحفظ.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-sm font-medium text-[var(--text-heading)]">
                <Weight className="w-4 h-4 text-[var(--ui-accent)]" />
                سمك الخط ({fontWeight})
              </label>
              <input
                type="range"
                min={300}
                max={700}
                step={10}
                value={fontWeight}
                onChange={(e) => setFontWeight(Number(e.target.value))}
                className="w-full accent-[var(--ui-accent)]"
              />
              <div className="flex justify-between text-xs text-[var(--text-muted)]">
                <span>أخف 300</span>
                <span>أثقل 700</span>
              </div>
            </div>

            <div className="space-y-3">
              <label className="flex items-center gap-2 text-sm font-medium text-[var(--text-heading)]">
                <Type className="w-4 h-4 text-[var(--ui-accent)]" />
                تباعد الأحرف ({letterSpacingEm >= 0 ? '+' : ''}
                {letterSpacingEm.toFixed(3)} em)
              </label>
              <input
                type="range"
                min={-0.04}
                max={0.09}
                step={0.005}
                value={letterSpacingEm}
                onChange={(e) => setLetterSpacingEm(Number(e.target.value))}
                className="w-full accent-[var(--ui-accent)]"
              />
              <div className="flex justify-between text-xs text-[var(--text-muted)]">
                <span>أضيق −0.04</span>
                <span>أوسع +0.09</span>
              </div>
              <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                يتحكم في مسافة الحروف العربية أفقيًا؛ استخدم قيمًا صغيرة لتجنّب تشويش القراءة في الجداول.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
