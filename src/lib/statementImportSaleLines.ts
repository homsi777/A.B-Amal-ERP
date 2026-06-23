/** Client mirror of server statement import line normalization. */

export const INVOICE_AMOUNT_EPS = 1e-4;

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function grossLineTotal(quantity: number, unitPrice: number): number {
  return round2(quantity * unitPrice);
}

export type StatementImportSaleLineInput = {
  date: string;
  originalDateValue: string;
  dateParseSource: string;
  materialName: string;
  quantity: number;
  rolls: number;
  city: string;
  unitPrice: number;
  total: number;
  note: string;
};

export function fitImportedSaleLineAmounts(
  quantity: number,
  excelTotal: number,
): { quantity: number; unitPrice: number; lineTotal: number } {
  const target = round2(excelTotal);
  const qty = quantity > 0 ? quantity : 1;

  for (const decimals of [4, 6, 8, 10, 12]) {
    const unitPrice = Math.round((target / qty) * 10 ** decimals) / 10 ** decimals;
    const gross = grossLineTotal(qty, unitPrice);
    if (Math.abs(gross - target) <= INVOICE_AMOUNT_EPS) {
      return { quantity: qty, unitPrice, lineTotal: gross };
    }
  }

  const base = target / qty;
  for (let delta = -500; delta <= 500; delta++) {
    const unitPrice = Math.round((base + delta / 10000) * 10000) / 10000;
    if (unitPrice <= 0) continue;
    const gross = grossLineTotal(qty, unitPrice);
    if (Math.abs(gross - target) <= INVOICE_AMOUNT_EPS) {
      return { quantity: qty, unitPrice, lineTotal: gross };
    }
  }

  return { quantity: 1, unitPrice: target, lineTotal: target };
}

export function normalizeStatementImportSaleLines(lines: StatementImportSaleLineInput[]) {
  const normalized = lines.map((line) => {
    const fitted = fitImportedSaleLineAmounts(line.quantity, line.total);
    return {
      ...line,
      quantity: fitted.quantity,
      unitPrice: fitted.unitPrice,
      total: fitted.lineTotal,
    };
  });
  const subtotal = round2(normalized.reduce((sum, line) => sum + line.total, 0));
  return { lines: normalized, subtotal };
}

export function scanStatementSheetTotals(rows: unknown[][]) {
  const parseMoney = (value: unknown): number => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    const n = Number(String(value ?? '').replace(/[$,\s]/g, '').trim());
    return Number.isFinite(n) ? n : 0;
  };
  const numericAt = (r: number, c: number) => parseMoney(rows[r - 1]?.[c - 1]);

  let sheetSalesTotal = 0;
  let sheetMetersTotal = 0;
  let sheetRollsTotal = 0;
  let sheetBalance: number | null = null;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const label2 = String(row[2] ?? '').trim();
    const label4 = String(row[4] ?? '').trim();

    if (/اجمالي.*(امتار|أمتار)/i.test(label2)) {
      const data = rows[i + 1] ?? [];
      sheetMetersTotal = parseMoney(data[2]);
      sheetRollsTotal = parseMoney(data[5]);
      sheetSalesTotal = parseMoney(data[8]);
    }

    if (label4 === 'الإجمالي' || label4.includes('الإجمالي')) {
      const nextVal = parseMoney(rows[i + 1]?.[4]);
      if (nextVal > 0) sheetSalesTotal = Math.max(sheetSalesTotal, nextVal);
    }

    const amount4 = parseMoney(row[4]);
    const hasPaymentDate =
      row[2] instanceof Date ||
      typeof row[2] === 'number' ||
      /\d/.test(String(row[2] ?? ''));
    if (amount4 > 0 && !hasPaymentDate && !row[0] && !row[1] && i >= rows.length - 3) {
      sheetBalance = amount4;
    }
  }

  if (!sheetSalesTotal) sheetSalesTotal = numericAt(37, 9) || numericAt(43, 5);
  if (!sheetMetersTotal) sheetMetersTotal = numericAt(37, 3);
  if (!sheetRollsTotal) sheetRollsTotal = numericAt(37, 6);
  if (sheetBalance == null) sheetBalance = numericAt(65, 5) || numericAt(66, 5) || null;

  return { sheetSalesTotal, sheetMetersTotal, sheetRollsTotal, sheetBalance };
}
