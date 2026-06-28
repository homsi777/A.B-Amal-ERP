/** يحلّل مسح باركود/QR الكارتيلا — CLOTEX|ART|DESIGN|SERIAL أو رقم تسلسلي أو باركود لون SERIAL-C01. */
export function parseCartelaScanInput(raw: string): {
  serial?: string;
  artCode?: string;
  designNo?: string;
  colorBarcode?: string;
} {
  const q = raw.trim();
  if (!q) return {};

  if (/^CLOTEX\|/i.test(q)) {
    const parts = q.split('|').map((p) => p.trim());
    return {
      artCode: parts[1] || undefined,
      designNo: parts[2] || undefined,
      serial: parts[3] || undefined,
    };
  }

  if (/^[A-Z0-9][A-Z0-9-]{2,47}$/i.test(q) && q.includes('-')) {
    return { colorBarcode: q.toUpperCase() };
  }

  const digits = q.match(/^\d{4,10}$/);
  if (digits) return { serial: digits[0] };

  return { serial: q, colorBarcode: q.includes('-') ? q.toUpperCase() : undefined };
}
