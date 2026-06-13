/**
 * توسيع قوائم التعبئة الصينية (أعمدة متوازية: ROLL NO | LENGTH | LOT).
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
  return n.includes('length') || n.includes('الطول') || n.includes('meter') || n.includes('متر') || n.includes('yard') || n.includes('يارد');
}

function isLotHeader(h: string): boolean {
  const n = normHeader(h);
  return n.includes('lot') || n.includes('batch') || n.includes('اللوط') || n.includes('لوط');
}

export type ChinaTriplet = { rollIdx: number; lengthIdx: number; lotIdx: number };

export function detectChinaTriplets(headers: string[]): ChinaTriplet[] {
  const triplets: ChinaTriplet[] = [];
  for (let i = 0; i < headers.length - 2; i++) {
    const h0 = headers[i] ?? '';
    const h1 = headers[i + 1] ?? '';
    const h2 = headers[i + 2] ?? '';
    if (isRollHeader(h0) && isLengthHeader(h1) && isLotHeader(h2)) {
      triplets.push({ rollIdx: i, lengthIdx: i + 1, lotIdx: i + 2 });
      i += 2;
    }
  }
  return triplets;
}

export function isChinaPackingListMetadata(metadata: Record<string, unknown>): boolean {
  const rollCount = Number(metadata.declaredRollCount ?? metadata.declared_roll_count ?? 0);
  const material = String(metadata.materialName ?? metadata.material_name ?? '').trim();
  return rollCount > 0 || material.length > 0;
}

const STANDARD_HEADERS = ['رقم التوب', 'الطول (م)', 'اللوط'];

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

/**
 * إذا وُجدت مجموعات أعمدة متوازية (3+ أتواب في الصف)، يُعاد تنسيق موحّد لصف واحد لكل توب.
 */
export function expandChinaPackingListIfNeeded(
  headers: string[],
  rows: unknown[][],
  metadata: Record<string, unknown> = {},
): { headers: string[]; rows: unknown[][]; sourceType: 'CHINA_PACKING_LIST' } | null {
  const triplets = detectChinaTriplets(headers);
  const byMeta = isChinaPackingListMetadata(metadata);
  if (triplets.length < 2 && !byMeta) return null;
  if (triplets.length < 1 && byMeta) {
    // ملف صيني لكن رأس واحد فقط — لا توسيع
    return null;
  }
  if (triplets.length < 2) return null;

  const outRows: unknown[][] = [];
  for (const raw of rows) {
    const row = raw ?? [];
    const nonEmpty = row.filter((v) => cellStr(v) !== '');
    if (nonEmpty.length === 0) continue;

    for (const t of triplets) {
      const rollNo = cellStr(row[t.rollIdx]);
      const length = row[t.lengthIdx];
      const lot = cellStr(row[t.lotIdx]);
      const lenM = cellNum(length);
      if (!rollNo) continue;
      if (isImportSummaryRollNo(rollNo)) continue;
      if (lenM == null || lenM <= 0 || lenM > 200) continue;
      outRows.push([rollNo, length, lot]);
    }
  }

  if (!outRows.length) return null;

  return {
    headers: STANDARD_HEADERS,
    rows: outRows,
    sourceType: 'CHINA_PACKING_LIST',
  };
}
