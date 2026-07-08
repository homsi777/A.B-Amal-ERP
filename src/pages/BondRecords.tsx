import React, { useCallback, useEffect, useState } from 'react';
import { Search, Filter, ArrowUpRight, ArrowDownRight, Loader2, Printer, X } from 'lucide-react';
import { listVouchers, type VoucherRow, type VoucherStatus, type VoucherType } from '../lib/api/vouchersApi';
import { ApiRequestError } from '../lib/api/client';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../components/NonBlockingToast';
import { TelegramSendButton } from '../components/telegram/TelegramSendButton';
import { sendTelegramVoucherFromRow } from '../lib/telegramVoucher';
import { VoucherPrintModal } from '../components/VoucherPrintModal';
import { voucherPurposeAr, VOUCHER_PURPOSES, type VoucherPurpose } from '../lib/voucherPurpose';

type TypeFilter = '' | VoucherType;
type StatusFilter = '' | VoucherStatus;
type PurposeFilter = '' | VoucherPurpose;
type PartyFilter = '' | 'CUSTOMER' | 'SUPPLIER' | 'OTHER';

function typeLabel(t: string) {
  return t === 'RECEIPT' ? 'قبض' : 'صرف';
}

function statusLabel(s: string) {
  if (s === 'DRAFT') return 'مسودة';
  if (s === 'CONFIRMED') return 'مُرحل';
  if (s === 'CANCELLED') return 'ملغى';
  return s;
}

function formatVoucherDate(value: string) {
  if (!value) return '—';
  return String(value).split('T')[0];
}

