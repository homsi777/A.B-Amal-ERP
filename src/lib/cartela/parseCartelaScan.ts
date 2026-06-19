/** يحلّل مسح باركود/QR الكارتيلا — CLOTEX|ART|DESIGN|SERIAL أو رقم تسلسلي. */
export function parseCartelaScanInput(raw: string): {
  serial?: string;
  artCode?: string;
  designNo?: string;
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

  const digits = q.match(/^\d{4,10}$/);
  if (digits) return { serial: digits[0] };

  return { serial: q };
}
