import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { authenticateRequest } from '../middleware/auth.js';
import { sendError } from '../middleware/errorHandler.js';
import { ArabicErrors } from '../utils/arabicErrors.js';
import { generateDocumentNo } from '../utils/documentNumbers.js';
import { postPayrollAccrualToGl, postPayrollPaymentToGl, reversePayrollAccrualGl } from '../services/glPostingService.js';
import { applyPayrollCashOut } from '../services/payrollCashboxService.js';
import { getExchangeRateToUsdTx } from '../services/exchangeRateService.js';
import { applyVoucherConfirmation, insertDraftVoucher } from '../services/voucherCashboxService.js';

const employeeBody = z.object({
  employeeCode: z.string().min(1),
  fullName: z.string().min(1),
  address: z.string().optional().nullable(),
  jobTitle: z.string().optional().nullable(),
  department: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  baseSalary: z.coerce.number().nonnegative(),
  currencyCode: z.string().min(1).default('USD'),
  salaryPeriod: z.enum(['weekly', 'monthly']).optional().default('monthly'),
  hireDate: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const lineInput = z.object({
  employeeId: z.string().uuid(),
  baseSalary: z.coerce.number().nonnegative(),
  allowances: z.coerce.number().nonnegative().default(0),
  deductions: z.coerce.number().nonnegative().default(0),
  notes: z.string().optional().nullable(),
});

const runCreateBody = z.object({
  periodMonth: z.coerce.number().int().min(1).max(12),
  periodYear: z.coerce.number().int().min(2000).max(2100),
  notes: z.string().optional().nullable(),
  lines: z.array(lineInput).min(1),
});

const markPaidBody = z.object({
  cashboxId: z.string().uuid(),
  paymentDate: z.string().optional().nullable(),
});

const employeeSalaryPaymentBody = z.object({
  cashboxId: z.string().uuid(),
  paymentDate: z.string().optional().nullable(),
  amount: z.coerce.number().positive().optional(),
  notes: z.string().optional().nullable(),
});

const employeeAdvanceBody = z.object({
  cashboxId: z.string().uuid(),
  advanceDate: z.string().optional().nullable(),
  amount: z.coerce.number().positive(),
  notes: z.string().optional().nullable(),
});

const runUpdateBody = runCreateBody;

function sumRun(lines: { baseSalary: number; allowances: number; deductions: number; net: number }[]) {
  return {
    totalBase: lines.reduce((a, l) => a + l.baseSalary, 0),
    totalAllowances: lines.reduce((a, l) => a + l.allowances, 0),
    totalDeductions: lines.reduce((a, l) => a + l.deductions, 0),
    totalNet: lines.reduce((a, l) => a + l.net, 0),
  };
}

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

async function resolveExchangeRateToUsd(client: any, companyId: string, currencyCode: string): Promise<number> {
  const code = String(currencyCode || 'USD').trim().toUpperCase();
  if (code === 'USD') return 1;
  const rate = await getExchangeRateToUsdTx(client, companyId, code);
  if (!rate || rate <= 0) {
    throw Object.assign(new Error('لا يمكن تنفيذ العملية بدون سعر صرف صالح لعملة الموظف'), { code: 'VALIDATION' });
  }
  return rate;
}

export const payrollRoutes: FastifyPluginAsync = async (app) => {
  app.get('/employees', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const q = req.query as Record<string, string>;
    const search = q.search?.trim() || '';
    const active = q.active;

    const conditions: string[] = ['company_id = $1'];
    const params: unknown[] = [companyId];
    let p = 2;

    if (search) {
      conditions.push(`(full_name ILIKE $${p} OR employee_code ILIKE $${p})`);
      params.push(`%${search}%`);
      p++;
    }
    if (active === 'true') conditions.push('is_active = true');
    else if (active === 'false') conditions.push('is_active = false');

    const where = conditions.join(' AND ');
    const pool = getPool();
    const rows = await pool.query(
      `SELECT id, employee_code, full_name, address, job_title, department, phone, base_salary, currency_code,
              salary_period, hire_date, is_active, notes, created_at, updated_at
       FROM payroll_employees WHERE ${where} ORDER BY employee_code ASC`,
      params,
    );
    return reply.send({ ok: true, data: rows.rows });
  });

  app.post('/employees', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const parsed = employeeBody.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    const d = parsed.data;

    const pool = getPool();
    try {
      const row = await pool.query(
        `INSERT INTO payroll_employees (
           company_id, employee_code, full_name, address, job_title, department, phone,
           base_salary, currency_code, salary_period, hire_date, notes
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::date,$12)
         RETURNING *`,
        [
          companyId,
          d.employeeCode.trim(),
          d.fullName.trim(),
          d.address ?? null,
          d.jobTitle ?? null,
          d.department ?? null,
          d.phone ?? null,
          d.baseSalary,
          d.currencyCode,
          d.salaryPeriod,
          d.hireDate ?? null,
          d.notes ?? null,
        ],
      );
      return reply.status(201).send({ ok: true, data: row.rows[0] });
    } catch (e: unknown) {
      if ((e as { code?: string }).code === '23505')
        return sendError(reply, 409, 'رمز الموظف مستخدم مسبقاً', 'DUPLICATE');
      throw e;
    }
  });

  app.put('/employees/:id', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const parsed = employeeBody.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    const d = parsed.data;

    const pool = getPool();
    try {
      const row = await pool.query(
        `UPDATE payroll_employees SET
           employee_code=$3, full_name=$4, address=$5, job_title=$6, department=$7, phone=$8,
           base_salary=$9, currency_code=$10, salary_period=$11, hire_date=$12::date, notes=$13, updated_at=now()
         WHERE id=$1 AND company_id=$2
         RETURNING *`,
        [
          id,
          companyId,
          d.employeeCode.trim(),
          d.fullName.trim(),
          d.address ?? null,
          d.jobTitle ?? null,
          d.department ?? null,
          d.phone ?? null,
          d.baseSalary,
          d.currencyCode,
          d.salaryPeriod,
          d.hireDate ?? null,
          d.notes ?? null,
        ],
      );
      if (!row.rows.length) return sendError(reply, 404, 'الموظف غير موجود', 'NOT_FOUND');
      return reply.send({ ok: true, data: row.rows[0] });
    } catch (e: unknown) {
      if ((e as { code?: string }).code === '23505')
        return sendError(reply, 409, 'رمز الموظف مستخدم مسبقاً', 'DUPLICATE');
      throw e;
    }
  });

  app.patch('/employees/:id/toggle-status', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const pool = getPool();
    const row = await pool.query(
      `UPDATE payroll_employees SET is_active = NOT is_active, updated_at=now()
       WHERE id=$1 AND company_id=$2 RETURNING id, is_active`,
      [id, companyId],
    );
    if (!row.rows.length) return sendError(reply, 404, 'الموظف غير موجود', 'NOT_FOUND');
    return reply.send({ ok: true, data: row.rows[0] });
  });

  app.post('/employees/:id/pay-salary', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const { id } = req.params as { id: string };
    const parsed = employeeSalaryPaymentBody.safeParse(req.body ?? {});
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    const d = parsed.data;
    const paymentDate = (d.paymentDate?.trim() || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const payment = new Date(`${paymentDate}T00:00:00`);
    const periodMonth = payment.getMonth() + 1;
    const periodYear = payment.getFullYear();

    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const emp = await client.query<{
        id: string;
        employee_code: string;
        full_name: string;
        base_salary: string;
        currency_code: string;
      }>(
        `SELECT id, employee_code, full_name, base_salary, currency_code
         FROM payroll_employees
         WHERE id=$1 AND company_id=$2 AND is_active=true
         FOR UPDATE`,
        [id, companyId],
      );
      if (!emp.rows.length) {
        await client.query('ROLLBACK');
        return sendError(reply, 404, 'الموظف غير موجود أو موقوف', 'NOT_FOUND');
      }
      const employee = emp.rows[0];
      const amount = Math.round((d.amount ?? Number(employee.base_salary)) * 100) / 100;
      if (amount <= 0) {
        await client.query('ROLLBACK');
        return sendError(reply, 400, 'قيمة التسليم يجب أن تكون أكبر من صفر', 'VALIDATION');
      }

      const payrollNo = generateDocumentNo(`PR-EMP-${periodYear}-${periodMonth}`);
      const ins = await client.query<{ id: string; payroll_no: string }>(
        `INSERT INTO payroll_runs (
           company_id, payroll_no, period_month, period_year, status,
           total_base, total_allowances, total_deductions, total_net,
           currency_code, notes, created_by_user_id
         ) VALUES ($1,$2,$3,$4,'CONFIRMED',$5,0,0,$5,$6,$7,$8)
         RETURNING id, payroll_no`,
        [
          companyId,
          payrollNo,
          periodMonth,
          periodYear,
          amount,
          employee.currency_code,
          d.notes || `تسليم راتب مباشر للموظف ${employee.full_name}`,
          userId,
        ],
      );
      const runId = ins.rows[0].id;
      await client.query(
        `INSERT INTO payroll_run_lines (
           company_id, payroll_run_id, employee_id, base_salary, allowances, deductions, net_salary, notes
         ) VALUES ($1,$2,$3,$4,0,0,$4,$5)`,
        [companyId, runId, employee.id, amount, d.notes ?? null],
      );

      await postPayrollAccrualToGl(client, {
        companyId,
        payrollRunId: runId,
        payrollNo: ins.rows[0].payroll_no,
        periodDate: `${periodYear}-${String(periodMonth).padStart(2, '0')}-01`,
        totalNet: amount,
        currencyCode: employee.currency_code,
        userId,
      });

      await applyPayrollCashOut(client, {
        companyId,
        payrollRunId: runId,
        payrollNo: ins.rows[0].payroll_no,
        amount,
        currencyCode: employee.currency_code,
        cashboxId: d.cashboxId,
        userId,
      });

      await client.query(
        `UPDATE payroll_runs SET status='PAID', paid_cashbox_id=$3, paid_at=$4::date, updated_at=now()
         WHERE id=$1 AND company_id=$2`,
        [runId, companyId, d.cashboxId, paymentDate],
      );

      await postPayrollPaymentToGl(client, {
        companyId,
        payrollRunId: runId,
        payrollNo: ins.rows[0].payroll_no,
        paymentDate,
        totalNet: amount,
        currencyCode: employee.currency_code,
        cashboxId: d.cashboxId,
        userId,
      });

      await client.query('COMMIT');
      return reply.status(201).send({
        ok: true,
        data: {
          id: runId,
          payroll_no: ins.rows[0].payroll_no,
          employee_id: employee.id,
          amount,
          currency_code: employee.currency_code,
          paid_at: paymentDate,
        },
      });
    } catch (e: unknown) {
      await client.query('ROLLBACK');
      const code = (e as { code?: string }).code;
      if (code === 'VALIDATION' || code === 'NOT_FOUND') {
        return sendError(reply, 400, e instanceof Error ? e.message : ArabicErrors.validation, code);
      }
      throw e;
    } finally {
      client.release();
    }
  });

  app.post('/employees/:id/advance', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const { id } = req.params as { id: string };
    const parsed = employeeAdvanceBody.safeParse(req.body ?? {});
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    const d = parsed.data;
    const advanceDate = (d.advanceDate?.trim() || new Date().toISOString().slice(0, 10)).slice(0, 10);

    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const emp = await client.query<{
        id: string;
        employee_code: string;
        full_name: string;
        currency_code: string;
      }>(
        `SELECT id, employee_code, full_name, currency_code
         FROM payroll_employees
         WHERE id=$1 AND company_id=$2 AND is_active=true
         FOR UPDATE`,
        [id, companyId],
      );
      if (!emp.rows.length) {
        await client.query('ROLLBACK');
        return sendError(reply, 404, 'الموظف غير موجود أو موقوف', 'NOT_FOUND');
      }
      const employee = emp.rows[0];
      const amount = round2(d.amount);
      const exchangeRateToUsd = await resolveExchangeRateToUsd(client, companyId, employee.currency_code);
      const amountUsd = round2(amount / exchangeRateToUsd);
      const advanceNo = generateDocumentNo('ADV');
      const description = `سلفة موظف ${employee.full_name} - ${advanceNo}`;

      const voucher = await insertDraftVoucher(client, {
        companyId,
        userId,
        voucherType: 'PAYMENT',
        voucherDate: advanceDate,
        cashboxId: d.cashboxId,
        partyType: 'EMPLOYEE',
        partyId: employee.id,
        partyName: employee.full_name,
        amount,
        currencyCode: employee.currency_code,
        exchangeRateToUsd,
        amountUsd,
        description,
        notes: d.notes ?? null,
        referenceDocumentType: 'EMPLOYEE_ADVANCE',
        referenceDocumentNo: advanceNo,
      });

      await applyVoucherConfirmation(client, {
        companyId,
        voucherId: voucher.id,
        voucherNo: voucher.voucherNo,
        voucherDate: advanceDate,
        voucherType: 'PAYMENT',
        amount,
        currencyCode: employee.currency_code,
        exchangeRateToUsd,
        amountUsd,
        cashboxId: d.cashboxId,
        partyType: 'EMPLOYEE',
        partyId: employee.id,
        partyName: employee.full_name,
        description,
        userId,
      });

      await client.query(`UPDATE vouchers SET status='CONFIRMED', confirmed_at=now(), updated_at=now() WHERE id=$1`, [
        voucher.id,
      ]);

      const ins = await client.query(
        `INSERT INTO payroll_employee_advances (
           company_id, employee_id, voucher_id, cashbox_id, advance_no, advance_date,
           amount, currency_code, notes, created_by_user_id
         ) VALUES ($1,$2,$3,$4,$5,$6::date,$7,$8,$9,$10)
         RETURNING id, advance_no, advance_date, amount, currency_code, created_at`,
        [
          companyId,
          employee.id,
          voucher.id,
          d.cashboxId,
          advanceNo,
          advanceDate,
          amount,
          employee.currency_code,
          d.notes ?? null,
          userId,
        ],
      );

      await client.query('COMMIT');
      return reply.status(201).send({
        ok: true,
        data: {
          ...ins.rows[0],
          voucher_id: voucher.id,
          voucher_no: voucher.voucherNo,
          employee_id: employee.id,
        },
      });
    } catch (e: unknown) {
      await client.query('ROLLBACK');
      const code = (e as { code?: string }).code;
      if (code === 'VALIDATION' || code === 'NOT_FOUND') {
        return sendError(reply, 400, e instanceof Error ? e.message : ArabicErrors.validation, code);
      }
      throw e;
    } finally {
      client.release();
    }
  });

  app.get('/runs', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const pool = getPool();
    const rows = await pool.query(
      `SELECT id, payroll_no, period_month, period_year, status, total_base, total_allowances, total_deductions,
              total_net, currency_code, notes, paid_cashbox_id, paid_at, created_at, updated_at
       FROM payroll_runs WHERE company_id=$1 ORDER BY period_year DESC, period_month DESC, created_at DESC`,
      [companyId],
    );
    return reply.send({ ok: true, data: rows.rows });
  });

  app.get('/runs/:id', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const pool = getPool();
    const run = await pool.query(
      `SELECT * FROM payroll_runs WHERE id=$1 AND company_id=$2`,
      [id, companyId],
    );
    if (!run.rows.length) return sendError(reply, 404, 'مسير الرواتب غير موجود', 'NOT_FOUND');

    const lines = await pool.query(
      `SELECT l.*, e.full_name AS employee_name, e.employee_code
       FROM payroll_run_lines l
       JOIN payroll_employees e ON e.id = l.employee_id AND e.company_id = l.company_id
       WHERE l.payroll_run_id=$1 AND l.company_id=$2
       ORDER BY e.employee_code`,
      [id, companyId],
    );

    return reply.send({ ok: true, data: { ...run.rows[0], lines: lines.rows } });
  });

  app.post('/runs', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const parsed = runCreateBody.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    const d = parsed.data;

    const payrollNo = generateDocumentNo(`PR-${d.periodYear}-${d.periodMonth}`);

    const computedLines = d.lines.map((ln) => {
      const net = Math.round((ln.baseSalary + ln.allowances - ln.deductions) * 100) / 100;
      return { ...ln, net };
    });
    const totals = sumRun(
      computedLines.map((l) => ({
        baseSalary: l.baseSalary,
        allowances: l.allowances,
        deductions: l.deductions,
        net: l.net,
      })),
    );

    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const ins = await client.query(
        `INSERT INTO payroll_runs (
           company_id, payroll_no, period_month, period_year, status,
           total_base, total_allowances, total_deductions, total_net,
           currency_code, notes, created_by_user_id
         ) VALUES ($1,$2,$3,$4,'DRAFT',$5,$6,$7,$8,'USD',$9,$10)
         RETURNING id, payroll_no, status, created_at`,
        [
          companyId,
          payrollNo,
          d.periodMonth,
          d.periodYear,
          totals.totalBase,
          totals.totalAllowances,
          totals.totalDeductions,
          totals.totalNet,
          d.notes ?? null,
          userId,
        ],
      );

      const runId = ins.rows[0].id as string;

      for (const ln of computedLines) {
        const ex = await client.query(`SELECT 1 FROM payroll_employees WHERE id=$1 AND company_id=$2`, [
          ln.employeeId,
          companyId,
        ]);
        if (!ex.rows.length) {
          throw Object.assign(new Error('موظف غير موجود أو لا يتبع الشركة'), { code: 'VALIDATION' });
        }
      }

      for (const ln of computedLines) {
        await client.query(
          `INSERT INTO payroll_run_lines (
             company_id, payroll_run_id, employee_id, base_salary, allowances, deductions, net_salary, notes
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [companyId, runId, ln.employeeId, ln.baseSalary, ln.allowances, ln.deductions, ln.net, ln.notes ?? null],
        );
      }

      await client.query('COMMIT');
      return reply.status(201).send({ ok: true, data: ins.rows[0] });
    } catch (e: unknown) {
      await client.query('ROLLBACK');
      if ((e as { code?: string }).code === 'VALIDATION') {
        return sendError(reply, 400, e instanceof Error ? e.message : ArabicErrors.validation, 'VALIDATION');
      }
      throw e;
    } finally {
      client.release();
    }
  });

  app.put('/runs/:id', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const { id } = req.params as { id: string };
    const parsed = runUpdateBody.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    const d = parsed.data;

    const pool = getPool();
    const cur = await pool.query<{ status: string }>(
      `SELECT status FROM payroll_runs WHERE id=$1 AND company_id=$2`,
      [id, companyId],
    );
    if (!cur.rows.length) return sendError(reply, 404, 'مسير الرواتب غير موجود', 'NOT_FOUND');
    if (cur.rows[0].status !== 'DRAFT') {
      return sendError(reply, 400, 'لا يمكن التعديل إلا في حالة مسودة', 'INVALID_STATE');
    }

    const computedLines = d.lines.map((ln) => {
      const net = Math.round((ln.baseSalary + ln.allowances - ln.deductions) * 100) / 100;
      return { ...ln, net };
    });
    const totals = sumRun(
      computedLines.map((l) => ({
        baseSalary: l.baseSalary,
        allowances: l.allowances,
        deductions: l.deductions,
        net: l.net,
      })),
    );

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      for (const ln of computedLines) {
        const ex = await client.query(`SELECT 1 FROM payroll_employees WHERE id=$1 AND company_id=$2`, [
          ln.employeeId,
          companyId,
        ]);
        if (!ex.rows.length) {
          throw Object.assign(new Error('موظف غير موجود أو لا يتبع الشركة'), { code: 'VALIDATION' });
        }
      }

      await client.query(
        `UPDATE payroll_runs SET
           period_month=$3, period_year=$4,
           total_base=$5, total_allowances=$6, total_deductions=$7, total_net=$8,
           notes=$9, updated_at=now(), created_by_user_id=$10
         WHERE id=$1 AND company_id=$2`,
        [
          id,
          companyId,
          d.periodMonth,
          d.periodYear,
          totals.totalBase,
          totals.totalAllowances,
          totals.totalDeductions,
          totals.totalNet,
          d.notes ?? null,
          userId,
        ],
      );
      await client.query(`DELETE FROM payroll_run_lines WHERE payroll_run_id=$1 AND company_id=$2`, [id, companyId]);
      for (const ln of computedLines) {
        await client.query(
          `INSERT INTO payroll_run_lines (
             company_id, payroll_run_id, employee_id, base_salary, allowances, deductions, net_salary, notes
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [companyId, id, ln.employeeId, ln.baseSalary, ln.allowances, ln.deductions, ln.net, ln.notes ?? null],
        );
      }
      await client.query('COMMIT');
      return reply.send({ ok: true, data: { id, updated: true } });
    } catch (e: unknown) {
      await client.query('ROLLBACK');
      if ((e as { code?: string }).code === 'VALIDATION') {
        return sendError(reply, 400, e instanceof Error ? e.message : ArabicErrors.validation, 'VALIDATION');
      }
      throw e;
    } finally {
      client.release();
    }
  });

  app.patch('/runs/:id/confirm', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const { id } = req.params as { id: string };
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const row = await client.query<{
        id: string;
        status: string;
        payroll_no: string;
        period_year: number;
        period_month: number;
        total_net: string;
        currency_code: string;
      }>(
        `UPDATE payroll_runs SET status='CONFIRMED', updated_at=now()
         WHERE id=$1 AND company_id=$2 AND status='DRAFT'
         RETURNING id, status, payroll_no, period_year, period_month, total_net, currency_code`,
        [id, companyId],
      );
      if (!row.rows.length) {
        await client.query('ROLLBACK');
        return sendError(reply, 400, 'لا يمكن التأكيد', 'INVALID_STATE');
      }
      const r = row.rows[0];
      const periodDate = `${r.period_year}-${String(r.period_month).padStart(2, '0')}-01`;
      await postPayrollAccrualToGl(client, {
        companyId,
        payrollRunId: id,
        payrollNo: r.payroll_no,
        periodDate,
        totalNet: Number(r.total_net),
        currencyCode: r.currency_code,
        userId,
      });
      await client.query('COMMIT');
      return reply.send({
        ok: true,
        data: { id: r.id, status: r.status },
        note: 'تم تأكيد المسير وترحيل قيد الاستحقاق: مصروف رواتب مقابل رواتب مستحقة.',
      });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  app.patch('/runs/:id/mark-paid', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const { id } = req.params as { id: string };
    const parsed = markPaidBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return sendError(
        reply,
        400,
        'يجب تحديد صندوق الخزينة (cashboxId) لصرف صافي الرواتب وتسجيل الحركة والقيد.',
        'VALIDATION',
      );
    }

    const paymentDate = (parsed.data.paymentDate?.trim() || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const cashboxId = parsed.data.cashboxId;

    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const head = await client.query<{
        id: string;
        payroll_no: string;
        total_net: string;
        currency_code: string;
      }>(
        `SELECT id, payroll_no, total_net, currency_code FROM payroll_runs
         WHERE id=$1 AND company_id=$2 AND status='CONFIRMED' FOR UPDATE`,
        [id, companyId],
      );
      if (!head.rows.length) {
        await client.query('ROLLBACK');
        return sendError(reply, 400, 'يجب تأكيد المسير قبل التسجيل كمدفوع', 'INVALID_STATE');
      }
      const r = head.rows[0];
      const totalNet = Number(r.total_net);

      await applyPayrollCashOut(client, {
        companyId,
        payrollRunId: id,
        payrollNo: r.payroll_no,
        amount: totalNet,
        currencyCode: r.currency_code,
        cashboxId,
        userId,
      });

      const upd = await client.query(
        `UPDATE payroll_runs SET status='PAID', paid_cashbox_id=$3, paid_at=$4::date, updated_at=now()
         WHERE id=$1 AND company_id=$2 AND status='CONFIRMED'
         RETURNING id, status, payroll_no, total_net, currency_code`,
        [id, companyId, cashboxId, paymentDate],
      );
      if (!upd.rows.length) {
        await client.query('ROLLBACK');
        return sendError(reply, 400, 'تعذر تحديث حالة المسير', 'INVALID_STATE');
      }

      await postPayrollPaymentToGl(client, {
        companyId,
        payrollRunId: id,
        payrollNo: r.payroll_no,
        paymentDate,
        totalNet,
        currencyCode: r.currency_code,
        cashboxId,
        userId,
      });
      await client.query('COMMIT');
      return reply.send({
        ok: true,
        data: { id: upd.rows[0].id, status: upd.rows[0].status, paid_cashbox_id: cashboxId, paid_at: paymentDate },
        note:
          'تم خصم الصندوق وترحيل القيد: شطب رواتب مستحقة مقابل نقدية بالصندوق المحدد (مدقق لمحاسب).',
      });
    } catch (e: unknown) {
      await client.query('ROLLBACK');
      if ((e as { code?: string }).code === 'VALIDATION' || (e as { code?: string }).code === 'NOT_FOUND') {
        return sendError(reply, 400, e instanceof Error ? e.message : ArabicErrors.validation, (e as { code?: string }).code ?? 'VALIDATION');
      }
      throw e;
    } finally {
      client.release();
    }
  });

  app.patch('/runs/:id/cancel', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const { id } = req.params as { id: string };
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const cur = await client.query<{ status: string; payroll_no: string }>(
        `SELECT status, payroll_no FROM payroll_runs WHERE id=$1 AND company_id=$2 FOR UPDATE`,
        [id, companyId],
      );
      if (!cur.rows.length) {
        await client.query('ROLLBACK');
        return sendError(reply, 404, 'مسير غير موجود', 'NOT_FOUND');
      }
      const st = cur.rows[0].status;
      if (st === 'CANCELLED') {
        await client.query('ROLLBACK');
        return sendError(reply, 400, 'المسير ملغى مسبقاً', 'INVALID_STATE');
      }
      if (st === 'PAID') {
        await client.query('ROLLBACK');
        return sendError(reply, 400, 'لا يمكن إلغاء مسير مُسجَّل كمدفوع', 'INVALID_STATE');
      }
      if (st === 'CONFIRMED') {
        await reversePayrollAccrualGl(client, {
          companyId,
          payrollRunId: id,
          payrollNo: cur.rows[0].payroll_no,
          userId,
        });
      }
      const upd = await client.query(
        `UPDATE payroll_runs SET status='CANCELLED', updated_at=now()
         WHERE id=$1 AND company_id=$2 AND status IN ('DRAFT','CONFIRMED')
         RETURNING id, status`,
        [id, companyId],
      );
      if (!upd.rows.length) {
        await client.query('ROLLBACK');
        return sendError(reply, 400, 'لا يمكن الإلغاء', 'INVALID_STATE');
      }
      await client.query('COMMIT');
      return reply.send({ ok: true, data: upd.rows[0] });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });
};
