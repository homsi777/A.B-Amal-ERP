import { getPool } from '../db/pool.js';
import type { UnifiedReportPayload } from './reportTypes.js';
import { nowIso } from './reportTypes.js';
import { buildReportPayload, dateCol, emptyReport, moneyCol, numCol, pageParams, textCol } from './reportHelpers.js';
import { reportPartyActivity } from './reportService.js';

// ─── Sales (operational) ────────────────────────────────────────────────────

/** Net line revenue in USD — respects line_discount or legacy header discount allocation. */
const SQL_NET_LINE_REVENUE_USD = `
  ROUND(
    CASE
      WHEN COALESCE(sil.line_discount, 0) > 0 OR COALESCE(sil.line_discount_usd, 0) > 0
        THEN COALESCE(
          sil.line_total_usd,
          CASE WHEN si.currency_code = 'USD' THEN sil.line_total ELSE sil.line_total / NULLIF(si.exchange_rate_to_usd, 0) END,
          0
        )
      WHEN si.discount_total > 0 AND si.subtotal > 0
        THEN COALESCE(
          sil.line_total_usd,
          CASE WHEN si.currency_code = 'USD' THEN sil.line_total ELSE sil.line_total / NULLIF(si.exchange_rate_to_usd, 0) END,
          0
        ) * (si.total_amount / NULLIF(si.subtotal, 0))
      ELSE COALESCE(
        sil.line_total_usd,
        CASE WHEN si.currency_code = 'USD' THEN sil.line_total ELSE sil.line_total / NULLIF(si.exchange_rate_to_usd, 0) END,
        0
      )
    END,
    4
  )::numeric`;

const SQL_LINE_COST_USD = `
  CASE
    WHEN sil.cost_source IS NOT NULL
         AND sil.cost_source <> 'MISSING'
         AND COALESCE(sil.cost_missing, false) IS FALSE
         AND sil.cost_total_usd IS NOT NULL
      THEN sil.cost_total_usd
    WHEN sil.cost_source IS NOT NULL
         AND sil.cost_source <> 'MISSING'
         AND COALESCE(sil.cost_missing, false) IS FALSE
         AND sil.cost_total IS NOT NULL
         AND sil.cost_exchange_rate_to_usd IS NOT NULL
         AND sil.cost_exchange_rate_to_usd > 0
      THEN sil.cost_total / sil.cost_exchange_rate_to_usd
    WHEN sil.cost_source IS NULL AND fr.unit_cost IS NOT NULL AND fr.unit_cost > 0
      THEN (
        (CASE WHEN sil.unit = 'yard' THEN sil.quantity * 0.9144 ELSE sil.quantity END) * fr.unit_cost
        / NULLIF(
          CASE
            WHEN UPPER(COALESCE(fr.currency_code, si.currency_code, 'USD')) = 'USD' THEN 1
            WHEN UPPER(COALESCE(fr.currency_code, '')) = UPPER(COALESCE(si.currency_code, ''))
              THEN si.exchange_rate_to_usd
            ELSE NULL
          END,
          0
        )
      )
    ELSE 0
  END::numeric`;

export async function reportSalesSummary(companyId: string): Promise<UnifiedReportPayload> {
  const pool = getPool();
  const si = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE document_status = 'CONFIRMED')::int AS confirmed_count,
       COALESCE(SUM(total_amount) FILTER (WHERE document_status = 'CONFIRMED'), 0)::numeric AS confirmed_total,
       COALESCE(SUM(total_amount_usd) FILTER (WHERE document_status = 'CONFIRMED'), 0)::numeric AS confirmed_total_usd,
       COALESCE(SUM(paid_amount) FILTER (WHERE document_status = 'CONFIRMED'), 0)::numeric AS paid_total,
       COALESCE(SUM(remaining_amount) FILTER (WHERE document_status = 'CONFIRMED'), 0)::numeric AS remaining_total
     FROM sales_invoices WHERE company_id = $1`,
    [companyId],
  );
  const v = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE status='CONFIRMED' AND voucher_type='RECEIPT' AND party_type='CUSTOMER')::int AS customer_receipts,
       COALESCE(SUM(amount) FILTER (WHERE status='CONFIRMED' AND voucher_type='RECEIPT' AND party_type='CUSTOMER'),0)::numeric AS receipt_sum
     FROM vouchers WHERE company_id = $1`,
    [companyId],
  );
  const p = await pool.query(
    `SELECT COUNT(*)::int AS n, COALESCE(SUM(total_amount) FILTER (WHERE status='CONFIRMED'),0)::numeric AS t
     FROM return_invoices WHERE company_id = $1 AND return_type='SALES_RETURN'`,
    [companyId],
  );
  const l = await pool.query(
    `SELECT COUNT(*)::int AS n FROM party_activity_logs WHERE company_id = $1 AND party_type='CUSTOMER'`,
    [companyId],
  );
  return buildReportPayload({
    key: 'sa1',
    title: 'ملخص المبيعات (تشغيلي)',
    subtitle: 'فواتير بيع مؤكدة + سندات قبض ومرتجعات (تكميلي)',
    generatedAt: nowIso(),
    filtersApplied: {},
    columns: [textCol('k', 'المؤشر'), textCol('v', 'القيمة')],
    rows: [
      { k: 'فواتير بيع مؤكدة (عدد)', v: si.rows[0].confirmed_count },
      { k: 'إجمالي فواتير بيع مؤكدة', v: String(si.rows[0].confirmed_total) },
      { k: 'إجمالي فواتير بيع (USD)', v: String(si.rows[0].confirmed_total_usd) },
      { k: 'محصل على فواتير البيع', v: String(si.rows[0].paid_total) },
      { k: 'متبقي ذمم فواتير البيع', v: String(si.rows[0].remaining_total) },
      { k: '— سندات قبض عملاء (عدد مؤكد)', v: v.rows[0].customer_receipts },
      { k: '— إجمالي قبض عملاء (سندات)', v: String(v.rows[0].receipt_sum) },
      { k: 'مرتجع مبيعات (عدد مؤكد)', v: p.rows[0].n },
      { k: 'إجمالي مرتجع مبيعات', v: String(p.rows[0].t) },
      { k: 'سجلات نشاط عملاء', v: l.rows[0].n },
    ],
    meta: { dataCompleteness: 'FULL' },
  });
}

export async function reportSalesDetails(
  companyId: string,
  q: Record<string, string | undefined>,
): Promise<UnifiedReportPayload> {
  const pool = getPool();
  const { page, pageSize, offset } = pageParams(q);
  const wc = `company_id = $1 AND party_type = 'CUSTOMER'`;
  const cnt = await pool.query<{ c: string }>(
    `SELECT COUNT(*)::int AS c FROM party_activity_logs WHERE ${wc}`,
    [companyId],
  );
  const data = await pool.query(
    `SELECT activity_at::text AS date, reference_type AS source_type, reference_no AS source_no,
            party_name AS customer, amount, currency_code, activity_type AS status
     FROM party_activity_logs WHERE ${wc}
     ORDER BY activity_at DESC LIMIT $2 OFFSET $3`,
    [companyId, pageSize, offset],
  );
  return buildReportPayload({
    key: 'sa2',
    title: 'المبيعات التفصيلية (نشاط عملاء)',
    subtitle: 'من سجل نشاط الأطراف للعملاء',
    generatedAt: nowIso(),
    filtersApplied: { page, pageSize },
    columns: [
      dateCol('date', 'التاريخ'),
      textCol('source_type', 'نوع المصدر'),
      textCol('source_no', 'مرجع'),
      textCol('customer', 'العميل'),
      moneyCol('amount', 'مبلغ'),
      textCol('currency_code', 'عملة'),
      textCol('status', 'النشاط'),
    ],
    rows: data.rows as Record<string, unknown>[],
    meta: { page, pageSize, total: parseInt(cnt.rows[0].c, 10) },
  });
}

const SQL_GROSS_LINE_USD = `
  ROUND(
    (CASE WHEN sil.unit = 'yard' THEN sil.quantity * 0.9144 ELSE sil.quantity END * sil.unit_price)
    / NULLIF(CASE WHEN si.currency_code = 'USD' THEN 1 ELSE si.exchange_rate_to_usd END, 0),
    4
  )::numeric`;

const SQL_LINE_DISCOUNT_USD = `
  ROUND(
    CASE
      WHEN COALESCE(sil.line_discount, 0) > 0 OR COALESCE(sil.line_discount_usd, 0) > 0
        THEN COALESCE(
          sil.line_discount_usd,
          CASE WHEN si.currency_code = 'USD' THEN sil.line_discount ELSE sil.line_discount / NULLIF(si.exchange_rate_to_usd, 0) END,
          0
        )
      WHEN si.discount_total > 0 AND si.subtotal > 0
        THEN (${SQL_GROSS_LINE_USD}) * (si.discount_total / NULLIF(si.subtotal, 0))
      ELSE 0
    END,
    4
  )::numeric`;

