import React, { useMemo, useState, useEffect } from 'react';
import { useStore } from '../../store/useStore';
import { ArrowUpCircle, Calendar, CreditCard, Download, FileText, Loader2, MessageCircle, Printer, X } from 'lucide-react';
import { format } from 'date-fns';
import {
  exportPdfFromHtmlString,
  exportSupplierStatementToPDF,
  renderSupplierAccountStatementPdfHtml,
  renderSupplierStatementPdfHtml,
} from '../../lib/pdfExport';
import { BatchStatementExportModal } from '../../components/statements/BatchStatementExportModal';
import { A4PreviewModal } from '../../components/printing/A4PreviewModal';
import { BRAND } from '../../branding';
import { sendTelegramAccountStatementPdf, sendTelegramStatementPdf } from '../../lib/telegramStatement';
import { listPurchaseInvoices, getPurchaseInvoice } from '../../lib/api/purchaseInvoicesApi';
import { mapPurchaseInvoiceDetailToInvoice } from '../../lib/invoiceDbMappers';
import { listSuppliers, type ApiSupplier } from '../../lib/api/suppliersApi';
import type { Invoice, Supplier } from '../../types';
import { useToast } from '../../components/NonBlockingToast';
import { listCashboxes, type CashboxDto } from '../../lib/api/cashboxesApi';
import { createVoucher, confirmVoucher } from '../../lib/api/vouchersApi';
import { getSupplierStatement, type PartyStatementData } from '../../lib/api/partyStatementsApi';
import { useNavigate, useSearchParams } from 'react-router-dom';

interface SupplierFabricItem {
  id: string;
  date: string;
  fabricName: string;
  fabricCode: string;
  rollsCount: number;
  quantity: number;
  unit: 'متر' | 'يارد';
  unitPrice: number;
  total: number;
  payments: number;
  remaining: number;
  invoiceRef: string;
}

