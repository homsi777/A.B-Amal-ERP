import React, { useMemo, useState } from 'react';
import { Download, Loader2, Plus, Send, Trash2, X } from 'lucide-react';
import type { Customer, Invoice, Supplier } from '../../types';
import {
  exportPdfFromHtmlString,
  type FabricStatementItem,
  renderCustomerAccountStatementPdfHtml,
  renderCustomerStatementPdfHtml,
  renderSupplierAccountStatementPdfHtml,
  renderSupplierStatementPdfHtml,
  type StatementTotals,
} from '../../lib/pdfExport';
import { buildFabricRowsFromSaleInvoices } from '../../lib/customerStatementFilters';
import { sendTelegramAccountStatementPdf, sendTelegramStatementPdf } from '../../lib/telegramStatement';
import { useToast } from '../NonBlockingToast';
import { getCustomerStatement, getSupplierStatement } from '../../lib/api/partyStatementsApi';
import { loadCustomerSaleInvoiceDetails } from '../../lib/customerStatementInvoiceDetails';

type PartyType = 'customer' | 'supplier';

interface BatchRow {
  id: string;
  partyId: string;
  fromDate: string;
  toDate: string;
}

interface BatchStatementExportModalProps {
  type: PartyType;
  customers?: Customer[];
  suppliers?: Supplier[];
  invoices: Invoice[];
  defaultFromDate: string;
  defaultToDate: string;
  hideFinancialColumns?: boolean;
  onClose: () => void;
}

const todayToken = () => new Date().toISOString().slice(0, 10);

