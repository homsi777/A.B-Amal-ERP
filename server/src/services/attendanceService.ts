import type { PoolClient } from 'pg';
import { getPool } from '../db/pool.js';

type ServiceErrorCode = 'VALIDATION' | 'NOT_FOUND';

function fail(message: string, code: ServiceErrorCode): never {
  throw Object.assign(new Error(message), { code });
}

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export type AttendanceImportRowInput = {
  fingerprintCode: string;
  nameInFile: string;
  attendanceDate: string;
  checkInTime?: string | null;
  checkOutTime?: string | null;
  totalHours: number;
};

export type AttendanceImportResult = {
  imported: number;
  updated: number;
  protectedSkipped: number;
  unmatched: Array<{ fingerprintCode: string; nameInFile: string; count: number }>;
};

/** يستورد صفوف حضور يومية (مُحلَّلة مسبقاً بالمتصفح من ملف بصمة متعدد الأوراق)
 * — يربط كل صف برقم بصمة الموظف (لا بالاسم)، يتجاوز أي سجل يوم تم تعديله يدوياً
 * من قبل (source='MANUAL') بدل استبداله صمتاً، ويُرجع قائمة أرقام بصمة غير
 * مرتبطة بأي موظف لمراجعتها. */
export async function importAttendanceRows(
  client: PoolClient,
  input: { companyId: string; fileName: string; rows: AttendanceImportRowInput[] },
): Promise<AttendanceImportResult> {
  if (!input.rows.length) fail('لا توجد صفوف للاستيراد', 'VALIDATION');

  const employees = await client.query<{ id: string; fingerprint_code: string }>(
    `SELECT id, fingerprint_code FROM payroll_employees WHERE company_id = $1 AND fingerprint_code IS NOT NULL`,
    [input.companyId],
  );
  const employeeByFingerprint = new Map(employees.rows.map((e) => [e.fingerprint_code, e.id]));

  let imported = 0;
  let updated = 0;
  let protectedSkipped = 0;
  const unmatchedCounts = new Map<string, { nameInFile: string; count: number }>();

  for (const row of input.rows) {
    const employeeId = employeeByFingerprint.get(row.fingerprintCode);
    if (!employeeId) {
      const existing = unmatchedCounts.get(row.fingerprintCode);
      if (existing) existing.count++;
      else unmatchedCounts.set(row.fingerprintCode, { nameInFile: row.nameInFile, count: 1 });
      continue;
    }

    const existingRecord = await client.query<{ id: string; source: string }>(
      `SELECT id, source FROM attendance_daily_records WHERE company_id=$1 AND employee_id=$2 AND attendance_date=$3::date`,
      [input.companyId, employeeId, row.attendanceDate],
    );
    if (existingRecord.rows.length && existingRecord.rows[0].source === 'MANUAL') {
      protectedSkipped++;
      continue;
    }

    if (existingRecord.rows.length) {
      await client.query(
        `UPDATE attendance_daily_records
         SET check_in_time=$1, check_out_time=$2, total_hours=$3, source='IMPORTED', source_file=$4, updated_at=now()
         WHERE id=$5`,
        [row.checkInTime ?? null, row.checkOutTime ?? null, round2(row.totalHours), input.fileName, existingRecord.rows[0].id],
      );
      updated++;
    } else {
      await client.query(
        `INSERT INTO attendance_daily_records (company_id, employee_id, attendance_date, check_in_time, check_out_time, total_hours, source, source_file)
         VALUES ($1,$2,$3::date,$4,$5,$6,'IMPORTED',$7)`,
        [input.companyId, employeeId, row.attendanceDate, row.checkInTime ?? null, row.checkOutTime ?? null, round2(row.totalHours), input.fileName],
      );
      imported++;
    }
  }

  return {
    imported,
    updated,
    protectedSkipped,
    unmatched: Array.from(unmatchedCounts.entries()).map(([fingerprintCode, v]) => ({
      fingerprintCode,
      nameInFile: v.nameInFile,
      count: v.count,
    })),
  };
}