export async function reportSalesByItem(
  companyId: string,
  q: Record<string, string | undefined> = {},
): Promise<UnifiedReportPayload> {
  const pool = getPool();
  const { page, pageSize, offset } = pageParams(q);
  const statusFilter = (q.documentStatus || q.status || 'CONFIRMED').trim().toUpperCase();
  const includeReturns = q.includeReturns !== 'false';

  const filters: string[] = [`si.company_id = $1`];
  const params: unknown[] = [companyId];
  let p = 2;

  if (statusFilter && statusFilter !== 'ALL') {
    filters.push(`si.document_status = $${p++}`);
    params.push(statusFilter);
  }
  if (q.fromDate) {
    filters.push(`si.invoice_date >= $${p++}::date`);
    params.push(q.fromDate);
  }
  if (q.toDate) {
    filters.push(`si.invoice_date <= $${p++}::date`);
    params.push(q.toDate);
  }
  if (isUuidLike(q.customerId)) {
    filters.push(`si.customer_id = $${p++}::uuid`);
    params.push(q.customerId);
  }
  if (isUuidLike(q.fabricItemId) || isUuidLike(q.itemId)) {
    filters.push(`COALESCE(sil.fabric_item_id, fr.item_id) = $${p++}::uuid`);
    params.push(q.fabricItemId || q.itemId);
  }
  if (q.materialCode?.trim()) {
    filters.push(`fi.internal_code ILIKE $${p++}`);
    params.push(`%${q.materialCode.trim()}%`);
  }
  if (q.designCode?.trim()) {
    filters.push(`(fi.internal_code ILIKE $${p++} OR fv.variant_code ILIKE $${p++})`);
    params.push(`%${q.designCode.trim()}%`, `%${q.designCode.trim()}%`);
  }

  const where = filters.join(' AND ');
  const returnCte = includeReturns
    ? `
    return_by_line AS (
      SELECT ril.original_sales_invoice_line_id AS line_id,
             SUM(CASE WHEN ril.unit = 'yard' THEN ril.quantity * 0.9144 ELSE ril.quantity END)::numeric AS returned_meters,
             SUM(
               ROUND(
                 ril.line_total / NULLIF(
                   CASE WHEN ri.currency_code = 'USD' THEN 1 ELSE ri.exchange_rate_to_usd END, 0
                 ), 4
               )
             )::numeric AS returned_amount_usd
      FROM return_invoice_lines ril
      INNER JOIN return_invoices ri ON ri.id = ril.return_invoice_id AND ri.company_id = ril.company_id
      WHERE ril.company_id = $1
        AND ri.return_type = 'SALES_RETURN'
        AND ri.status = 'CONFIRMED'
        AND ril.original_sales_invoice_line_id IS NOT NULL
      GROUP BY ril.original_sales_invoice_line_id
    ),`
    : `
    return_by_line AS (
      SELECT NULL::uuid AS line_id, 0::numeric AS returned_meters, 0::numeric AS returned_amount_usd
      WHERE false
    ),`;

  const baseSql = `
    WITH ${returnCte}
    sales_lines AS (
      SELECT
        COALESCE(fi.id, fr.item_id) AS material_id,
        fi.name AS material_name,
        fi.internal_code AS material_code,
        COALESCE(fv.variant_code, fi.internal_code) AS design_name,
        sil.id AS line_id,
        (CASE WHEN sil.unit = 'yard' THEN sil.quantity * 0.9144 ELSE sil.quantity END)::numeric AS quantity_meters,
        sil.quantity,
        ${SQL_GROSS_LINE_USD} AS gross_sales_usd,
        ${SQL_LINE_DISCOUNT_USD} AS discount_usd,
        ${SQL_NET_LINE_REVENUE_USD} AS net_sales_usd,
        ${SQL_LINE_COST_USD} AS cost_usd
      FROM sales_invoice_lines sil
      INNER JOIN sales_invoices si ON si.id = sil.invoice_id AND si.company_id = sil.company_id
      LEFT JOIN fabric_rolls fr ON fr.id = sil.fabric_roll_id AND fr.company_id = sil.company_id
      LEFT JOIN fabric_items fi ON fi.id = COALESCE(sil.fabric_item_id, fr.item_id) AND fi.company_id = sil.company_id
      LEFT JOIN fabric_item_variants fv ON fv.id = sil.variant_id AND fv.company_id = sil.company_id
      WHERE ${where}
    ),
    item_agg AS (
      SELECT
        COALESCE(material_id::text, material_code, material_name, 'unknown') AS group_key,
        COALESCE(NULLIF(material_name, ''), 'بدون خامة') AS material_name,
        COALESCE(material_code, '') AS material_code,
        COALESCE(NULLIF(design_name, ''), '—') AS design_name,
        ROUND(COALESCE(SUM(sl.quantity), 0), 3)::text AS quantity_sold,
        ROUND(COALESCE(SUM(sl.quantity_meters), 0), 2)::text AS meters_sold,
        ROUND(COALESCE(SUM(sl.gross_sales_usd), 0), 2)::text AS gross_sales_amount,
        ROUND(COALESCE(SUM(sl.discount_usd), 0), 2)::text AS discount_amount,
        ROUND(COALESCE(SUM(sl.net_sales_usd), 0), 2)::text AS net_sales_amount,
        ROUND(COALESCE(SUM(sl.cost_usd), 0), 2)::text AS cost_amount,
        ROUND(COALESCE(SUM(sl.net_sales_usd - sl.cost_usd), 0), 2)::text AS gross_profit,
        CASE
          WHEN COALESCE(SUM(sl.net_sales_usd), 0) > 0
            THEN ROUND((SUM(sl.net_sales_usd - sl.cost_usd) / SUM(sl.net_sales_usd)) * 100, 2)::text
          ELSE '0.00'
        END AS profit_percent,
        ROUND(COALESCE(SUM(rbl.returned_meters), 0), 2)::text AS returned_quantity,
        ROUND(COALESCE(SUM(rbl.returned_amount_usd), 0), 2)::text AS returned_amount,
        ROUND(COALESCE(SUM(sl.quantity_meters), 0) - COALESCE(SUM(rbl.returned_meters), 0), 2)::text AS net_quantity_after_returns,
        ROUND(COALESCE(SUM(sl.net_sales_usd), 0) - COALESCE(SUM(rbl.returned_amount_usd), 0), 2)::text AS net_revenue_after_returns
      FROM sales_lines sl
      LEFT JOIN return_by_line rbl ON rbl.line_id = sl.line_id
      GROUP BY 1, 2, 3, 4
    )
  `;

  const cnt = await pool.query<{ c: string }>(`${baseSql} SELECT COUNT(*)::int AS c FROM item_agg`, params);
  const data = await pool.query(
    `${baseSql}
     SELECT * FROM item_agg
     ORDER BY net_sales_amount::numeric DESC
     LIMIT $${p++} OFFSET $${p++}`,
    [...params, pageSize, offset],
  );
  const totals = await pool.query(
    `${baseSql}
     SELECT
       ROUND(COALESCE(SUM(gross_sales_amount::numeric), 0), 2)::text AS gross_sales_amount,
       ROUND(COALESCE(SUM(discount_amount::numeric), 0), 2)::text AS discount_amount,
       ROUND(COALESCE(SUM(net_sales_amount::numeric), 0), 2)::text AS net_sales_amount,
       ROUND(COALESCE(SUM(cost_amount::numeric), 0), 2)::text AS cost_amount,
       ROUND(COALESCE(SUM(gross_profit::numeric), 0), 2)::text AS gross_profit,
       ROUND(COALESCE(SUM(returned_amount::numeric), 0), 2)::text AS returned_amount,
       ROUND(COALESCE(SUM(net_revenue_after_returns::numeric), 0), 2)::text AS net_revenue_after_returns
     FROM item_agg`,
    params,
  );

  return buildReportPayload({
    key: 'sa_item',
    title: 'المبيعات حسب الصنف',
    subtitle: 'تجميع تشغيلي من أسطر فواتير البيع — USD',
    generatedAt: nowIso(),
    filtersApplied: { ...q, documentStatus: statusFilter, includeReturns },
    columns: [
      textCol('material_name', 'الخامة'),
      textCol('material_code', 'كود الخامة'),
      textCol('design_name', 'التصميم'),
      numCol('quantity_sold', 'الكمية المباعة'),
      moneyCol('meters_sold', 'الأمتار'),
      moneyCol('gross_sales_amount', 'إجمالي البيع'),
      moneyCol('discount_amount', 'الخصم'),
      moneyCol('net_sales_amount', 'صافي البيع'),
      moneyCol('cost_amount', 'التكلفة'),
      moneyCol('gross_profit', 'الربح الإجمالي'),
      textCol('profit_percent', 'نسبة الربح %'),
      moneyCol('returned_quantity', 'كمية مرتجعة (م)'),
      moneyCol('returned_amount', 'قيمة مرتجعة'),
      moneyCol('net_quantity_after_returns', 'صافي الكمية بعد المرتجع'),
      moneyCol('net_revenue_after_returns', 'صافي الإيراد بعد المرتجع'),
    ],
    rows: data.rows as Record<string, unknown>[],
    totals: totals.rows[0] ?? {},
    meta: {
      page,
      pageSize,
      total: parseInt(cnt.rows[0]?.c ?? '0', 10),
      dataCompleteness: data.rows.length ? 'FULL' : 'EMPTY_REASON',
      note: includeReturns ? 'يشمل خصم المرتجعات المرتبطة بأسطر البيع' : 'بدون خصم المرتجعات',
    },
  });
}

export async function reportSalesByCustomer(
  companyId: string,
  q: Record<string, string | undefined>,
): Promise<UnifiedReportPayload> {
  const pool = getPool();
  const data = await pool.query(
    `SELECT party_name AS customer,
            COUNT(*)::int AS movements,
            COALESCE(SUM(amount),0)::numeric AS total_amount,
            COALESCE(currency_code,'USD') AS currency_code
     FROM party_activity_logs
     WHERE company_id = $1 AND party_type = 'CUSTOMER'
     GROUP BY party_name, currency_code ORDER BY total_amount DESC`,
    [companyId],
  );
  return buildReportPayload({
    key: 'sa_cust',
    title: 'المبيعات حسب العميل (نشاط)',
    generatedAt: nowIso(),
    filtersApplied: {},
    columns: [
      textCol('customer', 'العميل'),
      numCol('movements', 'حركات'),
      moneyCol('total_amount', 'مجموع مبالغ'),
      textCol('currency_code', 'عملة'),
    ],
    rows: data.rows as Record<string, unknown>[],
    meta: { total: data.rows.length },
  });
}

export async function reportSalesByAgent(): Promise<UnifiedReportPayload> {
  return emptyReport({
    key: 'sa_agent',
    title: 'المبيعات حسب المندوب',
    columns: [textCol('agent_name', 'المندوب'), moneyCol('amount', 'مبلغ')],
    metaNote: 'لا توجد بيانات مندوبين مرتبطة بعد في النظام.',
    dataCompleteness: 'EMPTY_REASON',
  });
}

export async function reportSalesByColor(): Promise<UnifiedReportPayload> {
  return emptyReport({
    key: 'sa_color',
    title: 'المبيعات حسب اللون',
    columns: [textCol('color_name', 'اللون'), numCol('rolls', 'أتواب'), moneyCol('amount', 'قيمة')],
    metaNote: 'لا توجد أسطر بيع مرتبطة بالألوان بعد.',
    dataCompleteness: 'EMPTY_REASON',
  });
}

export async function reportSalesMargins(): Promise<UnifiedReportPayload> {
  return emptyReport({
    key: 'sa_margins',
    title: 'تحليل هوامش الربح',
    columns: [textCol('item', 'بند'), moneyCol('revenue', 'إيراد'), moneyCol('cost', 'تكلفة'), moneyCol('margin', 'هامش')],
    metaNote: 'يتطلب بيانات بيع وتكلفة مرحّلة على مستوى الصنف.',
    dataCompleteness: 'EMPTY_REASON',
  });
}

// ─── Purchases ──────────────────────────────────────────────────────────────

function buildCostWarnings(input: { missingCostCount: number; fallbackCostCount: number; partialCostCount: number }) {
  const warnings: Array<{ code: string; count?: number; message: string }> = [];
  if (input.missingCostCount > 0) {
    warnings.push({
      code: 'MISSING_COST',
      count: input.missingCostCount,
      message: 'توجد فواتير أو بنود بدون تكلفة مثبتة، لذلك قد لا يكون الربح مكتملاً.',
    });
  }
  if (input.fallbackCostCount > 0) {
    warnings.push({
      code: 'CURRENT_COST_FALLBACK',
      count: input.fallbackCostCount,
      message: 'بعض الفواتير القديمة تستخدم تكلفة حالية كتقدير لأنها لا تحتوي تكلفة تاريخية محفوظة.',
    });
  }
  if (input.partialCostCount > 0) {
    warnings.push({
      code: 'PARTIAL_COST',
      count: input.partialCostCount,
      message: 'توجد بنود بتكلفة جزئية أو تحويل غير مكتمل إلى العملة الأساسية.',
    });
  }
  warnings.push({
    code: 'VOUCHER_ALLOCATION_LIMITED',
    message: 'المحصل والمتبقي مأخوذان من الفاتورة؛ سندات القبض العامة غير موزعة على الفواتير بدقة في هذا الإصدار.',
  });
  return warnings;
}

function isUuidLike(value: string | undefined): value is string {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}

type ProfitGroupBy = 'none' | 'customer' | 'material' | 'supplier' | 'date';

function profitGroupBy(value: string | undefined): ProfitGroupBy {
  return value === 'customer' || value === 'material' || value === 'supplier' || value === 'date' ? value : 'none';
}

