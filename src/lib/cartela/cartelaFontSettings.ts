import {
  CARTELA_DEFAULT_FONT_SIZE_PT,
  CARTELA_MAX_FONT_SIZE_PT,
  CARTELA_MIN_FONT_SIZE_PT,
} from '../printing/renderCartelaLabel';

export const CARTELA_FONT_SETTINGS_KEY = 'clotex.cartelaFontSettings.v1';

export type CartelaFontSettings = {
  defaultFontSizePt: number;
};

export const DEFAULT_CARTELA_FONT_SETTINGS: CartelaFontSettings = {
  defaultFontSizePt: CARTELA_DEFAULT_FONT_SIZE_PT,
};

function clampFontSizePt(n: number): number {
  if (!Number.isFinite(n)) return CARTELA_DEFAULT_FONT_SIZE_PT;
  return Math.min(
    CARTELA_MAX_FONT_SIZE_PT,
    Math.max(CARTELA_MIN_FONT_SIZE_PT, Math.round(n * 10) / 10),
  );
}

export function normalizeCartelaFontSettings(
  raw: Partial<CartelaFontSettings> | null | undefined,
): CartelaFontSettings {
  return {
    defaultFontSizePt: clampFontSizePt(Number(raw?.defaultFontSizePt ?? CARTELA_DEFAULT_FONT_SIZE_PT)),
  };
}

export function loadCartelaFontSettings(): CartelaFontSettings {
  if (typeof localStorage === 'undefined') return DEFAULT_CARTELA_FONT_SETTINGS;
  try {
    const raw = localStorage.getItem(CARTELA_FONT_SETTINGS_KEY);
    if (!raw) return DEFAULT_CARTELA_FONT_SETTINGS;
    return normalizeCartelaFontSettings(JSON.parse(raw) as Partial<CartelaFontSettings>);
  } catch {
    return DEFAULT_CARTELA_FONT_SETTINGS;
  }
}

export function loadDefaultCartelaFontSizePt(): number {
  return loadCartelaFontSettings().defaultFontSizePt;
}

export function saveDefaultCartelaFontSizePt(fontSizePt: number): number {
  const normalized = clampFontSizePt(fontSizePt);
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(
      CARTELA_FONT_SETTINGS_KEY,
      JSON.stringify({ defaultFontSizePt: normalized } satisfies CartelaFontSettings),
    );
  }
  return normalized;
}
