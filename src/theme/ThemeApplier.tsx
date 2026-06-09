import { useLayoutEffect, type ReactNode } from 'react';
import { FONT_CSS_STACK, THEME_CSS_VARS } from './themeTokens';
import { DARK_CONTENT_SURFACES, LIGHT_CONTENT_SURFACES } from './contentSurfaces';
import { useUiPreferences } from './uiPreferencesStore';

/** يطبّق متغيرات الثيم والخط على الجذر قبل الرسم لتقليل الوميض */
export function ThemeApplier({ children }: { children: ReactNode }) {
  const themeId = useUiPreferences((s) => s.themeId);
  const appearance = useUiPreferences((s) => s.appearance);
  const arabicFontId = useUiPreferences((s) => s.arabicFontId);
  const fontWeight = useUiPreferences((s) => s.fontWeight);
  const letterSpacingEm = useUiPreferences((s) => s.letterSpacingEm);

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = themeId;
    root.dataset.appearance = appearance;

    const palette = THEME_CSS_VARS[themeId][appearance];
    Object.entries(palette).forEach(([key, value]) => {
      root.style.setProperty(key, value);
    });

    const contentSurfaces = appearance === 'dark' ? DARK_CONTENT_SURFACES : LIGHT_CONTENT_SURFACES;
    Object.entries(contentSurfaces).forEach(([key, value]) => {
      root.style.setProperty(key, value);
    });

    root.style.setProperty('--ui-font-family', FONT_CSS_STACK[arabicFontId]);
    root.style.setProperty('--ui-font-weight', String(fontWeight));
    root.style.setProperty('--ui-letter-spacing', `${letterSpacingEm.toFixed(4)}em`);
  }, [themeId, appearance, arabicFontId, fontWeight, letterSpacingEm]);

  return <>{children}</>;
}