async function queryProfitTopCustomerInsight(
  companyId: string,
  q: Record<string, string | undefined>,
): Promise<{
  customerId: string;
  customerName: string;
  salesAmount: string;
  costAmount: string;
  grossProfit: string;
  paidAmount: string;
  remainingAmount: string;
  soldMeters: string;
  remainingReceivableMeters: string;
  invoiceCount: number;
  lastInvoiceDate: string;
  topMaterialName: string;
  topInvoices: Array<{ invoiceId: string; invoiceNo: string; invoiceDate: string; salesAmount: string; soldMeters: string; remainingAmount: string }>;
} | null> {
  const pool = getPool();
  const filters: string[] = [`si.company_id = $1`, `si.document_status = 'CONFIRMED'`];
  const params: unknown[] = [companyId];
  let p = 2;

  if (q.fromDate) {
    filters.push(`si.invoice_date >= $${p++}::date`);
    params.push(q.fromDate);
  }
  if (q.toDate) {
    filters.push(`si.invoice_date <= $${p++}::date`);
    params.push(q.toDate);
  }
  if (isUuidLike(q.customerId)) {
    filters.push(`si.customer_id = $${p++}::uuid`);
    params.push(q.customerId);
  }
  if (q.paymentStatus && ['paid', 'partial', 'unpaid'].includes(q.paymentStatus)) {
    filters.push(`si.payment_status = $${p++}`);
    params.push(q.paymentStatus);
  }
  if (q.materialCode?.trim()) {
    filters.push(`fi.internal_code ILIKE $${p++}`);
    params.push(`%${q.materialCode.trim()}%`);
  }
  if (isUuidLike(q.supplierId)) {
    filters.push(`COALESCE(fr.supplier_id, fi.supplier_id) = $${p++}::uuid`);
    params.push(q.supplierId);
  }
  if (isUuidLike(q.warehouseId)) {
    filters.push(`COALESCE(sil.warehouse_id, fr.warehouse_id, si.warehouse_id) = $${p++}::uuid`);
    params.push(q.warehouseId);
  }

  const where = filters.join(' AND ');
  const baseSql = `
    WITH line_profit AS (
      SELECT
        si.id AS invoice_id,
        si.invoice_no,
        si.invoice_date,
        si.customer_id,
        c.name AS customer_name,
        COALESCE(fi.id, fr.item_id) AS material_id,
        fi.name AS material_name,
        fi.internal_code AS material_code,
        ${SQL_NET_LINE_REVENUE_USD} AS sales_amount,
        ${SQL_LINE_COST_USD} AS cost_amount,
        (CASE WHEN sil.unit = 'yard' THEN sil.quantity * 0.9144 ELSE sil.quantity END)::numeric AS quantity_meters,
        COALESCE(si.total_amount_usd, CASE WHEN si.currency_code='USD' THEN si.total_amount ELSE si.total_amount / NULLIF(si.exchange_rate_to_usd, 0) END, 0)::numeric AS total_amount_usd,
        COALESCE(si.paid_amount_usd, CASE WHEN si.currency_code='USD' THEN si.paid_amount ELSE si.paid_amount / NULLIF(si.exchange_rate_to_usd, 0) END, 0)::numeric AS paid_amount_usd,
        COALESCE(si.remaining_amount_usd, CASE WHEN si.currency_code='USD' THEN si.remaining_amount ELSE si.remaining_amount / NULLIF(si.exchange_rate_to_usd, 0) END, 0)::numeric AS remaining_amount_usd
      FROM sales_invoice_lines sil
      INNER JOIN sales_invoices si ON si.id = sil.invoice_id AND si.company_id = sil.company_id
      INNER JOIN customers c ON c.id = si.customer_id AND c.company_id = si.company_id
      LEFT JOIN fabric_rolls fr ON fr.id = sil.fabric_roll_id AND fr.company_id = sil.company_id
      LEFT JOIN fabric_items fi ON fi.id = COALESCE(sil.fabric_item_id, fr.item_id) AND fi.company_id = sil.company_id
      WHERE ${where}
    )
  `;

  const top = await pool.query(
    `${baseSql}
     SELECT customer_id::text AS customer_id,
            customer_name,
            ROUND(COALESCE(SUM(sales_amount), 0), 2)::text AS sales_amount,
            ROUND(COALESCE(SUM(cost_amount), 0), 2)::text AS cost_amount,
            ROUND(COALESCE(SUM(sales_amount - cost_amount), 0), 2)::text AS gross_profit,
            ROUND(COALESCE(SUM(CASE WHEN COALESCE(total_amount_usd, 0) > 0 THEN (paid_amount_usd / total_amount_usd) * sales_amount ELSE 0 END), 0), 2)::text AS paid_amount,
            ROUND(COALESCE(SUM(CASE WHEN COALESCE(total_amount_usd, 0) > 0 THEN (remaining_amount_usd / total_amount_usd) * sales_amount ELSE 0 END), 0), 2)::text AS remaining_amount,
            ROUND(COALESCE(SUM(quantity_meters), 0), 2)::text AS sold_meters,
            ROUND(COALESCE(SUM(CASE WHEN COALESCE(total_amount_usd, 0) > 0 THEN (remaining_amount_usd / total_amount_usd) * quantity_meters ELSE 0 END), 0), 2)::text AS remaining_receivable_meters,
            COUNT(DISTINCT invoice_id)::int AS invoice_count,
            MAX(invoice_date)::text AS last_invoice_date
     FROM line_profit
     GROUP BY 1, 2
     ORDER BY COALESCE(SUM(sales_amount), 0) DESC, MAX(invoice_date) DESC
     LIMIT 1`,
    params,
  );
  const topRow = top.rows[0];
  if (!topRow?.customer_id) return null;

  const customerId = String(topRow.customer_id);
  const customerParamIndex = params.length + 1;
  const topMaterial = await pool.query(
    `${baseSql}
     SELECT COALESCE(NULLIF(CONCAT_WS(' - ', material_code, material_name), ''), '—') AS top_material
     FROM line_profit
     WHERE customer_id::text = $${customerParamIndex}
     GROUP BY 1
     ORDER BY COALESCE(SUM(sales_amount), 0) DESC
     LIMIT 1`,
    [...params, customerId],
  );

  const invoices = await pool.query(
    `${baseSql}
     SELECT invoice_id::text AS invoice_id,
            invoice_no,
            invoice_date::text AS invoice_date,
            ROUND(COALESCE(SUM(sales_amount), 0), 2)::text AS sales_amount,
            ROUND(COALESCE(SUM(quantity_meters), 0), 2)::text AS sold_meters,
            ROUND(COALESCE(SUM(CASE WHEN COALESCE(total_amount_usd, 0) > 0 THEN (remaining_amount_usd / total_amount_usd) * sales_amount ELSE 0 END), 0), 2)::text AS remaining_amount
     FROM line_profit
     WHERE customer_id::text = $${customerParamIndex}
     GROUP BY 1, 2, 3
     ORDER BY COALESCE(SUM(sales_amount), 0) DESC, invoice_date DESC
     LIMIT 5`,
    [...params, customerId],
  );

  return {
    customerId,
    customerName: String(topRow.customer_name ?? '—'),
    salesAmount: String(topRow.sales_amount ?? '0.00'),
    costAmount: String(topRow.cost_amount ?? '0.00'),
    grossProfit: String(topRow.gross_profit ?? '0.00'),
    paidAmount: String(topRow.paid_amount ?? '0.00'),
    remainingAmount: String(topRow.remaining_amount ?? '0.00'),
    soldMeters: String(topRow.sold_meters ?? '0.00'),
    remainingReceivableMeters: String(topRow.remaining_receivable_meters ?? '0.00'),
    invoiceCount: Number(topRow.invoice_count ?? 0),
    lastInvoiceDate: String(topRow.last_invoice_date ?? ''),
    topMaterialName: String(topMaterial.rows[0]?.top_material ?? '—'),
    topInvoices: (invoices.rows ?? []).map((r) => ({
      invoiceId: String(r.invoice_id ?? ''),
      invoiceNo: String(r.invoice_no ?? ''),
      invoiceDate: String(r.invoice_date ?? ''),
      salesAmount: String(r.sales_amount ?? '0.00'),
      soldMeters: String(r.sold_meters ?? '0.00'),
      remainingAmount: String(r.remaining_amount ?? '0.00'),
    })),
  };
}

