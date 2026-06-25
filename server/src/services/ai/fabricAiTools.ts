import { getPool } from '../../db/pool.js';
import { getCustomerStatement } from '../partyStatementService.js';

const MAX_ROWS = 25;

function clampLimit(n: unknown, max = MAX_ROWS): number {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 1) return Math.min(10, max);
  return Math.min(Math.floor(v), max);
}

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

export async function searchFabricProducts(companyId: string, query: string) {
  const q = String(query || '').trim();
  if (!q) return { items: [], message: 'يرجى إدخال نص للبحث.' };
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT fi.id, fi.name, fi.internal_code, fi.supplier_code, fi.default_selling_price,
            fc.name AS category_name
     FROM fabric_items fi
     LEFT JOIN fabric_categories fc ON fc.id = fi.category_id AND fc.company_id = fi.company_id
     WHERE fi.company_id = $1
       AND (fi.name ILIKE $2 OR fi.internal_code ILIKE $2 OR COALESCE(fi.supplier_code, '') ILIKE $2)
     ORDER BY fi.name
     LIMIT $3`,
    [companyId, `%${q}%`, MAX_ROWS],
  );
  return {
    items: rows.map((r) => ({
      id: r.id,
      name: r.name,
      materialCode: r.internal_code || r.supplier_code,
      category: r.category_name,
      defaultSellingPrice: Number(r.default_selling_price ?? 0),
    })),
    count: rows.length,
  };
}

export async function getInventorySummary(
  companyId: string,
  filters: { warehouseId?: string; categoryCode?: string } = {},
) {
  const pool = getPool();
  const conds = ['fr.company_id = $1', "fr.status IN ('AVAILABLE', 'RESERVED')"];
  const params: unknown[] = [companyId];
  let p = 2;
  if (filters.warehouseId && isUuid(filters.warehouseId)) {
    conds.push(`fr.warehouse_id = $${p}`);
    params.push(filters.warehouseId);
    p++;
  }
  if (filters.categoryCode?.trim()) {
    conds.push(`(fc.code ILIKE $${p} OR fc.name ILIKE $${p})`);
    params.push(`%${filters.categoryCode.trim()}%`);
    p++;
  }
  const { rows } = await pool.query(
    `SELECT
       COUNT(*)::int AS roll_count,
       COALESCE(SUM(fr.length_m), 0)::numeric AS total_meters,
       COUNT(DISTINCT fi.id)::int AS fabric_types
     FROM fabric_rolls fr
     LEFT JOIN fabric_items fi ON fi.id = fr.item_id AND fi.company_id = fr.company_id
     LEFT JOIN fabric_categories fc ON fc.id = fi.category_id AND fc.company_id = fi.company_id
     WHERE ${conds.join(' AND ')}`,
    params,
  );
  const row = rows[0];
  return {
    rollCount: Number(row?.roll_count ?? 0),
    totalMeters: Number(row?.total_meters ?? 0),
    fabricTypes: Number(row?.fabric_types ?? 0),
    filters,
  };
}

export async function getLowStockFabrics(companyId: string, thresholdMeters = 50) {
  const threshold = Math.max(1, Number(thresholdMeters) || 50);
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT fi.name, fi.internal_code,
            COUNT(fr.id)::int AS roll_count,
            COALESCE(SUM(fr.length_m), 0)::numeric AS total_meters
     FROM fabric_rolls fr
     JOIN fabric_items fi ON fi.id = fr.item_id AND fi.company_id = fr.company_id
     WHERE fr.company_id = $1
       AND fr.status IN ('AVAILABLE', 'RESERVED')
     GROUP BY fi.id, fi.name, fi.internal_code
     HAVING COALESCE(SUM(fr.length_m), 0) < $2
     ORDER BY total_meters ASC
     LIMIT $3`,
    [companyId, threshold, MAX_ROWS],
  );
  return {
    thresholdMeters: threshold,
    fabrics: rows.map((r) => ({
      name: r.name,
      materialCode: r.internal_code,
      rollCount: Number(r.roll_count),
      totalMeters: Number(r.total_meters),
    })),
  };
}