export const SupplierStatement = () => {
  const { showToast } = useToast();
  const { suppliers, invoices } = useStore();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [dbPurchaseInvoicesFromApi, setDbPurchaseInvoicesFromApi] = useState<Invoice[]>([]);
  const [apiSuppliers, setApiSuppliers] = useState<ApiSupplier[]>([]);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>('');
  const [fromDate, setFromDate] = useState<string>(() => format(new Date(new Date().getFullYear(), new Date().getMonth(), 1), 'yyyy-MM-dd'));
  const [toDate, setToDate] = useState<string>(() => format(new Date(), 'yyyy-MM-dd'));
  const [dateAutoRange, setDateAutoRange] = useState(true);
  const [hideFinancialColumns, setHideFinancialColumns] = useState(false);
  const [batchExportOpen, setBatchExportOpen] = useState(false);
  const [printPreviewOpen, setPrintPreviewOpen] = useState(false);
  const [supplierDuesExporting, setSupplierDuesExporting] = useState(false);

  const [paymentOutOpen, setPaymentOutOpen] = useState(false);
  const [payOutAmount, setPayOutAmount] = useState('');
  const [payOutDate, setPayOutDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [payOutNote, setPayOutNote] = useState('');
  const [cashboxes, setCashboxes] = useState<CashboxDto[]>([]);
  const [payCashboxId, setPayCashboxId] = useState('');
  const [statementRefreshTick, setStatementRefreshTick] = useState(0);
  const [accountStatement, setAccountStatement] = useState<PartyStatementData | null>(null);
  const [accountStatementLoading, setAccountStatementLoading] = useState(false);
  const [accountStatementError, setAccountStatementError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await listSuppliers({ status: 'active', pageSize: 1000 });
        if (cancelled) return;
        setApiSuppliers(res.data);
      } catch {
        if (!cancelled) setApiSuppliers([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  type SupplierWithCreatedAt = Supplier & { created_at?: string };
  const supplierOptions = useMemo<SupplierWithCreatedAt[]>(() => {
    const apiMapped: SupplierWithCreatedAt[] = apiSuppliers.map((s) => ({
      id: s.id,
      name: s.name,
      phone: s.phone,
      company: s.name,
      balance: 0,
      created_at: s.created_at,
    }));
    if (!apiMapped.length) return suppliers as SupplierWithCreatedAt[];
    const seen = new Set<string>();
    const merged = [...apiMapped, ...(suppliers as SupplierWithCreatedAt[])].filter((s) => {
      if (seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    });
    return merged;
  }, [apiSuppliers, suppliers]);

  useEffect(() => {
    if (selectedSupplierId && supplierOptions.some((s) => s.id === selectedSupplierId)) return;
    if (selectedSupplierId === '') return;
    setSelectedSupplierId(supplierOptions[0]?.id || '');
  }, [supplierOptions, selectedSupplierId]);

  useEffect(() => {
    const requestedSupplierId = searchParams.get('supplierId');
    if (!requestedSupplierId) return;
    if (!supplierOptions.some((s) => s.id === requestedSupplierId)) return;
    setSelectedSupplierId(requestedSupplierId);
  }, [searchParams, supplierOptions]);

  useEffect(() => {
    if (!dateAutoRange) return;
    if (!selectedSupplierId) return;
    const s = supplierOptions.find((x) => x.id === selectedSupplierId);
    if (!s) return;
    const createdAt = String((s as SupplierWithCreatedAt).created_at || '').slice(0, 10);
    const safeCreated = /^\d{4}-\d{2}-\d{2}$/.test(createdAt)
      ? createdAt
      : format(new Date(new Date().getFullYear(), 0, 1), 'yyyy-MM-dd');
    setFromDate(safeCreated);
    setToDate(format(new Date(), 'yyyy-MM-dd'));
  }, [dateAutoRange, selectedSupplierId, supplierOptions]);

  const selectedSupplier = supplierOptions.find((supplier) => supplier.id === selectedSupplierId);

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
        if (!cancelled) setCashboxes([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedSupplierId || !isUuid(selectedSupplierId)) {
      setDbPurchaseInvoicesFromApi([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const list = await listPurchaseInvoices({
          supplierId: selectedSupplierId,
          dateFrom: fromDate,
          dateTo: toDate,
          pageSize: 500,
          documentStatus: 'CONFIRMED',
        });
        const details = await Promise.all(
          list.rows.map((row) => getPurchaseInvoice(String((row as Record<string, unknown>).id))),
        );
        if (cancelled) return;
        setDbPurchaseInvoicesFromApi(details.map((d) => mapPurchaseInvoiceDetailToInvoice(d.data)));
      } catch {
        if (!cancelled) setDbPurchaseInvoicesFromApi([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedSupplierId, fromDate, toDate]);

  useEffect(() => {
    if (!selectedSupplierId || !isUuid(selectedSupplierId)) {
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
        const res = await getSupplierStatement(selectedSupplierId, { fromDate, toDate });
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
  }, [selectedSupplierId, fromDate, toDate, statementRefreshTick]);

  const legacyLocalPurchaseInvoices = useMemo(
    () =>
      invoices.filter((i) => {
        if (i.type !== 'purchase') return false;
        return !isUuid(i.id);
      }),
    [invoices],
  );

  const combinedPurchaseInvoices = useMemo(
    () => [...dbPurchaseInvoicesFromApi, ...legacyLocalPurchaseInvoices],
    [dbPurchaseInvoicesFromApi, legacyLocalPurchaseInvoices],
  );

  const actualFabricItems = useMemo<SupplierFabricItem[]>(() => {
    if (!selectedSupplierId) return [];

    return combinedPurchaseInvoices
      .filter((invoice) =>
        invoice.type === 'purchase' &&
        invoice.partyId === selectedSupplierId &&
        invoice.date >= fromDate &&
        invoice.date <= toDate
      )
      .flatMap((invoice) => {
        const invoiceTotal = invoice.totalAmount || invoice.items.reduce((sum, item) => sum + item.total, 0);

        return invoice.items.map((item, index) => {
          const paymentShare = invoiceTotal > 0 ? invoice.paidAmount * (item.total / invoiceTotal) : 0;
          const rollsCount =
            typeof item.rollsCount === 'number' && !Number.isNaN(item.rollsCount) && item.rollsCount >= 0
              ? Math.round(item.rollsCount)
              : 1;

          return {
            id: `${invoice.id}-${index}`,
            date: invoice.date,
            fabricName: item.fabricName || item.materialName || item.designName || item.fabricId,
            fabricCode: item.designCode || item.colorCode || item.fabricId,
            rollsCount,
            quantity: item.quantity,
            unit: item.unitType === 'meter' ? 'متر' : 'يارد',
            unitPrice: item.unitPrice,
            total: item.total,
            payments: paymentShare,
            remaining: item.total - paymentShare,
            invoiceRef: invoice.invoiceNumber || invoice.id
          };
        });
      })
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [selectedSupplierId, fromDate, toDate, combinedPurchaseInvoices]);

  const visibleItems = actualFabricItems;

  const totals = useMemo(() => {
    return visibleItems.reduce(
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
  }, [visibleItems]);

  const balance = totals.totalRemaining >= 0
    ? { amount: totals.totalRemaining, type: 'دائن للمورد' as const, color: 'rose' }
    : { amount: Math.abs(totals.totalRemaining), type: 'مدين لنا' as const, color: 'emerald' };

  const handleExportPDF = async () => {
    try {
      if (accountStatement?.supplier) {
        const pdfHtml = renderSupplierAccountStatementPdfHtml({
          supplierCompany: accountStatement.supplier.name,
          supplierName: null,
          supplierPhone: accountStatement.supplier.phone ?? null,
          fromDate,
          toDate,
          openingBalance: accountStatement.openingBalance,
          rows: accountStatement.rows,
          totals: accountStatement.totals,
        });
        await exportPdfFromHtmlString(pdfHtml, `كشف_حساب_${accountStatement.supplier.name}_${fromDate}_${toDate}`, {
          orientation: 'portrait',
        });
        return;
      }

      if (!selectedSupplier || visibleItems.length === 0) {
        showToast({ type: 'warning', message: 'الرجاء تحميل بيانات الكشف أو اختيار مورد لديه فواتير شراء ضمن الفترة' });
        return;
      }
      await exportSupplierStatementToPDF({
        supplierName: selectedSupplier.name,
        supplierCompany: selectedSupplier.company,
        supplierPhone: selectedSupplier.phone,
        fromDate,
        toDate,
        fabricItems: visibleItems,
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
    if (accountStatement?.supplier) {
      return renderSupplierAccountStatementPdfHtml({
        supplierCompany: accountStatement.supplier.name,
        supplierName: null,
        supplierPhone: accountStatement.supplier.phone ?? null,
        fromDate,
        toDate,
        openingBalance: accountStatement.openingBalance,
        rows: accountStatement.rows,
        totals: accountStatement.totals,
      });
    }
    if (!selectedSupplier) return '';
    return renderSupplierStatementPdfHtml({
      supplierName: selectedSupplier.name,
      supplierCompany: selectedSupplier.company,
      supplierPhone: selectedSupplier.phone,
      fromDate,
      toDate,
      fabricItems: visibleItems,
      totals,
      balance: { amount: balance.amount, type: balance.type },
      hideFinancialColumns,
    });
  };

  const statementPrintFileName = `كشف_حساب_${selectedSupplier?.company || selectedSupplier?.name || accountStatement?.supplier?.name || 'مورد'}_${fromDate}_${toDate}.pdf`;

  const formatDuesMoney = (value: number) =>
    Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const escapeDuesHtml = (value: unknown) =>
    String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');

  const renderSupplierDuesPdfHtml = (
    rows: Array<{
      code: string;
      name: string;
      total: number;
      credit: number;
      debit: number;
      remaining: number;
      balance: number;
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
        <title>كشف ذمم الموردين</title>
        <style>
          @page { size: A4; margin: 10mm; }
          body { font-family: Arial, Tahoma, sans-serif; color: #0f172a; font-size: 12px; }
          .head { text-align:center; border-bottom:2px solid #1e293b; padding-bottom:8px; margin-bottom:10px; }
          .logo { height:100px; width:auto; max-width:220px; object-fit:contain; display:block; margin:0 auto 4px; }
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
          <div>${escapeDuesHtml(BRAND.descriptionAr)}</div>
        </div>
        <div class="title">كشف ذمم الموردين</div>
        <div class="meta">
          <div>عدد الموردين: ${rows.length}</div>
          <div>تاريخ التذكير: ${escapeDuesHtml(toDate)}</div>
        </div>
        <table class="summary">
          <thead>
            <tr>
              <th>العملة</th>
              <th>عدد الموردين</th>
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
                    <td class="num">${formatDuesMoney(Math.abs(total.balance))} ${total.balance >= 0 ? 'دائن للمورد' : 'مدين لنا'}</td>
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
              <th>اسم المورد</th>
              <th>مجموع</th>
              <th>دائن</th>
              <th>مدين</th>
              <th>متبقي</th>
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
                      <td>${escapeDuesHtml(row.currency)}</td>
                      <td class="note">${escapeDuesHtml(row.notes || '')}</td>
                    </tr>
                  `,
                )
                .join('') || '<tr><td colspan="8" style="text-align:center;">لا توجد بيانات</td></tr>'
            }
          </tbody>
        </table>
      </body>
    </html>
  `;
  };

  const handleExportSupplierDuesPDF = async () => {
    setSupplierDuesExporting(true);
    try {
      const res = await listSuppliers({ status: 'active', page: 1, pageSize: 1000 });
      const rows = await Promise.all(
        res.data.map(async (supplier) => {
          try {
            const statementRes = await getSupplierStatement(supplier.id, { toDate });
            const statement = statementRes.data;
            const debit = Number(statement.totals.debit || 0);
            const credit = Number(statement.totals.credit || 0);
            return {
              code: supplier.code,
              name: supplier.name,
              total: debit + credit,
              credit,
              debit,
              remaining: Math.abs(Number(statement.totals.closingBalance || 0)),
              balance: Number(statement.totals.closingBalance || 0),
              currency: String(statement.rows[0]?.currency || 'USD'),
              notes: supplier.notes,
            };
          } catch {
            return {
              code: supplier.code,
              name: supplier.name,
              total: 0,
              credit: 0,
              debit: 0,
              remaining: 0,
              balance: 0,
              currency: 'USD',
              notes: supplier.notes,
            };
          }
        }),
      );
      await exportPdfFromHtmlString(renderSupplierDuesPdfHtml(rows), `ذمم_الموردين_${toDate}`, { orientation: 'portrait' });
      showToast({ type: 'success', message: 'تم تصدير ذمم الموردين PDF بنجاح.' });
    } catch (error) {
      showToast({ type: 'error', message: error instanceof Error ? error.message : 'تعذر تصدير ذمم الموردين PDF.' });
    } finally {
      setSupplierDuesExporting(false);
    }
  };

  const handleShareWhatsApp = () => {
    if (!selectedSupplier || visibleItems.length === 0) {
      showToast({ type: 'warning', message: 'الرجاء تحميل بيانات الكشف أولاً' });
      return;
    }

    const message = [
      `كشف حساب مورد: ${selectedSupplier.company}`,
      `ممثل المورد: ${selectedSupplier.name}`,
      `الفترة: من ${fromDate} إلى ${toDate}`,
      `عدد الخامات (أسطر الكشف): ${totals.itemCount}`,
      `مجموع الأتواب: ${totals.totalRolls.toLocaleString('ar')}`,
      `مجموع الكميات/الأطوال: ${totals.totalQuantity.toLocaleString('ar')}`,
      `إجمالي المشتريات: ${totals.totalAmount.toLocaleString('ar')}`,
      `إجمالي السداد: ${totals.totalPayments.toLocaleString('ar')}`,
      `الرصيد ${balance.type}: ${balance.amount.toLocaleString('ar')}`,
      `تم إنشاء الكشف من ${BRAND.name} — ${BRAND.tagline} (${BRAND.descriptionAr}).`
    ].join('\n');

    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer');
  };

  const resetPaymentOutModal = () => {
    setPaymentOutOpen(false);
    setPayOutAmount('');
    setPayOutNote('');
    setPayOutDate(new Date().toISOString().split('T')[0]);
    const def = cashboxes.find((b) => b.is_default) ?? cashboxes[0];
    setPayCashboxId(def?.id ?? '');
  };

  const handleSendTelegram = async () => {
    try {
      if (accountStatement?.supplier) {
        const closing = accountStatement.totals.closingBalance;
        const closingLabel = closing >= 0 ? 'دائن للمورد' : 'مدين لنا';
        const pdfHtml = renderSupplierAccountStatementPdfHtml({
          supplierCompany: accountStatement.supplier.name,
          supplierName: null,
          supplierPhone: accountStatement.supplier.phone ?? null,
          fromDate,
          toDate,
          openingBalance: accountStatement.openingBalance,
          rows: accountStatement.rows,
          totals: accountStatement.totals,
        });
        await sendTelegramAccountStatementPdf({
          partyType: 'supplier',
          partyId: accountStatement.supplier.id,
          partyName: accountStatement.supplier.name,
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
          fileName: `supplier-account-statement-${accountStatement.supplier.id}-${fromDate}-${toDate}.pdf`,
        });
        showToast({ type: 'success', message: 'تم إرسال كشف الحساب إلى تيليغرام.' });
        return;
      }

      if (!selectedSupplier || visibleItems.length === 0) {
        showToast({ type: 'warning', message: 'الرجاء تحميل بيانات الكشف أولاً' });
        return;
      }
      const pdfHtml = renderSupplierStatementPdfHtml({
        supplierName: selectedSupplier.name,
        supplierCompany: selectedSupplier.company,
        supplierPhone: selectedSupplier.phone,
        fromDate,
        toDate,
        fabricItems: visibleItems,
        totals,
        balance: { amount: balance.amount, type: balance.type },
        hideFinancialColumns,
      });
      await sendTelegramStatementPdf({
        partyType: 'supplier',
        partyId: selectedSupplier.id,
        partyName: selectedSupplier.company || selectedSupplier.name,
        fromDate,
        toDate,
        itemCount: totals.itemCount,
        totalAmount: totals.totalAmount,
        totalPayments: totals.totalPayments,
        balanceLabel: balance.type,
        balanceAmount: balance.amount,
        pdfHtml,
        fileName: `supplier-statement-${selectedSupplier.id}-${fromDate}-${toDate}.pdf`,
      });
      showToast({ type: 'success', message: 'تم إرسال كشف الحساب إلى تيليغرام.' });
    } catch (error) {
      showToast({ type: 'error', message: error instanceof Error ? error.message : 'تعذر إرسال كشف الحساب إلى تيليغرام' });
    }
  };

  const submitSupplierPaymentOut = async () => {
    if (!selectedSupplierId) {
      showToast({ type: 'warning', message: 'اختر مورداً أولاً' });
      return;
    }
    const amount = Number(String(payOutAmount).replace(/,/g, ''));
    if (!amount || Number.isNaN(amount) || amount <= 0) {
      showToast({ type: 'warning', message: 'أدخل مبلغاً صحيحاً أكبر من صفر' });
      return;
    }
    if (!isUuid(selectedSupplierId)) {
      showToast({ type: 'warning', message: 'لا يمكن تسجيل السند إلا لموردين مسجلين على الخادم (معرّف UUID).' });
      return;
    }
    if (!payCashboxId || !isUuid(payCashboxId)) {
      showToast({ type: 'warning', message: 'اختر صندوقاً مرتبطاً بالخادم لتسجيل السند في الخزينة.' });
      return;
    }
    const cur = cashboxes.find((x) => x.id === payCashboxId)?.currency_code ?? 'USD';
    const descParts = [payOutNote.trim(), 'من كشف حساب مورد'].filter(Boolean);
    try {
      const created = await createVoucher({
        voucherType: 'PAYMENT',
        voucherDate: payOutDate,
        cashboxId: payCashboxId,
        partyType: 'SUPPLIER',
        partyId: selectedSupplierId,
        partyName: selectedSupplier?.company || selectedSupplier?.name || 'مورد',
        amount,
        currencyCode: cur,
        description: descParts.length ? descParts.join(' — ') : null,
      });
      await confirmVoucher(created.data.id);
      showToast({ type: 'success', message: 'تم تسجيل سند الدفع وتأكيده في الصندوق على الخادم.' });
      setStatementRefreshTick((n) => n + 1);
      resetPaymentOutModal();
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : 'تعذر إنشاء أو تأكيد السند' });
    }
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
         <div className="flex flex-col lg:flex-row lg:justify-between lg:items-end gap-4">
         <div>
           <h2 className="text-2xl font-bold text-slate-900">كشف حساب مورد</h2>
           <p className="text-slate-500 mt-1">عرض الخامات والأطوال التي اشترتها الشركة من المورد مع السداد والرصيد المتبقي</p>
         </div>
         <div className="flex flex-wrap gap-2">
           <button className="bg-indigo-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-indigo-700 transition shadow-sm font-medium" onClick={() => setPrintPreviewOpen(true)}>
             <Printer className="w-4 h-4" />
             <span>طباعة / PDF</span>
           </button>
           <button
             type="button"
             disabled={supplierDuesExporting}
             className="bg-white border border-slate-200 text-slate-800 px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-slate-50 transition shadow-sm font-medium disabled:opacity-60"
             onClick={() => void handleExportSupplierDuesPDF()}
           >
             {supplierDuesExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
             <span>تصدير ذمم موردين PDF</span>
           </button>
           <button
             type="button"
             className="bg-white border border-rose-200 text-rose-700 px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-rose-50 transition shadow-sm font-medium"
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
             onClick={() => setPaymentOutOpen(true)}
             className="bg-gradient-to-r from-rose-500/20 to-rose-500/0 px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-rose-500/30 transition shadow-sm font-medium border border-rose-500/50 text-rose-600"
           >
             <ArrowUpCircle className="w-4 h-4 shrink-0" />
             <span>سند دفع</span>
           </button>
         </div>
       </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-wrap lg:flex-nowrap items-end gap-3">
          <div className="space-y-1 w-full lg:w-auto lg:flex-1 min-w-[220px]">
            <label className="block text-xs font-bold text-slate-600">اختر المورد</label>
            <select
              value={selectedSupplierId}
              onChange={(event) => {
                setDateAutoRange(true);
                setSelectedSupplierId(event.target.value);
              }}
              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm text-sm"
            >
              <option value="">— اختر المورد —</option>
              {supplierOptions.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>{supplier.name} ({supplier.company})</option>
              ))}
            </select>
          </div>
          <div className="space-y-1 w-full lg:w-auto min-w-[200px]">
            <label className="block text-xs font-bold text-slate-600">تاريخ من</label>
            <div className="relative">
              <Calendar className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
              <input
                type="date"
                value={fromDate}
                onChange={(event) => {
                  setDateAutoRange(false);
                  setFromDate(event.target.value);
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
                onChange={(event) => {
                  setDateAutoRange(false);
                  setToDate(event.target.value);
                }}
                className="w-full pr-9 pl-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm text-slate-700 text-sm"
              />
            </div>
          </div>
        </div>

        {selectedSupplier && (
          <>
            <div className="p-6 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 bg-rose-100 rounded-full flex items-center justify-center text-rose-600">
                  <FileText className="w-8 h-8" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-slate-900">{selectedSupplier.company}</h3>
                  <p className="text-slate-500">ممثل الشركة: {selectedSupplier.name} | رقم الاتصال: {selectedSupplier.phone}</p>
                </div>
              </div>

              {!hideFinancialColumns && <div className="text-left">
                <p className="text-sm text-slate-500 mb-1">الرصيد النهائي للمشتريات</p>
                <p className={`text-3xl font-bold ${balance.color === 'rose' ? 'text-rose-600' : 'text-emerald-600'}`}>
                  {balance.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  <span className="text-sm font-normal text-slate-500 mx-1">$</span>
                  <span className={`text-xs ${balance.color === 'rose' ? 'text-rose-600' : 'text-emerald-600'}`}>({balance.type})</span>
                </p>
              </div>}
            </div>

            {visibleItems.length > 0 && (
              <div className="p-6 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-rose-50">
                <h4 className="text-lg font-bold text-slate-900 mb-4">ملخص الكشف</h4>
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
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">إجمالي المشتريات</p>
                    <p className="text-2xl font-bold text-rose-600">{totals.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 0 })}</p>
                  </div>}
                  {!hideFinancialColumns && <div className="bg-white rounded-lg p-4 border border-slate-200 shadow-sm hover:shadow-md transition">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">إجمالي السداد</p>
                    <p className="text-2xl font-bold text-emerald-600">{totals.totalPayments.toLocaleString(undefined, { minimumFractionDigits: 0 })}</p>
                  </div>}
                  {!hideFinancialColumns && <div className={`bg-white rounded-lg p-4 border-2 shadow-sm hover:shadow-md transition ${balance.color === 'rose' ? 'border-rose-300 bg-rose-50' : 'border-emerald-300 bg-emerald-50'}`}>
                    <p className={`text-xs font-semibold uppercase tracking-wide mb-2 ${balance.color === 'rose' ? 'text-rose-600' : 'text-emerald-600'}`}>الرصيد ({balance.type})</p>
                    <p className={`text-2xl font-bold ${balance.color === 'rose' ? 'text-rose-600' : 'text-emerald-600'}`}>{balance.amount.toLocaleString(undefined, { minimumFractionDigits: 0 })}</p>
                  </div>}
                </div>
              </div>
            )}
          </>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-800 text-slate-100 font-medium">
              <tr>
                <th className="px-4 py-4 whitespace-nowrap">التاريخ</th>
                <th className="px-4 py-4 whitespace-nowrap">المرجع</th>
                <th className="px-4 py-4 whitespace-nowrap">اسم الخامة</th>
                <th className="px-4 py-4 whitespace-nowrap">كود الخامة</th>
                <th className="px-4 py-4 whitespace-nowrap">عدد الأتواب</th>
                <th className="px-4 py-4 whitespace-nowrap">الكمية / الطول</th>
                <th className="px-4 py-4 whitespace-nowrap">الوحدة</th>
                {!hideFinancialColumns && <th className="px-4 py-4 whitespace-nowrap">السعر الواحد</th>}
                {!hideFinancialColumns && <th className="px-4 py-4 whitespace-nowrap">المجموع</th>}
                {!hideFinancialColumns && <th className="px-4 py-4 whitespace-nowrap">السداد</th>}
                {!hideFinancialColumns && <th className="px-4 py-4 whitespace-nowrap">الباقي للمورد</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleItems.length === 0 ? (
                <tr>
                  <td colSpan={hideFinancialColumns ? 7 : 11} className="px-4 py-8 text-center text-slate-500 bg-white">
                    لا توجد مشتريات خامات ضمن فترة الكشف — سجّل فواتير شراء لهذا المورد في النظام المحلي أو وسّع نطاق التواريخ.
                  </td>
                </tr>
              ) : (
                visibleItems.map((item) => (
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
                  <th className="px-4 py-3">مدين (USD)</th>
                  <th className="px-4 py-3">دائن (USD)</th>
                  <th className="px-4 py-3">الرصيد (USD)</th>
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
                  accountStatement.rows.map((row) => (
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
                      <td className="px-4 py-3 font-mono text-blue-700">
                        {row.debit.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-3 font-mono text-emerald-700">
                        {row.credit.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-900">
                        {row.balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {accountStatement && (
            <div className="px-4 py-3 border-t border-slate-200 bg-white text-xs text-slate-600 flex flex-wrap gap-4">
              <span>الرصيد الافتتاحي (USD): {accountStatement.openingBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
              <span>إجمالي المدين (USD): {accountStatement.totals.debit.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
              <span>إجمالي الدائن (USD): {accountStatement.totals.credit.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
              <span>الرصيد النهائي (USD): {accountStatement.totals.closingBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
            </div>
          )}
        </div>
      </div>

      {paymentOutOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-[2px]" role="dialog" aria-modal="true">
          <div className="relative w-full max-w-lg rounded-2xl border border-rose-400/50 bg-gradient-to-br from-rose-500/20 via-white to-rose-400/[0.07] shadow-2xl shadow-rose-900/10 ring-1 ring-rose-500/20">
            <button
              type="button"
              onClick={resetPaymentOutModal}
              className="absolute left-4 top-4 rounded-lg p-1.5 text-slate-500 hover:bg-white/80 hover:text-slate-800 transition"
              aria-label="إغلاق"
            >
              <X className="w-5 h-5" />
            </button>
            <div className="border-b border-rose-500/20 px-6 pb-4 pt-6 pr-14">
              <h3 className="text-xl font-bold text-rose-900 flex items-center gap-2">
                <FileText className="w-6 h-6 text-rose-600" />
                سند دفع لمورد
              </h3>
              <p className="text-sm text-rose-800/80 mt-1">تسجيل مبلغ دفعناه للمورد لتسوية جزء من ذمتنا الدائنة.</p>
            </div>
            <div className="space-y-5 p-6">
              <div className="rounded-xl bg-white/70 p-4 border border-rose-200/60 shadow-inner">
                <p className="text-xs font-semibold text-slate-500 mb-1">المورد</p>
                <p className="text-lg font-bold text-slate-900">{selectedSupplier?.company ?? '—'}</p>
                <p className="text-sm text-slate-600">{selectedSupplier?.name}</p>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-slate-700">المبلغ المدفوع ($)</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={payOutAmount}
                    onChange={(e) => setPayOutAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full rounded-lg border border-rose-200 bg-white/90 px-3 py-2.5 text-lg font-bold text-rose-700 shadow-sm focus:border-rose-400 focus:outline-none focus:ring-2 focus:ring-rose-400/40"
                  />
                </div>
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-slate-700">تاريخ القيد</label>
                  <input
                    type="date"
                    value={payOutDate}
                    onChange={(e) => setPayOutDate(e.target.value)}
                    className="w-full rounded-lg border border-rose-200 bg-white/90 px-3 py-2.5 shadow-sm focus:border-rose-400 focus:outline-none focus:ring-2 focus:ring-rose-400/40"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-slate-700">الصندوق / البنك المصروف منه</label>
                <div className="relative">
                  <CreditCard className="pointer-events-none absolute right-3 top-2.5 h-5 w-5 text-rose-500/70" />
                  <select
                    value={payCashboxId}
                    onChange={(e) => setPayCashboxId(e.target.value)}
                    className="w-full rounded-lg border border-rose-200 bg-white/90 py-2.5 pr-10 pl-3 shadow-sm focus:border-rose-400 focus:outline-none focus:ring-2 focus:ring-rose-400/40"
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
                  value={payOutNote}
                  onChange={(e) => setPayOutNote(e.target.value)}
                  placeholder="سبب الدفع أو رقم فاتورة الشراء..."
                  className="w-full rounded-lg border border-rose-200 bg-white/90 px-3 py-2.5 shadow-sm focus:border-rose-400 focus:outline-none focus:ring-2 focus:ring-rose-400/40"
                />
              </div>
              <div className="flex flex-wrap gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => void submitSupplierPaymentOut()}
                  className="flex-1 min-w-[140px] rounded-xl bg-rose-600 px-4 py-3 font-semibold text-white shadow-lg shadow-rose-700/25 transition hover:bg-rose-700"
                >
                  حفظ وتسجيل القيد
                </button>
                <button
                  type="button"
                  onClick={resetPaymentOutModal}
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
          type="supplier"
          suppliers={supplierOptions}
          invoices={combinedPurchaseInvoices}
          defaultFromDate={fromDate}
          defaultToDate={toDate}
          hideFinancialColumns={hideFinancialColumns}
          onClose={() => setBatchExportOpen(false)}
        />
      )}
    </div>
  );
};
