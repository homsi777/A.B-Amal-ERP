/**
 * Extended operational / ERP reports — all real PostgreSQL, no mock rows.
 * "Operational" financial reports are not formal double-entry GL.
 */
import { getPool } from '../db/pool.js';
import type { UnifiedReportPayload } from './reportTypes.js';
import { nowIso } from './reportTypes.js';
import { fetchExtendedDashboardSummary } from './reportService.js';
import {
  buildReportPayload,
  dateCol,
  emptyReport,
  moneyCol,
  numCol,
  pageParams,
  textCol,
} from './reportHelpers.js';

// ─── Executive unified table + summary cards ───────────────────────────────

export async function reportExecutiveSummary(companyId: string): Promise<UnifiedReportPayload> {
  const d = (await fetchExtendedDashboardSummary(companyId)) as Record<string, unknown>;
  const cards = [
    { label: 'العملاء', value: String(d.customers_count ?? 0) },
    { label: 'الموردون', value: String(d.suppliers_count ?? 0) },
    { label: 'المستودعات', value: String(d.warehouses_count ?? 0) },
    { label: 'أتواب', value: String(d.fabric_rolls_count ?? 0) },
    { label: 'أتواب نشطة', value: String(d.active_fabric_rolls_count ?? 0) },
    { label: 'تالف / هالك', value: String(d.damaged_or_waste_rolls_count ?? 0) },
    { label: 'أمتار', value: String(d.total_roll_length_m ?? 0) },
    { label: 'وزن (تقدير)', value: String(d.total_roll_weight_kg ?? 0) },
    { label: 'صناديق', value: String(d.cashboxes_count ?? 0) },
    { label: 'سندات', value: String(d.vouchers_count ?? 0) },
    { label: 'إجمالي قبض (مؤكد)', value: String(d.receipt_total ?? 0) },
    { label: 'إجمالي صرف (مؤكد)', value: String(d.payment_total ?? 0) },
    { label: 'دفعات استيراد', value: String(d.purchase_import_batches_count ?? 0) },
    { label: 'مهام طباعة', value: String(d.print_jobs_count ?? 0) },
    { label: 'تحويلات مخزون', value: String(d.transfers_count ?? 0) },
    { label: 'سجلات هدر', value: String(d.waste_records_count ?? 0) },
    { label: 'فواتير مرتجع', value: String(d.return_invoices_count ?? 0) },
    { label: 'موظفو رواتب', value: String(d.payroll_employees_count ?? 0) },
    { label: 'مسيرات رواتب', value: String(d.payroll_runs_count ?? 0) },
  ];
  const cashByCur = (d.total_cash_by_currency as { currency_code: string; total: string }[] | undefined) ?? [];
  const cashRows = cashByCur.map((r) => ({
    currency_code: r.currency_code,
    total_balance: r.total,
  }));
  return buildReportPayload({
    key: 'executive_summary',
    title: 'الملخص التنفيذي العام',
    subtitle: 'مؤشرات تجميعية من جداول التشغيل',
    generatedAt: nowIso(),
    filtersApplied: {},
    columns: [textCol('metric', 'المؤشر'), textCol('value', 'القيمة')],
    rows: cards.map((c) => ({ metric: c.label, value: c.value })),
    summaryCards: cards.slice(0, 12).map((c) => ({ label: c.label, value: c.value })),
    meta: { note: cashRows.length ? 'أرصدة العملات من جدول الصناديق النشطة.' : undefined, dataCompleteness: 'FULL' },
  });
}

// ─── Financial operational ───────────────────────────────────────────────────