async function reportProfitDetailsByLine(
  companyId: string,
  q: Record<string, string | undefined>,
): Promise<UnifiedReportPayload> {
  const pool = getPool();
  const { page, pageSize, offset } = pageParams(q);
  const filters: string[] = [`si.company_id = $1`, `si.document_status = 'CONFIRMED'`];
  const params: unknown[] = [companyId];
  let p = 2;

  if (q.fromDate) {
    filters.push(`si.invoice_date >= $${p++}::date`);
    params.push(q.fromDate);
  }
  if (q.toDate) {
    filters.push(`si.invoice_date <= $${p++}::date`);
    params.push(q.toDate);
  }
  if (isUuidLike(q.customerId)) {
    filters.push(`si.customer_id = $${p++}::uuid`);
    params.push(q.customerId);
  }
  if (q.paymentStatus && ['paid', 'partial', 'unpaid'].includes(q.paymentStatus)) {
    filters.push(`si.payment_status = $${p++}`);
    params.push(q.paymentStatus);
  }
  if (q.materialCode?.trim()) {
    filters.push(`fi.internal_code ILIKE $${p++}`);
    params.push(`%${q.materialCode.trim()}%`);
  }
  if (isUuidLike(q.supplierId)) {
    filters.push(`COALESCE(fr.supplier_id, fi.supplier_id) = $${p++}::uuid`);
    params.push(q.supplierId);
  }
  if (isUuidLike(q.warehouseId)) {
    filters.push(`COALESCE(sil.warehouse_id, fr.warehouse_id, si.warehouse_id) = $${p++}::uuid`);
    params.push(q.warehouseId);
  }

  const where = filters.join(' AND ');
  const groupBy = profitGroupBy(q.groupBy);
  const lineGroupExpr =
    groupBy === 'customer'
      ? { key: `COALESCE(customer_name, '')`, label: `COALESCE(customer_name, 'بدون عميل')` }
      : groupBy === 'material'
        ? {
            key: `COALESCE(material_id::text, material_code, material_name, '')`,
            label: `COALESCE(NULLIF(CONCAT_WS(' - ', material_code, material_name), ''), 'بدون خامة')`,
          }
        : groupBy === 'supplier'
          ? { key: `COALESCE(supplier_id::text, supplier_name, '')`, label: `COALESCE(supplier_name, 'بدون مورد')` }
          : groupBy === 'date'
            ? { key: `invoice_date::date::text`, label: `invoice_date::date::text` }
            : null;
  const baseSql = `
    WITH line_profit AS (
      SELECT
        si.id AS invoice_id,
        si.invoice_no,
        si.invoice_date,
        si.payment_status,
        si.currency_code,
        c.name AS customer_name,
        sil.id AS line_id,
        sil.fabric_roll_id,
        fr.barcode,
        COALESCE(fi.id, fr.item_id) AS material_id,
        fi.name AS material_name,
        fi.internal_code AS material_code,
        fc.id AS color_id,
        COALESCE(fc.name_ar, fc.name_tr) AS color_name,
        fc.color_code,
        COALESCE(fr.supplier_id, fi.supplier_id) AS supplier_id,
        s.name AS supplier_name,
        w.name AS warehouse_name,
        sil.quantity,
        sil.unit,
        (CASE WHEN sil.unit = 'yard' THEN sil.quantity * 0.9144 ELSE sil.quantity END)::numeric AS quantity_meters,
        sil.unit_price,
        ${SQL_NET_LINE_REVENUE_USD} AS sales_amount,
        ${SQL_LINE_COST_USD} AS cost_amount,
        CASE
          WHEN sil.cost_source IS NOT NULL
               AND sil.cost_source <> 'MISSING'
               AND COALESCE(sil.cost_missing, false) IS FALSE
               AND (sil.cost_total_usd IS NOT NULL OR (sil.cost_total IS NOT NULL AND sil.cost_exchange_rate_to_usd IS NOT NULL AND sil.cost_exchange_rate_to_usd > 0))
            THEN 'HISTORICAL_SNAPSHOT'
          WHEN sil.cost_source IS NOT NULL
               AND sil.cost_source <> 'MISSING'
               AND (COALESCE(sil.cost_missing, false) IS TRUE OR sil.cost_total_usd IS NULL)
            THEN 'PARTIAL_COST'
          WHEN sil.cost_source IS NULL AND fr.unit_cost IS NOT NULL AND fr.unit_cost > 0
            THEN 'CURRENT_COST_FALLBACK'
          WHEN sil.cost_source = 'MISSING' OR COALESCE(sil.cost_missing, false) IS TRUE OR fr.unit_cost IS NULL OR fr.unit_cost <= 0
            THEN 'MISSING_COST'
          ELSE 'UNKNOWN'
        END AS cost_quality,
        si.total_amount_usd,
        si.paid_amount_usd,
        si.remaining_amount_usd
      FROM sales_invoice_lines sil
      INNER JOIN sales_invoices si ON si.id = sil.invoice_id AND si.company_id = sil.company_id
      INNER JOIN customers c ON c.id = si.customer_id AND c.company_id = si.company_id
      LEFT JOIN fabric_rolls fr ON fr.id = sil.fabric_roll_id AND fr.company_id = sil.company_id
      LEFT JOIN fabric_items fi ON fi.id = COALESCE(sil.fabric_item_id, fr.item_id) AND fi.company_id = sil.company_id
      LEFT JOIN fabric_colors fc ON fc.id = fr.color_id
      LEFT JOIN suppliers s ON s.id = COALESCE(fr.supplier_id, fi.supplier_id) AND s.company_id = sil.company_id
      LEFT JOIN warehouses w ON w.id = COALESCE(sil.warehouse_id, fr.warehouse_id, si.warehouse_id) AND w.company_id = sil.company_id
      WHERE ${where}
    )
  `;

  const count = await pool.query<{ total: string }>(`${baseSql} SELECT COUNT(*)::int AS total FROM line_profit`, params);
  const data = await pool.query(
    `${baseSql}
     SELECT invoice_id::text AS invoice_id, invoice_no, invoice_date::text AS invoice_date, customer_name,
            payment_status, currency_code, line_id::text AS line_id, fabric_roll_id::text AS fabric_roll_id,
            barcode, material_id::text AS material_id, material_name, material_code, color_id::text AS color_id,
            color_name, color_code, supplier_name, warehouse_name, quantity::text AS quantity, unit,
            ROUND(quantity_meters, 2)::text AS quantity_meters,
            ROUND(unit_price, 4)::text AS unit_price,
            ROUND(sales_amount, 2)::text AS sales_amount,
            ROUND(cost_amount, 2)::text AS cost_amount,
            ROUND(sales_amount - cost_amount, 2)::text AS gross_profit,
            CASE WHEN COALESCE(total_amount_usd, 0) > 0 THEN ROUND((paid_amount_usd / total_amount_usd) * sales_amount, 2)::text ELSE '0.00' END AS paid_amount,
            CASE WHEN COALESCE(total_amount_usd, 0) > 0 THEN ROUND((remaining_amount_usd / total_amount_usd) * sales_amount, 2)::text ELSE '0.00' END AS remaining_amount,
            cost_quality,
            CASE cost_quality
              WHEN 'HISTORICAL_SNAPSHOT' THEN 'تكلفة مثبتة'
              WHEN 'CURRENT_COST_FALLBACK' THEN 'تكلفة تقديرية'
              WHEN 'MISSING_COST' THEN 'تكلفة مفقودة'
              WHEN 'PARTIAL_COST' THEN 'تكلفة جزئية'
              ELSE 'غير معروف'
            END AS cost_quality_label,
            CASE cost_quality
              WHEN 'HISTORICAL_SNAPSHOT' THEN 'تكلفة مثبتة وقت البيع'
              WHEN 'CURRENT_COST_FALLBACK' THEN 'تم استخدام تكلفة حالية كتقدير'
              WHEN 'MISSING_COST' THEN 'لا توجد تكلفة مثبتة لهذا البند/الفاتورة'
              WHEN 'PARTIAL_COST' THEN 'تكلفة موجودة لكن التحويل إلى العملة الأساسية غير مكتمل'
              ELSE 'حالة التكلفة غير معروفة'
            END AS cost_warning,
            'PROPORTIONAL_BY_LINE_TOTAL' AS collection_allocation_method
     FROM line_profit
     ORDER BY invoice_date DESC, invoice_no DESC
     LIMIT $${p++} OFFSET $${p++}`,
    [...params, pageSize, offset],
  );
  const totals = await pool.query(
    `${baseSql}
     SELECT ROUND(COALESCE(SUM(sales_amount), 0), 2)::text AS sales_amount,
            ROUND(COALESCE(SUM(cost_amount), 0), 2)::text AS cost_amount,
            ROUND(COALESCE(SUM(sales_amount - cost_amount), 0), 2)::text AS gross_profit,
            ROUND(COALESCE(SUM(CASE WHEN COALESCE(total_amount_usd, 0) > 0 THEN (paid_amount_usd / total_amount_usd) * sales_amount ELSE 0 END), 0), 2)::text AS paid_amount,
            ROUND(COALESCE(SUM(CASE WHEN COALESCE(total_amount_usd, 0) > 0 THEN (remaining_amount_usd / total_amount_usd) * sales_amount ELSE 0 END), 0), 2)::text AS remaining_amount,
            ROUND(COALESCE(SUM(quantity_meters), 0), 2)::text AS sold_meters,
            ROUND(
              COALESCE(
                SUM(
                  CASE WHEN COALESCE(total_amount_usd, 0) > 0 THEN (remaining_amount_usd / total_amount_usd) * quantity_meters ELSE 0 END
                ),
                0
              ),
              2
            )::text AS remaining_receivable_meters,
            ROUND(COALESCE(SUM(CASE WHEN COALESCE(total_amount_usd, 0) > 0 THEN (paid_amount_usd / total_amount_usd) * (sales_amount - cost_amount) ELSE 0 END), 0), 2)::text AS realized_profit,
            ROUND(COALESCE(SUM(CASE WHEN COALESCE(total_amount_usd, 0) > 0 THEN (remaining_amount_usd / total_amount_usd) * (sales_amount - cost_amount) ELSE 0 END), 0), 2)::text AS receivable_profit,
            COUNT(*) FILTER (WHERE cost_quality = 'MISSING_COST')::int AS missing_cost_count,
            COUNT(*) FILTER (WHERE cost_quality = 'CURRENT_COST_FALLBACK')::int AS fallback_cost_count,
            COUNT(*) FILTER (WHERE cost_quality = 'HISTORICAL_SNAPSHOT')::int AS historical_snapshot_count,
            COUNT(*) FILTER (WHERE cost_quality = 'PARTIAL_COST')::int AS partial_cost_count
     FROM line_profit`,
    params,
  );
  const totalRow = totals.rows[0] ?? {};
  const groups =
    lineGroupExpr == null
      ? []
      : (
          await pool.query(
            `${baseSql}
             SELECT ${lineGroupExpr.key} AS group_key,
                    ${lineGroupExpr.label} AS group_label,
                    ROUND(COALESCE(SUM(sales_amount), 0), 2)::text AS sales_amount,
                    ROUND(COALESCE(SUM(cost_amount), 0), 2)::text AS cost_amount,
                    ROUND(COALESCE(SUM(sales_amount - cost_amount), 0), 2)::text AS gross_profit,
                    ROUND(COALESCE(SUM(CASE WHEN COALESCE(total_amount_usd, 0) > 0 THEN (paid_amount_usd / total_amount_usd) * sales_amount ELSE 0 END), 0), 2)::text AS paid_amount,
                    ROUND(COALESCE(SUM(CASE WHEN COALESCE(total_amount_usd, 0) > 0 THEN (remaining_amount_usd / total_amount_usd) * sales_amount ELSE 0 END), 0), 2)::text AS remaining_amount,
                    ROUND(COALESCE(SUM(quantity_meters), 0), 2)::text AS sold_meters,
                    ROUND(
                      COALESCE(
                        SUM(
                          CASE WHEN COALESCE(total_amount_usd, 0) > 0 THEN (remaining_amount_usd / total_amount_usd) * quantity_meters ELSE 0 END
                        ),
                        0
                      ),
                      2
                    )::text AS remaining_receivable_meters,
                    ROUND(COALESCE(SUM(CASE WHEN COALESCE(total_amount_usd, 0) > 0 THEN (paid_amount_usd / total_amount_usd) * (sales_amount - cost_amount) ELSE 0 END), 0), 2)::text AS realized_profit,
                    ROUND(COALESCE(SUM(CASE WHEN COALESCE(total_amount_usd, 0) > 0 THEN (remaining_amount_usd / total_amount_usd) * (sales_amount - cost_amount) ELSE 0 END), 0), 2)::text AS receivable_profit,
                    COUNT(DISTINCT invoice_id)::int AS invoice_count,
                    COUNT(*)::int AS line_count,
                    COUNT(*) FILTER (WHERE cost_quality = 'MISSING_COST')::int AS missing_cost_count,
                    COUNT(*) FILTER (WHERE cost_quality = 'CURRENT_COST_FALLBACK')::int AS fallback_cost_count,
                    COUNT(*) FILTER (WHERE cost_quality = 'HISTORICAL_SNAPSHOT')::int AS historical_snapshot_count,
                    COUNT(*) FILTER (WHERE cost_quality = 'PARTIAL_COST')::int AS partial_cost_count
             FROM line_profit
             GROUP BY 1, 2
             ORDER BY group_label`,
            params,
          )
        ).rows.map((row) => ({
          groupKey: String(row.group_key ?? ''),
          groupLabel: String(row.group_label ?? '-'),
          totals: {
            sales_amount: row.sales_amount,
            cost_amount: row.cost_amount,
            gross_profit: row.gross_profit,
            paid_amount: row.paid_amount,
            remaining_amount: row.remaining_amount,
            sold_meters: row.sold_meters,
            remaining_receivable_meters: row.remaining_receivable_meters,
            realized_profit: row.realized_profit,
            receivable_profit: row.receivable_profit,
            invoice_count: row.invoice_count,
            line_count: row.line_count,
            missing_cost_count: row.missing_cost_count,
            fallback_cost_count: row.fallback_cost_count,
            historical_snapshot_count: row.historical_snapshot_count,
            partial_cost_count: row.partial_cost_count,
          },
        }));
  const missingCostCount = Number(totalRow.missing_cost_count ?? 0);
  const fallbackCostCount = Number(totalRow.fallback_cost_count ?? 0);
  const historicalSnapshotCount = Number(totalRow.historical_snapshot_count ?? 0);
  const partialCostCount = Number(totalRow.partial_cost_count ?? 0);
  const warnings = buildCostWarnings({ missingCostCount, fallbackCostCount, partialCostCount });
  const topCustomer = await queryProfitTopCustomerInsight(companyId, q);

  return buildReportPayload({
    key: 'profit_details_line',
    title: 'كشف الأرباح التفصيلي',
    subtitle: 'وضع تفصيلي اختياري على مستوى سطر الفاتورة - لا يغير الواجهة الافتراضية',
    generatedAt: nowIso(),
    filtersApplied: { ...q, detailLevel: 'line', groupBy, page, pageSize },
    summaryCards: [
      { label: 'إجمالي البيع', value: `${totalRow.sales_amount ?? '0.00'} USD` },
      { label: 'إجمالي التكلفة', value: `${totalRow.cost_amount ?? '0.00'} USD` },
      { label: 'إجمالي الربح', value: `${totalRow.gross_profit ?? '0.00'} USD` },
      { label: 'إجمالي الأمتار المباعة', value: `${totalRow.sold_meters ?? '0.00'} م` },
      { label: 'بنود تكلفة مفقودة', value: missingCostCount },
    ],
    columns: [
      dateCol('invoice_date', 'التاريخ'),
      textCol('invoice_no', 'رقم الفاتورة'),
      textCol('customer_name', 'العميل'),
      textCol('payment_status', 'حالة الدفع'),
      textCol('material_name', 'الخامة'),
      textCol('material_code', 'كود الخامة'),
      textCol('color_name', 'اللون'),
      textCol('barcode', 'الباركود'),
      textCol('supplier_name', 'المورد'),
      textCol('warehouse_name', 'المستودع'),
      numCol('quantity', 'الكمية'),
      textCol('unit', 'الوحدة'),
      numCol('quantity_meters', 'الكمية بالمتر'),
      moneyCol('sales_amount', 'البيع'),
      moneyCol('cost_amount', 'التكلفة'),
      moneyCol('gross_profit', 'الربح'),
      textCol('cost_quality_label', 'جودة التكلفة'),
    ],
    rows: data.rows as Record<string, unknown>[],
    totals: totalRow,
    groups,
    warnings,
    insights: { topCustomer },
    meta: {
      page,
      pageSize,
      total: Number(count.rows[0]?.total ?? 0),
      dataCompleteness: missingCostCount > 0 || fallbackCostCount > 0 || partialCostCount > 0 ? 'PARTIAL' : 'FULL',
      missingCostCount,
      fallbackCostCount,
      historicalSnapshotCount,
      partialCostCount,
      costMethod: 'LINE_COST_QUALITY_WITH_SNAPSHOT_PRIORITY',
      collectionMethod: 'INVOICE_STORED_AMOUNTS',
      collectionAllocationMethod: 'PROPORTIONAL_BY_LINE_TOTAL',
      groupBy,
      groupingScope: groupBy === 'none' ? undefined : 'FILTERED_FULL_RESULT',
      note: warnings.length > 1 ? warnings.map((w) => w.message).join(' ') : undefined,
    },
  });
}

