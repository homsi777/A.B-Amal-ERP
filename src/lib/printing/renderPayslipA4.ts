import { BRAND } from '../../branding';

const FONT = "Tahoma, Arial, 'Segoe UI', 'Arabic Typesetting', sans-serif";
const NAVY = '#2C405A';
const GOLD = '#C4A962';

export type PayslipData = {
  payrollNo: string;
  periodMonth: number;
  periodYear: number;
  employeeCode: string;
  fullName: string;
  jobTitle?: string | null;
  department?: string | null;
  factory?: string | null;
  baseSalary: number;
  allowances: number;
  deductions: number;
  netSalary: number;
  currencyCode: string;
  /** عناوين عربية → قيم — من excel_detail، يُعرَض كما هو بلا تعديل. */
  detail?: Record<string, unknown> | null;
};

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function money(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function monthName(m: number): string {
  const names = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  return names[m - 1] || String(m);
}

function detailRows(detail: Record<string, unknown> | null | undefined): string {
  if (!detail) return '';
  const entries = Object.entries(detail).filter(([, v]) => v !== '' && v !== null && v !== undefined && Number(v) !== 0);
  if (!entries.length) return '';
  return entries
    .map(([label, value]) => `<tr><td class="det-label">${esc(label)}</td><td class="det-value">${esc(value)}</td></tr>`)
    .join('');
}

export function renderPayslipA4Html(data: PayslipData): string {
  const detailHtml = detailRows(data.detail);
  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8" />
<title>كشف راتب - ${esc(data.fullName)}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  @page { size: A4 portrait; margin: 10mm; }
  body { font-family: ${FONT}; color:#111; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .header { display:flex; justify-content:space-between; align-items:center; border-bottom: 3px solid ${NAVY}; padding-bottom:8px; margin-bottom:12px; }
  .logo { height:48px; }
  .title { text-align:center; font-size:22px; font-weight:900; color:${NAVY}; }
  .subtitle { text-align:center; font-size:12px; color:#64748b; margin-top:2px; }
  .info-table { width:100%; border-collapse:collapse; margin-bottom:14px; }
  .info-table td { padding:6px 10px; border:1px solid #e2e8f0; font-size:11px; }
  .info-label { background:#f8fafc; font-weight:800; color:#475569; width:18%; }
  .amount-table { width:100%; border-collapse:collapse; margin-bottom:14px; }
  .amount-table th { background:${NAVY}; color:#fff; padding:8px 10px; font-size:11px; font-weight:800; }
  .amount-table td { padding:7px 10px; border:1px solid #e2e8f0; font-size:12px; }
  .amount-table .lbl { font-weight:700; color:#334155; }
  .amount-table .val { text-align:left; font-weight:800; direction:ltr; }
  .net-row td { background:${GOLD}22; font-weight:900; font-size:14px; color:${NAVY}; }
  .detail-table { width:100%; border-collapse:collapse; margin-bottom:14px; font-size:10px; }
  .detail-table th { background:#f1f5f9; padding:6px 8px; text-align:${'right'}; font-weight:800; color:#475569; }
  .det-label { padding:4px 8px; border-bottom:1px solid #f1f5f9; color:#64748b; }
  .det-value { padding:4px 8px; border-bottom:1px solid #f1f5f9; text-align:left; direction:ltr; font-weight:700; }
  .sign-table { width:100%; border-collapse:separate; border-spacing:10px 0; margin-top:20px; }
  .sign-table td { width:50%; border:1px solid #cbd5e1; border-radius:8px; padding:10px; font-size:11px; }
  .sign-line { margin-top:20px; border-bottom:1px solid #94a3b8; }
</style>
</head>
<body>
  <div class="header">
    <img src="${BRAND.logoInline}" alt="${esc(BRAND.name)}" class="logo" />
    <div>
      <div class="title">كشف راتب</div>
      <div class="subtitle">${monthName(data.periodMonth)} ${data.periodYear} — ${esc(data.payrollNo)}</div>
    </div>
  </div>

  <table class="info-table">
    <tr>
      <td class="info-label">رمز الموظف</td><td>${esc(data.employeeCode)}</td>
      <td class="info-label">الاسم</td><td>${esc(data.fullName)}</td>
    </tr>
    <tr>
      <td class="info-label">المصنع</td><td>${esc(data.factory) || '—'}</td>
      <td class="info-label">القسم</td><td>${esc(data.department) || '—'}</td>
    </tr>
    <tr>
      <td class="info-label">الوظيفة</td><td>${esc(data.jobTitle) || '—'}</td>
      <td class="info-label">العملة</td><td>${esc(data.currencyCode)}</td>
    </tr>
  </table>

  <table class="amount-table">
    <tr><th colspan="2">ملخص الراتب</th></tr>
    <tr><td class="lbl">الأجر الأساسي</td><td class="val">${money(data.baseSalary)}</td></tr>
    <tr><td class="lbl">الاستحقاقات الإضافية</td><td class="val">${money(data.allowances)}</td></tr>
    <tr><td class="lbl">إجمالي المستقطع</td><td class="val">-${money(data.deductions)}</td></tr>
    <tr class="net-row"><td class="lbl">الصافي النهائي</td><td class="val">${money(data.netSalary)} ${esc(data.currencyCode)}</td></tr>
  </table>

  ${detailHtml ? `<table class="detail-table"><tr><th colspan="2">تفاصيل الكشف الأصلي</th></tr>${detailHtml}</table>` : ''}

  <table class="sign-table">
    <tr>
      <td>توقيع المحاسب<div class="sign-line">&nbsp;</div></td>
      <td>توقيع الموظف (استلام)<div class="sign-line">&nbsp;</div></td>
    </tr>
  </table>
</body>
</html>`;
}
