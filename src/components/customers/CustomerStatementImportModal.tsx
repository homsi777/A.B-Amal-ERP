import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, Upload, X } from 'lucide-react';
import * as XLSX from 'xlsx';
import { importCustomerStatement } from '../../lib/api/customersApi';
import { listCashboxes, type CashboxDto } from '../../lib/api/cashboxesApi';
import { parseCustomerStatementImportDate, type CustomerStatementDateParseSource } from '../../lib/customerStatementImportDateParser';

type ImportedSaleLine = {
  date: string;
  originalDateValue: string;
  dateParseSource: CustomerStatementDateParseSource;
  materialName: string;
  quantity: number;
  rolls: number;
  city: string;
  unitPrice: number;
  total: number;
  note: string;
};

type ImportedPayment = {
  date: string;
  originalDateValue: string;
  dateParseSource: CustomerStatementDateParseSource;
  amount: number;
  kind: 'payment' | 'return';
  rawLabel: string;
};

type ImportAnalysis = {
  fileName: string;
  customerName: string;
  orderDate: string;
  currencyCode: string;
  saleLines: ImportedSaleLine[];
  payments: ImportedPayment[];
  returnPayments: ImportedPayment[];
  sheetSalesTotal: number;
  sheetMetersTotal: number;
  sheetRollsTotal: number;
  computedRollsTotal: number;
  sheetBalance: number | null;
  computedSalesTotal: number;
  paymentsTotal: number;
  returnsTotal: number;
  computedBalance: number;
  balanceDifference: number;
  warnings: string[];
  blockingErrors: string[];
};

interface Props {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}

