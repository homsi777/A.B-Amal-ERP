import { BRAND } from '../../branding';

const FONT = "Tahoma, Arial, 'Segoe UI', 'Arabic Typesetting', sans-serif";
const NAVY = '#2C405A';

export type SignatureSheetLine = {
  employeeCode: string;
  fullName: string;
  netSalary: number;
};

export type SignatureSheetData = {
  payrollNo: string;
  periodMonth: number;
  periodYear: number;
  department?: string | null;
  currencyCode: string;
  lines: SignatureSheetLine[];
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

export function renderPayrollSignatureSheetA4Html(data: SignatureSheetData): string {
  const totalNet = data.lines.reduce((sum, l) => sum + l.netSalary, 0);
  const rows = data.lines
    .map(
      (l, i) => `
      <tr>
        <td class="c">${i + 1}</td>
        <td class="code">${esc(l.employeeCode)}</td>
        <td class="name">${esc(l.fullName)}</td>
        <td class="amt">${money(l.netSalary)}</td>
        <td class="sign"></td>
      </tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8" />
<title>كشف قبض رواتب - ${esc(data.payrollNo)}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  @page { size: A4 portrait; margin: 10mm; }
  body { font-family: ${FONT}; color:#111; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .header { display:flex; justify-content:space-between; align-items:center; border-bottom: 3px solid ${NAVY}; padding-bottom:8px; margin-bottom:10px; }
  .logo { height:42px; }
  .title { text-align:center; font-size:18px; font-weight:900; color:${NAVY}; }
  .subtitle { text-align:center; font-size:11px; color:#64748b; margin-top:2px; }
  table.grid { width:100%; border-collapse:collapse; font-size:10.5px; }
  table.grid th { background:${NAVY}; color:#fff; padding:6px 4px; font-weight:800; }
  table.grid td { border:1px solid #e2e8f0; padding:5px 4px; }
  .c { text-align:center; width:4%; }
  .code { width:12%; font-family:monospace; }
  .name { width:34%; font-weight:700; }
  .amt { width:16%; text-align:left; direction:ltr; font-weight:800; }
  .sign { width:34%; }
  tfoot td { font-weight:900; background:#f8fafc; }
  tr { break-inside: avoid; }
</style>
</head>
<body>
  <div class="header">
    <img src="${BRAND.logoInline}" alt="${esc(BRAND.name)}" class="logo" />
    <div>
      <div class="title">كشف قبض رواتب للتوقيع</div>
      <div class="subtitle">${monthName(data.periodMonth)} ${data.periodYear}${data.department ? ` — ${esc(data.department)}` : ''} — ${esc(data.payrollNo)}</div>
    </div>
  </div>
  <table class="grid">
    <thead>
      <tr>
        <th class="c">#</th>
        <th class="code">رمز الموظف</th>
        <th class="name">الاسم</th>
        <th class="amt">الصافي (${esc(data.currencyCode)})</th>
        <th class="sign">التوقيع</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
    <tfoot>
      <tr>
        <td colspan="3" style="text-align:${'right'};padding:8px;">الإجمالي</td>
        <td class="amt">${money(totalNet)}</td>
        <td></td>
      </tr>
    </tfoot>
  </table>
</body>
</html>`;
}