export const BondRecords = () => {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [bonds, setBonds] = useState<VoucherRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [telegramBusyId, setTelegramBusyId] = useState<string | null>(null);
  const [printVoucher, setPrintVoucher] = useState<VoucherRow | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');

  const [typeFilter, setTypeFilter] = useState<TypeFilter>('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('');
  const [purposeFilter, setPurposeFilter] = useState<PurposeFilter>('');
  const [partyFilter, setPartyFilter] = useState<PartyFilter>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  useEffect(() => {
    const t = window.setTimeout(() => setSearchDebounced(searchTerm.trim()), 300);
    return () => window.clearTimeout(t);
  }, [searchTerm]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listVouchers({
        pageSize: 200,
        search: searchDebounced || undefined,
        type: typeFilter || undefined,
        status: statusFilter || undefined,
        partyType: partyFilter || undefined,
        purpose: purposeFilter || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      });
      setBonds(res.data);
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : 'تعذر تحميل السندات');
    } finally {
      setLoading(false);
    }
  }, [searchDebounced, typeFilter, statusFilter, purposeFilter, partyFilter, dateFrom, dateTo]);

  useEffect(() => {
    void load();
  }, [load]);

  const clearAdvanced = () => {
    setStatusFilter('');
    setPurposeFilter('');
    setPartyFilter('');
    setDateFrom('');
    setDateTo('');
  };

  const activeAdvancedCount = [statusFilter, purposeFilter, partyFilter, dateFrom, dateTo].filter(Boolean).length;

  const handleSendTelegram = async (bond: VoucherRow) => {
    setTelegramBusyId(bond.id);
    try {
      await sendTelegramVoucherFromRow(bond);
      showToast({ type: 'success', message: 'تم إرسال السند إلى تيليغرام.' });
    } catch (e) {
      showToast({
        type: 'error',
        message: e instanceof Error ? e.message : 'تعذر إرسال السند إلى تيليغرام',
      });
    } finally {
      setTelegramBusyId(null);
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">سجل السندات</h2>
          <p className="text-slate-500 mt-1">سندات القبض والصرف من قاعدة البيانات</p>
        </div>
      </div>

      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-800 px-4 py-3 text-sm">{error}</div>}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-wrap gap-4 items-center justify-between bg-slate-50">
          <div className="relative flex-1 max-w-md">
            <Search className="w-5 h-5 text-slate-400 absolute right-3 top-2.5" />
            <input
              type="text"
              placeholder="بحث برقم السند أو الجهة أو البيان..."
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              className="w-full pr-10 pl-4 py-2 bg-white border border-slate-200 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
              className="bg-white border border-slate-200 px-4 py-2 rounded-lg text-sm font-medium text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
              title="تصفية حسب نوع السند"
            >
              <option value="">جميع السندات</option>
              <option value="RECEIPT">سندات القبض فقط</option>
              <option value="PAYMENT">سندات الصرف فقط</option>
            </select>
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition border ${
                showAdvanced || activeAdvancedCount > 0
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-indigo-50 text-indigo-800 border-indigo-100 hover:bg-indigo-100'
              }`}
            >
              <Filter className="w-4 h-4" />
              <span>تصفية متقدمة</span>
              {activeAdvancedCount > 0 ? (
                <span className="bg-white/20 text-xs rounded-full px-1.5 py-0.5 font-bold">{activeAdvancedCount}</span>
              ) : null}
            </button>
          </div>
        </div>

        {showAdvanced ? (
          <div className="px-4 py-3 border-b border-slate-200 bg-white grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-600">الحالة</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                className="w-full bg-slate-50 border border-slate-200 px-3 py-2 rounded-lg text-sm"
              >
                <option value="">الكل</option>
                <option value="CONFIRMED">مُرحل</option>
                <option value="DRAFT">مسودة</option>
                <option value="CANCELLED">ملغى</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-600">الغرض</label>
              <select
                value={purposeFilter}
                onChange={(e) => setPurposeFilter(e.target.value as PurposeFilter)}
                className="w-full bg-slate-50 border border-slate-200 px-3 py-2 rounded-lg text-sm"
              >
                <option value="">الكل</option>
                {VOUCHER_PURPOSES.map((p) => (
                  <option key={p} value={p}>
                    {voucherPurposeAr(p)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-600">نوع الجهة</label>
              <select
                value={partyFilter}
                onChange={(e) => setPartyFilter(e.target.value as PartyFilter)}
                className="w-full bg-slate-50 border border-slate-200 px-3 py-2 rounded-lg text-sm"
              >
                <option value="">الكل</option>
                <option value="CUSTOMER">عميل</option>
                <option value="SUPPLIER">مورد</option>
                <option value="OTHER">أخرى</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-600">من تاريخ</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 px-3 py-2 rounded-lg text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-600">إلى تاريخ</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 px-3 py-2 rounded-lg text-sm"
              />
            </div>
            <div className="sm:col-span-2 lg:col-span-5 flex justify-end">
              <button
                type="button"
                onClick={clearAdvanced}
                disabled={activeAdvancedCount === 0}
                className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-rose-700 disabled:opacity-40 px-2 py-1"
              >
                <X className="w-4 h-4" />
                مسح التصفية المتقدمة
              </button>
            </div>
          </div>
        ) : null}

        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-800 text-slate-100 font-medium">
              <tr>
                <th className="px-6 py-4">رقم السند</th>
                <th className="px-6 py-4">النوع</th>
                <th className="px-6 py-4">التاريخ</th>
                <th className="px-6 py-4">المبلغ</th>
                <th className="px-6 py-4">الجهة</th>
                <th className="px-6 py-4">الغرض</th>
                <th className="px-6 py-4">الصندوق</th>
                <th className="px-6 py-4">البيان</th>
                <th className="px-6 py-4">الحالة</th>
                <th className="px-6 py-4">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={10} className="px-6 py-12 text-center text-slate-500">
                    <Loader2 className="w-6 h-6 animate-spin inline mr-2" />
                    جاري التحميل...
                  </td>
                </tr>
              ) : bonds.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-6 py-12 text-center text-slate-500">
                    لا توجد سندات مطابقة للتصفية
                  </td>
                </tr>
              ) : (
                bonds.map((bond) => (
                  <tr key={bond.id} className="hover:bg-slate-50 transition-colors bg-white">
                    <td className="px-6 py-4 font-mono font-medium text-slate-600">
                      <button
                        type="button"
                        onClick={() => navigate(`/bonds/records/${bond.id}`)}
                        className="text-indigo-700 hover:underline"
                        title="فتح السند"
                      >
                        {bond.voucher_no}
                      </button>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`flex items-center gap-1.5 font-bold ${
                          bond.voucher_type === 'RECEIPT' ? 'text-emerald-600' : 'text-rose-600'
                        }`}
                      >
                        {bond.voucher_type === 'RECEIPT' ? <ArrowDownRight className="w-4 h-4" /> : <ArrowUpRight className="w-4 h-4" />}
                        {typeLabel(bond.voucher_type)}
                      </span>
                    </td>
                    <td className="px-6 py-4 font-medium text-slate-600">{formatVoucherDate(bond.voucher_date)}</td>
                    <td
                      className={`px-6 py-4 font-bold ${
                        bond.voucher_type === 'RECEIPT' ? 'text-emerald-600' : 'text-rose-600'
                      }`}
                    >
                      {Number(bond.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })} {bond.currency_code}
                    </td>
                    <td className="px-6 py-4 font-medium text-slate-900">{bond.party_name}</td>
                    <td className="px-6 py-4 text-slate-600 truncate max-w-[120px]" title={voucherPurposeAr(bond.purpose)}>
                      {voucherPurposeAr(bond.purpose)}
                    </td>
                    <td className="px-6 py-4 text-slate-600 truncate max-w-[120px]">{bond.cashbox_name || '—'}</td>
                    <td className="px-6 py-4 text-slate-600 truncate max-w-[200px]" title={bond.description || ''}>
                      {bond.description || '—'}
                    </td>
                    <td className="px-6 py-4">
                      <span className="px-2 py-1 rounded text-xs font-bold bg-slate-100 text-slate-700">{statusLabel(bond.status)}</span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setPrintVoucher(bond)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition"
                          title="طباعة السند"
                        >
                          <Printer className="w-4 h-4" />
                          <span>طباعة</span>
                        </button>
                        {bond.status === 'CONFIRMED' ? (
                          <TelegramSendButton
                            size="compact"
                            label="تيليغرام"
                            busy={telegramBusyId === bond.id}
                            onClick={() => void handleSendTelegram(bond)}
                          />
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      <VoucherPrintModal
        isOpen={Boolean(printVoucher)}
        voucher={printVoucher}
        onClose={() => setPrintVoucher(null)}
      />
    </div>
  );
};
