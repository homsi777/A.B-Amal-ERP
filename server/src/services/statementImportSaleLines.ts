/** Align imported Excel sale lines with invoice amount validation (qty × price = line total). */

export const INVOICE_AMOUNT_EPS = 1e-4;

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function grossLineTotal(quantity: number, unitPrice: number): number {
  return round2(quantity * unitPrice);
}

export type StatementImportSaleLineInput = {
  date?: string;
  originalDateValue?: string;
  dateParseSource?: string;
  materialName?: string;
  quantity: number;
  rolls?: number;
  city?: string;
  unitPrice?: number;
  total: number;
  note?: string;
};

export type NormalizedStatementImportSaleLine = StatementImportSaleLineInput & {
  quantity: number;
  unitPrice: number;
  total: number;
};

/**
 * Excel "الإجمالي" per row is authoritative. Find unit price so round2(qty × price) matches it.
 */
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
  const normalized: NormalizedStatementImportSaleLine[] = lines.map((line) => {
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