export async function reportOperationalLedger(
  companyId: string,
  q: Record<string, string | undefined>,
): Promise<UnifiedReportPayload> {
  const pool = getPool();
  const { page, pageSize, offset } = pageParams(q);
  const dateFrom = q.dateFrom?.trim();
  const dateTo = q.dateTo?.trim();
  const search = q.search?.trim();

  const filtersApplied = { dateFrom: dateFrom || null, dateTo: dateTo || null, search: search || null, page, pageSize };

  const params: unknown[] = [companyId];
  let p = 2;
  let filt = '';
  if (dateFrom) {
    filt += ` AND u.event_at >= $${p}::timestamptz`;
    params.push(`${dateFrom}T00:00:00.000Z`);
    p++;
  }
  if (dateTo) {
    filt += ` AND u.event_at <= $${p}::timestamptz`;
    params.push(`${dateTo}T23:59:59.999Z`);
    p++;
  }
  if (search) {
    filt += ` AND (u.source_no ILIKE $${p} OR u.description ILIKE $${p} OR u.operational_account ILIKE $${p})`;
    params.push(`%${search}%`);
    p++;
  }

  const unionSql = `
    SELECT v.created_at AS event_at,
           'سند'::text AS source_type,
           v.voucher_no AS source_no,
           (CASE v.voucher_type WHEN 'RECEIPT' THEN 'قبض نقدي' WHEN 'PAYMENT' THEN 'صرف نقدي' ELSE v.voucher_type END) AS operational_account,
           COALESCE(v.description, v.party_name, '') AS description,
           CASE WHEN v.status = 'CONFIRMED' AND v.voucher_type = 'RECEIPT' THEN v.amount ELSE 0 END::numeric AS debit,
           CASE WHEN v.status = 'CONFIRMED' AND v.voucher_type = 'PAYMENT' THEN v.amount ELSE 0 END::numeric AS credit,
           v.currency_code
    FROM vouchers v WHERE v.company_id = $1
    UNION ALL
    SELECT m.movement_at,
           'صندوق'::text,
           m.movement_no,
           m.movement_type || ' / ' || m.direction,
           m.description,
           CASE WHEN m.direction = 'IN' THEN m.amount ELSE 0 END::numeric,
           CASE WHEN m.direction = 'OUT' THEN m.amount ELSE 0 END::numeric,
           m.currency_code
    FROM cashbox_movements m WHERE m.company_id = $1
    UNION ALL
    SELECT ri.updated_at,
           'مرتجع'::text,
           ri.return_no,
           ri.return_type,
           COALESCE(ri.notes, ''),
           CASE WHEN ri.status = 'CONFIRMED' AND ri.return_type = 'PURCHASE_RETURN' THEN ri.total_amount ELSE 0 END::numeric,
           CASE WHEN ri.status = 'CONFIRMED' AND ri.return_type = 'SALES_RETURN' THEN ri.total_amount ELSE 0 END::numeric,
           ri.currency_code
    FROM return_invoices ri WHERE ri.company_id = $1
    UNION ALL
    SELECT pr.updated_at,
           'مسير رواتب'::text,
           pr.payroll_no,
           'رواتب'::text,
           COALESCE(pr.notes, ''),
           0::numeric,
           CASE WHEN pr.status IN ('CONFIRMED','PAID') THEN pr.total_net ELSE 0 END::numeric,
           pr.currency_code
    FROM payroll_runs pr WHERE pr.company_id = $1
    UNION ALL
    SELECT l.activity_at,
           'نشاط طرف'::text,
           COALESCE(l.reference_no, l.id::text),
           l.activity_type,
           l.description,
           CASE WHEN COALESCE(l.amount,0) > 0 THEN l.amount ELSE 0 END::numeric,
           CASE WHEN COALESCE(l.amount,0) < 0 THEN ABS(l.amount) ELSE 0 END::numeric,
           COALESCE(l.currency_code, 'USD')
    FROM party_activity_logs l WHERE l.company_id = $1
  `;

  const countQ = await pool.query<{ c: string }>(
    `SELECT COUNT(*)::int AS c FROM (${unionSql}) AS u WHERE 1=1 ${filt}`,
    params,
  );

  const dataQ = await pool.query(
    `SELECT u.event_at, u.source_type, u.source_no, u.operational_account, u.description, u.debit, u.credit, u.currency_code
     FROM (${unionSql}) AS u
     WHERE 1=1 ${filt}
     ORDER BY u.event_at DESC
     LIMIT $${p} OFFSET $${p + 1}`,
    [...params, pageSize, offset],
  );

  return buildReportPayload({
    key: 'gl',
    title: 'دفتر الأستاذ العام (تشغيلي)',
    subtitle: 'دفتر حركة تشغيلية مبنية على السندات والصناديق والمرتجعات والرواتب — ليست قيوداً مزدوجة رسمية',
    generatedAt: nowIso(),
    filtersApplied,
    columns: [
      dateCol('event_at', 'التاريخ'),
      textCol('source_type', 'المصدر'),
      textCol('source_no', 'رقم'),
      textCol('operational_account', 'حساب تشغيلي'),
      textCol('description', 'البيان'),
      moneyCol('debit', 'مدين'),
      moneyCol('credit', 'دائن'),
      textCol('currency_code', 'عملة'),
    ],
    rows: dataQ.rows as Record<string, unknown>[],
    meta: { page, pageSize, total: parseInt(countQ.rows[0].c, 10), dataCompleteness: 'PARTIAL' },
  });
}

