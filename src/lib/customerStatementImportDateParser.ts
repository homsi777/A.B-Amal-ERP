export type CustomerStatementDateParseSource =
  | 'excel_serial'
  | 'date_object'
  | 'text_dmy'
  | 'text_ymd'
  | 'text_mdy'
  | 'unknown';

export type CustomerStatementDateParseResult =
  | {
      ok: true;
      date: string;
      originalValue: string;
      source: Exclude<CustomerStatementDateParseSource, 'unknown'>;
      warning?: string;
    }
  | {
      ok: false;
      date: null;
      originalValue: string;
      source: 'unknown';
      error: string;
    };

const EXCEL_EPOCH_1900 = Date.UTC(1899, 11, 30);
const DAY_MS = 24 * 60 * 60 * 1000;

function normalizeDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0));
}

function originalValueText(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (value == null) return '';
  return String(value).trim();
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function yearFromToken(value: number): number {
  if (value >= 100) return value;
  return value >= 70 ? 1900 + value : 2000 + value;
}

function isValidDateParts(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function formatDate(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function success(
  year: number,
  month: number,
  day: number,
  originalValue: string,
  source: Exclude<CustomerStatementDateParseSource, 'unknown'>,
  warning?: string,
): CustomerStatementDateParseResult {
  if (!isValidDateParts(year, month, day)) {
    return {
      ok: false,
      date: null,
      originalValue,
      source: 'unknown',
      error: 'تاريخ غير صالح في ملف Excel',
    };
  }
  return { ok: true, date: formatDate(year, month, day), originalValue, source, warning };
}

function parseExcelSerial(value: number, originalValue: string): CustomerStatementDateParseResult {
  if (!Number.isFinite(value) || value <= 0 || value > 80000) {
    return {
      ok: false,
      date: null,
      originalValue,
      source: 'unknown',
      error: 'رقم تاريخ Excel غير صالح',
    };
  }
  const date = new Date(EXCEL_EPOCH_1900 + Math.floor(value) * DAY_MS);
  const parsed = success(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
    originalValue,
    'excel_serial',
    `تم اكتشاف تاريخ Excel رقمي وتم تحويله إلى: ${formatDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())}`,
  );
  return parsed;
}

export function parseCustomerStatementImportDate(value: unknown): CustomerStatementDateParseResult {
  const originalValue = originalValueText(value);
  if (!originalValue) {
    return {
      ok: false,
      date: null,
      originalValue,
      source: 'unknown',
      error: 'التاريخ فارغ في ملف Excel',
    };
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      return {
        ok: false,
        date: null,
        originalValue,
        source: 'unknown',
        error: 'كائن تاريخ غير صالح من Excel',
      };
    }
    return success(value.getFullYear(), value.getMonth() + 1, value.getDate(), originalValue, 'date_object');
  }

  if (typeof value === 'number') return parseExcelSerial(value, originalValue);

  const text = normalizeDigits(originalValue)
    .replace(/مرتجع/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const ymd = text.match(/(\d{4})[\/\\.-](\d{1,2})[\/\\.-](\d{1,2})/);
  if (ymd) {
    return success(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]), originalValue, 'text_ymd');
  }

  const dmyOrMdy = text.match(/(\d{1,2})[\/\\.-](\d{1,2})[\/\\.-](\d{2,4})/);
  if (dmyOrMdy) {
    const first = Number(dmyOrMdy[1]);
    const second = Number(dmyOrMdy[2]);
    const year = yearFromToken(Number(dmyOrMdy[3]));

    if (first <= 12 && second > 12) {
      return success(year, first, second, originalValue, 'text_mdy');
    }

    return success(year, second, first, originalValue, 'text_dmy');
  }

  return {
    ok: false,
    date: null,
    originalValue,
    source: 'unknown',
    error: 'تعذر قراءة تاريخ هذا السطر من ملف Excel',
  };
}

