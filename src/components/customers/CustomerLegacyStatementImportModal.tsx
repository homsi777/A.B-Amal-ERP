import React, { useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, Upload, X } from 'lucide-react';
import { parseLegacyStatementWorkbook, type ParsedLegacyStatement } from '../../lib/customerLegacyStatementExcelParser';
import { importCustomerLegacyStatementBatch } from '../../lib/api/customerLegacyStatementApi';
import i18n from '../../i18n/config';

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, { ns: 'customerLegacyStatement', ...options });

interface Props {
  open: boolean;
  customerId: string;
  onClose: () => void;
  onImported: () => void;
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="text-xs font-bold text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-black text-slate-900">{value}</div>
    </div>
  );
}

export function CustomerLegacyStatementImportModal({ open, customerId, onClose, onImported }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string>('');
  const [parsed, setParsed] = useState<ParsedLegacyStatement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [importing, setImporting] = useState(false);

  if (!open) return null;

  const money = (value: number) => value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    setMessage(null);
    setParsed(null);
    setFileName(file.name);
    setLoadingFile(true);
    try {
      const result = await parseLegacyStatementWorkbook(file);
      setParsed(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('modal.parseFailed'));
    } finally {
      setLoadingFile(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function handleConfirm() {
    if (!parsed) return;
    setImporting(true);
    setError(null);
    try {
      const batch = await importCustomerLegacyStatementBatch(customerId, {
        fileName,
        sheetName: parsed.sheetName,
        openingBalanceDebit: parsed.openingBalanceDebit,
        openingBalanceCredit: parsed.openingBalanceCredit,
        closingBalanceDebit: parsed.closingBalanceDebit,
        closingBalanceCredit: parsed.closingBalanceCredit,
        totalDebit: parsed.totalDebit,
        totalCredit: parsed.totalCredit,
        rows: parsed.rows,
      });
      const baseMessage = t('modal.importSuccess', { count: parsed.rows.length });
      const openingNote = batch.openingBalancePosted
        ? t('modal.openingBalancePosted')
        : batch.openingBalanceNote
          ? batch.openingBalanceNote
          : '';
      setMessage(openingNote ? `${baseMessage} ${openingNote}` : baseMessage);
      setParsed(null);
      setFileName('');
      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('modal.importFailed'));
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-slate-950/55 p-4">
      <div className="max-h-[92vh] w-full max-w-4xl overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h3 className="text-lg font-black text-slate-900">{t('modal.title')}</h3>
            <p className="mt-1 text-xs text-slate-500">{t('modal.subtitle')}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[calc(92vh-76px)] overflow-y-auto p-5">
          <div className="flex flex-wrap items-center gap-3">
            <input ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(event) => void handleFileChange(event)} />
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={loadingFile || importing}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 font-bold text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {loadingFile ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {t('modal.chooseFile')}
            </button>
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <FileSpreadsheet className="h-4 w-4" />
              <span>{fileName || t('modal.noFileChosen')}</span>
            </div>
          </div>

          {error && (
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              <AlertTriangle className="h-4 w-4" />
              {error}
            </div>
          )}
          {message && (
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">
              <CheckCircle2 className="h-4 w-4" />
              {message}
            </div>
          )}

          {parsed && (
            <div className="mt-5 space-y-4">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                <SummaryCard label={t('summary.rowCount')} value={parsed.rows.length.toLocaleString()} />
                <SummaryCard label={t('summary.openingBalance')} value={`${money(parsed.openingBalanceDebit)} / ${money(parsed.openingBalanceCredit)}`} />
                <SummaryCard label={t('summary.closingBalance')} value={`${money(parsed.closingBalanceDebit)} / ${money(parsed.closingBalanceCredit)}`} />
                <SummaryCard label={t('summary.totalDebit')} value={money(parsed.totalDebit)} />
                <SummaryCard label={t('summary.totalCredit')} value={money(parsed.totalCredit)} />
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="text-xs font-bold text-slate-500">{t('summary.documentTypes')}</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {Object.entries(parsed.documentTypeCounts).map(([type, count]) => (
                    <span key={type} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">
                      {type}: {count}
                    </span>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 font-bold text-slate-600 hover:bg-slate-50">
                  {t('modal.close')}
                </button>
                <button
                  type="button"
                  onClick={() => void handleConfirm()}
                  disabled={importing}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 font-bold text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                  {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  {importing ? t('modal.importing') : t('modal.confirmImport')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
