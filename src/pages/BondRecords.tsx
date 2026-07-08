import React, { useCallback, useEffect, useState } from 'react';
import { Search, Filter, ArrowUpRight, ArrowDownRight, Loader2, Printer } from 'lucide-react';
import { listVouchers, type VoucherRow } from '../lib/api/vouchersApi';
import { ApiRequestError } from '../lib/api/client';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../components/NonBlockingToast';
import { TelegramSendButton } from '../components/telegram/TelegramSendButton';
import { sendTelegramVoucherFromRow } from '../lib/telegramVoucher';
import { VoucherPrintModal } from '../components/VoucherPrintModal';
import { voucherPurposeAr } from '../lib/voucherPurpose';

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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const search = searchTerm.trim();
      const res = await listVouchers({ pageSize: 100, search: search || undefined });
      setBonds(res.data);
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : 'تعذر تحميل السندات');
    } finally {
      setLoading(false);
    }
  }, [searchTerm]);

  useEffect(() => {
    void load();
  }, [load]);

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
              placeholder="بحث برقم السند..."
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              className="w-full pr-10 pl-4 py-2 bg-white border border-slate-200 rounded-lg shadow-sm"
            />
          </div>
          <div className="flex gap-2">
            <select className="bg-white border px-4 py-2 rounded-lg opacity-60 cursor-not-allowed" disabled>
              <option>جميع السندات</option>
            </select>
            <button type="button" className="flex items-center gap-2 bg-indigo-50 px-4 py-2 rounded-lg opacity-60 cursor-not-allowed" disabled>
              <Filter className="w-4 h-4" />
              <span>تصفية متقدمة</span>
            </button>
          </div>
        </div>
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
                    لا توجد سندات بعد
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
