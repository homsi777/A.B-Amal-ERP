import React, { useState, useMemo, useEffect } from 'react';
import { useStore } from '../../store/useStore';
import { ArrowUpCircle, FileText, Printer, Download, Calendar, MessageCircle, X, CreditCard, Banknote, Filter, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { exportPdfFromHtmlString, exportToPDF, renderCustomerAccountStatementPdfHtml, renderCustomerStatementPdfHtml } from '../../lib/pdfExport';
import { sendTelegramAccountStatementPdf, sendTelegramStatementPdf } from '../../lib/telegramStatement';
import { BatchStatementExportModal } from '../../components/statements/BatchStatementExportModal';
import { A4PreviewModal } from '../../components/printing/A4PreviewModal';
import { BRAND } from '../../branding';
import { listVouchers, createVoucher, confirmVoucher, type VoucherRow } from '../../lib/api/vouchersApi';
import { listCashboxes, type CashboxDto } from '../../lib/api/cashboxesApi';
import { getCustomerStatement, type PartyStatementData } from '../../lib/api/partyStatementsApi';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  type StatementPreset,
  resolveCustomerForPreset,
  buildFabricRowsFromSaleInvoices,
  collectFabricTypeOptions,
} from '../../lib/customerStatementFilters';
import { listSalesInvoices, getSalesInvoice } from '../../lib/api/salesInvoicesApi';
import { mapSalesInvoiceDetailToInvoice } from '../../lib/invoiceDbMappers';
import { listCustomers, type ApiCustomer } from '../../lib/api/customersApi';
import type { Customer, Invoice } from '../../types';
import { useToast } from '../../components/NonBlockingToast';
import { SmartPartySearch } from '../../components/SmartPartySearch';

const PRESET_LABELS: Record<StatementPreset, string> = {
  manual: 'اختيار يدوي للعميل',
  highest_debt: 'أكثر عميل عليه دين (أكبر ذمة)',
  most_payments: 'أكثر عميل سدّد دفعات (في الفترة)',
  top_buyer_fabric: 'أكثر عميل اشترى خامة محددة',
};

interface FabricGroup {
  fabricName: string;
  rollsCount: number;
  totalQuantity: number;
  unitPrice: number;
  totalAmount: number;
}

function extractBaseFabricName(rawName: string | undefined): string {
  const value = String(rawName ?? '').trim();
  if (!value) return 'خامة غير محددة';
  const separators = ['·', '|', '،', ',', ' - ', ' — ', ' – '];
  for (const separator of separators) {
    if (!value.includes(separator)) continue;
    const base = value.split(separator)[0]?.trim();
    if (base) return base;
  }
  return value;
}

function groupInvoiceLinesByFabric(invoice: Invoice): FabricGroup[] {
  if (!invoice.items || invoice.items.length === 0) return [];
  const groups = new Map<
    string,
    { rollsCount: number; totalQuantity: number; totalAmount: number; lastUnitPrice: number }
  >();
  for (const item of invoice.items) {
    const name = extractBaseFabricName(item.fabricName || item.materialName);
    const existing = groups.get(name) ?? { rollsCount: 0, totalQuantity: 0, totalAmount: 0, lastUnitPrice: 0 };
    const rollsCount =
      typeof item.rollsCount === 'number' && Number.isFinite(item.rollsCount) && item.rollsCount > 0
        ? item.rollsCount
        : 1;
    existing.rollsCount += rollsCount;
    existing.totalQuantity += Number(item.quantity || 0);
    const lineTotal = Number(item.total || 0) || Number(item.quantity || 0) * Number(item.unitPrice || 0);
    existing.totalAmount += lineTotal;
    existing.lastUnitPrice = Number(item.unitPrice || existing.lastUnitPrice || 0);
    groups.set(name, existing);
  }
  return Array.from(groups.entries()).map(([fabricName, g]) => ({
    fabricName,
    rollsCount: g.rollsCount,
    totalQuantity: g.totalQuantity,
    unitPrice: g.totalQuantity > 0 ? g.totalAmount / g.totalQuantity : g.lastUnitPrice,
    totalAmount: g.totalAmount,
  }));
}

