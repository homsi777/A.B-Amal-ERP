import { apiFetch } from './client';

export interface PayrollEmployeeDto {
  id: string;
  employee_code: string;
  full_name: string;
  address: string | null;
  job_title: string | null;
  department: string | null;
  phone: string | null;
  base_salary: string;
  currency_code: string;
  salary_period: 'weekly' | 'monthly';
  hire_date: string | null;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface PayrollRunDto {
  id: string;
  payroll_no: string;
  period_month: number;
  period_year: number;
  status: string;
  total_base: string;
  total_allowances: string;
  total_deductions: string;
  total_net: string;
  currency_code: string;
  notes: string | null;
  paid_cashbox_id?: string | null;
  paid_at?: string | null;
  created_at: string;
  updated_at: string;
}

export async function listPayrollEmployees(params: { search?: string; active?: boolean } = {}) {
  const q = new URLSearchParams();
  if (params.search) q.set('search', params.search);
  if (params.active !== undefined) q.set('active', String(params.active));
  const qs = q.toString() ? `?${q}` : '';
  return apiFetch<{ ok: boolean; data: PayrollEmployeeDto[] }>(`/api/payroll/employees${qs}`);
}

export async function createPayrollEmployee(payload: {
  employeeCode: string;
  fullName: string;
  address?: string | null;
  jobTitle?: string | null;
  department?: string | null;
  phone?: string | null;
  baseSalary: number;
  currencyCode?: string;
  salaryPeriod?: 'weekly' | 'monthly';
  hireDate?: string | null;
  notes?: string | null;
}) {
  return apiFetch<{ ok: boolean; data: PayrollEmployeeDto }>('/api/payroll/employees', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function payEmployeeSalary(
  employeeId: string,
  payload: { cashboxId: string; paymentDate?: string | null; amount?: number; notes?: string | null },
) {
  return apiFetch<{
    ok: boolean;
    data: {
      id: string;
      payroll_no: string;
      employee_id: string;
      amount: number;
      currency_code: string;
      paid_at: string;
    };
  }>(`/api/payroll/employees/${encodeURIComponent(employeeId)}/pay-salary`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function createEmployeeAdvance(
  employeeId: string,
  payload: { cashboxId: string; advanceDate?: string | null; amount: number; notes?: string | null },
) {
  return apiFetch<{
    ok: boolean;
    data: {
      id: string;
      advance_no: string;
      advance_date: string;
      amount: string;
      currency_code: string;
      voucher_id: string;
      voucher_no: string;
      employee_id: string;
      created_at: string;
    };
  }>(`/api/payroll/employees/${encodeURIComponent(employeeId)}/advance`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function listPayrollRuns() {
  return apiFetch<{ ok: boolean; data: PayrollRunDto[] }>('/api/payroll/runs');
}

export async function markPayrollRunPaid(
  runId: string,
  payload: { cashboxId: string; paymentDate?: string | null },
) {
  return apiFetch<{
    ok: boolean;
    data: { id: string; status: string; paid_cashbox_id: string; paid_at: string };
    note?: string;
  }>(`/api/payroll/runs/${encodeURIComponent(runId)}/mark-paid`, {
    method: 'PATCH',
    body: JSON.stringify({
      cashboxId: payload.cashboxId,
      paymentDate: payload.paymentDate ?? undefined,
    }),
  });
}