export async function getFabricStockByNameOrCode(companyId: string, nameOrCode: string) {
  const q = String(nameOrCode || '').trim();
  if (!q) return { found: false, message: 'يرجى تحديد اسم أو كود القماش.' };
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT fi.id, fi.name, fi.internal_code,
            COUNT(fr.id)::int AS roll_count,
            COALESCE(SUM(fr.length_m), 0)::numeric AS total_meters
     FROM fabric_items fi
     LEFT JOIN fabric_rolls fr ON fr.item_id = fi.id
       AND fr.company_id = fi.company_id
       AND fr.status IN ('AVAILABLE', 'RESERVED')
     WHERE fi.company_id = $1
       AND (fi.name ILIKE $2 OR fi.internal_code ILIKE $2 OR COALESCE(fi.supplier_code, '') ILIKE $2)
     GROUP BY fi.id, fi.name, fi.internal_code
     ORDER BY total_meters DESC
     LIMIT $3`,
    [companyId, `%${q}%`, MAX_ROWS],
  );
  if (!rows.length) return { found: false, query: q };
  return {
    found: true,
    query: q,
    fabrics: rows.map((r) => ({
      name: r.name,
      materialCode: r.internal_code,
      rollCount: Number(r.roll_count),
      totalMeters: Number(r.total_meters),
    })),
  };
}

async function resolveCustomer(companyId: string, customerNameOrId: string) {
  const q = String(customerNameOrId || '').trim();
  if (!q) return null;
  const pool = getPool();
  if (isUuid(q)) {
    const { rows } = await pool.query(
      `SELECT id, name FROM customers WHERE company_id = $1 AND id = $2 AND is_active = true LIMIT 1`,
      [companyId, q],
    );
    return rows[0] ?? null;
  }
  const { rows } = await pool.query(
    `SELECT id, name FROM customers
     WHERE company_id = $1 AND is_active = true AND name ILIKE $2
     ORDER BY name LIMIT 2`,
    [companyId, `%${q}%`],
  );
  if (rows.length === 1) return rows[0];
  if (rows.length > 1) return { ambiguous: true, matches: rows };
  return null;
}

export async function getCustomerBalance(companyId: string, customerNameOrId: string) {
  const resolved = await resolveCustomer(companyId, customerNameOrId);
  if (!resolved) {
    return { found: false, message: 'لم يتم العثور على العميل.' };
  }
  if ('ambiguous' in resolved && resolved.ambiguous) {
    return {
      found: false,
      ambiguous: true,
      matches: resolved.matches.map((m: { id: string; name: string }) => ({ id: m.id, name: m.name })),
    };
  }
  const customer = resolved as { id: string; name: string };
  const stmt = await getCustomerStatement(companyId, customer.id, {});
  return {
    found: true,
    customerId: customer.id,
    customerName: customer.name,
    closingBalance: stmt.totals.closingBalance,
    totalDebit: stmt.totals.debit,
    totalCredit: stmt.totals.credit,
    currencyNote: 'الرصيد حسب كشف حساب العميل في النظام',
  };
}

export async function searchCustomers(companyId: string, query: string) {
  const q = String(query || '').trim();
  if (!q) return { customers: [] };
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, name, phone, email
     FROM customers
     WHERE company_id = $1 AND is_active = true
       AND (name ILIKE $2 OR phone ILIKE $2 OR email ILIKE $2)
     ORDER BY name
     LIMIT $3`,
    [companyId, `%${q}%`, MAX_ROWS],
  );
  return {
    customers: rows.map((r) => ({
      id: r.id,
      name: r.name,
      phone: r.phone,
      email: r.email,
    })),
  };
}

