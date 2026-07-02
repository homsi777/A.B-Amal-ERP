/** ملاحظات نظامية لا تُعرض في PDF/طباعة الذمم والكشوف */
const HIDDEN_EXPORT_NOTE_PATTERNS = [
  /أضيف\s+تلقائ/i,
  /تمت?\s+الإضافة\s+تلقائ/i,
  /استيراد\s+كشف\s+حساب/i,
  /من\s+استيراد\s+/i,
];

/** يُخفى نص الاستيراد التلقائي ويُستبدل بـ — */
export function sanitizePartyNotesForExport(value?: string | null): string {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return '—';
  if (HIDDEN_EXPORT_NOTE_PATTERNS.some((pattern) => pattern.test(trimmed))) return '—';
  return trimmed;
}

/** رؤوس جداول الذمم — خلفية فاتحة لتجنب تعارض html2canvas مع النص الأبيض */
export const DUES_REPORT_TABLE_HEAD_CSS = `
  thead th {
    background: #e2e8f0 !important;
    color: #0f172a !important;
    font-size: 14px;
    font-weight: 700;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
`;
