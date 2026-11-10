/**
 * محلّل شيت "الاجر" من ملفات الرواتب الشهرية (مثل "مرتبات ادارة النسيج اكتوبر
 * 2026.xlsx") — هذا الشيت يحتوي الأرقام النهائية المحسوبة فعلاً بالنظام القديم
 * لكل موظف (صيغ حقيقية فُحِصت ومُطابَقة)، فلا نعيد حسابها — ننسخها كما هي.
 * المطابقة بالعناوين النصّية للأعمدة (مرنة لاختلافات طفيفة بين الملفين)، مع
 * أعمدة مرجعية ثابتة (الكود/الأجر الأساسي/الإجمالي/المستقطع/الصافي) تأكَّد
 * تطابق موضعها بين ملفي الإدارة والصالة فعلياً.
 */
import * as XLSX from 'xlsx';

export interface PayrollExcelRow {
  employeeCode: string;
  fullName: string;
  factory: string | null;
  department: string | null;
  jobTitle: string | null;
  category: string | null;
  paymentMethod: string | null;
  hireDate: string | null;
  baseSalary: number;
  totalEntitlements: number;
  totalDeductions: number;
  finalNet: number;
  /** نسخة كاملة بكل عناوين الأعمدة غير الفارغة لهذا الصف — للطباعة/التحقق. */
  rawDetail: Record<string, unknown>;
}

export interface ParsedPayrollExcel {
  sheetName: string;
  rows: PayrollExcelRow[];
}

const EXCEL_EPOCH_1900 = Date.UTC(1899, 11, 30);
const DAY_MS = 24 * 60 * 60 * 1000;

function excelSerialToIsoDate(value: unknown): string | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const date = new Date(EXCEL_EPOCH_1900 + Math.floor(n) * DAY_MS);
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function findCol(header: unknown[], label: string): number {
  const target = label.trim();
  return header.findIndex((h) => String(h ?? '').trim() === target);
}

function findLastCol(header: unknown[], label: string): number {
  const target = label.trim();
  for (let i = header.length - 1; i >= 0; i--) {
    if (String(header[i] ?? '').trim() === target) return i;
  }
  return -1;
}

export async function parsePayrollWorkbook(file: File): Promise<ParsedPayrollExcel> {
  const buf = await file.arrayBuffer();
  const workbook = XLSX.read(buf, { cellDates: false });
  const sheetName = workbook.SheetNames.find((n) => n.trim() === 'الاجر') || workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });
  if (raw.length < 5) throw new Error('الملف لا يحتوي شيت "الاجر" بالتصميم المتوقَّع');

  const header = raw[3];
  const codeCol = findCol(header, 'الكود');
  const nameCol = findCol(header, 'الاسم');
  const factoryCol = findCol(header, 'المصنع');
  const departmentCol = findCol(header, 'القسم');
  const jobTitleCol = findCol(header, 'الوظيفة');
  const categoryCol = findCol(header, 'الفئة');
  const paymentMethodCol = findCol(header, 'طريقة القبض ');
  const hireDateCol = findCol(header, 'تاريخ التعيين ');
  const baseSalaryCol = findCol(header, 'الاجر الاساسى ');
  const totalEntitlementsCol = findCol(header, 'إجمالي الإستحقاقات');
  const totalDeductionsCol = findCol(header, 'المستقطع');
  const finalNetCol = findLastCol(header, 'الصافى بعد التقريب');

  if (codeCol < 0 || baseSalaryCol < 0 || totalEntitlementsCol < 0 || totalDeductionsCol < 0 || finalNetCol < 0) {
    throw new Error('تعذر العثور على الأعمدة الأساسية (الكود/الأجر الأساسي/الإجمالي/المستقطع/الصافي) بالملف');
  }

  const identityCols = new Set(
    [codeCol, nameCol, factoryCol, departmentCol, jobTitleCol, categoryCol, paymentMethodCol, hireDateCol].filter(
      (c) => c >= 0,
    ),
  );

  const rows: PayrollExcelRow[] = [];
  for (let i = 4; i < raw.length; i++) {
    const r = raw[i];
    const employeeCode = String(r[codeCol] ?? '').trim();
    if (!employeeCode) continue;

    const rawDetail: Record<string, unknown> = {};
    for (let c = 0; c < header.length; c++) {
      const label = String(header[c] ?? '').trim();
      if (!label || identityCols.has(c)) continue;
      const value = r[c];
      if (value !== '' && value !== null && value !== undefined) rawDetail[label] = value;
    }

    rows.push({
      employeeCode,
      fullName: String(r[nameCol] ?? '').trim(),
      factory: factoryCol >= 0 ? String(r[factoryCol] ?? '').trim() || null : null,
      department: departmentCol >= 0 ? String(r[departmentCol] ?? '').trim() || null : null,
      jobTitle: jobTitleCol >= 0 ? String(r[jobTitleCol] ?? '').trim() || null : null,
      category: categoryCol >= 0 ? String(r[categoryCol] ?? '').trim() || null : null,
      paymentMethod: paymentMethodCol >= 0 ? String(r[paymentMethodCol] ?? '').trim() || null : null,
      hireDate: hireDateCol >= 0 ? excelSerialToIsoDate(r[hireDateCol]) : null,
      baseSalary: Number(r[baseSalaryCol]) || 0,
      totalEntitlements: Number(r[totalEntitlementsCol]) || 0,
      totalDeductions: Number(r[totalDeductionsCol]) || 0,
      finalNet: Number(r[finalNetCol]) || 0,
      rawDetail,
    });
  }

  return { sheetName, rows };
}