export const CustomerStatement = () => {
  const { showToast } = useToast();
  const { customers, invoices, inventory, transactions } = useStore();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [apiCustomers, setApiCustomers] = useState<ApiCustomer[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [preset, setPreset] = useState<StatementPreset>('manual');
  const [fabricPresetKey, setFabricPresetKey] = useState('');
  const [fromDate, setFromDate] = useState<string>(() => format(new Date(new Date().getFullYear(), new Date().getMonth(), 1), 'yyyy-MM-dd'));
  const [toDate, setToDate] = useState<string>(() => format(new Date(), 'yyyy-MM-dd'));
  const [dateAutoRange, setDateAutoRange] = useState(true);
  const [hideFinancialColumns, setHideFinancialColumns] = useState(false);
  const [batchExportOpen, setBatchExportOpen] = useState(false);
  const [customerDuesExporting, setCustomerDuesExporting] = useState(false);
  const [printPreviewOpen, setPrintPreviewOpen] = useState(false);

  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentMode, setPaymentMode] = useState<'receipt' | 'payment'>('receipt');
  const [payAmount, setPayAmount] = useState('');
  const [payDate, setPayDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [payCashboxId, setPayCashboxId] = useState('');
  const [cashboxes, setCashboxes] = useState<CashboxDto[]>([]);
  const [partyVouchers, setPartyVouchers] = useState<VoucherRow[]>([]);
  const [vouchersLoading, setVouchersLoading] = useState(false);
  const [voucherRefreshTick, setVoucherRefreshTick] = useState(0);
  const [payNote, setPayNote] = useState('');
  const [dbSaleInvoicesFromApi, setDbSaleInvoicesFromApi] = useState<Invoice[]>([]);
  const [accountStatement, setAccountStatement] = useState<PartyStatementData | null>(null);
  const [accountStatementLoading, setAccountStatementLoading] = useState(false);
  const [accountStatementError, setAccountStatementError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await listCustomers({ status: 'active', pageSize: 1000 });
        if (cancelled) return;
        setApiCustomers(res.data);
      } catch {
        if (!cancelled) setApiCustomers([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  type CustomerWithCreatedAt = Customer & { created_at?: string };
  const customerOptions = useMemo<CustomerWithCreatedAt[]>(() => {
    const apiMapped: CustomerWithCreatedAt[] = apiCustomers.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      address: c.address,
      balance: 0,
      created_at: c.created_at,
    }));
    if (!apiMapped.length) return customers as CustomerWithCreatedAt[];
    const seen = new Set<string>();
    const merged = [...apiMapped, ...(customers as CustomerWithCreatedAt[])].filter((c) => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });
    return merged;
  }, [apiCustomers, customers]);

  useEffect(() => {
    if (selectedCustomerId && customerOptions.some((c) => c.id === selectedCustomerId)) return;
    /** لا تُجبر أول عميل عند التفريغ — وإلا يمنع SmartPartySearch تغيير الاختيار أثناء الكتابة */
    if (selectedCustomerId === '') return;
    setSelectedCustomerId(customerOptions[0]?.id || '');
  }, [customerOptions, selectedCustomerId]);

  useEffect(() => {
    const requestedCustomerId = searchParams.get('customerId');
    if (!requestedCustomerId) return;
    if (!customerOptions.some((c) => c.id === requestedCustomerId)) return;
    setSelectedCustomerId(requestedCustomerId);
  }, [searchParams, customerOptions]);

  useEffect(() => {
    if (!dateAutoRange) return;
    if (!selectedCustomerId) return;
    const c = customerOptions.find((x) => x.id === selectedCustomerId);
    if (!c) return;
    const createdAt = String((c as CustomerWithCreatedAt).created_at || '').slice(0, 10);
    const safeCreated = /^\d{4}-\d{2}-\d{2}$/.test(createdAt)
      ? createdAt
      : format(new Date(new Date().getFullYear(), 0, 1), 'yyyy-MM-dd');
    setFromDate(safeCreated);
    setToDate(format(new Date(), 'yyyy-MM-dd'));
  }, [dateAutoRange, selectedCustomerId, customerOptions]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await listCashboxes({ active: true });
        if (cancelled) return;
        const list = res.data ?? [];
        setCashboxes(list);
        setPayCashboxId((prev) => {
          if (prev && list.some((b) => b.id === prev)) return prev;
          const def = list.find((b) => b.is_default) ?? list[0];
          return def?.id ?? '';
        });
      } catch {
        if (!cancelled) {
          setCashboxes([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const isUuid = (value: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

  const openAccountStatementSource = (row: NonNullable<PartyStatementData['rows']>[number]) => {
    if (row.sourceType === 'SALES_INVOICE' || row.sourceType === 'PURCHASE_INVOICE') {
      navigate(`/invoices/statement/${row.sourceId}`);
      return;
    }
    if (row.sourceType === 'VOUCHER') {
      navigate(`/bonds/records/${row.sourceId}`);
      return;
    }
    if (row.sourceType === 'RETURN_INVOICE') {
      navigate('/invoices/returns');
      showToast({ type: 'warning', message: `تم فتح صفحة المرتجعات. رقم المستند: ${row.documentNo}` });
    }
  };

  useEffect(() => {
    if (!selectedCustomerId) return;
    if (!isUuid(selectedCustomerId)) {
      setPartyVouchers([]);
      setVouchersLoading(false);
      return;
    }
    let cancelled = false;
    setVouchersLoading(true);
    void (async () => {
      try {
        const acc: VoucherRow[] = [];
        let page = 1;
        for (;;) {
          const r = await listVouchers({
            partyType: 'CUSTOMER',
            partyId: selectedCustomerId,
            dateFrom: fromDate,
            dateTo: toDate,
            status: 'CONFIRMED',
            page,
            pageSize: 100,
          });
          acc.push(...r.data);
          if (r.data.length < 100 || acc.length >= r.total) break;
          page++;
        }
        if (!cancelled) setPartyVouchers(acc);
      } catch {
        if (!cancelled) setPartyVouchers([]);
      } finally {
        if (!cancelled) setVouchersLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedCustomerId, fromDate, toDate, voucherRefreshTick]);

  useEffect(() => {
    if (!selectedCustomerId || !isUuid(selectedCustomerId)) {
      setDbSaleInvoicesFromApi([]);
      return;
    }
    let cancelled = false;
    setDbSaleInvoicesFromApi([]);
    void (async () => {
      try {
        const list = await listSalesInvoices({
          customerId: selectedCustomerId,
          dateFrom: fromDate,
          dateTo: toDate,
          pageSize: 500,
          documentStatus: 'CONFIRMED',
        });
        const details = await Promise.all(
          list.rows.map((row) => getSalesInvoice(String((row as Record<string, unknown>).id))),
        );
        if (cancelled) return;
        setDbSaleInvoicesFromApi(details.map((d) => mapSalesInvoiceDetailToInvoice(d.data)));
      } catch {
        if (!cancelled) setDbSaleInvoicesFromApi([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedCustomerId, fromDate, toDate]);

  useEffect(() => {
    if (!selectedCustomerId || !isUuid(selectedCustomerId)) {
      setAccountStatement(null);
      setAccountStatementError(null);
      setAccountStatementLoading(false);
      return;
    }
    let cancelled = false;
    setAccountStatementLoading(true);
    setAccountStatementError(null);
    void (async () => {
      try {
        const res = await getCustomerStatement(selectedCustomerId, { fromDate, toDate });
        if (cancelled) return;
        setAccountStatement(res.data);
      } catch (e) {
        if (cancelled) return;
        setAccountStatement(null);
        setAccountStatementError(e instanceof Error ? e.message : 'تعذر تحميل كشف الحساب من الخادم');
      } finally {
        if (!cancelled) setAccountStatementLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedCustomerId, fromDate, toDate, voucherRefreshTick]);

  const legacyLocalSaleInvoices = useMemo(
    () =>
      invoices.filter((i) => {
        if (i.type !== 'sale') return false;
        return !isUuid(i.id);
      }),
    [invoices],
  );

  const combinedSaleInvoices = useMemo(
    () => [...dbSaleInvoicesFromApi, ...legacyLocalSaleInvoices],
    [dbSaleInvoicesFromApi, legacyLocalSaleInvoices],
  );

  const voucherSummary = useMemo(() => {
    let receipts = 0;
    let payments = 0;
    for (const v of partyVouchers) {
      const a = Number(v.amount);
      if (v.voucher_type === 'RECEIPT') receipts += a;
      else if (v.voucher_type === 'PAYMENT') payments += a;
    }
    return { receipts, payments, net: receipts - payments };
  }, [partyVouchers]);

  const selectedCustomer = customerOptions.find((c) => c.id === selectedCustomerId);
  const isPaymentMode = paymentMode === 'payment';
  const statementCurrency =
    accountStatement?.rows?.[0]?.currency ||
    partyVouchers[0]?.currency_code ||
    'USD';
  const paymentFormCurrency =
    cashboxes.find((x) => x.id === payCashboxId)?.currency_code ||
    'USD';

  const fabricOptions = useMemo(
    () => collectFabricTypeOptions(combinedSaleInvoices, inventory.map((i) => i.name)),
    [combinedSaleInvoices, inventory],
  );

  const resolvedPresetCustomerId = useMemo(
    () =>
      resolveCustomerForPreset(preset, fabricPresetKey, customerOptions, combinedSaleInvoices, transactions, fromDate, toDate),
    [preset, fabricPresetKey, customerOptions, combinedSaleInvoices, transactions, fromDate, toDate],
  );

  useEffect(() => {
    if (preset === 'manual') return;
    if (resolvedPresetCustomerId) setSelectedCustomerId(resolvedPresetCustomerId);
  }, [preset, resolvedPresetCustomerId]);

  const invoiceFabricRows = useMemo(
    () =>
      selectedCustomerId
        ? buildFabricRowsFromSaleInvoices(combinedSaleInvoices, selectedCustomerId, fromDate, toDate)
        : [],
    [combinedSaleInvoices, selectedCustomerId, fromDate, toDate],
  );

  const fabricItems = invoiceFabricRows;
  const invoiceDetailsBySourceId = useMemo(
    () =>
      dbSaleInvoicesFromApi.reduce<Record<string, ReturnType<typeof groupInvoiceLinesByFabric>>>((acc, invoice) => {
        acc[invoice.id] = groupInvoiceLinesByFabric(invoice);
        return acc;
      }, {}),
    [dbSaleInvoicesFromApi],
  );
  const invoiceDetailsByDocumentNo = useMemo(
    () =>
      dbSaleInvoicesFromApi.reduce<Record<string, ReturnType<typeof groupInvoiceLinesByFabric>>>((acc, invoice) => {
        const key = String(invoice.invoiceNumber ?? '').trim();
        if (key) acc[key] = groupInvoiceLinesByFabric(invoice);
        return acc;
      }, {}),
    [dbSaleInvoicesFromApi],
  );

  const presetBanner = useMemo(() => {
    if (preset === 'manual') return null;
    const name = selectedCustomer?.name ?? '';
    if (preset === 'highest_debt') {
      return `تم ضبط العميل وفق أكبر رصيد ذمة حالياً: ${name}`;
    }
    if (preset === 'most_payments') {
      return `تم ضبط العميل وفق أكبر مجموع قبض ذمم في الفترة (مع احتياطي من كل الفترات إن لزم): ${name}`;
    }
    if (preset === 'top_buyer_fabric') {
      if (!fabricPresetKey.trim()) return 'اختر نوع الخامة أو كود التصميم من القائمة لتحديد أكثر عميل شراءً.';
      return `تم ضبط العميل وفق أكبر مشتريات للخامة «${fabricPresetKey}» ضمن الفترة: ${name}`;
    }
    return null;
  }, [preset, selectedCustomer?.name, fabricPresetKey]);

  // Calculate totals
  const totals = useMemo(() => {
    return fabricItems.reduce(
      (acc, item) => ({
        totalQuantity: acc.totalQuantity + item.quantity,
        totalRolls: acc.totalRolls + item.rollsCount,
        totalAmount: acc.totalAmount + item.total,
        totalPayments: acc.totalPayments + item.payments,
        totalRemaining: acc.totalRemaining + item.remaining,
        itemCount: acc.itemCount + 1
      }),
      { totalQuantity: 0, totalRolls: 0, totalAmount: 0, totalPayments: 0, totalRemaining: 0, itemCount: 0 }
    );
  }, [fabricItems]);

  // Determine debit/credit
  const balance = totals.totalRemaining >= 0 
    ? { amount: totals.totalRemaining, type: 'مدين' as const, color: 'indigo' }
    : { amount: Math.abs(totals.totalRemaining), type: 'دائن' as const, color: 'emerald' };

  const balanceAfterVouchersNet = totals.totalRemaining - voucherSummary.net;
  const balanceCombined =
    balanceAfterVouchersNet >= 0
      ? { amount: balanceAfterVouchersNet, type: 'مدين' as const, color: 'indigo' as const }
      : { amount: Math.abs(balanceAfterVouchersNet), type: 'دائن' as const, color: 'emerald' as const };

  const formatDuesMoney = (value: number) =>
    value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const escapeDuesHtml = (value: unknown) =>
    String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');

  const renderCustomerDuesPdfHtml = (
    rows: Array<{
      code: string;
      name: string;
      total: number;
      credit: number;
      debit: number;
      remaining: number;
      balance: number;
      lastPaymentDate: string | null;
      lastPaymentAmount: number;
      currency: string;
      notes?: string | null;
    }>,
  ) => {
    const totalsByCurrency = rows.reduce<Record<string, { debit: number; credit: number; remaining: number; balance: number; count: number }>>(
      (acc, row) => {
        const currency = row.currency || 'USD';
        const cur = acc[currency] ?? { debit: 0, credit: 0, remaining: 0, balance: 0, count: 0 };
        cur.debit += row.debit;
        cur.credit += row.credit;
        cur.remaining += row.remaining;
        cur.balance += row.balance;
        cur.count += 1;
        acc[currency] = cur;
        return acc;
      },
      {},
    );
    const totalsRows = Object.entries(totalsByCurrency);

    return `
    <!doctype html>
    <html lang="ar" dir="rtl">
      <head>
        <meta charset="utf-8" />
        <title>كشف ذمم العملاء</title>
        <style>
          @page { size: A4; margin: 10mm; }
          body { font-family: Arial, Tahoma, sans-serif; color: #0f172a; font-size: 12px; }
          .head { text-align:center; border-bottom:2px solid #1e293b; padding-bottom:8px; margin-bottom:10px; }
          .logo { height:78px; width:auto; object-fit:contain; display:block; margin:0 auto 4px; }
          .brand { font-weight:900; font-size:18px; color:#1e293b; }
          .title { text-align:center; margin: 22px 0 20px; font-weight:900; font-size:20px; }
          .meta { display:flex; justify-content:space-between; margin-bottom:8px; color:#334155; font-size:11px; }
          .summary { margin: 0 0 12px; border:1px solid #94a3b8; }
          .summary th { background:#e2e8f0; color:#0f172a; }
          .summary td, .summary th { padding:8px 6px; font-weight:800; }
          table { width:100%; border-collapse:collapse; }
          th, td { border:1px solid #cbd5e1; padding:7px 6px; text-align:right; }
          thead th { background:#0f172a; color:#fff; font-weight:800; }
          tbody tr:nth-child(even) { background:#f8fafc; }
          .num { direction:ltr; text-align:right; white-space:nowrap; }
          .note { color:#334155; }
        </style>
      </head>
      <body>
        <div class="head">
          <img class="logo" src="${BRAND.logoInline}" alt="${escapeDuesHtml(BRAND.name)}" />
          <div class="brand">${escapeDuesHtml(BRAND.name)}</div>
          <div>${escapeDuesHtml(BRAND.descriptionAr)}</div>
        </div>
        <div class="title">كشف ذمم العملاء</div>
        <div class="meta">
          <div>عدد العملاء: ${rows.length}</div>
          <div>تاريخ التذكير: ${escapeDuesHtml(toDate)}</div>
        </div>
        <table class="summary">
          <thead>
            <tr>
              <th>العملة</th>
              <th>عدد العملاء</th>
              <th>إجمالي مدين</th>
              <th>إجمالي دائن</th>
              <th>إجمالي المتبقي</th>
              <th>الرصيد الصافي</th>
            </tr>
          </thead>
          <tbody>
            ${
              totalsRows
                .map(([currency, total]) => `
                  <tr>
                    <td>${escapeDuesHtml(currency)}</td>
                    <td class="num">${total.count}</td>
                    <td class="num">${formatDuesMoney(total.debit)}</td>
                    <td class="num">${formatDuesMoney(total.credit)}</td>
                    <td class="num">${formatDuesMoney(total.remaining)}</td>
                    <td class="num">${formatDuesMoney(Math.abs(total.balance))} ${total.balance >= 0 ? 'مدين' : 'دائن'}</td>
                  </tr>
                `)
                .join('') || '<tr><td colspan="6" style="text-align:center;">لا توجد مجاميع</td></tr>'
            }
          </tbody>
        </table>
        <table>
          <thead>
            <tr>
              <th>الكود</th>
              <th>اسم العميل</th>
              <th>مجموع</th>
              <th>دائن</th>
              <th>مدين</th>
              <th>متبقي</th>
              <th>آخر دفعة</th>
              <th>تاريخ آخر دفعة</th>
              <th>العملة</th>
              <th>ملاحظة</th>
            </tr>
          </thead>
          <tbody>
            ${
              rows
                .map(
                  (row) => `
                    <tr>
                      <td>${escapeDuesHtml(row.code)}</td>
                      <td>${escapeDuesHtml(row.name)}</td>
                      <td class="num">${formatDuesMoney(row.total)}</td>
                      <td class="num">${formatDuesMoney(row.credit)}</td>
                      <td class="num">${formatDuesMoney(row.debit)}</td>
                      <td class="num">${formatDuesMoney(row.remaining)}</td>
                      <td class="num">${row.lastPaymentAmount > 0 ? formatDuesMoney(row.lastPaymentAmount) : '—'}</td>
                      <td>${row.lastPaymentDate ? escapeDuesHtml(row.lastPaymentDate) : '—'}</td>
                      <td>${escapeDuesHtml(row.currency)}</td>
                      <td class="note">${escapeDuesHtml(row.notes || 'أضيف تلقائياً من استيراد كشف حساب عميل Excel')}</td>
                    </tr>
                  `,
                )
                .join('') || '<tr><td colspan="10" style="text-align:center;">لا توجد بيانات</td></tr>'
            }
          </tbody>
        </table>
      </body>
    </html>
  `;
  };

  const handleExportCustomerDuesPDF = async () => {
    setCustomerDuesExporting(true);
    try {
      const res = await listCustomers({ status: 'active', page: 1, pageSize: 1000 });
      const rows = await Promise.all(
        res.data.map(async (customer) => {
          try {
            const statementRes = await getCustomerStatement(customer.id, { toDate });
            const statement = statementRes.data;
            const debit = Number(statement.totals.debit || 0);
            const credit = Number(statement.totals.credit || 0);
            const lastPayment = [...statement.rows]
              .filter((row) => row.type === 'RECEIPT_VOUCHER' && Number(row.credit || 0) > 0)
              .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
            return {
              code: customer.code,
              name: customer.name,
              total: debit + credit,
              credit,
              debit,
              remaining: Math.abs(Number(statement.totals.closingBalance || 0)),
              balance: Number(statement.totals.closingBalance || 0),
              lastPaymentDate: lastPayment?.date ?? null,
              lastPaymentAmount: Number(lastPayment?.credit || 0),
              currency: String(statement.rows[0]?.currency || 'USD'),
              notes: customer.notes,
            };
          } catch {
            return {
              code: customer.code,
              name: customer.name,
              total: 0,
              credit: 0,
              debit: 0,
              remaining: 0,
              balance: 0,
              lastPaymentDate: null,
              lastPaymentAmount: 0,
              currency: 'USD',
              notes: customer.notes,
            };
          }
        }),
      );
      await exportPdfFromHtmlString(renderCustomerDuesPdfHtml(rows), `ذمم_العملاء_${toDate}`, { orientation: 'portrait' });
      showToast({ type: 'success', message: 'تم تصدير ذمم العملاء PDF بنجاح.' });
    } catch (error) {
      showToast({ type: 'error', message: error instanceof Error ? error.message : 'تعذر تصدير ذمم العملاء PDF.' });
    } finally {
      setCustomerDuesExporting(false);
    }
  };

  // Handle PDF Export
  const handleExportPDF = async () => {
    try {
      if (accountStatement?.customer) {
        const pdfHtml = renderCustomerAccountStatementPdfHtml({
          customerName: accountStatement.customer.name,
          customerPhone: accountStatement.customer.phone ?? null,
          customerAddress: accountStatement.customer.address ?? null,
          fromDate,
          toDate,
          openingBalance: accountStatement.openingBalance,
          rows: accountStatement.rows,
          totals: accountStatement.totals,
          invoiceDetailsBySourceId: invoiceDetailsBySourceId,
          invoiceDetailsByDocumentNo,
        });
        await exportPdfFromHtmlString(pdfHtml, `كشف_حساب_${accountStatement.customer.name}_${fromDate}_${toDate}`, {
          orientation: 'portrait',
        });
        return;
      }

      if (!selectedCustomer || fabricItems.length === 0) {
        showToast({ type: 'warning', message: 'الرجاء تحميل البيانات أولاً' });
        return;
      }
      await exportToPDF({
        customerName: selectedCustomer.name,
        customerPhone: selectedCustomer.phone,
        customerAddress: selectedCustomer.address,
        fromDate,
        toDate,
        fabricItems,
        totals,
        balance: {
          amount: balance.amount,
          type: balance.type
        },
        hideFinancialColumns
      });
    } catch {
      showToast({ type: 'error', message: 'حدث خطأ في إنشاء PDF. حاول مرة أخرى.' });
    }
  };

  const buildStatementPrintHtml = () => {
    if (accountStatement?.customer) {
      return renderCustomerAccountStatementPdfHtml({
        customerName: accountStatement.customer.name,
        customerPhone: accountStatement.customer.phone ?? null,
        customerAddress: accountStatement.customer.address ?? null,
        fromDate,
        toDate,
        openingBalance: accountStatement.openingBalance,
        rows: accountStatement.rows,
        totals: accountStatement.totals,
        invoiceDetailsBySourceId,
        invoiceDetailsByDocumentNo,
      });
    }
    if (!selectedCustomer) return '';
    return renderCustomerStatementPdfHtml({
      customerName: selectedCustomer.name,
      customerPhone: selectedCustomer.phone,
      customerAddress: selectedCustomer.address,
      fromDate,
      toDate,
      fabricItems,
      totals,
      balance: { amount: balance.amount, type: balance.type },
      hideFinancialColumns,
    });
  };

  const statementPrintFileName = `كشف_حساب_${selectedCustomer?.name || accountStatement?.customer?.name || 'عميل'}_${fromDate}_${toDate}.pdf`;

  const handleShareWhatsApp = () => {
    if (!selectedCustomer || fabricItems.length === 0) {
      showToast({ type: 'warning', message: 'الرجاء تحميل بيانات الكشف أولاً' });
      return;
    }

    const message = [
      `كشف حساب عميل: ${selectedCustomer.name}`,
      `الفترة: من ${fromDate} إلى ${toDate}`,
      `عدد الخامات (أسطر الكشف): ${totals.itemCount}`,
      `مجموع الأتواب: ${totals.totalRolls.toLocaleString('ar')}`,
      `مجموع الكميات (طول): ${totals.totalQuantity.toLocaleString('ar')}`,
      `إجمالي الدفعات: ${totals.totalPayments.toLocaleString('ar')}`,
      `الرصيد ${balance.type}: ${balance.amount.toLocaleString('ar')}`,
      `تم إنشاء الكشف من ${BRAND.name} — ${BRAND.tagline} (${BRAND.descriptionAr}).`
    ].join('\n');

    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer');
  };

  const handleSendTelegram = async () => {
    try {
      if (accountStatement?.customer) {
        const closing = accountStatement.totals.closingBalance;
        const closingLabel = closing >= 0 ? 'مدين' : 'دائن';
        const pdfHtml = renderCustomerAccountStatementPdfHtml({
          customerName: accountStatement.customer.name,
          customerPhone: accountStatement.customer.phone ?? null,
          customerAddress: accountStatement.customer.address ?? null,
          fromDate,
          toDate,
          openingBalance: accountStatement.openingBalance,
          rows: accountStatement.rows,
          totals: accountStatement.totals,
          invoiceDetailsBySourceId: invoiceDetailsBySourceId,
          invoiceDetailsByDocumentNo,
        });
        await sendTelegramAccountStatementPdf({
          partyType: 'customer',
          partyId: accountStatement.customer.id,
          partyName: accountStatement.customer.name,
          fromDate,
          toDate,
          openingBalance: accountStatement.openingBalance,
          debitTotal: accountStatement.totals.debit,
          creditTotal: accountStatement.totals.credit,
          closingLabel,
          closingAmount: Math.abs(closing),
          currency: accountStatement.rows[0]?.currency ?? 'USD',
          rowsCount: accountStatement.rows.length,
          pdfHtml,
          fileName: `customer-account-statement-${accountStatement.customer.id}-${fromDate}-${toDate}.pdf`,
        });
        showToast({ type: 'success', message: 'تم إرسال كشف الحساب إلى تيليغرام.' });
        return;
      }

      if (!selectedCustomer || fabricItems.length === 0) {
        showToast({ type: 'warning', message: 'الرجاء تحميل بيانات الكشف أولاً' });
        return;
      }

      const pdfHtml = renderCustomerStatementPdfHtml({
        customerName: selectedCustomer.name,
        customerPhone: selectedCustomer.phone,
        customerAddress: selectedCustomer.address,
        fromDate,
        toDate,
        fabricItems,
        totals,
        balance: { amount: balance.amount, type: balance.type },
        hideFinancialColumns,
      });
      await sendTelegramStatementPdf({
        partyType: 'customer',
        partyId: selectedCustomer.id,
        partyName: selectedCustomer.name,
        fromDate,
        toDate,
        itemCount: totals.itemCount,
        totalAmount: totals.totalAmount,
        totalPayments: totals.totalPayments,
        balanceLabel: balance.type,
        balanceAmount: balance.amount,
        pdfHtml,
        fileName: `customer-statement-${selectedCustomer.id}-${fromDate}-${toDate}.pdf`,
      });
      showToast({ type: 'success', message: 'تم إرسال كشف الحساب إلى تيليغرام.' });
    } catch (error) {
      showToast({ type: 'error', message: error instanceof Error ? error.message : 'تعذر إرسال كشف الحساب إلى تيليغرام' });
    }
  };

  const closePaymentModal = () => {
    setPaymentModalOpen(false);
    setPayAmount('');
    setPayNote('');
    setPayDate(new Date().toISOString().split('T')[0]);
    const def = cashboxes.find((b) => b.is_default) ?? cashboxes[0];
    setPayCashboxId(def?.id ?? '');
  };

  const submitReceivePayment = async () => {
    if (!selectedCustomerId) {
      showToast({ type: 'warning', message: 'اختر عميلاً أولاً' });
      return;
    }
    const amount = Number(String(payAmount).replace(/,/g, ''));
    if (!amount || Number.isNaN(amount) || amount <= 0) {
      showToast({ type: 'warning', message: 'أدخل مبلغاً صحيحاً أكبر من صفر' });
      return;
    }
    const uuidRe =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRe.test(selectedCustomerId)) {
      showToast({ type: 'warning', message: 'لا يمكن تسجيل السند إلا لعملاء مسجلين على الخادم (معرّف UUID). استورد/sync العملاء من قاعدة البيانات.' });
      return;
    }
    if (!payCashboxId) {
      showToast({ type: 'warning', message: 'اختر صندوقاً مرتبطاً بالخادم لتسجيل السند في الخزينة.' });
      return;
    }
    if (!uuidRe.test(payCashboxId)) {
      showToast({ type: 'error', message: 'معرّف الصندوق غير صالح — أعد تحميل الصفحة أو راجع إعدادات الصناديق.' });
      return;
    }
    const cur = cashboxes.find((x) => x.id === payCashboxId)?.currency_code ?? 'USD';
    const descParts = [payNote.trim(), 'من كشف حساب عميل'].filter(Boolean);
    try {
      const created = await createVoucher({
        voucherType: paymentMode === 'payment' ? 'PAYMENT' : 'RECEIPT',
        voucherDate: payDate,
        cashboxId: payCashboxId,
        partyType: 'CUSTOMER',
        partyId: selectedCustomerId,
        partyName: selectedCustomer?.name ?? 'عميل',
        amount,
        currencyCode: cur,
        description: descParts.length ? descParts.join(' — ') : null,
      });
      await confirmVoucher(created.data.id);
      showToast({
        type: 'success',
        message:
          paymentMode === 'payment'
            ? 'تم تسجيل سند الصرف وتأكيده في الصندوق على الخادم.'
            : 'تم تسجيل سند القبض وتأكيده في الصندوق على الخادم.',
      });
      setVoucherRefreshTick((n) => n + 1);
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : 'تعذر إنشاء أو تأكيد السند' });
      return;
    }
    closePaymentModal();
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <A4PreviewModal
        open={printPreviewOpen}
        title="طباعة كشف حساب A4"
        html={buildStatementPrintHtml()}
        pageSize="A4"
        defaultFileName={statementPrintFileName}
        onClose={() => setPrintPreviewOpen(false)}
        onPrinted={() => setPrintPreviewOpen(false)}
        onExported={() => setPrintPreviewOpen(false)}
      />
         <div className="flex justify-between items-end">
         <div>
           <h2 className="text-2xl font-bold text-slate-900">كشف حساب عميل</h2>
           <p className="text-slate-500 mt-1">عرض الحركات والخامات المباعة مع الأرصدة الدائنة والمدينة</p>
         </div>
         <div className="flex gap-2">
           <button className="bg-indigo-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-indigo-700 transition shadow-sm font-medium" onClick={() => setPrintPreviewOpen(true)}>
             <Printer className="w-4 h-4" />
             <span>طباعة / PDF</span>
           </button>
           <button
             type="button"
             disabled={customerDuesExporting}
             className="bg-white border border-slate-200 text-slate-800 px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-slate-50 transition shadow-sm font-medium disabled:opacity-60"
             onClick={() => void handleExportCustomerDuesPDF()}
           >
             {customerDuesExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
             <span>تصدير ذمم عملاء PDF</span>
           </button>
           <button
             type="button"
             className="bg-white border border-indigo-200 text-indigo-700 px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-indigo-50 transition shadow-sm font-medium"
             onClick={() => setBatchExportOpen(true)}
           >
             <Download className="w-4 h-4" />
             <span>تصدير جماعي</span>
           </button>
           <button
             type="button"
             onClick={() => setHideFinancialColumns((value) => !value)}
             className={`border px-4 py-2 rounded-lg flex items-center gap-2 transition shadow-sm font-medium ${
               hideFinancialColumns
                 ? 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
                 : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
             }`}
           >
             <span>{hideFinancialColumns ? 'إظهار المبالغ' : 'إخفاء المبالغ'}</span>
           </button>
           <button className="bg-emerald-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-emerald-700 transition shadow-sm font-medium" onClick={handleShareWhatsApp}>
             <MessageCircle className="w-4 h-4" />
             <span>مشاركة واتساب</span>
           </button>
           <button className="bg-sky-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-sky-700 transition shadow-sm font-medium" onClick={() => void handleSendTelegram()}>
             <MessageCircle className="w-4 h-4" />
             <span>إرسال تيليغرام</span>
           </button>
           <button
             type="button"
             onClick={() => {
               setPaymentMode('receipt');
               setPaymentModalOpen(true);
             }}
             className="bg-gradient-to-r from-emerald-500/20 to-emerald-500/0 px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-emerald-500/30 transition shadow-sm font-medium border border-emerald-500/50 text-emerald-600"
           >
             <Banknote className="w-4 h-4" />
             <span>استلام دفعة</span>
           </button>
           <button
             type="button"
             onClick={() => {
               setPaymentMode('payment');
               setPaymentModalOpen(true);
             }}
             className="bg-gradient-to-r from-rose-500/20 to-rose-500/0 px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-rose-500/30 transition shadow-sm font-medium border border-rose-500/50 text-rose-600"
           >
             <ArrowUpCircle className="w-4 h-4" />
             <span>سند دفع</span>
           </button>
         </div>
       </div>

<div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
         <div className="p-4 border-b border-slate-200 bg-slate-50">
           <div className="flex flex-wrap lg:flex-nowrap items-end gap-3">
             <div className="space-y-1 w-full lg:w-auto lg:flex-1 min-w-[220px]">
               <label className="block text-xs font-bold text-slate-600">اختر العميل</label>
               <SmartPartySearch
                 options={customerOptions}
                 selectedId={selectedCustomerId}
                 placeholder="اكتب أول حرف أو رقم هاتف العميل"
                 emptyLabel="اكتب للبحث ثم اختر العميل من النتائج"
                 onSelect={(id) => {
                   setPreset('manual');
                   setDateAutoRange(true);
                   setSelectedCustomerId(id);
                 }}
               />
             </div>
             <div className="space-y-1 w-full lg:w-auto lg:flex-1 min-w-[220px]">
               <label className="flex items-center gap-1 text-xs font-bold text-slate-600">
                 <Filter className="w-4 h-4 text-indigo-500" />
                 فلترة حسب
               </label>
               <select
                 value={preset}
                 onChange={(e) => setPreset(e.target.value as StatementPreset)}
                 className="w-full px-3 py-2 bg-white border border-indigo-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm text-slate-800 font-medium text-sm"
                 title="يحدِّد العميل تلقائياً من البيانات المحفوظة؛ الفترة الزمنية تؤثر على «السداد» و«الخامة»."
               >
                 {(Object.keys(PRESET_LABELS) as StatementPreset[]).map((key) => (
                   <option key={key} value={key}>
                     {PRESET_LABELS[key]}
                   </option>
                 ))}
               </select>
             </div>
             {preset === 'top_buyer_fabric' && (
               <div className="space-y-1 w-full lg:w-auto lg:flex-1 min-w-[220px]">
                 <label className="block text-xs font-bold text-slate-600">نوع الخامة / كود التصميم</label>
                 <select
                   value={fabricPresetKey}
                   onChange={(e) => setFabricPresetKey(e.target.value)}
                   className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm text-sm"
                 >
                   <option value="">— اختر خامة من القائمة —</option>
                   {fabricOptions.map((name) => (
                     <option key={name} value={name}>
                       {name}
                     </option>
                   ))}
                 </select>
               </div>
             )}
             <div className="space-y-1 w-full lg:w-auto min-w-[200px]">
               <label className="block text-xs font-bold text-slate-600">تاريخ من</label>
               <div className="relative">
                 <Calendar className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
                 <input
                   type="date"
                   value={fromDate}
                   onChange={(e) => {
                     setDateAutoRange(false);
                     setFromDate(e.target.value);
                   }}
                   className="w-full pr-9 pl-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm text-slate-700 text-sm"
                 />
               </div>
             </div>
             <div className="space-y-1 w-full lg:w-auto min-w-[200px]">
               <label className="block text-xs font-bold text-slate-600">تاريخ إلى</label>
               <div className="relative">
                 <Calendar className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
                 <input
                   type="date"
                   value={toDate}
                   onChange={(e) => {
                     setDateAutoRange(false);
                     setToDate(e.target.value);
                   }}
                   className="w-full pr-9 pl-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm text-slate-700 text-sm"
                 />
               </div>
             </div>
           </div>

           {presetBanner && (
             <div className="mt-2 rounded-md border border-indigo-100 bg-indigo-50/80 px-3 py-1.5 text-xs text-indigo-900">
               {presetBanner}
             </div>
           )}
         </div>

        {selectedCustomer && (
          <>
            <div className="p-6 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
               <div className="flex items-center gap-4">
                 <div className="w-16 h-16 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-600">
                   <FileText className="w-8 h-8" />
                 </div>
                 <div>
                   <h3 className="text-xl font-bold text-slate-900">{selectedCustomer.name}</h3>
                   <p className="text-slate-500">جوال: {selectedCustomer.phone} | {selectedCustomer.address}</p>
                 </div>
               </div>
               
               {!hideFinancialColumns && (
                <div className="w-full lg:w-auto">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    <div className="border border-slate-200 bg-slate-50 px-3 py-2 rounded-lg">
                      <div className="text-[10px] font-bold text-slate-500 whitespace-nowrap">رصيد الفواتير (محلي)</div>
                      <div className={`mt-0.5 text-xs font-bold whitespace-nowrap ${balance.color === 'indigo' ? 'text-indigo-700' : 'text-emerald-700'}`}>
                        {balance.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}{' '}
                        <span className="text-[10px] font-normal text-slate-500">{statementCurrency}</span>{' '}
                        <span className="text-[10px] font-normal text-slate-500">({balance.type})</span>
                      </div>
                    </div>

                    <div className="border border-slate-200 bg-slate-50 px-3 py-2 rounded-lg">
                      <div className="text-[10px] font-bold text-slate-500 whitespace-nowrap">السندات (على الخادم ضمن الفترة)</div>
                      <div className="mt-0.5 text-xs font-bold text-slate-800 whitespace-nowrap">
                        قبض {voucherSummary.receipts.toLocaleString(undefined, { minimumFractionDigits: 2 })} — صرف{' '}
                        {voucherSummary.payments.toLocaleString(undefined, { minimumFractionDigits: 2 })} — صافٍ{' '}
                        {voucherSummary.net.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </div>
                    </div>

                    <div className="border border-slate-200 bg-slate-50 px-3 py-2 rounded-lg">
                      <div className="text-[10px] font-bold text-slate-500 whitespace-nowrap">الرصيد بعد السندات (تقديري)</div>
                      <div className={`mt-0.5 text-xs font-bold whitespace-nowrap ${balanceCombined.color === 'indigo' ? 'text-indigo-700' : 'text-emerald-700'}`}>
                        {balanceCombined.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}{' '}
                        <span className="text-[10px] font-normal text-slate-500">({balanceCombined.type})</span>
                      </div>
                    </div>
                  </div>
                  {vouchersLoading && <div className="mt-1 text-[11px] text-slate-400">جاري تحميل السندات…</div>}
                </div>
               )}
            </div>

            {fabricItems.length > 0 && (
              <div className="p-6 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-blue-50">
                <h4 className="text-lg font-bold text-slate-900 mb-4">📊 ملخص الكشف</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
                  <div className="bg-white rounded-lg p-4 border border-slate-200 shadow-sm hover:shadow-md transition">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">عدد الخامات</p>
                    <p className="text-2xl font-bold text-indigo-600">{totals.itemCount}</p>
                    <p className="text-[11px] text-slate-400 mt-1">عدد الأسطر في الكشف</p>
                  </div>

                  <div className="bg-white rounded-lg p-4 border border-slate-200 shadow-sm hover:shadow-md transition">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">مجموع الأتواب</p>
                    <p className="text-2xl font-bold text-violet-600">{totals.totalRolls.toLocaleString()}</p>
                    <p className="text-[11px] text-slate-400 mt-1">مجموع البكر لكل خامة</p>
                  </div>

                  <div className="bg-white rounded-lg p-4 border border-slate-200 shadow-sm hover:shadow-md transition">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">مجموع الكميات</p>
                    <p className="text-2xl font-bold text-blue-600">{totals.totalQuantity.toLocaleString()}</p>
                  </div>

                  {!hideFinancialColumns && <div className="bg-white rounded-lg p-4 border border-slate-200 shadow-sm hover:shadow-md transition">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">الإجمالي المالي</p>
                    <p className="text-2xl font-bold text-green-600">{totals.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 0 })}</p>
                  </div>}

                  {!hideFinancialColumns && <div className="bg-white rounded-lg p-4 border border-slate-200 shadow-sm hover:shadow-md transition">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">الدفعات المستلمة</p>
                    <p className="text-2xl font-bold text-emerald-600">{totals.totalPayments.toLocaleString(undefined, { minimumFractionDigits: 0 })}</p>
                  </div>}

                  {!hideFinancialColumns && <div className={`bg-white rounded-lg p-4 border-2 shadow-sm hover:shadow-md transition ${balance.color === 'indigo' ? 'border-indigo-300 bg-indigo-50' : 'border-emerald-300 bg-emerald-50'}`}>
                    <p className={`text-xs font-semibold uppercase tracking-wide mb-2 ${balance.color === 'indigo' ? 'text-indigo-600' : 'text-emerald-600'}`}>الرصيد ({balance.type})</p>
                    <p className={`text-2xl font-bold ${balance.color === 'indigo' ? 'text-indigo-600' : 'text-emerald-600'}`}>{balance.amount.toLocaleString(undefined, { minimumFractionDigits: 0 })}</p>
                  </div>}
                </div>
              </div>
            )}
          </>
        )}

        <div className="border-t border-slate-200 bg-white">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h4 className="text-sm font-bold text-slate-800">كشف حساب (حركات مالية - الخادم)</h4>
              <p className="text-[11px] text-slate-500 mt-1">فواتير + سندات + مرتجعات — مبني على قاعدة البيانات</p>
            </div>
            {accountStatementLoading && <span className="text-xs text-slate-400">جاري التحميل…</span>}
          </div>

          {accountStatementError && (
            <div className="px-4 py-3 text-sm text-rose-700 bg-rose-50 border-b border-rose-200">{accountStatementError}</div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="bg-slate-700 text-slate-100 font-medium">
                <tr>
                  <th className="px-4 py-3">التاريخ</th>
                  <th className="px-4 py-3">النوع</th>
                  <th className="px-4 py-3">الرقم</th>
                  <th className="px-4 py-3">البيان</th>
                  <th className="px-4 py-3">المبلغ (بالعملة)</th>
                  <th className="px-4 py-3">مدين ({statementCurrency})</th>
                  <th className="px-4 py-3">دائن ({statementCurrency})</th>
                  <th className="px-4 py-3">الرصيد ({statementCurrency})</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {!accountStatement?.rows?.length ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-slate-500 bg-white">
                      لا توجد حركات ضمن الفترة المحددة
                    </td>
                  </tr>
                ) : (
                  accountStatement.rows.map((row) => {
                    const isInvoice = row.sourceType === 'INVOICE' || row.sourceType === 'SALES_INVOICE';
                    const relatedInvoice = isInvoice ? dbSaleInvoicesFromApi.find(inv => inv.id === row.sourceId) : null;
                    const fabricGroups = relatedInvoice ? groupInvoiceLinesByFabric(relatedInvoice) : [];
                    return [
                      <tr key={`${row.sourceType}-${row.sourceId}`} className="bg-white hover:bg-slate-50">
                        <td className="px-4 py-3 text-slate-600">{row.date}</td>
                        <td className="px-4 py-3 text-slate-700">{row.typeLabel}</td>
                        <td className="px-4 py-3 font-mono text-xs">
                          <button
                            type="button"
                            onClick={() => openAccountStatementSource(row)}
                            className="text-indigo-700 hover:underline"
                            title="فتح المستند"
                          >
                            {row.documentNo}
                          </button>
                        </td>
                        <td className="px-4 py-3 text-slate-700 max-w-xl truncate" title={row.description}>
                          {row.description}
                        </td>
                        <td className="px-4 py-3 font-mono text-slate-700">
                          {row.debitOriginal && row.debitOriginal !== 0
                            ? `مدين: ${row.debitOriginal.toLocaleString(undefined, { minimumFractionDigits: 2 })} ${row.currency}`
                            : row.creditOriginal && row.creditOriginal !== 0
                              ? `دائن: ${row.creditOriginal.toLocaleString(undefined, { minimumFractionDigits: 2 })} ${row.currency}`
                              : `— ${row.currency}`}
                        </td>
                        <td className="px-4 py-3 font-mono text-blue-700">{row.debit.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                        <td className="px-4 py-3 font-mono text-emerald-700">{row.credit.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                        <td className="px-4 py-3 font-mono text-slate-900">{row.balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                      </tr>,
                      ...(fabricGroups.length > 0 ? fabricGroups.map((fg, fgIdx) => (
                        <tr key={`${row.sourceType}-${row.sourceId}-fab-${fgIdx}`} className="bg-slate-50 border-t border-slate-100">
                          <td colSpan={2} className="px-4 py-1.5 text-xs text-slate-500 pr-8" />
                          <td colSpan={1} className="px-4 py-1.5 text-xs font-semibold text-indigo-700 pr-8">{fg.fabricName}</td>
                          <td className="px-4 py-1.5 text-xs text-center">
                            <span className="bg-violet-100 text-violet-800 font-bold px-2 py-0.5 rounded text-xs">{fg.rollsCount} ثوب</span>
                          </td>
                          <td className="px-4 py-1.5 text-xs font-semibold text-slate-700">{fg.totalQuantity.toLocaleString('ar')} م</td>
                          <td colSpan={2} className="px-4 py-1.5 text-xs text-left font-bold text-emerald-700">{fg.totalAmount.toLocaleString('ar')} {row.currency}</td>
                          <td className="px-4 py-1.5 text-xs text-slate-400" />
                        </tr>
                      )) : [])
                    ];
                  })
                )}
              </tbody>
            </table>
          </div>

          {accountStatement && (
            <div className="px-4 py-3 border-t border-slate-200 bg-white text-xs text-slate-600 flex flex-wrap gap-4">
              <span>الرصيد الافتتاحي ({statementCurrency}): {accountStatement.openingBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
              <span>إجمالي المدين ({statementCurrency}): {accountStatement.totals.debit.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
              <span>إجمالي الدائن ({statementCurrency}): {accountStatement.totals.credit.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
              <span>الرصيد النهائي ({statementCurrency}): {accountStatement.totals.closingBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-800 text-slate-100 font-medium">
              <tr>
                <th className="px-4 py-4 whitespace-nowrap">التاريخ</th>
                <th className="px-4 py-4 whitespace-nowrap">المرجع</th>
                <th className="px-4 py-4 whitespace-nowrap">اسم الخامة</th>
                <th className="px-4 py-4 whitespace-nowrap">كود الخامة</th>
                <th className="px-4 py-4 whitespace-nowrap">عدد الأتواب</th>
                <th className="px-4 py-4 whitespace-nowrap">الكمية</th>
                <th className="px-4 py-4 whitespace-nowrap">الوحدة</th>
                {!hideFinancialColumns && <th className="px-4 py-4 whitespace-nowrap">السعر الواحد</th>}
                {!hideFinancialColumns && <th className="px-4 py-4 whitespace-nowrap">المجموع</th>}
                {!hideFinancialColumns && <th className="px-4 py-4 whitespace-nowrap">الدفعات</th>}
                {!hideFinancialColumns && <th className="px-4 py-4 whitespace-nowrap">الباقي عليه</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {fabricItems.length === 0 ? (
                <tr>
                  <td colSpan={hideFinancialColumns ? 7 : 11} className="px-4 py-8 text-center text-slate-500 bg-white">
                    لا توجد أسطر في الفترة — سجّل فواتير مبيعات لهذا العميل في النظام المحلي أو اضبط نطاق التواريخ.
                  </td>
                </tr>
              ) : (
                fabricItems.map(item => (
                  <tr key={item.id} className="hover:bg-slate-50 transition-colors bg-white">
                    <td className="px-4 py-4 font-medium text-slate-600">{item.date}</td>
                    <td className="px-4 py-4 text-slate-500 font-medium">{item.invoiceRef}</td>
                    <td className="px-4 py-4 font-bold text-slate-800">{item.fabricName}</td>
                    <td className="px-4 py-4 text-slate-600 font-mono">{item.fabricCode}</td>
                    <td className="px-4 py-4 text-center font-bold text-violet-700">{item.rollsCount.toLocaleString()}</td>
                    <td className="px-4 py-4 text-right font-semibold text-slate-700">{item.quantity.toLocaleString()}</td>
                    <td className="px-4 py-4 text-center text-slate-600">{item.unit}</td>
                    {!hideFinancialColumns && <td className="px-4 py-4 text-right font-semibold text-slate-700">{item.unitPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>}
                    {!hideFinancialColumns && <td className="px-4 py-4 text-right font-semibold text-blue-600">{item.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>}
                    {!hideFinancialColumns && <td className="px-4 py-4 text-right font-semibold text-emerald-600">{item.payments.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>}
                    {!hideFinancialColumns && <td className="px-4 py-4 text-right font-semibold text-rose-600">{item.remaining.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {selectedCustomer && partyVouchers.length > 0 && (
          <div className="border-t border-slate-200 bg-white">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
              <h4 className="text-sm font-bold text-slate-800">سندات قبض وصرف مؤكدة (الخادم) — الفترة</h4>
              <p className="text-[11px] text-slate-500 mt-1">مرتبطة بصناديق النظام وتظهر في شجرة الحسابات ودفتر اليومية التشغيلي.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm">
                <thead className="bg-slate-700 text-slate-100 font-medium">
                  <tr>
                    <th className="px-4 py-3">التاريخ</th>
                    <th className="px-4 py-3">السند</th>
                    <th className="px-4 py-3">النوع</th>
                    <th className="px-4 py-3">الصندوق</th>
                    <th className="px-4 py-3">المبلغ</th>
                    <th className="px-4 py-3">البيان</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {partyVouchers.map((v) => (
                    <tr key={v.id} className="bg-white hover:bg-slate-50">
                      <td className="px-4 py-3 text-slate-600">{v.voucher_date}</td>
                      <td className="px-4 py-3 font-mono text-xs">{v.voucher_no}</td>
                      <td className="px-4 py-3">
                        {v.voucher_type === 'RECEIPT' ? (
                          <span className="text-emerald-700 font-semibold">قبض</span>
                        ) : (
                          <span className="text-rose-700 font-semibold">صرف</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600 text-xs">{v.cashbox_name ?? '—'}</td>
                      <td className="px-4 py-3 font-mono">
                        {Number(v.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })} {v.currency_code}
                      </td>
                      <td className="px-4 py-3 text-slate-600 max-w-xs truncate" title={v.description ?? ''}>
                        {v.description ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}


      </div>

      {paymentModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-[2px]" role="dialog" aria-modal="true">
          <div
            className={`relative w-full max-w-lg rounded-2xl border bg-gradient-to-br via-white shadow-2xl ring-1 ${
              isPaymentMode
                ? 'border-rose-400/50 from-rose-500/20 to-rose-400/[0.07] shadow-rose-900/10 ring-rose-500/20'
                : 'border-emerald-400/50 from-emerald-500/20 to-emerald-400/[0.07] shadow-emerald-900/10 ring-emerald-500/20'
            }`}
          >
            <button
              type="button"
              onClick={closePaymentModal}
              className="absolute left-4 top-4 rounded-lg p-1.5 text-slate-500 hover:bg-white/80 hover:text-slate-800 transition"
              aria-label="إغلاق"
            >
              <X className="w-5 h-5" />
            </button>

            <div className={`border-b px-6 pb-4 pt-6 pr-14 ${isPaymentMode ? 'border-rose-500/20' : 'border-emerald-500/20'}`}>
              <h3 className={`text-xl font-bold flex items-center gap-2 ${isPaymentMode ? 'text-rose-900' : 'text-emerald-900'}`}>
                <FileText className={`w-6 h-6 ${isPaymentMode ? 'text-rose-600' : 'text-emerald-600'}`} />
                {isPaymentMode ? 'سند دفع لعميل' : 'استلام دفعة من عميل'}
              </h3>
              <p className={`text-sm mt-1 ${isPaymentMode ? 'text-rose-800/80' : 'text-emerald-800/80'}`}>
                {isPaymentMode ? 'تسجيل مبلغ مدفوع للعميل من الصندوق وربطه بكشف حسابه.' : 'تسجيل سند قبض وربطه بالعميل الحالي وتخفيض ذمته المدينة.'}
              </p>
            </div>

            <div className="space-y-5 p-6">
              <div className="rounded-xl bg-white/70 p-4 border border-emerald-200/60 shadow-inner">
                <p className="text-xs font-semibold text-slate-500 mb-1">العميل</p>
                <p className="text-lg font-bold text-slate-900">{selectedCustomer?.name ?? '—'}</p>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-slate-700">{isPaymentMode ? `المبلغ المدفوع (${paymentFormCurrency})` : `المبلغ المستلم (${paymentFormCurrency})`}</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                    placeholder="0.00"
                    className={`w-full rounded-lg border bg-white/90 px-3 py-2.5 text-lg font-bold shadow-sm focus:outline-none focus:ring-2 ${
                      isPaymentMode
                        ? 'border-rose-200 text-rose-700 focus:border-rose-400 focus:ring-rose-400/40'
                        : 'border-emerald-200 text-emerald-700 focus:border-emerald-400 focus:ring-emerald-400/40'
                    }`}
                  />
                </div>
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-slate-700">تاريخ القيد</label>
                  <input
                    type="date"
                    value={payDate}
                    onChange={(e) => setPayDate(e.target.value)}
                    className={`w-full rounded-lg border bg-white/90 px-3 py-2.5 shadow-sm focus:outline-none focus:ring-2 ${
                      isPaymentMode
                        ? 'border-rose-200 focus:border-rose-400 focus:ring-rose-400/40'
                        : 'border-emerald-200 focus:border-emerald-400 focus:ring-emerald-400/40'
                    }`}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-slate-700">{isPaymentMode ? 'الصندوق / البنك المصروف منه' : 'الصندوق / البنك المستلم'}</label>
                <div className="relative">
                  <CreditCard className={`pointer-events-none absolute right-3 top-2.5 h-5 w-5 ${isPaymentMode ? 'text-rose-500/70' : 'text-emerald-500/70'}`} />
                  <select
                    value={payCashboxId}
                    onChange={(e) => setPayCashboxId(e.target.value)}
                    className={`w-full rounded-lg border bg-white/90 py-2.5 pr-10 pl-3 shadow-sm focus:outline-none focus:ring-2 ${
                      isPaymentMode
                        ? 'border-rose-200 focus:border-rose-400 focus:ring-rose-400/40'
                        : 'border-emerald-200 focus:border-emerald-400 focus:ring-emerald-400/40'
                    }`}
                  >
                    <option value="">— اختر صندوقاً —</option>
                    {cashboxes.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name} ({b.code}) — {b.currency_code}
                      </option>
                    ))}
                  </select>
                  {cashboxes.length === 0 && (
                    <p className="text-xs text-amber-700 mt-1">لا توجد صناديق من الخادم — أنشئ صندوقاً أولاً.</p>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-slate-700">البيان (اختياري)</label>
                <input
                  type="text"
                  value={payNote}
                  onChange={(e) => setPayNote(e.target.value)}
                  placeholder={isPaymentMode ? 'مثال: سند دفع للعميل أو تسوية مالية...' : 'مثال: دفعة على حساب كشف أو رقم فاتورة...'}
                  className={`w-full rounded-lg border bg-white/90 px-3 py-2.5 shadow-sm focus:outline-none focus:ring-2 ${
                    isPaymentMode
                      ? 'border-rose-200 focus:border-rose-400 focus:ring-rose-400/40'
                      : 'border-emerald-200 focus:border-emerald-400 focus:ring-emerald-400/40'
                  }`}
                />
              </div>

              <div className="flex flex-wrap gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => void submitReceivePayment()}
                  className={`flex-1 min-w-[140px] rounded-xl px-4 py-3 font-semibold text-white shadow-lg transition ${
                    isPaymentMode
                      ? 'bg-rose-600 shadow-rose-700/25 hover:bg-rose-700'
                      : 'bg-emerald-600 shadow-emerald-700/25 hover:bg-emerald-700'
                  }`}
                >
                  حفظ وتسجيل القيد
                </button>
                <button
                  type="button"
                  onClick={closePaymentModal}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-3 font-medium text-slate-700 hover:bg-slate-50"
                >
                  إلغاء
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {batchExportOpen && (
        <BatchStatementExportModal
          type="customer"
          customers={customerOptions}
          invoices={combinedSaleInvoices}
          defaultFromDate={fromDate}
          defaultToDate={toDate}
          hideFinancialColumns={hideFinancialColumns}
          onClose={() => setBatchExportOpen(false)}
        />
      )}
    </div>
  );
};