export async function reportOperationalBalanceSummary(companyId: string): Promise<UnifiedReportPayload> {
  const pool = getPool();
  const r = await pool.query(
    `SELECT 'صناديق نقدية'::text AS account_label,
            SUM(CASE WHEN c.current_balance > 0 THEN c.current_balance ELSE 0 END)::numeric AS debit_total,
            SUM(CASE WHEN c.current_balance < 0 THEN -c.current_balance ELSE 0 END)::numeric AS credit_total,
            SUM(c.current_balance)::numeric AS balance,
            c.currency_code
     FROM cashboxes c WHERE c.company_id = $1 AND c.is_active = true
     GROUP BY c.currency_code
     UNION ALL
     SELECT 'سندات قبض مؤكدة', COALESCE(SUM(v.amount),0), 0, COALESCE(SUM(v.amount),0), v.currency_code
     FROM vouchers v WHERE v.company_id = $1 AND v.status='CONFIRMED' AND v.voucher_type='RECEIPT' GROUP BY v.currency_code
     UNION ALL
     SELECT 'سندات صرف مؤكدة', 0, COALESCE(SUM(v.amount),0), -COALESCE(SUM(v.amount),0), v.currency_code
     FROM vouchers v WHERE v.company_id = $1 AND v.status='CONFIRMED' AND v.voucher_type='PAYMENT' GROUP BY v.currency_code`,
    [companyId],
  );
  return buildReportPayload({
    key: 'tb',
    title: 'ميزان مراجعة تشغيلي',
    subtitle: 'تجميع أرصدة الصناديق والسندات — ليس ميزان مراجعة محاسبي كامل',
    generatedAt: nowIso(),
    filtersApplied: {},
    columns: [
      textCol('account_label', 'البند'),
      moneyCol('debit_total', 'إجمالي مدين'),
      moneyCol('credit_total', 'إجمالي دائن'),
      moneyCol('balance', 'صافي'),
      textCol('currency_code', 'عملة'),
    ],
    rows: r.rows as Record<string, unknown>[],
    meta: { total: r.rows.length, dataCompleteness: 'PARTIAL' },
  });
}

export async function reportOperationalIncomeExpense(companyId: string): Promise<UnifiedReportPayload> {
  const pool = getPool();
  const r = await pool.query(
    `WITH x AS (
       SELECT 'قبض عملاء (سندات)'::text AS category,
              COALESCE(SUM(amount) FILTER (WHERE status='CONFIRMED' AND voucher_type='RECEIPT' AND party_type='CUSTOMER'),0)::numeric AS income,
              0::numeric AS expense
       FROM vouchers WHERE company_id = $1
       UNION ALL
       SELECT 'صرف موردين (سندات)', 0,
              COALESCE(SUM(amount) FILTER (WHERE status='CONFIRMED' AND voucher_type='PAYMENT' AND party_type='SUPPLIER'),0)
       FROM vouchers WHERE company_id = $1
       UNION ALL
       SELECT 'مرتجع مبيعات', 0, COALESCE(SUM(total_amount) FILTER (WHERE status='CONFIRMED' AND return_type='SALES_RETURN'),0)
       FROM return_invoices WHERE company_id = $1
       UNION ALL
       SELECT 'مرتجع مشتريات', COALESCE(SUM(total_amount) FILTER (WHERE status='CONFIRMED' AND return_type='PURCHASE_RETURN'),0), 0
       FROM return_invoices WHERE company_id = $1
       UNION ALL
       SELECT 'رواتب مدفوعة/مؤكدة', 0, COALESCE(SUM(total_net) FILTER (WHERE status IN ('PAID','CONFIRMED')),0)
       FROM payroll_runs WHERE company_id = $1
     )
     SELECT category, SUM(income) AS income, SUM(expense) AS expense, SUM(income)-SUM(expense) AS net
     FROM x GROUP BY category ORDER BY category`,
    [companyId],
  );
  return buildReportPayload({
    key: 'pl',
    title: 'قائمة دخل / مصروف تشغيلية',
    subtitle: 'من السندات والمرتجعات والرواتب — تقريبية تشغيلية',
    generatedAt: nowIso(),
    filtersApplied: {},
    columns: [
      textCol('category', 'البند'),
      moneyCol('income', 'إيرادات'),
      moneyCol('expense', 'مصروفات'),
      moneyCol('net', 'الصافي'),
    ],
    rows: r.rows as Record<string, unknown>[],
    meta: { total: r.rows.length },
  });
}

