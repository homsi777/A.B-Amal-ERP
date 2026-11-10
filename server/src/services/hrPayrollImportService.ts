import type { PoolClient } from 'pg';
import { generateDocumentNo } from '../utils/documentNumbers.js';

type ServiceErrorCode = 'VALIDATION' | 'DUPLICATE';

function fail(message: string, code: ServiceErrorCode): never {
  throw Object.assign(new Error(message), { code });
}

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export type PayrollExcelRowInput = {
  employeeCode: string;
  fullName: string;
  factory?: string | null;
  department?: string | null;
  jobTitle?: string | null;
  category?: string | null;
  paymentMethod?: string | null;
  hireDate?: string | null;
  baseSalary: number;
  totalEntitlements: number;
  totalDeductions: number;
  finalNet: number;
  rawDetail?: unknown;
};

export type ImportDepartmentPayrollInput = {
  companyId: string;
  userId: string | null;
  departmentLabel: string;
  periodMonth: number;
  periodYear: number;
  currencyCode: string;
  exchangeRateToUsd: number;
  fileName: string;
  rows: PayrollExcelRowInput[];
};

export type ImportDepartmentPayrollResult = {
  payrollRunId: string;
  payrollNo: string;
  employeesCreated: number;
  employeesMatched: number;
  totalNet: number;
};

async function resolveOrCreateEmployee(
  client: PoolClient,
  companyId: string,
  row: PayrollExcelRowInput,
  currencyCode: string,
): Promise<{ id: string; created: boolean }> {
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM payroll_employees WHERE company_id = $1 AND fingerprint_code = $2`,
    [companyId, row.employeeCode],
  );
  if (existing.rows.length) return { id: existing.rows[0].id, created: false };

  const employeeCode = `EMP-${row.employeeCode}`;
  const ins = await client.query<{ id: string }>(
    `INSERT INTO payroll_employees (
       company_id, employee_code, full_name, fingerprint_code, factory, department, job_title, category,
       payment_method, hire_date, base_salary, currency_code, status
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::date,$11,$12,'ACTIVE')
     ON CONFLICT (company_id, employee_code) DO UPDATE SET fingerprint_code = EXCLUDED.fingerprint_code
     RETURNING id`,
    [
      companyId,
      employeeCode,
      row.fullName || row.employeeCode,
      row.employeeCode,
      row.factory ?? null,
      row.department ?? null,
      row.jobTitle ?? null,
      row.category ?? null,
      row.paymentMethod ?? null,
      row.hireDate ?? null,
      row.baseSalary,
      currencyCode,
    ],
  );
  const employeeId = ins.rows[0].id;
  await client.query(
    `INSERT INTO employee_wage_rule_history (company_id, employee_id, effective_from, base_salary, notes, created_by_user_id)
     VALUES ($1,$2,COALESCE($3::date, current_date),$4,'مستورد تلقائياً من كشف رواتب Excel',$5)`,
    [companyId, employeeId, row.hireDate ?? null, row.baseSalary, null],
  );
  return { id: employeeId, created: true };
}

/** يستورد شيت "الاجر" المحسوب فعلاً (أرقام نهائية حقيقية، لا إعادة حساب) كمسير
 * رواتب DRAFT جديد لقسم مُحدَّد لشهر مُحدَّد — موظف غير موجود بالنظام يُنشَأ
 * تلقائياً (مربوطاً برقم كوده/بصمته لا اسمه). لا يُرحَّل محاسبياً هنا — الاعتماد
 * وترحيل GL يبقيان إجراءً منفصلاً صريحاً (شاشة الرواتب الموجودة). */
export async function importDepartmentPayrollExcel(
  client: PoolClient,
  input: ImportDepartmentPayrollInput,
): Promise<ImportDepartmentPayrollResult> {
  if (!input.rows.length) fail('لا توجد صفوف للاستيراد', 'VALIDATION');
  if (!(input.exchangeRateToUsd > 0)) fail('سعر الصرف يجب أن يكون أكبر من صفر', 'VALIDATION');

  const existingRun = await client.query(
    `SELECT id FROM payroll_runs WHERE company_id=$1 AND department=$2 AND period_month=$3 AND period_year=$4`,
    [input.companyId, input.departmentLabel, input.periodMonth, input.periodYear],
  );
  if (existingRun.rows.length) fail('يوجد مسير رواتب مستورد مسبقاً لهذا القسم وهذا الشهر', 'DUPLICATE');

  let totalBase = 0;
  let totalAllowances = 0;
  let totalDeductions = 0;
  let totalNet = 0;
  for (const row of input.rows) {
    totalBase += row.baseSalary;
    totalAllowances += row.totalEntitlements - row.baseSalary;
    totalDeductions += row.totalDeductions;
    totalNet += row.finalNet;
  }

  const payrollNo = generateDocumentNo(`PR-${input.departmentLabel}-${input.periodYear}-${input.periodMonth}`);
  const run = await client.query<{ id: string; payroll_no: string }>(
    `INSERT INTO payroll_runs (
       company_id, payroll_no, period_month, period_year, status,
       total_base, total_allowances, total_deductions, total_net,
       currency_code, exchange_rate_to_usd, department, notes, created_by_user_id
     ) VALUES ($1,$2,$3,$4,'DRAFT',$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING id, payroll_no`,
    [
      input.companyId,
      payrollNo,
      input.periodMonth,
      input.periodYear,
      round2(totalBase),
      round2(totalAllowances),
      round2(totalDeductions),
      round2(totalNet),
      input.currencyCode,
      input.exchangeRateToUsd,
      input.departmentLabel,
      `مستورد من ملف Excel: ${input.fileName}`,
      input.userId,
    ],
  );
  const payrollRunId = run.rows[0].id;

  let employeesCreated = 0;
  let employeesMatched = 0;
  for (const row of input.rows) {
    const employee = await resolveOrCreateEmployee(client, input.companyId, row, input.currencyCode);
    if (employee.created) employeesCreated++;
    else employeesMatched++;

    await client.query(
      `INSERT INTO payroll_run_lines (
         company_id, payroll_run_id, employee_id, base_salary, allowances, deductions, net_salary,
         excel_detail, source_file, employee_fingerprint_code
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        input.companyId,
        payrollRunId,
        employee.id,
        round2(row.baseSalary),
        round2(row.totalEntitlements - row.baseSalary),
        round2(row.totalDeductions),
        round2(row.finalNet),
        JSON.stringify(row.rawDetail ?? null),
        input.fileName,
        row.employeeCode,
      ],
    );
  }

  return {
    payrollRunId,
    payrollNo: run.rows[0].payroll_no,
    employeesCreated,
    employeesMatched,
    totalNet: round2(totalNet),
  };
}
