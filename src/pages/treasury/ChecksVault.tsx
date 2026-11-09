import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Search, Loader2, AlertTriangle, Banknote, CheckCircle2, Undo2 } from 'lucide-react';
import {
  listChecks,
  createCheck,
  depositCheck,
  markCheckCleared,
  returnCheck,
  type CheckDto,
  type CheckStatus,
  type CheckSortBy,
} from '../../lib/api/checksApi';
import { listCashboxes, type CashboxDto } from '../../lib/api/cashboxesApi';
import { listCustomers, type ApiCustomer } from '../../lib/api/customersApi';
import { listSuppliers, type ApiSupplier } from '../../lib/api/suppliersApi';
import { ApiRequestError } from '../../lib/api/client';
import { useToast } from '../../components/NonBlockingToast';

const todayStr = () => new Date().toISOString().slice(0, 10);

const STATUS_BADGE: Record<CheckStatus, string> = {
  RECEIVED: 'bg-slate-100 text-slate-700',
  DEPOSITED: 'bg-blue-100 text-blue-700',
  CLEARED: 'bg-emerald-100 text-emerald-700',
  RETURNED: 'bg-rose-100 text-rose-700',
  PAID_OUT: 'bg-violet-100 text-violet-700',
};

type PartyKind = 'CUSTOMER' | 'SUPPLIER' | 'OTHER';

