import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Loader2, XCircle } from 'lucide-react';
import {
  getExternalJob, receiveExternalJobLine, setExternalJobFee, postExternalJobFee, voidExternalJob,
  type ExternalJobDetail, type ExternalJobLine,
} from '../../lib/api/externalJobsApi';
import { SUPPORTED_CURRENCIES } from '../../lib/currency';
import { useToast } from '../../components/NonBlockingToast';
import { ApiRequestError } from '../../lib/api/client';

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

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await getExternalJob(id);
      setJob(res.data);
      setFeeAmount(res.data.fee_amount != null ? String(res.data.fee_amount) : '');
      setFeeCurrencyCode(res.data.fee_currency_code ?? 'USD');
    } catch (e) {
      showToast({ type: 'error', message: e instanceof ApiRequestError ? e.message : t('toast.loadJobFailed') });
    } finally {
      setLoading(false);
    }
  }, [id, showToast, t]);

  useEffect(() => { void load(); }, [load]);

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
  const canEditFee = job.document_status === 'CONFIRMED' && !job.fee_posted_at;
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

      {/* Fee card */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
        <h3 className="font-bold text-slate-800">{t('fee.title')}</h3>
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
                <option key={c.code} value={c.code}>{c.nameAr} ({c.code})</option>
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
              <ReceiptLineRow key={line.id} jobId={job.id} line={line} onReceived={() => void load()} />
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

      {canVoid && (
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
  onReceived,
}: {
  jobId: string;
  line: ExternalJobLine;
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
