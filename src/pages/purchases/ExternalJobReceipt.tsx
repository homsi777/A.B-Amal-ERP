import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Loader2, Lock, Pencil, Printer, XCircle } from 'lucide-react';
import {
  getExternalJob, receiveExternalJobLine, setExternalJobFee, postExternalJobFee, voidExternalJob,
  editProcessingExternalJob, voidProcessingExternalJob,
  getExternalJobReceipt, createExternalJobReceipt, approveExternalJobReceiptShortage,
  type ExternalJobDetail, type ExternalJobLine, type ExternalJobReceiptDto,
} from '../../lib/api/externalJobsApi';
import { listWarehouses, type ApiWarehouse } from '../../lib/api/warehousesApi';
import { SUPPORTED_CURRENCIES, getCurrencyName } from '../../lib/currency';
import { useToast } from '../../components/NonBlockingToast';
import { ApiRequestError } from '../../lib/api/client';
import { renderExternalJobDispatchA4Html } from '../../lib/printing/renderExternalJobDispatchA4';
import { openDocumentPrintWindow } from '../../lib/printing/documentPrint';
import { fetchMe, type AuthUser } from '../../lib/api/authApi';
import i18n from '../../i18n/config';

export const ExternalJobReceipt = () => {
  const { t } = useTranslation('externalJobs');
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [job, setJob] = useState<ExternalJobDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const [feeAmount, setFeeAmount] = useState('');
  const [feeCurrencyCode, setFeeCurrencyCode] = useState('USD');
  const [savingFee, setSavingFee] = useState(false);
  const [postingFee, setPostingFee] = useState(false);
  const [voiding, setVoiding] = useState(false);

  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);

  const [reauthModal, setReauthModal] = useState<'edit' | 'void' | null>(null);
  const [editDescription, setEditDescription] = useState('');
  const [editNotes, setEditNotes] = useState('');

  const [warehouses, setWarehouses] = useState<ApiWarehouse[]>([]);
  const [receipt, setReceipt] = useState<ExternalJobReceiptDto | null>(null);
  const [sentLengthM, setSentLengthM] = useState(0);
  const [sentWeightKg, setSentWeightKg] = useState(0);
  const [receiptLoading, setReceiptLoading] = useState(false);
  const [returnedLengthM, setReturnedLengthM] = useState('');
  const [returnedWeightKg, setReturnedWeightKg] = useState('');
  const [destinationWarehouseId, setDestinationWarehouseId] = useState('');
  const [rollStatus, setRollStatus] = useState<'AVAILABLE' | 'DAMAGED'>('AVAILABLE');
  const [receiptNotes, setReceiptNotes] = useState('');
  const [savingReceipt, setSavingReceipt] = useState(false);
  const [shortageAmount, setShortageAmount] = useState('');
  const [shortageNotes, setShortageNotes] = useState('');
  const [approvingShortage, setApprovingShortage] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await getExternalJob(id);
      setJob(res.data);
      setFeeAmount(res.data.fee_amount != null ? String(res.data.fee_amount) : '');
      setFeeCurrencyCode(res.data.fee_currency_code ?? 'USD');
      setEditDescription(res.data.process_description ?? '');
      setEditNotes(res.data.notes ?? '');
      if (res.data.job_kind === 'PROCESSING') {
        setReceiptLoading(true);
        try {
          const receiptRes = await getExternalJobReceipt(id);
          setReceipt(receiptRes.data.receipt);
          setSentLengthM(receiptRes.data.sentLengthM);
          setSentWeightKg(receiptRes.data.sentWeightKg);
        } finally {
          setReceiptLoading(false);
        }
      }
    } catch (e) {
      showToast({ type: 'error', message: e instanceof ApiRequestError ? e.message : t('toast.loadJobFailed') });
    } finally {
      setLoading(false);
    }
  }, [id, showToast, t]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void fetchMe().then(setCurrentUser).catch(() => setCurrentUser(null)); }, []);
  useEffect(() => { listWarehouses({ status: 'active' }).then(setWarehouses).catch(() => {}); }, []);

  const handleCreateReceipt = async () => {
    if (!id || !returnedLengthM.trim() || !destinationWarehouseId) return;
    setSavingReceipt(true);
    try {
      await createExternalJobReceipt(id, {
        returnedLengthM: Number(returnedLengthM),
        returnedWeightKg: returnedWeightKg.trim() ? Number(returnedWeightKg) : null,
        destinationWarehouseId,
        rollStatus,
        notes: receiptNotes.trim() || null,
      });
      showToast({ type: 'success', message: t('receiptSection.createdSuccess') });
      await load();
    } catch (e) {
      showToast({ type: 'error', message: e instanceof ApiRequestError ? e.message : t('receiptSection.createFailed') });
    } finally {
      setSavingReceipt(false);
    }
  };

  const handleApproveShortage = async () => {
    if (!id || !shortageAmount.trim()) return;
    setApprovingShortage(true);
    try {
      await approveExternalJobReceiptShortage(id, {
        amountM: Number(shortageAmount),
        notes: shortageNotes.trim() || null,
      });
      showToast({ type: 'success', message: t('receiptSection.shortageApprovedSuccess') });
      setShortageAmount('');
      setShortageNotes('');
      await load();
    } catch (e) {
      showToast({ type: 'error', message: e instanceof ApiRequestError ? e.message : t('receiptSection.shortageApproveFailed') });
    } finally {
      setApprovingShortage(false);
    }
  };

  const handleSaveFee = async () => {
    if (!id || !feeAmount.trim()) return;
    setSavingFee(true);
    try {
      await setExternalJobFee(id, Number(feeAmount), feeCurrencyCode);
      showToast({ type: 'success', message: t('toast.feeSaved') });
      await load();
    } catch (e) {
      showToast({ type: 'error', message: e instanceof ApiRequestError ? e.message : t('toast.feeSaveFailed') });
    } finally {
      setSavingFee(false);
    }
  };

  const handlePostFee = async () => {
    if (!id) return;
    setPostingFee(true);
    try {
      await postExternalJobFee(id);
      showToast({ type: 'success', message: t('toast.feePosted') });
      await load();
    } catch (e) {
      showToast({ type: 'error', message: e instanceof ApiRequestError ? e.message : t('toast.feePostFailed') });
    } finally {
      setPostingFee(false);
    }
  };

  const handleVoid = async () => {
    if (!id || !job) return;
    if (!window.confirm(t('voidConfirm'))) return;
    setVoiding(true);
    try {
      await voidExternalJob(id, null);
      showToast({ type: 'success', message: t('toast.voidSuccess') });
      navigate('/purchases/external-jobs');
    } catch (e) {
      showToast({ type: 'error', message: e instanceof ApiRequestError ? e.message : t('toast.voidFailed') });
    } finally {
      setVoiding(false);
    }
  };

  const handlePrint = () => {
    if (!job) return;
    const lang: 'ar' | 'tr' = i18n.language === 'tr' ? 'tr' : 'ar';
    const html = renderExternalJobDispatchA4Html({ job, lang });
    const ok = openDocumentPrintWindow(html, job.job_no);
    if (!ok) showToast({ type: 'error', message: t('processingNew.printPopupBlocked') });
  };

  const handleEditSubmit = async (password: string) => {
    if (!id) return;
    try {
      await editProcessingExternalJob(id, {
        password,
        processDescription: editDescription.trim() || null,
        notes: editNotes.trim() || null,
      });
      showToast({ type: 'success', message: t('processingNew.editSuccess') });
      setReauthModal(null);
      await load();
    } catch (e) {
      throw e instanceof ApiRequestError ? e : new Error(t('processingNew.editFailed'));
    }
  };

  const handleVoidProcessingSubmit = async (password: string) => {
    if (!id) return;
    try {
      await voidProcessingExternalJob(id, { password });
      showToast({ type: 'success', message: t('toast.voidSuccess') });
      navigate('/purchases/external-jobs');
    } catch (e) {
      throw e instanceof ApiRequestError ? e : new Error(t('toast.voidFailed'));
    }
  };

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto py-20 text-center">
        <Loader2 className="w-8 h-8 animate-spin mx-auto text-slate-400" />
      </div>
    );
  }

  if (!job) {
    return (
      <div className="max-w-5xl mx-auto py-20 text-center text-slate-500">
        {t('jobNotFound')}
      </div>
    );
  }

  const sentLines = job.lines.filter((l) => l.line_status === 'SENT');
  const receivedLines = job.lines.filter((l) => l.line_status === 'RECEIVED');
  const canPrice = currentUser?.role === 'admin' || currentUser?.role === 'accountant';
  const canEditFee = job.document_status === 'CONFIRMED' && !job.fee_posted_at && canPrice;
  const canPostFee = canEditFee && job.fee_amount != null;
  const canVoid = job.document_status === 'CONFIRMED' && receivedLines.length === 0;

  return (
    <div className="max-w-5xl mx-auto space-y-6" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/purchases/external-jobs')} className="p-2 bg-white border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 transition">
            <ArrowRight className="w-5 h-5" />
          </button>
          <div>
            <h2 className="text-2xl font-bold text-slate-900 font-mono">{job.job_no}</h2>
            <p className="text-slate-500 mt-1 text-sm">{job.supplier_name} — {job.sent_date}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handlePrint} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 text-sm font-bold hover:bg-slate-50 transition">
            <Printer className="w-4 h-4" /> {t('processingNew.print')}
          </button>
          <span className={`px-3 py-1.5 rounded-lg text-sm font-bold ${
            job.document_status === 'CONFIRMED' ? 'bg-emerald-100 text-emerald-700'
              : job.document_status === 'VOIDED' ? 'bg-rose-100 text-rose-700'
              : 'bg-amber-100 text-amber-700'
          }`}>
            {job.document_status === 'CONFIRMED' ? t('status.confirmed')
              : job.document_status === 'VOIDED' ? t('status.voided')
              : t('status.draft')}
          </span>
        </div>
      </div>

      {job.job_kind === 'PROCESSING' && (
        <div className="bg-white rounded-xl border border-emerald-200 shadow-sm p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-emerald-800">{t('processingNew.infoCardTitle')}</h3>
            {canVoid && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setReauthModal('edit')}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 text-xs font-bold hover:bg-slate-50 transition"
                >
                  <Pencil className="w-3.5 h-3.5" /> {t('processingNew.edit')}
                </button>
                <button
                  onClick={() => setReauthModal('void')}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 text-xs font-bold hover:bg-rose-100 transition"
                >
                  <XCircle className="w-3.5 h-3.5" /> {t('voidButton')}
                </button>
              </div>
            )}
          </div>
          <div className="grid sm:grid-cols-2 gap-2 text-sm">
            <div><span className="text-slate-500">{t('processingNew.summaryOrderNo')}: </span><strong className="font-mono">#{job.supplier_order_no}</strong></div>
            <div><span className="text-slate-500">{t('processingNew.stageStepTitle')}: </span><strong>{job.fabric_stage === 'RAW' ? t('processingNew.stageRaw') : t('processingNew.stageFinished')}</strong></div>
            <div><span className="text-slate-500">{t('processingNew.preparationTypeLabel')}: </span><strong>{job.preparation_type_name || '—'}</strong></div>
            <div><span className="text-slate-500">{t('processingNew.sourceWarehouseLabel')}: </span><strong>{job.source_warehouse_name || '—'}</strong></div>
            {job.process_description && (
              <div className="sm:col-span-2"><span className="text-slate-500">{t('processingNew.processDescriptionLabel')}: </span>{job.process_description}</div>
            )}
          </div>
        </div>
      )}

      {reauthModal && (
        <ReauthModal
          title={reauthModal === 'edit' ? t('processingNew.editModalTitle') : t('processingNew.voidModalTitle')}
          onClose={() => setReauthModal(null)}
          onSubmit={reauthModal === 'edit' ? handleEditSubmit : handleVoidProcessingSubmit}
        >
          {reauthModal === 'edit' && (
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-600">{t('processingNew.processDescriptionLabel')}</label>
                <textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  rows={2}
                  className="w-full p-2 bg-white border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-600">{t('processingNew.notesLabel')}</label>
                <input
                  type="text"
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  className="w-full p-2 bg-white border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
          )}
        </ReauthModal>
      )}

      {/* Fee card — غير معروض لمهام "مصنعية" بهذه المرحلة؛ لا تسعير ولا
          أجرة ولا حساب تكلفة لهذا النوع حالياً بناءً على طلب صريح. */}
      {job.job_kind !== 'PROCESSING' && (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
        <h3 className="font-bold text-slate-800">{t('fee.title')}</h3>

        {!canPrice && job.document_status === 'CONFIRMED' && !job.fee_posted_at && (
          <p className="text-xs text-amber-700 font-bold bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            {t('pricing.noPermission')}
          </p>
        )}

          <div className="grid md:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-bold text-slate-700">{t('fee.amountLabel')}</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={feeAmount}
                onChange={(e) => setFeeAmount(e.target.value)}
                disabled={!canEditFee}
                className="w-full p-2.5 bg-white border border-slate-300 rounded-lg text-sm disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                dir="ltr"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-bold text-slate-700">{t('fee.currencyLabel')}</label>
              <select
                value={feeCurrencyCode}
                onChange={(e) => setFeeCurrencyCode(e.target.value)}
                disabled={!canEditFee}
                className="w-full p-2.5 bg-white border border-slate-300 rounded-lg text-sm disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {SUPPORTED_CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>{getCurrencyName(c.code)} ({c.code})</option>
                ))}
              </select>
            </div>
            <div className="flex items-end gap-2">
              {canEditFee && (
                <button
                  onClick={() => void handleSaveFee()}
                  disabled={savingFee || !feeAmount.trim()}
                  className="px-4 py-2.5 rounded-lg bg-slate-700 text-white text-sm font-bold hover:bg-slate-800 disabled:opacity-50 transition"
                >
                  {t('fee.save')}
                </button>
              )}
              {canPostFee && (
                <button
                  onClick={() => void handlePostFee()}
                  disabled={postingFee}
                  className="px-4 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-700 disabled:opacity-50 transition"
                >
                  {t('fee.post')}
                </button>
              )}
            </div>
          </div>
        {job.fee_posted_at && (
          <p className="text-xs text-emerald-700 font-bold">{t('fee.postedNote')}</p>
        )}
      </div>
      )}

      {/* مصنعية: لا يوجد استلام دفعات ولا حالة "بانتظار الاستلام" — الأتواب
          تُخصَم من المستودع فوراً عند الإرسال وتنتهي عملية المهمة هناك. هذا
          جدول عرض فقط لما أُرسل، بلا أي إجراء استلام. */}
      {job.job_kind === 'PROCESSING' ? (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <h3 className="font-bold text-slate-800">{t('processingNew.sentRollsTitle')}</h3>
            <span className="text-xs text-slate-500">{t('processingNew.sentRollsCount', { count: sentLines.length })}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-4 py-2">{t('lines.colBarcode')}</th>
                  <th className="px-4 py-2">{t('lines.colItem')}</th>
                  <th className="px-4 py-2">{t('lines.colSentColor')}</th>
                  <th className="px-4 py-2">{t('processingNew.colLength')}</th>
                  <th className="px-4 py-2">{t('processingNew.colWeight')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sentLines.map((line) => (
                  <tr key={line.id}>
                    <td className="px-4 py-2 font-mono text-xs text-slate-600">{line.sent_barcode || line.current_barcode}</td>
                    <td className="px-4 py-2 font-medium text-slate-800">{line.item_name}</td>
                    <td className="px-4 py-2 text-slate-500">{line.sent_color_name_ar || '—'}</td>
                    <td className="px-4 py-2 text-slate-600 font-mono">{Number(line.sent_length_m).toFixed(2)}</td>
                    <td className="px-4 py-2 text-slate-600 font-mono">{line.roll_weight_kg != null ? Number(line.roll_weight_kg).toFixed(2) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {job.job_kind === 'PROCESSING' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
          <h3 className="font-bold text-slate-800">{t('receiptSection.title')}</h3>

          {receiptLoading ? (
            <div className="text-center text-slate-500 py-4"><Loader2 className="w-5 h-5 animate-spin inline ml-2" />{t('receiptSection.loading')}</div>
          ) : receipt ? (
            <div className="space-y-3">
              <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div><span className="text-slate-500">{t('receiptSection.sentLabel')}: </span><strong className="font-mono">{sentLengthM.toFixed(2)} {t('meterAbbr')} / {sentWeightKg.toFixed(2)} {t('processingNew.colWeight')}</strong></div>
                <div><span className="text-slate-500">{t('receiptSection.returnedLabel')}: </span><strong className="font-mono">{Number(receipt.returned_length_m).toFixed(2)} {t('meterAbbr')}{receipt.returned_weight_kg != null ? ` / ${Number(receipt.returned_weight_kg).toFixed(2)}` : ''}</strong></div>
                <div><span className="text-slate-500">{t('receiptSection.destinationLabel')}: </span><strong>{receipt.destination_warehouse_name || '—'}</strong></div>
                <div><span className="text-slate-500">{t('receiptSection.rollStatusLabel')}: </span><strong>{receipt.roll_status === 'DAMAGED' ? t('receiptSection.statusDamaged') : t('receiptSection.statusAvailable')}</strong></div>
              </div>
              {(() => {
                const diff = sentLengthM - Number(receipt.returned_length_m) - Number(receipt.shortage_approved_length_m || 0);
                return diff > 0.001 ? (
                  <div className="space-y-2">
                    <p className="text-sm font-bold text-amber-700">
                      {t('receiptSection.differenceLabel')}: {diff.toFixed(2)} {t('meterAbbr')}
                      {Number(receipt.shortage_approved_length_m) > 0 && (
                        <span className="text-xs text-slate-500 font-normal"> ({t('receiptSection.alreadyApproved', { amount: Number(receipt.shortage_approved_length_m).toFixed(2) })})</span>
                      )}
                    </p>
                    {canPrice ? (
                      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex flex-wrap gap-2 items-end">
                        <div className="space-y-1">
                          <label className="text-xs text-slate-600">{t('receiptSection.shortageAmountLabel')}</label>
                          <input
                            type="number" min={0} max={diff} step="0.001"
                            value={shortageAmount}
                            onChange={(e) => setShortageAmount(e.target.value)}
                            className="w-28 rounded border border-slate-300 px-2 py-1.5 text-sm" dir="ltr"
                          />
                        </div>
                        <div className="flex-1 min-w-[180px] space-y-1">
                          <label className="text-xs text-slate-600">{t('receiptSection.shortageNotesLabel')}</label>
                          <input
                            value={shortageNotes}
                            onChange={(e) => setShortageNotes(e.target.value)}
                            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                          />
                        </div>
                        <button
                          type="button"
                          disabled={approvingShortage || !shortageAmount.trim()}
                          onClick={() => void handleApproveShortage()}
                          className="rounded-lg bg-amber-700 px-4 py-1.5 text-sm font-bold text-white hover:bg-amber-800 disabled:opacity-50"
                        >
                          {approvingShortage ? t('receiptSection.approving') : t('receiptSection.approveShortageButton')}
                        </button>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500">{t('pricing.noPermission')}</p>
                    )}
                  </div>
                ) : null;
              })()}
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-slate-500">{t('receiptSection.subtitle', { sent: sentLengthM.toFixed(2) })}</p>
              <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-3">
                <div className="space-y-1">
                  <label className="text-sm font-bold text-slate-700">{t('receiptSection.returnedLengthLabel')}</label>
                  <input
                    type="number" min={0} step="0.01"
                    value={returnedLengthM}
                    onChange={(e) => setReturnedLengthM(e.target.value)}
                    className="w-full p-2.5 bg-white border border-slate-300 rounded-lg text-sm" dir="ltr"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-bold text-slate-700">{t('receiptSection.returnedWeightLabel')}</label>
                  <input
                    type="number" min={0} step="0.01"
                    value={returnedWeightKg}
                    onChange={(e) => setReturnedWeightKg(e.target.value)}
                    className="w-full p-2.5 bg-white border border-slate-300 rounded-lg text-sm" dir="ltr"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-bold text-slate-700">{t('receiptSection.destinationLabel')}</label>
                  <select
                    value={destinationWarehouseId}
                    onChange={(e) => setDestinationWarehouseId(e.target.value)}
                    className="w-full p-2.5 bg-white border border-slate-300 rounded-lg text-sm"
                  >
                    <option value="">{t('receiptSection.chooseWarehouse')}</option>
                    {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-bold text-slate-700">{t('receiptSection.rollStatusLabel')}</label>
                  <select
                    value={rollStatus}
                    onChange={(e) => setRollStatus(e.target.value as 'AVAILABLE' | 'DAMAGED')}
                    className="w-full p-2.5 bg-white border border-slate-300 rounded-lg text-sm"
                  >
                    <option value="AVAILABLE">{t('receiptSection.statusAvailable')}</option>
                    <option value="DAMAGED">{t('receiptSection.statusDamaged')}</option>
                  </select>
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-bold text-slate-700">{t('receiptSection.notesLabel')}</label>
                <input
                  value={receiptNotes}
                  onChange={(e) => setReceiptNotes(e.target.value)}
                  className="w-full p-2.5 bg-white border border-slate-300 rounded-lg text-sm"
                />
              </div>
              <button
                type="button"
                disabled={savingReceipt || !returnedLengthM.trim() || !destinationWarehouseId}
                onClick={() => void handleCreateReceipt()}
                className="px-4 py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 disabled:opacity-50 transition"
              >
                {savingReceipt ? t('receiptSection.saving') : t('receiptSection.createButton')}
              </button>
            </div>
          )}
        </div>
      )}

      {job.job_kind !== 'PROCESSING' && (
        <>
          {/* Pending receipt lines */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-bold text-slate-800">{t('lines.pendingTitle')}</h3>
              <span className="text-xs text-slate-500">{t('lines.pendingCount', { count: sentLines.length })}</span>
            </div>
            {sentLines.length === 0 ? (
              <p className="px-5 py-8 text-center text-slate-400 text-sm">{t('lines.noPending')}</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {sentLines.map((line) => (
                  <ReceiptLineRow
                    key={line.id}
                    jobId={job.id}
                    line={line}
                    defaultWastePct={null}
                    onReceived={() => void load()}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Received lines */}
          {receivedLines.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-5 py-3 bg-slate-50 border-b border-slate-200">
                <h3 className="font-bold text-slate-800">{t('lines.receivedTitle')}</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-right text-sm">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="px-4 py-2">{t('lines.colBarcode')}</th>
                      <th className="px-4 py-2">{t('lines.colItem')}</th>
                      <th className="px-4 py-2">{t('lines.colSentColor')}</th>
                      <th className="px-4 py-2">{t('lines.colNewColor')}</th>
                      <th className="px-4 py-2">{t('lines.colLength')}</th>
                      <th className="px-4 py-2">{t('lines.colReceivedAt')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {receivedLines.map((line) => (
                      <tr key={line.id}>
                        <td className="px-4 py-2 font-mono text-xs text-slate-600">{line.new_barcode || line.current_barcode}</td>
                        <td className="px-4 py-2 font-medium text-slate-800">{line.item_name}</td>
                        <td className="px-4 py-2 text-slate-500">{line.sent_color_name_ar || '—'}</td>
                        <td className="px-4 py-2 text-emerald-700 font-medium">{line.new_color_name_ar || '—'}</td>
                        <td className="px-4 py-2 text-slate-600">{line.new_length_m ?? line.sent_length_m}</td>
                        <td className="px-4 py-2 text-slate-500 text-xs">{line.received_at ? new Date(line.received_at).toLocaleString() : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {canVoid && job.job_kind === 'GENERAL' && (
        <div className="flex justify-end">
          <button
            onClick={() => void handleVoid()}
            disabled={voiding}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 text-sm font-bold hover:bg-rose-100 disabled:opacity-50 transition"
          >
            {voiding ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
            {t('voidButton')}
          </button>
        </div>
      )}
    </div>
  );
};

const ReceiptLineRow = ({
  jobId,
  line,
  defaultWastePct,
  onReceived,
}: {
  jobId: string;
  line: ExternalJobLine;
  defaultWastePct?: string | number | null;
  onReceived: () => void;
}) => {
  const { t } = useTranslation('externalJobs');
  const { showToast } = useToast();

  const [colorName, setColorName] = useState('');
  const [colorCode, setColorCode] = useState('');
  const [changeBarcode, setChangeBarcode] = useState(false);
  const [newBarcode, setNewBarcode] = useState('');
  const [lengthChanged, setLengthChanged] = useState(false);
  const [newLength, setNewLength] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const generateRandomBarcode = () => {
    setNewBarcode(String(Math.floor(1000000 + Math.random() * 9000000)));
  };

  const handleReceive = async () => {
    if (!colorName.trim() && !colorCode.trim()) {
      showToast({ type: 'error', message: t('receive.colorRequired') });
      return;
    }
    setSaving(true);
    try {
      await receiveExternalJobLine(jobId, line.id, {
        newColorName: colorName.trim() || null,
        newColorCode: colorCode.trim() || null,
        newBarcode: changeBarcode ? newBarcode.trim() || null : null,
        newLengthM: lengthChanged && newLength.trim() ? Number(newLength) : null,
        receiptNotes: notes.trim() || null,
      });
      showToast({ type: 'success', message: t('receive.success') });
      onReceived();
    } catch (e) {
      showToast({ type: 'error', message: e instanceof ApiRequestError ? e.message : t('receive.failed') });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <p className="font-mono text-xs text-slate-500">{line.current_barcode}</p>
          <p className="font-bold text-slate-800">{line.item_name}</p>
          <p className="text-xs text-slate-500">
            {t('receive.sentAs')}: {line.sent_color_name_ar || '—'} · {line.sent_length_m} {t('meterAbbr')}
          </p>
          {defaultWastePct != null && line.sent_length_m != null && (
            <p className="text-xs text-amber-700 font-bold mt-0.5">
              {t('processingNew.expectedLengthHint', {
                value: (Number(line.sent_length_m) * (1 - Number(defaultWastePct) / 100)).toFixed(2),
              })}
            </p>
          )}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs font-bold text-slate-600">{t('receive.newColorNameLabel')}</label>
          <input
            type="text"
            value={colorName}
            onChange={(e) => setColorName(e.target.value)}
            className="w-full p-2 bg-white border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-bold text-slate-600">{t('receive.newColorCodeLabel')}</label>
          <input
            type="text"
            value={colorCode}
            onChange={(e) => setColorCode(e.target.value)}
            className="w-full p-2 bg-white border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            dir="ltr"
          />
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
            <input type="checkbox" checked={changeBarcode} onChange={(e) => setChangeBarcode(e.target.checked)} className="accent-indigo-600" />
            {t('receive.changeBarcodeLabel')}
          </label>
          {changeBarcode && (
            <div className="flex gap-2">
              <input
                type="text"
                value={newBarcode}
                onChange={(e) => setNewBarcode(e.target.value)}
                className="flex-1 p-2 bg-white border border-slate-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                dir="ltr"
              />
              <button type="button" onClick={generateRandomBarcode} className="px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-slate-700 text-xs font-bold hover:bg-slate-100">
                {t('receive.generateBarcode')}
              </button>
            </div>
          )}
        </div>
        <div className="space-y-1.5">
          <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
            <input type="checkbox" checked={lengthChanged} onChange={(e) => setLengthChanged(e.target.checked)} className="accent-indigo-600" />
            {t('receive.lengthChangedLabel')}
          </label>
          {lengthChanged && (
            <input
              type="number"
              min={0}
              step="0.01"
              value={newLength}
              onChange={(e) => setNewLength(e.target.value)}
              className="w-full p-2 bg-white border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              dir="ltr"
            />
          )}
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-bold text-slate-600">{t('receive.notesLabel')}</label>
        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full p-2 bg-white border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      <div className="flex justify-end">
        <button
          onClick={() => void handleReceive()}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 disabled:opacity-50 transition"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
          {t('receive.submit')}
        </button>
      </div>
    </div>
  );
};

/** نافذة إعادة مصادقة بكلمة المرور — تُستخدَم لتعديل/إلغاء مهمة مصنعية. */
const ReauthModal = ({
  title,
  onClose,
  onSubmit,
  children,
}: {
  title: string;
  onClose: () => void;
  onSubmit: (password: string) => Promise<void>;
  children?: React.ReactNode;
}) => {
  const { t } = useTranslation('externalJobs');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!password.trim()) {
      setError(t('processingNew.passwordRequired'));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(password);
    } catch (e) {
      const code = e instanceof ApiRequestError ? e.body?.code : undefined;
      if (code === 'PASSWORD_INVALID') setError(t('processingNew.passwordInvalid'));
      else if (code === 'REAUTH_RATE_LIMITED') setError(t('processingNew.rateLimited'));
      else setError(e instanceof ApiRequestError ? e.message : t('processingNew.genericActionFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" dir="rtl">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full border border-slate-200">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Lock className="w-4 h-4 text-slate-500" /> {title}
          </h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-800">×</button>
        </div>
        <div className="p-5 space-y-3">
          {children}
          {error && <p className="text-sm text-rose-600 bg-rose-50 p-2 rounded-lg">{error}</p>}
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-600">{t('processingNew.passwordLabel')}</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleSubmit(); }}
              className="w-full p-2 bg-white border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              dir="ltr"
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 text-sm">
              {t('create.cancel')}
            </button>
            <button
              onClick={() => void handleSubmit()}
              disabled={submitting}
              className="px-4 py-2 rounded-lg bg-indigo-600 text-white font-bold hover:bg-indigo-700 transition disabled:opacity-50 text-sm flex items-center gap-2"
            >
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {t('processingNew.confirm')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
