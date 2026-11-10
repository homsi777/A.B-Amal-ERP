import { apiFetch } from './client';
import type { AttendanceParsedRow } from '../hrAttendanceExcelParser';

export interface AttendanceRecordDto {
  id: string;
  employee_id: string;
  employee_code: string;
  full_name: string;
  attendance_date: string;
  check_in_time: string | null;
  check_out_time: string | null;
  late_minutes: string;
  permission_minutes: string;
  total_hours: string;
  day_type: 'WORK' | 'REST' | 'HOLIDAY';
  source: 'IMPORTED' | 'MANUAL';
  source_file: string | null;
  edited_at: string | null;
  edit_reason: string | null;
  edited_by: string | null;
}

export interface AttendanceImportResultDto {
  imported: number;
  updated: number;
  protectedSkipped: number;
  unmatched: Array<{ fingerprintCode: string; nameInFile: string; count: number }>;
}

export async function listAttendanceRecords(params: { employeeId?: string; dateFrom?: string; dateTo?: string } = {}) {
  const q = new URLSearchParams();
  if (params.employeeId) q.set('employeeId', params.employeeId);
  if (params.dateFrom) q.set('dateFrom', params.dateFrom);
  if (params.dateTo) q.set('dateTo', params.dateTo);
  const qs = q.toString() ? `?${q}` : '';
  return apiFetch<{ ok: boolean; data: AttendanceRecordDto[] }>(`/api/attendance${qs}`);
}

export async function importAttendanceFile(fileName: string, rows: AttendanceParsedRow[]) {
  return apiFetch<{ ok: boolean; data: AttendanceImportResultDto }>('/api/attendance/import', {
    method: 'POST',
    body: JSON.stringify({ fileName, rows }),
  });
}

export interface ShiftTypeDto {
  id: string;
  code: string;
  name: string;
  start_time: string;
  end_time: string;
  crosses_midnight: boolean;
}

export async function listShiftTypes() {
  return apiFetch<{ ok: boolean; data: ShiftTypeDto[] }>('/api/attendance/shift-types');
}

export async function createShiftType(payload: { code: string; name: string; startTime: string; endTime: string; crossesMidnight?: boolean }) {
  return apiFetch<{ ok: boolean; data: ShiftTypeDto }>('/api/attendance/shift-types', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export interface MonthlyAttendanceSummaryDto {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  periodMonth: number;
  periodYear: number;
  status: 'DRAFT' | 'APPROVED';
  daysPresent: number;
  totalHours: number;
  totalLateMinutes: number;
  totalPermissionMinutes: number;
  approvedAt: string | null;
  approvedBy: string | null;
  notes: string | null;
}

export async function listMonthlyAttendanceSummaries(periodMonth: number, periodYear: number, employeeId?: string) {
  const q = new URLSearchParams({ periodMonth: String(periodMonth), periodYear: String(periodYear) });
  if (employeeId) q.set('employeeId', employeeId);
  return apiFetch<{ ok: boolean; data: MonthlyAttendanceSummaryDto[] }>(`/api/attendance/monthly-review?${q}`);
}

export async function approveMonthlyAttendanceReview(payload: { employeeId: string; periodMonth: number; periodYear: number; notes?: string | null }) {
  return apiFetch<{ ok: boolean; data: unknown }>('/api/attendance/monthly-review/approve', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateAttendanceRecord(
  id: string,
  payload: {
    checkInTime?: string | null;
    checkOutTime?: string | null;
    lateMinutes?: number;
    permissionMinutes?: number;
    dayType?: 'WORK' | 'REST' | 'HOLIDAY';
    reason: string;
  },
) {
  return apiFetch<{ ok: boolean; data: AttendanceRecordDto }>(`/api/attendance/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}