export const ChecksVault: React.FC = () => {
  const { t } = useTranslation('checksVault');
  const { showToast } = useToast();

  const [rows, setRows] = useState<CheckDto[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [cashboxes, setCashboxes] = useState<CashboxDto[]>([]);
  const [customers, setCustomers] = useState<ApiCustomer[]>([]);
  const [suppliers, setSuppliers] = useState<ApiSupplier[]>([]);

  const [status, setStatus] = useState<CheckStatus | ''>('');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<CheckSortBy>('dueDate');

  const [addOpen, setAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [depositingId, setDepositingId] = useState<string | null>(null);
  const [depositBankId, setDepositBankId] = useState('');

  const [form, setForm] = useState({
    checkNo: '', bankName: '', accountHolderName: '',
    partyKind: 'CUSTOMER' as PartyKind, partyId: '', partyName: '',
    amount: '', currencyCode: 'USD', receivedDate: todayStr(), dueDate: '',
  });

  const bankCashboxes = useMemo(() => cashboxes.filter((c) => c.account_kind === 'BANK'), [cashboxes]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listChecks({
        status: status || undefined,
        search: search || undefined,
        sortBy,
        pageSize: 100,
      });
      setRows(res.rows);
      setTotal(res.total);
    } catch (e) {
      showToast({ type: 'error', message: e instanceof ApiRequestError ? e.message : t('loadFailed') });
    } finally {
      setLoading(false);
    }
  }, [status, search, sortBy]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    void (async () => {
      try {
        const [c, cust, sup] = await Promise.all([
          listCashboxes({ active: true }),
          listCustomers({ pageSize: 500 }),
          listSuppliers({ pageSize: 500 }),
        ]);
        setCashboxes(c.data);
        setCustomers(cust.data);
        setSuppliers(sup.data);
      } catch {
        // صامت — الشاشة تعمل بلا هذه القوائم المساعدة إن فشل التحميل
      }
    })();
  }, []);

  const isOverdue = (c: CheckDto) => c.status === 'RECEIVED' && c.due_date < todayStr();
  const isDueSoon = (c: CheckDto) => {
    if (c.status !== 'RECEIVED') return false;
    const due = new Date(c.due_date).getTime();
    const diffDays = (due - Date.now()) / 86400000;
    return diffDays >= 0 && diffDays <= 7;
  };

  const resetForm = () => setForm({
    checkNo: '', bankName: '', accountHolderName: '',
    partyKind: 'CUSTOMER', partyId: '', partyName: '',
    amount: '', currencyCode: 'USD', receivedDate: todayStr(), dueDate: '',
  });

  const submitAdd = async () => {
    if (!form.checkNo.trim() || !form.bankName.trim() || !form.dueDate || !(Number(form.amount) > 0)) {
      showToast({ type: 'warning', message: t('form.incompleteWarning') });
      return;
    }
    setSaving(true);
    try {
      const partyName = form.partyKind === 'CUSTOMER'
        ? customers.find((c) => c.id === form.partyId)?.name || form.partyName.trim()
        : form.partyKind === 'SUPPLIER'
          ? suppliers.find((s) => s.id === form.partyId)?.name || form.partyName.trim()
          : form.partyName.trim();
      await createCheck({
        checkNo: form.checkNo.trim(),
        bankName: form.bankName.trim(),
        accountHolderName: form.accountHolderName.trim() || null,
        partyType: form.partyKind,
        partyId: form.partyKind === 'OTHER' ? null : form.partyId || null,
        partyName: partyName || null,
        amount: Number(form.amount),
        currencyCode: form.currencyCode,
        receivedDate: form.receivedDate,
        dueDate: form.dueDate,
      });
      showToast({ type: 'success', message: t('form.addSuccess') });
      setAddOpen(false);
      resetForm();
      await load();
    } catch (e) {
      showToast({ type: 'error', message: e instanceof ApiRequestError ? e.message : t('form.addFailed') });
    } finally {
      setSaving(false);
    }
  };

  const confirmDeposit = async (checkId: string) => {
    if (!depositBankId) {
      showToast({ type: 'warning', message: t('deposit.selectBankWarning') });
      return;
    }
    try {
      await depositCheck(checkId, depositBankId);
      showToast({ type: 'success', message: t('deposit.success') });
      setDepositingId(null);
      setDepositBankId('');
      await load();
    } catch (e) {
      showToast({ type: 'error', message: e instanceof ApiRequestError ? e.message : t('deposit.failed') });
    }
  };

  const clear = async (checkId: string) => {
    try {
      await markCheckCleared(checkId);
      showToast({ type: 'success', message: t('clear.success') });
      await load();
    } catch (e) {
      showToast({ type: 'error', message: e instanceof ApiRequestError ? e.message : t('clear.failed') });
    }
  };

  const doReturn = async (checkId: string) => {
    if (!window.confirm(t('return.confirmPrompt'))) return;
    try {
      await returnCheck(checkId);
      showToast({ type: 'success', message: t('return.success') });
      await load();
    } catch (e) {
      showToast({ type: 'error', message: e instanceof ApiRequestError ? e.message : t('return.failed') });
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6" dir="rtl">
      <div className="flex justify-between items-end flex-wrap gap-2">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">{t('pageTitle')}</h2>
          <p className="text-slate-500 mt-1">{t('pageSubtitle')}</p>
        </div>
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-indigo-700"
        >
          <Plus className="w-4 h-4" />
          {t('addButton')}
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[180px] space-y-1">
          <label className="text-xs font-bold text-slate-600">{t('filters.status')}</label>
          <select value={status} onChange={(e) => setStatus(e.target.value as CheckStatus | '')} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
            <option value="">{t('filters.statusAll')}</option>
            <option value="RECEIVED">{t('status.RECEIVED')}</option>
            <option value="DEPOSITED">{t('status.DEPOSITED')}</option>
            <option value="CLEARED">{t('status.CLEARED')}</option>
            <option value="RETURNED">{t('status.RETURNED')}</option>
            <option value="PAID_OUT">{t('status.PAID_OUT')}</option>
          </select>
        </div>
        <div className="flex-1 min-w-[180px] space-y-1">
          <label className="text-xs font-bold text-slate-600">{t('filters.sortBy')}</label>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value as CheckSortBy)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
            <option value="dueDate">{t('sort.dueDate')}</option>
            <option value="amountDesc">{t('sort.amountDesc')}</option>
            <option value="amountAsc">{t('sort.amountAsc')}</option>
            <option value="receivedDesc">{t('sort.receivedDesc')}</option>
            <option value="receivedAsc">{t('sort.receivedAsc')}</option>
          </select>
        </div>
        <div className="flex-1 min-w-[220px] space-y-1">
          <label className="text-xs font-bold text-slate-600">{t('filters.search')}</label>
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('filters.searchPlaceholder')}
              className="w-full rounded-lg border border-slate-200 pr-9 pl-3 py-2 text-sm"
            />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="p-3 text-right font-bold">{t('col.checkNo')}</th>
                <th className="p-3 text-right font-bold">{t('col.bank')}</th>
                <th className="p-3 text-right font-bold">{t('col.party')}</th>
                <th className="p-3 text-right font-bold">{t('col.amount')}</th>
                <th className="p-3 text-right font-bold">{t('col.receivedDate')}</th>
                <th className="p-3 text-right font-bold">{t('col.dueDate')}</th>
                <th className="p-3 text-right font-bold">{t('col.status')}</th>
                <th className="p-3 text-right font-bold">{t('col.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={8} className="p-6 text-center text-slate-500"><Loader2 className="w-5 h-5 animate-spin inline ml-2" />{t('loading')}</td></tr>
              )}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={8} className="p-6 text-center text-slate-500">{t('emptyState')}</td></tr>
              )}
              {rows.map((c) => (
                <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="p-3 font-mono font-bold text-slate-700">{c.check_no}</td>
                  <td className="p-3 text-slate-700">{c.bank_name}</td>
                  <td className="p-3 text-slate-700">{c.party_name || c.account_holder_name || '—'}</td>
                  <td className="p-3 font-mono text-slate-800">{Number(c.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })} {c.currency_code}</td>
                  <td className="p-3 text-slate-600 text-xs">{c.received_date}</td>
                  <td className="p-3 text-xs">
                    <span className={isOverdue(c) ? 'text-rose-700 font-bold' : isDueSoon(c) ? 'text-amber-700 font-bold' : 'text-slate-600'}>
                      {c.due_date}
                      {isOverdue(c) && <AlertTriangle className="w-3.5 h-3.5 inline mr-1" />}
                    </span>
                  </td>
                  <td className="p-3">
                    <span className={`inline-block rounded px-2 py-0.5 text-xs font-bold ${STATUS_BADGE[c.status]}`}>
                      {t(`status.${c.status}`)}
                      {isOverdue(c) && <span className="mr-1">· {t('status.overdueTag')}</span>}
                      {isDueSoon(c) && !isOverdue(c) && <span className="mr-1">· {t('status.dueSoonTag')}</span>}
                    </span>
                  </td>
                  <td className="p-3">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {c.status === 'RECEIVED' && (
                        depositingId === c.id ? (
                          <div className="flex items-center gap-1">
                            <select
                              value={depositBankId}
                              onChange={(e) => setDepositBankId(e.target.value)}
                              className="text-xs rounded border border-slate-200 px-1.5 py-1"
                            >
                              <option value="">{t('deposit.chooseBank')}</option>
                              {bankCashboxes.map((b) => (
                                <option key={b.id} value={b.id}>{b.name}</option>
                              ))}
                            </select>
                            <button type="button" onClick={() => void confirmDeposit(c.id)} className="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded border border-blue-100">
                              {t('deposit.confirmButton')}
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => { setDepositingId(c.id); setDepositBankId(bankCashboxes[0]?.id || ''); }}
                            className="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded border border-blue-100 flex items-center gap-1"
                          >
                            <Banknote className="w-3.5 h-3.5" /> {t('deposit.button')}
                          </button>
                        )
                      )}
                      {c.status === 'DEPOSITED' && (
                        <button type="button" onClick={() => void clear(c.id)} className="text-xs bg-emerald-50 text-emerald-700 px-2 py-1 rounded border border-emerald-100 flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" /> {t('clear.button')}
                        </button>
                      )}
                      {(c.status === 'RECEIVED' || c.status === 'DEPOSITED') && (
                        <button type="button" onClick={() => void doReturn(c.id)} className="text-xs bg-rose-50 text-rose-700 px-2 py-1 rounded border border-rose-100 flex items-center gap-1">
                          <Undo2 className="w-3.5 h-3.5" /> {t('return.button')}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 border-t border-slate-200 text-sm text-slate-600">
          {t('totalCount', { count: total })}
        </div>
      </div>

      {addOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6 space-y-3 border border-slate-200 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold">{t('form.title')}</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-sm text-slate-700">{t('form.checkNo')}</label>
                <input value={form.checkNo} onChange={(e) => setForm((f) => ({ ...f, checkNo: e.target.value }))} className="w-full border rounded-lg px-3 py-2" />
              </div>
              <div className="space-y-1">
                <label className="text-sm text-slate-700">{t('form.bankName')}</label>
                <input value={form.bankName} onChange={(e) => setForm((f) => ({ ...f, bankName: e.target.value }))} className="w-full border rounded-lg px-3 py-2" />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-sm text-slate-700">{t('form.accountHolderName')}</label>
              <input value={form.accountHolderName} onChange={(e) => setForm((f) => ({ ...f, accountHolderName: e.target.value }))} className="w-full border rounded-lg px-3 py-2" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-sm text-slate-700">{t('form.partyKind')}</label>
                <select
                  value={form.partyKind}
                  onChange={(e) => setForm((f) => ({ ...f, partyKind: e.target.value as PartyKind, partyId: '', partyName: '' }))}
                  className="w-full border rounded-lg px-3 py-2 bg-white"
                >
                  <option value="CUSTOMER">{t('form.partyKindCustomer')}</option>
                  <option value="SUPPLIER">{t('form.partyKindSupplier')}</option>
                  <option value="OTHER">{t('form.partyKindOther')}</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-sm text-slate-700">{t('form.party')}</label>
                {form.partyKind === 'OTHER' ? (
                  <input value={form.partyName} onChange={(e) => setForm((f) => ({ ...f, partyName: e.target.value }))} className="w-full border rounded-lg px-3 py-2" />
                ) : (
                  <select value={form.partyId} onChange={(e) => setForm((f) => ({ ...f, partyId: e.target.value }))} className="w-full border rounded-lg px-3 py-2 bg-white">
                    <option value="">{t('form.noSelection')}</option>
                    {(form.partyKind === 'CUSTOMER' ? customers : suppliers).map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-sm text-slate-700">{t('form.amount')}</label>
                <input type="number" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} className="w-full border rounded-lg px-3 py-2" />
              </div>
              <div className="space-y-1">
                <label className="text-sm text-slate-700">{t('form.currency')}</label>
                <input value={form.currencyCode} onChange={(e) => setForm((f) => ({ ...f, currencyCode: e.target.value.toUpperCase() }))} className="w-full border rounded-lg px-3 py-2" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-sm text-slate-700">{t('form.receivedDate')}</label>
                <input type="date" value={form.receivedDate} onChange={(e) => setForm((f) => ({ ...f, receivedDate: e.target.value }))} className="w-full border rounded-lg px-3 py-2" />
              </div>
              <div className="space-y-1">
                <label className="text-sm text-slate-700">{t('form.dueDate')}</label>
                <input type="date" value={form.dueDate} onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))} className="w-full border rounded-lg px-3 py-2" />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => { setAddOpen(false); resetForm(); }} className="px-4 py-2 border rounded-lg">{t('cancel')}</button>
              <button type="button" disabled={saving} onClick={() => void submitAdd()} className="px-4 py-2 bg-indigo-600 text-white rounded-lg disabled:opacity-50">
                {saving ? t('saving') : t('save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChecksVault;
