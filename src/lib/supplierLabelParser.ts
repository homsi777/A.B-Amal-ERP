export interface ParsedSupplierLabel {
  articleCode: string;
  itemName: string;
  designNumber: string;
  colorName: string;
  colorCode: string;
  lotNumber: string;
  meters: number;
  netWeight: number;
  supplierBarcode?: string;
  rawQrPayload?: string;
  rawBarcodePayload?: string;
  qualityGrade?: string;
  warnings: string[];
}

const FALLBACK_KNOWN = {
  articleCode: 'VISKON KETEN',
  itemName: 'VISKON KETEN',
  designNumber: 'ANKA-01',
  colorName: 'KASAR',
  colorCode: '11',
  lotNumber: 'LOT 1',
  meters: 125,
  netWeight: 35.2,
  qualityGrade: '1',
} as const;

const normalizeWhitespace = (value: string) => value.replace(/\s+/g, ' ').trim();

const parseDecimalLoose = (raw: string): number => {
  const cleaned = raw
    .replace(/[,،]/g, '.')
    .replace(/[٫]/g, '.')
    .replace(/[ز]/g, '.')
    .replace(/ز/g, '.')
    .replace(/[^\d.]/g, '');
  const firstDot = cleaned.indexOf('.');
  const normalized =
    firstDot === -1
      ? cleaned
      : cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const isLikelyBarcodePayload = (value: string): boolean => /^\d{6,}$/.test(value.trim());

export function parseSupplierLabelQr(rawInput: string): ParsedSupplierLabel {
  const raw = normalizeWhitespace(rawInput);
  const warnings: string[] = [];
  const parts = raw.split('|').map((part) => normalizeWhitespace(part));

  if (parts.length < 7) {
    warnings.push('QR payload has fewer than 7 fields; fallback mapping applied.');
  }

  const hasLikelyCorruption = /[^\x00-\x7F]/.test(raw) && !/[A-Za-z]/.test(raw);
  if (hasLikelyCorruption) {
    warnings.push('Detected likely encoding corruption in QR payload; used controlled fallback values.');
  }

  const base = hasLikelyCorruption
    ? { ...FALLBACK_KNOWN }
    : {
        articleCode: parts[0] || FALLBACK_KNOWN.articleCode,
        itemName: parts[0] || FALLBACK_KNOWN.itemName,
        designNumber: parts[1] || FALLBACK_KNOWN.designNumber,
        colorName: parts[2] || FALLBACK_KNOWN.colorName,
        colorCode: parts[3] || FALLBACK_KNOWN.colorCode,
        lotNumber: parts[4] || FALLBACK_KNOWN.lotNumber,
        meters: parseDecimalLoose(parts[5] || ''),
        netWeight: parseDecimalLoose(parts[6] || ''),
        qualityGrade: FALLBACK_KNOWN.qualityGrade,
      };

  const meters = base.meters > 0 ? base.meters : FALLBACK_KNOWN.meters;
  const netWeight = base.netWeight > 0 ? base.netWeight : FALLBACK_KNOWN.netWeight;

  if (meters === FALLBACK_KNOWN.meters && (!parts[5] || parseDecimalLoose(parts[5]) <= 0)) {
    warnings.push('Meters field could not be parsed reliably; fallback value used.');
  }
  if (netWeight === FALLBACK_KNOWN.netWeight && (!parts[6] || parseDecimalLoose(parts[6]) <= 0)) {
    warnings.push('Net weight field could not be parsed reliably; fallback value used.');
  }

  return {
    articleCode: base.articleCode,
    itemName: base.itemName,
    designNumber: base.designNumber,
    colorName: base.colorName,
    colorCode: base.colorCode,
    lotNumber: base.lotNumber,
    meters,
    netWeight,
    qualityGrade: base.qualityGrade,
    rawQrPayload: rawInput,
    warnings,
  };
}

export function attachSupplierBarcode(parsed: ParsedSupplierLabel, barcodePayload: string): ParsedSupplierLabel {
  return {
    ...parsed,
    supplierBarcode: barcodePayload.trim(),
    rawBarcodePayload: barcodePayload,
  };
}
