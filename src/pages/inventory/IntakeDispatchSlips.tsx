import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Ban, Loader2, Printer, Tag } from 'lucide-react';
import {
  getIntakeDispatchSlip,
  listIntakeDispatchSlips,
  updateIntakeDispatchSlipLinePrices,
  voidIntakeDispatchSlip,
  type ApiIntakeDispatchSlip,
  type ApiIntakeDispatchSlipLine,
} from '../../lib/api/intakeDispatchSlipsApi';
import { ApiRequestError } from '../../lib/api/client';
import { useToast } from '../../components/NonBlockingToast';
import { renderIntakeDispatchSlipA4Html } from '../../lib/printing/renderIntakeDispatchSlipA4';
import { openDocumentPrintWindow } from '../../lib/printing/documentPrint';
import i18n from '../../i18n/config';

export const IntakeDispatchSlips: React.FC = () => {
  const { t } = useTranslation('intakeOperations');
  const { showToast } = useToast();
  const [rows, setRows] = useState<ApiIntakeDispatchSlip[]>([]);
  const [loading, setLoading] = useState(true);
  const [openSlipId, setOpenSlipId] = useState<string | null>(null);
  const [lines, setLines] = useState<ApiIntakeDispatchSlipLine[]>([]);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [printingId, setPrintingId] = useState<string | null>(null);
  const [voidingId, setVoidingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setRows(await listIntakeDispatchSlips());
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

  const openPricing = async (slipId: string) => {
    setOpenSlipId(slipId);
    setDetailLoading(true);
    try {
      const { lines: ls } = await getIntakeDispatchSlip(slipId);
      setLines(ls);
      setPrices(Object.fromEntries(ls.map((l) => [l.id, l.unit_price ?? ''])));
    } catch (e) {
      showToast({ type: 'error', message: e instanceof ApiRequestError ? e.message : t('loadFailed') });
      setOpenSlipId(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const savePrices = async () => {
    if (!openSlipId) return;
    const payload = lines
      .filter((l) => prices[l.id] !== '' && prices[l.id] !== undefined)
      .map((l) => ({ lineId: l.id, unitPrice: Number(prices[l.id]) || 0 }));
    if (payload.length === 0) {
      showToast({ type: 'warning', message: t('enterAtLeastOnePrice') });
      return;
    }
    setSaving(true);
    try {
      await updateIntakeDispatchSlipLinePrices(openSlipId, payload);
      showToast({ type: 'success', message: t('pricesSaved') });
      setOpenSlipId(null);
      await load();
    } catch (e) {
      showToast({ type: 'error', message: e instanceof ApiRequestError ? e.message : t('saveFailed') });
    } finally {
      setSaving(false);
    }
  };

  const handlePrint = async (slipId: string) => {
    setPrintingId(slipId);
    try {
      const { slip, lines: ls } = await getIntakeDispatchSlip(slipId);
      const lang: 'ar' | 'tr' = i18n.language === 'tr' ? 'tr' : 'ar';
      const html = renderIntakeDispatchSlipA4Html({ slip, lines: ls, lang });
      const ok = openDocumentPrintWindow(html, slip.slip_no);
      if (!ok) showToast({ type: 'error', message: t('print.popupBlocked') });
    } catch (e) {
      showToast({ type: 'error', message: e instanceof ApiRequestError ? e.message : t('loadFailed') });
    } finally {
      setPrintingId(null);
    }
  };

  const handleVoid = async (row: ApiIntakeDispatchSlip) => {
    if (!window.confirm(t('void.confirm', { slipNo: row.slip_no }))) return;
    setVoidingId(row.id);
    try {
      await voidIntakeDispatchSlip(row.id);
      showToast({ type: 'success', message: t('void.success') });
      await load();
    } catch (e) {
      showToast({ type: 'error', message: e instanceof ApiRequestError ? e.message : t('void.failed') });
    } finally {
      setVoidingId(null);
    }
  };

  return (
    <div className="p-4 space-y-4" dir="rtl">
      <div>
        <h2 className="text-lg font-black text-slate-900">{t('dispatchSlipsTitle')}</h2>
        <p className="text-sm text-slate-500">{t('dispatchSlipsSubtitle')}</p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="p-3 text-right font-bold">{t('colSlipNo')}</th>
              <th className="p-3 text-right font-bold">{t('colOrderNo')}</th>
              <th className="p-3 text-right font-bold">{t('colSlipType')}</th>
              <th className="p-3 text-right font-bold">{t('colSupplier')}</th>
              <th className="p-3 text-right font-bold">{t('colWarehouse')}</th>
              <th className="p-3 text-right font-bold">{t('colPricing')}</th>
              <th className="p-3 text-right font-bold">{t('colStatus')}</th>
              <th className="p-3 text-right font-bold w-56">{t('colActions')}</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={8} className="p-6 text-center text-slate-500"><Loader2 className="w-5 h-5 animate-spin inline ml-2" />{t('loading')}</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={8} className="p-6 text-center text-slate-500">{t('noSlipsYet')}</td></tr>
            )}
            {rows.map((row) => {
              const isVoid = row.operation_status === 'VOID';
              return (
              <tr key={row.id} className={`border-t border-slate-100 hover:bg-slate-50/70 ${isVoid ? 'opacity-60' : ''}`}>
                <td className="p-3 font-mono font-bold text-indigo-700" dir="ltr">{row.slip_no}</td>
                <td className="p-3 font-mono text-slate-600" dir="ltr">{row.order_no}</td>
                <td className="p-3">{row.slip_type === 'STOCK' ? t('actionStock') : t('actionPurchase')}</td>
                <td className="p-3 text-slate-700">{row.supplier_name}</td>
                <td className="p-3 text-slate-700">{row.warehouse_name}</td>
                <td className="p-3 text-slate-600">{row.priced_line_count}/{row.line_count}</td>
                <td className="p-3">
                  {isVoid ? (
                    <span className="inline-flex items-center rounded-full bg-rose-100 px-2.5 py-1 text-xs font-bold text-rose-700">
                      {t('void.statusBadge')}
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-700">
                      {t('void.statusActive')}
                    </span>
                  )}
                </td>
                <td className="p-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      disabled={isVoid}
                      onClick={() => void openPricing(row.id)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-white disabled:opacity-40"
                    >
                      <Tag className="w-3.5 h-3.5" />
                      {t('priceButton')}
                    </button>
                    <button
                      type="button"
                      disabled={printingId === row.id}
                      onClick={() => void handlePrint(row.id)}
                      className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-black disabled:opacity-50"
                    >
                      {printingId === row.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Printer className="w-3.5 h-3.5" />}
                      {t('print.button')}
                    </button>
                    {!isVoid && (
                      <button
                        type="button"
                        disabled={voidingId === row.id}
                        onClick={() => void handleVoid(row)}
                        className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-2.5 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                      >
                        {voidingId === row.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Ban className="w-3.5 h-3.5" />}
                        {t('void.button')}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {openSlipId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" dir="rtl">
          <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full border border-slate-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 bg-indigo-50">
              <h4 className="font-bold text-slate-900">{t('pricingModalTitle')}</h4>
            </div>
            <div className="p-5 max-h-[60vh] overflow-auto">
              {detailLoading ? (
                <div className="text-center text-slate-500 py-6"><Loader2 className="w-5 h-5 animate-spin inline ml-2" />{t('loading')}</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-slate-500">
                      <th className="p-2 text-right">{t('colBarcode')}</th>
                      <th className="p-2 text-right">{t('colItem')}</th>
                      <th className="p-2 text-right">{t('colColor')}</th>
                      <th className="p-2 text-right">{t('colLength')}</th>
                      <th className="p-2 text-right">{t('colUnitPrice')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => (
                      <tr key={l.id} className="border-t border-slate-100">
                        <td className="p-2 font-mono" dir="ltr">{l.barcode}</td>
                        <td className="p-2">{l.item_name}</td>
                        <td className="p-2">{l.color_name_ar || '—'}</td>
                        <td className="p-2 font-mono">{Number(l.length_m).toFixed(2)}</td>
                        <td className="p-2">
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            value={prices[l.id] ?? ''}
                            onChange={(e) => setPrices((prev) => ({ ...prev, [l.id]: e.target.value }))}
                            className="w-24 rounded border border-slate-200 px-2 py-1 text-sm font-mono"
                            dir="ltr"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="px-5 py-4 border-t border-slate-200 flex justify-end gap-2 bg-slate-50">
              <button
                type="button"
                onClick={() => setOpenSlipId(null)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700"
              >
                {t('cancel')}
              </button>
              <button
                type="button"
                disabled={saving || detailLoading}
                onClick={() => void savePrices()}
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

export default IntakeDispatchSlips;