export async function reportOperationalPosition(companyId: string): Promise<UnifiedReportPayload> {
  const pool = getPool();
  const r = await pool.query(
    `SELECT 'نقد وصناديق'::text AS section, c.currency_code::text AS item, SUM(c.current_balance)::numeric AS amount,
            'أرصدة حالية'::text AS note
     FROM cashboxes c WHERE c.company_id = $1 AND c.is_active GROUP BY c.currency_code
     UNION ALL
     SELECT 'مخزون أقمشة (طول م)', 'إجمالي أمتار', COALESCE(SUM(length_m),0), 'كمية فقط'
     FROM fabric_rolls WHERE company_id = $1
     UNION ALL
     SELECT 'سندات معلقة', 'مسودات سندات', COUNT(*)::numeric, 'عدد'
     FROM vouchers WHERE company_id = $1 AND status='DRAFT'`,
    [companyId],
  );
  return buildReportPayload({
    key: 'bs',
    title: 'مركز مالي تشغيلي',
    subtitle: 'ملخص مواقع نقدية ومخزون وسندات — ليس ميزانية عمومية',
    generatedAt: nowIso(),
    filtersApplied: {},
    columns: [
      textCol('section', 'قسم'),
      textCol('item', 'بند'),
      moneyCol('amount', 'قيمة'),
      textCol('note', 'ملاحظة'),
    ],
    rows: r.rows as Record<string, unknown>[],
    meta: { total: r.rows.length },
  });
}

export async function reportCashFlow(
  companyId: string,
  q: Record<string, string | undefined>,
): Promise<UnifiedReportPayload> {
  const pool = getPool();
  const dateFrom = q.dateFrom?.trim();
  const dateTo = q.dateTo?.trim();
  const conditions = ['m.company_id = $1'];
  const params: unknown[] = [companyId];
  let p = 2;
  if (dateFrom) {
    conditions.push(`m.movement_at::date >= $${p}::date`);
    params.push(dateFrom);
    p++;
  }
  if (dateTo) {
    conditions.push(`m.movement_at::date <= $${p}::date`);
    params.push(dateTo);
    p++;
  }
  const where = conditions.join(' AND ');
  const r = await pool.query(
    `SELECT m.movement_at::date AS period,
            m.currency_code,
            SUM(CASE WHEN m.direction='IN' THEN m.amount ELSE 0 END)::numeric AS inflow,
            SUM(CASE WHEN m.direction='OUT' THEN m.amount ELSE 0 END)::numeric AS outflow,
            SUM(CASE WHEN m.direction='IN' THEN m.amount WHEN m.direction='OUT' THEN -m.amount ELSE 0 END)::numeric AS net_flow
     FROM cashbox_movements m
     WHERE ${where}
     GROUP BY m.movement_at::date, m.currency_code
     ORDER BY period DESC`,
    params,
  );
  return buildReportPayload({
    key: 'cf',
    title: 'قائمة التدفقات النقدية (تشغيلية)',
    subtitle: 'مجمّعة من حركات الصناديق',
    generatedAt: nowIso(),
    filtersApplied: { dateFrom: dateFrom || null, dateTo: dateTo || null },
    columns: [
      dateCol('period', 'اليوم'),
      textCol('currency_code', 'عملة'),
      moneyCol('inflow', 'وارد'),
      moneyCol('outflow', 'صادر'),
      moneyCol('net_flow', 'صافي'),
    ],
    rows: r.rows as Record<string, unknown>[],
    meta: { total: r.rows.length },
  });
}