export async function reportProfitDetails(
  companyId: string,
  q: Record<string, string | undefined>,
): Promise<UnifiedReportPayload> {
  if (q.detailLevel === 'line') {
    return reportProfitDetailsByLine(companyId, q);
  }

  const pool = getPool();
  const { page, pageSize, offset } = pageParams(q);
  const filters: string[] = [`si.company_id = $1`, `si.document_status = 'CONFIRMED'`];
  const params: unknown[] = [companyId];
  let p = 2;
  if (q.fromDate) {
    filters.push(`si.invoice_date >= $${p++}::date`);
    params.push(q.fromDate);
  }
  if (q.toDate) {
    filters.push(`si.invoice_date <= $${p++}::date`);
    params.push(q.toDate);
  }
  if (isUuidLike(q.customerId)) {
    filters.push(`si.customer_id = $${p++}::uuid`);
    params.push(q.customerId);
  }
  if (q.paymentStatus && ['paid', 'partial', 'unpaid'].includes(q.paymentStatus)) {
    filters.push(`si.payment_status = $${p++}`);
    params.push(q.paymentStatus);
  }
  const where = filters.join(' AND ');
  const groupBy = profitGroupBy(q.groupBy);
  const invoiceGroupExpr =
    groupBy === 'customer'
      ? { key: `COALESCE(customer_name, '')`, label: `COALESCE(customer_name, 'بدون عميل')` }
      : groupBy === 'date'
        ? { key: `invoice_date::date::text`, label: `invoice_date::date::text` }
        : null;
  const baseSql = `
    WITH line_costs AS (
      SELECT sil.invoice_id,
             SUM(${SQL_LINE_COST_USD})::numeric AS cost_amount,
             SUM((CASE WHEN sil.unit = 'yard' THEN sil.quantity * 0.9144 ELSE sil.quantity END))::numeric AS sold_meters,
             COUNT(*) FILTER (
               WHERE (
                 sil.cost_source = 'MISSING'
                 OR COALESCE(sil.cost_missing, false) IS TRUE
                 OR (sil.cost_source IS NULL AND (fr.unit_cost IS NULL OR fr.unit_cost <= 0))
               )
             )::int AS missing_cost_count,
             COUNT(*) FILTER (
               WHERE sil.cost_source IS NULL AND fr.unit_cost IS NOT NULL AND fr.unit_cost > 0
             )::int AS fallback_cost_count,
             COUNT(*) FILTER (
               WHERE sil.cost_source IS NOT NULL
                 AND sil.cost_source <> 'MISSING'
                 AND COALESCE(sil.cost_missing, false) IS FALSE
                 AND (
                   sil.cost_total_usd IS NOT NULL
                   OR (sil.cost_total IS NOT NULL AND sil.cost_exchange_rate_to_usd IS NOT NULL AND sil.cost_exchange_rate_to_usd > 0)
                 )
             )::int AS historical_snapshot_count,
             COUNT(*) FILTER (
               WHERE sil.cost_source IS NOT NULL
                 AND sil.cost_source <> 'MISSING'
                 AND (
                   COALESCE(sil.cost_missing, false) IS TRUE
                   OR (sil.cost_total_usd IS NULL AND (sil.cost_exchange_rate_to_usd IS NULL OR sil.cost_exchange_rate_to_usd <= 0))
                 )
             )::int AS partial_cost_count,
             COUNT(*)::int AS line_count
      FROM sales_invoice_lines sil
      INNER JOIN sales_invoices si ON si.id = sil.invoice_id AND si.company_id = sil.company_id
      LEFT JOIN fabric_rolls fr ON fr.id = sil.fabric_roll_id AND fr.company_id = sil.company_id
      WHERE sil.company_id = $1
      GROUP BY sil.invoice_id
    ),
    invoice_profit AS (
      SELECT si.id, si.invoice_date, si.invoice_no, c.name AS customer_name, si.currency_code,
             COALESCE(si.total_amount_usd, CASE WHEN si.currency_code='USD' THEN si.total_amount ELSE si.total_amount / NULLIF(si.exchange_rate_to_usd, 0) END, 0)::numeric AS sales_amount,
             COALESCE(si.paid_amount_usd, CASE WHEN si.currency_code='USD' THEN si.paid_amount ELSE si.paid_amount / NULLIF(si.exchange_rate_to_usd, 0) END, 0)::numeric AS paid_amount,
             COALESCE(si.remaining_amount_usd, CASE WHEN si.currency_code='USD' THEN si.remaining_amount ELSE si.remaining_amount / NULLIF(si.exchange_rate_to_usd, 0) END, 0)::numeric AS remaining_amount,
             COALESCE(lc.cost_amount, 0)::numeric AS cost_amount,
             COALESCE(lc.sold_meters, 0)::numeric AS sold_meters,
             COALESCE(lc.missing_cost_count, 0)::int AS missing_cost_count,
             COALESCE(lc.fallback_cost_count, 0)::int AS fallback_cost_count,
             COALESCE(lc.historical_snapshot_count, 0)::int AS historical_snapshot_count,
             COALESCE(lc.partial_cost_count, 0)::int AS partial_cost_count,
             COALESCE(lc.line_count, 0)::int AS line_count,
             CASE
               WHEN COALESCE(lc.line_count, 0) = 0 THEN 'UNKNOWN'
               WHEN COALESCE(lc.missing_cost_count, 0) >= COALESCE(lc.line_count, 0) THEN 'MISSING_COST'
               WHEN COALESCE(lc.missing_cost_count, 0) > 0 OR COALESCE(lc.partial_cost_count, 0) > 0 THEN 'PARTIAL_COST'
               WHEN COALESCE(lc.fallback_cost_count, 0) > 0 AND COALESCE(lc.historical_snapshot_count, 0) > 0 THEN 'PARTIAL_COST'
               WHEN COALESCE(lc.fallback_cost_count, 0) > 0 THEN 'CURRENT_COST_FALLBACK'
               WHEN COALESCE(lc.historical_snapshot_count, 0) > 0 THEN 'HISTORICAL_SNAPSHOT'
               ELSE 'UNKNOWN'
             END AS cost_quality
      FROM sales_invoices si
      INNER JOIN customers c ON c.id = si.customer_id AND c.company_id = si.company_id
      LEFT JOIN line_costs lc ON lc.invoice_id = si.id
      WHERE ${where}
    )
  `;

  const count = await pool.query<{ total: string }>(`${baseSql} SELECT COUNT(*)::int AS total FROM invoice_profit`, params);
  const data = await pool.query(
    `${baseSql}
     SELECT id::text AS invoice_id, invoice_date::text AS invoice_date, invoice_no, customer_name, currency_code,
            ROUND(sales_amount, 2)::text AS sales_amount,
            ROUND(paid_amount, 2)::text AS paid_amount,
            ROUND(remaining_amount, 2)::text AS remaining_amount,
            ROUND(cost_amount, 2)::text AS cost_amount,
            ROUND(sales_amount - cost_amount, 2)::text AS gross_profit,
            ROUND(sold_meters, 2)::text AS sold_meters,
            ROUND(CASE WHEN sales_amount > 0 THEN (remaining_amount / sales_amount) * sold_meters ELSE 0 END, 2)::text AS remaining_receivable_meters,
            ROUND(CASE WHEN sales_amount > 0 THEN (paid_amount / sales_amount) * (sales_amount - cost_amount) ELSE 0 END, 2)::text AS realized_profit,
            ROUND(CASE WHEN sales_amount > 0 THEN (remaining_amount / sales_amount) * (sales_amount - cost_amount) ELSE 0 END, 2)::text AS receivable_profit,
            cost_quality,
            CASE cost_quality
              WHEN 'HISTORICAL_SNAPSHOT' THEN 'تكلفة مثبتة'
              WHEN 'CURRENT_COST_FALLBACK' THEN 'تكلفة تقديرية'
              WHEN 'MISSING_COST' THEN 'تكلفة مفقودة'
              WHEN 'PARTIAL_COST' THEN 'تكلفة جزئية'
              ELSE 'غير معروف'
            END AS cost_quality_label,
            CASE cost_quality
              WHEN 'HISTORICAL_SNAPSHOT' THEN 'تكلفة مثبتة وقت البيع'
              WHEN 'CURRENT_COST_FALLBACK' THEN 'تم استخدام تكلفة حالية كتقدير'
              WHEN 'MISSING_COST' THEN 'لا توجد تكلفة مثبتة لهذا البند/الفاتورة'
              WHEN 'PARTIAL_COST' THEN 'تكلفة موجودة لكن التحويل إلى العملة الأساسية أو بعض البنود غير مكتمل'
              ELSE 'حالة التكلفة غير معروفة'
            END AS cost_warning
     FROM invoice_profit
     ORDER BY invoice_date DESC, invoice_no DESC
     LIMIT $${p++} OFFSET $${p++}`,
    [...params, pageSize, offset],
  );
  const totals = await pool.query(
    `${baseSql}
     SELECT ROUND(COALESCE(SUM(sales_amount), 0), 2)::text AS sales_amount,
            ROUND(COALESCE(SUM(paid_amount), 0), 2)::text AS paid_amount,
            ROUND(COALESCE(SUM(remaining_amount), 0), 2)::text AS remaining_amount,
            ROUND(COALESCE(SUM(cost_amount), 0), 2)::text AS cost_amount,
            ROUND(COALESCE(SUM(sales_amount - cost_amount), 0), 2)::text AS gross_profit,
            ROUND(COALESCE(SUM(sold_meters), 0), 2)::text AS sold_meters,
            ROUND(COALESCE(SUM(CASE WHEN sales_amount > 0 THEN (remaining_amount / sales_amount) * sold_meters ELSE 0 END), 0), 2)::text AS remaining_receivable_meters,
            ROUND(COALESCE(SUM(CASE WHEN sales_amount > 0 THEN (paid_amount / sales_amount) * (sales_amount - cost_amount) ELSE 0 END), 0), 2)::text AS realized_profit,
            ROUND(COALESCE(SUM(CASE WHEN sales_amount > 0 THEN (remaining_amount / sales_amount) * (sales_amount - cost_amount) ELSE 0 END), 0), 2)::text AS receivable_profit,
            COALESCE(SUM(missing_cost_count), 0)::int AS missing_cost_count,
            COALESCE(SUM(fallback_cost_count), 0)::int AS fallback_cost_count,
            COALESCE(SUM(historical_snapshot_count), 0)::int AS historical_snapshot_count,
            COALESCE(SUM(partial_cost_count), 0)::int AS partial_cost_count
     FROM invoice_profit`,
    params,
  );
  const totalRow = totals.rows[0] ?? {};
  const groups =
    invoiceGroupExpr == null
      ? []
      : (
          await pool.query(
            `${baseSql}
             SELECT ${invoiceGroupExpr.key} AS group_key,
                    ${invoiceGroupExpr.label} AS group_label,
                    ROUND(COALESCE(SUM(sales_amount), 0), 2)::text AS sales_amount,
                    ROUND(COALESCE(SUM(paid_amount), 0), 2)::text AS paid_amount,
                    ROUND(COALESCE(SUM(remaining_amount), 0), 2)::text AS remaining_amount,
                    ROUND(COALESCE(SUM(cost_amount), 0), 2)::text AS cost_amount,
                    ROUND(COALESCE(SUM(sales_amount - cost_amount), 0), 2)::text AS gross_profit,
                    ROUND(COALESCE(SUM(sold_meters), 0), 2)::text AS sold_meters,
                    ROUND(COALESCE(SUM(CASE WHEN sales_amount > 0 THEN (remaining_amount / sales_amount) * sold_meters ELSE 0 END), 0), 2)::text AS remaining_receivable_meters,
                    ROUND(COALESCE(SUM(CASE WHEN sales_amount > 0 THEN (paid_amount / sales_amount) * (sales_amount - cost_amount) ELSE 0 END), 0), 2)::text AS realized_profit,
                    ROUND(COALESCE(SUM(CASE WHEN sales_amount > 0 THEN (remaining_amount / sales_amount) * (sales_amount - cost_amount) ELSE 0 END), 0), 2)::text AS receivable_profit,
                    COUNT(DISTINCT id)::int AS invoice_count,
                    COALESCE(SUM(line_count), 0)::int AS line_count,
                    COALESCE(SUM(missing_cost_count), 0)::int AS missing_cost_count,
                    COALESCE(SUM(fallback_cost_count), 0)::int AS fallback_cost_count,
                    COALESCE(SUM(historical_snapshot_count), 0)::int AS historical_snapshot_count,
                    COALESCE(SUM(partial_cost_count), 0)::int AS partial_cost_count
             FROM invoice_profit
             GROUP BY 1, 2
             ORDER BY group_label`,
            params,
          )
        ).rows.map((row) => ({
          groupKey: String(row.group_key ?? ''),
          groupLabel: String(row.group_label ?? '-'),
          totals: {
            sales_amount: row.sales_amount,
            cost_amount: row.cost_amount,
            gross_profit: row.gross_profit,
            paid_amount: row.paid_amount,
            remaining_amount: row.remaining_amount,
            sold_meters: row.sold_meters,
            remaining_receivable_meters: row.remaining_receivable_meters,
            realized_profit: row.realized_profit,
            receivable_profit: row.receivable_profit,
            invoice_count: row.invoice_count,
            line_count: row.line_count,
            missing_cost_count: row.missing_cost_count,
            fallback_cost_count: row.fallback_cost_count,
            historical_snapshot_count: row.historical_snapshot_count,
            partial_cost_count: row.partial_cost_count,
          },
        }));
  const missingCostCount = Number(totalRow.missing_cost_count ?? 0);
  const fallbackCostCount = Number(totalRow.fallback_cost_count ?? 0);
  const historicalSnapshotCount = Number(totalRow.historical_snapshot_count ?? 0);
  const partialCostCount = Number(totalRow.partial_cost_count ?? 0);
  const costMethod =
    missingCostCount > 0 || fallbackCostCount > 0 || partialCostCount > 0
      ? 'SALES_LINE_SNAPSHOT_WITH_CURRENT_ROLL_FALLBACK'
      : 'SALES_LINE_SNAPSHOT';
  const warnings = buildCostWarnings({ missingCostCount, fallbackCostCount, partialCostCount });
  const topCustomer = await queryProfitTopCustomerInsight(companyId, q);
  return buildReportPayload({
    key: 'profit_details',
    title: 'كشف الأرباح التفصيلي',
    subtitle: 'مبني على فواتير البيع المؤكدة وتكلفة الأثواب في المخزون',
    generatedAt: nowIso(),
    filtersApplied: { fromDate: q.fromDate ?? '', toDate: q.toDate ?? '', groupBy, page, pageSize },
    summaryCards: [
      { label: 'البيع الكلي', value: `${totalRow.sales_amount ?? '0.00'} USD` },
      { label: 'التكلفة الكلية', value: `${totalRow.cost_amount ?? '0.00'} USD` },
      { label: 'الربح الكلي', value: `${totalRow.gross_profit ?? '0.00'} USD` },
      { label: 'ربح متبق مع الذمم', value: `${totalRow.receivable_profit ?? '0.00'} USD` },
      { label: 'إجمالي الأمتار المباعة', value: `${totalRow.sold_meters ?? '0.00'} م` },
    ],
    columns: [
      dateCol('invoice_date', 'التاريخ'),
      textCol('invoice_no', 'رقم الفاتورة'),
      textCol('customer_name', 'العميل'),
      moneyCol('sales_amount', 'البيع'),
      moneyCol('paid_amount', 'المحصل'),
      moneyCol('remaining_amount', 'المتبقي ذمم'),
      numCol('sold_meters', 'أمتار مباعة'),
      numCol('remaining_receivable_meters', 'أمتار ضمن الذمم'),
      moneyCol('cost_amount', 'التكلفة'),
      moneyCol('gross_profit', 'الربح الكلي'),
      moneyCol('realized_profit', 'ربح محصل'),
      moneyCol('receivable_profit', 'ربح مع الذمم'),
    ],
    rows: data.rows as Record<string, unknown>[],
    totals: totalRow,
    groups,
    warnings,
    insights: { topCustomer },
    meta: {
      page,
      pageSize,
      total: Number(count.rows[0]?.total ?? 0),
      dataCompleteness: missingCostCount > 0 || fallbackCostCount > 0 || partialCostCount > 0 ? 'PARTIAL' : 'FULL',
      missingCostCount,
      fallbackCostCount,
      historicalSnapshotCount,
      partialCostCount,
      costMethod,
      collectionMethod: 'INVOICE_STORED_AMOUNTS',
      groupBy,
      groupingScope: groupBy === 'customer' || groupBy === 'date' ? 'FILTERED_FULL_RESULT' : undefined,
      note:
        missingCostCount > 0 || fallbackCostCount > 0
          ? 'بعض فواتير البيع القديمة لا تحتوي تكلفة مثبتة تاريخياً؛ تم استخدام تكلفة الثوب الحالية كحل مؤقت عند توفرها، أو بقيت التكلفة مفقودة.'
          : undefined,
    },
  });
}

