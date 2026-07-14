import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findFabricItemForPurchaseImport,
  findImportMaterialCodeCollision,
} from './purchaseImportMaterialCodes.js';

type QueryResult<T> = { rows: T[] };

function mockDb(steps: Array<() => QueryResult<Record<string, unknown>>>) {
  let i = 0;
  return {
    query: async () => {
      const fn = steps[i++];
      if (!fn) throw new Error(`unexpected query #${i}`);
      return fn();
    },
  };
}

test('findImportMaterialCodeCollision returns null when names match', async () => {
  const db = mockDb([
    () => ({ rows: [{ id: 'item-1', internal_code: 'CLO-2', supplier_code: 'CLO-2' }] }),
    () => ({ rows: [{ id: 'item-1', name: 'WİNTER SARDONLU' }] }),
  ]);
  const hit = await findImportMaterialCodeCollision(db, 'co-1', 'WİNTER SARDONLU', 'CLO-2');
  assert.equal(hit, null);
});

test('findImportMaterialCodeCollision detects code owned by different material', async () => {
  const db = mockDb([
    () => ({ rows: [{ id: 'astrl-item', internal_code: 'CLO-2', supplier_code: 'CLO-2' }] }),
    () => ({ rows: [{ id: 'astrl-item', name: 'ASTRLI EKOSE' }] }),
  ]);
  const hit = await findImportMaterialCodeCollision(db, 'co-1', 'WİNTER SARDONLU', 'CLO-2');
  assert.deepEqual(hit, { id: 'astrl-item', name: 'ASTRLI EKOSE' });
});

test('findImportMaterialCodeCollision returns null when code is free', async () => {
  const db = mockDb([() => ({ rows: [] })]);
  const hit = await findImportMaterialCodeCollision(db, 'co-1', 'WİNTER SARDONLU', 'CLO-2');
  assert.equal(hit, null);
});

test('findFabricItemForPurchaseImport prefers internal_code match', async () => {
  const db = mockDb([
    () => ({
      rows: [{ id: 'item-7023', internal_code: '7023', supplier_code: '7023' }],
    }),
  ]);
  const id = await findFabricItemForPurchaseImport(db, 'co-1', 'ROYAL JAKAR', '7023');
  assert.equal(id, 'item-7023');
});

test('findFabricItemForPurchaseImport rejects supplier hit when internal is another design', async () => {
  const db = mockDb([
    () => ({
      rows: [{ id: 'item-36-1', internal_code: '36-1', supplier_code: '7023' }],
    }),
  ]);
  const id = await findFabricItemForPurchaseImport(db, 'co-1', 'ROYAL JAKAR', '7023');
  assert.equal(id, null);
});

test('findFabricItemForPurchaseImport accepts exact internal 36-1', async () => {
  const db = mockDb([
    () => ({
      rows: [{ id: 'item-36-1', internal_code: '36-1', supplier_code: '36-1' }],
    }),
  ]);
  const id = await findFabricItemForPurchaseImport(db, 'co-1', 'ROYAL JAKAR', '36-1');
  assert.equal(id, 'item-36-1');
});
