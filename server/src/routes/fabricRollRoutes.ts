import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { authenticateRequest } from '../middleware/auth.js';
import { sendError } from '../middleware/errorHandler.js';
import { ArabicErrors } from '../utils/arabicErrors.js';
import { confirmPurchaseInvoice, createPurchaseInvoice } from '../services/purchaseInvoiceService.js';
import { postPurchaseInvoiceToGl, reversePurchaseInvoiceGl } from '../services/glPostingService.js';
import {
  VALID_STATUSES,
  calcWeight,
  generateBarcode,
  validateStatusTransition,
  type RollStatus,
} from '../utils/rollHelpers.js';

// ─── Zod schemas ────────────────────────────────────────────────────────────

const createRollSchema = z.object({
  barcode: z.string().optional(),
  rollNo: z.string().optional(),
  itemId: z.string().uuid('معرّف الخامة غير صالح'),
  colorId: z.string().uuid().nullable().optional(),
  variantId: z.string().uuid().nullable().optional(),
  supplierId: z.string().uuid().nullable().optional(),
  warehouseId: z.string().uuid('معرّف المستودع غير صالح'),
  locationId: z.string().uuid().nullable().optional(),
  lengthM: z.number().min(0, 'الطول يجب أن يكون رقماً موجباً أو صفراً'),
  widthCm: z.number().positive('عرض التوب يجب أن يكون أكبر من صفر').nullable().optional(),
  gsm: z.number().positive('GSM يجب أن يكون أكبر من صفر').nullable().optional(),
  actualWeightKg: z.number().min(0).nullable().optional(),
  unitCost: z.number().min(0).nullable().optional(),
  currencyCode: z.string().nullable().optional(),
  batchNo: z.string().nullable().optional(),
  containerNo: z.string().nullable().optional(),
  purchaseInvoiceNo: z.string().nullable().optional(),
  supplierRollRef: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

const updateRollSchema = z.object({
  itemId: z.string().uuid().optional(),
  colorId: z.string().uuid().nullable().optional(),
  variantId: z.string().uuid().nullable().optional(),
  rollNo: z.string().nullable().optional(),
  supplierId: z.string().uuid().nullable().optional(),
  locationId: z.string().uuid().nullable().optional(),
  lengthM: z.number().min(0).optional(),
  widthCm: z.number().positive().nullable().optional(),
  gsm: z.number().positive().nullable().optional(),
  actualWeightKg: z.number().min(0).nullable().optional(),
  unitCost: z.number().min(0).nullable().optional(),
  currencyCode: z.string().nullable().optional(),
  batchNo: z.string().nullable().optional(),
  containerNo: z.string().nullable().optional(),
  purchaseInvoiceNo: z.string().nullable().optional(),
  supplierRollRef: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

const statusSchema = z.object({
  status: z.enum(['AVAILABLE', 'RESERVED', 'SOLD', 'DAMAGED', 'TRANSFERRED', 'INACTIVE']),
  notes: z.string().nullable().optional(),
});

const moveSchema = z.object({
  toWarehouseId: z.string().uuid('معرّف المستودع الهدف غير صالح'),
  toLocationId: z.string().uuid().nullable().optional(),
  notes: z.string().nullable().optional(),
});

const bulkPricingSchema = z.object({
  itemId: z.string().uuid(),
  unitCost: z.number().min(0).optional(),
  sellingPrice: z.number().min(0).optional(),
  sellingCurrencyCode: z.string().trim().min(1).max(8).optional(),
  onlyAvailable: z.boolean().optional().default(false),
  batchTag: z.string().trim().max(120).optional(),
  supplierId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  purchaseInvoiceId: z.string().uuid().optional(),
  /**
   * When true: cascade unit_cost changes to linked purchase invoices and vouchers.
   * - DRAFT invoices: lines + header totals updated; linked DRAFT vouchers updated.
   * - CONFIRMED invoices: lines + header totals updated, then GL journal entry is
   *   reversed and re-posted with the new total so the ledger stays balanced.
   *   CONFIRMED vouchers (real payments) are NOT touched; only the invoice's
   *   remaining_amount and payment_status are recomputed against the new total.
   */
  cascadeToInvoices: z.boolean().optional().default(true),
}).refine((d) => d.unitCost != null || d.sellingPrice != null, {
  message: 'حدّد سعر التكلفة أو سعر البيع على الأقل',
});

const finalizeBulkPurchaseSchema = z.object({
  batchTag: z.string().trim().min(1).max(120),
  supplierId: z.string().uuid(),
  warehouseId: z.string().uuid().optional(),
  currencyCode: z.string().trim().min(1).max(8).optional().default('USD'),
});

/** Fill only missing / zero physical fields from invoice (no inventory movements, no financial fields). */
const missingRollFieldsSchema = z
  .object({
    lengthMeters: z.number().positive('قيمة الطول غير صالحة').optional(),
    weightKg: z.number().positive('قيمة الوزن غير صالحة').optional(),
  })
  .refine((d) => d.lengthMeters != null || d.weightKg != null, {
    message: 'أرسل طولاً أو وزناً صالحاً',
  });

const ROLL_LEN_EPS = 1e-6;

function normalizeSevenDigitBarcode(value: string | undefined): string | undefined {
  const digits = String(value ?? '').replace(/\D/g, '').slice(0, 7);
  return digits || undefined;
}

function rollLengthIsFillableDb(lengthM: string | null | undefined): boolean {
  if (lengthM == null || String(lengthM).trim() === '') return true;
  const n = Number(lengthM);
  return !Number.isFinite(n) || n <= ROLL_LEN_EPS;
}

function rollActualWeightIsFillableDb(actual: string | null | undefined): boolean {
  if (actual == null || String(actual).trim() === '') return true;
  const n = Number(actual);
  return !Number.isFinite(n) || n <= ROLL_LEN_EPS;
}

// ─── Shared JOIN query fragment ──────────────────────────────────────────────

const ROLL_COLUMNS = `
  fr.id, fr.company_id, fr.roll_no, fr.barcode, fr.item_id, fr.color_id,
  fr.variant_id, fr.supplier_id, fr.warehouse_id, fr.location_id,
  fr.length_m, fr.width_cm, fr.gsm,
  fr.calculated_weight_kg, fr.actual_weight_kg,
  fr.unit_cost, fr.currency_code,
  fr.batch_no, fr.container_no, fr.purchase_invoice_no, fr.supplier_roll_ref,
  fr.status, fr.notes,
  fr.created_at, fr.updated_at,
  COALESCE(pl.label_print_count, 0)::int AS label_print_count,
  pl.last_label_printed_at,
  fi.name          AS item_name,
  fi.internal_code AS internal_code,
  fi.supplier_code AS supplier_code_item,
  fc.name_ar       AS color_name_ar,
  fc.name_tr       AS color_name_tr,
  fc.color_code    AS color_code,
  fc.hex_color     AS hex_color,
  fiv.variant_code AS variant_code,
  s.name           AS supplier_name,
  w.name           AS warehouse_name,
  wl.name          AS location_name
`;

const ROLL_JOINS = `
  FROM fabric_rolls fr
  LEFT JOIN fabric_items         fi  ON fi.id  = fr.item_id
  LEFT JOIN fabric_colors        fc  ON fc.id  = fr.color_id
  LEFT JOIN fabric_item_variants fiv ON fiv.id = fr.variant_id
  LEFT JOIN suppliers            s   ON s.id   = fr.supplier_id
  LEFT JOIN warehouses           w   ON w.id   = fr.warehouse_id
  LEFT JOIN warehouse_locations  wl  ON wl.id  = fr.location_id
  LEFT JOIN LATERAL (
    SELECT SUM(print_count)::int AS label_print_count, MAX(last_printed_at) AS last_label_printed_at
    FROM printed_labels printed
    WHERE printed.company_id = fr.company_id AND printed.roll_id = fr.id
  ) pl ON true
`;

// ─── Route plugin ────────────────────────────────────────────────────────────

export const fabricRollRoutes: FastifyPluginAsync = async (app) => {
  // ── A. List rolls ────────────────────────────────────────────────────────
  app.get('/', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const q = req.query as Record<string, string>;

    const search = q.search?.trim() || '';
    const barcode = q.barcode?.trim() || '';
    const status = q.status?.trim() || '';
    const onlyAvailable = (q.onlyAvailable || '').toLowerCase() === 'true';
    const warehouseId = q.warehouseId?.trim() || '';
    const locationId = q.locationId?.trim() || '';
    const itemId = q.itemId?.trim() || '';
    const colorId = q.colorId?.trim() || '';
    const variantId = q.variantId?.trim() || '';
    const supplierId = q.supplierId?.trim() || '';
    const batchNo = q.batchNo?.trim() || '';
    const containerNo = q.containerNo?.trim() || '';
    const labelPrinted = q.labelPrinted?.trim() || '';
    const purchaseScope = q.purchaseScope?.trim() || '';
    const recentDays = Math.min(365, Math.max(1, parseInt(q.recentDays) || 30));
    const sortBy = q.sortBy?.trim() || '';
    const sortDir = (q.sortDir?.trim() || '').toLowerCase();
    const page = Math.max(1, parseInt(q.page) || 1);
    const requestedPageSize = Math.max(1, parseInt(q.pageSize) || 30);
    /** قوائم «المتوفّر فقط» (مثل لصاقات الأتواب) تحتاج كل الأتواب دون تقطيع عند 200. */
    const maxPageSize = onlyAvailable ? 50000 : 200;
    const pageSize = Math.min(maxPageSize, requestedPageSize);
    const offset = (page - 1) * pageSize;

    const conds: string[] = ['fr.company_id = $1'];
    const params: unknown[] = [companyId];
    let p = 2;

    if (search) {
      conds.push(
        `(fr.barcode ILIKE $${p} OR fr.roll_no ILIKE $${p}
          OR fi.name ILIKE $${p} OR fi.internal_code ILIKE $${p}
          OR fi.supplier_code ILIKE $${p}
          OR fc.name_ar ILIKE $${p} OR fc.color_code ILIKE $${p}
          OR fr.supplier_roll_ref ILIKE $${p}
          OR fr.batch_no ILIKE $${p} OR fr.container_no ILIKE $${p})`,
      );
      params.push(`%${search}%`); p++;
    }
    if (barcode)     { conds.push(`fr.barcode ILIKE $${p}`);      params.push(`%${barcode}%`);    p++; }
    if (onlyAvailable) {
      conds.push(`fr.status = 'AVAILABLE'`);
      conds.push(`fr.length_m > 0`);
    } else if (status) {
      conds.push(`fr.status = $${p}`);
      params.push(status);
      p++;
    }
    if (warehouseId) { conds.push(`fr.warehouse_id = $${p}`);      params.push(warehouseId);       p++; }
    if (locationId)  { conds.push(`fr.location_id = $${p}`);       params.push(locationId);        p++; }
    if (itemId)      { conds.push(`fr.item_id = $${p}`);           params.push(itemId);            p++; }
    if (colorId)     { conds.push(`fr.color_id = $${p}`);          params.push(colorId);           p++; }
    if (variantId)   { conds.push(`fr.variant_id = $${p}`);        params.push(variantId);         p++; }
    if (supplierId)  { conds.push(`fr.supplier_id = $${p}`);       params.push(supplierId);        p++; }
    if (batchNo)     { conds.push(`fr.batch_no ILIKE $${p}`);      params.push(`%${batchNo}%`);    p++; }
    if (containerNo) { conds.push(`fr.container_no ILIKE $${p}`);  params.push(`%${containerNo}%`); p++; }
    if (labelPrinted === 'true') conds.push('COALESCE(pl.label_print_count, 0) > 0');
    if (labelPrinted === 'false') conds.push('COALESCE(pl.label_print_count, 0) = 0');
    if (purchaseScope === 'purchased') {
      conds.push(`(fr.purchase_invoice_no IS NOT NULL OR fr.supplier_id IS NOT NULL OR fr.unit_cost IS NOT NULL OR fr.batch_no IS NOT NULL)`);
    }
    if (purchaseScope === 'recent') {
      conds.push(`(fr.purchase_invoice_no IS NOT NULL OR fr.supplier_id IS NOT NULL OR fr.unit_cost IS NOT NULL OR fr.batch_no IS NOT NULL)`);
      conds.push(`fr.created_at >= now() - ($${p}::int * interval '1 day')`);
      params.push(recentDays);
      p++;
    }

    const where = conds.join(' AND ');
    const pool = getPool();

    const dirSql = sortDir === 'asc' ? 'ASC' : 'DESC';
    const orderExpr =
      sortBy === 'item_name'
        ? `fi.name ${dirSql} NULLS LAST, fr.created_at DESC`
        : sortBy === 'internal_code'
          ? `fi.internal_code ${dirSql} NULLS LAST, fr.created_at DESC`
          : sortBy === 'barcode'
            ? `fr.barcode ${dirSql} NULLS LAST, fr.created_at DESC`
            : sortBy === 'created_at'
              ? `fr.created_at ${dirSql}`
              : `fr.created_at DESC`;

    const [rows, countRow] = await Promise.all([
      pool.query(
        `SELECT ${ROLL_COLUMNS} ${ROLL_JOINS} WHERE ${where}
         ORDER BY ${orderExpr} LIMIT $${p} OFFSET $${p + 1}`,
        [...params, pageSize, offset],
      ),
      pool.query(
        `SELECT COUNT(*)::int AS total ${ROLL_JOINS} WHERE ${where}`,
        params,
      ),
    ]);

    return reply.send({ ok: true, data: rows.rows, total: countRow.rows[0].total, page, pageSize });
  });

  // ── Recent purchase invoices (used by the bulk-pricing filter) ────────────
  app.get(
    '/bulk-pricing/recent-purchase-invoices',
    { preHandler: authenticateRequest },
    async (req, reply) => {
      const { companyId } = req.user!;
      const q = req.query as Record<string, string>;
      const limit = Math.min(200, Math.max(1, parseInt(q.limit) || 50));
      const pool = getPool();
      const rows = await pool.query(
        `SELECT pi.id,
                pi.invoice_no,
                pi.supplier_invoice_no,
                pi.invoice_date,
                pi.supplier_id,
                pi.warehouse_id,
                pi.currency_code,
                pi.total_amount,
                pi.document_status,
                s.name AS supplier_name,
                w.name AS warehouse_name,
                (
                  SELECT COUNT(*)::int FROM fabric_rolls fr
                  WHERE fr.company_id = pi.company_id AND fr.purchase_invoice_id = pi.id
                ) AS roll_count
         FROM purchase_invoices pi
         LEFT JOIN suppliers s  ON s.id  = pi.supplier_id
         LEFT JOIN warehouses w ON w.id  = pi.warehouse_id
         WHERE pi.company_id = $1
         ORDER BY pi.invoice_date DESC, pi.created_at DESC
         LIMIT $2`,
        [companyId, limit],
      );
      return reply.send({ ok: true, data: rows.rows });
    },
  );

  app.get('/bulk-pricing/groups', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const q = req.query as Record<string, string>;
    const search = q.search?.trim() || '';
    const batchTag = q.batchTag?.trim() || '';
    const supplierId = q.supplierId?.trim() || '';
    const warehouseId = q.warehouseId?.trim() || '';
    const purchaseInvoiceIdRaw = q.purchaseInvoiceId?.trim() || '';
    const useLastInvoice = (q.lastInvoice?.trim() || '').toLowerCase() === 'true';
    const conds = ['fr.company_id = $1'];
    const params: unknown[] = [companyId];
    let p = 2;
    if (search) {
      conds.push(`(fi.name ILIKE $${p} OR fi.internal_code ILIKE $${p})`);
      params.push(`%${search}%`);
      p++;
    }
    if (batchTag) {
      conds.push(`fr.batch_no = $${p}`);
      params.push(batchTag);
      p++;
    }
    if (supplierId) {
      conds.push(`fr.supplier_id = $${p}`);
      params.push(supplierId);
      p++;
    }
    if (warehouseId) {
      conds.push(`fr.warehouse_id = $${p}`);
      params.push(warehouseId);
      p++;
    }

    const pool = getPool();

    // Resolve "آخر فاتورة شراء" lazily so the screen can default to that filter.
    let resolvedInvoiceId: string | null = null;
    if (purchaseInvoiceIdRaw) {
      if (!z.string().uuid().safeParse(purchaseInvoiceIdRaw).success) {
        return sendError(reply, 400, 'معرّف فاتورة الشراء غير صالح', 'VALIDATION');
      }
      resolvedInvoiceId = purchaseInvoiceIdRaw;
    } else if (useLastInvoice) {
      const last = await pool.query<{ id: string }>(
        `SELECT pi.id FROM purchase_invoices pi
         WHERE pi.company_id = $1
           AND EXISTS (
             SELECT 1 FROM fabric_rolls fr
             WHERE fr.company_id = pi.company_id AND fr.purchase_invoice_id = pi.id
           )
         ORDER BY pi.invoice_date DESC, pi.created_at DESC
         LIMIT 1`,
        [companyId],
      );
      resolvedInvoiceId = last.rows[0]?.id ?? null;
    }

    if (resolvedInvoiceId) {
      conds.push(`fr.purchase_invoice_id = $${p}`);
      params.push(resolvedInvoiceId);
      p++;
    }

    const rows = await pool.query(
      `SELECT
         fi.id AS item_id,
         fi.name AS item_name,
         fi.internal_code,
         fi.default_selling_price,
         fi.default_selling_currency_code,
         COUNT(fr.id)::int AS roll_count,
         COUNT(DISTINCT fr.color_id)::int AS color_count,
         COALESCE(SUM(fr.length_m), 0)::numeric AS total_meters,
         COALESCE(SUM(COALESCE(fr.actual_weight_kg, fr.calculated_weight_kg, 0)), 0)::numeric AS total_kg,
         COALESCE(AVG(fr.unit_cost) FILTER (WHERE fr.unit_cost IS NOT NULL), 0)::numeric AS avg_unit_cost,
         COALESCE(MIN(fr.unit_cost) FILTER (WHERE fr.unit_cost IS NOT NULL), 0)::numeric AS min_unit_cost,
         COALESCE(MAX(fr.unit_cost) FILTER (WHERE fr.unit_cost IS NOT NULL), 0)::numeric AS max_unit_cost,
         COUNT(fr.id) FILTER (WHERE fr.status = 'AVAILABLE')::int AS available_roll_count,
         (
           SELECT pi2.id FROM fabric_rolls fr2
           INNER JOIN purchase_invoices pi2 ON pi2.id = fr2.purchase_invoice_id
           WHERE fr2.company_id = fi.company_id AND fr2.item_id = fi.id
             AND fr2.purchase_invoice_id IS NOT NULL
           ORDER BY pi2.invoice_date DESC, pi2.created_at DESC
           LIMIT 1
         ) AS last_purchase_invoice_id,
         (
           SELECT pi2.invoice_no FROM fabric_rolls fr2
           INNER JOIN purchase_invoices pi2 ON pi2.id = fr2.purchase_invoice_id
           WHERE fr2.company_id = fi.company_id AND fr2.item_id = fi.id
             AND fr2.purchase_invoice_id IS NOT NULL
           ORDER BY pi2.invoice_date DESC, pi2.created_at DESC
           LIMIT 1
         ) AS last_purchase_invoice_no,
         (
           SELECT pi2.invoice_date FROM fabric_rolls fr2
           INNER JOIN purchase_invoices pi2 ON pi2.id = fr2.purchase_invoice_id
           WHERE fr2.company_id = fi.company_id AND fr2.item_id = fi.id
             AND fr2.purchase_invoice_id IS NOT NULL
           ORDER BY pi2.invoice_date DESC, pi2.created_at DESC
           LIMIT 1
         ) AS last_purchase_invoice_date
       FROM fabric_rolls fr
       INNER JOIN fabric_items fi ON fi.id = fr.item_id AND fi.company_id = fr.company_id
       WHERE ${conds.join(' AND ')}
       GROUP BY fi.id, fi.name, fi.internal_code, fi.default_selling_price, fi.default_selling_currency_code
       ORDER BY fi.name ASC
       LIMIT 500`,
      params,
    );
    return reply.send({
      ok: true,
      data: rows.rows,
      resolvedPurchaseInvoiceId: resolvedInvoiceId,
    });
  });

  app.patch('/bulk-pricing', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const parsed = bulkPricingSchema.safeParse(req.body);
    if (!parsed.success) {
      const first = parsed.error.errors[0]?.message;
      return sendError(reply, 400, first || ArabicErrors.validation, 'VALIDATION');
    }
    const {
      itemId,
      unitCost,
      sellingPrice,
      sellingCurrencyCode,
      onlyAvailable,
      batchTag,
      supplierId,
      warehouseId,
      purchaseInvoiceId,
      cascadeToInvoices,
    } = parsed.data;

    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      let updatedRollCount = 0;
      const updatedDraftInvoiceIds = new Set<string>();
      const affectedConfirmedInvoiceIds = new Set<string>();
      let updatedDraftInvoices = 0;
      let updatedDraftVouchers = 0;
      let updatedConfirmedInvoices = 0;
      let repostedGlEntries = 0;

      // ── 1) Update unit_cost on rolls (when provided) ───────────────────────
      if (unitCost != null) {
        // Build the filter clause without unitCost so we can safely reuse it
        // in queries that don't bind unit_cost (SELECT). Always prefix columns
        // with `fr.` so the same WHERE is JOIN-safe (purchase_invoices also
        // has company_id).
        const filterConds = ['fr.company_id = $1', 'fr.item_id = $2'];
        const filterParams: unknown[] = [companyId, itemId];
        let p = 3;
        if (onlyAvailable) filterConds.push("fr.status = 'AVAILABLE'");
        if (batchTag) { filterConds.push(`fr.batch_no = $${p}`); filterParams.push(batchTag); p++; }
        if (supplierId) { filterConds.push(`fr.supplier_id = $${p}`); filterParams.push(supplierId); p++; }
        if (warehouseId) { filterConds.push(`fr.warehouse_id = $${p}`); filterParams.push(warehouseId); p++; }
        if (purchaseInvoiceId) { filterConds.push(`fr.purchase_invoice_id = $${p}`); filterParams.push(purchaseInvoiceId); p++; }
        const filterWhere = filterConds.join(' AND ');

        // Collect DRAFT invoices that will be impacted before we mutate rolls.
        if (cascadeToInvoices) {
          const linked = await client.query<{ purchase_invoice_id: string; document_status: string }>(
            `SELECT DISTINCT fr.purchase_invoice_id, pi.document_status
             FROM fabric_rolls fr
             INNER JOIN purchase_invoices pi ON pi.id = fr.purchase_invoice_id
             WHERE ${filterWhere} AND fr.purchase_invoice_id IS NOT NULL`,
            filterParams,
          );
          for (const row of linked.rows) {
            if (row.document_status === 'DRAFT') {
              updatedDraftInvoiceIds.add(row.purchase_invoice_id);
            } else if (row.document_status === 'CONFIRMED') {
              affectedConfirmedInvoiceIds.add(row.purchase_invoice_id);
            }
          }
        }

        // Append unitCost as the last placeholder for the UPDATE.
        const updateParams = [...filterParams, unitCost];
        const unitCostPlaceholder = `$${p}::numeric`;

        const rollResult = await client.query(
          `UPDATE fabric_rolls fr
           SET unit_cost = ${unitCostPlaceholder}, updated_at = now()
           WHERE ${filterWhere}
           RETURNING fr.id`,
          updateParams,
        );
        updatedRollCount = rollResult.rowCount ?? 0;

        // ── 2) Cascade unit_cost into purchase_invoice_lines (DRAFT only) ───
        if (cascadeToInvoices && updatedDraftInvoiceIds.size > 0) {
          const draftIds = Array.from(updatedDraftInvoiceIds);

          // Update line unit_cost and recompute line_total = quantity * unit_cost.
          await client.query(
            `UPDATE purchase_invoice_lines pil
             SET unit_cost = $3::numeric,
                 line_total = ROUND(pil.quantity * $3::numeric, 2)
             FROM fabric_rolls fr, purchase_invoices pi
             WHERE pil.company_id = $1
               AND pil.fabric_item_id = $2
               AND pil.invoice_id = ANY($4::uuid[])
               AND pi.id = pil.invoice_id
               AND pi.document_status = 'DRAFT'
               AND fr.id = pil.fabric_roll_id
               AND fr.company_id = pil.company_id`,
            [companyId, itemId, unitCost, draftIds],
          );

          // Recompute invoice totals (subtotal/total) from the lines for each impacted DRAFT invoice.
          const recompute = await client.query<{ id: string }>(
            `WITH new_totals AS (
               SELECT pil.invoice_id, COALESCE(SUM(pil.line_total), 0)::numeric AS new_total
               FROM purchase_invoice_lines pil
               WHERE pil.company_id = $1 AND pil.invoice_id = ANY($2::uuid[])
               GROUP BY pil.invoice_id
             )
             UPDATE purchase_invoices pi
             SET subtotal = nt.new_total,
                 total_amount = (nt.new_total - pi.discount_total + pi.tax_total),
                 remaining_amount = GREATEST(0, (nt.new_total - pi.discount_total + pi.tax_total) - pi.paid_amount),
                 payment_status = CASE
                   WHEN (nt.new_total - pi.discount_total + pi.tax_total) <= 0 THEN 'paid'
                   WHEN pi.paid_amount >= (nt.new_total - pi.discount_total + pi.tax_total) THEN 'paid'
                   WHEN pi.paid_amount > 0 THEN 'partial'
                   ELSE 'unpaid'
                 END,
                 subtotal_usd = ROUND(nt.new_total / NULLIF(pi.exchange_rate_to_usd, 0), 2),
                 total_amount_usd = ROUND((nt.new_total - pi.discount_total + pi.tax_total) / NULLIF(pi.exchange_rate_to_usd, 0), 2),
                 remaining_amount_usd = ROUND(GREATEST(0, (nt.new_total - pi.discount_total + pi.tax_total) - pi.paid_amount) / NULLIF(pi.exchange_rate_to_usd, 0), 2),
                 updated_at = now()
             FROM new_totals nt
             WHERE pi.id = nt.invoice_id
               AND pi.company_id = $1
               AND pi.document_status = 'DRAFT'
             RETURNING pi.id`,
            [companyId, draftIds],
          );
          updatedDraftInvoices = recompute.rowCount ?? 0;

          // ── 3) Cascade into DRAFT vouchers linked to those invoices ───────
          // We only adjust DRAFT vouchers; confirmed vouchers have GL postings.
          const voucherResult = await client.query(
            `UPDATE vouchers v
             SET amount = pi.total_amount,
                 updated_at = now()
             FROM purchase_invoices pi
             WHERE pi.id = ANY($2::uuid[])
               AND pi.company_id = $1
               AND v.id = pi.payment_voucher_id
               AND v.company_id = $1
               AND v.status = 'DRAFT'`,
            [companyId, draftIds],
          );
          updatedDraftVouchers = voucherResult.rowCount ?? 0;
        }

        // ── 4) Cascade into CONFIRMED invoices (auto repost GL) ─────────────
        // For each impacted CONFIRMED invoice we:
        //   a) Update its lines (unit_cost + line_total)
        //   b) Recompute header totals (and remaining/payment_status against
        //      the existing paid_amount — confirmed vouchers are NOT modified)
        //   c) Reverse the existing GL journal entry, delete the pair
        //      (original + reversal) so postPurchaseInvoiceToGl can re-post
        //      with the new total, keeping the ledger balanced.
        if (cascadeToInvoices && affectedConfirmedInvoiceIds.size > 0) {
          const confirmedIds = Array.from(affectedConfirmedInvoiceIds);

          // a) Update lines on CONFIRMED invoices
          await client.query(
            `UPDATE purchase_invoice_lines pil
             SET unit_cost = $3::numeric,
                 line_total = ROUND(pil.quantity * $3::numeric, 2)
             FROM fabric_rolls fr, purchase_invoices pi
             WHERE pil.company_id = $1
               AND pil.fabric_item_id = $2
               AND pil.invoice_id = ANY($4::uuid[])
               AND pi.id = pil.invoice_id
               AND pi.document_status = 'CONFIRMED'
               AND fr.id = pil.fabric_roll_id
               AND fr.company_id = pil.company_id`,
            [companyId, itemId, unitCost, confirmedIds],
          );

          // b) Recompute header totals on CONFIRMED invoices and return the
          //    fields we need to re-post the GL entry.
          const recomputeConfirmed = await client.query<{
            id: string;
            invoice_no: string;
            invoice_date: string | Date;
            supplier_id: string;
            currency_code: string;
            total_amount_usd: string | number | null;
          }>(
            `WITH new_totals AS (
               SELECT pil.invoice_id, COALESCE(SUM(pil.line_total), 0)::numeric AS new_total
               FROM purchase_invoice_lines pil
               WHERE pil.company_id = $1 AND pil.invoice_id = ANY($2::uuid[])
               GROUP BY pil.invoice_id
             )
             UPDATE purchase_invoices pi
             SET subtotal = nt.new_total,
                 total_amount = (nt.new_total - pi.discount_total + pi.tax_total),
                 remaining_amount = GREATEST(0, (nt.new_total - pi.discount_total + pi.tax_total) - pi.paid_amount),
                 payment_status = CASE
                   WHEN (nt.new_total - pi.discount_total + pi.tax_total) <= 0 THEN 'paid'
                   WHEN pi.paid_amount >= (nt.new_total - pi.discount_total + pi.tax_total) THEN 'paid'
                   WHEN pi.paid_amount > 0 THEN 'partial'
                   ELSE 'unpaid'
                 END,
                 subtotal_usd = ROUND(nt.new_total / NULLIF(pi.exchange_rate_to_usd, 0), 2),
                 total_amount_usd = ROUND((nt.new_total - pi.discount_total + pi.tax_total) / NULLIF(pi.exchange_rate_to_usd, 0), 2),
                 remaining_amount_usd = ROUND(GREATEST(0, (nt.new_total - pi.discount_total + pi.tax_total) - pi.paid_amount) / NULLIF(pi.exchange_rate_to_usd, 0), 2),
                 updated_at = now()
             FROM new_totals nt
             WHERE pi.id = nt.invoice_id
               AND pi.company_id = $1
               AND pi.document_status = 'CONFIRMED'
             RETURNING pi.id, pi.invoice_no, pi.invoice_date, pi.supplier_id,
                       pi.currency_code, pi.total_amount_usd`,
            [companyId, confirmedIds],
          );
          updatedConfirmedInvoices = recomputeConfirmed.rowCount ?? 0;

          // c) Reverse + delete pair + re-post for each affected CONFIRMED invoice.
          for (const inv of recomputeConfirmed.rows) {
            const invId = inv.id;
            const invNo = String(inv.invoice_no);

            // c.1) Reverse existing GL (no-op if no original entry exists,
            //      e.g. invoice was originally confirmed with total=0).
            await reversePurchaseInvoiceGl(client, {
              companyId,
              purchaseInvoiceId: invId,
              invoiceNo: invNo,
              userId,
            });

            // c.2) Delete the reversal first (FK reversed_entry_id references
            //      the original), then the original entry. journal_lines are
            //      removed by ON DELETE CASCADE.
            await client.query(
              `DELETE FROM journal_entries
               WHERE company_id = $1
                 AND source_id = $2
                 AND source_type = 'PURCHASE_INVOICE_REVERSAL'`,
              [companyId, invId],
            );
            await client.query(
              `DELETE FROM journal_entries
               WHERE company_id = $1
                 AND source_id = $2
                 AND source_type = 'PURCHASE_INVOICE'`,
              [companyId, invId],
            );

            // c.3) Re-post with the new total (only if > 0).
            const newTotalUsd = Number(inv.total_amount_usd ?? 0);
            if (newTotalUsd > 0) {
              const entryDate =
                inv.invoice_date instanceof Date
                  ? inv.invoice_date.toISOString().slice(0, 10)
                  : String(inv.invoice_date).slice(0, 10);
              await postPurchaseInvoiceToGl(client, {
                companyId,
                purchaseInvoiceId: invId,
                invoiceNo: invNo,
                invoiceDate: entryDate,
                supplierId: String(inv.supplier_id),
                totalAmountUsd: newTotalUsd,
                currencyCode: String(inv.currency_code),
                userId,
              });
              repostedGlEntries++;
            }
          }
        }
      }

      // ── 4) Update default_selling_price on the fabric_item (when provided) ─
      let updatedSellingPriceOnItem = false;
      if (sellingPrice != null) {
        const sellRes = await client.query(
          `UPDATE fabric_items
           SET default_selling_price = $3,
               default_selling_currency_code = COALESCE($4, default_selling_currency_code),
               updated_at = now()
           WHERE company_id = $1 AND id = $2
           RETURNING id`,
          [companyId, itemId, sellingPrice, sellingCurrencyCode?.toUpperCase() ?? null],
        );
        updatedSellingPriceOnItem = (sellRes.rowCount ?? 0) > 0;
      }

      await client.query('COMMIT');
      return reply.send({
        ok: true,
        data: {
          updatedCount: updatedRollCount,
          updatedSellingPriceOnItem,
          updatedDraftInvoices,
          updatedDraftVouchers,
          updatedConfirmedInvoices,
          repostedGlEntries,
          // Back-compat: keep the field but always 0 now that confirmed
          // invoices are auto-updated. UI can stop showing the "skipped" hint.
          skippedConfirmedInvoices: 0,
        },
      });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => { /* ignore */ });
      const msg = err instanceof Error ? err.message : String(err);
      return sendError(reply, 500, `فشل حفظ التسعير الجماعي: ${msg}`, 'INTERNAL');
    } finally {
      client.release();
    }
  });

  // ── B. Get single roll with recent movements ──────────────────────────────
  app.post('/bulk-pricing/finalize-purchase', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const parsed = finalizeBulkPurchaseSchema.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    const { batchTag, supplierId, warehouseId, currencyCode } = parsed.data;
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const supplier = await client.query<{ id: string; name: string }>(
        `SELECT id, name FROM suppliers WHERE id = $1 AND company_id = $2 AND is_active = true`,
        [supplierId, companyId],
      );
      if (!supplier.rows.length) {
        await client.query('ROLLBACK');
        return sendError(reply, 404, 'المورد غير موجود أو غير فعال', 'NOT_FOUND');
      }

      const params: unknown[] = [companyId, supplierId, batchTag];
      let warehouseClause = '';
      if (warehouseId) {
        params.push(warehouseId);
        warehouseClause = `AND fr.warehouse_id = $${params.length}`;
      }

      const rollRows = await client.query<{
        id: string;
        item_id: string;
        warehouse_id: string;
        warehouse_name: string | null;
        item_name: string;
        length_m: string;
        unit_cost: string | null;
      }>(
        `SELECT fr.id, fr.item_id, fr.warehouse_id, w.name AS warehouse_name,
                fi.name AS item_name, fr.length_m, fr.unit_cost
         FROM fabric_rolls fr
         INNER JOIN fabric_items fi ON fi.id = fr.item_id AND fi.company_id = fr.company_id
         LEFT JOIN warehouses w ON w.id = fr.warehouse_id
         WHERE fr.company_id = $1
           AND fr.supplier_id = $2
           AND fr.batch_no = $3
           AND fr.purchase_invoice_no IS NULL
           ${warehouseClause}
         ORDER BY fi.name, fr.created_at`,
        params,
      );

      const lines = rollRows.rows
        .map((r) => {
          const quantity = Number(r.length_m) || 0;
          const unitPrice = Number(r.unit_cost) || 0;
          const lineTotal = Math.round(quantity * unitPrice * 100) / 100;
          return {
            fabricRollId: r.id,
            fabricItemId: r.item_id,
            warehouseId: r.warehouse_id,
            description: r.item_name,
            quantity,
            unit: 'meter' as const,
            unitPrice,
            lineDiscount: 0,
            lineTax: 0,
            lineTotal,
            metadata: { source: 'STOCK_IMPORT_BULK_PRICING', batchTag },
          };
        })
        .filter((line) => line.quantity > 0 && line.unitPrice > 0 && line.lineTotal > 0);

      const totalAmount = Math.round(lines.reduce((sum, line) => sum + line.lineTotal, 0) * 100) / 100;
      if (lines.length === 0 || totalAmount <= 0) {
        await client.query('ROLLBACK');
        return sendError(reply, 400, 'لا توجد أثواب مسعرة قابلة لإنشاء فاتورة شراء لهذه الدفعة', 'VALIDATION');
      }

      const firstWarehouseId = warehouseId || rollRows.rows[0]?.warehouse_id || null;
      const firstWarehouseName = rollRows.rows.find((row) => row.warehouse_id === firstWarehouseId)?.warehouse_name
        || rollRows.rows[0]?.warehouse_name
        || null;

      const invoice = await createPurchaseInvoice(client, companyId, userId, {
        invoiceNo: 'AUTO',
        invoiceDate: new Date().toISOString().slice(0, 10),
        supplierId,
        warehouseId: firstWarehouseId,
        warehouseLabel: firstWarehouseName,
        currencyCode: currencyCode || 'USD',
        exchangeRateToUsd: (currencyCode || 'USD').toUpperCase() === 'USD' ? 1 : undefined,
        notes: `فاتورة شراء مولدة من تسعير دفعة استيراد مخزون: ${batchTag}`,
        subtotal: totalAmount,
        discountTotal: 0,
        taxTotal: 0,
        totalAmount,
        paidAmount: 0,
        remainingAmount: totalAmount,
        paymentStatus: 'unpaid',
        lines,
        confirm: false,
      });

      await confirmPurchaseInvoice(client, companyId, userId, invoice.id, { skipStockMovement: true });
      await client.query('COMMIT');
      return reply.send({
        ok: true,
        data: {
          invoiceId: invoice.id,
          invoiceNo: invoice.invoiceNo,
          supplierId,
          supplierName: supplier.rows[0].name,
          batchTag,
          rollCount: lines.length,
          totalAmount,
        },
      });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => { /* ignore */ });
      const msg = err instanceof Error ? err.message : String(err);
      return sendError(reply, 500, `فشل إنشاء فاتورة الشراء بعد التسعير: ${msg}`, 'INTERNAL');
    } finally {
      client.release();
    }
  });

  app.get('/:id', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const pool = getPool();

    const rollRow = await pool.query(
      `SELECT ${ROLL_COLUMNS} ${ROLL_JOINS}
       WHERE fr.id = $1 AND fr.company_id = $2`,
      [id, companyId],
    );
    if (!rollRow.rows.length) return sendError(reply, 404, 'الثوب غير موجود', 'NOT_FOUND');

    const movRows = await pool.query(
      `SELECT im.*,
              fw.name AS from_warehouse_name, tw.name AS to_warehouse_name,
              fl.name AS from_location_name,  tl.name AS to_location_name,
              u.full_name AS created_by_name
       FROM inventory_movements im
       LEFT JOIN warehouses w  ON false
       LEFT JOIN warehouses fw ON fw.id = im.from_warehouse_id
       LEFT JOIN warehouses tw ON tw.id = im.to_warehouse_id
       LEFT JOIN warehouse_locations fl ON fl.id = im.from_location_id
       LEFT JOIN warehouse_locations tl ON tl.id = im.to_location_id
       LEFT JOIN users u ON u.id = im.created_by_user_id
       WHERE im.roll_id = $1
       ORDER BY im.created_at DESC LIMIT 50`,
      [id],
    );

    return reply.send({ ok: true, data: { ...rollRow.rows[0], movements: movRows.rows } });
  });

  // ── B2. Patch missing physical fields (invoice-safe completion) ───────────
  app.patch('/:id/missing-fields', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    if (!z.string().uuid().safeParse(id).success) {
      return sendError(reply, 400, 'معرّف الرول غير صالح', 'VALIDATION');
    }
    const parsed = missingRollFieldsSchema.safeParse(req.body);
    if (!parsed.success) {
      const flat = parsed.error.flatten();
      const fieldErr =
        flat.fieldErrors.lengthMeters?.[0] ||
        flat.fieldErrors.weightKg?.[0] ||
        flat.formErrors[0] ||
        ArabicErrors.validation;
      return sendError(reply, 400, fieldErr, 'VALIDATION');
    }
    const { lengthMeters, weightKg } = parsed.data;
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const lock = await client.query<{
        length_m: string;
        width_cm: string | null;
        gsm: string | null;
        calculated_weight_kg: string | null;
        actual_weight_kg: string | null;
      }>(
        `SELECT length_m, width_cm, gsm, calculated_weight_kg, actual_weight_kg
         FROM fabric_rolls WHERE id=$1 AND company_id=$2 FOR UPDATE`,
        [id, companyId],
      );
      if (!lock.rows.length) {
        await client.query('ROLLBACK');
        return sendError(reply, 404, 'الرول غير موجود أو لا يتبع هذه الشركة', 'NOT_FOUND');
      }
      const row = lock.rows[0];

      let newLength: number | null = null;
      let newCalcWt: number | null = null;
      let newActualWt: number | null = null;

      if (lengthMeters != null) {
        if (!rollLengthIsFillableDb(row.length_m)) {
          await client.query('ROLLBACK');
          return sendError(reply, 400, 'لا يمكن تعديل طول الرول من الفاتورة لأنه موجود مسبقاً في المخزون', 'FIELD_EXISTS');
        }
        newLength = lengthMeters;
        const w = row.width_cm != null ? Number(row.width_cm) : null;
        const g = row.gsm != null ? Number(row.gsm) : null;
        newCalcWt = calcWeight(newLength, w, g);
      }

      if (weightKg != null) {
        if (!rollActualWeightIsFillableDb(row.actual_weight_kg)) {
          await client.query('ROLLBACK');
          return sendError(reply, 400, 'لا يمكن تعديل وزن الرول من الفاتورة لأنه موجود مسبقاً في المخزون', 'FIELD_EXISTS');
        }
        newActualWt = weightKg;
      }

      const sets: string[] = ['updated_at = now()'];
      const params: unknown[] = [id, companyId];
      let p = 3;
      if (newLength != null) {
        sets.push(`length_m = $${p++}`);
        params.push(newLength);
        sets.push(`calculated_weight_kg = $${p++}`);
        params.push(newCalcWt);
      }
      if (newActualWt != null) {
        sets.push(`actual_weight_kg = $${p++}`);
        params.push(newActualWt);
      }

      await client.query(
        `UPDATE fabric_rolls SET ${sets.join(', ')} WHERE id=$1 AND company_id=$2`,
        params,
      );
      await client.query('COMMIT');

      const fullRow = await pool.query(
        `SELECT ${ROLL_COLUMNS} ${ROLL_JOINS} WHERE fr.id=$1 AND fr.company_id=$2`,
        [id, companyId],
      );
      return reply.send({
        ok: true,
        applied: true,
        message: 'تم تحديث بيانات الرول في المخزون',
        data: fullRow.rows[0],
      });
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw e;
    } finally {
      client.release();
    }
  });

  // ── C. Create roll ───────────────────────────────────────────────────────
  app.post('/', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const parsed = createRollSchema.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    const d = parsed.data;

    const pool = getPool();

    // Validate item belongs to company
    const itemCheck = await pool.query(
      'SELECT id FROM fabric_items WHERE id=$1 AND company_id=$2',
      [d.itemId, companyId],
    );
    if (!itemCheck.rows.length) return sendError(reply, 404, 'الخامة غير موجودة', 'NOT_FOUND');

    // Validate warehouse
    const whCheck = await pool.query(
      'SELECT id FROM warehouses WHERE id=$1 AND company_id=$2',
      [d.warehouseId, companyId],
    );
    if (!whCheck.rows.length) return sendError(reply, 404, 'المستودع غير موجود', 'NOT_FOUND');

    // Validate location belongs to warehouse
    if (d.locationId) {
      const locCheck = await pool.query(
        'SELECT id FROM warehouse_locations WHERE id=$1 AND warehouse_id=$2 AND company_id=$3',
        [d.locationId, d.warehouseId, companyId],
      );
      if (!locCheck.rows.length)
        return sendError(reply, 400, 'الموقع المحدد لا يتبع هذا المستودع', 'VALIDATION');
    }

    // Validate color (company-scoped or global)
    if (d.colorId) {
      const colorCheck = await pool.query(
        'SELECT id FROM fabric_colors WHERE id=$1 AND (company_id=$2 OR company_id IS NULL)',
        [d.colorId, companyId],
      );
      if (!colorCheck.rows.length) return sendError(reply, 404, 'اللون غير موجود', 'NOT_FOUND');
    }

    // Validate variant belongs to item
    if (d.variantId) {
      const varCheck = await pool.query(
        'SELECT id FROM fabric_item_variants WHERE id=$1 AND item_id=$2 AND company_id=$3',
        [d.variantId, d.itemId, companyId],
      );
      if (!varCheck.rows.length)
        return sendError(reply, 404, 'المتغير لا ينتمي لهذه الخامة', 'NOT_FOUND');
    }

    // Validate supplier
    if (d.supplierId) {
      const supCheck = await pool.query(
        'SELECT id FROM suppliers WHERE id=$1 AND company_id=$2',
        [d.supplierId, companyId],
      );
      if (!supCheck.rows.length) return sendError(reply, 404, 'المورد غير موجود', 'NOT_FOUND');
    }

    // Validate currency
    if (d.currencyCode) {
      const curCheck = await pool.query('SELECT code FROM currencies WHERE code=$1', [d.currencyCode]);
      if (!curCheck.rows.length) return sendError(reply, 404, 'العملة غير موجودة', 'NOT_FOUND');
    }

    // Resolve barcode
    let barcode = normalizeSevenDigitBarcode(d.barcode);
    if (!barcode) {
      barcode = await generateBarcode(pool, companyId);
    } else {
      const dupCheck = await pool.query(
        'SELECT id FROM fabric_rolls WHERE company_id=$1 AND barcode=$2',
        [companyId, barcode],
      );
      if (dupCheck.rows.length) return sendError(reply, 409, 'باركود الثوب موجود مسبقاً', 'DUPLICATE');
    }

    // Calculate weight
    const calcWt = calcWeight(d.lengthM, d.widthCm ?? null, d.gsm ?? null);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const rollRow = await client.query(
        `INSERT INTO fabric_rolls
           (company_id, roll_no, barcode, item_id, color_id, variant_id, supplier_id,
            warehouse_id, location_id, length_m, width_cm, gsm,
            calculated_weight_kg, actual_weight_kg, unit_cost, currency_code,
            batch_no, container_no, purchase_invoice_no, supplier_roll_ref,
            notes, created_by_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
         RETURNING *`,
        [
          companyId, d.rollNo ?? null, barcode, d.itemId,
          d.colorId ?? null, d.variantId ?? null, d.supplierId ?? null,
          d.warehouseId, d.locationId ?? null,
          d.lengthM, d.widthCm ?? null, d.gsm ?? null,
          calcWt, d.actualWeightKg ?? null, d.unitCost ?? null, d.currencyCode ?? null,
          d.batchNo ?? null, d.containerNo ?? null,
          d.purchaseInvoiceNo ?? null, d.supplierRollRef ?? null,
          d.notes ?? null, userId,
        ],
      );

      const roll = rollRow.rows[0];

      await client.query(
        `INSERT INTO inventory_movements
           (company_id, roll_id, movement_type, to_warehouse_id, to_location_id,
            new_status, notes, created_by_user_id)
         VALUES ($1,$2,'MANUAL_CREATE',$3,$4,'AVAILABLE',$5,$6)`,
        [companyId, roll.id, d.warehouseId, d.locationId ?? null, d.notes ?? null, userId],
      );

      await client.query('COMMIT');

      return reply.status(201).send({ ok: true, data: roll, calculatedWeightKg: calcWt });
    } catch (e) {
      await client.query('ROLLBACK');
      if ((e as { code?: string }).code === '23505')
        return sendError(reply, 409, 'باركود الثوب موجود مسبقاً', 'DUPLICATE');
      throw e;
    } finally {
      client.release();
    }
  });

  // ── D. Update roll metadata ───────────────────────────────────────────────
  app.put('/:id', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const { id } = req.params as { id: string };
    const parsed = updateRollSchema.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    const d = parsed.data;
    const pool = getPool();

    const existing = await pool.query<{
      item_id: string;
      warehouse_id: string;
      length_m: string;
      width_cm: string | null;
      gsm: string | null;
      status: string;
    }>(
      'SELECT item_id, warehouse_id, length_m, width_cm, gsm, status FROM fabric_rolls WHERE id=$1 AND company_id=$2',
      [id, companyId],
    );
    if (!existing.rows.length) return sendError(reply, 404, 'الثوب غير موجود', 'NOT_FOUND');

    const cur = existing.rows[0];

    if (d.itemId) {
      const itemCheck = await pool.query(
        'SELECT id FROM fabric_items WHERE id=$1 AND company_id=$2',
        [d.itemId, companyId],
      );
      if (!itemCheck.rows.length) return sendError(reply, 404, 'الخامة غير موجودة', 'NOT_FOUND');
    }

    if (d.colorId) {
      const colorCheck = await pool.query(
        'SELECT id FROM fabric_colors WHERE id=$1 AND (company_id=$2 OR company_id IS NULL)',
        [d.colorId, companyId],
      );
      if (!colorCheck.rows.length) return sendError(reply, 404, 'اللون غير موجود', 'NOT_FOUND');
    }

    const targetItemId = d.itemId ?? cur.item_id;
    if (d.variantId) {
      const varCheck = await pool.query(
        'SELECT id FROM fabric_item_variants WHERE id=$1 AND item_id=$2 AND company_id=$3',
        [d.variantId, targetItemId, companyId],
      );
      if (!varCheck.rows.length) return sendError(reply, 404, 'المتغير لا ينتمي لهذه الخامة', 'NOT_FOUND');
    }

    if (d.locationId) {
      const locCheck = await pool.query(
        'SELECT id FROM warehouse_locations WHERE id=$1 AND warehouse_id=$2 AND company_id=$3',
        [d.locationId, cur.warehouse_id, companyId],
      );
      if (!locCheck.rows.length)
        return sendError(reply, 400, 'الموقع المحدد لا يتبع هذا المستودع', 'VALIDATION');
    }

    if (d.supplierId) {
      const supCheck = await pool.query(
        'SELECT id FROM suppliers WHERE id=$1 AND company_id=$2',
        [d.supplierId, companyId],
      );
      if (!supCheck.rows.length) return sendError(reply, 404, 'المورد غير موجود', 'NOT_FOUND');
    }

    // Determine new calculated weight
    const newLengthM = d.lengthM ?? parseFloat(cur.length_m);
    const newWidthCm = d.widthCm !== undefined ? d.widthCm : (cur.width_cm == null ? null : parseFloat(cur.width_cm));
    const newGsm = d.gsm !== undefined ? d.gsm : (cur.gsm == null ? null : parseFloat(cur.gsm));
    const calcWt = calcWeight(
      newLengthM,
      newWidthCm,
      newGsm,
    );

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const rollRow = await client.query(
        `UPDATE fabric_rolls SET
           item_id             = COALESCE($3,  item_id),
           color_id            = CASE WHEN $4::boolean THEN $5::uuid ELSE color_id END,
           variant_id          = CASE WHEN $6::boolean THEN $7::uuid ELSE variant_id END,
           roll_no             = COALESCE($8,  roll_no),
           supplier_id         = CASE WHEN $9::uuid IS NOT NULL THEN $9 ELSE supplier_id END,
           location_id         = CASE WHEN $10::uuid IS NOT NULL THEN $10 ELSE location_id END,
           length_m            = COALESCE($11, length_m),
           width_cm            = COALESCE($12, width_cm),
           gsm                 = COALESCE($13, gsm),
           calculated_weight_kg= COALESCE($14, calculated_weight_kg),
           actual_weight_kg    = COALESCE($15, actual_weight_kg),
           unit_cost           = COALESCE($16, unit_cost),
           currency_code       = COALESCE($17, currency_code),
           batch_no            = COALESCE($18, batch_no),
           container_no        = COALESCE($19, container_no),
           purchase_invoice_no = COALESCE($20, purchase_invoice_no),
           supplier_roll_ref   = COALESCE($21, supplier_roll_ref),
           notes               = COALESCE($22, notes),
           updated_at          = now()
         WHERE id=$1 AND company_id=$2
         RETURNING *`,
        [
          id, companyId,
          d.itemId ?? null,
          Object.prototype.hasOwnProperty.call(d, 'colorId'),
          d.colorId ?? null,
          Object.prototype.hasOwnProperty.call(d, 'variantId'),
          d.variantId ?? null,
          d.rollNo ?? null,
          d.supplierId ?? null,
          d.locationId ?? null,
          d.lengthM ?? null,
          d.widthCm ?? null,
          d.gsm ?? null,
          calcWt,
          d.actualWeightKg ?? null,
          d.unitCost ?? null,
          d.currencyCode ?? null,
          d.batchNo ?? null,
          d.containerNo ?? null,
          d.purchaseInvoiceNo ?? null,
          d.supplierRollRef ?? null,
          d.notes ?? null,
        ],
      );

      if (d.lengthM !== undefined && d.lengthM !== parseFloat(cur.length_m)) {
        const delta = d.lengthM - parseFloat(cur.length_m);
        await client.query(
          `INSERT INTO inventory_movements
             (company_id, roll_id, movement_type, length_delta_m, notes, created_by_user_id)
           VALUES ($1,$2,'ADJUSTMENT',$3,'تعديل طول الثوب',$4)`,
          [companyId, id, delta, userId],
        );
      }

      await client.query('COMMIT');
      return reply.send({ ok: true, data: rollRow.rows[0] });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  // ── E. Update status ─────────────────────────────────────────────────────
  app.patch('/:id/status', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const { id } = req.params as { id: string };
    const parsed = statusSchema.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    const { status, notes } = parsed.data;
    const pool = getPool();

    const existing = await pool.query<{ status: RollStatus }>(
      'SELECT status FROM fabric_rolls WHERE id=$1 AND company_id=$2',
      [id, companyId],
    );
    if (!existing.rows.length) return sendError(reply, 404, 'الثوب غير موجود', 'NOT_FOUND');
    const oldStatus = existing.rows[0].status;

    const transitionErr = validateStatusTransition(oldStatus, status as RollStatus);
    if (transitionErr) return sendError(reply, 400, transitionErr, 'INVALID_TRANSITION');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const row = await client.query(
        `UPDATE fabric_rolls SET status=$3, updated_at=now()
         WHERE id=$1 AND company_id=$2 RETURNING *`,
        [id, companyId, status],
      );
      await client.query(
        `INSERT INTO inventory_movements
           (company_id, roll_id, movement_type, old_status, new_status, notes, created_by_user_id)
         VALUES ($1,$2,'STATUS_CHANGE',$3,$4,$5,$6)`,
        [companyId, id, oldStatus, status, notes ?? null, userId],
      );
      await client.query('COMMIT');
      return reply.send({ ok: true, data: row.rows[0] });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  // ── F. Move roll ─────────────────────────────────────────────────────────
  app.post('/:id/move', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const { id } = req.params as { id: string };
    const parsed = moveSchema.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    const { toWarehouseId, toLocationId, notes } = parsed.data;
    const pool = getPool();

    const existing = await pool.query<{
      warehouse_id: string; location_id: string | null; status: string;
    }>(
      'SELECT warehouse_id, location_id, status FROM fabric_rolls WHERE id=$1 AND company_id=$2',
      [id, companyId],
    );
    if (!existing.rows.length) return sendError(reply, 404, 'الثوب غير موجود', 'NOT_FOUND');
    const cur = existing.rows[0];

    if (cur.status === 'SOLD' || cur.status === 'INACTIVE') {
      return sendError(reply, 400, 'لا يمكن نقل ثوب مباع أو غير نشط', 'INVALID_STATUS');
    }

    // Validate target warehouse
    const whCheck = await pool.query(
      'SELECT id FROM warehouses WHERE id=$1 AND company_id=$2',
      [toWarehouseId, companyId],
    );
    if (!whCheck.rows.length) return sendError(reply, 404, 'المستودع الهدف غير موجود', 'NOT_FOUND');

    // Validate target location
    if (toLocationId) {
      const locCheck = await pool.query(
        'SELECT id FROM warehouse_locations WHERE id=$1 AND warehouse_id=$2 AND company_id=$3',
        [toLocationId, toWarehouseId, companyId],
      );
      if (!locCheck.rows.length)
        return sendError(reply, 400, 'الموقع المحدد لا يتبع المستودع الهدف', 'VALIDATION');
    }

    const sameWarehouse = cur.warehouse_id === toWarehouseId;
    const movType = sameWarehouse ? 'TRANSFER_IN' : 'TRANSFER_OUT';
    const newStatus = !sameWarehouse && cur.status === 'AVAILABLE' ? 'TRANSFERRED' : cur.status;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const row = await client.query(
        `UPDATE fabric_rolls SET warehouse_id=$3, location_id=$4, status=$5, updated_at=now()
         WHERE id=$1 AND company_id=$2 RETURNING *`,
        [id, companyId, toWarehouseId, toLocationId ?? null, newStatus],
      );
      await client.query(
        `INSERT INTO inventory_movements
           (company_id, roll_id, movement_type,
            from_warehouse_id, to_warehouse_id,
            from_location_id, to_location_id,
            old_status, new_status, notes, created_by_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          companyId, id, movType,
          cur.warehouse_id, toWarehouseId,
          cur.location_id, toLocationId ?? null,
          cur.status, newStatus,
          notes ?? null, userId,
        ],
      );
      await client.query('COMMIT');
      return reply.send({ ok: true, data: row.rows[0] });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  // ── G. Get movement history ────────────────────────────────────────────────
  app.get('/:id/movements', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const pool = getPool();

    const rollCheck = await pool.query(
      'SELECT id FROM fabric_rolls WHERE id=$1 AND company_id=$2',
      [id, companyId],
    );
    if (!rollCheck.rows.length) return sendError(reply, 404, 'الثوب غير موجود', 'NOT_FOUND');

    const rows = await pool.query(
      `SELECT im.*,
              fw.name AS from_warehouse_name, tw.name AS to_warehouse_name,
              fl.name AS from_location_name,  tl.name AS to_location_name,
              u.full_name AS created_by_name
       FROM inventory_movements im
       LEFT JOIN warehouses fw ON fw.id = im.from_warehouse_id
       LEFT JOIN warehouses tw ON tw.id = im.to_warehouse_id
       LEFT JOIN warehouse_locations fl ON fl.id = im.from_location_id
       LEFT JOIN warehouse_locations tl ON tl.id = im.to_location_id
       LEFT JOIN users u ON u.id = im.created_by_user_id
       WHERE im.roll_id = $1
       ORDER BY im.created_at DESC`,
      [id],
    );
    return reply.send({ ok: true, data: rows.rows });
  });
};