export async function getContainerSummary(companyId: string, containerNoOrId: string) {
  const q = String(containerNoOrId || '').trim();
  if (!q) return { found: false };
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT fr.container_no,
            COUNT(*)::int AS roll_count,
            COALESCE(SUM(fr.length_m), 0)::numeric AS total_meters,
            MIN(fr.created_at) AS first_received,
            MAX(fr.created_at) AS last_received
     FROM fabric_rolls fr
     WHERE fr.company_id = $1 AND fr.container_no ILIKE $2
     GROUP BY fr.container_no
     LIMIT 1`,
    [companyId, `%${q}%`],
  );
  if (!rows.length) return { found: false, query: q };
  const r = rows[0];
  return {
    found: true,
    containerNo: r.container_no,
    rollCount: Number(r.roll_count),
    totalMeters: Number(r.total_meters),
    firstReceived: r.first_received,
    lastReceived: r.last_received,
  };
}

export async function getRecentContainers(companyId: string, limit = 5) {
  const lim = clampLimit(limit, 10);
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT fr.container_no,
            COUNT(*)::int AS roll_count,
            COALESCE(SUM(fr.length_m), 0)::numeric AS total_meters,
            MAX(fr.created_at) AS last_received
     FROM fabric_rolls fr
     WHERE fr.company_id = $1 AND fr.container_no IS NOT NULL AND TRIM(fr.container_no) <> ''
     GROUP BY fr.container_no
     ORDER BY last_received DESC NULLS LAST
     LIMIT $2`,
    [companyId, lim],
  );
  return {
    containers: rows.map((r) => ({
      containerNo: r.container_no,
      rollCount: Number(r.roll_count),
      totalMeters: Number(r.total_meters),
      lastReceived: r.last_received,
    })),
  };
}

export async function getSalesSummaryByDateRange(companyId: string, from: string, to: string) {
  const pool = getPool();
  const fromDate = from?.trim() || '1970-01-01';
  const toDate = to?.trim() || new Date().toISOString().slice(0, 10);
  const { rows } = await pool.query(
    `SELECT
       COUNT(*)::int AS invoice_count,
       COALESCE(SUM(si.total_amount), 0)::numeric AS total_sales,
       COALESCE(SUM(si.paid_amount), 0)::numeric AS total_paid
     FROM sales_invoices si
     WHERE si.company_id = $1
       AND si.invoice_date >= $2::date
       AND si.invoice_date <= $3::date
       AND si.document_status = 'CONFIRMED'`,
    [companyId, fromDate, toDate],
  );
  const r = rows[0];
  return {
    from: fromDate,
    to: toDate,
    invoiceCount: Number(r?.invoice_count ?? 0),
    totalSales: Number(r?.total_sales ?? 0),
    totalPaid: Number(r?.total_paid ?? 0),
  };
}

export async function getTopSellingFabrics(companyId: string, from: string, to: string) {
  const pool = getPool();
  const fromDate = from?.trim() || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  const toDate = to?.trim() || new Date().toISOString().slice(0, 10);
  const { rows } = await pool.query(
    `SELECT
       COALESCE(fi.name, sil.description, 'غير محدد') AS fabric_name,
       COALESCE(fi.internal_code, '') AS material_code,
       COALESCE(SUM(sil.quantity), 0)::numeric AS total_length,
       COALESCE(SUM(sil.line_total), 0)::numeric AS total_amount,
       COUNT(DISTINCT si.id)::int AS invoice_count
     FROM sales_invoice_lines sil
     JOIN sales_invoices si ON si.id = sil.invoice_id AND si.company_id = sil.company_id
     LEFT JOIN fabric_items fi ON fi.id = sil.fabric_item_id AND fi.company_id = sil.company_id
     WHERE sil.company_id = $1
       AND si.invoice_date >= $2::date
       AND si.invoice_date <= $3::date
       AND si.document_status = 'CONFIRMED'
     GROUP BY fabric_name, material_code
     ORDER BY total_length DESC
     LIMIT $4`,
    [companyId, fromDate, toDate, MAX_ROWS],
  );
  return {
    from: fromDate,
    to: toDate,
    fabrics: rows.map((r) => ({
      name: r.fabric_name,
      materialCode: r.material_code,
      totalLength: Number(r.total_length),
      totalAmount: Number(r.total_amount),
      invoiceCount: Number(r.invoice_count),
    })),
  };
}