export async function reportPurchasesSummary(companyId: string): Promise<UnifiedReportPayload> {
  const pool = getPool();
  const b = await pool.query(
    `SELECT COUNT(*)::int AS batches,
            COALESCE(SUM(created_roll_count),0)::numeric AS rolls
     FROM purchase_import_batches WHERE company_id = $1 AND status = 'CONFIRMED'`,
    [companyId],
  );
  const fr = await pool.query(
    `SELECT COUNT(*)::int AS n, COALESCE(SUM(length_m),0)::numeric AS m
     FROM fabric_rolls fr WHERE company_id = $1`,
    [companyId],
  );
  return buildReportPayload({
    key: 'pur_sum',
    title: 'ملخص المشتريات',
    subtitle: 'من دفعات استيراد Excel والأتواب',
    generatedAt: nowIso(),
    filtersApplied: {},
    columns: [textCol('k', 'المؤشر'), textCol('v', 'القيمة')],
    rows: [
      { k: 'دفعات استيراد مؤكدة', v: b.rows[0].batches },
      { k: 'أتواب مُنشأة من الاستيراد (مجموع سجل الدفعات)', v: String(b.rows[0].rolls) },
      { k: 'إجمالي أتواب في المخزون', v: fr.rows[0].n },
      { k: 'إجمالي أمتار مخزون', v: String(fr.rows[0].m) },
    ],
    meta: {},
  });
}

export async function reportPurchasesDetails(
  companyId: string,
  q: Record<string, string | undefined>,
): Promise<UnifiedReportPayload> {
  const pool = getPool();
  const { page, pageSize, offset } = pageParams(q);
  const cnt = await pool.query<{ c: string }>(
    `SELECT COUNT(*)::int AS c FROM fabric_rolls WHERE company_id = $1`,
    [companyId],
  );
  const data = await pool.query(
    `SELECT fr.created_at::date AS date, fr.barcode, fi.name AS item_name, fr.length_m,
            s.name AS supplier_name, fr.batch_no, fr.purchase_invoice_no
     FROM fabric_rolls fr
     JOIN fabric_items fi ON fi.id = fr.item_id AND fi.company_id = fr.company_id
     LEFT JOIN suppliers s ON s.id = fr.supplier_id
     WHERE fr.company_id = $1
     ORDER BY fr.created_at DESC
     LIMIT $2 OFFSET $3`,
    [companyId, pageSize, offset],
  );
  return buildReportPayload({
    key: 'pur_det',
    title: 'المشتريات التفصيلية (أتواب)',
    generatedAt: nowIso(),
    filtersApplied: { page, pageSize },
    columns: [
      dateCol('date', 'التاريخ'),
      textCol('barcode', 'الباركود'),
      textCol('item_name', 'الخامة'),
      numCol('length_m', 'طول م'),
      textCol('supplier_name', 'المورد'),
      textCol('batch_no', 'دفعة/لوط'),
      textCol('purchase_invoice_no', 'فاتورة شراء'),
    ],
    rows: data.rows as Record<string, unknown>[],
    meta: { page, pageSize, total: parseInt(cnt.rows[0].c, 10) },
  });
}

export async function reportPurchasesBySupplier(companyId: string): Promise<UnifiedReportPayload> {
  const pool = getPool();
  const data = await pool.query(
    `SELECT COALESCE(s.name, '(بدون مورد)') AS supplier_name,
            COUNT(fr.id)::int AS rolls_count,
            COALESCE(SUM(fr.length_m),0)::numeric AS total_m
     FROM fabric_rolls fr
     LEFT JOIN suppliers s ON s.id = fr.supplier_id AND s.company_id = fr.company_id
     WHERE fr.company_id = $1
     GROUP BY s.name
     ORDER BY rolls_count DESC`,
    [companyId],
  );
  return buildReportPayload({
    key: 'pur_sup',
    title: 'المشتريات حسب المورد',
    generatedAt: nowIso(),
    filtersApplied: {},
    columns: [
      textCol('supplier_name', 'المورد'),
      numCol('rolls_count', 'عدد الأتواب'),
      moneyCol('total_m', 'إجمالي أمتار'),
    ],
    rows: data.rows as Record<string, unknown>[],
    meta: { total: data.rows.length },
  });
}

export async function reportPurchasesByItem(companyId: string): Promise<UnifiedReportPayload> {
  const pool = getPool();
  const data = await pool.query(
    `SELECT fi.name AS item_name, COUNT(fr.id)::int AS rolls, COALESCE(SUM(fr.length_m),0)::numeric AS total_m
     FROM fabric_rolls fr
     JOIN fabric_items fi ON fi.id = fr.item_id AND fi.company_id = fr.company_id
     WHERE fr.company_id = $1
     GROUP BY fi.name ORDER BY rolls DESC`,
    [companyId],
  );
  return buildReportPayload({
    key: 'pur_item',
    title: 'المشتريات حسب الصنف',
    generatedAt: nowIso(),
    filtersApplied: {},
    columns: [
      textCol('item_name', 'الخامة'),
      numCol('rolls', 'أتواب'),
      moneyCol('total_m', 'أمتار'),
    ],
    rows: data.rows as Record<string, unknown>[],
    meta: { total: data.rows.length },
  });
}

export async function reportPurchasesByBatch(companyId: string): Promise<UnifiedReportPayload> {
  const pool = getPool();
  const data = await pool.query(
    `SELECT COALESCE(fr.batch_no, '(بدون دفعة)') AS batch_no,
            COUNT(*)::int AS rolls,
            COALESCE(SUM(fr.length_m),0)::numeric AS total_m
     FROM fabric_rolls fr
     WHERE fr.company_id = $1
     GROUP BY fr.batch_no
     ORDER BY rolls DESC`,
    [companyId],
  );
  return buildReportPayload({
    key: 'pur_batch',
    title: 'المشتريات حسب الدفعة / اللوط',
    generatedAt: nowIso(),
    filtersApplied: {},
    columns: [
      textCol('batch_no', 'الدفعة'),
      numCol('rolls', 'أتواب'),
      moneyCol('total_m', 'أمتار'),
    ],
    rows: data.rows as Record<string, unknown>[],
    meta: { total: data.rows.length },
  });
}

export async function reportPurchasesCostTrend(companyId: string): Promise<UnifiedReportPayload> {
  const pool = getPool();
  const data = await pool.query(
    `SELECT fr.created_at::date AS period,
            COALESCE(AVG(fr.unit_cost) FILTER (WHERE fr.unit_cost IS NOT NULL), 0)::numeric AS avg_unit_cost,
            COUNT(*)::int AS rolls
     FROM fabric_rolls fr WHERE fr.company_id = $1
     GROUP BY fr.created_at::date
     ORDER BY period DESC
     LIMIT 90`,
    [companyId],
  );
  const note =
    data.rows.length === 0
      ? 'لا توجد أتواب بتكلفة وحدة مسجّلة بعد.'
      : 'متوسط تكلفة الوحدة حيث متوفر فقط.';
  return buildReportPayload({
    key: 'pur_cost',
    title: 'اتجاه التكلفة (تقديري)',
    generatedAt: nowIso(),
    filtersApplied: {},
    columns: [
      dateCol('period', 'اليوم'),
      moneyCol('avg_unit_cost', 'متوسط تكلفة وحدة'),
      numCol('rolls', 'أتواب'),
    ],
    rows: data.rows as Record<string, unknown>[],
    meta: { note, dataCompleteness: data.rows.length ? 'PARTIAL' : 'EMPTY_REASON' },
  });
}

// ─── Inventory extended ───────────────────────────────────────────────────────

export async function reportInventoryBalances(companyId: string): Promise<UnifiedReportPayload> {
  const pool = getPool();
  const data = await pool.query(
    `SELECT w.name AS warehouse, fi.name AS item_name,
            COALESCE(fc.name_ar, fc.name_tr, '') AS color_name, fr.status,
            COUNT(fr.id)::int AS rolls,
            COALESCE(SUM(fr.length_m),0)::numeric AS total_m
     FROM fabric_rolls fr
     JOIN warehouses w ON w.id = fr.warehouse_id
     JOIN fabric_items fi ON fi.id = fr.item_id AND fi.company_id = fr.company_id
     LEFT JOIN fabric_colors fc ON fc.id = fr.color_id
     WHERE fr.company_id = $1
     GROUP BY w.name, fi.name, fc.name_ar, fc.name_tr, fr.status
     ORDER BY w.name, fi.name`,
    [companyId],
  );
  return buildReportPayload({
    key: 'inv_balance',
    title: 'أرصدة المخزون',
    subtitle: 'تجميع حسب مستودع وخامة ولون وحالة',
    generatedAt: nowIso(),
    filtersApplied: {},
    columns: [
      textCol('warehouse', 'المستودع'),
      textCol('item_name', 'الخامة'),
      textCol('color_name', 'اللون'),
      textCol('status', 'الحالة'),
      numCol('rolls', 'أتواب'),
      moneyCol('total_m', 'أمتار'),
    ],
    rows: data.rows as Record<string, unknown>[],
    meta: { total: data.rows.length },
  });
}

export async function reportInventoryValuation(companyId: string): Promise<UnifiedReportPayload> {
  const pool = getPool();
  const data = await pool.query(
    `SELECT fi.name AS item_name,
            COUNT(fr.id)::int AS rolls,
            COALESCE(SUM(fr.length_m * COALESCE(fr.unit_cost, 0)), 0)::numeric AS est_value,
            COALESCE(SUM(fr.length_m),0)::numeric AS total_m
     FROM fabric_rolls fr
     JOIN fabric_items fi ON fi.id = fr.item_id AND fi.company_id = fr.company_id
     WHERE fr.company_id = $1
     GROUP BY fi.name
     ORDER BY est_value DESC`,
    [companyId],
  );
  return buildReportPayload({
    key: 'inv_move_old',
    title: 'تقييم مخزون (تقديري)',
    subtitle: 'طول × تكلفة وحدة حيث تتوفر — لا قيمة بدون unit_cost',
    generatedAt: nowIso(),
    filtersApplied: {},
    columns: [
      textCol('item_name', 'الخامة'),
      numCol('rolls', 'أتواب'),
      moneyCol('total_m', 'أمتار'),
      moneyCol('est_value', 'قيمة تقديرية'),
    ],
    rows: data.rows as Record<string, unknown>[],
    meta: {
      note: 'القيمة غير متاحة للأدوات بدون تكلفة وحدة.',
      dataCompleteness: 'PARTIAL',
    },
  });
}

export async function reportInventoryByColor(companyId: string): Promise<UnifiedReportPayload> {
  const pool = getPool();
  const data = await pool.query(
    `SELECT COALESCE(fc.name_ar, fc.name_tr, '(بدون لون)') AS color_name,
            COUNT(fr.id)::int AS rolls,
            COALESCE(SUM(fr.length_m),0)::numeric AS total_m
     FROM fabric_rolls fr
     LEFT JOIN fabric_colors fc ON fc.id = fr.color_id
     WHERE fr.company_id = $1
     GROUP BY fc.name_ar, fc.name_tr
     ORDER BY rolls DESC`,
    [companyId],
  );
  return buildReportPayload({
    key: 'inv_by_color',
    title: 'المخزون حسب اللون',
    generatedAt: nowIso(),
    filtersApplied: {},
    columns: [
      textCol('color_name', 'اللون'),
      numCol('rolls', 'أتواب'),
      moneyCol('total_m', 'أمتار'),
    ],
    rows: data.rows as Record<string, unknown>[],
    meta: { total: data.rows.length },
  });
}

export async function reportInventoryAging(companyId: string): Promise<UnifiedReportPayload> {
  const pool = getPool();
  const data = await pool.query(
    `SELECT CASE
              WHEN fr.created_at >= now() - interval '30 days' THEN '0-30 يوم'
              WHEN fr.created_at >= now() - interval '60 days' THEN '31-60 يوم'
              WHEN fr.created_at >= now() - interval '90 days' THEN '61-90 يوم'
              ELSE 'أكثر من 90 يوم'
            END AS bucket,
            COUNT(*)::int AS rolls,
            COALESCE(SUM(fr.length_m),0)::numeric AS total_m
     FROM fabric_rolls fr
     WHERE fr.company_id = $1
     GROUP BY 1 ORDER BY 1`,
    [companyId],
  );
  return buildReportPayload({
    key: 'inv_aging',
    title: 'أعمار المخزون',
    subtitle: 'حسب تاريخ إنشاء الثوب',
    generatedAt: nowIso(),
    filtersApplied: {},
    columns: [
      textCol('bucket', 'الفترة'),
      numCol('rolls', 'أتواب'),
      moneyCol('total_m', 'أمتار'),
    ],
    rows: data.rows as Record<string, unknown>[],
    meta: { total: data.rows.length },
  });
}

