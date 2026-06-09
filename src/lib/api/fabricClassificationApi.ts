import { apiFetch } from './client';

export interface ResolveClassificationResponse {
  itemId: string;
  colorId: string;
  variantId: string | null;
  articleCode: string;
  fabricColorName: string;
  colorCode: string;
  designNr: string | null;
  created: { item: boolean; color: boolean; variant: boolean };
}

export async function resolveFabricClassification(body: {
  level1CategoryId: string;
  level2CategoryId: string;
  level3CategoryId: string;
  level4CategoryId: string;
  widthCm?: number | null;
  gsm?: number | null;
}): Promise<ResolveClassificationResponse> {
  const res = await apiFetch<{ ok: boolean; data: ResolveClassificationResponse }>(
    '/api/inventory/fabric-classification/resolve',
    { method: 'POST', body: JSON.stringify(body) },
  );
  return res.data;
}
