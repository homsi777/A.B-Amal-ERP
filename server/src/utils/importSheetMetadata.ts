/** استخراج مجاميع نهاية ملف Excel وتجاهل صفوف الملخص */

function parseLooseNumber(value: string): number | null {
  const n = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function rowText(row: unknown[]): string {
  return row
    .map((c) => String(c ?? '').trim())
    .filter(Boolean)
    .join(' ');
}

export function isImportSummaryRollNo(rollNo: string): boolean {
  const u = rollNo.trim().toUpperCase();
  return !u || /^(TOTAL|GRAND|SUB|SUM|SUMMARY|TTL)$/.test(u) || /^TOTAL\b/.test(u);
}

export function isImportSummaryRow(row: unknown[]): boolean {
  const joined = rowText(row);
  if (!joined) return false;
  const upper = joined.toUpperCase();
  if (/^(TOTAL|GRAND\s+TOTAL|SUB\s*TOTAL|SUMMARY)\b/.test(upper)) return true;
  if (/TOTAL\s+SHIPPED/i.test(upper)) return true;
  if (/\bTOTAL\b/.test(upper) && (/\bROLLS?\b/.test(upper) || /\bMTS?\b/.test(upper) || /\bMETERS?\b/.test(upper))) {
    return true;
  }
  return false;
}

/** إزالة صفوف المجاميع من نهاية جدول البيانات */
export function stripTrailingSummaryRows(rows: unknown[][]): unknown[][] {
  let end = rows.length;
  while (end > 0 && isImportSummaryRow(rows[end - 1] ?? [])) end--;
  return rows.slice(0, end);
}

export type SheetTotalsMetadata = {
  declaredTotalLength?: number;
  declaredLengthUnit?: string;
  declaredRollCount?: number;
  totalsSource?: 'footer' | 'header';
};

function matchTotalsInText(text: string, source: 'footer' | 'header'): SheetTotalsMetadata | null {
  let m = /TOTAL\s+SHIPPED\s+SITUATION\s*[:：]?\s*([\d,.]+)\s*([A-Z]+)\s+([\d,.]+)\s*ROLLS?/i.exec(text);
  if (m) {
    const length = parseLooseNumber(m[1]);
    const rolls = parseLooseNumber(m[3]);
    if (length != null && rolls != null) {
      return {
        declaredTotalLength: length,
        declaredLengthUnit: m[2].toUpperCase(),
        declaredRollCount: rolls,
        totalsSource: source,
      };
    }
  }

  m = /TOTAL\s*[:：]?\s*([\d,.]+)\s*(MTS?|METERS?|YDS?|YARD)\s+([\d,.]+)\s*ROLLS?/i.exec(text);
  if (m) {
    const length = parseLooseNumber(m[1]);
    const rolls = parseLooseNumber(m[3]);
    if (length != null && rolls != null) {
      return {
        declaredTotalLength: length,
        declaredLengthUnit: m[2].toUpperCase(),
        declaredRollCount: rolls,
        totalsSource: source,
      };
    }
  }

  m = /TOTAL\s*[:：]?\s*([\d,.]+)\s+([\d,.]+)\s*ROLLS?/i.exec(text);
  if (m) {
    const length = parseLooseNumber(m[1]);
    const rolls = parseLooseNumber(m[2]);
    if (length != null && rolls != null) {
      return { declaredTotalLength: length, declaredRollCount: rolls, totalsSource: source };
    }
  }

  return null;
}

/** مجاميع من آخر صفوف الشيت */
export function extractFooterTotalsMetadata(rows: unknown[][]): SheetTotalsMetadata {
  const text = rows
    .slice(-30)
    .flat()
    .map((c) => String(c ?? '').trim())
    .filter(Boolean)
    .join('\n');
  return matchTotalsInText(text, 'footer') ?? {};
}

export function extractHeaderTotalsMetadata(rows: unknown[][]): SheetTotalsMetadata {
  const text = rows
    .flat()
    .map((c) => String(c ?? '').trim())
    .filter(Boolean)
    .join('\n');
  return matchTotalsInText(text, 'header') ?? {};
}

export function mergeSheetTotalsMetadata(
  headerRows: unknown[][],
  dataRows: unknown[][],
): SheetTotalsMetadata {
  const footer = extractFooterTotalsMetadata(dataRows);
  if (footer.declaredRollCount != null || footer.declaredTotalLength != null) return footer;
  return extractHeaderTotalsMetadata(headerRows);
}
