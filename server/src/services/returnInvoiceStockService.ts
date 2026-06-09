import type { PoolClient } from 'pg';
import { quantityToMeters } from './salesInvoiceService.js';

const EPS = 1e-4;

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export type ReturnLineStockInput = {
  fabricRollId: string | null;
  quantity: number;
  unit: 'meter' | 'yard';
};

export type CogsLineForReturn = { quantityMeters: number; unitCostPerMeter: number | null };

/**
 * If any line carries a roll id with positive qty, every positive-qty line must specify a roll
 * (mixed monetary + physical lines would break stock vs GL alignment).
 */
export function validateReturnStockLineCoverage(lines: ReturnLineStockInput[]): void {
  const zeroQtyWithRoll = lines.find((l) => l.fabricRollId && l.quantity <= EPS);
  if (zeroQtyWithRoll) {
    throw Object.assign(new Error('لا يمكن ربط توب بكمية صفرية'), { code: 'VALIDATION' });
  }
  const hasStockLine = lines.some((l) => l.fabricRollId && l.quantity > EPS);
  if (!hasStockLine) return;
  const bad = lines.find((l) => l.quantity > EPS && !l.fabricRollId);
  if (bad) {
    throw Object.assign(
      new Error('عند ربط توب واحد أو أكثر يجب ربط كل البنود ذات الكمية بتوب لاستعادة المخزون بشكل صحيح'),
      { code: 'VALIDATION' },
    );
  }
}

/**
 * Apply inventory for a confirmed return (same DB transaction as GL posting).
 */
export async function applyReturnInvoiceInventory(
  client: PoolClient,
  input: {
    companyId: string;
    userId: string | null;
    returnInvoiceId: string;
    returnNo: string;
    returnType: 'SALES_RETURN' | 'PURCHASE_RETURN';
    lines: ReturnLineStockInput[];
  },
): Promise<{ linesForCogs: CogsLineForReturn[] }> {
  const linesForCogs: CogsLineForReturn[] = [];

  validateReturnStockLineCoverage(input.lines);

  for (const ln of input.lines) {
    if (!ln.fabricRollId || ln.quantity <= EPS) continue;
    const qtyM = round3(quantityToMeters(ln.quantity, ln.unit));
    if (qtyM <= EPS) continue;

    const rr = await client.query<{
      id: string;
      length_m: string;
      status: string;
      unit_cost: string | null;
      barcode: string;
    }>(`SELECT id, length_m, status, unit_cost, barcode FROM fabric_rolls WHERE id=$1 AND company_id=$2 FOR UPDATE`, [
      ln.fabricRollId,
      input.companyId,
    ]);
    if (!rr.rows.length) {
      throw Object.assign(new Error('التوب غير موجود'), { code: 'NOT_FOUND' });
    }
    const roll = rr.rows[0];
    const curLen = Number(roll.length_m);
    const curStatus = roll.status;
    const uc = roll.unit_cost != null ? Number(roll.unit_cost) : null;
    linesForCogs.push({ quantityMeters: qtyM, unitCostPerMeter: uc });

    if (input.returnType === 'SALES_RETURN') {
      if (curStatus !== 'SOLD' && curStatus !== 'AVAILABLE') {
        throw Object.assign(
          new Error(`التوب ${roll.barcode} غير قابل للإرجاع للمخزون (الحالة: ${curStatus})`),
          { code: 'INVALID_STOCK' },
        );
      }
      const newLen = round3(curLen + qtyM);
      const newStatus = curStatus === 'SOLD' ? (newLen > EPS ? 'AVAILABLE' : 'SOLD') : 'AVAILABLE';
      await client.query(
        `UPDATE fabric_rolls SET length_m=$3, status=$4, updated_at=now() WHERE id=$1 AND company_id=$2`,
        [ln.fabricRollId, input.companyId, newLen, newStatus],
      );
      await client.query(
        `INSERT INTO inventory_movements (
           company_id, roll_id, movement_type, old_status, new_status,
           length_delta_m, reference_type, reference_id, reference_no, notes, created_by_user_id
         ) VALUES ($1,$2,'RETURN',$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          input.companyId,
          ln.fabricRollId,
          curStatus,
          newStatus,
          qtyM,
          'RETURN_INVOICE',
          input.returnInvoiceId,
          input.returnNo,
          `مرتجع مبيعات — ${input.returnNo}`,
          input.userId,
        ],
      );
    } else {
      if (curStatus !== 'AVAILABLE' && curStatus !== 'RESERVED') {
        throw Object.assign(
          new Error(`التوب ${roll.barcode} غير متاح لمرتجع مشتريات (الحالة: ${curStatus})`),
          { code: 'INVALID_STOCK' },
        );
      }
      if (qtyM > curLen + EPS) {
        throw Object.assign(new Error(`كمية المرتجع أكبر من رصيد المتر على التوب ${roll.barcode}`), {
          code: 'INVALID_STOCK',
        });
      }
      const newLen = round3(Math.max(0, curLen - qtyM));
      const newStatus = newLen <= EPS ? 'INACTIVE' : curStatus;
      await client.query(
        `UPDATE fabric_rolls SET length_m=$3, status=$4, updated_at=now() WHERE id=$1 AND company_id=$2`,
        [ln.fabricRollId, input.companyId, newLen, newStatus],
      );
      await client.query(
        `INSERT INTO inventory_movements (
           company_id, roll_id, movement_type, old_status, new_status,
           length_delta_m, reference_type, reference_id, reference_no, notes, created_by_user_id
         ) VALUES ($1,$2,'ADJUSTMENT',$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          input.companyId,
          ln.fabricRollId,
          curStatus,
          newStatus,
          -qtyM,
          'RETURN_INVOICE',
          input.returnInvoiceId,
          input.returnNo,
          `مرتجع مشتريات — إخراج مخزون — ${input.returnNo}`,
          input.userId,
        ],
      );
    }
  }

  return { linesForCogs };
}

