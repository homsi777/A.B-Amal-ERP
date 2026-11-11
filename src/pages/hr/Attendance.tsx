import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, Loader2, Pencil, Upload, X } from 'lucide-react';
import {
  listAttendanceRecords,
  importAttendanceFile,
  updateAttendanceRecord,
  listShiftTypes,
  createShiftType,
  type AttendanceRecordDto,
  type AttendanceImportResultDto,
  type ShiftTypeDto,
} from '../../lib/api/attendanceApi';
import { listPayrollEmployees, type PayrollEmployeeDto } from '../../lib/api/payrollApi';
import { parseAttendanceWorkbook } from '../../lib/hrAttendanceExcelParser';
import { usePermissions } from '../../hooks/usePermissions';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function firstOfMonthIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

const inputCls = 'w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';

function ImportModal({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported: () => void }) {
  const { t } = useTranslation('hrAttendance');
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [rowCount, setRowCount] = useState(0);
  const [sheetsProcessed, setSheetsProcessed] = useState(0);
  const [parsedRows, setParsedRows] = useState<Awaited<ReturnType<typeof parseAttendanceWorkbook>>['rows']>([]);
  const [loadingFile, setLoadingFile] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AttendanceImportResultDto | null>(null);

  if (!open) return null;

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    setResult(null);
    setFileName(file.name);
    setLoadingFile(true);
    try {
      const parsed = await parseAttendanceWorkbook(file);
      setParsedRows(parsed.rows);
      setRowCount(parsed.rows.length);
      setSheetsProcessed(parsed.sheetsProcessed);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('modal.parseFailed'));
    } finally {
      setLoadingFile(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function handleConfirm() {
    if (!parsedRows.length) return;
    setImporting(true);
    setError(null);
    try {
      const res = await importAttendanceFile(fileName, parsedRows);
      setResult(res.data);
      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('modal.importFailed'));
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-slate-950/55 p-4">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h3 className="text-lg font-black text-slate-900">{t('modal.importTitle')}</h3>
            <p className="mt-1 text-xs text-slate-500">{t('modal.importSubtitle')}</p>
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
              {t('modal.chooseFile')}
            </button>
            <span className="text-sm text-slate-500">{fileName || t('modal.noFileChosen')}</span>
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              <AlertTriangle className="h-4 w-4" />
              {error}
            </div>
          )}

          {result && (
            <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" />
                {t('modal.importSuccess', { imported: result.imported, updated: result.updated })}
              </div>
              {result.protectedSkipped > 0 && <div>{t('modal.protectedSkipped', { count: result.protectedSkipped })}</div>}
              {result.unmatched.length > 0 && (
                <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs font-normal text-amber-800">
                  <div className="font-bold">{t('modal.unmatchedTitle', { count: result.unmatched.length })}</div>
                  <ul className="mt-1 list-inside list-disc space-y-0.5">
                    {result.unmatched.map((u) => (
                      <li key={u.fingerprintCode}>{t('modal.unmatchedRow', { code: u.fingerprintCode, name: u.nameInFile, count: u.count })}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {!result && parsedRows.length > 0 && (
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="text-xs font-bold text-slate-500">{t('modal.summaryRows')}</div>
                <div className="mt-1 text-sm font-black text-slate-900">{rowCount.toLocaleString()}</div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="text-xs font-bold text-slate-500">{t('modal.summarySheets')}</div>
                <div className="mt-1 text-sm font-black text-slate-900">{sheetsProcessed}</div>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 font-bold text-slate-600 hover:bg-slate-50">
              {t('modal.close')}
            </button>
            {!result && (
              <button
                type="button"
                onClick={() => void handleConfirm()}
                disabled={importing || !parsedRows.length}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 font-bold text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {importing && <Loader2 className="h-4 w-4 animate-spin" />}
                {importing ? t('modal.importing') : t('modal.confirmImport')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function EditModal({
  record,
  onClose,
  onSaved,
}: {
  record: AttendanceRecordDto | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation('hrAttendance');
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [late, setLate] = useState('0');
  const [permission, setPermission] = useState('0');
  const [dayType, setDayType] = useState<'WORK' | 'REST' | 'HOLIDAY'>('WORK');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!record) return;
    setCheckIn(record.check_in_time?.slice(0, 5) || '');
    setCheckOut(record.check_out_time?.slice(0, 5) || '');
    setLate(record.late_minutes || '0');
    setPermission(record.permission_minutes || '0');
    setDayType(record.day_type);
    setReason('');
    setError(null);
  }, [record]);

  if (!record) return null;

  async function handleSave() {
    if (!reason.trim()) {
      setError(t('errors.reasonRequired'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updateAttendanceRecord(record.id, {
        checkInTime: checkIn ? `${checkIn}:00` : null,
        checkOutTime: checkOut ? `${checkOut}:00` : null,
        lateMinutes: Number(late) || 0,
        permissionMinutes: Number(permission) || 0,
        dayType,
        reason: reason.trim(),
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-slate-950/55 p-4">
      <div className="w-full max-w-md overflow-y-auto rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h3 className="text-base font-black text-slate-900">
            {t('editModal.title', { name: record.full_name, date: record.attendance_date.slice(0, 10) })}
          </h3>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-3 p-5">
          {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-600">{t('editModal.checkIn')}</label>
              <input type="time" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} className={`mt-1 ${inputCls}`} />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-600">{t('editModal.checkOut')}</label>
              <input type="time" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} className={`mt-1 ${inputCls}`} />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-600">{t('editModal.late')}</label>
              <input type="number" min="0" value={late} onChange={(e) => setLate(e.target.value)} className={`mt-1 ${inputCls}`} dir="ltr" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-600">{t('editModal.permission')}</label>
              <input type="number" min="0" value={permission} onChange={(e) => setPermission(e.target.value)} className={`mt-1 ${inputCls}`} dir="ltr" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-bold text-slate-600">{t('editModal.dayType')}</label>
              <select value={dayType} onChange={(e) => setDayType(e.target.value as typeof dayType)} className={`mt-1 ${inputCls} bg-white`}>
                <option value="WORK">{t('dayType.WORK')}</option>
                <option value="REST">{t('dayType.REST')}</option>
                <option value="HOLIDAY">{t('dayType.HOLIDAY')}</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-bold text-slate-600">{t('editModal.reason')}</label>
              <input value={reason} onChange={(e) => setReason(e.target.value)} className={`mt-1 ${inputCls}`} />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 font-bold text-slate-600 hover:bg-slate-50">
              {t('editModal.cancel')}
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 font-bold text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {saving ? t('editModal.saving') : t('editModal.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ShiftTypesPanel() {
  const { t } = useTranslation('hrAttendance');
  const [open, setOpen] = useState(false);
  const [shiftTypes, setShiftTypes] = useState<ShiftTypeDto[]>([]);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [startTime, setStartTime] = useState('08:00');
  const [endTime, setEndTime] = useState('17:00');
  const [crossesMidnight, setCrossesMidnight] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const res = await listShiftTypes();
      setShiftTypes(res.data);
    } catch {
      setShiftTypes([]);
    }
  }

  useEffect(() => {
    if (open) void load();
  }, [open]);

  async function handleCreate() {
    if (!code.trim() || !name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await createShiftType({ code: code.trim(), name: name.trim(), startTime, endTime, crossesMidnight });
      setCode('');
      setName('');
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <button type="button" onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between p-4 text-start font-black text-slate-800 hover:bg-slate-50">
        <span>{t('shiftTypes.title')}</span>
        <span className="text-xs font-bold text-slate-400">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="border-t border-slate-200 p-4 space-y-3">
          {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>}
          <ul className="space-y-1 text-sm">
            {shiftTypes.map((s) => (
              <li key={s.id} className="flex justify-between rounded-lg border border-slate-100 px-3 py-1.5">
                <span className="font-bold">{s.name} ({s.code})</span>
                <span className="text-slate-500" dir="ltr">{s.start_time.slice(0, 5)} - {s.end_time.slice(0, 5)}{s.crosses_midnight ? ' ↷' : ''}</span>
              </li>
            ))}
            {shiftTypes.length === 0 && <li className="text-xs text-slate-400">{t('shiftTypes.empty')}</li>}
          </ul>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder={t('shiftTypes.code')} className={inputCls} />
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('shiftTypes.name')} className={inputCls} />
            <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className={inputCls} />
            <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className={inputCls} />
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={crossesMidnight} onChange={(e) => setCrossesMidnight(e.target.checked)} />
              {t('shiftTypes.crossesMidnight')}
            </label>
          </div>
          <button type="button" onClick={() => void handleCreate()} disabled={saving} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-60">
            {t('shiftTypes.add')}
          </button>
        </div>
      )}
    </div>
  );
}

export function Attendance() {
  const { t } = useTranslation('hrAttendance');
  const { has: hasPermission } = usePermissions();
  const canManage = hasPermission('attendance.manage');
  const [records, setRecords] = useState<AttendanceRecordDto[]>([]);
  const [employees, setEmployees] = useState<PayrollEmployeeDto[]>([]);
  const [employeeId, setEmployeeId] = useState('');
  const [dateFrom, setDateFrom] = useState(firstOfMonthIso());
  const [dateTo, setDateTo] = useState(todayIso());
  const [loading, setLoading] = useState(true);
  const [importOpen, setImportOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<AttendanceRecordDto | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await listAttendanceRecords({ employeeId: employeeId || undefined, dateFrom, dateTo });
      setRecords(res.data);
    } catch {
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    listPayrollEmployees({}).then((res) => setEmployees(res.data)).catch(() => setEmployees([]));
  }, []);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId, dateFrom, dateTo]);

  const employeeOptions = useMemo(() => employees, [employees]);

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">{t('page.title')}</h2>
          <p className="mt-1 text-slate-500">{t('page.subtitle')}</p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 font-bold text-white hover:bg-indigo-700"
          >
            <Upload className="h-4 w-4" />
            {t('toolbar.importFile')}
          </button>
        )}
      </div>

      {canManage && <ShiftTypesPanel />}

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div>
          <label className="block text-xs font-bold text-slate-600">{t('filters.employee')}</label>
          <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className={`mt-1 ${inputCls} bg-white`}>
            <option value="">{t('filters.allEmployees')}</option>
            {employeeOptions.map((e) => (
              <option key={e.id} value={e.id}>
                {e.full_name} ({e.employee_code})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-600">{t('filters.dateFrom')}</label>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={`mt-1 ${inputCls}`} />
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-600">{t('filters.dateTo')}</label>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={`mt-1 ${inputCls}`} />
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <div className="flex items-center gap-2 p-6 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs font-bold text-slate-500">
              <tr>
                <th className="p-3 text-start">{t('table.date')}</th>
                <th className="p-3 text-start">{t('table.employeeCode')}</th>
                <th className="p-3 text-start">{t('table.fullName')}</th>
                <th className="p-3 text-start">{t('table.checkIn')}</th>
                <th className="p-3 text-start">{t('table.checkOut')}</th>
                <th className="p-3 text-end">{t('table.totalHours')}</th>
                <th className="p-3 text-end">{t('table.late')}</th>
                <th className="p-3 text-end">{t('table.permission')}</th>
                <th className="p-3 text-start">{t('table.dayType')}</th>
                <th className="p-3 text-start">{t('table.source')}</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="p-3">{r.attendance_date.slice(0, 10)}</td>
                  <td className="p-3 font-mono text-xs">{r.employee_code}</td>
                  <td className="p-3 font-bold text-slate-800">{r.full_name}</td>
                  <td className="p-3">{r.check_in_time?.slice(0, 5) || '—'}</td>
                  <td className="p-3">{r.check_out_time?.slice(0, 5) || '—'}</td>
                  <td className="p-3 text-end">{Number(r.total_hours).toFixed(2)}</td>
                  <td className="p-3 text-end">{Number(r.late_minutes).toFixed(0)}</td>
                  <td className="p-3 text-end">{Number(r.permission_minutes).toFixed(0)}</td>
                  <td className="p-3">{t(`dayType.${r.day_type}`)}</td>
                  <td className="p-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${r.source === 'MANUAL' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>
                      {t(`source.${r.source}`)}
                    </span>
                  </td>
                  <td className="p-3">
                    {canManage && (
                      <button type="button" onClick={() => setEditingRecord(r)} className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50" title={t('actions.edit')}>
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} onImported={() => void load()} />
      <EditModal record={editingRecord} onClose={() => setEditingRecord(null)} onSaved={() => void load()} />
    </div>
  );
}