function normalizeName(value: string) {
  return value
    .replace(/^السيد\/ة\s*:\s*/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseMoney(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const text = String(value ?? '').replace(/[$,\s]/g, '').trim();
  const n = Number(text);
  return Number.isFinite(n) ? n : 0;
}

function round2(value: number) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function findFirstString(rows: unknown[][], predicate: (text: string) => boolean) {
  for (const row of rows) {
    for (const cell of row) {
      const text = String(cell ?? '').trim();
      if (text && predicate(text)) return text;
    }
  }
  return '';
}

function analyzeWorkbook(fileName: string, workbook: XLSX.WorkBook): ImportAnalysis {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, raw: true });
  const warnings: string[] = [];
  const blockingErrors: string[] = [];

  const customerName = normalizeName(findFirstString(rows, (text) => text.includes('السيد/ة')));
  const orderDateRaw = rows[8]?.[7] ?? findFirstString(rows, (text) => /^\d{1,2}[\\/.-]\d{1,2}[\\/.-]\d{4}$/.test(text));
  const orderDateParsed = parseCustomerStatementImportDate(orderDateRaw);
  const orderDate = orderDateParsed.ok ? orderDateParsed.date : '';
  if (orderDateParsed.ok && orderDateParsed.warning) warnings.push(orderDateParsed.warning);
  if (!orderDateParsed.ok) {
    blockingErrors.push(`تعذر قراءة تاريخ الكشف من ملف Excel: ${orderDateParsed.originalValue || 'فارغ'}`);
  }

  const saleLines: ImportedSaleLine[] = [];
  for (const [rowIndex, row] of rows.entries()) {
    const date = row?.[0];
    const materialName = String(row?.[1] ?? '').trim();
    const quantity = Number(row?.[2]);
    const rolls = Number(row?.[5]);
    const city = String(row?.[6] ?? '').trim();
    const unitPrice = parseMoney(row?.[7]);
    const total = parseMoney(row?.[8]);
    const note = String(row?.[10] ?? '').trim();
    if (!date || !materialName || !Number.isFinite(quantity) || quantity <= 0 || total <= 0) continue;
    const parsedDate = parseCustomerStatementImportDate(date);
    if (!parsedDate.ok) {
      blockingErrors.push(`تعذر قراءة تاريخ بند مبيعات في السطر ${rowIndex + 1}: ${parsedDate.originalValue || 'فارغ'}`);
      continue;
    }
    if (parsedDate.warning) warnings.push(`سطر ${rowIndex + 1}: ${parsedDate.warning}`);
    saleLines.push({
      date: parsedDate.date,
      originalDateValue: parsedDate.originalValue,
      dateParseSource: parsedDate.source,
      materialName,
      quantity,
      rolls: Number.isFinite(rolls) ? rolls : 0,
      city,
      unitPrice,
      total: round2(total),
      note,
    });
  }

  const payments: ImportedPayment[] = [];
  for (const [rowIndex, row] of rows.entries()) {
    const dateCell = row?.[2];
    const dateLabel = String(dateCell ?? '').trim();
    const amount = parseMoney(row?.[4]);
    const hasDateCandidate = dateCell instanceof Date || typeof dateCell === 'number' || /\d/.test(dateLabel) || dateLabel.includes('مرتجع');
    if (!hasDateCandidate || amount <= 0) continue;
    const parsedDate = parseCustomerStatementImportDate(dateCell);
    if (!parsedDate.ok) {
      blockingErrors.push(`تاريخ الدفعة غير مفهوم في السطر ${rowIndex + 1}: ${parsedDate.originalValue || 'فارغ'}`);
      continue;
    }
    if (parsedDate.warning) warnings.push(`سطر ${rowIndex + 1}: ${parsedDate.warning}`);
    payments.push({
      date: parsedDate.date,
      originalDateValue: parsedDate.originalValue,
      dateParseSource: parsedDate.source,
      amount: round2(amount),
      kind: dateLabel.includes('مرتجع') ? 'return' : 'payment',
      rawLabel: dateLabel,
    });
  }

  const numericAt = (r: number, c: number) => parseMoney(rows[r - 1]?.[c - 1]);
  const sheetSalesTotal = numericAt(37, 9) || numericAt(43, 5);
  const sheetMetersTotal = numericAt(37, 3);
  const sheetRollsTotal = numericAt(37, 6);
  const sheetBalance = numericAt(65, 5) || numericAt(66, 5) || null;
  const computedSalesTotal = round2(saleLines.reduce((sum, line) => sum + line.total, 0));
  const computedRollsTotal = round2(saleLines.reduce((sum, line) => sum + line.rolls, 0));
  const paymentsTotal = round2(payments.filter((row) => row.kind === 'payment').reduce((sum, row) => sum + row.amount, 0));
  const returnsTotal = round2(payments.filter((row) => row.kind === 'return').reduce((sum, row) => sum + row.amount, 0));
  const computedBalance = round2(computedSalesTotal - paymentsTotal - returnsTotal);
  const balanceDifference = sheetBalance == null ? 0 : round2(sheetBalance - computedBalance);

  if (!customerName) warnings.push('لم يتم العثور على اسم العميل بوضوح.');
  if (!saleLines.length) warnings.push('لم يتم العثور على بنود مبيعات قابلة للاستيراد.');
  if (sheetSalesTotal && Math.abs(round2(sheetSalesTotal - computedSalesTotal)) > 1) {
    warnings.push('إجمالي المبيعات المحسوب لا يطابق إجمالي الملف.');
  }
  if (sheetRollsTotal && Math.abs(round2(sheetRollsTotal - computedRollsTotal)) > 0.01) {
    warnings.push('مجموع الأتواب المحسوب من البنود لا يطابق مجموع الأتواب في الملف.');
  }
  if (sheetBalance != null && Math.abs(balanceDifference) > 0.05) {
    warnings.push('يوجد فرق رصيد بين الملف والحساب المحسوب وسيظهر كتسوية منفصلة عند الاعتماد.');
  }

  return {
    fileName,
    customerName,
    orderDate,
    currencyCode: 'USD',
    saleLines,
    payments: payments.filter((row) => row.kind === 'payment'),
    returnPayments: payments.filter((row) => row.kind === 'return'),
    sheetSalesTotal: round2(sheetSalesTotal || computedSalesTotal),
    sheetMetersTotal: round2(sheetMetersTotal || saleLines.reduce((sum, line) => sum + line.quantity, 0)),
    sheetRollsTotal: round2(sheetRollsTotal || computedRollsTotal),
    computedRollsTotal,
    sheetBalance,
    computedSalesTotal,
    paymentsTotal,
    returnsTotal,
    computedBalance,
    balanceDifference,
    warnings,
    blockingErrors,
  };
}

