import { apiFetch } from './client';

export interface CartelaLabelDto {
  id: string;
  title: string;
  art_code: string;
  design_no: string;
  colour: string;
  width_value: string;
  width_unit: string;
  width_tolerance_enabled: boolean;
  width_tolerance_percent: number;
  weight_value: string;
  weight_unit: string;
  weight_tolerance_enabled: boolean;
  weight_tolerance_percent: number;
  composition: string;
  serial_no: string;
  show_logo: boolean;
  created_at: string;
  updated_at: string;
}

export interface CartelaLabelListItem {
  id: string;
  title: string;
  art_code: string;
  design_no: string;
  colour: string;
  serial_no: string;
  show_logo: boolean;
  created_at: string;
  updated_at: string;
}

export type CartelaLabelPayload = {
  title: string;
  artCode: string;
  designNo: string;
  colour: string;
  widthValue: string;
  widthUnit: string;
  widthToleranceEnabled: boolean;
  widthTolerancePercent: number;
  weightValue: string;
  weightUnit: string;
  weightToleranceEnabled: boolean;
  weightTolerancePercent: number;
  composition: string;
  serialNo: string;
  showLogo: boolean;
};

export async function listCartelaLabels(search = ''): Promise<CartelaLabelListItem[]> {
  const qs = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : '';
  const res = await apiFetch<{ ok: boolean; data: CartelaLabelListItem[] }>(`/api/cartela${qs}`);
  return res.data;
}

export async function getCartelaLabel(id: string): Promise<CartelaLabelDto> {
  const res = await apiFetch<{ ok: boolean; data: CartelaLabelDto }>(`/api/cartela/${id}`);
  return res.data;
}

export async function createCartelaLabel(payload: CartelaLabelPayload): Promise<CartelaLabelDto> {
  const res = await apiFetch<{ ok: boolean; data: CartelaLabelDto }>('/api/cartela', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return res.data;
}

export async function updateCartelaLabel(id: string, payload: CartelaLabelPayload): Promise<CartelaLabelDto> {
  const res = await apiFetch<{ ok: boolean; data: CartelaLabelDto }>(`/api/cartela/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  return res.data;
}

export async function deleteCartelaLabel(id: string): Promise<void> {
  await apiFetch(`/api/cartela/${id}`, { method: 'DELETE' });
}

export function cartelaDtoToPayload(row: CartelaLabelDto): CartelaLabelPayload {
  return {
    title: row.title ?? '',
    artCode: row.art_code ?? '',
    designNo: row.design_no ?? '',
    colour: row.colour ?? '',
    widthValue: row.width_value ?? '',
    widthUnit: row.width_unit ?? 'cm',
    widthToleranceEnabled: Boolean(row.width_tolerance_enabled),
    widthTolerancePercent: Number(row.width_tolerance_percent ?? 3),
    weightValue: row.weight_value ?? '',
    weightUnit: row.weight_unit ?? 'gr/m²',
    weightToleranceEnabled: Boolean(row.weight_tolerance_enabled),
    weightTolerancePercent: Number(row.weight_tolerance_percent ?? 5),
    composition: row.composition ?? '',
    serialNo: row.serial_no ?? '',
    showLogo: Boolean(row.show_logo),
  };
}

export function cartelaListLabel(row: CartelaLabelListItem): string {
  const parts = [row.art_code, row.design_no].filter(Boolean);
  if (row.title.trim()) return row.title.trim();
  return parts.length ? parts.join(' · ') : 'كارتيلا جديدة';
}