export async function listAttendanceRecords(
  companyId: string,
  filters: { employeeId?: string; dateFrom?: string; dateTo?: string },
) {
  const pool = getPool();
  const conditions = ['ar.company_id = $1'];
  const params: unknown[] = [companyId];
  if (filters.employeeId) {
    params.push(filters.employeeId);
    conditions.push(`ar.employee_id = $${params.length}`);
  }
  if (filters.dateFrom) {
    params.push(filters.dateFrom);
    conditions.push(`ar.attendance_date >= $${params.length}::date`);
  }
  if (filters.dateTo) {
    params.push(filters.dateTo);
    conditions.push(`ar.attendance_date <= $${params.length}::date`);
  }
  const res = await pool.query(
    `SELECT ar.id, ar.employee_id, e.employee_code, e.full_name, ar.attendance_date,
            ar.check_in_time, ar.check_out_time, ar.late_minutes, ar.permission_minutes,
            ar.total_hours, ar.day_type, ar.source, ar.source_file, ar.edited_at, ar.edit_reason,
            u.username AS edited_by
     FROM attendance_daily_records ar
     JOIN payroll_employees e ON e.id = ar.employee_id
     LEFT JOIN users u ON u.id = ar.edited_by_user_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY ar.attendance_date DESC, e.full_name ASC
     LIMIT 2000`,
    params,
  );
  return res.rows;
}

export async function updateAttendanceRecordManual(
  client: PoolClient,
  input: {
    companyId: string;
    userId: string | null;
    id: string;
    checkInTime?: string | null;
    checkOutTime?: string | null;
    lateMinutes?: number;
    permissionMinutes?: number;
    dayType?: 'WORK' | 'REST' | 'HOLIDAY';
    reason: string;
  },
) {
  if (!input.reason?.trim()) fail('سبب التعديل مطلوب', 'VALIDATION');

  const existing = await client.query<{ check_in_time: string | null; check_out_time: string | null }>(
    `SELECT check_in_time, check_out_time FROM attendance_daily_records WHERE id=$1 AND company_id=$2`,
    [input.id, input.companyId],
  );
  if (!existing.rows.length) fail('سجل الحضور غير موجود', 'NOT_FOUND');

  const checkInTime = input.checkInTime !== undefined ? input.checkInTime : existing.rows[0].check_in_time;
  const checkOutTime = input.checkOutTime !== undefined ? input.checkOutTime : existing.rows[0].check_out_time;
  let totalHours = 0;
  if (checkInTime && checkOutTime) {
    const [ih, im] = String(checkInTime).split(':').map(Number);
    const [oh, om] = String(checkOutTime).split(':').map(Number);
    let diff = (oh * 60 + om) - (ih * 60 + im);
    if (diff < 0) diff += 24 * 60;
    totalHours = round2(diff / 60);
  }

  const row = await client.query(
    `UPDATE attendance_daily_records SET
       check_in_time = COALESCE($3, check_in_time),
       check_out_time = COALESCE($4, check_out_time),
       late_minutes = COALESCE($5, late_minutes),
       permission_minutes = COALESCE($6, permission_minutes),
       total_hours = $7,
       day_type = COALESCE($8, day_type),
       source = 'MANUAL',
       edited_by_user_id = $9,
       edited_at = now(),
       edit_reason = $10,
       updated_at = now()
     WHERE id=$1 AND company_id=$2
     RETURNING *`,
    [
      input.id,
      input.companyId,
      input.checkInTime ?? null,
      input.checkOutTime ?? null,
      input.lateMinutes ?? null,
      input.permissionMinutes ?? null,
      totalHours,
      input.dayType ?? null,
      input.userId,
      input.reason.trim(),
    ],
  );
  return row.rows[0];
}
