import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AppearanceMode, ArabicFontId, ThemePresetId } from './themeTokens';

export interface UiPreferencesState {
  themeId: ThemePresetId;
  appearance: AppearanceMode;
  arabicFontId: ArabicFontId;
  /** سمك الخط الأساسي (300–700) */
  fontWeight: number;
  /** تباعد الأحرف بالـ em تقريباً */
  letterSpacingEm: number;
  setThemeId: (id: ThemePresetId) => void;
  setAppearance: (mode: AppearanceMode) => void;
  setArabicFontId: (id: ArabicFontId) => void;
  setFontWeight: (w: number) => void;
  setLetterSpacingEm: (em: number) => void;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export const useUiPreferences = create<UiPreferencesState>()(
  persist(
    (set) => ({
      themeId: 'indigo-classic',
      appearance: 'light',
      arabicFontId: 'cairo',
      fontWeight: 450,
      letterSpacingEm: 0,
      setThemeId: (themeId) => set({ themeId }),
      setAppearance: (appearance) => set({ appearance }),
      setArabicFontId: (arabicFontId) => set({ arabicFontId }),
      setFontWeight: (fontWeight) => set({ fontWeight: clamp(Math.round(fontWeight), 300, 700) }),
      setLetterSpacingEm: (letterSpacingEm) =>
        set({ letterSpacingEm: clamp(letterSpacingEm, -0.04, 0.09) })
    }),
    { name: 'fabric-erp-ui-preferences', version: 1 }
  )
);
