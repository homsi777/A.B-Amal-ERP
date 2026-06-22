import type { FabricRollDto, RollStatus } from '../api/fabricRollsApi';

const LEN_EPS = 1e-6;

/** Numeric meters on a roll row (API snake_case or mixed payloads). */
export function getRollLengthMeters(roll: FabricRollDto | Record<string, unknown>): number {
  const r = roll as Record<string, unknown>;
  const raw = r.length_m ?? r.lengthM ?? r.meters ?? r.length;
  const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function rollStatus(roll: FabricRollDto | Record<string, unknown>): RollStatus | string {
  const s = (roll as Record<string, unknown>).status;
  return typeof s === 'string' ? s : '';
}

const BLOCKED_SALE_STATUSES = new Set(['SOLD', 'INACTIVE', 'DAMAGED', 'TRANSFERRED']);

/**
 * Roll is sellable from warehouse stock: AVAILABLE and positive length.
 * (RESERVED / SOLD / INACTIVE / DAMAGED / TRANSFERRED are excluded via status check.)
 */
export function isRollAvailableForSale(roll: FabricRollDto | Record<string, unknown>): boolean {
  if (rollStatus(roll) !== 'AVAILABLE') return false;
  return getRollLengthMeters(roll) > LEN_EPS;
}

/**
 * Roll may be added to a sales invoice line (including zero-length AVAILABLE rolls
 * that get length completed from the invoice).
 */
export function isRollApplicableToSalesInvoice(roll: FabricRollDto | Record<string, unknown>): boolean {
  const status = rollStatus(roll);
  if (BLOCKED_SALE_STATUSES.has(status)) return false;
  return status === 'AVAILABLE' || status === 'RESERVED';
}

export function rollNeedsLengthCompletionFromInvoice(roll: FabricRollDto | Record<string, unknown>): boolean {
  return isRollApplicableToSalesInvoice(roll) && getRollLengthMeters(roll) <= LEN_EPS;
}

/** Roll is linked to a draft sales invoice (shown in inventory with draft badge). */
export function isRollInDraftSalesInvoice(roll: FabricRollDto | Record<string, unknown>): boolean {
  const r = roll as Record<string, unknown>;
  return Boolean(String(r.draft_sales_invoice_id ?? '').trim() || String(r.draft_sales_invoice_no ?? '').trim());
}

/** True if payload looks like a fabric roll row (has barcode) vs a bare fabric-item suggestion. */
export function isFabricRollStockRow(stock: Record<string, unknown>): boolean {
  return Boolean(String(stock.barcode ?? '').trim());
}
