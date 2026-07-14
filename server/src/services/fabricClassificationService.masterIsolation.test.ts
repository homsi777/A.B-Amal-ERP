/**
 * Behavioral isolation tests for resolveFabricClassificationWithClient.
 * Uses a recording fake PoolClient — no source-regex checks.
 * Run via: npm test
 */
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';
import { resolveFabricClassificationWithClient } from './fabricClassificationService.js';

type Stmt = { sql: string; params?: unknown[] };

const COMPANY_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const COMPANY_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const L1 = '11111111-1111-1111-1111-111111111111';
const L2 = '22222222-2222-2222-2222-222222222222';
const L3 = '33333333-3333-3333-3333-333333333333';
const L4 = '44444444-4444-4444-4444-444444444444';
const ITEM_ID = '55555555-5555-5555-5555-555555555555';
const COLOR_ID = '66666666-6666-6666-6666-666666666666';

function normSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().toLowerCase();
}

function createRecordingClient(opts: {
  existingItem?: boolean;
  existingColor?: boolean;
  failAfterItemLookup?: boolean;
}): { client: PoolClient; stmts: Stmt[]; released: { value: boolean } } {
  const stmts: Stmt[] = [];
  const released = { value: false };
  const cats = [
    { id: L1, parent_id: null as string | null, code: 'trio', name: 'trio' },
    { id: L2, parent_id: L1, code: 'IMP-AUTO-TRIO', name: 'IMP-AUTO-TRIO' },
    { id: L3, parent_id: L2, code: 'اسود', name: 'اسود' },
    { id: L4, parent_id: L3, code: 'اسود', name: 'اسود' },
  ];

  const client = {
    release() {
      released.value = true;
    },
    async query(sql: string, params?: unknown[]) {
      stmts.push({ sql, params });
      const s = normSql(sql);

      if (s === 'begin' || s === 'commit' || s === 'rollback') return { rows: [] };

      if (s.includes('from fabric_categories') && s.includes('id = any')) {
        const companyId = String(params?.[0] ?? '');
        // company isolation: empty when wrong company
        if (companyId !== COMPANY_A) return { rows: [] };
        const ids = (params?.[1] as string[]) ?? [];
        return { rows: cats.filter((c) => ids.includes(c.id)) };
      }

      if (
        s.includes('from fabric_items')
        && s.includes('lower(trim(name))')
        && (s.includes('internal_code') || s.includes('supplier_code'))
      ) {
        const companyId = String(params?.[0] ?? '');
        if (companyId !== COMPANY_A) return { rows: [] };
        if (opts.existingItem) {
          return { rows: [{ id: ITEM_ID, internal_code: 'IMP-AUTO-TRIO' }] };
        }
        return { rows: [] };
      }

      // collision helper used when creating
      if (s.includes('from fabric_items') && s.includes('<>')) {
        return { rows: [] };
      }

      if (s.includes('from fabric_colors')) {
        const companyId = String(params?.[0] ?? '');
        if (companyId !== COMPANY_A) return { rows: [] };
        if (opts.existingColor) return { rows: [{ id: COLOR_ID }] };
        return { rows: [] };
      }

      if (s.includes('from fabric_item_variants')) {
        return { rows: [] };
      }

      if (s.startsWith('insert into fabric_items')) {
        return { rows: [{ id: 'new-item-id', internal_code: String(params?.[2] ?? 'CODE') }] };
      }
      if (s.startsWith('insert into fabric_colors')) {
        return { rows: [{ id: 'new-color-id' }] };
      }
      if (s.startsWith('insert into fabric_item_variants')) {
        return { rows: [{ id: 'new-variant-id' }] };
      }

      if (s.startsWith('update ')) {
        return { rows: [], rowCount: 1 };
      }

      if (opts.failAfterItemLookup && s.includes('from fabric_colors')) {
        throw Object.assign(new Error('forced failure'), { statusCode: 500 });
      }

      throw new Error(`Unexpected SQL: ${sql.slice(0, 160)}`);
    },
  } as unknown as PoolClient;

  return { client, stmts, released };
}

