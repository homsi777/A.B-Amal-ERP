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
