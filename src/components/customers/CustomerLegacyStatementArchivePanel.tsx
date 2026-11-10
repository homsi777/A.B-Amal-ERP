import React, { useEffect, useState } from 'react';
import { AlertTriangle, ChevronLeft, Loader2, Trash2 } from 'lucide-react';
import {
  deleteCustomerLegacyStatementBatch,
  getCustomerLegacyStatementBatchEntries,
  listCustomerLegacyStatementBatches,
  type LegacyStatementBatchSummary,
  type LegacyStatementEntryRow,
} from '../../lib/api/customerLegacyStatementApi';
import i18n from '../../i18n/config';

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, { ns: 'customerLegacyStatement', ...options });

interface Props {
  customerId: string;
  refreshKey: number;
}

function money(value: string | number | null | undefined): string {
  const n = Number(value ?? 0);
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type EntryGroup = { header: LegacyStatementEntryRow; details: LegacyStatementEntryRow[] };

function groupEntries(entries: LegacyStatementEntryRow[]): EntryGroup[] {
  const byHeader = new Map<number, EntryGroup>();
  const order: number[] = [];
  for (const entry of entries) {
    const key = entry.header_row_index;
    if (!byHeader.has(key)) {
      const headerEntry = entries.find((e) => e.row_index === key) ?? entry;
      byHeader.set(key, { header: headerEntry, details: [] });
      order.push(key);
    }
    if (entry.row_index !== key) byHeader.get(key)!.details.push(entry);
  }
  return order.map((key) => byHeader.get(key)!);
}

export function CustomerLegacyStatementArchivePanel({ customerId, refreshKey }: Props) {
  const [batches, setBatches] = useState<LegacyStatementBatchSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [entries, setEntries] = useState<LegacyStatementEntryRow[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!customerId) {
      setBatches([]);
      return;
    }
    setLoading(true);
    listCustomerLegacyStatementBatches(customerId)
      .then(setBatches)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [customerId, refreshKey]);

  async function openBatch(batchId: string) {
    setSelectedBatchId(batchId);
    setEntriesLoading(true);
    setError(null);
    try {
      const rows = await getCustomerLegacyStatementBatchEntries(batchId);
      setEntries(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setEntriesLoading(false);
    }
  }

  async function handleDelete(batchId: string) {
    if (!window.confirm(t('archive.deleteConfirm'))) return;
    await deleteCustomerLegacyStatementBatch(batchId);
    setBatches((prev) => prev.filter((b) => b.id !== batchId));
    if (selectedBatchId === batchId) {
      setSelectedBatchId(null);
      setEntries([]);
    }
  }

  if (!customerId) return null;

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t('archive.loading')}
      </div>
    );
  }

  if (!batches.length) {
    return <div className="p-4 text-sm text-slate-500">{t('archive.empty')}</div>;
  }

  if (selectedBatchId) {
    const groups = groupEntries(entries);
    return (
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => {
            setSelectedBatchId(null);
            setEntries([]);
          }}
          className="inline-flex items-center gap-1 text-sm font-bold text-indigo-600 hover:text-indigo-800"
        >
          <ChevronLeft className="h-4 w-4" />
          {t('archive.back')}
        </button>

        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
          <AlertTriangle className="h-4 w-4" />
          {t('archive.notice')}
        </div>

        {entriesLoading ? (
          <div className="flex items-center gap-2 p-4 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('archive.loading')}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs font-bold text-slate-500">
                <tr>
                  <th className="p-2 text-start">{t('table.document')}</th>
                  <th className="p-2 text-start">{t('table.date')}</th>
                  <th className="p-2 text-start">{t('table.description')}</th>
                  <th className="p-2 text-end">{t('table.quantity')}</th>
                  <th className="p-2 text-end">{t('table.unitPrice')}</th>
                  <th className="p-2 text-end">{t('table.lineTotal')}</th>
                  <th className="p-2 text-end">{t('table.debit')}</th>
                  <th className="p-2 text-end">{t('table.credit')}</th>
                  <th className="p-2 text-start">{t('table.warehouse')}</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => (
                  <React.Fragment key={group.header.row_index}>
                    <tr className="border-t border-slate-200 bg-indigo-50/60 font-bold text-slate-900">
                      <td className="p-2">{group.header.document_type || '—'} {group.header.document_no || ''}</td>
                      <td className="p-2">{group.header.document_date || '—'}</td>
                      <td className="p-2">{group.header.description || '—'}</td>
                      <td className="p-2 text-end">—</td>
                      <td className="p-2 text-end">—</td>
                      <td className="p-2 text-end">—</td>
                      <td className="p-2 text-end">{money(group.header.debit)}</td>
                      <td className="p-2 text-end">{money(group.header.credit)}</td>
                      <td className="p-2">—</td>
                    </tr>
                    {group.details.map((d) => (
                      <tr key={d.row_index} className="border-t border-slate-100 text-slate-600">
                        <td className="p-2"></td>
                        <td className="p-2"></td>
                        <td className="p-2">{d.description || '—'}</td>
                        <td className="p-2 text-end">{d.quantity ?? '—'}</td>
                        <td className="p-2 text-end">{d.unit_price ?? '—'}</td>
                        <td className="p-2 text-end">{d.line_total ?? '—'}</td>
                        <td className="p-2 text-end">—</td>
                        <td className="p-2 text-end">—</td>
                        <td className="p-2">{d.warehouse_name || '—'}</td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      {error && <div className="p-3 text-sm text-rose-600">{error}</div>}
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs font-bold text-slate-500">
          <tr>
            <th className="p-2 text-start">{t('archive.batchFile')}</th>
            <th className="p-2 text-start">{t('archive.batchDate')}</th>
            <th className="p-2 text-end">{t('archive.batchRows')}</th>
            <th className="p-2 text-end">{t('summary.closingBalance')}</th>
            <th className="p-2"></th>
          </tr>
        </thead>
        <tbody>
          {batches.map((batch) => (
            <tr key={batch.id} className="border-t border-slate-200">
              <td className="p-2 font-bold text-slate-800">{batch.fileName}</td>
              <td className="p-2 text-slate-500">{new Date(batch.createdAt).toLocaleDateString()}</td>
              <td className="p-2 text-end">{batch.rowCount.toLocaleString()}</td>
              <td className="p-2 text-end">{money(batch.closingBalanceDebit)} / {money(batch.closingBalanceCredit)}</td>
              <td className="p-2">
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => void openBatch(batch.id)} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-700">
                    {t('archive.view')}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(batch.id)}
                    className="rounded-lg border border-rose-200 p-1.5 text-rose-600 hover:bg-rose-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
