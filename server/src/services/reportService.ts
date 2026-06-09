import { getPool } from '../db/pool.js';
import type { UnifiedReportPayload } from './reportTypes.js';
import { nowIso } from './reportTypes.js';

const MAX_PAGE = 10000;

function pageParams(q: Record<string, string | undefined>): { page: number; pageSize: number; offset: number } {
  const page = Math.max(1, parseInt(String(q.page || '1'), 10) || 1);
  const pageSize = Math.min(MAX_PAGE, Math.max(1, parseInt(String(q.pageSize || '50'), 10) || 50));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function shortId(id: string): string {
  return id.replace(/-/g, '').slice(0, 10).toUpperCase();
}

/** Extended dashboard counts + aggregates — merged into API `data` object */
export async function fetchExtendedDashboardSummary(companyId: string): Promise<Record<string, unknown>> {
  const pool = getPool();
  const [main, cashRows, weightRow] = await Promise.all([
    pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM customers WHERE company_id = $1) AS customers_count,
         (SELECT COUNT(*)::int FROM suppliers WHERE company_id = $1) AS suppliers_count,
         (SELECT COUNT(*)::int FROM fabric_rolls WHERE company_id = $1) AS fabric_rolls_count,
         (SELECT COUNT(*)::int FROM fabric_rolls WHERE company_id = $1
            AND status IN ('AVAILABLE','RESERVED','TRANSFERRED')) AS active_fabric_rolls_count,
         (SELECT COUNT(*)::int FROM fabric_rolls WHERE company_id = $1 AND status = 'DAMAGED') AS damaged_or_waste_rolls_count,
         (SELECT COUNT(*)::int FROM warehouses WHERE company_id = $1) AS warehouses_count,
         (SELECT COUNT(*)::int FROM purchase_import_batches WHERE company_id = $1) AS purchase_import_batches_count,
         (SELECT COUNT(*)::int FROM print_jobs WHERE company_id = $1) AS print_jobs_count,
         (SELECT COUNT(*)::int FROM cashboxes WHERE company_id = $1) AS cashboxes_count,
         (SELECT COUNT(*)::int FROM vouchers WHERE company_id = $1) AS vouchers_count,
         (SELECT COUNT(*)::int FROM return_invoices WHERE company_id = $1) AS return_invoices_count,
         (SELECT COUNT(*)::int FROM payroll_employees WHERE company_id = $1) AS payroll_employees_count,
         (SELECT COUNT(*)::int FROM payroll_runs WHERE company_id = $1) AS payroll_runs_count,
         (SELECT COUNT(*)::int FROM inventory_transfers WHERE company_id = $1) AS transfers_count,
         (SELECT COUNT(*)::int FROM inventory_waste_records WHERE company_id = $1) AS waste_records_count,
         (SELECT COALESCE(SUM(length_m), 0)::numeric FROM fabric_rolls WHERE company_id = $1) AS total_roll_length_m,
         (SELECT COALESCE(SUM(COALESCE(actual_weight_kg, calculated_weight_kg, 0)), 0)::numeric
            FROM fabric_rolls WHERE company_id = $1) AS total_roll_weight_kg,
         (SELECT COALESCE(SUM(amount) FILTER (WHERE status = 'CONFIRMED' AND voucher_type = 'RECEIPT'), 0)::numeric
            FROM vouchers WHERE company_id = $1) AS receipt_total,
         (SELECT COALESCE(SUM(amount) FILTER (WHERE status = 'CONFIRMED' AND voucher_type = 'PAYMENT'), 0)::numeric
            FROM vouchers WHERE company_id = $1) AS payment_total`,
      [companyId],
    ),
    pool.query<{ currency_code: string; total: string }>(
      `SELECT currency_code, SUM(current_balance)::numeric AS total
       FROM cashboxes WHERE company_id = $1 AND is_active = true
       GROUP BY currency_code ORDER BY currency_code`,
      [companyId],
    ),
    pool.query<{ n: string }>(
      `SELECT COUNT(*)::int AS n FROM inventory_movements WHERE company_id = $1`,
      [companyId],
    ),
  ]);

  const row = main.rows[0] as Record<string, unknown>;
  row.inventory_movements_count = parseInt(weightRow.rows[0].n, 10);
  row.total_cash_by_currency = cashRows.rows.map((r) => ({
    currency_code: r.currency_code,
    total: r.total,
  }));
  return row;
}

export async function reportInventoryRolls(
  companyId: string,
  q: Record<string, string | undefined>,
): Promise<UnifiedReportPayload> {
  const pool = getPool();
  const { page, pageSize, offset } = pageParams(q);
  const search = q.search?.trim();
  const warehouseId = q.warehouseId?.trim();
  const categoryId = q.categoryId?.trim();
  const itemId = q.itemId?.trim();
  const colorId = q.colorId?.trim();
  const supplierId = q.supplierId?.trim();
  const status = q.status?.trim();
  const dateFrom = q.dateFrom?.trim();
  const dateTo = q.dateTo?.trim();

  const filtersApplied: Record<string, unknown> = {
    search: search || null,
    warehouseId: warehouseId || null,
    categoryId: categoryId || null,
    itemId: itemId || null,
    colorId: colorId || null,
    supplierId: supplierId || null,
    status: status || null,
    dateFrom: dateFrom || null,
    dateTo: dateTo || null,
    page,
    pageSize,
  };

  const conditions: string[] = ['fr.company_id = $1'];
  const params: unknown[] = [companyId];
  let p = 2;

  if (search) {
    conditions.push(
      `(fr.barcode ILIKE $${p} OR fr.roll_no ILIKE $${p} OR fi.name ILIKE $${p} OR COALESCE(fc.name_ar,'') ILIKE $${p})`,
    );
    params.push(`%${search}%`);
    p++;
  }
  if (warehouseId) {
    conditions.push(`fr.warehouse_id = $${p}`);
    params.push(warehouseId);
    p++;
  }
  if (categoryId) {
    conditions.push(`fi.category_id = $${p}`);
    params.push(categoryId);
    p++;
  }
  if (itemId) {
    conditions.push(`fr.item_id = $${p}`);
    params.push(itemId);
    p++;
  }
  if (colorId) {
    conditions.push(`fr.color_id = $${p}`);
    params.push(colorId);
    p++;
  }
  if (supplierId) {
    conditions.push(`fr.supplier_id = $${p}`);
    params.push(supplierId);
    p++;
  }
  if (status) {
    conditions.push(`fr.status = $${p}`);
    params.push(status);
    p++;
  }
  if (dateFrom) {
    conditions.push(`fr.created_at::date >= $${p}::date`);
    params.push(dateFrom);
    p++;
  }
  if (dateTo) {
    conditions.push(`fr.created_at::date <= $${p}::date`);
    params.push(dateTo);
    p++;
  }

  const where = conditions.join(' AND ');

  const countQ = await pool.query<{ c: string }>(
    `SELECT COUNT(*)::int AS c
     FROM fabric_rolls fr
     JOIN fabric_items fi ON fi.id = fr.item_id AND fi.company_id = fr.company_id
     LEFT JOIN fabric_colors fc ON fc.id = fr.color_id
     WHERE ${where}`,
    params,
  );

  const rollLengthCte = `
    WITH roll_lengths AS (
      SELECT
        roll_id,
        COALESCE(SUM(length_delta_m) FILTER (WHERE length_delta_m > 0), 0)::numeric AS positive_length_m,
        ABS(COALESCE(SUM(length_delta_m) FILTER (WHERE length_delta_m < 0), 0))::numeric AS sold_length_m
      FROM inventory_movements
      WHERE company_id = $1
      GROUP BY roll_id
    )
  `;

  const dataQ = await pool.query(
    `${rollLengthCte}
     SELECT fr.barcode,
            fi.name AS item_name,
            fi.internal_code,
            COALESCE(fc.name_ar, fc.name_tr, '') AS color_name,
            fc.color_code,
            COALESCE(NULLIF(rl.positive_length_m, 0), COALESCE(fr.length_m, 0) + COALESCE(rl.sold_length_m, 0), COALESCE(fr.length_m, 0), 0)::numeric AS length_m,
            COALESCE(fr.length_m, 0)::numeric AS remaining_length_m,
            GREATEST(
              COALESCE(NULLIF(rl.positive_length_m, 0), COALESCE(fr.length_m, 0) + COALESCE(rl.sold_length_m, 0), COALESCE(fr.length_m, 0), 0)
              - COALESCE(fr.length_m, 0),
              0
            )::numeric AS sold_length_m,
            COALESCE(fr.actual_weight_kg, fr.calculated_weight_kg, 0)::numeric AS weight_kg,
            w.name AS warehouse_name,
            fr.status,
            fr.created_at
     FROM fabric_rolls fr
     JOIN fabric_items fi ON fi.id = fr.item_id AND fi.company_id = fr.company_id
     LEFT JOIN fabric_colors fc ON fc.id = fr.color_id
     JOIN warehouses w ON w.id = fr.warehouse_id AND w.company_id = fr.company_id
     LEFT JOIN roll_lengths rl ON rl.roll_id = fr.id
     WHERE ${where}
     ORDER BY COALESCE(fi.internal_code, '') ASC, fi.name ASC, fr.created_at DESC
     LIMIT $${p} OFFSET $${p + 1}`,
    [...params, pageSize, offset],
  );

  const tot = await pool.query(
    `${rollLengthCte}
     SELECT
       COALESCE(SUM(COALESCE(NULLIF(rl.positive_length_m, 0), COALESCE(fr.length_m, 0) + COALESCE(rl.sold_length_m, 0), COALESCE(fr.length_m, 0), 0)), 0)::numeric AS total_length,
       COALESCE(SUM(COALESCE(fr.length_m, 0)), 0)::numeric AS total_remaining_length,
       COALESCE(SUM(GREATEST(
         COALESCE(NULLIF(rl.positive_length_m, 0), COALESCE(fr.length_m, 0) + COALESCE(rl.sold_length_m, 0), COALESCE(fr.length_m, 0), 0)
         - COALESCE(fr.length_m, 0),
         0
       )), 0)::numeric AS total_sold_length,
       COALESCE(SUM(COALESCE(fr.actual_weight_kg, fr.calculated_weight_kg, 0)), 0)::numeric AS total_weight
     FROM fabric_rolls fr
     JOIN fabric_items fi ON fi.id = fr.item_id AND fi.company_id = fr.company_id
     LEFT JOIN fabric_colors fc ON fc.id = fr.color_id
     LEFT JOIN roll_lengths rl ON rl.roll_id = fr.id
     WHERE ${where}`,
    params,
  );
  const materialsQ = await pool.query<{ c: string }>(
    `SELECT COUNT(DISTINCT COALESCE(NULLIF(fi.internal_code, ''), fi.name))::int AS c
     FROM fabric_rolls fr
     JOIN fabric_items fi ON fi.id = fr.item_id AND fi.company_id = fr.company_id
     LEFT JOIN fabric_colors fc ON fc.id = fr.color_id
     WHERE ${where}`,
    params,
  );

  const columns = [
    { key: 'barcode', label: 'الباركود', type: 'text' as const },
    { key: 'item_name', label: 'اسم خامة', type: 'text' as const },
    { key: 'internal_code', label: 'كود خامة', type: 'text' as const },
    { key: 'color_name', label: 'اللون', type: 'text' as const },
    { key: 'color_code', label: 'كود اللون', type: 'text' as const },
    { key: 'length_m', label: 'الطول الأصلي', type: 'number' as const },
    { key: 'remaining_length_m', label: 'المتبقي م', type: 'number' as const },
    { key: 'sold_length_m', label: 'المباع م', type: 'number' as const },
    { key: 'weight_kg', label: 'وزن KG', type: 'number' as const },
    { key: 'status', label: 'الحالة', type: 'text' as const },
    { key: 'warehouse_name', label: 'المستودع', type: 'text' as const },
  ];

  const rawRows = dataQ.rows as Record<string, unknown>[];
  const rows: Record<string, unknown>[] = [];
  const toNum = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const toText = (v: unknown) => String(v ?? '').trim();
  let currentGroupCode = '';
  let countRolls = 0;
  let totalLength = 0;
  let totalRemainingLength = 0;
  let totalSoldLength = 0;
  let totalWeight = 0;
  const colors = new Set<string>();

  const pushSummary = () => {
    if (!currentGroupCode || countRolls === 0) return;
    rows.push({
      barcode: '',
      item_name: '',
      internal_code: `ملخص كود الخامة: ${currentGroupCode}`,
      color_name: `عدد الألوان: ${colors.size}`,
      color_code: `عدد الأتواب: ${countRolls}`,
      length_m: `مجموع الأمتار: ${totalLength.toFixed(2)}`,
      remaining_length_m: `المتبقي: ${totalRemainingLength.toFixed(2)}`,
      sold_length_m: `المباع: ${totalSoldLength.toFixed(2)}`,
      // Keep weight empty when no meaningful value exists for this group.
      weight_kg: totalWeight > 0 ? `مجموع الأوزان: ${totalWeight.toFixed(2)}` : null,
      status: '',
      warehouse_name: '',
      __is_group_summary: true,
    });
  };

  for (const row of rawRows) {
    const groupCode = toText(row.internal_code) || toText(row.item_name);
    if (currentGroupCode && groupCode !== currentGroupCode) {
      pushSummary();
      countRolls = 0;
      totalLength = 0;
      totalRemainingLength = 0;
      totalSoldLength = 0;
      totalWeight = 0;
      colors.clear();
    }
    currentGroupCode = groupCode;
    countRolls += 1;
    totalLength += toNum(row.length_m);
    totalRemainingLength += toNum(row.remaining_length_m);
    totalSoldLength += toNum(row.sold_length_m);
    totalWeight += toNum(row.weight_kg);
    const colorKey = toText(row.color_name) || toText(row.color_code);
    if (colorKey && colorKey !== '—') colors.add(colorKey.toLowerCase());
    rows.push(row);
  }
  pushSummary();

  return {
    title: 'كشف أتواب المخزون',
    generatedAt: nowIso(),
    filtersApplied,
    columns,
    rows,
    totals: {
      total_materials: materialsQ.rows[0].c,
      total_rolls: countQ.rows[0].c,
      total_length_m: String(tot.rows[0].total_length),
      total_remaining_length_m: String(tot.rows[0].total_remaining_length),
      total_sold_length_m: String(tot.rows[0].total_sold_length),
      total_weight_kg: String(tot.rows[0].total_weight),
    },
    meta: { page, pageSize, total: parseInt(countQ.rows[0].c, 10) },
  };
}

export async function reportInventoryMovements(
  companyId: string,
  q: Record<string, string | undefined>,
): Promise<UnifiedReportPayload> {
  const pool = getPool();
  const { page, pageSize, offset } = pageParams(q);
  const search = q.search?.trim();
  const movementType = q.movementType?.trim();
  const warehouseId = q.warehouseId?.trim();
  const rollId = q.rollId?.trim();
  const dateFrom = q.dateFrom?.trim();
  const dateTo = q.dateTo?.trim();

  const filtersApplied: Record<string, unknown> = {
    search: search || null,
    movementType: movementType || null,
    warehouseId: warehouseId || null,
    rollId: rollId || null,
    dateFrom: dateFrom || null,
    dateTo: dateTo || null,
    page,
    pageSize,
  };

  const conditions: string[] = ['im.company_id = $1'];
  const params: unknown[] = [companyId];
  let p = 2;

  if (movementType) {
    conditions.push(`im.movement_type = $${p}`);
    params.push(movementType);
    p++;
  }
  if (rollId) {
    conditions.push(`im.roll_id = $${p}`);
    params.push(rollId);
    p++;
  }
  if (warehouseId) {
    conditions.push(`(im.from_warehouse_id = $${p} OR im.to_warehouse_id = $${p})`);
    params.push(warehouseId);
    p++;
  }
  if (dateFrom) {
    conditions.push(`im.created_at::date >= $${p}::date`);
    params.push(dateFrom);
    p++;
  }
  if (dateTo) {
    conditions.push(`im.created_at::date <= $${p}::date`);
    params.push(dateTo);
    p++;
  }
  if (search) {
    conditions.push(
      `(fr.barcode ILIKE $${p} OR COALESCE(im.reference_no,'') ILIKE $${p} OR COALESCE(im.notes,'') ILIKE $${p} OR fi.name ILIKE $${p})`,
    );
    params.push(`%${search}%`);
    p++;
  }

  const where = conditions.join(' AND ');

  const countQ = await pool.query<{ c: string }>(
    `SELECT COUNT(*)::int AS c
     FROM inventory_movements im
     JOIN fabric_rolls fr ON fr.id = im.roll_id AND fr.company_id = im.company_id
     JOIN fabric_items fi ON fi.id = fr.item_id AND fi.company_id = fr.company_id
     WHERE ${where}`,
    params,
  );

  const dataQ = await pool.query(
    `SELECT im.id,
            im.created_at AS movement_at,
            im.movement_type,
            fr.barcode,
            fi.name AS item_name,
            COALESCE(fc.name_ar, fc.name_tr, '') AS color_name,
            im.length_delta_m,
            im.weight_delta_kg,
            fw.name AS from_warehouse_name,
            tw.name AS to_warehouse_name,
            im.reference_type AS source_type,
            im.reference_no AS source_no,
            im.notes AS description,
            u.full_name AS created_by_name
     FROM inventory_movements im
     JOIN fabric_rolls fr ON fr.id = im.roll_id AND fr.company_id = im.company_id
     JOIN fabric_items fi ON fi.id = fr.item_id AND fi.company_id = fr.company_id
     LEFT JOIN fabric_colors fc ON fc.id = fr.color_id
     LEFT JOIN warehouses fw ON fw.id = im.from_warehouse_id
     LEFT JOIN warehouses tw ON tw.id = im.to_warehouse_id
     LEFT JOIN users u ON u.id = im.created_by_user_id
     WHERE ${where}
     ORDER BY im.created_at DESC
     LIMIT $${p} OFFSET $${p + 1}`,
    [...params, pageSize, offset],
  );

  const rows = (dataQ.rows as Record<string, unknown>[]).map((r) => ({
    ...r,
    movement_no: shortId(String(r.id)),
    item_color_summary: [r.item_name, r.color_name].filter(Boolean).join(' / '),
  }));

  const columns = [
    { key: 'movement_no', label: 'مرجع', type: 'text' as const },
    { key: 'movement_at', label: 'التاريخ', type: 'date' as const },
    { key: 'movement_type', label: 'نوع الحركة', type: 'text' as const },
    { key: 'barcode', label: 'الباركود', type: 'text' as const },
    { key: 'item_color_summary', label: 'خامة / لون', type: 'text' as const },
    { key: 'length_delta_m', label: 'فرق الطول م', type: 'number' as const },
    { key: 'weight_delta_kg', label: 'فرق الوزن KG', type: 'number' as const },
    { key: 'from_warehouse_name', label: 'من مستودع', type: 'text' as const },
    { key: 'to_warehouse_name', label: 'إلى مستودع', type: 'text' as const },
    { key: 'source_type', label: 'مصدر النوع', type: 'text' as const },
    { key: 'source_no', label: 'رقم المصدر', type: 'text' as const },
    { key: 'description', label: 'الوصف', type: 'text' as const },
    { key: 'created_by_name', label: 'المستخدم', type: 'text' as const },
  ];

  return {
    title: 'حركة الأتواب',
    generatedAt: nowIso(),
    filtersApplied,
    columns,
    rows,
    totals: { movements_count: countQ.rows[0].c },
    meta: { page, pageSize, total: parseInt(countQ.rows[0].c, 10) },
  };
}

export async function reportRollsByWarehouse(
  companyId: string,
  q: Record<string, string | undefined>,
): Promise<UnifiedReportPayload> {
  const pool = getPool();
  const search = q.search?.trim();
  const filtersApplied = { search: search || null };

  const having = search
    ? `HAVING w.code ILIKE $2 OR w.name ILIKE $2`
    : '';

  const params: unknown[] = [companyId];
  if (search) params.push(`%${search}%`);

  const sql = `
    SELECT w.code AS warehouse_code,
           w.name AS warehouse_name,
           COUNT(fr.id)::int AS rolls_count,
           COALESCE(SUM(fr.length_m), 0)::numeric AS total_length_m,
           COALESCE(SUM(COALESCE(fr.actual_weight_kg, fr.calculated_weight_kg, 0)), 0)::numeric AS total_weight_kg,
           COUNT(fr.id) FILTER (WHERE fr.status IN ('AVAILABLE','RESERVED','TRANSFERRED'))::int AS active_count,
           COUNT(fr.id) FILTER (WHERE fr.status = 'DAMAGED')::int AS damaged_count
    FROM warehouses w
    LEFT JOIN fabric_rolls fr ON fr.warehouse_id = w.id AND fr.company_id = w.company_id
    WHERE w.company_id = $1
    GROUP BY w.id, w.code, w.name
    ${having}
    ORDER BY w.name`;

  const dataQ = await pool.query(sql, params);

  const rows = dataQ.rows as Record<string, unknown>[];
  let sumRolls = 0;
  let sumLen = 0;
  let sumWt = 0;
  for (const r of rows) {
    sumRolls += Number(r.rolls_count) || 0;
    sumLen += parseFloat(String(r.total_length_m)) || 0;
    sumWt += parseFloat(String(r.total_weight_kg)) || 0;
  }

  return {
    title: 'الأتواب حسب المستودع',
    generatedAt: nowIso(),
    filtersApplied,
    columns: [
      { key: 'warehouse_code', label: 'كود', type: 'text' },
      { key: 'warehouse_name', label: 'المستودع', type: 'text' },
      { key: 'rolls_count', label: 'عدد الأتواب', type: 'number' },
      { key: 'total_length_m', label: 'إجمالي الأمتار', type: 'number' },
      { key: 'total_weight_kg', label: 'إجمالي الوزن', type: 'number' },
      { key: 'active_count', label: 'نشطة', type: 'number' },
      { key: 'damaged_count', label: 'تالفة', type: 'number' },
    ],
    rows,
    totals: {
      warehouses: rows.length,
      rolls_sum: sumRolls,
      length_sum: sumLen.toFixed(3),
      weight_sum: sumWt.toFixed(3),
    },
  };
}

export async function reportRollsByItemColor(
  companyId: string,
  q: Record<string, string | undefined>,
): Promise<UnifiedReportPayload> {
  const pool = getPool();
  const search = q.search?.trim();
  const filtersApplied = { search: search || null };

  const conditions = ['fr.company_id = $1'];
  const params: unknown[] = [companyId];
  let p = 2;
  if (search) {
    conditions.push(`(fi.name ILIKE $${p} OR COALESCE(fc.name_ar,'') ILIKE $${p} OR COALESCE(fc.color_code,'') ILIKE $${p})`);
    params.push(`%${search}%`);
    p++;
  }
  const where = conditions.join(' AND ');

  const dataQ = await pool.query(
    `SELECT fi.name AS item_name,
            COALESCE(fc.name_ar, fc.name_tr, '') AS color_name,
            fc.color_code,
            COUNT(fr.id)::int AS rolls_count,
            COALESCE(SUM(fr.length_m), 0)::numeric AS total_length_m,
            COALESCE(SUM(COALESCE(fr.actual_weight_kg, fr.calculated_weight_kg, 0)), 0)::numeric AS total_weight_kg,
            COUNT(DISTINCT fr.warehouse_id)::int AS warehouses_count
     FROM fabric_rolls fr
     JOIN fabric_items fi ON fi.id = fr.item_id AND fi.company_id = fr.company_id
     LEFT JOIN fabric_colors fc ON fc.id = fr.color_id
     WHERE ${where}
     GROUP BY fi.id, fi.name, fc.id, fc.name_ar, fc.name_tr, fc.color_code
     ORDER BY fi.name, color_name
     LIMIT 500`,
    params,
  );

  const rows = dataQ.rows as Record<string, unknown>[];

  return {
    title: 'الأتواب حسب الخامة واللون',
    generatedAt: nowIso(),
    filtersApplied,
    columns: [
      { key: 'item_name', label: 'الخامة', type: 'text' },
      { key: 'color_name', label: 'اللون', type: 'text' },
      { key: 'color_code', label: 'كود اللون', type: 'text' },
      { key: 'rolls_count', label: 'عدد الأتواب', type: 'number' },
      { key: 'total_length_m', label: 'إجمالي الأمتار', type: 'number' },
      { key: 'total_weight_kg', label: 'إجمالي الوزن', type: 'number' },
      { key: 'warehouses_count', label: 'عدد المستودعات', type: 'number' },
    ],
    rows,
    totals: { groups: rows.length },
  };
}

export async function reportImportBatches(
  companyId: string,
  q: Record<string, string | undefined>,
): Promise<UnifiedReportPayload> {
  const pool = getPool();
  const { page, pageSize, offset } = pageParams(q);
  const status = q.status?.trim();
  const supplierId = q.supplierId?.trim();
  const dateFrom = q.dateFrom?.trim();
  const dateTo = q.dateTo?.trim();

  const filtersApplied: Record<string, unknown> = {
    status: status || null,
    supplierId: supplierId || null,
    dateFrom: dateFrom || null,
    dateTo: dateTo || null,
    page,
    pageSize,
  };

  const conditions = ['b.company_id = $1'];
  const params: unknown[] = [companyId];
  let p = 2;
  if (status) {
    conditions.push(`b.status = $${p}`);
    params.push(status);
    p++;
  }
  if (supplierId) {
    conditions.push(`b.supplier_id = $${p}`);
    params.push(supplierId);
    p++;
  }
  if (dateFrom) {
    conditions.push(`b.created_at::date >= $${p}::date`);
    params.push(dateFrom);
    p++;
  }
  if (dateTo) {
    conditions.push(`b.created_at::date <= $${p}::date`);
    params.push(dateTo);
    p++;
  }
  const where = conditions.join(' AND ');

  const countQ = await pool.query<{ c: string }>(
    `SELECT COUNT(*)::int AS c FROM purchase_import_batches b WHERE ${where}`,
    params,
  );

  const dataQ = await pool.query(
    `SELECT b.id::text AS batch_id,
            b.file_name AS original_filename,
            b.status,
            b.row_count AS rows_count,
            b.valid_count AS accepted_count,
            b.error_count AS rejected_count,
            b.created_roll_count AS created_rolls_count,
            b.created_at,
            b.confirmed_at,
            s.name AS supplier_name
     FROM purchase_import_batches b
     LEFT JOIN suppliers s ON s.id = b.supplier_id AND s.company_id = b.company_id
     WHERE ${where}
     ORDER BY b.created_at DESC
     LIMIT $${p} OFFSET $${p + 1}`,
    [...params, pageSize, offset],
  );

  return {
    title: 'سجل دفعات استيراد Excel',
    generatedAt: nowIso(),
    filtersApplied,
    columns: [
      { key: 'batch_id', label: 'معرف الدفعة', type: 'text' },
      { key: 'original_filename', label: 'اسم الملف', type: 'text' },
      { key: 'supplier_name', label: 'المورد', type: 'text' },
      { key: 'status', label: 'الحالة', type: 'text' },
      { key: 'rows_count', label: 'صفوف', type: 'number' },
      { key: 'accepted_count', label: 'صالحة', type: 'number' },
      { key: 'rejected_count', label: 'أخطاء', type: 'number' },
      { key: 'created_rolls_count', label: 'أتواب مُنشأة', type: 'number' },
      { key: 'created_at', label: 'تاريخ الإنشاء', type: 'date' },
      { key: 'confirmed_at', label: 'تاريخ التأكيد', type: 'date' },
    ],
    rows: dataQ.rows as Record<string, unknown>[],
    meta: { page, pageSize, total: parseInt(countQ.rows[0].c, 10) },
  };
}

export async function reportImportRows(
  companyId: string,
  q: Record<string, string | undefined>,
): Promise<UnifiedReportPayload> {
  const pool = getPool();
  const { page, pageSize, offset } = pageParams(q);
  const batchId = q.batchId?.trim();
  const status = q.status?.trim();
  const search = q.search?.trim();

  if (!batchId) {
    return {
      title: 'صفوف دفعة الاستيراد',
      generatedAt: nowIso(),
      filtersApplied: { batchId: null, status: status || null, search: search || null },
      columns: [],
      rows: [],
      summaryCards: [{ label: 'تنبيه', value: 'اختر دفعة (batchId) من الفلاتر', hint: 'مرّر batchId في رابط التقرير أو من الواجهة' }],
      meta: { page: 1, pageSize, total: 0 },
    };
  }

  const filtersApplied: Record<string, unknown> = {
    batchId,
    status: status || null,
    search: search || null,
    page,
    pageSize,
  };

  const batchCheck = await pool.query(
    `SELECT id FROM purchase_import_batches WHERE id = $1 AND company_id = $2`,
    [batchId, companyId],
  );
  if (!batchCheck.rows.length) {
    return {
      title: 'صفوف دفعة الاستيراد',
      generatedAt: nowIso(),
      filtersApplied,
      columns: [],
      rows: [],
      summaryCards: [{ label: 'خطأ', value: 'الدفعة غير موجودة' }],
      meta: { total: 0 },
    };
  }

  const conditions = ['r.company_id = $1', 'r.batch_id = $2'];
  const params: unknown[] = [companyId, batchId];
  let p = 3;
  if (status) {
    conditions.push(`r.status = $${p}`);
    params.push(status);
    p++;
  }
  if (search) {
    conditions.push(`(r.normalized_data::text ILIKE $${p} OR r.errors::text ILIKE $${p})`);
    params.push(`%${search}%`);
    p++;
  }
  const where = conditions.join(' AND ');

  const countQ = await pool.query<{ c: string }>(
    `SELECT COUNT(*)::int AS c FROM purchase_import_rows r WHERE ${where}`,
    params,
  );

  const dataQ = await pool.query(
    `SELECT r.row_no,
            fr.barcode,
            fi.name AS item_name,
            COALESCE(fc.name_ar, fc.name_tr, '') AS color_name,
            (r.normalized_data->>'width_cm')::numeric AS width_cm,
            (r.normalized_data->>'gsm')::numeric AS gsm,
            (r.normalized_data->>'length_m')::numeric AS length_m,
            (r.normalized_data->>'calculated_weight_kg')::numeric AS calculated_weight_kg,
            r.status,
            r.errors::text AS error_json,
            r.warnings::text AS warnings_json
     FROM purchase_import_rows r
     LEFT JOIN fabric_rolls fr ON fr.id = r.created_roll_id
     LEFT JOIN fabric_items fi ON fi.id = r.matched_item_id
     LEFT JOIN fabric_colors fc ON fc.id = r.matched_color_id
     WHERE ${where}
     ORDER BY r.row_no
     LIMIT $${p} OFFSET $${p + 1}`,
    [...params, pageSize, offset],
  );

  const rows = (dataQ.rows as Record<string, unknown>[]).map((row) => ({
    ...row,
    error_message:
      (row.error_json as string)?.length > 200
        ? (row.error_json as string).slice(0, 200) + '…'
        : row.error_json,
  }));

  return {
    title: 'صفوف دفعة الاستيراد / أخطاء',
    generatedAt: nowIso(),
    filtersApplied,
    columns: [
      { key: 'row_no', label: 'رقم الصف', type: 'number' },
      { key: 'barcode', label: 'الباركود', type: 'text' },
      { key: 'item_name', label: 'الخامة', type: 'text' },
      { key: 'color_name', label: 'اللون', type: 'text' },
      { key: 'width_cm', label: 'عرض', type: 'number' },
      { key: 'gsm', label: 'GSM', type: 'number' },
      { key: 'length_m', label: 'طول', type: 'number' },
      { key: 'calculated_weight_kg', label: 'وزن', type: 'number' },
      { key: 'status', label: 'الحالة', type: 'text' },
      { key: 'error_message', label: 'أخطاء', type: 'text' },
    ],
    rows,
    meta: { page, pageSize, total: parseInt(countQ.rows[0].c, 10) },
  };
}

export async function reportCashboxes(companyId: string): Promise<UnifiedReportPayload> {
  const pool = getPool();
  const dataQ = await pool.query(
    `SELECT c.code, c.name, c.currency_code, c.opening_balance, c.current_balance, c.is_default, c.is_active
     FROM cashboxes c
     WHERE c.company_id = $1
     ORDER BY c.is_default DESC, c.name`,
    [companyId],
  );

  const rows = dataQ.rows as Record<string, unknown>[];
  const byCurrency = new Map<string, number>();
  for (const r of rows) {
    if (r.is_active === false) continue;
    const cur = String(r.currency_code || 'USD');
    const bal = parseFloat(String(r.current_balance)) || 0;
    byCurrency.set(cur, (byCurrency.get(cur) || 0) + bal);
  }
  const totals: Record<string, string> = {};
  for (const [k, v] of byCurrency) {
    totals[`balance_${k}`] = v.toFixed(2);
  }

  return {
    title: 'أرصدة الصناديق',
    generatedAt: nowIso(),
    filtersApplied: {},
    columns: [
      { key: 'code', label: 'الرمز', type: 'text' },
      { key: 'name', label: 'الاسم', type: 'text' },
      { key: 'currency_code', label: 'العملة', type: 'text' },
      { key: 'opening_balance', label: 'رصيد افتتاحي', type: 'currency' },
      { key: 'current_balance', label: 'الرصيد الحالي', type: 'currency' },
      { key: 'is_default', label: 'افتراضي', type: 'text' },
      { key: 'is_active', label: 'نشط', type: 'text' },
    ],
    rows,
    totals,
  };
}

export async function reportCashboxMovements(
  companyId: string,
  q: Record<string, string | undefined>,
): Promise<UnifiedReportPayload> {
  const pool = getPool();
  const { page, pageSize, offset } = pageParams(q);
  const cashboxId = q.cashboxId?.trim();
  const movementType = q.movementType?.trim();
  const direction = q.direction?.trim();
  const dateFrom = q.dateFrom?.trim();
  const dateTo = q.dateTo?.trim();
  const search = q.search?.trim();

  const filtersApplied: Record<string, unknown> = {
    cashboxId: cashboxId || null,
    movementType: movementType || null,
    direction: direction || null,
    dateFrom: dateFrom || null,
    dateTo: dateTo || null,
    search: search || null,
    page,
    pageSize,
  };

  const conditions = ['m.company_id = $1'];
  const params: unknown[] = [companyId];
  let p = 2;
  if (cashboxId) {
    conditions.push(`m.cashbox_id = $${p}`);
    params.push(cashboxId);
    p++;
  }
  if (movementType) {
    conditions.push(`m.movement_type = $${p}`);
    params.push(movementType);
    p++;
  }
  if (direction) {
    conditions.push(`m.direction = $${p}`);
    params.push(direction);
    p++;
  }
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
  if (search) {
    conditions.push(`(m.movement_no ILIKE $${p} OR m.description ILIKE $${p} OR COALESCE(m.source_no,'') ILIKE $${p})`);
    params.push(`%${search}%`);
    p++;
  }
  const where = conditions.join(' AND ');

  const countQ = await pool.query<{ c: string }>(
    `SELECT COUNT(*)::int AS c FROM cashbox_movements m WHERE ${where}`,
    params,
  );

  const dataQ = await pool.query(
    `SELECT m.movement_no,
            m.movement_at,
            c.name AS cashbox_name,
            m.movement_type,
            m.direction,
            m.amount,
            m.currency_code,
            m.balance_after,
            m.source_type,
            m.source_no,
            m.description
     FROM cashbox_movements m
     JOIN cashboxes c ON c.id = m.cashbox_id AND c.company_id = m.company_id
     WHERE ${where}
     ORDER BY m.movement_at DESC
     LIMIT $${p} OFFSET $${p + 1}`,
    [...params, pageSize, offset],
  );

  return {
    title: 'حركة الصندوق',
    generatedAt: nowIso(),
    filtersApplied,
    columns: [
      { key: 'movement_no', label: 'رقم الحركة', type: 'text' },
      { key: 'movement_at', label: 'التاريخ', type: 'date' },
      { key: 'cashbox_name', label: 'الصندوق', type: 'text' },
      { key: 'movement_type', label: 'النوع', type: 'text' },
      { key: 'direction', label: 'الاتجاه', type: 'text' },
      { key: 'amount', label: 'المبلغ', type: 'currency' },
      { key: 'currency_code', label: 'العملة', type: 'text' },
      { key: 'balance_after', label: 'الرصيد بعد', type: 'currency' },
      { key: 'source_type', label: 'مصدر', type: 'text' },
      { key: 'source_no', label: 'رقم المصدر', type: 'text' },
      { key: 'description', label: 'الوصف', type: 'text' },
    ],
    rows: dataQ.rows as Record<string, unknown>[],
    meta: { page, pageSize, total: parseInt(countQ.rows[0].c, 10) },
  };
}

export async function reportVouchers(
  companyId: string,
  q: Record<string, string | undefined>,
): Promise<UnifiedReportPayload> {
  const pool = getPool();
  const { page, pageSize, offset } = pageParams(q);
  const voucherType = q.voucherType?.trim();
  const status = q.status?.trim();
  const cashboxId = q.cashboxId?.trim();
  const partyType = q.partyType?.trim();
  const search = q.search?.trim();
  const dateFrom = q.dateFrom?.trim();
  const dateTo = q.dateTo?.trim();

  const filtersApplied: Record<string, unknown> = {
    voucherType: voucherType || null,
    status: status || null,
    cashboxId: cashboxId || null,
    partyType: partyType || null,
    search: search || null,
    dateFrom: dateFrom || null,
    dateTo: dateTo || null,
    page,
    pageSize,
  };

  const conditions = ['v.company_id = $1'];
  const params: unknown[] = [companyId];
  let p = 2;
  if (voucherType) {
    conditions.push(`v.voucher_type = $${p}`);
    params.push(voucherType);
    p++;
  }
  if (status) {
    conditions.push(`v.status = $${p}`);
    params.push(status);
    p++;
  }
  if (cashboxId) {
    conditions.push(`v.cashbox_id = $${p}`);
    params.push(cashboxId);
    p++;
  }
  if (partyType) {
    conditions.push(`v.party_type = $${p}`);
    params.push(partyType);
    p++;
  }
  if (dateFrom) {
    conditions.push(`v.voucher_date >= $${p}::date`);
    params.push(dateFrom);
    p++;
  }
  if (dateTo) {
    conditions.push(`v.voucher_date <= $${p}::date`);
    params.push(dateTo);
    p++;
  }
  if (search) {
    conditions.push(`(v.voucher_no ILIKE $${p} OR v.party_name ILIKE $${p} OR COALESCE(v.description,'') ILIKE $${p})`);
    params.push(`%${search}%`);
    p++;
  }
  const where = conditions.join(' AND ');

  const sumQ = await pool.query(
    `SELECT
       COALESCE(SUM(v.amount) FILTER (WHERE v.status = 'CONFIRMED' AND v.voucher_type = 'RECEIPT'), 0)::numeric AS tr,
       COALESCE(SUM(v.amount) FILTER (WHERE v.status = 'CONFIRMED' AND v.voucher_type = 'PAYMENT'), 0)::numeric AS tp
     FROM vouchers v WHERE ${where}`,
    params,
  );

  const countQ = await pool.query<{ c: string }>(
    `SELECT COUNT(*)::int AS c FROM vouchers v WHERE ${where}`,
    params,
  );

  const dataQ = await pool.query(
    `SELECT v.voucher_no,
            v.voucher_date,
            v.voucher_type,
            v.status,
            c.name AS cashbox_name,
            v.party_type,
            v.party_name,
            v.amount,
            v.currency_code,
            v.payment_method,
            v.description
     FROM vouchers v
     LEFT JOIN cashboxes c ON c.id = v.cashbox_id AND c.company_id = v.company_id
     WHERE ${where}
     ORDER BY v.voucher_date DESC, v.created_at DESC
     LIMIT $${p} OFFSET $${p + 1}`,
    [...params, pageSize, offset],
  );

  const tr = parseFloat(sumQ.rows[0].tr);
  const tp = parseFloat(sumQ.rows[0].tp);

  return {
    title: 'سجل السندات',
    generatedAt: nowIso(),
    filtersApplied,
    columns: [
      { key: 'voucher_no', label: 'رقم السند', type: 'text' },
      { key: 'voucher_date', label: 'التاريخ', type: 'date' },
      { key: 'voucher_type', label: 'النوع', type: 'text' },
      { key: 'status', label: 'الحالة', type: 'text' },
      { key: 'cashbox_name', label: 'الصندوق', type: 'text' },
      { key: 'party_type', label: 'نوع الطرف', type: 'text' },
      { key: 'party_name', label: 'الطرف', type: 'text' },
      { key: 'amount', label: 'المبلغ', type: 'currency' },
      { key: 'currency_code', label: 'العملة', type: 'text' },
      { key: 'payment_method', label: 'طريقة الدفع', type: 'text' },
      { key: 'description', label: 'الوصف', type: 'text' },
    ],
    rows: dataQ.rows as Record<string, unknown>[],
    totals: {
      total_receipts_confirmed: tr.toFixed(2),
      total_payments_confirmed: tp.toFixed(2),
      net_confirmed: (tr - tp).toFixed(2),
    },
    meta: { page, pageSize, total: parseInt(countQ.rows[0].c, 10) },
  };
}

export async function reportPartyActivity(
  companyId: string,
  q: Record<string, string | undefined>,
): Promise<UnifiedReportPayload> {
  const pool = getPool();
  const { page, pageSize, offset } = pageParams(q);
  const partyType = q.partyType?.trim();
  const partyId = q.partyId?.trim();
  const activityType = q.activityType?.trim();
  const search = q.search?.trim();
  const dateFrom = q.dateFrom?.trim();
  const dateTo = q.dateTo?.trim();

  const filtersApplied: Record<string, unknown> = {
    partyType: partyType || null,
    partyId: partyId || null,
    activityType: activityType || null,
    search: search || null,
    dateFrom: dateFrom || null,
    dateTo: dateTo || null,
    page,
    pageSize,
  };

  const conditions = ['l.company_id = $1'];
  const params: unknown[] = [companyId];
  let p = 2;
  if (partyType) {
    conditions.push(`l.party_type = $${p}`);
    params.push(partyType);
    p++;
  }
  if (partyId) {
    conditions.push(`l.party_id = $${p}`);
    params.push(partyId);
    p++;
  }
  if (activityType) {
    conditions.push(`l.activity_type = $${p}`);
    params.push(activityType);
    p++;
  }
  if (dateFrom) {
    conditions.push(`l.activity_at::date >= $${p}::date`);
    params.push(dateFrom);
    p++;
  }
  if (dateTo) {
    conditions.push(`l.activity_at::date <= $${p}::date`);
    params.push(dateTo);
    p++;
  }
  if (search) {
    conditions.push(`(l.party_name ILIKE $${p} OR l.description ILIKE $${p} OR COALESCE(l.reference_no,'') ILIKE $${p})`);
    params.push(`%${search}%`);
    p++;
  }
  const where = conditions.join(' AND ');

  const countQ = await pool.query<{ c: string }>(
    `SELECT COUNT(*)::int AS c FROM party_activity_logs l WHERE ${where}`,
    params,
  );

  const dataQ = await pool.query(
    `SELECT l.activity_at,
            l.party_type,
            l.party_name,
            l.activity_type,
            l.reference_type,
            l.reference_no,
            l.amount,
            l.currency_code,
            l.description
     FROM party_activity_logs l
     WHERE ${where}
     ORDER BY l.activity_at DESC
     LIMIT $${p} OFFSET $${p + 1}`,
    [...params, pageSize, offset],
  );

  return {
    title: 'نشاط العملاء والموردين',
    generatedAt: nowIso(),
    filtersApplied,
    columns: [
      { key: 'activity_at', label: 'التاريخ', type: 'date' },
      { key: 'party_type', label: 'نوع الطرف', type: 'text' },
      { key: 'party_name', label: 'الاسم', type: 'text' },
      { key: 'activity_type', label: 'نوع النشاط', type: 'text' },
      { key: 'reference_type', label: 'مرجع', type: 'text' },
      { key: 'reference_no', label: 'رقم المرجع', type: 'text' },
      { key: 'amount', label: 'مبلغ', type: 'currency' },
      { key: 'currency_code', label: 'عملة', type: 'text' },
      { key: 'description', label: 'الوصف', type: 'text' },
    ],
    rows: dataQ.rows as Record<string, unknown>[],
    meta: { page, pageSize, total: parseInt(countQ.rows[0].c, 10) },
  };
}

export async function reportPrintJobs(
  companyId: string,
  q: Record<string, string | undefined>,
): Promise<UnifiedReportPayload> {
  const pool = getPool();
  const { page, pageSize, offset } = pageParams(q);
  const status = q.status?.trim();
  const dateFrom = q.dateFrom?.trim();
  const dateTo = q.dateTo?.trim();

  const filtersApplied: Record<string, unknown> = {
    status: status || null,
    dateFrom: dateFrom || null,
    dateTo: dateTo || null,
    page,
    pageSize,
  };

  const conditions = ['j.company_id = $1'];
  const params: unknown[] = [companyId];
  let p = 2;
  if (status) {
    conditions.push(`j.status = $${p}`);
    params.push(status);
    p++;
  }
  if (dateFrom) {
    conditions.push(`j.created_at::date >= $${p}::date`);
    params.push(dateFrom);
    p++;
  }
  if (dateTo) {
    conditions.push(`j.created_at::date <= $${p}::date`);
    params.push(dateTo);
    p++;
  }
  const where = conditions.join(' AND ');

  const countQ = await pool.query<{ c: string }>(
    `SELECT COUNT(*)::int AS c FROM print_jobs j WHERE ${where}`,
    params,
  );

  const dataQ2 = await pool.query(
    `SELECT j.created_at,
            j.id::text AS job_id,
            j.status,
            t.name AS template_name,
            j.roll_count AS labels_count,
            j.source_type,
            j.source_id::text AS source_id,
            j.printed_at,
            j.error_message
     FROM print_jobs j
     LEFT JOIN label_templates t ON t.id = j.template_id AND t.company_id = j.company_id
     WHERE ${where}
     ORDER BY j.created_at DESC
     LIMIT $${p} OFFSET $${p + 1}`,
    [...params, pageSize, offset],
  );

  const rows = (dataQ2.rows as Record<string, unknown>[]).map((r) => ({
    ...r,
    job_ref: shortId(String(r.job_id)),
  }));

  return {
    title: 'سجل مهام الطباعة',
    generatedAt: nowIso(),
    filtersApplied,
    columns: [
      { key: 'created_at', label: 'التاريخ', type: 'date' },
      { key: 'job_ref', label: 'مرجع', type: 'text' },
      { key: 'status', label: 'الحالة', type: 'text' },
      { key: 'template_name', label: 'القالب', type: 'text' },
      { key: 'labels_count', label: 'عدد اللصاقات', type: 'number' },
      { key: 'source_type', label: 'مصدر', type: 'text' },
      { key: 'source_id', label: 'معرف المصدر', type: 'text' },
      { key: 'printed_at', label: 'تاريخ الطباعة', type: 'date' },
      { key: 'error_message', label: 'خطأ', type: 'text' },
    ],
    rows,
    meta: { page, pageSize, total: parseInt(countQ.rows[0].c, 10) },
  };
}

export async function reportPayrollSummary(companyId: string): Promise<UnifiedReportPayload> {
  const pool = getPool();
  const emp = await pool.query(
    `SELECT COUNT(*) FILTER (WHERE is_active)::int AS active,
            COALESCE(SUM(base_salary) FILTER (WHERE is_active), 0)::numeric AS sum_base
     FROM payroll_employees WHERE company_id = $1`,
    [companyId],
  );
  const runs = await pool.query(
    `SELECT status, COUNT(*)::int AS n,
            COALESCE(SUM(total_net) FILTER (WHERE status IN ('CONFIRMED','PAID')), 0)::numeric AS net_sum
     FROM payroll_runs WHERE company_id = $1
     GROUP BY status`,
    [companyId],
  );

  const runRows = await pool.query(
    `SELECT payroll_no, period_month, period_year, status, total_net, currency_code, created_at
     FROM payroll_runs WHERE company_id = $1
     ORDER BY period_year DESC, period_month DESC, created_at DESC
     LIMIT 100`,
    [companyId],
  );

  let confirmedRuns = 0;
  let paidRuns = 0;
  for (const r of runs.rows as { status: string; n: string }[]) {
    if (r.status === 'CONFIRMED') confirmedRuns += parseInt(r.n, 10);
    if (r.status === 'PAID') paidRuns += parseInt(r.n, 10);
  }

  return {
    title: 'ملخص الرواتب والموظفين',
    generatedAt: nowIso(),
    filtersApplied: {},
    columns: [
      { key: 'payroll_no', label: 'رقم المسير', type: 'text' },
      { key: 'period_month', label: 'الشهر', type: 'number' },
      { key: 'period_year', label: 'السنة', type: 'number' },
      { key: 'status', label: 'الحالة', type: 'text' },
      { key: 'total_net', label: 'صافي المسير', type: 'currency' },
      { key: 'currency_code', label: 'العملة', type: 'text' },
      { key: 'created_at', label: 'تاريخ الإنشاء', type: 'date' },
    ],
    rows: runRows.rows as Record<string, unknown>[],
    summaryCards: [
      { label: 'موظفون نشطون', value: emp.rows[0].active },
      { label: 'مجموع الرواتب الأساسية (نشط)', value: String(emp.rows[0].sum_base) },
      { label: 'مسيرات مؤكدة', value: confirmedRuns },
      { label: 'مسيرات مدفوعة', value: paidRuns },
    ],
  };
}