export async function reportInventorySlowMoving(
  companyId: string,
  q: Record<string, string | undefined>,
): Promise<UnifiedReportPayload> {
  const pool = getPool();
  const days = Math.max(30, parseInt(q.daysInactive || '90', 10) || 90);
  const data = await pool.query(
    `SELECT fr.barcode, fi.name AS item_name, fr.created_at::date AS roll_created,
            COALESCE(MAX(im.created_at), fr.created_at) AS last_movement_at
     FROM fabric_rolls fr
     JOIN fabric_items fi ON fi.id = fr.item_id AND fi.company_id = fr.company_id
     LEFT JOIN inventory_movements im ON im.roll_id = fr.id AND im.company_id = fr.company_id
     WHERE fr.company_id = $1
     GROUP BY fr.id, fr.barcode, fi.name, fr.created_at
     HAVING COALESCE(MAX(im.created_at), fr.created_at) < (CURRENT_TIMESTAMP - ($2::integer * INTERVAL '1 day'))
     ORDER BY last_movement_at ASC
     LIMIT 500`,
    [companyId, days],
  );
  return buildReportPayload({
    key: 'inv_slow',
    title: 'أصناف بطيئة الحركة',
    subtitle: `بدون حركة مخزون منذ أكثر من ${days} يوماً`,
    generatedAt: nowIso(),
    filtersApplied: { daysInactive: days },
    columns: [
      textCol('barcode', 'الباركود'),
      textCol('item_name', 'الخامة'),
      dateCol('roll_created', 'إنشاء الثوب'),
      dateCol('last_movement_at', 'آخر حركة'),
    ],
    rows: data.rows as Record<string, unknown>[],
    meta: {
      note: data.rows.length === 0 ? 'جميع الأدوات لها حركة حديثة أو لا توجد بيانات كافية.' : undefined,
      total: data.rows.length,
    },
  });
}

export async function reportInventoryNegativeStock(companyId: string): Promise<UnifiedReportPayload> {
  const pool = getPool();
  const data = await pool.query(
    `SELECT fr.barcode, fr.length_m, fr.actual_weight_kg,
            CASE WHEN fr.length_m < 0 THEN 'طول سالب' WHEN fr.actual_weight_kg < 0 THEN 'وزن سالب' ELSE 'سليم' END AS anomaly
     FROM fabric_rolls fr
     WHERE fr.company_id = $1 AND (fr.length_m < 0 OR fr.actual_weight_kg < 0)`,
    [companyId],
  );
  return buildReportPayload({
    key: 'inv_negative',
    title: 'رصد شذوذ سالب (طول/وزن)',
    subtitle: 'الأدواب لا تدعم مخزوناً سالباً منطقياً — كشف أخطاء إدخال',
    generatedAt: nowIso(),
    filtersApplied: {},
    columns: [
      textCol('barcode', 'الباركود'),
      moneyCol('length_m', 'طول'),
      moneyCol('actual_weight_kg', 'وزن'),
      textCol('anomaly', 'ملاحظة'),
    ],
    rows: data.rows as Record<string, unknown>[],
    meta: {
      note:
        data.rows.length === 0
          ? 'لا توجد قيم سالبة في الأطوال أو الأوزان.'
          : undefined,
      total: data.rows.length,
    },
  });
}

export async function reportInventoryRollLevel(
  companyId: string,
  q: Record<string, string | undefined>,
): Promise<UnifiedReportPayload> {
  const pool = getPool();
  const { page, pageSize, offset } = pageParams(q);
  const cnt = await pool.query<{ c: string }>(
    `SELECT COUNT(*)::int AS c FROM fabric_rolls WHERE company_id = $1`,
    [companyId],
  );
  const data = await pool.query(
    `SELECT fr.barcode,
            fi.name AS item_name,
            fi.internal_code,
            COALESCE(fc.name_ar, fc.name_tr, '') AS color_name,
            fc.color_code,
            fr.length_m,
            COALESCE(fr.actual_weight_kg, fr.calculated_weight_kg, 0)::numeric AS weight_kg,
            w.name AS warehouse_name
     FROM fabric_rolls fr
     JOIN fabric_items fi ON fi.id = fr.item_id AND fi.company_id = fr.company_id
     LEFT JOIN fabric_colors fc ON fc.id = fr.color_id
     JOIN warehouses w ON w.id = fr.warehouse_id
     WHERE fr.company_id = $1
     ORDER BY fr.created_at DESC
     LIMIT $2 OFFSET $3`,
    [companyId, pageSize, offset],
  );
  return buildReportPayload({
    key: 'tx1',
    title: 'المخزون على مستوى الطاقة / الثوب',
    generatedAt: nowIso(),
    filtersApplied: { page, pageSize },
    columns: [
      textCol('barcode', 'الباركود'),
      textCol('item_name', 'اسم خامة'),
      textCol('internal_code', 'كود خامة'),
      textCol('color_name', 'اللون'),
      textCol('color_code', 'كود اللون'),
      numCol('length_m', 'الطول'),
      numCol('weight_kg', 'وزن KG'),
      textCol('warehouse_name', 'المستودع'),
    ],
    rows: data.rows as Record<string, unknown>[],
    meta: { page, pageSize, total: parseInt(cnt.rows[0].c, 10) },
  });
}

export async function reportInventoryBatchTracking(companyId: string): Promise<UnifiedReportPayload> {
  const pool = getPool();
  const data = await pool.query(
    `SELECT b.id::text AS batch_id,
            b.file_name,
            b.status,
            b.created_at::date AS created,
            b.row_count::int AS rows_in_file,
            b.created_roll_count::int AS rolls_created
     FROM purchase_import_batches b
     WHERE b.company_id = $1
     ORDER BY b.created_at DESC
     LIMIT 200`,
    [companyId],
  );
  return buildReportPayload({
    key: 'inv_batch_tr',
    title: 'تتبع الدفعات وتواريخها',
    subtitle: 'دفعات استيراد Excel ومخرجاتها المسجّلة',
    generatedAt: nowIso(),
    filtersApplied: {},
    columns: [
      textCol('batch_id', 'معرف دفعة'),
      textCol('file_name', 'ملف'),
      textCol('status', 'حالة'),
      dateCol('created', 'تاريخ'),
      numCol('rows_in_file', 'صفوف الملف'),
      numCol('rolls_created', 'أدواب مُنشأة'),
    ],
    rows: data.rows as Record<string, unknown>[],
    meta: { total: data.rows.length },
  });
}

export async function reportInventoryFabricTypes(companyId: string): Promise<UnifiedReportPayload> {
  const pool = getPool();
  const data = await pool.query(
    `SELECT COALESCE(fc.name, '(بدون فئة)') AS category_name,
            COUNT(DISTINCT fi.id)::int AS items,
            COUNT(fr.id)::int AS rolls
     FROM fabric_items fi
     LEFT JOIN fabric_categories fc ON fc.id = fi.category_id AND fc.company_id = fi.company_id
     LEFT JOIN fabric_rolls fr ON fr.item_id = fi.id AND fr.company_id = fi.company_id
     WHERE fi.company_id = $1
     GROUP BY fc.id, fc.name
     ORDER BY rolls DESC`,
    [companyId],
  );
  return buildReportPayload({
    key: 'inv_fabric_types',
    title: 'أنواع الأقمشة (فئات)',
    generatedAt: nowIso(),
    filtersApplied: {},
    columns: [
      textCol('category_name', 'الفئة'),
      numCol('items', 'خامات'),
      numCol('rolls', 'أدواب'),
    ],
    rows: data.rows as Record<string, unknown>[],
    meta: { total: data.rows.length },
  });
}

export async function reportInventoryWasteAnalysis(companyId: string): Promise<UnifiedReportPayload> {
  const pool = getPool();
  const data = await pool.query(
    `SELECT wr.waste_no, wr.waste_date::text AS waste_date,
            wr.waste_type,
            COALESCE(SUM(wl.waste_length_m), 0)::numeric AS waste_length_m
     FROM inventory_waste_records wr
     LEFT JOIN inventory_waste_lines wl ON wl.waste_id = wr.id AND wl.company_id = wr.company_id
     WHERE wr.company_id = $1
     GROUP BY wr.id, wr.waste_no, wr.waste_date, wr.waste_type
     ORDER BY wr.waste_date DESC
     LIMIT 500`,
    [companyId],
  );
  const dmg = await pool.query(
    `SELECT COUNT(*)::int AS n FROM inventory_movements im
     WHERE im.company_id = $1 AND im.movement_type = 'DAMAGE'`,
    [companyId],
  );
  return buildReportPayload({
    key: 'inv_waste',
    title: 'تحليل الهدر والأضرار',
    generatedAt: nowIso(),
    filtersApplied: {},
    columns: [
      textCol('waste_no', 'رقم السجل'),
      textCol('waste_date', 'تاريخ'),
      textCol('waste_type', 'نوع'),
      moneyCol('waste_length_m', 'هدر أمتار'),
    ],
    rows: data.rows as Record<string, unknown>[],
    summaryCards: [{ label: 'حركات DAMAGE', value: dmg.rows[0].n }],
    meta: { total: data.rows.length },
  });
}

export async function reportInventoryCuttingEfficiency(): Promise<UnifiedReportPayload> {
  return emptyReport({
    key: 'inv_cut',
    title: 'كفاءة القص',
    columns: [textCol('job', 'عملية'), numCol('yield_pct', 'إنتاجية')],
    metaNote: 'لا توجد عمليات قص مسجلة بعد.',
    dataCompleteness: 'EMPTY_REASON',
  });
}

export async function reportInventoryRemainingLengths(companyId: string): Promise<UnifiedReportPayload> {
  const pool = getPool();
  const data = await pool.query(
    `SELECT
       fi.name AS item_name,
       COALESCE(fi.internal_code, '') AS internal_code,
       COUNT(fr.id)::int AS rolls_count,
       COALESCE(SUM(fr.length_m), 0)::numeric AS remaining_m,
       COALESCE(SUM(COALESCE(fr.actual_weight_kg, fr.calculated_weight_kg, 0)), 0)::numeric AS remaining_weight_kg
     FROM fabric_rolls fr
     JOIN fabric_items fi ON fi.id = fr.item_id AND fi.company_id = fr.company_id
     WHERE fr.company_id = $1 AND fr.status NOT IN ('SOLD','INACTIVE')
     GROUP BY fi.id, fi.name, fi.internal_code
     ORDER BY remaining_m DESC, fi.name
     LIMIT 1000`,
    [companyId],
  );
  const rows = data.rows as Record<string, unknown>[];
  const toNum = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const totalRolls = rows.reduce((sum, row) => sum + toNum(row.rolls_count), 0);
  const totalRemaining = rows.reduce((sum, row) => sum + toNum(row.remaining_m), 0);
  const totalWeight = rows.reduce((sum, row) => sum + toNum(row.remaining_weight_kg), 0);
  return buildReportPayload({
    key: 'inv_rem_len',
    title: 'الأطوال المتبقية حسب الخامة',
    subtitle: 'مجموع أطوال الكميات المتبقية لكل خامة غير مباعة',
    generatedAt: nowIso(),
    filtersApplied: {},
    columns: [
      textCol('item_name', 'الخامة'),
      textCol('internal_code', 'كود الخامة'),
      numCol('rolls_count', 'عدد الأتواب'),
      moneyCol('remaining_m', 'إجمالي المتبقي م'),
      moneyCol('remaining_weight_kg', 'إجمالي الوزن KG'),
    ],
    rows,
    summaryCards: [
      { label: 'عدد الخامات', value: String(rows.length) },
      { label: 'عدد الأتواب المتبقية', value: String(totalRolls) },
      { label: 'إجمالي الأطوال المتبقية', value: totalRemaining.toFixed(2) },
      { label: 'إجمالي الأوزان المتبقية', value: totalWeight.toFixed(2) },
    ],
    meta: { total: rows.length },
  });
}

// ─── Customers / suppliers ───────────────────────────────────────────────────

export async function reportCustomersActivity(
  companyId: string,
  q: Record<string, string | undefined>,
): Promise<UnifiedReportPayload> {
  const qq = { ...q, partyType: 'CUSTOMER' };
  const r = await reportPartyActivity(companyId, qq);
  return {
    ...r,
    key: 'cust_act',
    title: 'نشاط العملاء',
    subtitle: 'من سجل أنشطة الأطراف — عملاء فقط',
  };
}

