/**
 * Behavioral: editing one roll must not mutate sibling rolls or shared masters.
 * Mirrors PUT /api/inventory/rolls/:id WHERE id AND company_id.
 */
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';
import { resolveFabricClassificationWithClient } from '../services/fabricClassificationService.js';

type Row = Record<string, unknown>;

const COMPANY = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTHER_COMPANY = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const ITEM = '55555555-5555-5555-5555-555555555555';
const COLOR = '66666666-6666-6666-6666-666666666666';
const ROLL1 = '77777777-7777-7777-7777-777777777771';
const ROLL2 = '77777777-7777-7777-7777-777777777772';
const L1 = '11111111-1111-1111-1111-111111111111';
const L2 = '22222222-2222-2222-2222-222222222222';
const L3 = '33333333-3333-3333-3333-333333333333';
const L4 = '44444444-4444-4444-4444-444444444444';

function norm(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** In-memory fake DB for rolls + masters. */
function createInventoryDb() {
  const items: Row[] = [
    {
      id: ITEM,
      company_id: COMPANY,
      name: 'trio',
      internal_code: 'IMP-AUTO-TRIO',
      supplier_code: 'IMP-AUTO-TRIO',
      updated_at: 't0',
    },
  ];
  const colors: Row[] = [
    {
      id: COLOR,
      company_id: COMPANY,
      name_ar: 'اسود',
      color_code: 'اسود',
      updated_at: 't0',
    },
  ];
  const rolls: Row[] = [
    {
      id: ROLL1,
      company_id: COMPANY,
      item_id: ITEM,
      color_id: COLOR,
      length_m: 10,
      notes: 'a',
      updated_at: 't0',
    },
    {
      id: ROLL2,
      company_id: COMPANY,
      item_id: ITEM,
      color_id: COLOR,
      length_m: 20,
      notes: 'b',
      updated_at: 't0',
    },
  ];
  const stmts: { sql: string; params?: unknown[]; rowCount: number }[] = [];
  const cats = [
    { id: L1, parent_id: null as string | null, code: 'trio', name: 'trio' },
    { id: L2, parent_id: L1, code: 'IMP-AUTO-TRIO', name: 'IMP-AUTO-TRIO' },
    { id: L3, parent_id: L2, code: 'اسود', name: 'اسود' },
    { id: L4, parent_id: L3, code: 'اسود', name: 'اسود' },
  ];

  const client = {
    async query(sql: string, params?: unknown[]) {
      const s = norm(sql);
      let rowCount = 0;

      if (s.includes('from fabric_categories') && s.includes('id = any')) {
        const ids = (params?.[1] as string[]) ?? [];
        const companyId = String(params?.[0]);
        const rows = companyId === COMPANY ? cats.filter((c) => ids.includes(c.id)) : [];
        rowCount = rows.length;
        stmts.push({ sql, params, rowCount });
        return { rows, rowCount };
      }

      if (s.includes('from fabric_items') && s.includes('lower(trim(name))')) {
        const companyId = String(params?.[0]);
        const name = String(params?.[1] ?? '');
        const code = String(params?.[2] ?? '');
        const rows = items.filter(
          (i) =>
            i.company_id === companyId
            && String(i.name).toLowerCase() === name.toLowerCase()
            && (
              String(i.internal_code).toLowerCase() === code.toLowerCase()
              || String(i.supplier_code ?? '').toLowerCase() === code.toLowerCase()
            ),
        );
        rowCount = rows.length;
        stmts.push({ sql, params, rowCount });
        return { rows: rows.map((r) => ({ id: r.id, internal_code: r.internal_code })), rowCount };
      }

      if (s.includes('from fabric_items') && s.includes('<>')) {
        stmts.push({ sql, params, rowCount: 0 });
        return { rows: [], rowCount: 0 };
      }

      if (s.includes('from fabric_colors')) {
        const companyId = String(params?.[0]);
        const name = String(params?.[1] ?? '');
        const rows = colors.filter(
          (c) =>
            c.company_id === companyId
            && String(c.name_ar).toLowerCase() === name.toLowerCase(),
        );
        rowCount = rows.length;
        stmts.push({ sql, params, rowCount });
        return { rows: rows.map((r) => ({ id: r.id })), rowCount };
      }

      if (s.includes('from fabric_item_variants')) {
        stmts.push({ sql, params, rowCount: 0 });
        return { rows: [], rowCount: 0 };
      }

      // Mirror production PUT roll update contract
      if (s.startsWith('update fabric_rolls set') && s.includes('where id=$1 and company_id=$2')) {
        const id = String(params?.[0]);
        const companyId = String(params?.[1]);
        const lengthM = params?.[2];
        const notes = params?.[3];
        const affected = rolls.filter((r) => r.id === id && r.company_id === companyId);
        for (const r of affected) {
          if (lengthM !== undefined && lengthM !== null) r.length_m = lengthM;
          if (notes !== undefined) r.notes = notes;
          r.updated_at = 't1';
        }
        rowCount = affected.length;
        stmts.push({ sql, params, rowCount });
        return { rows: affected, rowCount };
      }

      if (s.startsWith('update fabric_items') || s.startsWith('update fabric_colors')) {
        rowCount = 1;
        stmts.push({ sql, params, rowCount });
        return { rows: [], rowCount };
      }

      if (s.startsWith('insert into')) {
        stmts.push({ sql, params, rowCount: 1 });
        return { rows: [{ id: 'new' }], rowCount: 1 };
      }

      throw new Error(`Unexpected SQL: ${sql.slice(0, 180)}`);
    },
  } as unknown as PoolClient;

  return { client, items, colors, rolls, stmts };
}

/** Same WHERE shape as fabricRollRoutes PUT /:id */
async function updateOneRollOperational(
  client: PoolClient,
  companyId: string,
  rollId: string,
  fields: { lengthM: number; notes: string },
) {
  return client.query(
    `UPDATE fabric_rolls SET
       length_m = $3,
       notes = $4,
       updated_at = now()
     WHERE id=$1 AND company_id=$2
     RETURNING *`,
    [rollId, companyId, fields.lengthM, fields.notes],
  );
}

async function main() {
  const db = createInventoryDb();
  const itemBefore = JSON.stringify(db.items[0]);
  const colorBefore = JSON.stringify(db.colors[0]);
  const roll2Before = JSON.stringify(db.rolls[1]);

  const resolved = await resolveFabricClassificationWithClient(db.client, {
    companyId: COMPANY,
    level1CategoryId: L1,
    level2CategoryId: L2,
    level3CategoryId: L3,
    level4CategoryId: L4,
  });
  assert.equal(resolved.itemId, ITEM);
  assert.equal(resolved.colorId, COLOR);
  assert.equal(
    db.stmts.filter((s) => norm(s.sql).startsWith('update fabric_items') || norm(s.sql).startsWith('update fabric_colors')).length,
    0,
  );

  const upd = await updateOneRollOperational(db.client, COMPANY, ROLL1, {
    lengthM: 11.5,
    notes: 'edited-only-first',
  });
  assert.equal(upd.rowCount, 1);
  assert.equal(db.rolls[0].length_m, 11.5);
  assert.equal(db.rolls[0].notes, 'edited-only-first');
  assert.equal(JSON.stringify(db.rolls[1]), roll2Before);
  assert.equal(JSON.stringify(db.items[0]), itemBefore);
  assert.equal(JSON.stringify(db.colors[0]), colorBefore);

  const bad = await updateOneRollOperational(db.client, OTHER_COMPANY, ROLL1, {
    lengthM: 99,
    notes: 'cross-company',
  });
  assert.equal(bad.rowCount, 0);
  assert.equal(db.rolls[0].length_m, 11.5);

  const whereSql = db.stmts.find((s) => norm(s.sql).startsWith('update fabric_rolls'))!.sql;
  assert.match(norm(whereSql), /where id=\$1 and company_id=\$2/);

  console.log('inventoryRollEditIsolation.test.ts OK');
}

await main();
