export type CartelaColorPrintSettings = {
  cellWidthMm: number;
  cellHeightMm: number;
  gapMm: number;
  barcodeHeightMm: number;
  codeFontPt: number;
  copies: number;
  showColorName: boolean;
};

export const CARTELA_COLOR_PRINT_SETTINGS_KEY = 'clotex.cartelaColorPrintSettings.v1';

export const DEFAULT_CARTELA_COLOR_PRINT_SETTINGS: CartelaColorPrintSettings = {
  cellWidthMm: 22,
  cellHeightMm: 12,
  gapMm: 1.5,
  barcodeHeightMm: 6,
  codeFontPt: 6.5,
  copies: 1,
  showColorName: false,
};

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

export function normalizeCartelaColorPrintSettings(
  raw: Partial<CartelaColorPrintSettings> | null | undefined,
): CartelaColorPrintSettings {
  const d = DEFAULT_CARTELA_COLOR_PRINT_SETTINGS;
  return {
    cellWidthMm: clamp(Number(raw?.cellWidthMm ?? d.cellWidthMm), 12, 40),
    cellHeightMm: clamp(Number(raw?.cellHeightMm ?? d.cellHeightMm), 8, 25),
    gapMm: clamp(Number(raw?.gapMm ?? d.gapMm), 0, 6),
    barcodeHeightMm: clamp(Number(raw?.barcodeHeightMm ?? d.barcodeHeightMm), 4, 14),
    codeFontPt: clamp(Number(raw?.codeFontPt ?? d.codeFontPt), 4, 12),
    copies: clamp(Math.round(Number(raw?.copies ?? d.copies)), 1, 20),
    showColorName: Boolean(raw?.showColorName ?? d.showColorName),
  };
}

export function loadCartelaColorPrintSettings(): CartelaColorPrintSettings {
  if (typeof localStorage === 'undefined') return DEFAULT_CARTELA_COLOR_PRINT_SETTINGS;
  try {
    const raw = localStorage.getItem(CARTELA_COLOR_PRINT_SETTINGS_KEY);
    if (!raw) return DEFAULT_CARTELA_COLOR_PRINT_SETTINGS;
    return normalizeCartelaColorPrintSettings(JSON.parse(raw) as Partial<CartelaColorPrintSettings>);
  } catch {
    return DEFAULT_CARTELA_COLOR_PRINT_SETTINGS;
  }
}

export function saveCartelaColorPrintSettings(settings: CartelaColorPrintSettings): CartelaColorPrintSettings {
  const normalized = normalizeCartelaColorPrintSettings(settings);
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(CARTELA_COLOR_PRINT_SETTINGS_KEY, JSON.stringify(normalized));
  }
  return normalized;
}

export function stripPageWidthMm(settings: CartelaColorPrintSettings): number {
  return settings.cellWidthMm * 3 + settings.gapMm * 2;
}

export function stripPageHeightMm(settings: CartelaColorPrintSettings): number {
  return settings.cellHeightMm;
}