function isMasterUpdate(sql: string): boolean {
  const s = normSql(sql);
  return (
    s.startsWith('update fabric_items')
    || s.startsWith('update fabric_colors')
  );
}

async function testExistingMastersAreRelinkedNotMutated() {
  const { client, stmts } = createRecordingClient({ existingItem: true, existingColor: true });
  const result = await resolveFabricClassificationWithClient(client, {
    companyId: COMPANY_A,
    level1CategoryId: L1,
    level2CategoryId: L2,
    level3CategoryId: L3,
    level4CategoryId: L4,
  });

  assert.equal(result.itemId, ITEM_ID);
  assert.equal(result.colorId, COLOR_ID);
  assert.equal(result.created.item, false);
  assert.equal(result.created.color, false);
  assert.equal(stmts.filter((x) => isMasterUpdate(x.sql)).length, 0);
  assert.equal(stmts.filter((x) => normSql(x.sql).startsWith('insert into fabric_items')).length, 0);
  assert.equal(stmts.filter((x) => normSql(x.sql).startsWith('insert into fabric_colors')).length, 0);
}

async function testMissingMastersAreCreatedOnce() {
  const { client, stmts } = createRecordingClient({ existingItem: false, existingColor: false });
  const result = await resolveFabricClassificationWithClient(client, {
    companyId: COMPANY_A,
    level1CategoryId: L1,
    level2CategoryId: L2,
    level3CategoryId: L3,
    level4CategoryId: L4,
  });

  assert.equal(result.itemId, 'new-item-id');
  assert.equal(result.colorId, 'new-color-id');
  assert.equal(result.created.item, true);
  assert.equal(result.created.color, true);
  assert.equal(stmts.filter((x) => isMasterUpdate(x.sql)).length, 0);
  assert.equal(stmts.filter((x) => normSql(x.sql).startsWith('insert into fabric_items')).length, 1);
  assert.equal(stmts.filter((x) => normSql(x.sql).startsWith('insert into fabric_colors')).length, 1);
}

async function testCompanyIsolation() {
  const { client } = createRecordingClient({ existingItem: true, existingColor: true });
  await assert.rejects(
    () =>
      resolveFabricClassificationWithClient(client, {
        companyId: COMPANY_B,
        level1CategoryId: L1,
        level2CategoryId: L2,
        level3CategoryId: L3,
        level4CategoryId: L4,
      }),
    (err: unknown) => (err as { statusCode?: number }).statusCode === 404,
  );
}

async function testTransactionalWrapperRollback() {
  // Simulate resolveFabricClassification catch path: BEGIN then failure then ROLLBACK.
  const stmts: Stmt[] = [];
  let began = false;
  let rolledBack = false;
  const client = {
    release() {},
    async query(sql: string, params?: unknown[]) {
      stmts.push({ sql, params });
      const s = normSql(sql);
      if (s === 'begin') {
        began = true;
        return { rows: [] };
      }
      if (s === 'rollback') {
        rolledBack = true;
        return { rows: [] };
      }
      if (s === 'commit') return { rows: [] };
      throw new Error('boom after begin');
    },
  } as unknown as PoolClient;

  try {
    await client.query('BEGIN');
    await resolveFabricClassificationWithClient(client, {
      companyId: COMPANY_A,
      level1CategoryId: L1,
      level2CategoryId: L2,
    });
    await client.query('COMMIT');
    assert.fail('expected throw');
  } catch {
    await client.query('ROLLBACK');
  }

  assert.equal(began, true);
  assert.equal(rolledBack, true);
  assert.equal(stmts.some((x) => normSql(x.sql) === 'commit'), false);
}

await testExistingMastersAreRelinkedNotMutated();
await testMissingMastersAreCreatedOnce();
await testCompanyIsolation();
await testTransactionalWrapperRollback();
console.log('fabricClassificationService.masterIsolation.test.ts OK');
