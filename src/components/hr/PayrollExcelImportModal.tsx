import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, Upload, X } from 'lucide-react';
import { parsePayrollWorkbook, type ParsedPayrollExcel } from '../../lib/hrPayrollExcelParser';
import { importPayrollExcel, type ImportPayrollExcelResult } from '../../lib/api/payrollApi';
import { listExchangeRates, type ExchangeRateDto } from '../../lib/api/exchangeRatesApi';

interface Props {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}

function currentMonth(): number {
  return new Date().getMonth() + 1;
}
function currentYear(): number {
  return new Date().getFullYear();
}

export function PayrollExcelImportModal({ open, onClose, onImported }: Props) {
  const { t } = useTranslation('salaries');
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState<ParsedPayrollExcel | null>(null);
  const [departmentLabel, setDepartmentLabel] = useState('');
  const [periodMonth, setPeriodMonth] = useState(currentMonth());
  const [periodYear, setPeriodYear] = useState(currentYear());
  const [currencyCode, setCurrencyCode] = useState('USD');
  const [exchangeRateToUsd, setExchangeRateToUsd] = useState('');
  const [currencies, setCurrencies] = useState<ExchangeRateDto[]>([]);
  const [loadingFile, setLoadingFile] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportPayrollExcelResult | null>(null);

  useEffect(() => {
    if (!open) return;
    listExchangeRates().then((res) => setCurrencies(res.data)).catch(() => setCurrencies([]));
  }, [open]);

  if (!open) return null;

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    setResult(null);
    setFileName(file.name);
    setLoadingFile(true);
    try {
      const res = await parsePayrollWorkbook(file);
      setParsed(res);
      if (!departmentLabel.trim()) setDepartmentLabel(file.name.replace(/\.xlsx?$/i, ''));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('payrollImport.parseFailed'));
    } finally {
      setLoadingFile(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function handleConfirm() {
    if (!parsed) return;
    const rate = currencyCode === 'USD' ? 1 : Number(exchangeRateToUsd);
    if (!departmentLabel.trim()) {
      setError(t('payrollImport.departmentRequired'));
      return;
    }
    if (currencyCode !== 'USD' && !(rate > 0)) {
      setError(t('payrollImport.exchangeRateRequired'));
      return;
    }
    setImporting(true);
    setError(null);
    try {
      const res = await importPayrollExcel({
        departmentLabel: departmentLabel.trim(),
        periodMonth,
        periodYear,
        currencyCode,
        exchangeRateToUsd: rate,
        fileName,
        rows: parsed.rows,
      });
      setResult(res.data);
      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('payrollImport.importFailed'));
    } finally {
      setImporting(false);
    }
  }

  const inputCls = 'w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-slate-950/55 p-4">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h3 className="text-lg font-black text-slate-900">{t('payrollImport.title')}</h3>
            <p className="mt-1 text-xs text-slate-500">{t('payrollImport.subtitle')}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div className="flex flex-wrap items-center gap-3">
            <input ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => void handleFileChange(e)} />
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={loadingFile || importing}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 font-bold text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {loadingFile ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {t('payrollImport.chooseFile')}
            </button>
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <FileSpreadsheet className="h-4 w-4" />
              <span>{fileName || t('payrollImport.noFileChosen')}</span>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              <AlertTriangle className="h-4 w-4" />
              {error}
            </div>
          )}

          {result && (
            <div className="space-y-1 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" />
                {t('payrollImport.importSuccess', { payrollNo: result.payrollNo })}
              </div>
              <div>{t('payrollImport.employeesCreated')}: {result.employeesCreated} — {t('payrollImport.employeesMatched')}: {result.employeesMatched}</div>
              <div>{t('payrollImport.totalNet')}: {result.totalNet.toLocaleString()} {currencyCode}</div>
            </div>
          )}

          {parsed && !result && (
            <div className="space-y-3">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                {t('payrollImport.employeesInFile')}: <strong>{parsed.rows.length}</strong>
              </div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                <div>
                  <label className="block text-xs font-bold text-slate-600">{t('payrollImport.departmentLabel')}</label>
                  <input
                    value={departmentLabel}
                    onChange={(e) => setDepartmentLabel(e.target.value)}
                    className={`mt-1 ${inputCls}`}
                    placeholder={t('payrollImport.departmentPlaceholder')}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600">{t('payrollImport.month')}</label>
                  <select value={periodMonth} onChange={(e) => setPeriodMonth(Number(e.target.value))} className={`mt-1 ${inputCls} bg-white`}>
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600">{t('payrollImport.year')}</label>
                  <input type="number" value={periodYear} onChange={(e) => setPeriodYear(Number(e.target.value))} className={`mt-1 ${inputCls}`} dir="ltr" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600">{t('payrollImport.currency')}</label>
                  <select value={currencyCode} onChange={(e) => setCurrencyCode(e.target.value)} className={`mt-1 ${inputCls} bg-white`}>
                    <option value="USD">USD</option>
                    {currencies.filter((c) => c.currency_code !== 'USD').map((c) => (
                      <option key={c.currency_code} value={c.currency_code}>{c.currency_code} — {c.currency_name_ar}</option>
                    ))}
                  </select>
                </div>
                {currencyCode !== 'USD' && (
                  <div>
                    <label className="block text-xs font-bold text-slate-600">{t('payrollImport.exchangeRate')}</label>
                    <input
                      type="number"
                      min="0"
                      step="0.0001"
                      value={exchangeRateToUsd}
                      onChange={(e) => setExchangeRateToUsd(e.target.value)}
                      placeholder={t('payrollImport.exchangeRatePlaceholder')}
                      className={`mt-1 ${inputCls}`}
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 font-bold text-slate-600 hover:bg-slate-50">
              {t('payrollImport.close')}
            </button>
            {parsed && !result && (
              <button
                type="button"
                onClick={() => void handleConfirm()}
                disabled={importing}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 font-bold text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {importing && <Loader2 className="h-4 w-4 animate-spin" />}
                {importing ? t('payrollImport.importing') : t('payrollImport.confirmImport')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
