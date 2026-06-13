import type { Pool } from 'pg';
import { cleanNumber, cleanString, type NormalizedField } from './importColumnDetector.js';
import { isImportSummaryRollNo } from './importSheetMetadata.js';

export type NormalizedRowData = Partial<Record<NormalizedField, string | number | null>>;

export type ImportAutoRepairNote = {
  code: string;
  message: string;
  before?: string;
  after?: string;
};

export type ImportAutoRepairContext = {
  rowNo: number;
  companyId: string;
  batchId: string;
  fileMaterialName?: string;
  fileDesignCode?: string;
  fileWidthCmAvg?: number;
  barcodesInFile: Set<string>;
  pool: Pool;
};

async function isBarcodeTaken(pool: Pool, companyId: string, barcode: string): Promise<boolean> {
  const r = await pool.query<{ id: string }>(
    'SELECT id FROM fabric_rolls WHERE company_id=$1 AND barcode=$2 LIMIT 1',
    [companyId, barcode],
  );
  return r.rows.length > 0;
}

function candidateBarcode(base: string, rowNo: number, tag: string): string {
  const b = base.trim();
  return b ? `${b}-${tag}${rowNo}` : `IMP-${rowNo}`;
}

async function reserveUniqueBarcode(
  pool: Pool,
  companyId: string,
  serial: string,
  rowNo: number,
  barcodesInFile: Set<string>,
): Promise<{ barcode: string; note: ImportAutoRepairNote }> {
  const candidates = [
    serial.trim(),
    candidateBarcode(serial, rowNo, 'R'),
    candidateBarcode(serial, rowNo, 'IMP'),
    `IMP-${rowNo}-${Math.random().toString(36).slice(2, 7)}`,
  ].filter(Boolean);

  for (const preferred of candidates) {
    if (barcodesInFile.has(preferred)) continue;
    if (await isBarcodeTaken(pool, companyId, preferred)) continue;
    const changed = preferred !== serial.trim();
    return {
      barcode: preferred,
      note: {
        code: changed ? 'BARCODE_DEDUP' : 'BARCODE_SET',
        message: changed
          ? `باركود مكرر — السيريال الأصلي ${serial}، الباركود ${preferred}`
          : `تعيين الباركود = ${preferred}`,
        before: changed ? serial : undefined,
        after: preferred,
      },
    };
  }

  const fallback = `IMP-${rowNo}-${Date.now().toString(36).slice(-5)}`;
  return {
    barcode: fallback,
    note: { code: 'BARCODE_GENERATED', message: `توليد باركود: ${fallback}`, after: fallback },
  };
}

/**
 * إصلاح تلقائي لصف الاستيراد قبل التحقق:
 * - ربط رقم التوب / مرجع المورد / الباركود
 * - حل تكرار الباركود داخل الملف أو في قاعدة البيانات (مع الإبقاء على السيريال الأصلي)
 * - تعبئة حقول فارغة من بيانات ملف التعبئة
 */
