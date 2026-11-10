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

// ─── أنواع الشفتات ──────────────────────────────────────────────────────────

export async function listShiftTypes(companyId: string) {
  const pool = getPool();
  const res = await pool.query(
    `SELECT id, code, name, start_time, end_time, crosses_midnight FROM attendance_shift_types
     WHERE company_id=$1 ORDER BY name ASC`,
    [companyId],
  );
  return res.rows;
}

export async function createShiftType(
  client: PoolClient,
  input: { companyId: string; code: string; name: string; startTime: string; endTime: string; crossesMidnight: boolean },
) {
  const row = await client.query(
    `INSERT INTO attendance_shift_types (company_id, code, name, start_time, end_time, crosses_midnight)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [input.companyId, input.code.trim(), input.name.trim(), input.startTime, input.endTime, input.crossesMidnight],
  );
  return row.rows[0];
}

// ─── كشف الانتظام الشهري ────────────────────────────────────────────────────

function minutesBetween(a: string, b: string): number {
  const [ah, am] = a.split(':').map(Number);
  const [bh, bm] = b.split(':').map(Number);
  return bh * 60 + bm - (ah * 60 + am);
}

export type MonthlyAttendanceSummary = {
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
};

/** يحسب كشف انتظام شهري حيّاً من attendance_daily_records + الشفت المُعيَّن
 * للموظف (تأخير = دخول بعد بداية الشفت، إذن = خروج قبل نهاية الشفت) — أو يُعيد
 * السجل المُجمَّد إن كان الشهر معتمَداً مسبقاً لهذا الموظف. */
export async function computeMonthlyAttendanceSummaries(
  companyId: string,
  periodMonth: number,
  periodYear: number,
  employeeId?: string,
): Promise<MonthlyAttendanceSummary[]> {
  const pool = getPool();
  const employeesRes = await pool.query<{
    id: string;
    employee_code: string;
    full_name: string;
    shift_start: string | null;
    shift_end: string | null;
    shift_crosses_midnight: boolean | null;
  }>(
    `SELECT e.id, e.employee_code, e.full_name, s.start_time AS shift_start, s.end_time AS shift_end, s.crosses_midnight AS shift_crosses_midnight
     FROM payroll_employees e
     LEFT JOIN attendance_shift_types s ON s.id = e.shift_type_id
     WHERE e.company_id = $1 AND e.status = 'ACTIVE' ${employeeId ? 'AND e.id = $2' : ''}
     ORDER BY e.full_name ASC`,
    employeeId ? [companyId, employeeId] : [companyId],
  );

  const approvedRes = await pool.query<{
    employee_id: string;
    status: string;
    days_present: number;
    total_hours: string;
    total_late_minutes: string;
    total_permission_minutes: string;
    approved_at: string | null;
    notes: string | null;
    approved_by: string | null;
  }>(
    `SELECT m.employee_id, m.status, m.days_present, m.total_hours, m.total_late_minutes, m.total_permission_minutes,
            m.approved_at, m.notes, u.username AS approved_by
     FROM monthly_attendance_reviews m
     LEFT JOIN users u ON u.id = m.approved_by_user_id
     WHERE m.company_id=$1 AND m.period_month=$2 AND m.period_year=$3 AND m.status='APPROVED'`,
    [companyId, periodMonth, periodYear],
  );
  const approvedByEmployee = new Map(approvedRes.rows.map((r) => [r.employee_id, r]));

  const results: MonthlyAttendanceSummary[] = [];
  for (const emp of employeesRes.rows) {
    const approved = approvedByEmployee.get(emp.id);
    if (approved) {
      results.push({
        employeeId: emp.id,
        employeeCode: emp.employee_code,
        fullName: emp.full_name,
        periodMonth,
        periodYear,
        status: 'APPROVED',
        daysPresent: approved.days_present,
        totalHours: Number(approved.total_hours),
        totalLateMinutes: Number(approved.total_late_minutes),
        totalPermissionMinutes: Number(approved.total_permission_minutes),
        approvedAt: approved.approved_at,
        approvedBy: approved.approved_by,
        notes: approved.notes,
      });
      continue;
    }

    const daily = await pool.query<{ check_in_time: string | null; check_out_time: string | null; total_hours: string }>(
      `SELECT check_in_time, check_out_time, total_hours FROM attendance_daily_records
       WHERE company_id=$1 AND employee_id=$2
         AND EXTRACT(MONTH FROM attendance_date) = $3 AND EXTRACT(YEAR FROM attendance_date) = $4`,
      [companyId, emp.id, periodMonth, periodYear],
    );

    let totalHours = 0;
    let totalLate = 0;
    let totalPermission = 0;
    for (const d of daily.rows) {
      totalHours += Number(d.total_hours) || 0;
      if (emp.shift_start && d.check_in_time) {
        const lateMin = minutesBetween(emp.shift_start, d.check_in_time.slice(0, 5));
        if (lateMin > 0) totalLate += lateMin;
      }
      if (emp.shift_end && d.check_out_time) {
        const earlyMin = minutesBetween(d.check_out_time.slice(0, 5), emp.shift_end);
        if (earlyMin > 0) totalPermission += earlyMin;
      }
    }

    results.push({
      employeeId: emp.id,
      employeeCode: emp.employee_code,
      fullName: emp.full_name,
      periodMonth,
      periodYear,
      status: 'DRAFT',
      daysPresent: daily.rows.length,
      totalHours: round2(totalHours),
      totalLateMinutes: round2(totalLate),
      totalPermissionMinutes: round2(totalPermission),
      approvedAt: null,
      approvedBy: null,
      notes: null,
    });
  }

  return results;
}

/** يعتمد كشف الانتظام الشهري لموظف — يُحسَب الآن ويُجمَّد (لا يُعاد حسابه
 * تلقائياً بعد ذلك حتى لو عُدِّل حضوره لاحقاً)، فيصبح أساساً موثوقاً لحساب
 * الراتب (المرحلة 4). محاولة اعتماد شهر مُعتمَد مسبقاً تُرفَض بوضوح. */
export async function approveMonthlyAttendanceReview(
  client: PoolClient,
  input: { companyId: string; userId: string | null; employeeId: string; periodMonth: number; periodYear: number; notes?: string | null },
) {
  const existing = await client.query(
    `SELECT id FROM monthly_attendance_reviews WHERE company_id=$1 AND employee_id=$2 AND period_month=$3 AND period_year=$4 AND status='APPROVED'`,
    [input.companyId, input.employeeId, input.periodMonth, input.periodYear],
  );
  if (existing.rows.length) fail('هذا الشهر مُعتمَد مسبقاً لهذا الموظف', 'VALIDATION');

  const summaries = await computeMonthlyAttendanceSummaries(input.companyId, input.periodMonth, input.periodYear, input.employeeId);
  const summary = summaries[0];
  if (!summary) fail('الموظف غير موجود أو غير نشط', 'NOT_FOUND');

  const row = await client.query(
    `INSERT INTO monthly_attendance_reviews (
       company_id, employee_id, period_month, period_year, status,
       days_present, total_hours, total_late_minutes, total_permission_minutes,
       notes, approved_by_user_id, approved_at
     ) VALUES ($1,$2,$3,$4,'APPROVED',$5,$6,$7,$8,$9,$10,now())
     ON CONFLICT (company_id, employee_id, period_month, period_year)
     DO UPDATE SET status='APPROVED', days_present=$5, total_hours=$6, total_late_minutes=$7,
       total_permission_minutes=$8, notes=$9, approved_by_user_id=$10, approved_at=now(), updated_at=now()
     RETURNING *`,
    [
      input.companyId,
      input.employeeId,
      input.periodMonth,
      input.periodYear,
      summary.daysPresent,
      summary.totalHours,
      summary.totalLateMinutes,
      summary.totalPermissionMinutes,
      input.notes ?? null,
      input.userId,
    ],
  );
  return row.rows[0];
}
