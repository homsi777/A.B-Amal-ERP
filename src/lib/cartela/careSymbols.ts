export type CartelaCareSymbolId =
  | 'wash_30'
  | 'wash_40'
  | 'wash_60'
  | 'iron_low'
  | 'iron_medium'
  | 'iron_high'
  | 'no_bleach'
  | 'no_tumble_dry'
  | 'tumble_dry'
  | 'dry_clean_p'
  | 'dry_clean_f'
  | 'line_dry';

export const CARTELA_CARE_SYMBOLS: Array<{
  id: CartelaCareSymbolId;
  labelEn: string;
  labelAr: string;
}> = [
  { id: 'wash_30', labelEn: 'Wash 30°C', labelAr: 'غسيل 30°' },
  { id: 'wash_40', labelEn: 'Wash 40°C', labelAr: 'غسيل 40°' },
  { id: 'wash_60', labelEn: 'Wash 60°C', labelAr: 'غسيل 60°' },
  { id: 'iron_low', labelEn: 'Iron low', labelAr: 'كي منخفض' },
  { id: 'iron_medium', labelEn: 'Iron medium', labelAr: 'كي متوسط' },
  { id: 'iron_high', labelEn: 'Iron high', labelAr: 'كي عالي' },
  { id: 'no_bleach', labelEn: 'Do not bleach', labelAr: 'ممنوع التبييض' },
  { id: 'no_tumble_dry', labelEn: 'Do not tumble dry', labelAr: 'ممنوع التجفيف بالآلة' },
  { id: 'tumble_dry', labelEn: 'Tumble dry', labelAr: 'تجفيف بالآلة' },
  { id: 'dry_clean_p', labelEn: 'Dry clean P', labelAr: 'تنظيف جاف P' },
  { id: 'dry_clean_f', labelEn: 'Dry clean F', labelAr: 'تنظيف جاف F' },
  { id: 'line_dry', labelEn: 'Line dry', labelAr: 'تجفيف بالتعليق' },
];

export const CARTELA_CARE_SYMBOL_IDS = new Set(CARTELA_CARE_SYMBOLS.map((s) => s.id));

export type CartelaCompositionLine = {
  percent: number;
  fiberTypeId: string | null;
  fiberName: string;
};

export function formatCompositionForLabel(lines: CartelaCompositionLine[]): string {
  return [...lines]
    .filter((line) => line.percent > 0 && line.fiberName.trim())
    .sort((a, b) => b.percent - a.percent)
    .map((line) => `${Math.round(line.percent)}% ${line.fiberName.trim().toUpperCase()}`)
    .join('  ');
}

export function compositionSum(lines: Array<{ percent: number }>): number {
  return lines.reduce((sum, line) => sum + (Number.isFinite(line.percent) ? line.percent : 0), 0);
}

export function validateCompositionLines(lines: CartelaCompositionLine[]): string | null {
  const active = lines.filter((line) => line.percent > 0 || line.fiberName.trim());
  if (active.length === 0) return null;
  if (active.length > 5) return 'الحد الأقصى 5 مكوّنات للخليط';
  for (const line of active) {
    if (!line.fiberName.trim()) return 'اختر نوع الخامة لكل نسبة';
    if (line.percent < 1 || line.percent > 100) return 'كل نسبة يجب أن تكون بين 1% و 100%';
  }
  const total = compositionSum(active);
  if (total !== 100) return `مجموع النسب ${total}% — يجب أن يكون 100% بالضبط`;
  return null;
}
