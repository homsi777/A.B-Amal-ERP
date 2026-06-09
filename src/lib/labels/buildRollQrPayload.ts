/** Structured QR payload for fabric roll labels — compact pipe format. */

export type RollQrPayloadInput = {
  rollId?: string;
  barcode: string;
  lot?: string;
  articleCode: string;
  fabricName: string;
  fabricColor: string;
  colorCode: string;
  widthCm: number | null;
  gsm: number | null;
  lengthM: number;
  weightKg: number | null;
  warehouse: string | null;
  createdAt: string;
};

export function buildRollQrPayload(input: RollQrPayloadInput): string {
  // Compact format required by business:
  // barcode|materialName|materialCode|colorName|colorCode|length|weight
  const compact = (value: unknown): string =>
    String(value ?? '')
      .replace(/[|\r\n\t]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const scannerSafeColor = (color: unknown, fallback: unknown): string => {
    const value = compact(color);
    if (!value) return compact(fallback);
    return /^[\x20-\x7E]+$/.test(value) ? value : compact(fallback) || value;
  };
  const arr = [
    compact(input.barcode),
    compact(input.fabricName),
    compact(input.articleCode),
    scannerSafeColor(input.fabricColor, input.colorCode),
    compact(input.colorCode),
    compact(input.lengthM),
    compact(input.weightKg),
  ];
  return arr.join('|');
}
