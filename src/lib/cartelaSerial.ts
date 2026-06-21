/** باركود كارتيلa تلقائي: 4 أرقام (0001…) */
export const CARTELA_SERIAL_AUTO_DIGITS = 4;

/** باركود كارتيلa يدوي: حتى 10 أرقام */
export const CARTELA_SERIAL_MANUAL_MAX_LEN = 10;

export function validateManualCartelaSerial(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) {
    return 'باركود الكارتيلa يجب أن يكون أرقاماً فقط';
  }
  if (trimmed.length > CARTELA_SERIAL_MANUAL_MAX_LEN) {
    return `الباركود اليدوي بحد أقصى ${CARTELA_SERIAL_MANUAL_MAX_LEN} أرقام — التلقائي 4 أرقام`;
  }
  return null;
}

/** يقبل أرقاماً فقط ويحدّ الطول عند الكتابة */
export function sanitizeManualCartelaSerialInput(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, CARTELA_SERIAL_MANUAL_MAX_LEN);
}
