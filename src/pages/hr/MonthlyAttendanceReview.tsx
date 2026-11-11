import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Loader2 } from 'lucide-react';
import {
  listMonthlyAttendanceSummaries,
  approveMonthlyAttendanceReview,
  type MonthlyAttendanceSummaryDto,
} from '../../lib/api/attendanceApi';
import { usePermissions } from '../../hooks/usePermissions';

function currentMonth(): number {
  return new Date().getMonth() + 1;
}
function currentYear(): number {
  return new Date().getFullYear();
}

export function MonthlyAttendanceReview() {
  const { t } = useTranslation('hrAttendance');
  const { has: hasPermission } = usePermissions();
  const canApprove = hasPermission('attendance.approve');
  const [periodMonth, setPeriodMonth] = useState(currentMonth());
  const [periodYear, setPeriodYear] = useState(currentYear());
  const [rows, setRows] = useState<MonthlyAttendanceSummaryDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await listMonthlyAttendanceSummaries(periodMonth, periodYear);
      setRows(res.data);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodMonth, periodYear]);

  async function handleApprove(row: MonthlyAttendanceSummaryDto) {
    setApprovingId(row.employeeId);
    setError(null);
    try {
      await approveMonthlyAttendanceReview({ employeeId: row.employeeId, periodMonth, periodYear });
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.saveFailed'));
    } finally {
      setApprovingId(null);
    }
  }

  const months = useMemo(() => Array.from({ length: 12 }, (_, i) => i + 1), []);
  const years = useMemo(() => {
    const y = currentYear();
    return [y - 1, y, y + 1];
  }, []);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">{t('monthlyReview.title')}</h2>
        <p className="mt-1 text-slate-500">{t('monthlyReview.subtitle')}</p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div>
          <label className="block text-xs font-bold text-slate-600">{t('monthlyReview.month')}</label>
          <select value={periodMonth} onChange={(e) => setPeriodMonth(Number(e.target.value))} className="mt-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
            {months.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-600">{t('monthlyReview.year')}</label>
          <select value={periodYear} onChange={(e) => setPeriodYear(Number(e.target.value))} className="mt-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
      </div>

      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <div className="flex items-center gap-2 p-6 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs font-bold text-slate-500">
              <tr>
                <th className="p-3 text-start">{t('table.employeeCode')}</th>
                <th className="p-3 text-start">{t('table.fullName')}</th>
                <th className="p-3 text-end">{t('monthlyReview.daysPresent')}</th>
                <th className="p-3 text-end">{t('table.totalHours')}</th>
                <th className="p-3 text-end">{t('monthlyReview.totalLate')}</th>
                <th className="p-3 text-end">{t('monthlyReview.totalPermission')}</th>
                <th className="p-3 text-start">{t('monthlyReview.status')}</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.employeeId} className="border-t border-slate-100">
                  <td className="p-3 font-mono text-xs">{r.employeeCode}</td>
                  <td className="p-3 font-bold text-slate-800">{r.fullName}</td>
                  <td className="p-3 text-end">{r.daysPresent}</td>
                  <td className="p-3 text-end">{r.totalHours.toFixed(2)}</td>
                  <td className="p-3 text-end">{r.totalLateMinutes.toFixed(0)}</td>
                  <td className="p-3 text-end">{r.totalPermissionMinutes.toFixed(0)}</td>
                  <td className="p-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${r.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                      {t(`monthlyReview.status${r.status}`)}
                    </span>
                  </td>
                  <td className="p-3">
                    {r.status === 'DRAFT' && canApprove && (
                      <button
                        type="button"
                        onClick={() => void handleApprove(r)}
                        disabled={approvingId === r.employeeId}
                        className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-60"
                      >
                        {approvingId === r.employeeId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                        {t('monthlyReview.approve')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