export async function getSupplierSummary(companyId: string, supplierNameOrId: string) {
  const q = String(supplierNameOrId || '').trim();
  if (!q) return { found: false };
  const pool = getPool();
  let supplier: { id: string; name: string } | null = null;
  if (isUuid(q)) {
    const { rows } = await pool.query(
      `SELECT id, name FROM suppliers WHERE company_id = $1 AND id = $2 LIMIT 1`,
      [companyId, q],
    );
    supplier = rows[0] ?? null;
  } else {
    const { rows } = await pool.query(
      `SELECT id, name FROM suppliers WHERE company_id = $1 AND name ILIKE $2 ORDER BY name LIMIT 2`,
      [companyId, `%${q}%`],
    );
    if (rows.length === 1) supplier = rows[0];
    else if (rows.length > 1) {
      return { found: false, ambiguous: true, matches: rows };
    }
  }
  if (!supplier) return { found: false, query: q };

  const { rows: invRows } = await pool.query(
    `SELECT COUNT(*)::int AS invoice_count,
            COALESCE(SUM(total_amount), 0)::numeric AS total_purchases
     FROM purchase_invoices
     WHERE company_id = $1 AND supplier_id = $2 AND document_status = 'CONFIRMED'`,
    [companyId, supplier.id],
  );
  const inv = invRows[0];
  return {
    found: true,
    supplierId: supplier.id,
    supplierName: supplier.name,
    purchaseInvoiceCount: Number(inv?.invoice_count ?? 0),
    totalPurchases: Number(inv?.total_purchases ?? 0),
  };
}

const ORDER_STATUS_AR: Record<string, string> = {
  draft: 'مسودة',
  pending_supply: 'بانتظار التوريد',
  partial_ready: 'جاهز جزئياً',
  ready_pickup: 'جاهز للاستلام',
  completed: 'مكتمل',
  cancelled: 'ملغى',
};

export async function getChinaOrdersSummary(
  companyId: string,
  filters: { status?: string; customerId?: string } = {},
) {
  const pool = getPool();
  const conds = ['co.company_id = $1'];
  const params: unknown[] = [companyId];
  let p = 2;
  if (filters.status?.trim()) {
    conds.push(`co.status = $${p}`);
    params.push(filters.status.trim());
    p++;
  }
  if (filters.customerId && isUuid(filters.customerId)) {
    conds.push(`co.customer_id = $${p}`);
    params.push(filters.customerId);
    p++;
  }
  params.push(MAX_ROWS);
  const { rows } = await pool.query(
    `SELECT co.id, co.order_no, co.order_date, co.status, co.expected_date,
            c.name AS customer_name,
            (SELECT COUNT(*)::int FROM customer_order_lines col WHERE col.order_id = co.id) AS line_count
     FROM customer_orders co
     JOIN customers c ON c.id = co.customer_id
     WHERE ${conds.join(' AND ')}
     ORDER BY co.order_date DESC
     LIMIT $${p}`,
    params,
  );
  const { rows: statusRows } = await pool.query(
    `SELECT status, COUNT(*)::int AS cnt
     FROM customer_orders WHERE company_id = $1
     GROUP BY status`,
    [companyId],
  );
  return {
    orders: rows.map((r) => ({
      id: r.id,
      orderNo: r.order_no,
      orderDate: r.order_date,
      status: r.status,
      statusLabel: ORDER_STATUS_AR[r.status] || r.status,
      expectedDate: r.expected_date,
      customerName: r.customer_name,
      lineCount: Number(r.line_count),
    })),
    statusBreakdown: statusRows.map((s) => ({
      status: s.status,
      statusLabel: ORDER_STATUS_AR[s.status] || s.status,
      count: Number(s.cnt),
    })),
  };
}

export type FabricAiToolName =
  | 'searchFabricProducts'
  | 'getInventorySummary'
  | 'getLowStockFabrics'
  | 'getFabricStockByNameOrCode'
  | 'getCustomerBalance'
  | 'searchCustomers'
  | 'getContainerSummary'
  | 'getRecentContainers'
  | 'getSalesSummaryByDateRange'
  | 'getTopSellingFabrics'
  | 'getSupplierSummary'
  | 'getChinaOrdersSummary';

