/**
 * Behavioral: the "stuck roll" repair may only free rolls whose *only* sales
 * history is a voided invoice. A roll sold again on a live invoice is owned by
 * that invoice — voiding an older one must never hand it back to inventory.
 *
 * Regression: rolls 3289620/3289621 were released back to AVAILABLE minutes
 * after being sold on the confirmed FB0000111, because they also appeared on
 * the earlier voided FB0000108.
 */
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';
import { repairRollStuckAfterVoidedSale } from './salesInvoiceService.js';

type Row = Record<string, unknown>;

const COMPANY = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

function norm(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().toLowerCase();
}

interface Fixture {
  /** barcode of the roll under test */
  barcode: string;
  status: string;
  lengthM: number;
  /** document_status of every sales invoice line pointing at this roll */
  lineInvoiceStatuses: string[];
}

interface Recorded {
  updates: unknown[][];
  movements: unknown[][];
}

/**
 * Fake client that evaluates the repair SELECT against a single-roll fixture.
 * The NOT EXISTS guard is honoured only when the query actually carries it, so
 * the unguarded query fails this suite instead of silently passing.
 */
function createClient(fx: Fixture, rec: Recorded): PoolClient {
  const rollId = '77777777-7777-7777-7777-777777777771';

  const query = async (sql: string, params: unknown[] = []) => {
    const q = norm(sql);

    if (q.startsWith('select') && q.includes('from fabric_rolls fr')) {
      const token = String(params[1] ?? '');
      const matchesToken = token.toLowerCase() === fx.barcode.toLowerCase();
      const hasVoidedLine = fx.lineInvoiceStatuses.includes('VOIDED');
      const statusStuck = ['SOLD', 'RESERVED'].includes(fx.status);

      const guarded =
        q.includes('not exists') && q.includes("document_status <> 'voided'");
      const ownedByLiveInvoice = fx.lineInvoiceStatuses.some((s) => s !== 'VOIDED');

      const hit =
        matchesToken &&
        hasVoidedLine &&
        statusStuck &&
        !(guarded && ownedByLiveInvoice);

      const row: Row = {
        roll_id: rollId,
        length_m: String(fx.lengthM),
        status: fx.status,
        metadata: { inventory: { fabric_roll_id: rollId, prev_length_m: 32.7, prev_status: 'AVAILABLE' } },
        quantity: '32.7',
        unit: 'meter',
        invoice_id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
        invoice_no: 'FB0000108',
      };
      return { rows: hit ? [row] : [], rowCount: hit ? 1 : 0 };
    }

    if (q.startsWith('update fabric_rolls')) {
      rec.updates.push(params);
      return { rows: [], rowCount: 1 };
    }

    if (q.startsWith('insert into inventory_movements')) {
      rec.movements.push(params);
      return { rows: [], rowCount: 1 };
    }

    throw new Error(`unexpected query: ${q.slice(0, 90)}`);
  };

  return { query } as unknown as PoolClient;
}

async function run(fx: Fixture): Promise<{ repaired: boolean } & Recorded> {
  const rec: Recorded = { updates: [], movements: [] };
  const repaired = await repairRollStuckAfterVoidedSale(
    createClient(fx, rec),
    COMPANY,
    USER,
    fx.barcode,
  );
  return { repaired, ...rec };
}

// ── 1) Genuinely stuck: voided invoice is the roll's only sales history ──────
{
  const r = await run({
    barcode: '3289621',
    status: 'SOLD',
    lengthM: 0,
    lineInvoiceStatuses: ['VOIDED'],
  });
  assert.equal(r.repaired, true, 'roll left stuck by a voided sale must be freed');
  assert.equal(r.updates.length, 1, 'exactly one roll update');
  assert.equal(r.updates[0][3], 'AVAILABLE', 'roll returns to AVAILABLE');
  assert.equal(r.updates[0][2], 32.7, 'roll length restored from the snapshot');
  assert.equal(r.movements.length, 1, 'the release is written to the movement log');
}

// ── 2) Regression: also sold on a CONFIRMED invoice — must be left alone ─────
{
  const r = await run({
    barcode: '3289621',
    status: 'SOLD',
    lengthM: 0,
    lineInvoiceStatuses: ['VOIDED', 'CONFIRMED'],
  });
  assert.equal(r.repaired, false, 'a roll sold on a confirmed invoice is not stuck');
  assert.equal(r.updates.length, 0, 'inventory must not be touched');
  assert.equal(r.movements.length, 0, 'no phantom RETURN movement');
}

// ── 3) Reserved by a live DRAFT invoice — must be left alone ─────────────────
{
  const r = await run({
    barcode: '3289620',
    status: 'RESERVED',
    lengthM: 35.1,
    lineInvoiceStatuses: ['VOIDED', 'DRAFT'],
  });
  assert.equal(r.repaired, false, 'a roll reserved by a live draft is not stuck');
  assert.equal(r.updates.length, 0, 'the draft keeps its reservation');
}

// ── 4) Unknown barcode is a no-op ───────────────────────────────────────────
{
  const r = await run({
    barcode: '3289621',
    status: 'SOLD',
    lengthM: 0,
    lineInvoiceStatuses: ['VOIDED'],
  });
  assert.equal(r.repaired, true);

  const rec: Recorded = { updates: [], movements: [] };
  const miss = await repairRollStuckAfterVoidedSale(
    createClient({ barcode: '3289621', status: 'SOLD', lengthM: 0, lineInvoiceStatuses: ['VOIDED'] }, rec),
    COMPANY,
    USER,
    '0000000',
  );
  assert.equal(miss, false, 'a barcode with no stuck roll changes nothing');
  assert.equal(rec.updates.length, 0);
}

console.log('repairRollStuckAfterVoidedSale.test.ts — 4 حالات ✓');
