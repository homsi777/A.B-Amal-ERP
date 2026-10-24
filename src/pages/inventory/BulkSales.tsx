import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Pencil, Loader2 } from 'lucide-react';
import { listCustomers, type ApiCustomer } from '../../lib/api/customersApi';
import { listSalesInvoices } from '../../lib/api/salesInvoicesApi';
import {
  createBulkSale,
  listBulkSales,
  updateBulkSale,
  type ApiBulkSale,
} from '../../lib/api/bulkSalesApi';
import { ApiRequestError } from '../../lib/api/client';
import { useToast } from '../../components/NonBlockingToast';

type InvoiceOption = { id: string; invoice_no: string; customer_id: string };

type FormState = {
  customerId: string;
  invoiceId: string;
  saleDate: string;
  notes: string;
};

const emptyForm = (): FormState => ({
  customerId: '',
  invoiceId: '',
  saleDate: new Date().toISOString().slice(0, 10),
  notes: '',
});

export const BulkSales: React.FC = () => {
  const { t } = useTranslation('bulkSales');
  const { showToast } = useToast();
  const [rows, setRows] = useState<ApiBulkSale[]>([]);
  const [customers, setCustomers] = useState<ApiCustomer[]>([]);
  const [invoices, setInvoices] = useState<InvoiceOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(() => emptyForm());
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [list, custRes, invRes] = await Promise.all([
        listBulkSales(),
        listCustomers({ status: 'active', pageSize: 500 }),
        listSalesInvoices({ pageSize: 500 }),
      ]);
      setRows(list);
      setCustomers(custRes.data);
      setInvoices(
        invRes.rows.map((r) => ({
          id: String(r.id),
          invoice_no: String(r.invoice_no ?? ''),
          customer_id: String(r.customer_id ?? ''),
        })),
      );
    } catch (e) {
      showToast({ type: 'error', message: e instanceof ApiRequestError ? e.message : t('loadFailed') });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openNew = () => {
    setEditId(null);
    setForm(emptyForm());
    setFormOpen(true);
  };

  const openEdit = (row: ApiBulkSale) => {
    setEditId(row.id);
    setForm({
      customerId: row.customer_id,
      invoiceId: row.invoice_id,
      saleDate: row.sale_date.slice(0, 10),
      notes: row.notes ?? '',
    });
    setFormOpen(true);
  };

  const submit = async () => {
    if (!form.customerId || !form.invoiceId || !form.saleDate) {
      showToast({ type: 'warning', message: t('requiredFields') });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        customerId: form.customerId,
        invoiceId: form.invoiceId,
        saleDate: form.saleDate,
        notes: form.notes.trim() || null,
      };
      if (editId) await updateBulkSale(editId, payload);
      else await createBulkSale(payload);
      setFormOpen(false);
      await load();
      showToast({ type: 'success', message: editId ? t('updated') : t('created') });
    } catch (e) {
      showToast({ type: 'error', message: e instanceof ApiRequestError ? e.message : t('saveFailed') });
    } finally {
      setSaving(false);
    }
  };

  const invoicesForCustomer = invoices.filter((i) => !form.customerId || i.customer_id === form.customerId);

  return (
    <div className="p-4 space-y-4" dir="rtl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-black text-slate-900">{t('title')}</h2>
          <p className="text-sm text-slate-500">{t('subtitle')}</p>
        </div>
        <button
          type="button"
          onClick={openNew}
          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-700"
        >
          <Plus className="w-4 h-4" />
          {t('newButton')}
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="p-3 text-right font-bold">{t('colCustomer')}</th>
              <th className="p-3 text-right font-bold">{t('colInvoice')}</th>
              <th className="p-3 text-right font-bold">{t('colDate')}</th>
              <th className="p-3 text-right font-bold">{t('colStatus')}</th>
              <th className="p-3 text-right font-bold">{t('colNotes')}</th>
              <th className="p-3 text-right font-bold w-24">{t('colActions')}</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-slate-500">
                  <Loader2 className="w-5 h-5 animate-spin inline ml-2" />
                  {t('loading')}
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-slate-500">{t('emptyState')}</td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-slate-100 hover:bg-slate-50/70">
                <td className="p-3 font-bold text-slate-900">{row.customer_name}</td>
                <td className="p-3 font-mono text-indigo-700" dir="ltr">{row.invoice_no}</td>
                <td className="p-3 text-slate-600">{row.sale_date.slice(0, 10)}</td>
                <td className="p-3">
                  {row.is_used ? (
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">
                      {t('statusUsed')}
                    </span>
                  ) : (
                    <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700">
                      {t('statusAvailable')}
                    </span>
                  )}
                </td>
                <td className="p-3 text-slate-600">{row.notes || '—'}</td>
                <td className="p-3">
                  <button
                    type="button"
                    onClick={() => openEdit(row)}
                    disabled={row.is_used}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-white disabled:opacity-40"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    {t('edit')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" dir="rtl">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full border border-slate-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 bg-indigo-50">
              <h4 className="font-bold text-slate-900">{editId ? t('editTitle') : t('newTitle')}</h4>
            </div>
            <div className="p-5 grid grid-cols-1 gap-3">
              <label className="space-y-1 block">
                <span className="text-xs font-bold text-slate-600">{t('customerLabel')}</span>
                <select
                  value={form.customerId}
                  onChange={(e) => setForm((prev) => ({ ...prev, customerId: e.target.value, invoiceId: '' }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                >
                  <option value="">{t('chooseCustomer')}</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 block">
                <span className="text-xs font-bold text-slate-600">{t('invoiceLabel')}</span>
                <select
                  value={form.invoiceId}
                  onChange={(e) => setForm((prev) => ({ ...prev, invoiceId: e.target.value }))}
                  disabled={!form.customerId}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:opacity-50"
                >
                  <option value="">{t('chooseInvoice')}</option>
                  {invoicesForCustomer.map((i) => (
                    <option key={i.id} value={i.id}>{i.invoice_no}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 block">
                <span className="text-xs font-bold text-slate-600">{t('dateLabel')}</span>
                <input
                  type="date"
                  value={form.saleDate}
                  onChange={(e) => setForm((prev) => ({ ...prev, saleDate: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </label>
              <label className="space-y-1 block">
                <span className="text-xs font-bold text-slate-600">{t('notesLabel')}</span>
                <input
                  value={form.notes}
                  onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </label>
            </div>
            <div className="px-5 py-4 border-t border-slate-200 flex justify-end gap-2 bg-slate-50">
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700"
              >
                {t('cancel')}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void submit()}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {saving ? t('saving') : t('save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BulkSales;