export const FABRIC_AI_TOOL_DEFINITIONS = [
  {
    type: 'function' as const,
    function: {
      name: 'searchFabricProducts',
      description: 'بحث عن أقمشة/خامات بالاسم أو الكود',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'نص البحث' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'getInventorySummary',
      description: 'ملخص المخزون الحالي (أتواب وأمتار)',
      parameters: {
        type: 'object',
        properties: {
          warehouseId: { type: 'string', description: 'معرف المستودع اختياري' },
          categoryCode: { type: 'string', description: 'كود التصنيف اختياري' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'getLowStockFabrics',
      description: 'أقمشة منخفضة المخزون',
      parameters: {
        type: 'object',
        properties: { thresholdMeters: { type: 'number', description: 'حد الأمتار' } },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'getFabricStockByNameOrCode',
      description: 'مخزون قماش محدد بالاسم أو الكود',
      parameters: {
        type: 'object',
        properties: { nameOrCode: { type: 'string' } },
        required: ['nameOrCode'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'getCustomerBalance',
      description: 'رصيد عميل (مدين/دائن) من كشف الحساب',
      parameters: {
        type: 'object',
        properties: { customerNameOrId: { type: 'string' } },
        required: ['customerNameOrId'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'searchCustomers',
      description: 'بحث عن عملاء',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'getContainerSummary',
      description: 'ملخص حاوية استيراد برقم الحاوية',
      parameters: {
        type: 'object',
        properties: { containerNoOrId: { type: 'string' } },
        required: ['containerNoOrId'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'getRecentContainers',
      description: 'آخر الحاويات المستلمة',
      parameters: {
        type: 'object',
        properties: { limit: { type: 'number' } },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'getSalesSummaryByDateRange',
      description: 'ملخص المبيعات بين تاريخين',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'YYYY-MM-DD' },
          to: { type: 'string', description: 'YYYY-MM-DD' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'getTopSellingFabrics',
      description: 'أكثر الأقمشة مبيعاً في فترة',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string' },
          to: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'getSupplierSummary',
      description: 'ملخص مورد ومشترياته',
      parameters: {
        type: 'object',
        properties: { supplierNameOrId: { type: 'string' } },
        required: ['supplierNameOrId'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'getChinaOrdersSummary',
      description: 'ملخص طلبات الاستيراد/طلبات الزبائن (الصين)',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          customerId: { type: 'string' },
        },
      },
    },
  },
];

export async function executeFabricAiTool(
  companyId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (name as FabricAiToolName) {
    case 'searchFabricProducts':
      return searchFabricProducts(companyId, String(args.query ?? ''));
    case 'getInventorySummary':
      return getInventorySummary(companyId, {
        warehouseId: args.warehouseId as string | undefined,
        categoryCode: args.categoryCode as string | undefined,
      });
    case 'getLowStockFabrics':
      return getLowStockFabrics(companyId, Number(args.thresholdMeters));
    case 'getFabricStockByNameOrCode':
      return getFabricStockByNameOrCode(companyId, String(args.nameOrCode ?? ''));
    case 'getCustomerBalance':
      return getCustomerBalance(companyId, String(args.customerNameOrId ?? ''));
    case 'searchCustomers':
      return searchCustomers(companyId, String(args.query ?? ''));
    case 'getContainerSummary':
      return getContainerSummary(companyId, String(args.containerNoOrId ?? ''));
    case 'getRecentContainers':
      return getRecentContainers(companyId, Number(args.limit));
    case 'getSalesSummaryByDateRange':
      return getSalesSummaryByDateRange(companyId, String(args.from ?? ''), String(args.to ?? ''));
    case 'getTopSellingFabrics':
      return getTopSellingFabrics(companyId, String(args.from ?? ''), String(args.to ?? ''));
    case 'getSupplierSummary':
      return getSupplierSummary(companyId, String(args.supplierNameOrId ?? ''));
    case 'getChinaOrdersSummary':
      return getChinaOrdersSummary(companyId, {
        status: args.status as string | undefined,
        customerId: args.customerId as string | undefined,
      });
    default:
      return { error: 'أداة غير معروفة' };
  }
}
