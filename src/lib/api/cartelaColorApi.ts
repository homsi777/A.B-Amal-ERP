import { apiFetch } from './client';
import type { CartelaLabelDto } from './cartelaApi';

export interface CartelaColorSwatchDto {
  id: string;
  cartela_label_id: string;
  color_no: number;
  color_code: string;
  barcode_code: string;
  name_ar: string;
  name_tr: string;
  notes: string | null;
  image_url: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export type CartelaColorSwatchPayload = {
  colorCode: string;
  nameAr?: string;
  nameTr?: string;
  notes?: string | null;
  imageUrl?: string | null;
  colorNo?: number;
};

export type CartelaColorLookupResult = CartelaLabelDto & {
  match_type: 'cartela' | 'color';
  color?: CartelaColorSwatchDto;
};

export async function listCartelaColors(cartelaId: string): Promise<CartelaColorSwatchDto[]> {
  const res = await apiFetch<{ ok: boolean; data: CartelaColorSwatchDto[] }>(
    `/api/cartela/${encodeURIComponent(cartelaId)}/colors`,
  );
  return res.data;
}

export async function createCartelaColor(
  cartelaId: string,
  payload: CartelaColorSwatchPayload,
): Promise<CartelaColorSwatchDto> {
  const res = await apiFetch<{ ok: boolean; data: CartelaColorSwatchDto }>(
    `/api/cartela/${encodeURIComponent(cartelaId)}/colors`,
    { method: 'POST', body: JSON.stringify(payload) },
  );
  return res.data;
}

export async function updateCartelaColor(
  colorId: string,
  payload: CartelaColorSwatchPayload,
): Promise<CartelaColorSwatchDto> {
  const res = await apiFetch<{ ok: boolean; data: CartelaColorSwatchDto }>(
    `/api/cartela/color-swatches/${encodeURIComponent(colorId)}`,
    { method: 'PUT', body: JSON.stringify(payload) },
  );
  return res.data;
}

export async function deleteCartelaColor(colorId: string): Promise<void> {
  await apiFetch(`/api/cartela/color-swatches/${encodeURIComponent(colorId)}`, { method: 'DELETE' });
}

export async function lookupCartelaScan(scan: string): Promise<CartelaColorLookupResult> {
  const qs = encodeURIComponent(scan.trim());
  const res = await apiFetch<{ ok: boolean; data: CartelaColorLookupResult }>(`/api/cartela/lookup?scan=${qs}`);
  return res.data;
}

export function cartelaColorDisplayName(color: CartelaColorSwatchDto): string {
  const parts = [color.name_ar, color.name_tr].map((v) => v.trim()).filter(Boolean);
  return parts.join(' / ') || color.color_code;
}