export async function reportReceiptsPayments(
  companyId: string,
  q: Record<string, string | undefined>,
): Promise<UnifiedReportPayload> {
  const pool = getPool();
  const { page, pageSize, offset } = pageParams(q);
  const dateFrom = q.dateFrom?.trim();
  const dateTo = q.dateTo?.trim();
  const params: unknown[] = [companyId];
  let p = 2;
  let wc = 'v.company_id = $1';
  if (dateFrom) {
    wc += ` AND v.voucher_date >= $${p}::date`;
    params.push(dateFrom);
    p++;
  }
  if (dateTo) {
    wc += ` AND v.voucher_date <= $${p}::date`;
    params.push(dateTo);
    p++;
  }
  const cnt = await pool.query<{ c: string }>(`SELECT COUNT(*)::int AS c FROM vouchers v WHERE ${wc}`, params);
  const data = await pool.query(
    `SELECT v.voucher_date::text AS date, v.voucher_type::text AS type, v.voucher_no AS source_no,
            v.party_name, v.amount, v.currency_code, c.name AS cashbox, v.status
     FROM vouchers v
     LEFT JOIN cashboxes c ON c.id = v.cashbox_id
     WHERE ${wc}
     ORDER BY v.voucher_date DESC
     LIMIT $${p} OFFSET $${p + 1}`,
    [...params, pageSize, offset],
  );
  return buildReportPayload({
    key: 'fin_rec_pay',
    title: 'ملخص المقبوضات والمدفوعات',
    generatedAt: nowIso(),
    filtersApplied: { dateFrom: dateFrom || null, dateTo: dateTo || null, page, pageSize },
    columns: [
      dateCol('date', 'التاريخ'),
      textCol('type', 'نوع'),
      textCol('source_no', 'رقم'),
      textCol('party_name', 'الطرف'),
      moneyCol('amount', 'مبلغ'),
      textCol('currency_code', 'عملة'),
      textCol('cashbox', 'صندوق'),
      textCol('status', 'حالة'),
    ],
    rows: data.rows as Record<string, unknown>[],
    meta: { page, pageSize, total: parseInt(cnt.rows[0].c, 10) },
  });
}

export async function reportAccountActivity(
  companyId: string,
  q: Record<string, string | undefined>,
): Promise<UnifiedReportPayload> {
  const r = await reportOperationalLedger(companyId, q);
  return {
    ...r,
    key: 'fin_acct_act',
    title: 'تقرير حركة الحساب المخصص',
    subtitle: 'نفس استعلام دفتر الحركة التشغيلية مع الفلاتر الزمنية ونص البحث',
  };
}

export async function reportCurrencyDifferences(companyId: string): Promise<UnifiedReportPayload> {
  const pool = getPool();
  const r = await pool.query(
    `SELECT v.currency_code,
            COALESCE(SUM(v.amount) FILTER (WHERE v.status='CONFIRMED' AND v.voucher_type='RECEIPT'),0)::numeric AS receipts_total,
            COALESCE(SUM(v.amount) FILTER (WHERE v.status='CONFIRMED' AND v.voucher_type='PAYMENT'),0)::numeric AS payments_total,
            COALESCE(SUM(CASE WHEN v.voucher_type='RECEIPT' THEN v.amount WHEN v.voucher_type='PAYMENT' THEN -v.amount ELSE 0 END)
              FILTER (WHERE v.status='CONFIRMED'),0)::numeric AS balance,
            'تعرّض عملات من السندات'::text AS notes
     FROM vouchers v WHERE v.company_id = $1
     GROUP BY v.currency_code
     UNION ALL
     SELECT c.currency_code,
            0, 0, SUM(c.current_balance), 'أرصدة صناديق'
     FROM cashboxes c WHERE c.company_id = $1 AND c.is_active GROUP BY c.currency_code`,
    [companyId],
  );
  return buildReportPayload({
    key: 'fx',
    title: 'تعرّض العملات والأرصدة',
    subtitle: 'بدون محرك فروقات صرف — أرصدة وسندات حسب العملة',
    generatedAt: nowIso(),
    filtersApplied: {},
    columns: [
      textCol('currency_code', 'عملة'),
      moneyCol('receipts_total', 'قبض'),
      moneyCol('payments_total', 'صرف'),
      moneyCol('balance', 'صافي'),
      textCol('notes', 'ملاحظة'),
    ],
    rows: r.rows as Record<string, unknown>[],
    meta: { total: r.rows.length, note: 'لا يتم احتساب مكاسب/خسائر صرف فعلية بدون محرك FX.' },
  });
}
