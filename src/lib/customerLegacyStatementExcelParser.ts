/**
 * محلّل ملفات "كشف حساب تفصيلي" المُصدَّرة من برنامج محاسبي قديم ملغي عن
 * الخدمة — يُستخدَم فقط لاستيراد أرشيفي للقراءة (لا ينشئ فواتير/سندات/قيود GL
 * حقيقية). الصيغة: صف عناوين واحد، صف "رصيد لتاريخه" (الرصيد الافتتاحي)، ثم
 * تكرار: صف رأس مستند (نوع السند غير فارغ) تتبعه صفوف تفصيل (نوع السند فارغ)،
 * وفي النهاية صف فاصل فارغ ثم صف إجمالي "الرصيد مدين/الرصيد دائن/مجموع مدين/
 * مجموع دائن".
 */
import * as XLSX from 'xlsx';

export interface LegacyStatementParsedRow {
  rowIndex: number;
  headerRowIndex: number;
  documentType: string | null;
  documentNo: string | null;
  documentDate: string | null;
  documentRef: string | null;
  description: string | null;
  unitPrice: number | null;
  quantity: number | null;
  bonus: number | null;
  pieceCount: number | null;
  lineTotal: number | null;
  unit: string | null;
  warehouseName: string | null;
  rollLotNo: string | null;
  itemCode: string | null;
  netAmount: number | null;
  priceWithTax: number | null;
  debit: number;
  credit: number;
  netDebit: number;
  netCredit: number;
  currencyCode: string | null;
  raw: unknown[];
}

export interface ParsedLegacyStatement {
  sheetName: string;
  rows: LegacyStatementParsedRow[];
  openingBalanceDebit: number;
  openingBalanceCredit: number;
  closingBalanceDebit: number;
  closingBalanceCredit: number;
  totalDebit: number;
  totalCredit: number;
  documentTypeCounts: Record<string, number>;
}

const COLS = {
  netDebit: 'صافي مدين',
  netCredit: 'صافي دائن',
  debit: 'مدين',
  credit: 'دائن',
  documentDate: 'تاريخ السند',
  documentNo: 'رقم السند',
  documentType: 'نوع السند',
  documentRef: 'رقم الوثيقة',
  description: 'البيان',
  unitPrice: 'السعر',
  quantity: 'الكمية',
  bonus: 'بونص',
  pieceCount: 'العدد',
  lineTotal: 'الإجمالي',
  unit: 'الواحدة',
  currency: 'العملة',
  rollLotNo: 'رقم التشغيلة',
  warehouseName: 'اسم المخزن',
  netAmount: 'الصافي',
  priceWithTax: 'السعر مع الضريبة',
  itemCode: 'رقم الصنف',
};

function num(v: unknown): number | null {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
  const s = String(v ?? '').trim();
  return s ? s : null;
}

export async function parseLegacyStatementWorkbook(file: File): Promise<ParsedLegacyStatement> {
  const buf = await file.arrayBuffer();
  const workbook = XLSX.read(buf, { cellDates: false, cellNF: true, cellStyles: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });
  if (!raw.length) throw new Error('الملف فارغ');

  const headerRow = raw[0].map((h) => String(h ?? '').trim());
  const colIndex = (label: string) => headerRow.indexOf(label);
  const idx = Object.fromEntries(Object.entries(COLS).map(([key, label]) => [key, colIndex(label)])) as Record<
    keyof typeof COLS,
    number
  >;

  const rows: LegacyStatementParsedRow[] = [];
  let openingBalanceDebit = 0;
  let openingBalanceCredit = 0;
  let closingBalanceDebit = 0;
  let closingBalanceCredit = 0;
  let totalDebit = 0;
  let totalCredit = 0;
  const documentTypeCounts: Record<string, number> = {};
  let lastHeaderRowIndex = 0;

  for (let i = 1; i < raw.length; i++) {
    const r = raw[i];
    const isBlank = r.every((c) => String(c ?? '').trim() === '');
    if (isBlank) continue;

    const description = str(r[idx.description]);

    // صف إجمالي الختام — "الرصيد مدين/الرصيد دائن/مجموع مدين/مجموع دائن" (عناوين،
    // ثم الصف التالي يحمل القيم الفعلية بنفس ترتيب أعمدة صافي مدين/صافي دائن/مدين/دائن).
    if (r[0] === 'الرصيد مدين' && r[1] === 'الرصيد دائن') {
      const valuesRow = raw[i + 1];
      if (valuesRow) {
        closingBalanceDebit = num(valuesRow[0]) ?? 0;
        closingBalanceCredit = num(valuesRow[1]) ?? 0;
        totalDebit = num(valuesRow[2]) ?? 0;
        totalCredit = num(valuesRow[3]) ?? 0;
      }
      i++; // تخطّي صف القيم أيضاً
      continue;
    }

    const documentType = str(r[idx.documentType]);

    if (description === 'رصيد لتاريخه') {
      openingBalanceDebit = num(r[idx.debit]) ?? 0;
      openingBalanceCredit = num(r[idx.credit]) ?? 0;
      lastHeaderRowIndex = i;
      rows.push({
        rowIndex: i,
        headerRowIndex: i,
        documentType: null,
        documentNo: null,
        documentDate: null,
        documentRef: null,
        description,
        unitPrice: null,
        quantity: null,
        bonus: null,
        pieceCount: null,
        lineTotal: null,
        unit: null,
        warehouseName: null,
        rollLotNo: null,
        itemCode: null,
        netAmount: null,
        priceWithTax: null,
        debit: num(r[idx.debit]) ?? 0,
        credit: num(r[idx.credit]) ?? 0,
        netDebit: num(r[idx.netDebit]) ?? 0,
        netCredit: num(r[idx.netCredit]) ?? 0,
        currencyCode: str(r[idx.currency]),
        raw: r,
      });
      continue;
    }

    const isHeader = Boolean(documentType);
    if (isHeader) {
      lastHeaderRowIndex = i;
      documentTypeCounts[documentType!] = (documentTypeCounts[documentType!] ?? 0) + 1;
    }

    rows.push({
      rowIndex: i,
      headerRowIndex: lastHeaderRowIndex,
      documentType,
      documentNo: str(r[idx.documentNo]),
      documentDate: str(r[idx.documentDate]),
      documentRef: str(r[idx.documentRef]),
      description,
      unitPrice: num(r[idx.unitPrice]),
      quantity: num(r[idx.quantity]),
      bonus: num(r[idx.bonus]),
      pieceCount: num(r[idx.pieceCount]),
      lineTotal: num(r[idx.lineTotal]),
      unit: str(r[idx.unit]),
      warehouseName: str(r[idx.warehouseName]),
      rollLotNo: str(r[idx.rollLotNo]),
      itemCode: str(r[idx.itemCode]),
      netAmount: num(r[idx.netAmount]),
      priceWithTax: num(r[idx.priceWithTax]),
      debit: num(r[idx.debit]) ?? 0,
      credit: num(r[idx.credit]) ?? 0,
      netDebit: num(r[idx.netDebit]) ?? 0,
      netCredit: num(r[idx.netCredit]) ?? 0,
      currencyCode: str(r[idx.currency]),
      raw: r,
    });
  }

  return {
    sheetName,
    rows,
    openingBalanceDebit,
    openingBalanceCredit,
    closingBalanceDebit,
    closingBalanceCredit,
    totalDebit,
    totalCredit,
    documentTypeCounts,
  };
}
