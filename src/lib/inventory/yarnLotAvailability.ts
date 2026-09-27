import type { YarnLotDto } from '../api/yarnLotsApi';

const WEIGHT_EPS = 1e-6;

/** Numeric kg on a yarn lot row. */
export function getYarnLotWeightKg(lot: YarnLotDto | Record<string, unknown>): number {
  const r = lot as Record<string, unknown>;
  const raw = r.weight_kg;
  const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

/** Yarn lot is sellable from warehouse stock: AVAILABLE and positive weight. */
export function isYarnLotAvailableForSale(lot: YarnLotDto | Record<string, unknown>): boolean {
  const status = (lot as Record<string, unknown>).status;
  if (status !== 'AVAILABLE') return false;
  return getYarnLotWeightKg(lot) > WEIGHT_EPS;
}
