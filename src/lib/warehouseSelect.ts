import type { ApiWarehouse } from './api/warehousesApi';

/** Resolve stored invoice warehouse (UUID and/or legacy label) to an active warehouse id. */
export function resolveWarehouseIdFromStored(
  warehouseId: string | null | undefined,
  warehouseLabel: string | null | undefined,
  warehouses: ApiWarehouse[],
): string {
  const id = String(warehouseId ?? '').trim();
  if (id && warehouses.some((w) => w.id === id)) return id;

  const rawLabel = String(warehouseLabel ?? '').trim();
  const labelLower = rawLabel.toLowerCase();
  if (!warehouses.length) return id || '';

  if (rawLabel) {
    const exact = warehouses.find(
      (w) => w.name.trim().toLowerCase() === labelLower || w.code.trim().toLowerCase() === labelLower,
    );
    if (exact) return exact.id;

    const partial = warehouses.find((w) => w.name.includes(rawLabel) || rawLabel.includes(w.name));
    if (partial) return partial.id;
  }

  if (rawLabel === 'main' || rawLabel.includes('الرئيسي')) {
    return (warehouses.find((w) => w.type === 'MAIN') ?? warehouses[0]).id;
  }
  if (rawLabel === 'sub' || rawLabel.includes('الجملة')) {
    const nonMain = warehouses.find((w) => w.type !== 'MAIN');
    return (nonMain ?? warehouses[Math.min(1, warehouses.length - 1)]).id;
  }

  return warehouses[0]?.id ?? '';
}

/** Resolve stored order warehouse (legacy key or name) to a display label for the API. */
export function resolveOrderWarehouseLabel(
  stored: string | null | undefined,
  warehouses: ApiWarehouse[],
): string {
  const raw = String(stored ?? '').trim();
  if (!warehouses.length) return raw;
  if (!raw) return warehouses[0].name;
  if (warehouses.some((w) => w.name === raw)) return raw;

  const id = resolveWarehouseIdFromStored(null, raw, warehouses);
  const wh = warehouses.find((w) => w.id === id);
  return wh?.name ?? raw;
}

export function warehouseNameById(id: string, warehouses: ApiWarehouse[]): string {
  return warehouses.find((w) => w.id === id)?.name?.trim() || '—';
}

/** Display label for order exports — supports legacy keys and warehouse names. */
export function orderWarehouseDisplayLabel(warehouse?: string | null): string {
  const raw = String(warehouse ?? '').trim();
  if (!raw || raw === 'main') return 'المستودع الرئيسي';
  if (raw === 'sub') return 'مستودع الجملة';
  return raw;
}
