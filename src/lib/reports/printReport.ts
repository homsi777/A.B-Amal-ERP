import type { UnifiedReportPayload } from './types';
function arTotalLabel(label: string): string {
  const map: Record<string, string> = {
    total_materials: 'مجموع الخامات',
    total_rolls: 'مجموع الاتواب',
    total_length_m: 'مجموع اطوال',
    total_remaining_length_m: 'مجموع المتبقي',
    total_sold_length_m: 'مجموع المباع',
    total_weight_kg: 'مجموع اوزان',
    sold_meters: 'إجمالي الأمتار المباعة',
    remaining_receivable_meters: 'أمتار ضمن الذمم',
  };
  return map[label] || label;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function chunkInventoryRowsByGroup(rows: Record<string, unknown>[], maxRowsPerPage: number): Record<string, unknown>[][] {
  const groups: Record<string, unknown>[][] = [];
  let currentGroup: Record<string, unknown>[] = [];

  for (const row of rows) {
    currentGroup.push(row);
    if (row.__is_group_summary) {
      groups.push(currentGroup);
      currentGroup = [];
    }
  }
  if (currentGroup.length) groups.push(currentGroup);

  const pages: Record<string, unknown>[][] = [];
  let currentPage: Record<string, unknown>[] = [];

  for (const group of groups) {
    const wouldOverflow = currentPage.length > 0 && currentPage.length + group.length > maxRowsPerPage;
    if (wouldOverflow) {
      pages.push(currentPage);
      currentPage = [];
    }
    currentPage.push(...group);
  }

  if (currentPage.length) pages.push(currentPage);
  return pages.length ? pages : [[]];
}

export function buildPrintableHtml(report: UnifiedReportPayload): string {
  const isInventoryRolls = report.key === 'inventory_rolls';
  const filterLine = Object.entries(report.filtersApplied || {})
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(' | ');

  const headerCells = report.columns.map((c) => `<th>${esc(c.label)}</th>`).join('');
  const bodyRows = report.rows
    .map((row) => {
      const isGroupSummary = row.__is_group_summary;
      const tds = report.columns
        .map((col) => {
          const v = row[col.key];
          const s = v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v);
          return `<td>${esc(s)}</td>`;
        })
        .join('');
      return `<tr${isGroupSummary ? ' class="group-summary"' : ''}>${tds}</tr>`;
    })
    .join('');

  const cardsFromSummary = (report.summaryCards || []).map(
    (c) => `<div class="card"><strong>${esc(c.label)}</strong><span>${esc(String(c.value))}</span></div>`,
  );
  const cardsFromTotals = Object.entries(report.totals || {}).map(
    ([k, v]) =>
      `<div class="card card-total"><strong>${esc(arTotalLabel(k))}</strong><span>${esc(String(v))}</span></div>`,
  );
  const allCards = [...cardsFromSummary, ...cardsFromTotals];
  const cards = allCards.length ? `<div class="cards">${allCards.join('')}</div>` : '';

  const subtitleBlock = report.subtitle
    ? `<div class="note note-sub">${esc(report.subtitle)}</div>`
    : '';
  const metaNote = report.meta?.note;
  const metaNoteBlock = metaNote
    ? `<div class="note note-meta">${esc(metaNote)}</div>`
    : '';

  const emptyRow = `<tr><td colspan="${report.columns.length}">لا توجد بيانات</td></tr>`;
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <title>${esc(report.title)}</title>
  <style>
    @page { size: A4; margin: ${isInventoryRolls ? '5mm' : '12mm'}; }
    body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; font-size: ${isInventoryRolls ? '9.4pt' : '10pt'}; color: #0f172a; }
    h1 { font-size: 16pt; margin: 0 0 4px; }
    .sub { color: #64748b; font-size: 9pt; margin-bottom: 12px; }
    .meta { font-size: 9pt; margin-bottom: 8px; }
    table.data { width: 100%; border-collapse: collapse; margin-top: 8px; }
    table.data th, table.data td { border: 1px solid #cbd5e1; padding: ${isInventoryRolls ? '3.4px 2.6px' : '4px 6px'}; text-align: right; line-height: ${isInventoryRolls ? '1.28' : 'normal'}; }
    table.data th { background: #0f172a; color: #fff; }
    table.data tr:nth-child(even) { background: #f8fafc; }
    table.data tr.group-summary { background: #eef2ff; font-weight: bold; }
    .footer { margin-top: 16px; font-size: 8pt; color: #94a3b8; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 6px; }
    .cards { display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0; }
    .card { min-width: 132px; max-width: 190px; border: 1px solid #e2e8f0; background: #f8fafc; padding: 6px 10px; border-radius: 8px; display: flex; flex-direction: column; gap: 2px; }
    .card strong { font-size: 8.8pt; color: #334155; font-weight: 700; }
    .card span { font-size: 11pt; color: #0f172a; font-weight: 700; line-height: 1.15; }
    .card-total { border-color: #c7d2fe; background: #eef2ff; }
    .note { font-size: 9pt; padding: 8px 10px; border-radius: 6px; margin: 8px 0; text-align: right; }
    .note-sub { background: #eef2ff; border: 1px solid #c7d2fe; color: #3730a3; }
    .note-meta { background: #fffbeb; border: 1px solid #fde68a; color: #92400e; }
    body.inventory h1 { font-size: 10.5pt; margin-bottom: 2px; }
    body.inventory .sub, body.inventory .meta, body.inventory .note { font-size: 7.2pt; margin-bottom: 3px; padding: 4px 6px; }
    body.inventory .cards { gap: 4px; margin: 4px 0; }
    body.inventory .card { min-width: 88px; max-width: 120px; padding: 3px 5px; border-radius: 5px; }
    body.inventory .card strong { font-size: 6.8pt; }
    body.inventory .card span { font-size: 8pt; }
    body.inventory table.data { margin-top: 4px; }
    body.inventory .footer { margin-top: 5px; padding-top: 3px; font-size: 6.5pt; }
  </style>
</head>
<body${isInventoryRolls ? ' class="inventory"' : ''}>
  <h1>CLOTEX — ${esc(report.title)}</h1>
  <div class="sub">نظام إدارة مستودعات الأقمشة</div>
  <div class="meta">تاريخ التوليد: ${esc(new Date(report.generatedAt).toLocaleDateString('ar-SY'))}</div>
  <div class="meta">الفلاتر: ${esc(filterLine || '—')}</div>
  ${subtitleBlock}
  ${metaNoteBlock}
  ${cards}
  <table class="data">
    <thead><tr>${headerCells}</tr></thead>
    <tbody>${bodyRows || emptyRow}</tbody>
  </table>
  <div class="footer">مُنشأ بواسطة CLOTEX ERP — طباعة / حفظ PDF من المتصفح</div>
</body>
</html>`;
}

export function printReport(report: UnifiedReportPayload): boolean {
  const html = buildPrintableHtml(report);
  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) {
    return false;
  }
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => {
    w.print();
  }, 250);
  return true;
}

export async function exportReportPdf(report: UnifiedReportPayload, fileName: string): Promise<void> {
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.left = '-10000px';
  iframe.style.top = '0';
  iframe.style.width = '1200px';
  iframe.style.height = '1800px';
  iframe.style.opacity = '1';
  iframe.style.pointerEvents = 'none';
  document.body.appendChild(iframe);

  try {
    const html2canvas = (await import('html2canvas')).default;
    const { jsPDF } = await import('jspdf');

    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = 210;
    const pageH = 297;
    const margin = 8;
    const innerW = pageW - margin * 2;
    const innerH = pageH - margin * 2;
    const rowsPerChunk = report.key === 'inventory_rolls'
      ? 52
      : /inventory/i.test(report.key ?? '')
        ? 52
      : 45;
    const rowChunks = report.key === 'inventory_rolls'
      ? chunkInventoryRowsByGroup(report.rows, rowsPerChunk)
      : report.rows.length
        ? Array.from({ length: Math.ceil(report.rows.length / rowsPerChunk) }, (_, i) =>
          report.rows.slice(i * rowsPerChunk, (i + 1) * rowsPerChunk),
        )
        : [[]];

    let pageIdx = 0;
    for (const chunk of rowChunks) {
      const chunkReport: UnifiedReportPayload = {
        ...report,
        rows: chunk,
        subtitle: pageIdx === 0 ? report.subtitle : undefined,
        summaryCards: pageIdx === 0 ? report.summaryCards : undefined,
        totals: pageIdx === 0 ? report.totals : undefined,
        meta: pageIdx === 0
          ? report.meta
          : {
            ...report.meta,
            note: `تابع التقرير - صفحة ${pageIdx + 1}`,
          },
      };
      const html = buildPrintableHtml(chunkReport);
      await new Promise<void>((resolve, reject) => {
        iframe.onload = () => resolve();
        iframe.onerror = () => reject(new Error('تعذر تحميل تقرير PDF'));
        iframe.srcdoc = html;
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 80));

      const doc = iframe.contentDocument;
      const body = doc?.body;
      if (!doc || !body) {
        throw new Error('تعذر قراءة التقرير للتصدير');
      }

      const canvas = await html2canvas(body, {
        scale: 1.35,
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false,
        windowWidth: Math.max(doc.documentElement.scrollWidth, 1200),
        windowHeight: Math.max(doc.documentElement.scrollHeight, 1400),
      });
      if (canvas.width <= 0 || canvas.height <= 0) {
        throw new Error('فشل تجهيز الصفحة للتصدير');
      }

      const img = canvas.toDataURL('image/jpeg', 0.86);
      const imgHeightMm = Math.min(innerH, innerW * (canvas.height / canvas.width));
      if (pageIdx > 0) pdf.addPage('a4', 'portrait');
      pdf.addImage(img, 'JPEG', margin, margin, innerW, imgHeightMm, undefined, 'FAST');
      pageIdx += 1;
    }

    pdf.save(fileName);
  } finally {
    iframe.remove();
  }
}
