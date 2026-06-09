import { quantityToMeters } from './salesInvoiceService.js';

const EPS = 1e-4;

export type LengthUnit = 'meter' | 'yard';

/** Convert return line quantity (stored with its `unit`) to meters for comparison with invoice lines. */
export function returnQtyToMeters(quantity: number, unit: LengthUnit): number {
  return quantityToMeters(quantity, unit);
}

export function roundMeters(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Remaining meters on an invoice line given original qty/unit and already-returned meters. */
export function availableMetersOnLine(originalQty: number, originalUnit: LengthUnit, returnedMeters: number): number {
  const origM = returnQtyToMeters(originalQty, originalUnit);
  return roundMeters(Math.max(0, origM - returnedMeters));
}

export function assertQtyWithinAvailable(
  requestedMeters: number,
  availableMeters: number,
  label: string,
): void {
  if (requestedMeters > availableMeters + EPS) {
    throw Object.assign(
      new Error(`الكمية المطلوبة للإرجاع (${requestedMeters.toFixed(3)}م) تتجاوز المتاح (${availableMeters.toFixed(3)}م) — ${label}`),
      { code: 'VALIDATION' },
    );
  }
}
