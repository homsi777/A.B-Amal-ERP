import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';
import {
  listOpenDispatchBalances,
  listOpenDispatchLines,
  approveShortage,
  type OpenDispatchBalance,
  type OpenDispatchLine,
} from '../../lib/api/externalJobMatchingApi';
import { fetchMe, type AuthUser } from '../../lib/api/authApi';
import { ApiRequestError } from '../../lib/api/client';
import { useToast } from '../../components/NonBlockingToast';

export const ExternalJobMatching: React.FC = () => {
  const { t } = useTranslation('externalJobMatching');
  const { showToast } = useToast();

  const [rows, setRows] = useState<OpenDispatchBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [lines, setLines] = useState<OpenDispatchLine[]>([]);
  const [linesLoading, setLinesLoading] = useState(false);
  const [approveAmount, setApproveAmount] = useState('');
  const [approveNotes, setApproveNotes] = useState('');
  const [approving, setApproving] = useState(false);

  const canApprove = currentUser?.role === 'admin' || currentUser?.role === 'accountant';

  const load = async () => {
    setLoading(true);
    try {
      setRows(await listOpenDispatchBalances());
    } catch (e) {
      showToast({ type: 'error', message: e instanceof ApiRequestError ? e.message : t('loadFailed') });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    void fetchMe().then(setCurrentUser).catch(() => setCurrentUser(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleRow = async (row: OpenDispatchBalance) => {
    const key = `${row.supplier_id}:${row.fabric_item_id}`;
    if (openKey === key) {
      setOpenKey(null);
      return;
    }
    setOpenKey(key);
    setApproveAmount('');
    setApproveNotes('');
    setLinesLoading(true);
    try {
      setLines(await listOpenDispatchLines(row.supplier_id, row.fabric_item_id));
    } catch (e) {
      showToast({ type: 'error', message: e instanceof ApiRequestError ? e.message : t('loadFailed') });
    } finally {
      setLinesLoading(false);
    }
  };

  const submitApproval = async (row: OpenDispatchBalance) => {
    if (!approveAmount.trim()) return;
    setApproving(true);
    try {
      const result = await approveShortage({
        supplierId: row.supplier_id,
        fabricItemId: row.fabric_item_id,
        amountM: Number(approveAmount),
        notes: approveNotes.trim() || null,
      });
      showToast({ type: 'success', message: t('approvedSuccess', { amount: result.approvedM.toFixed(3) }) });
      setOpenKey(null);
      await load();
    } catch (e) {
      showToast({ type: 'error', message: e instanceof ApiRequestError ? e.message : t('approveFailed') });
    } finally {
      setApproving(false);
    }
  };

  return (
    <div className="p-4 space-y-4" dir="rtl">
      <div>
        <h2 className="text-lg font-black text-slate-900">{t('title')}</h2>
        <p className="text-sm text-slate-500">{t('subtitle')}</p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="p-3 text-right font-bold">{t('colSupplier')}</th>
              <th className="p-3 text-right font-bold">{t('colItem')}</th>
              <th className="p-3 text-right font-bold">{t('colSent')}</th>
              <th className="p-3 text-right font-bold">{t('colMatched')}</th>
              <th className="p-3 text-right font-bold">{t('colRemaining')}</th>
              <th className="p-3 text-right font-bold">{t('colOldest')}</th>
              <th className="p-3 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={7} className="p-6 text-center text-slate-500"><Loader2 className="w-5 h-5 animate-spin inline ml-2" />{t('loading')}</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={7} className="p-6 text-center text-slate-500">{t('emptyState')}</td></tr>
            )}
            {rows.map((row) => {
              const key = `${row.supplier_id}:${row.fabric_item_id}`;
              const isOpen = openKey === key;
              const remaining = Number(row.remaining_m);
              return (
                <React.Fragment key={key}>
                  <tr
                    onClick={() => void toggleRow(row)}
                    className="border-t border-slate-100 hover:bg-indigo-50/60 cursor-pointer"
                  >
                    <td className="p-3 font-bold text-slate-900">{row.supplier_name}</td>
                    <td className="p-3 text-slate-700">{row.item_name}</td>
                    <td className="p-3 font-mono text-slate-600">{Number(row.total_sent_m).toFixed(2)}</td>
                    <td className="p-3 font-mono text-slate-600">{Number(row.total_matched_m).toFixed(2)}</td>
                    <td className="p-3 font-mono font-bold text-amber-700">{remaining.toFixed(2)} {t('meterUnit')}</td>
                    <td className="p-3 text-slate-500 text-xs">{row.oldest_open_date}</td>
                    <td className="p-3 text-center text-slate-400">{isOpen ? <ChevronUp className="w-4 h-4 inline" /> : <ChevronDown className="w-4 h-4 inline" />}</td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={7} className="p-4 bg-slate-50 border-t border-slate-100">
                        {linesLoading ? (
                          <div className="text-center text-slate-500 py-4"><Loader2 className="w-4 h-4 animate-spin inline ml-2" />{t('loading')}</div>
                        ) : (
                          <div className="space-y-4">
                            <table className="w-full text-xs bg-white rounded-lg border border-slate-200 overflow-hidden">
                              <thead className="bg-slate-100 text-slate-500">
                                <tr>
                                  <th className="p-2 text-right">{t('colJobNo')}</th>
                                  <th className="p-2 text-right">{t('colDispatchDate')}</th>
                                  <th className="p-2 text-right">{t('colBarcode')}</th>
                                  <th className="p-2 text-right">{t('colSent')}</th>
                                  <th className="p-2 text-right">{t('colMatched')}</th>
                                  <th className="p-2 text-right">{t('colRemaining')}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {lines.map((l) => (
                                  <tr key={l.id} className="border-t border-slate-100">
                                    <td className="p-2 font-mono text-indigo-700">{l.job_no}</td>
                                    <td className="p-2 text-slate-600">{l.sent_date}</td>
                                    <td className="p-2 font-mono">{l.barcode}</td>
                                    <td className="p-2 font-mono">{Number(l.sent_length_m).toFixed(2)}</td>
                                    <td className="p-2 font-mono">{Number(l.matched_length_m).toFixed(2)}</td>
                                    <td className="p-2 font-mono font-bold text-amber-700">{Number(l.remaining_m).toFixed(2)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>

                            {canApprove ? (
                              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2">
                                <div className="flex items-center gap-1.5 text-xs font-bold text-amber-800">
                                  <AlertTriangle className="w-3.5 h-3.5" />
                                  {t('approveShortageTitle')}
                                </div>
                                <div className="flex flex-wrap gap-2 items-end">
                                  <div className="space-y-1">
                                    <label className="text-xs text-slate-600">{t('approveAmountLabel')}</label>
                                    <input
                                      type="number"
                                      min={0}
                                      max={remaining}
                                      step="0.001"
                                      value={approveAmount}
                                      onChange={(e) => setApproveAmount(e.target.value)}
                                      className="w-32 rounded border border-slate-300 px-2 py-1.5 text-sm"
                                      dir="ltr"
                                    />
                                  </div>
                                  <div className="flex-1 min-w-[200px] space-y-1">
                                    <label className="text-xs text-slate-600">{t('approveNotesLabel')}</label>
                                    <input
                                      value={approveNotes}
                                      onChange={(e) => setApproveNotes(e.target.value)}
                                      className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                                    />
                                  </div>
                                  <button
                                    type="button"
                                    disabled={approving || !approveAmount.trim()}
                                    onClick={() => void submitApproval(row)}
                                    className="rounded-lg bg-amber-700 px-4 py-1.5 text-sm font-bold text-white hover:bg-amber-800 disabled:opacity-50"
                                  >
                                    {approving ? t('approving') : t('approveButton')}
                                  </button>
                                </div>
                                <p className="text-[11px] text-amber-700">{t('approveNote')}</p>
                              </div>
                            ) : (
                              <p className="text-xs text-slate-500">{t('noApprovalPermission')}</p>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ExternalJobMatching;
