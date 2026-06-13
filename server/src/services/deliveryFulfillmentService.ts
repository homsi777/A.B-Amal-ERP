import type { PoolClient } from 'pg';
import { z } from 'zod';
import { getExchangeRateToUsdTx } from './exchangeRateService.js';
import { INVOICE_AMOUNT_EPS } from './invoiceAmountHelpers.js';
import { quantityToMeters } from './salesInvoiceService.js';

const EPS = INVOICE_AMOUNT_EPS;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function computeUsd(amountOriginal: number, exchangeRateToUsd: number): number {
  if (!Number.isFinite(amountOriginal) || !Number.isFinite(exchangeRateToUsd) || exchangeRateToUsd <= 0) return 0;
  return round2(amountOriginal / exchangeRateToUsd);
}

function computeUsd4(amountOriginal: number, exchangeRateToUsd: number): number {
  if (!Number.isFinite(amountOriginal) || !Number.isFinite(exchangeRateToUsd) || exchangeRateToUsd <= 0) return 0;
  return round4(amountOriginal / exchangeRateToUsd);
}

type SalesLineCostSnapshot = {
  costUnitPrice: number | null;
  costTotal: number | null;
  costCurrencyCode: string | null;
  costExchangeRateToUsd: number | null;
  costUnitPriceUsd: number | null;
  costTotalUsd: number | null;
  costSource: 'FABRIC_ROLL_AT_CONFIRMATION' | 'MISSING';
  costMissing: boolean;
};

async function buildSalesLineCostSnapshot(
  client: PoolClient,
  companyId: string,
  quantityMeters: number,
  unitCost: number | null,
  rollCurrencyCode: string | null,
  invoiceCurrencyCode: string,
  invoiceExchangeRateToUsd: number,
): Promise<SalesLineCostSnapshot> {
  const currencyCode = String(rollCurrencyCode || invoiceCurrencyCode || 'USD').trim().toUpperCase();
  if (unitCost == null || !Number.isFinite(unitCost) || unitCost <= 0) {
    return {
      costUnitPrice: null,
      costTotal: null,
      costCurrencyCode: currencyCode || null,
      costExchangeRateToUsd: null,
      costUnitPriceUsd: null,
      costTotalUsd: null,
      costSource: 'MISSING',
      costMissing: true,
    };
  }

  let exchangeRateToUsd = currencyCode === 'USD' ? 1 : NaN;
  if (currencyCode !== 'USD') {
    const fromDb = await getExchangeRateToUsdTx(client, companyId, currencyCode);
    exchangeRateToUsd =
      fromDb ??
      (currencyCode === invoiceCurrencyCode.trim().toUpperCase() && Number.isFinite(invoiceExchangeRateToUsd)
        ? invoiceExchangeRateToUsd
        : NaN);
  }

  const costTotal = round2(quantityMeters * unitCost);
  const hasUsdRate = Number.isFinite(exchangeRateToUsd) && exchangeRateToUsd > 0;
  return {
    costUnitPrice: round4(unitCost),
    costTotal,
    costCurrencyCode: currencyCode,
    costExchangeRateToUsd: hasUsdRate ? exchangeRateToUsd : null,
    costUnitPriceUsd: hasUsdRate ? computeUsd4(unitCost, exchangeRateToUsd) : null,
    costTotalUsd: hasUsdRate ? computeUsd(costTotal, exchangeRateToUsd) : null,
    costSource: 'FABRIC_ROLL_AT_CONFIRMATION',
    costMissing: !hasUsdRate,
  };
}