/** Undo inventory changes created for this return before reversing GL. */
export async function reverseReturnInvoiceInventory(
  client: PoolClient,
  input: { companyId: string; userId: string | null; returnInvoiceId: string; returnNo: string },
): Promise<void> {
  const dupRev = await client.query(
    `SELECT 1 FROM inventory_movements
     WHERE company_id=$1 AND reference_type='RETURN_INVOICE_REVERSAL' AND reference_id=$2
     LIMIT 1`,
    [input.companyId, input.returnInvoiceId],
  );
  if (dupRev.rows.length) return;

  const movements = await client.query<{
    roll_id: string;
    movement_type: string;
    old_status: string | null;
    length_delta_m: string | null;
  }>(
    `SELECT roll_id, movement_type, old_status, length_delta_m
     FROM inventory_movements
     WHERE company_id=$1 AND reference_type='RETURN_INVOICE' AND reference_id=$2
     ORDER BY created_at DESC`,
    [input.companyId, input.returnInvoiceId],
  );
  if (!movements.rows.length) return;

  for (const m of movements.rows) {
    const delta = Number(m.length_delta_m ?? 0);
    const rollId = m.roll_id;

    const r = await client.query<{ length_m: string; status: string }>(
      `SELECT length_m, status FROM fabric_rolls WHERE id=$1 AND company_id=$2 FOR UPDATE`,
      [rollId, input.companyId],
    );
    if (!r.rows.length) continue;
    const curLen = Number(r.rows[0].length_m);
    const curStatus = r.rows[0].status;

    let newLen: number;
    let restoreStatus: string;
    if (m.movement_type === 'RETURN' && delta > EPS) {
      newLen = round3(Math.max(0, curLen - delta));
      restoreStatus = m.old_status && m.old_status.length ? m.old_status : curStatus;
    } else if (m.movement_type === 'ADJUSTMENT' && delta < -EPS) {
      newLen = round3(curLen + Math.abs(delta));
      restoreStatus = m.old_status && m.old_status.length ? m.old_status : 'AVAILABLE';
    } else {
      continue;
    }

    const lenDelta = round3(newLen - curLen);

    await client.query(
      `UPDATE fabric_rolls SET length_m=$3, status=$4, updated_at=now() WHERE id=$1 AND company_id=$2`,
      [rollId, input.companyId, newLen, restoreStatus],
    );

    await client.query(
      `INSERT INTO inventory_movements (
         company_id, roll_id, movement_type, old_status, new_status,
         length_delta_m, reference_type, reference_id, reference_no, notes, created_by_user_id
       ) VALUES ($1,$2,'ADJUSTMENT',$3,$4,$5,'RETURN_INVOICE_REVERSAL',$6,$7,$8,$9)`,
      [
        input.companyId,
        rollId,
        curStatus,
        restoreStatus,
        lenDelta,
        input.returnInvoiceId,
        input.returnNo,
        `عكس حركة مرتجع — ${input.returnNo}`,
        input.userId,
      ],
    );
  }
}