export async function applyImportAutoRepairs(
  input: NormalizedRowData,
  ctx: ImportAutoRepairContext,
): Promise<{ nd: NormalizedRowData; notes: ImportAutoRepairNote[] }> {
  const nd = { ...input } as NormalizedRowData;
  const notes: ImportAutoRepairNote[] = [];
  const push = (note: ImportAutoRepairNote) => notes.push(note);

  let rollNo: string | null = cleanString(nd.rollNo);
  let supplierRef: string | null = cleanString(nd.supplierRollRef);
  let barcode: string | null = cleanString(nd.barcode);

  if (rollNo && isImportSummaryRollNo(rollNo)) rollNo = null;
  if (supplierRef && isImportSummaryRollNo(supplierRef)) supplierRef = null;
  if (barcode && isImportSummaryRollNo(barcode)) barcode = null;

  if (rollNo && !supplierRef) {
    (nd as Record<string, unknown>).supplierRollRef = rollNo;
    supplierRef = rollNo;
    push({ code: 'SUPPLIER_REF', message: `ربط مرجع المورد برقم التوب ${rollNo}` });
  }
  if (!rollNo && supplierRef) {
    (nd as Record<string, unknown>).rollNo = supplierRef;
    rollNo = supplierRef;
    push({ code: 'ROLL_NO', message: `تعيين رقم التوب من مرجع المورد ${supplierRef}` });
  }
  if (!rollNo && !supplierRef && barcode) {
    (nd as Record<string, unknown>).rollNo = barcode;
    (nd as Record<string, unknown>).supplierRollRef = barcode;
    rollNo = barcode;
    supplierRef = barcode;
    push({ code: 'ROLL_FROM_BARCODE', message: `تعيين رقم التوب من الباركود ${barcode}` });
  }

  const originalSerial = rollNo || supplierRef;
  if (!originalSerial) {
    const synth = `IMP-${ctx.batchId.replace(/-/g, '').slice(0, 6)}-${ctx.rowNo}`;
    (nd as Record<string, unknown>).rollNo = synth;
    (nd as Record<string, unknown>).supplierRollRef = synth;
    rollNo = synth;
    supplierRef = synth;
    push({ code: 'SERIAL_GENERATED', message: `توليد رقم توب: ${synth}`, after: synth });
  }

  if (!cleanString(nd.materialName) && ctx.fileMaterialName) {
    (nd as Record<string, unknown>).materialName = ctx.fileMaterialName;
    push({ code: 'MATERIAL', message: `تعيين الخامة من الملف: ${ctx.fileMaterialName}` });
  }
  if (!cleanString(nd.supplierMaterialCode) && ctx.fileDesignCode) {
    (nd as Record<string, unknown>).supplierMaterialCode = ctx.fileDesignCode;
    (nd as Record<string, unknown>).internalMaterialCode = ctx.fileDesignCode;
    push({ code: 'DESIGN', message: `تعيين كود التصميم من الملف: ${ctx.fileDesignCode}` });
  }
  if (cleanNumber(nd.widthCm) == null && ctx.fileWidthCmAvg && ctx.fileWidthCmAvg > 0) {
    (nd as Record<string, unknown>).widthCm = ctx.fileWidthCmAvg;
    push({ code: 'WIDTH', message: `تعيين العرض من الملف: ${ctx.fileWidthCmAvg} سم` });
  }

  const lengthM = cleanNumber(nd.lengthM);
  if (nd.lengthM === undefined || nd.lengthM === null || nd.lengthM === '') {
    (nd as Record<string, unknown>).lengthM = 0;
    push({ code: 'LENGTH_EMPTY', message: 'الطول فارغ — تسجيل صفر (تحذير)' });
  } else if (lengthM === null || lengthM < 0) {
    (nd as Record<string, unknown>).lengthM = 0;
    push({ code: 'LENGTH_FIX', message: 'تصحيح طول غير صالح إلى صفر' });
  }

  if (
    nd.widthCm !== null &&
    nd.widthCm !== undefined &&
    nd.widthCm !== '' &&
    (cleanNumber(nd.widthCm) === null || (cleanNumber(nd.widthCm) ?? 0) <= 0)
  ) {
    delete (nd as Record<string, unknown>).widthCm;
    if (ctx.fileWidthCmAvg && ctx.fileWidthCmAvg > 0) {
      (nd as Record<string, unknown>).widthCm = ctx.fileWidthCmAvg;
      push({ code: 'WIDTH_FIX', message: `استبدال عرض غير صالح بعرض الملف: ${ctx.fileWidthCmAvg} سم` });
    } else {
      push({ code: 'WIDTH_CLEAR', message: 'إزالة عرض غير صالح' });
    }
  }

  if (
    nd.gsm !== null &&
    nd.gsm !== undefined &&
    nd.gsm !== '' &&
    (cleanNumber(nd.gsm) === null || (cleanNumber(nd.gsm) ?? 0) <= 0)
  ) {
    delete (nd as Record<string, unknown>).gsm;
    push({ code: 'GSM_CLEAR', message: 'إزالة GSM غير صالح' });
  }

  const serialForBarcode = rollNo || supplierRef || `IMP-${ctx.rowNo}`;
  const currentBarcode = cleanString(nd.barcode);
  const needsBarcode =
    !currentBarcode ||
    ctx.barcodesInFile.has(currentBarcode) ||
    (await isBarcodeTaken(ctx.pool, ctx.companyId, currentBarcode));

  if (needsBarcode) {
    const { barcode: nextBarcode, note } = await reserveUniqueBarcode(
      ctx.pool,
      ctx.companyId,
      serialForBarcode,
      ctx.rowNo,
      ctx.barcodesInFile,
    );
    (nd as Record<string, unknown>).barcode = nextBarcode;
    (nd as Record<string, unknown>).rollNo = rollNo || serialForBarcode;
    (nd as Record<string, unknown>).supplierRollRef = supplierRef || serialForBarcode;
    push(note);
  }

  return { nd, notes };
}