export async function reportCustomersStatement(
  companyId: string,
  q: Record<string, string | undefined>,
): Promise<UnifiedReportPayload> {
  const pool = getPool();
  const { page, pageSize, offset } = pageParams(q);
  const dateFrom = q.dateFrom?.trim();
  const dateTo = q.dateTo?.trim();
  const params: unknown[] = [companyId];
  let p = 2;
  let wc = `v.company_id = $1 AND v.party_type = 'CUSTOMER'`;
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
    `SELECT v.voucher_date::text AS dt, v.voucher_no, v.voucher_type, v.amount, v.currency_code,
            v.status, v.party_name, COALESCE(v.description,'') AS description
     FROM vouchers v WHERE ${wc}
     ORDER BY v.voucher_date DESC LIMIT $${p} OFFSET $${p + 1}`,
    [...params, pageSize, offset],
  );
  return buildReportPayload({
    key: 'c1',
    title: 'كشف حساب عميل (سندات)',
    subtitle: 'سندات مرتبطة بعملاء فقط — ليس دفتر ذمة كامل',
    generatedAt: nowIso(),
    filtersApplied: { dateFrom: dateFrom || null, dateTo: dateTo || null, page, pageSize },
    columns: [
      dateCol('dt', 'التاريخ'),
      textCol('voucher_no', 'رقم'),
      textCol('voucher_type', 'نوع'),
      moneyCol('amount', 'مبلغ'),
      textCol('currency_code', 'عملة'),
      textCol('status', 'حالة'),
      textCol('party_name', 'العميل'),
      textCol('description', 'البيان'),
    ],
    rows: data.rows as Record<string, unknown>[],
    meta: { page, pageSize, total: parseInt(cnt.rows[0].c, 10) },
  });
}

export async function reportCustomersAging(): Promise<UnifiedReportPayload> {
  return emptyReport({
    key: 'c2',
    title: 'أعمار ديون العملاء',
    columns: [textCol('bucket', 'فترة'), moneyCol('amount', 'مبلغ')],
    metaNote: 'يتطلب فواتير ذمم بتواريخ استحقاق.',
    dataCompleteness: 'EMPTY_REASON',
  });
}

export async function reportCustomersByStatus(companyId: string): Promise<UnifiedReportPayload> {
  const pool = getPool();
  const data = await pool.query(
    `SELECT CASE WHEN is_active THEN 'نشط' ELSE 'غير نشط' END AS status_label, COUNT(*)::int AS n
     FROM customers WHERE company_id = $1 GROUP BY is_active`,
    [companyId],
  );
  return buildReportPayload({
    key: 'c_status',
    title: 'العملاء حسب الحالة',
    generatedAt: nowIso(),
    filtersApplied: {},
    columns: [
      textCol('status_label', 'الحالة'),
      numCol('n', 'العدد'),
    ],
    rows: data.rows as Record<string, unknown>[],
    meta: { total: data.rows.length },
  });
}

export async function reportCustomersSummary(companyId: string): Promise<UnifiedReportPayload> {
  const pool = getPool();
  const c = await pool.query(
    `SELECT COUNT(*)::int AS n FROM customers WHERE company_id = $1`,
    [companyId],
  );
  const v = await pool.query(
    `SELECT COALESCE(SUM(amount),0)::numeric AS t FROM vouchers WHERE company_id = $1 AND party_type='CUSTOMER' AND status='CONFIRMED'`,
    [companyId],
  );
  return buildReportPayload({
    key: 'c_sum',
    title: 'ملخص تعاملات العملاء',
    generatedAt: nowIso(),
    filtersApplied: {},
    columns: [textCol('k', 'المؤشر'), textCol('v', 'القيمة')],
    rows: [
      { k: 'عدد العملاء', v: c.rows[0].n },
      { k: 'مجموع سندات مؤكدة (عملاء)', v: String(v.rows[0].t) },
    ],
    meta: {},
  });
}

export async function reportSuppliersActivity(
  companyId: string,
  q: Record<string, string | undefined>,
): Promise<UnifiedReportPayload> {
  const r = await reportPartyActivity(companyId, { ...q, partyType: 'SUPPLIER' });
  return { ...r, key: 'sup_act', title: 'نشاط الموردين', subtitle: 'موردون فقط' };
}

export async function reportSuppliersStatement(
  companyId: string,
  q: Record<string, string | undefined>,
): Promise<UnifiedReportPayload> {
  const pool = getPool();
  const { page, pageSize, offset } = pageParams(q);
  const dateFrom = q.dateFrom?.trim();
  const dateTo = q.dateTo?.trim();
  const params: unknown[] = [companyId];
  let p = 2;
  let wc = `v.company_id = $1 AND v.party_type = 'SUPPLIER'`;
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
    `SELECT v.voucher_date::text AS dt, v.voucher_no, v.voucher_type, v.amount, v.currency_code,
            v.status, v.party_name, COALESCE(v.description,'') AS description
     FROM vouchers v WHERE ${wc}
     ORDER BY v.voucher_date DESC LIMIT $${p} OFFSET $${p + 1}`,
    [...params, pageSize, offset],
  );
  return buildReportPayload({
    key: 's1',
    title: 'كشف حساب مورد (سندات)',
    subtitle: 'سندات مرتبطة بموردين فقط',
    generatedAt: nowIso(),
    filtersApplied: { dateFrom: dateFrom || null, dateTo: dateTo || null, page, pageSize },
    columns: [
      dateCol('dt', 'التاريخ'),
      textCol('voucher_no', 'رقم'),
      textCol('voucher_type', 'نوع'),
      moneyCol('amount', 'مبلغ'),
      textCol('currency_code', 'عملة'),
      textCol('status', 'حالة'),
      textCol('party_name', 'المورد'),
      textCol('description', 'البيان'),
    ],
    rows: data.rows as Record<string, unknown>[],
    meta: { page, pageSize, total: parseInt(cnt.rows[0].c, 10) },
  });
}

export async function reportSuppliersAging(): Promise<UnifiedReportPayload> {
  return emptyReport({
    key: 's2',
    title: 'أعمار ذمم الموردين',
    columns: [textCol('bucket', 'فترة'), moneyCol('amount', 'مبلغ')],
    metaNote: 'يتطلب مستحقات موردين بتواريخ استحقاق.',
    dataCompleteness: 'EMPTY_REASON',
  });
}

export async function reportSuppliersByStatus(companyId: string): Promise<UnifiedReportPayload> {
  const pool = getPool();
  const data = await pool.query(
    `SELECT CASE WHEN is_active THEN 'نشط' ELSE 'غير نشط' END AS status_label, COUNT(*)::int AS n
     FROM suppliers WHERE company_id = $1 GROUP BY is_active`,
    [companyId],
  );
  return buildReportPayload({
    key: 'sup_status',
    title: 'الموردون حسب الحالة',
    generatedAt: nowIso(),
    filtersApplied: {},
    columns: [
      textCol('status_label', 'الحالة'),
      numCol('n', 'العدد'),
    ],
    rows: data.rows as Record<string, unknown>[],
    meta: { total: data.rows.length },
  });
}

export async function reportSuppliersSummary(companyId: string): Promise<UnifiedReportPayload> {
  const pool = getPool();
  const c = await pool.query(
    `SELECT COUNT(*)::int AS n FROM suppliers WHERE company_id = $1`,
    [companyId],
  );
  const v = await pool.query(
    `SELECT COALESCE(SUM(amount),0)::numeric AS t FROM vouchers WHERE company_id = $1 AND party_type='SUPPLIER' AND status='CONFIRMED'`,
    [companyId],
  );
  return buildReportPayload({
    key: 'sup_sum',
    title: 'ملخص تعاملات الموردين',
    generatedAt: nowIso(),
    filtersApplied: {},
    columns: [textCol('k', 'المؤشر'), textCol('v', 'القيمة')],
    rows: [
      { k: 'عدد الموردين', v: c.rows[0].n },
      { k: 'مجموع سندات مؤكدة (موردين)', v: String(v.rows[0].t) },
    ],
    meta: {},
  });
}

// ─── Payroll ──────────────────────────────────────────────────────────────────

export async function reportPayrollEmployees(companyId: string): Promise<UnifiedReportPayload> {
  const pool = getPool();
  const data = await pool.query(
    `SELECT employee_code, full_name, job_title, department, base_salary, currency_code, is_active
     FROM payroll_employees WHERE company_id = $1 ORDER BY full_name`,
    [companyId],
  );
  return buildReportPayload({
    key: 'pay_emp',
    title: 'قائمة الموظفين',
    generatedAt: nowIso(),
    filtersApplied: {},
    columns: [
      textCol('employee_code', 'الرمز'),
      textCol('full_name', 'الاسم'),
      textCol('job_title', 'المسمى'),
      textCol('department', 'قسم'),
      moneyCol('base_salary', 'راتب أساس'),
      textCol('currency_code', 'عملة'),
      textCol('is_active', 'نشط'),
    ],
    rows: data.rows as Record<string, unknown>[],
    meta: { total: data.rows.length },
  });
}

export async function reportPayrollRunsList(companyId: string): Promise<UnifiedReportPayload> {
  const pool = getPool();
  const data = await pool.query(
    `SELECT payroll_no, period_month, period_year, status, total_net, currency_code, created_at
     FROM payroll_runs WHERE company_id = $1 ORDER BY period_year DESC, period_month DESC`,
    [companyId],
  );
  return buildReportPayload({
    key: 'pay_runs',
    title: 'مسيرات الرواتب',
    generatedAt: nowIso(),
    filtersApplied: {},
    columns: [
      textCol('payroll_no', 'رقم المسير'),
      numCol('period_month', 'شهر'),
      numCol('period_year', 'سنة'),
      textCol('status', 'حالة'),
      moneyCol('total_net', 'صافي'),
      textCol('currency_code', 'عملة'),
      dateCol('created_at', 'تاريخ'),
    ],
    rows: data.rows as Record<string, unknown>[],
    meta: { total: data.rows.length },
  });
}

export async function reportPayrollMonthlySummary(companyId: string): Promise<UnifiedReportPayload> {
  const pool = getPool();
  const data = await pool.query(
    `SELECT period_year, period_month,
            COUNT(*)::int AS runs,
            COALESCE(SUM(total_net) FILTER (WHERE status IN ('CONFIRMED','PAID')),0)::numeric AS net_paid
     FROM payroll_runs
     WHERE company_id = $1
     GROUP BY period_year, period_month
     ORDER BY period_year DESC, period_month DESC`,
    [companyId],
  );
  return buildReportPayload({
    key: 'pay_month',
    title: 'ملخص رواتب شهري',
    generatedAt: nowIso(),
    filtersApplied: {},
    columns: [
      numCol('period_year', 'سنة'),
      numCol('period_month', 'شهر'),
      numCol('runs', 'مسيرات'),
      moneyCol('net_paid', 'صافي مسيرات'),
    ],
    rows: data.rows as Record<string, unknown>[],
    meta: { total: data.rows.length },
  });
}

// ─── Printing ─────────────────────────────────────────────────────────────────

export async function reportPrintingPrintedLabels(
  companyId: string,
  q: Record<string, string | undefined>,
): Promise<UnifiedReportPayload> {
  const pool = getPool();
  const { page, pageSize, offset } = pageParams(q);
  const cnt = await pool.query<{ c: string }>(
    `SELECT COUNT(*)::int AS c FROM printed_labels WHERE company_id = $1`,
    [companyId],
  );
  const data = await pool.query(
    `SELECT pl.barcode, pl.print_count, pl.last_printed_at, pl.print_job_id::text AS job_id
     FROM printed_labels pl
     WHERE pl.company_id = $1
     ORDER BY pl.last_printed_at DESC
     LIMIT $2 OFFSET $3`,
    [companyId, pageSize, offset],
  );
  return buildReportPayload({
    key: 'print_labels',
    title: 'اللصاقات المطبوعة',
    generatedAt: nowIso(),
    filtersApplied: { page, pageSize },
    columns: [
      textCol('barcode', 'الباركود'),
      numCol('print_count', 'مرات الطباعة'),
      dateCol('last_printed_at', 'آخر طباعة'),
      textCol('job_id', 'مهمة'),
    ],
    rows: data.rows as Record<string, unknown>[],
    meta: { page, pageSize, total: parseInt(cnt.rows[0].c, 10) },
  });
}

export async function reportPrintingUnprintedRolls(companyId: string): Promise<UnifiedReportPayload> {
  const pool = getPool();
  const data = await pool.query(
    `SELECT fr.barcode, fi.name AS item_name, fr.created_at::date AS created
     FROM fabric_rolls fr
     JOIN fabric_items fi ON fi.id = fr.item_id AND fi.company_id = fr.company_id
     WHERE fr.company_id = $1
       AND NOT EXISTS (SELECT 1 FROM printed_labels pl WHERE pl.roll_id = fr.id AND pl.company_id = fr.company_id)
     ORDER BY fr.created_at DESC
     LIMIT 500`,
    [companyId],
  );
  return buildReportPayload({
    key: 'print_unprinted',
    title: 'أدواب بدون لصاقة مطبوعة',
    subtitle: 'بدون سجل في printed_labels',
    generatedAt: nowIso(),
    filtersApplied: {},
    columns: [
      textCol('barcode', 'الباركود'),
      textCol('item_name', 'الخامة'),
      dateCol('created', 'تاريخ الإدخال'),
    ],
    rows: data.rows as Record<string, unknown>[],
    meta: {
      note:
        data.rows.length === 0
          ? 'جميع الأدواب المحددة لديها طباعة مسجلة أو لا توجد أدواب.'
          : undefined,
      total: data.rows.length,
    },
  });
}