const makeRowId = () => `batch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

const emptyTotals: StatementTotals = {
  itemCount: 0,
  totalRolls: 0,
  totalQuantity: 0,
  totalAmount: 0,
  totalPayments: 0,
  totalRemaining: 0,
};

const totalRows = (items: FabricStatementItem[]): StatementTotals =>
  items.reduce(
    (acc, item) => ({
      itemCount: acc.itemCount + 1,
      totalRolls: acc.totalRolls + item.rollsCount,
      totalQuantity: acc.totalQuantity + item.quantity,
      totalAmount: acc.totalAmount + item.total,
      totalPayments: acc.totalPayments + item.payments,
      totalRemaining: acc.totalRemaining + item.remaining,
    }),
    emptyTotals,
  );

const buildSupplierRows = (
  invoices: Invoice[],
  supplierId: string,
  fromDate: string,
  toDate: string,
): FabricStatementItem[] =>
  invoices
    .filter(
      (invoice) =>
        invoice.type === 'purchase' &&
        invoice.partyId === supplierId &&
        invoice.date >= fromDate &&
        invoice.date <= toDate,
    )
    .flatMap((invoice) => {
      const invoiceTotal = invoice.totalAmount || invoice.items.reduce((sum, item) => sum + item.total, 0);
      return invoice.items.map((item) => {
        const paymentShare = invoiceTotal > 0 ? invoice.paidAmount * (item.total / invoiceTotal) : 0;
        const rollsCount =
          typeof item.rollsCount === 'number' && !Number.isNaN(item.rollsCount) && item.rollsCount >= 0
            ? Math.round(item.rollsCount)
            : 1;

        return {
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
          invoiceRef: invoice.invoiceNumber || invoice.id,
        };
      });
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

const makeSafeFileName = (value: string) =>
  value.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_').slice(0, 90);

export function BatchStatementExportModal({
  type,
  customers = [],
  suppliers = [],
  invoices,
  defaultFromDate,
  defaultToDate,
  hideFinancialColumns = false,
  onClose,
}: BatchStatementExportModalProps) {
  const { showToast } = useToast();
  const parties = type === 'customer' ? customers : suppliers;
  const [rows, setRows] = useState<BatchRow[]>([
    {
      id: makeRowId(),
      partyId: parties[0]?.id || '',
      fromDate: defaultFromDate,
      toDate: defaultToDate,
    },
  ]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  const title = type === 'customer' ? 'تصدير كشوفات عملاء جماعية' : 'تصدير كشوفات موردين جماعية';
  const partyLabel = type === 'customer' ? 'العميل' : 'المورد';

  const prepared = useMemo(
    () =>
      rows.map((row) => {
        const party = parties.find((item) => item.id === row.partyId);
        const fabricItems =
          type === 'customer'
            ? buildFabricRowsFromSaleInvoices(invoices, row.partyId, row.fromDate, row.toDate)
            : buildSupplierRows(invoices, row.partyId, row.fromDate, row.toDate);
        const totals = totalRows(fabricItems);
        return { ...row, party, fabricItems, totals };
      }),
    [rows, parties, type, invoices],
  );

  const updateRow = (id: string, patch: Partial<BatchRow>) => {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  const addRow = () => {
    setRows((current) => [
      ...current,
      {
        id: makeRowId(),
        partyId: parties[0]?.id || '',
        fromDate: defaultFromDate,
        toDate: defaultToDate,
      },
    ]);
  };

  const removeRow = (id: string) => {
    setRows((current) => (current.length === 1 ? current : current.filter((row) => row.id !== id)));
  };

  const buildExport = (item: (typeof prepared)[number]) => {
    if (!item.party || item.fabricItems.length === 0) return null;
    const balanceType = type === 'customer' ? 'مدين' : 'دائن للمورد';
    const partyName = type === 'customer' ? (item.party as Customer).name : (item.party as Supplier).company;
    const fileName = `كشف_حساب_${makeSafeFileName(partyName)}_${item.fromDate}_${item.toDate}.pdf`;
    const common = {
      fromDate: item.fromDate,
      toDate: item.toDate,
      fabricItems: item.fabricItems,
      totals: item.totals,
      balance: { amount: Math.abs(item.totals.totalRemaining), type: balanceType },
      hideFinancialColumns,
    };

    const pdfHtml =
      type === 'customer'
        ? renderCustomerStatementPdfHtml({
            ...common,
            customerName: (item.party as Customer).name,
            customerPhone: (item.party as Customer).phone,
            customerAddress: (item.party as Customer).address,
          })
        : renderSupplierStatementPdfHtml({
            ...common,
            supplierName: (item.party as Supplier).name,
            supplierCompany: (item.party as Supplier).company,
            supplierPhone: (item.party as Supplier).phone,
          });

    return { partyName, fileName, pdfHtml, balanceType };
  };

  const exportBatch = async (sendTelegram: boolean) => {
    const validRows = prepared.filter((item) => item.party && item.fabricItems.length > 0);
    if (!validRows.length) {
      showToast({ type: 'warning', message: 'لا توجد كشوفات قابلة للتصدير ضمن الصفوف المحددة' });
      return;
    }

    setBusy(true);
    try {
      for (let index = 0; index < validRows.length; index += 1) {
        const item = validRows[index];
        if (!item.party) continue;
        const uuidRe =
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        const isUuid = uuidRe.test(item.party.id);

        if (isUuid) {
          setStatus(`${index + 1} / ${validRows.length} - ${type === 'customer' ? (item.party as Customer).name : (item.party as Supplier).company}`);

          const statementRes =
            type === 'customer'
              ? await getCustomerStatement(item.party.id, { fromDate: item.fromDate, toDate: item.toDate })
              : await getSupplierStatement(item.party.id, { fromDate: item.fromDate, toDate: item.toDate });

          const statement = statementRes.data;
          const partyName =
            type === 'customer'
              ? statement.customer?.name || (item.party as Customer).name
              : statement.supplier?.name || (item.party as Supplier).company;

          const invoiceDetails =
            type === 'customer'
              ? await loadCustomerSaleInvoiceDetails(item.party.id, item.fromDate, item.toDate)
              : null;

          const fileName = `كشف_حساب_${makeSafeFileName(partyName)}_${item.fromDate}_${item.toDate}.pdf`;
          const pdfHtml =
            type === 'customer'
              ? renderCustomerAccountStatementPdfHtml({
                  customerName: partyName,
                  customerPhone: statement.customer?.phone ?? null,
                  customerAddress: statement.customer?.address ?? null,
                  fromDate: item.fromDate,
                  toDate: item.toDate,
                  openingBalance: statement.openingBalance,
                  rows: statement.rows,
                  totals: statement.totals,
                  invoiceDetailsBySourceId: invoiceDetails?.invoiceDetailsBySourceId,
                  invoiceDetailsByDocumentNo: invoiceDetails?.invoiceDetailsByDocumentNo,
                  saleInvoices: invoiceDetails?.invoices,
                })
              : renderSupplierAccountStatementPdfHtml({
                  supplierCompany: partyName,
                  supplierName: null,
                  supplierPhone: statement.supplier?.phone ?? null,
                  fromDate: item.fromDate,
                  toDate: item.toDate,
                  openingBalance: statement.openingBalance,
                  rows: statement.rows,
                  totals: statement.totals,
                });

          await exportPdfFromHtmlString(pdfHtml, fileName.replace(/\.pdf$/i, ''), { orientation: 'portrait' });

          if (sendTelegram) {
            const closing = statement.totals.closingBalance;
            const closingLabel =
              type === 'customer' ? (closing >= 0 ? 'مدين' : 'دائن') : closing >= 0 ? 'دائن للمورد' : 'مدين لنا';
            await sendTelegramAccountStatementPdf({
              partyType: type,
              partyId: item.party.id,
              partyName,
              fromDate: item.fromDate,
              toDate: item.toDate,
              openingBalance: statement.openingBalance,
              debitTotal: statement.totals.debit,
              creditTotal: statement.totals.credit,
              closingLabel,
              closingAmount: Math.abs(closing),
              currency: statement.rows[0]?.currency ?? 'USD',
              rowsCount: statement.rows.length,
              pdfHtml,
              fileName,
            });
          }
          continue;
        }

        const exportData = buildExport(item);
        if (!exportData) continue;
        setStatus(`${index + 1} / ${validRows.length} - ${exportData.partyName}`);
        await exportPdfFromHtmlString(exportData.pdfHtml, exportData.fileName.replace(/\.pdf$/i, ''), { orientation: 'landscape' });
        if (sendTelegram) {
          await sendTelegramStatementPdf({
            partyType: type,
            partyId: item.party.id,
            partyName: exportData.partyName,
            fromDate: item.fromDate,
            toDate: item.toDate,
            itemCount: item.totals.itemCount,
            totalAmount: item.totals.totalAmount,
            totalPayments: item.totals.totalPayments,
            balanceLabel: exportData.balanceType,
            balanceAmount: Math.abs(item.totals.totalRemaining),
            pdfHtml: exportData.pdfHtml,
            fileName: exportData.fileName,
          });
        }
      }
      setStatus(sendTelegram ? 'تم التصدير والإرسال إلى تيليغرام' : 'تم التصدير');
    } catch (error) {
      console.error('Batch statement export failed', error);
      showToast({ type: 'error', message: 'تعذر إكمال التصدير الجماعي. راجع إعدادات تيليغرام أو بيانات الكشف.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-6xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h3 className="text-xl font-bold text-slate-900">{title}</h3>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="إغلاق">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-auto p-6">
          <table className="w-full min-w-[820px] text-right text-sm">
            <thead className="bg-slate-800 text-white">
              <tr>
                <th className="px-4 py-3">#</th>
                <th className="px-4 py-3">{partyLabel}</th>
                <th className="px-4 py-3">من تاريخ</th>
                <th className="px-4 py-3">إلى تاريخ</th>
                <th className="px-4 py-3">أسطر الكشف</th>
                <th className="px-4 py-3">الرصيد</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {prepared.map((item, index) => (
                <tr key={item.id} className="bg-white">
                  <td className="px-4 py-3 font-semibold text-slate-500">{index + 1}</td>
                  <td className="px-4 py-3">
                    <select
                      value={item.partyId}
                      onChange={(event) => updateRow(item.id, { partyId: event.target.value })}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      {parties.map((party) => (
                        <option key={party.id} value={party.id}>
                          {type === 'customer' ? (party as Customer).name : `${(party as Supplier).company} - ${(party as Supplier).name}`}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="date"
                      value={item.fromDate}
                      onChange={(event) => updateRow(item.id, { fromDate: event.target.value })}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="date"
                      value={item.toDate}
                      onChange={(event) => updateRow(item.id, { toDate: event.target.value })}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </td>
                  <td className="px-4 py-3 font-semibold text-indigo-700">{item.totals.itemCount}</td>
                  <td className="px-4 py-3 font-semibold text-slate-800">{Math.abs(item.totals.totalRemaining).toLocaleString('ar')}</td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => removeRow(item.id)}
                      disabled={rows.length === 1}
                      className="rounded-lg border border-rose-100 p-2 text-rose-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label="حذف الصف"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-4 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={addRow}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 font-medium text-slate-700 hover:bg-slate-50"
            >
              <Plus className="h-4 w-4" />
              <span>إضافة سطر</span>
            </button>
            {status && <p className="text-sm font-medium text-slate-600">{status}</p>}
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4">
          <button
            type="button"
            onClick={() => exportBatch(false)}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 font-semibold text-slate-700 hover:bg-white/80 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            <span>تصدير PDF</span>
          </button>
          <button
            type="button"
            onClick={() => exportBatch(true)}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            <span>تصدير وإرسال تيليغرام</span>
          </button>
        </div>
      </div>
    </div>
  );
}