export const CustomerStatementImportModal: React.FC<Props> = ({ open, onClose, onImported }) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [analysis, setAnalysis] = useState<ImportAnalysis | null>(null);
  const [cashboxes, setCashboxes] = useState<CashboxDto[]>([]);
  const [cashboxId, setCashboxId] = useState('');
  const [loadingFile, setLoadingFile] = useState(false);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setMessage(null);
    setError(null);
    void (async () => {
      try {
        const res = await listCashboxes({ active: true });
        setCashboxes(res.data);
        const preferred = res.data.find((box) => box.is_default) ?? res.data[0];
        setCashboxId(preferred?.id ?? '');
      } catch {
        setCashboxes([]);
        setCashboxId('');
      }
    })();
  }, [open]);

  const matchingCashbox = cashboxes.find((box) => box.id === cashboxId);

  if (!open) return null;

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setLoadingFile(true);
    setMessage(null);
    setError(null);
    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { cellDates: false, cellNF: true, cellStyles: true });
      setAnalysis(analyzeWorkbook(file.name, workbook));
    } catch (err) {
      setAnalysis(null);
      setError(err instanceof Error ? err.message : 'تعذر تحليل ملف Excel');
    } finally {
      setLoadingFile(false);
    }
  };

  const handleConfirmImport = async () => {
    if (!analysis) return;
    if (!analysis.customerName || !analysis.saleLines.length) {
      setError('لا يمكن الاعتماد قبل وجود اسم عميل وبنود مبيعات.');
      return;
    }
    if (analysis.blockingErrors.length > 0) {
      setError('لا يمكن تأكيد الاستيراد قبل تصحيح تواريخ ملف Excel غير المفهومة.');
      return;
    }
    if (!cashboxId && analysis.payments.length > 0) {
      setError('اختر صندوقاً مالياً لتأكيد سندات القبض.');
      return;
    }

    setImporting(true);
    setError(null);
    setMessage(null);
    try {
      const result = await importCustomerStatement({
        fileName: analysis.fileName,
        customerName: analysis.customerName,
        orderDate: analysis.orderDate,
        currencyCode: analysis.currencyCode,
        cashboxId,
        saleLines: analysis.saleLines,
        payments: analysis.payments,
        returnPayments: analysis.returnPayments,
        sheetBalance: analysis.sheetBalance,
        computedSalesTotal: analysis.computedSalesTotal,
        paymentsTotal: analysis.paymentsTotal,
        returnsTotal: analysis.returnsTotal,
        computedBalance: analysis.computedBalance,
        balanceDifference: analysis.balanceDifference,
      });

      const details = [
        result.data.createdInvoice ? `فاتورة مالية ${result.data.invoiceNo}` : `تم تجاوز فاتورة موجودة ${result.data.invoiceNo}`,
        `${result.data.createdReceipts} سند قبض`,
        `${result.data.createdCredits} قيد مرتجع/حسم`,
        result.data.createdAdjustment ? 'مع تسوية فرق الرصيد' : null,
      ].filter(Boolean);
      setMessage(`تم استيراد الكشف وربطه بالعميل: ${result.data.customer.name}. ${details.join('، ')}`);
      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل استيراد كشف العميل');
    } finally {
      setImporting(false);
    }
  };

  const money = (value: number | null | undefined) =>
    value == null ? '—' : `${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`;

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-slate-950/55 p-4">
      <div className="max-h-[92vh] w-full max-w-5xl overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h3 className="text-lg font-black text-slate-900">استيراد كشف عميل Excel</h3>
            <p className="mt-1 text-xs text-slate-500">تحليل أولاً، ثم اعتماد الاستيراد بعد المراجعة</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[calc(92vh-76px)] overflow-y-auto p-5">
          <div className="flex flex-wrap items-center gap-3">
            <input ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(event) => void handleFileChange(event)} />
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={loadingFile || importing}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 font-bold text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {loadingFile ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              اختيار ملف كشف
            </button>
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <FileSpreadsheet className="h-4 w-4" />
              <span>{analysis?.fileName ?? 'لم يتم اختيار ملف بعد'}</span>
            </div>
          </div>

          {error && <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
          {message && <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">{message}</div>}

          {analysis && (
            <div className="mt-5 space-y-5">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <SummaryCard label="العميل" value={analysis.customerName || '—'} />
                <SummaryCard label="تاريخ الكشف" value={analysis.orderDate || 'غير مفهوم'} tone={analysis.orderDate ? 'normal' : 'warn'} />
                <SummaryCard label="إجمالي المبيعات" value={money(analysis.computedSalesTotal)} />
                <SummaryCard label="رصيد الملف" value={money(analysis.sheetBalance)} />
                <SummaryCard label="أتواب الملف" value={analysis.sheetRollsTotal.toLocaleString()} />
                <SummaryCard label="أتواب البنود" value={analysis.computedRollsTotal.toLocaleString()} tone={Math.abs(analysis.sheetRollsTotal - analysis.computedRollsTotal) > 0.01 ? 'warn' : 'normal'} />
                <SummaryCard label="الدفعات" value={money(analysis.paymentsTotal)} />
                <SummaryCard label="المرتجعات" value={money(analysis.returnsTotal)} />
                <SummaryCard label="الرصيد المحسوب" value={money(analysis.computedBalance)} />
                <SummaryCard label="فرق الرصيد" value={money(analysis.balanceDifference)} tone={Math.abs(analysis.balanceDifference) > 0.05 ? 'warn' : 'normal'} />
              </div>

              {analysis.blockingErrors.length > 0 && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                  <div className="mb-2 flex items-center gap-2 font-black">
                    <AlertTriangle className="h-4 w-4" />
                    تواريخ يجب مراجعتها قبل الاعتماد
                  </div>
                  {analysis.blockingErrors.map((warning) => (
                    <div key={warning}>- {warning}</div>
                  ))}
                </div>
              )}

              {analysis.warnings.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  <div className="mb-2 flex items-center gap-2 font-black">
                    <AlertTriangle className="h-4 w-4" />
                    ملاحظات قبل الاعتماد
                  </div>
                  {analysis.warnings.map((warning) => (
                    <div key={warning}>- {warning}</div>
                  ))}
                </div>
              )}

              <div className="rounded-lg border border-slate-200 p-4">
                <label className="mb-2 block text-sm font-bold text-slate-700">الصندوق المالي المستخدم لسندات القبض</label>
                <select
                  value={cashboxId}
                  onChange={(event) => setCashboxId(event.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">اختر صندوقاً</option>
                  {cashboxes.map((box) => (
                    <option key={box.id} value={box.id}>
                      {box.name} ({box.code}) - {box.currency_code}
                    </option>
                  ))}
                </select>
                {matchingCashbox && <p className="mt-2 text-xs text-slate-500">سيتم تأكيد سندات القبض على صندوق: {matchingCashbox.name}</p>}
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <PreviewTable
                  title={`بنود المبيعات (${analysis.saleLines.length})`}
                  rows={analysis.saleLines.slice(0, 12).map((line) => [
                    line.date,
                    line.originalDateValue && line.originalDateValue !== line.date ? line.originalDateValue : '—',
                    line.materialName,
                    line.quantity.toFixed(2),
                    line.rolls.toString(),
                    money(line.total),
                  ])}
                  headers={['التاريخ', 'أصل التاريخ', 'الخامة', 'الكمية', 'توب', 'الإجمالي']}
                />
                <PreviewTable
                  title={`الدفعات والمرتجعات (${analysis.payments.length + analysis.returnPayments.length})`}
                  rows={[...analysis.payments, ...analysis.returnPayments].map((row) => [
                    row.date,
                    row.kind === 'return' ? 'مرتجع' : 'سند قبض',
                    money(row.amount),
                    row.rawLabel,
                    row.dateParseSource === 'excel_serial' ? 'Excel رقمي' : row.dateParseSource,
                  ])}
                  headers={['التاريخ', 'النوع', 'المبلغ', 'الأصل', 'مصدر التاريخ']}
                />
              </div>

              <div className="flex items-center justify-end gap-3 border-t border-slate-200 pt-4">
                <button type="button" onClick={onClose} className="rounded-lg bg-slate-100 px-4 py-2 font-bold text-slate-700 hover:bg-slate-200">
                  إغلاق
                </button>
                <button
                  type="button"
                  onClick={() => void handleConfirmImport()}
                  disabled={importing || loadingFile || !analysis.customerName || !analysis.saleLines.length || analysis.blockingErrors.length > 0}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2 font-bold text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                  {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  تأكيد الاستيراد
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const SummaryCard = ({ label, value, tone = 'normal' }: { label: string; value: string; tone?: 'normal' | 'warn' }) => (
  <div className={`rounded-lg border px-3 py-3 ${tone === 'warn' ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-slate-50'}`}>
    <div className="text-xs font-bold text-slate-500">{label}</div>
    <div className="mt-1 break-words text-sm font-black text-slate-900">{value}</div>
  </div>
);

const PreviewTable = ({ title, headers, rows }: { title: string; headers: string[]; rows: string[][] }) => (
  <div className="overflow-hidden rounded-lg border border-slate-200">
    <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-sm font-black text-slate-800">{title}</div>
    <div className="max-h-72 overflow-auto">
      <table className="w-full text-right text-xs">
        <thead className="sticky top-0 bg-white text-slate-500">
          <tr>
            {headers.map((header) => (
              <th key={header} className="border-b border-slate-100 px-3 py-2">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={headers.length} className="px-3 py-5 text-center text-slate-400">
                لا توجد بيانات
              </td>
            </tr>
          ) : (
            rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="border-b border-slate-50">
                {row.map((cell, cellIndex) => (
                  <td key={`${rowIndex}-${cellIndex}`} className="px-3 py-2 text-slate-700">
                    {cell}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  </div>
);
