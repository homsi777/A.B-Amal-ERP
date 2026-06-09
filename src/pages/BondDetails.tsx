import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowDownRight, ArrowUpRight, Loader2, Printer } from 'lucide-react';
import { ApiRequestError } from '../lib/api/client';
import { cancelVoucher, confirmVoucher, getVoucher, type VoucherRow } from '../lib/api/vouchersApi';
import { useToast } from '../components/NonBlockingToast';
import { VoucherPrintModal } from '../components/VoucherPrintModal';

function typeLabel(t: string) {
  return t === 'RECEIPT' ? 'قبض' : 'صرف';
}

function statusLabel(s: string) {
  if (s === 'DRAFT') return 'مسودة';
  if (s === 'CONFIRMED') return 'مُرحل';
  if (s === 'CANCELLED') return 'ملغى';
  return s;
}

export const BondDetails = () => {
  const { showToast } = useToast();
  const navigate = useNavigate();
  const params = useParams();
  const id = String(params.id ?? '');

  const [bond, setBond] = useState<VoucherRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [printModalOpen, setPrintModalOpen] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await getVoucher(id);
      setBond(res.data);
    } catch (e) {
      setBond(null);
      setError(e instanceof ApiRequestError ? e.message : 'تعذر تحميل السند');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const doConfirm = async () => {
    if (!bond) return;
    setBusy(true);
    try {
      await confirmVoucher(bond.id);
      showToast({ type: 'success', message: 'تم ترحيل السند بنجاح' });
      await load();
    } catch (e) {
      showToast({ type: 'error', message: e instanceof ApiRequestError ? e.message : 'تعذر ترحيل السند' });
    } finally {
      setBusy(false);
    }
  };

  const doCancel = async () => {
    if (!bond) return;
    setBusy(true);
    try {
      await cancelVoucher(bond.id);
      showToast({ type: 'success', message: 'تم إلغاء السند بنجاح' });
      await load();
    } catch (e) {
      showToast({ type: 'error', message: e instanceof ApiRequestError ? e.message : 'تعذر إلغاء السند' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">تفاصيل السند</h2>
          <p className="text-slate-500 mt-1">عرض السند كما هو محفوظ في قاعدة البيانات</p>
        </div>
        <button
          type="button"
          onClick={() => navigate('/bonds/records')}
          className="bg-white border border-slate-200 text-slate-700 px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-slate-50 transition shadow-sm font-medium"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>العودة للسجل</span>
        </button>
      </div>

      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-800 px-4 py-3 text-sm">{error}</div>}

      {loading ? (
        <div className="flex items-center justify-center py-20 text-slate-500">
          <Loader2 className="w-8 h-8 animate-spin mr-2" />
          جاري التحميل...
        </div>
      ) : !bond ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-slate-500">السند غير موجود</div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div
                className={`w-11 h-11 rounded-full flex items-center justify-center ${
                  bond.voucher_type === 'RECEIPT' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                }`}
              >
                {bond.voucher_type === 'RECEIPT' ? <ArrowDownRight className="w-6 h-6" /> : <ArrowUpRight className="w-6 h-6" />}
              </div>
              <div>
                <div className="text-sm text-slate-500">رقم السند</div>
                <div className="text-xl font-bold text-slate-900 font-mono">{bond.voucher_no}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-1 rounded text-xs font-bold bg-slate-100 text-slate-700">{statusLabel(bond.status)}</span>
              <button
                type="button"
                onClick={() => setPrintModalOpen(true)}
                className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-700 text-sm font-semibold hover:bg-slate-50"
              >
                <span className="inline-flex items-center gap-2">
                  <Printer className="w-4 h-4" />
                  طباعة / PDF
                </span>
              </button>
              {bond.status === 'DRAFT' && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void doConfirm()}
                  className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-60"
                >
                  ترحيل
                </button>
              )}
              {bond.status === 'CONFIRMED' && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void doCancel()}
                  className="px-3 py-2 rounded-lg bg-rose-600 text-white text-sm font-semibold hover:bg-rose-700 disabled:opacity-60"
                >
                  إلغاء
                </button>
              )}
            </div>
          </div>

          <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="rounded-xl border border-slate-200 p-4">
              <div className="text-sm text-slate-500 mb-2">بيانات أساسية</div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between gap-4">
                  <span className="text-slate-500">النوع</span>
                  <span className="font-semibold text-slate-900">{typeLabel(bond.voucher_type)}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-slate-500">التاريخ</span>
                  <span className="font-semibold text-slate-900">{bond.voucher_date}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-slate-500">المبلغ</span>
                  <span className="font-semibold text-slate-900 font-mono">
                    {Number(bond.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })} {bond.currency_code}
                  </span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-slate-500">سعر الصرف مقابل الدولار</span>
                  <span className="font-semibold text-slate-900 font-mono" dir="ltr">
                    {bond.exchange_rate_to_usd ? Number(bond.exchange_rate_to_usd).toLocaleString(undefined, { maximumFractionDigits: 6 }) : '1'}
                  </span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-slate-500">المبلغ بالدولار</span>
                  <span className="font-semibold text-slate-900 font-mono">
                    {bond.amount_usd ? Number(bond.amount_usd).toLocaleString(undefined, { minimumFractionDigits: 2 }) : '—'} USD
                  </span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-slate-500">طريقة الدفع</span>
                  <span className="font-semibold text-slate-900">{bond.payment_method}</span>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 p-4">
              <div className="text-sm text-slate-500 mb-2">الجهة والصندوق</div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between gap-4">
                  <span className="text-slate-500">الجهة</span>
                  <span className="font-semibold text-slate-900">{bond.party_name || '—'}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-slate-500">نوع الجهة</span>
                  <span className="font-semibold text-slate-900">{bond.party_type || '—'}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-slate-500">الصندوق</span>
                  <span className="font-semibold text-slate-900">{bond.cashbox_name || '—'}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-slate-500">كود الصندوق</span>
                  <span className="font-semibold text-slate-900">{bond.cashbox_code || '—'}</span>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 p-4 md:col-span-2">
              <div className="text-sm text-slate-500 mb-2">البيان والملاحظات</div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between gap-4">
                  <span className="text-slate-500">البيان</span>
                  <span className="font-semibold text-slate-900">{bond.description || '—'}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-slate-500">ملاحظات</span>
                  <span className="font-semibold text-slate-900">{bond.notes || '—'}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-slate-500">مرجع</span>
                  <span className="font-semibold text-slate-900">
                    {bond.reference_document_type || '—'} {bond.reference_document_no ? `— ${bond.reference_document_no}` : ''}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <VoucherPrintModal
        isOpen={printModalOpen}
        voucher={bond}
        onClose={() => setPrintModalOpen(false)}
      />
    </div>
  );
};