export const tafnidLineSchema = z.object({
  lineNo: z.coerce.number().int().positive(),
  tafnidLength: z.coerce.number().positive(),
  lengthUnit: z.enum(['meter', 'yard']).default('meter'),
  fabricRollId: z.string().uuid().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export const saveTafnidSchema = z.object({
  lines: z.array(tafnidLineSchema).min(1),
});

export type DbQuery = Pick<PoolClient, 'query'>;

export async function listDeliveryQueue(
  db: DbQuery,
  companyId: string,
  opts: { search?: string; page?: number; pageSize?: number } = {},
): Promise<{ rows: unknown[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, opts.pageSize ?? 50));
  const offset = (page - 1) * pageSize;

  const conds = [
    'si.company_id = $1',
    "si.document_status = 'CONFIRMED'",
    "si.delivery_status IN ('IN_DELIVERY', 'TAFNID_SAVED')",
  ];
  const params: unknown[] = [companyId];
  let p = 2;

  if (opts.search?.trim()) {
    conds.push(`(si.invoice_no ILIKE $${p} OR c.name ILIKE $${p})`);
    params.push(`%${opts.search.trim()}%`);
    p++;
  }

  const where = conds.join(' AND ');
  const [rows, countRow] = await Promise.all([
    db.query(
      `SELECT si.id, si.invoice_no, si.invoice_date, si.total_amount, si.currency_code,
              si.delivery_status, c.name AS customer_name,
              COALESCE((
                SELECT SUM(sil.quantity)::numeric
                FROM sales_invoice_lines sil
                WHERE sil.invoice_id = si.id AND sil.company_id = si.company_id
                  AND sil.unit = 'roll'
              ), 0) AS roll_count
       FROM sales_invoices si
       INNER JOIN customers c ON c.id = si.customer_id AND c.company_id = si.company_id
       WHERE ${where}
       ORDER BY si.invoice_date DESC, si.created_at DESC
       LIMIT $${p} OFFSET $${p + 1}`,
      [...params, pageSize, offset],
    ),
    db.query(`SELECT COUNT(*)::int AS total FROM sales_invoices si WHERE ${where}`, params),
  ]);

  return { rows: rows.rows, total: countRow.rows[0].total, page, pageSize };
}

export async function countPendingManagerApprovals(db: DbQuery, companyId: string): Promise<number> {
  const r = await db.query<{ total: number }>(
    `SELECT COUNT(*)::int AS total FROM sales_invoices si
     WHERE si.company_id=$1
       AND si.document_status='CONFIRMED'
       AND si.delivery_status='TAFNID_SAVED'`,
    [companyId],
  );
  return r.rows[0]?.total ?? 0;
}

export async function getDeliveryDetail(
  db: DbQuery,
  companyId: string,
  invoiceId: string,
): Promise<{ header: Record<string, unknown>; lines: Record<string, unknown>[] } | null> {
  const h = await db.query(
    `SELECT si.*, c.name AS customer_name
     FROM sales_invoices si
     INNER JOIN customers c ON c.id = si.customer_id AND c.company_id = si.company_id
     WHERE si.id=$1 AND si.company_id=$2 AND si.document_status='CONFIRMED'`,
    [invoiceId, companyId],
  );
  if (!h.rows.length) return null;

  const lines = await db.query(
    `SELECT sil.*, dfl.tafnid_length, dfl.length_unit AS tafnid_length_unit, dfl.fabric_roll_id AS tafnid_roll_id
     FROM sales_invoice_lines sil
     LEFT JOIN delivery_fulfillment_lines dfl
       ON dfl.invoice_line_id = sil.id AND dfl.company_id = sil.company_id AND dfl.roll_seq = 1
     WHERE sil.invoice_id=$1 AND sil.company_id=$2
     ORDER BY sil.line_no`,
    [invoiceId, companyId],
  );

  return { header: h.rows[0], lines: lines.rows };
}

export async function saveDeliveryTafnid(
  client: PoolClient,
  companyId: string,
  invoiceId: string,
  input: z.infer<typeof saveTafnidSchema>,
): Promise<void> {
  const inv = await client.query(
    `SELECT id, delivery_status, document_status FROM sales_invoices
     WHERE id=$1 AND company_id=$2 FOR UPDATE`,
    [invoiceId, companyId],
  );
  if (!inv.rows.length) throw Object.assign(new Error('الفاتورة غير موجودة'), { code: 'NOT_FOUND' });
  const row = inv.rows[0];
  if (row.document_status !== 'CONFIRMED') {
    throw Object.assign(new Error('الفاتورة غير مؤكدة'), { code: 'INVALID_STATE' });
  }
  if (row.delivery_status === 'FULFILLED') {
    throw Object.assign(new Error('تم تسليم هذه الفاتورة مسبقاً'), { code: 'INVALID_STATE' });
  }

  const dbLines = await client.query(
    `SELECT id, line_no FROM sales_invoice_lines WHERE invoice_id=$1 AND company_id=$2`,
    [invoiceId, companyId],
  );
  const lineByNo = new Map(dbLines.rows.map((l) => [Number(l.line_no), String(l.id)]));

  for (const ln of input.lines) {
    const lineId = lineByNo.get(ln.lineNo);
    if (!lineId) {
      throw Object.assign(new Error(`سطر ${ln.lineNo} غير موجود في الفاتورة`), { code: 'VALIDATION' });
    }
    await client.query(
      `INSERT INTO delivery_fulfillment_lines
         (company_id, invoice_id, invoice_line_id, line_no, roll_seq, fabric_roll_id, tafnid_length, length_unit, notes)
       VALUES ($1,$2,$3,$4,1,$5,$6,$7,$8)
       ON CONFLICT (invoice_line_id, roll_seq) DO UPDATE SET
         fabric_roll_id=EXCLUDED.fabric_roll_id,
         tafnid_length=EXCLUDED.tafnid_length,
         length_unit=EXCLUDED.length_unit,
         notes=EXCLUDED.notes,
         updated_at=now()`,
      [
        companyId,
        invoiceId,
        lineId,
        ln.lineNo,
        ln.fabricRollId ?? null,
        ln.tafnidLength,
        ln.lengthUnit,
        ln.notes ?? null,
      ],
    );
  }

  const allLines = await client.query(
    `SELECT sil.id, sil.line_no
     FROM sales_invoice_lines sil
     WHERE sil.invoice_id=$1 AND sil.company_id=$2`,
    [invoiceId, companyId],
  );
  const tafnidRows = await client.query(
    `SELECT invoice_line_id, tafnid_length
     FROM delivery_fulfillment_lines
     WHERE invoice_id=$1 AND company_id=$2 AND roll_seq=1`,
    [invoiceId, companyId],
  );
  const tafnidByLine = new Map(
    tafnidRows.rows.map((r) => [String(r.invoice_line_id), Number(r.tafnid_length)]),
  );
  const allTafnidComplete = allLines.rows.every((ln) => {
    const len = tafnidByLine.get(String(ln.id));
    return Number.isFinite(len) && (len as number) > 0;
  });
  if (allTafnidComplete) {
    await client.query(
      `UPDATE sales_invoices SET delivery_status='TAFNID_SAVED', updated_at=now()
       WHERE id=$1 AND company_id=$2 AND delivery_status IN ('IN_DELIVERY', 'TAFNID_SAVED')`,
      [invoiceId, companyId],
    );
  } else if (row.delivery_status === 'TAFNID_SAVED') {
    await client.query(
      `UPDATE sales_invoices SET delivery_status='IN_DELIVERY', updated_at=now()
       WHERE id=$1 AND company_id=$2`,
      [invoiceId, companyId],
    );
  }
}

async function resolveFabricItemId(
  client: PoolClient,
  companyId: string,
  line: Record<string, unknown>,
): Promise<string | null> {
  const direct = line.fabric_item_id as string | null;
  if (direct) return direct;

  let meta: Record<string, unknown> = {};
  try {
    meta =
      typeof line.metadata === 'string'
        ? (JSON.parse(line.metadata) as Record<string, unknown>)
        : ((line.metadata as Record<string, unknown>) ?? {});
  } catch {
    meta = {};
  }
  const itemId = meta.fabricItemId ?? meta.fabric_item_id;
  if (typeof itemId === 'string' && itemId.length) return itemId;

  const materialName = String(meta.materialName ?? meta.fabricName ?? line.description ?? '').trim();
  const designCode = String(meta.designCode ?? meta.supplierMaterialCode ?? '').trim();
  if (!materialName && !designCode) return null;

  const r = await client.query<{ id: string }>(
    `SELECT id FROM fabric_items
     WHERE company_id=$1 AND is_active=true
       AND (
         ($2 <> '' AND (name ILIKE $2 OR item_code ILIKE $2))
         OR ($3 <> '' AND (item_code ILIKE $3 OR supplier_material_code ILIKE $3))
       )
     ORDER BY created_at ASC
     LIMIT 1`,
    [companyId, materialName ? `%${materialName}%` : '', designCode ? `%${designCode}%` : ''],
  );
  return r.rows[0]?.id ?? null;
}

async function pickAvailableRolls(
  client: PoolClient,
  companyId: string,
  itemId: string,
  count: number,
): Promise<{ id: string; length_m: number; status: string; unit_cost: number | null; currency_code: string | null }[]> {
  const r = await client.query<{
    id: string;
    length_m: string;
    status: string;
    unit_cost: string | null;
    currency_code: string | null;
  }>(
    `SELECT id, length_m, status, unit_cost, currency_code
     FROM fabric_rolls
     WHERE company_id=$1 AND item_id=$2::uuid AND status='AVAILABLE' AND length_m > 0
     ORDER BY created_at ASC
     LIMIT $3 FOR UPDATE`,
    [companyId, itemId, count],
  );
  return r.rows.map((row) => ({
    id: row.id,
    length_m: Number(row.length_m),
    status: row.status,
    unit_cost: row.unit_cost != null ? Number(row.unit_cost) : null,
    currency_code: row.currency_code,
  }));
}

async function deductRollMeters(
  client: PoolClient,
  companyId: string,
  userId: string | null,
  rollId: string,
  qtyM: number,
  invoiceId: string,
  invoiceNo: string,
): Promise<{ unitCost: number | null; currencyCode: string | null; soldM: number }> {
  const rollRow = await client.query<{
    id: string;
    length_m: string;
    status: string;
    unit_cost: string | null;
    currency_code: string | null;
  }>(
    `SELECT id, length_m, status, unit_cost, currency_code FROM fabric_rolls
     WHERE id=$1 AND company_id=$2 FOR UPDATE`,
    [rollId, companyId],
  );
  if (!rollRow.rows.length) {
    throw Object.assign(new Error('الثوب غير موجود'), { code: 'NOT_FOUND' });
  }
  const roll = rollRow.rows[0];
  if (roll.status !== 'AVAILABLE') {
    throw Object.assign(new Error('الثوب غير متاح للتسليم'), { code: 'INVALID_STOCK' });
  }

  const len = Number(roll.length_m);
  if (qtyM > len + EPS) {
    throw Object.assign(new Error('الطول المطلوب أكبر من رصيد الثوب'), { code: 'INVALID_STOCK' });
  }

  const soldQty = Math.min(qtyM, len);
  const newLen = round2(len - soldQty);
  const fullSale = newLen <= EPS;

  if (fullSale) {
    await client.query(
      `UPDATE fabric_rolls SET length_m=0, status='SOLD', updated_at=now() WHERE id=$1 AND company_id=$2`,
      [rollId, companyId],
    );
    await client.query(
      `INSERT INTO inventory_movements (
         company_id, roll_id, movement_type, old_status, new_status,
         length_delta_m, reference_type, reference_id, reference_no, notes, created_by_user_id
       ) VALUES ($1,$2,'SALE',$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        companyId,
        rollId,
        roll.status,
        'SOLD',
        -len,
        'SALES_INVOICE',
        invoiceId,
        invoiceNo,
        `تسليم جملة — ${invoiceNo}`,
        userId,
      ],
    );
  } else {
    await client.query(
      `UPDATE fabric_rolls SET length_m=$3, updated_at=now() WHERE id=$1 AND company_id=$2`,
      [rollId, companyId, newLen],
    );
    await client.query(
      `INSERT INTO inventory_movements (
         company_id, roll_id, movement_type, old_status, new_status,
         length_delta_m, reference_type, reference_id, reference_no, notes, created_by_user_id
       ) VALUES ($1,$2,'SALE',$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        companyId,
        rollId,
        roll.status,
        'AVAILABLE',
        -soldQty,
        'SALES_INVOICE',
        invoiceId,
        invoiceNo,
        `تسليم جزئي — ${invoiceNo}`,
        userId,
      ],
    );
  }

  return {
    unitCost: roll.unit_cost != null ? Number(roll.unit_cost) : null,
    currencyCode: roll.currency_code,
    soldM: soldQty,
  };
}

export async function confirmDeliveryFulfillment(
  client: PoolClient,
  companyId: string,
  userId: string | null,
  invoiceId: string,
): Promise<void> {
  const invRow = await client.query(
    `SELECT * FROM sales_invoices WHERE id=$1 AND company_id=$2 FOR UPDATE`,
    [invoiceId, companyId],
  );
  if (!invRow.rows.length) throw Object.assign(new Error('الفاتورة غير موجودة'), { code: 'NOT_FOUND' });
  const inv = invRow.rows[0];
  if (inv.document_status !== 'CONFIRMED') {
    throw Object.assign(new Error('الفاتورة غير مؤكدة'), { code: 'INVALID_STATE' });
  }
  if (inv.delivery_status === 'FULFILLED') {
    throw Object.assign(new Error('تم التسليم مسبقاً'), { code: 'INVALID_STATE' });
  }
  if (inv.delivery_status !== 'TAFNID_SAVED') {
    throw Object.assign(
      new Error('يجب حفظ التفنيد وانتظار موافقة المدير قبل التسليم'),
      { code: 'INVALID_STATE' },
    );
  }

  const ccy = String(inv.currency_code || 'USD');
  const rate = Number(inv.exchange_rate_to_usd) > 0 ? Number(inv.exchange_rate_to_usd) : NaN;
  const exchangeRateToUsd = ccy.trim().toUpperCase() === 'USD' ? 1 : rate;
  if (!Number.isFinite(exchangeRateToUsd) || exchangeRateToUsd <= 0) {
    throw Object.assign(new Error('لا يمكن التسليم بدون سعر صرف'), { code: 'VALIDATION' });
  }

  const lines = await client.query(
    `SELECT sil.*, dfl.tafnid_length, dfl.length_unit AS tafnid_length_unit, dfl.fabric_roll_id AS assigned_roll_id
     FROM sales_invoice_lines sil
     LEFT JOIN delivery_fulfillment_lines dfl
       ON dfl.invoice_line_id = sil.id AND dfl.company_id = sil.company_id AND dfl.roll_seq = 1
     WHERE sil.invoice_id=$1 AND sil.company_id=$2
     ORDER BY sil.line_no`,
    [invoiceId, companyId],
  );

  for (const ln of lines.rows) {
    const tafnidLen = ln.tafnid_length != null ? Number(ln.tafnid_length) : NaN;
    if (!Number.isFinite(tafnidLen) || tafnidLen <= 0) {
      throw Object.assign(new Error(`يجب تفنيد السطر ${ln.line_no} قبل التسليم`), { code: 'VALIDATION' });
    }

    const lengthUnit = (ln.tafnid_length_unit as 'meter' | 'yard') || 'meter';
    const perRollM = quantityToMeters(tafnidLen, lengthUnit);
    const rollQty = Number(ln.quantity);
    const unit = String(ln.unit);

    if (unit === 'roll') {
      const rollsNeeded = Math.max(1, Math.round(rollQty));
      const itemId = await resolveFabricItemId(client, companyId, ln);
      if (!itemId) {
        throw Object.assign(new Error(`تعذر تحديد الخامة للسطر ${ln.line_no}`), { code: 'VALIDATION' });
      }

      const preassigned = ln.assigned_roll_id as string | null;
      const prebound = ln.fabric_roll_id as string | null;
      const singleRollId = preassigned || prebound;

      if (singleRollId && rollsNeeded === 1) {
        const deducted = await deductRollMeters(
          client,
          companyId,
          userId,
          singleRollId,
          perRollM,
          invoiceId,
          String(inv.invoice_no),
        );
        const costSnapshot = await buildSalesLineCostSnapshot(
          client,
          companyId,
          deducted.soldM,
          deducted.unitCost,
          deducted.currencyCode,
          ccy,
          exchangeRateToUsd,
        );
        await updateLineCostAndMeta(client, companyId, ln, singleRollId, deducted.soldM, costSnapshot);
        continue;
      }

      const picked = await pickAvailableRolls(client, companyId, itemId, rollsNeeded);
      if (picked.length < rollsNeeded) {
        throw Object.assign(
          new Error(`مخزون غير كافٍ للسطر ${ln.line_no}: مطلوب ${rollsNeeded} توب، متاح ${picked.length}`),
          { code: 'INVALID_STOCK' },
        );
      }

      let totalSoldM = 0;
      let weightedCost = 0;
      let costCurrency: string | null = null;
      const rollIds: string[] = [];

      for (const roll of picked) {
        const deducted = await deductRollMeters(
          client,
          companyId,
          userId,
          roll.id,
          perRollM,
          invoiceId,
          String(inv.invoice_no),
        );
        totalSoldM += deducted.soldM;
        if (deducted.unitCost != null) weightedCost += deducted.unitCost * deducted.soldM;
        costCurrency = deducted.currencyCode ?? costCurrency;
        rollIds.push(roll.id);
      }

      const avgUnitCost = totalSoldM > 0 && weightedCost > 0 ? weightedCost / totalSoldM : null;
      const costSnapshot = await buildSalesLineCostSnapshot(
        client,
        companyId,
        totalSoldM,
        avgUnitCost,
        costCurrency,
        ccy,
        exchangeRateToUsd,
      );
      await updateLineCostAndMeta(client, companyId, ln, rollIds[0] ?? null, totalSoldM, costSnapshot, {
        fulfilled_rolls: rollIds,
        tafnid_length_per_roll: tafnidLen,
        tafnid_length_unit: lengthUnit,
      });
    } else if (ln.fabric_roll_id) {
      const qtyM = quantityToMeters(Number(ln.quantity), ln.unit as 'meter' | 'yard');
      const deducted = await deductRollMeters(
        client,
        companyId,
        userId,
        String(ln.fabric_roll_id),
        qtyM,
        invoiceId,
        String(inv.invoice_no),
      );
      const costSnapshot = await buildSalesLineCostSnapshot(
        client,
        companyId,
        deducted.soldM,
        deducted.unitCost,
        deducted.currencyCode,
        ccy,
        exchangeRateToUsd,
      );
      await updateLineCostAndMeta(client, companyId, ln, String(ln.fabric_roll_id), deducted.soldM, costSnapshot);
    }
  }

  await client.query(
    `UPDATE sales_invoices SET delivery_status='FULFILLED', updated_at=now(), updated_by_user_id=$3
     WHERE id=$1 AND company_id=$2`,
    [invoiceId, companyId, userId],
  );
}

async function updateLineCostAndMeta(
  client: PoolClient,
  companyId: string,
  ln: Record<string, unknown>,
  primaryRollId: string | null,
  soldM: number,
  costSnapshot: SalesLineCostSnapshot,
  extraMeta: Record<string, unknown> = {},
): Promise<void> {
  let meta: Record<string, unknown> = {};
  try {
    meta =
      typeof ln.metadata === 'string'
        ? (JSON.parse(ln.metadata) as Record<string, unknown>)
        : ((ln.metadata as Record<string, unknown>) ?? {});
  } catch {
    meta = {};
  }
  meta.inventory = {
    ...(meta.inventory as Record<string, unknown> | undefined),
    fabric_roll_id: primaryRollId,
    qty_sold_m: soldM,
    fulfilled_at: new Date().toISOString(),
    ...extraMeta,
  };

  await client.query(
    `UPDATE sales_invoice_lines SET
       metadata=$3::jsonb,
       cost_unit_price=$4,
       cost_total=$5,
       cost_currency_code=$6,
       cost_exchange_rate_to_usd=$7,
       cost_unit_price_usd=$8,
       cost_total_usd=$9,
       cost_source=$10,
       cost_snapshot_at=now(),
       cost_missing=$11
     WHERE id=$1 AND company_id=$2`,
    [
      ln.id,
      companyId,
      JSON.stringify(meta),
      costSnapshot.costUnitPrice,
      costSnapshot.costTotal,
      costSnapshot.costCurrencyCode,
      costSnapshot.costExchangeRateToUsd,
      costSnapshot.costUnitPriceUsd,
      costSnapshot.costTotalUsd,
      costSnapshot.costSource,
      costSnapshot.costMissing,
    ],
  );
}
