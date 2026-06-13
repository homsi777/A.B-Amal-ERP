/**
 * توسيع قوائم الأتواب بأعمدة متوازية:
 * - ROLL NO | M | Y  (قوائم Roll List مثل COLOMBIA)
 * - ROLL NO | LENGTH | LOT (قوائم التعبئة الصينية)
 */

import { isImportSummaryRollNo } from './importSheetMetadata.js';

function normHeader(h: string): string {
  return String(h ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s\-_\/\.]+/g, '')
    .replace(/[ًٌٍَُِّْ]/g, '');
}

function isRollHeader(h: string): boolean {
  const n = normHeader(h);
  return n.includes('rollno') || n === 'roll' || n.includes('رقمالتوب') || n.includes('رقمالرول');
}

function isLengthHeader(h: string): boolean {
  const n = normHeader(h);
  return (
    n.includes('length') ||
    n.includes('الطول') ||
    n.includes('meter') ||
    n.includes('metre') ||
    n.includes('متر')
  );
}

function isMeterHeader(h: string): boolean {
  const n = normHeader(h);
  return n === 'm' || n === 'mt' || n === 'mts' || n.includes('meter') || n.includes('metre') || n.includes('متر');
}

function isYardHeader(h: string): boolean {
  const n = normHeader(h);
  return n === 'y' || n === 'yd' || n === 'yds' || n.includes('yard') || n.includes('يارد');
}

function isLotHeader(h: string): boolean {
  const n = normHeader(h);
  return n.includes('lot') || n.includes('batch') || n.includes('اللوط') || n.includes('لوط');
}

export type RollTriplet = {
  rollIdx: number;
  lengthMIdx: number;
  lengthYIdx?: number;
  lotIdx?: number;
  sectionLabel?: string;
  format: 'M_Y' | 'LENGTH_LOT';
};

export function detectParallelRollTriplets(headers: string[], sectionRow?: unknown[]): RollTriplet[] {
  const triplets: RollTriplet[] = [];
  for (let i = 0; i < headers.length - 2; i++) {
    const h0 = headers[i] ?? '';
    const h1 = headers[i + 1] ?? '';
    const h2 = headers[i + 2] ?? '';
    const sectionLabel = sectionRow ? cellStr(sectionRow[i]) : '';

    if (isRollHeader(h0) && isMeterHeader(h1) && isYardHeader(h2)) {
      triplets.push({
        rollIdx: i,
        lengthMIdx: i + 1,
        lengthYIdx: i + 2,
        sectionLabel: sectionLabel || undefined,
        format: 'M_Y',
      });
      i += 2;
      continue;
    }

    if (isRollHeader(h0) && isLengthHeader(h1) && isLotHeader(h2)) {
      triplets.push({
        rollIdx: i,
        lengthMIdx: i + 1,
        lotIdx: i + 2,
        sectionLabel: sectionLabel || undefined,
        format: 'LENGTH_LOT',
      });
      i += 2;
    }
  }
  return triplets;
}

/** @deprecated استخدم detectParallelRollTriplets */
export function detectChinaTriplets(headers: string[]): Array<{ rollIdx: number; lengthIdx: number; lotIdx: number }> {
  return detectParallelRollTriplets(headers)
    .filter((t) => t.format === 'LENGTH_LOT')
    .map((t) => ({ rollIdx: t.rollIdx, lengthIdx: t.lengthMIdx, lotIdx: t.lotIdx! }));
}

export function isChinaPackingListMetadata(metadata: Record<string, unknown>): boolean {
  const rollCount = Number(metadata.declaredRollCount ?? metadata.declared_roll_count ?? 0);
  const material = String(metadata.materialName ?? metadata.material_name ?? '').trim();
  return rollCount > 0 || material.length > 0;
}

function cellStr(v: unknown): string {
  if (v == null) return '';
  return String(v).trim();
}

function cellNum(v: unknown): number | null {
  const s = cellStr(v).replace(/,/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function isDataSkipRow(row: unknown[]): boolean {
  const joined = row.map((c) => cellStr(c)).filter(Boolean).join(' ');
  if (!joined) return true;
  const upper = joined.toUpperCase();
  if (/^TTY\b/.test(upper)) return true;
  if (/^\d+\s+ROLS?\s*\/\s*[\d,.]+\s*M\b/i.test(joined)) return true;
  if (/^(TOTAL|GRAND|SUB|SUMMARY)\b/.test(upper)) return true;
  return false;
}

function findSectionRow(preTableRows: unknown[][]): unknown[] | undefined {
  for (let i = preTableRows.length - 1; i >= 0; i--) {
    const row = preTableRows[i] ?? [];
    const letters = row
      .map((c) => cellStr(c))
      .filter((c) => /^[A-Z]$/i.test(c));
    if (letters.length >= 2) return row as unknown[];
  }
  return undefined;
}

export type ExpandRollListOptions = {
  sectionRow?: unknown[];
  preTableRows?: unknown[][];
};

/**
 * إذا وُجدت مجموعات أعمدة متوازية (ROLL|M|Y أو ROLL|LENGTH|LOT)، يُعاد صف واحد لكل توب.
 */
export function expandChinaPackingListIfNeeded(
  headers: string[],
  rows: unknown[][],
  metadata: Record<string, unknown> = {},
  options: ExpandRollListOptions = {},
): { headers: string[]; rows: unknown[][]; sourceType: 'CHINA_PACKING_LIST' | 'ROLL_LIST_M_Y' } | null {
  const sectionRow = options.sectionRow ?? (options.preTableRows ? findSectionRow(options.preTableRows) : undefined);
  const triplets = detectParallelRollTriplets(headers, sectionRow);
  const byMeta = isChinaPackingListMetadata(metadata);

  if (triplets.length < 2 && !byMeta) return null;
  if (triplets.length < 1) return null;
  if (triplets.length < 2 && triplets[0]?.format !== 'M_Y') return null;

  const usesMY = triplets.some((t) => t.format === 'M_Y');
  const standardHeaders = usesMY
    ? ['رقم التوب', 'الطول (م)', 'الطول (ياردة)', 'القسم']
    : ['رقم التوب', 'الطول (م)', 'اللوط'];

  const outRows: unknown[][] = [];
  for (const raw of rows) {
    const row = raw ?? [];
    if (isDataSkipRow(row)) continue;

    for (const t of triplets) {
      const rollNo = cellStr(row[t.rollIdx]);
      const lengthM = row[t.lengthMIdx];
      const lenM = cellNum(lengthM);
      if (!rollNo) continue;
      if (isImportSummaryRollNo(rollNo)) continue;
      if (lenM == null || lenM <= 0 || lenM > 500) continue;

      if (t.format === 'M_Y') {
        const lengthY = t.lengthYIdx != null ? row[t.lengthYIdx] : null;
        outRows.push([rollNo, lengthM, lengthY, t.sectionLabel ?? '']);
      } else {
        const lot = t.lotIdx != null ? cellStr(row[t.lotIdx]) : '';
        outRows.push([rollNo, lengthM, lot]);
      }
    }
  }

  if (!outRows.length) return null;

  return {
    headers: standardHeaders,
    rows: outRows,
    sourceType: usesMY ? 'ROLL_LIST_M_Y' : 'CHINA_PACKING_LIST',
  };
}
