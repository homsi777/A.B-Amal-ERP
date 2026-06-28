import { apiFetch, ApiRequestError } from './client';
import type { CartelaCareSymbolId, CartelaCompositionLine } from '../cartela/careSymbols';

export interface CartelaFiberType {
  id: string;
  name_en: string;
  sort_order: number;
  created_at: string;
}

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
  composition_lines: CartelaCompositionLine[];
  care_symbols: CartelaCareSymbolId[];
  serial_no: string;
  show_logo: boolean;
  font_size_pt: number;
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
  color_count?: number;
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
  compositionLines: CartelaCompositionLine[];
  careSymbols: CartelaCareSymbolId[];
  serialNo: string;
  showLogo: boolean;
  fontSizePt: number;
};

export async function listCartelaFiberTypes(): Promise<CartelaFiberType[]> {
  const res = await apiFetch<{ ok: boolean; data: CartelaFiberType[] }>('/api/cartela/fiber-types');
  return res.data;
}

export async function createCartelaFiberType(nameEn: string): Promise<CartelaFiberType> {
  const res = await apiFetch<{ ok: boolean; data: CartelaFiberType }>('/api/cartela/fiber-types', {
    method: 'POST',
    body: JSON.stringify({ nameEn }),
  });
  return res.data;
}

export async function deleteCartelaFiberType(id: string): Promise<void> {
  await apiFetch(`/api/cartela/fiber-types/${id}`, { method: 'DELETE' });
}

export async function listCartelaLabels(search = ''): Promise<CartelaLabelListItem[]> {
  const qs = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : '';
  const res = await apiFetch<{ ok: boolean; data: CartelaLabelListItem[] }>(`/api/cartela${qs}`);
  return res.data;
}

export async function getCartelaLabel(id: string): Promise<CartelaLabelDto> {
  const res = await apiFetch<{ ok: boolean; data: CartelaLabelDto }>(`/api/cartela/${id}`);
  return res.data;
}

export async function generateCartelaLabel(payload: CartelaLabelPayload): Promise<CartelaLabelDto> {
  const res = await apiFetch<{ ok: boolean; data: CartelaLabelDto }>('/api/cartela/generate', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
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

export type CartelaOrderLookup = {
  id: string;
  title: string;
  art_code: string;
  design_no: string;
  serial_no: string;
  width_value: string;
  weight_value: string;
  match_type?: 'cartela' | 'color';
  color?: {
    id: string;
    color_code: string;
    barcode_code: string;
    name_ar: string;
    name_tr: string;
    image_url: string | null;
  };
};

export async function lookupCartelaByScan(scan: string): Promise<CartelaOrderLookup> {
  const qs = encodeURIComponent(scan.trim());
  const res = await apiFetch<{ ok: boolean; data: CartelaOrderLookup & Record<string, unknown> }>(
    `/api/cartela/lookup?scan=${qs}`,
  );
  const data = res.data;
  return {
    id: String(data.id),
    title: String(data.title ?? ''),
    art_code: String(data.art_code ?? ''),
    design_no: String(data.design_no ?? ''),
    serial_no: String(data.serial_no ?? ''),
    width_value: String(data.width_value ?? ''),
    weight_value: String(data.weight_value ?? ''),
    match_type: data.match_type === 'color' ? 'color' : 'cartela',
    color: data.color
      ? {
          id: String((data.color as { id: string }).id),
          color_code: String((data.color as { color_code: string }).color_code ?? ''),
          barcode_code: String((data.color as { barcode_code: string }).barcode_code ?? ''),
          name_ar: String((data.color as { name_ar: string }).name_ar ?? ''),
          name_tr: String((data.color as { name_tr: string }).name_tr ?? ''),
          image_url: (data.color as { image_url: string | null }).image_url ?? null,
        }
      : undefined,
  };
}

export type QuickCartelaDraftPayload = {
  serialNo: string;
  title?: string;
  artCode?: string;
  designNo?: string;
};

/** إنشاء مسودة كارتيلا إذا لم تُوجَد — أو إرجاع الموجودة */
export async function createQuickCartelaDraft(payload: QuickCartelaDraftPayload): Promise<CartelaLabelDto> {
  const res = await apiFetch<{ ok: boolean; data: CartelaLabelDto }>('/api/cartela/quick-draft', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return res.data;
}

/** يضمن وجود كارتيلا لباركود غير مسجّل (مسودة قابلة للتعديل لاحقاً) */
export async function ensureQuickCartelaDraft(payload: QuickCartelaDraftPayload): Promise<CartelaLabelDto | null> {
  const scan = payload.serialNo.trim();
  if (!scan) return null;
  try {
    await lookupCartelaByScan(scan);
    return null;
  } catch (e) {
    if (!(e instanceof ApiRequestError) || e.statusCode !== 404) throw e;
  }
  return createQuickCartelaDraft(payload);
}

function parseCompositionLines(raw: unknown): CartelaCompositionLine[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((line) => {
      const row = line as Record<string, unknown>;
      return {
        percent: Number(row.percent ?? 0),
        fiberTypeId: typeof row.fiberTypeId === 'string' ? row.fiberTypeId : null,
        fiberName: String(row.fiberName ?? row.fiber_name ?? '').trim(),
      };
    })
    .filter((line) => line.percent > 0 && line.fiberName);
}

export function cartelaDtoToPayload(row: CartelaLabelDto): CartelaLabelPayload {
  const lines = parseCompositionLines(row.composition_lines);
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
    compositionLines: lines.length ? lines : [{ percent: 0, fiberTypeId: null, fiberName: '' }],
    careSymbols: Array.isArray(row.care_symbols) ? row.care_symbols : [],
    serialNo: row.serial_no ?? '',
    showLogo: Boolean(row.show_logo),
    fontSizePt: Number(row.font_size_pt ?? 6.8),
  };
}

export function cartelaListLabel(row: CartelaLabelListItem): string {
  const parts = [row.art_code, row.design_no].filter(Boolean);
  if (row.title.trim()) return row.title.trim();
  return parts.length ? parts.join(' · ') : 'كارتيلا جديدة';
}

export const CARTELA_PERCENT_OPTIONS = Array.from({ length: 100 }, (_, index) => index + 1);
