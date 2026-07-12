import assert from 'node:assert/strict';
import test from 'node:test';
import { findImportMaterialCodeCollision } from './purchaseImportMaterialCodes.js';

type QueryResult<T> = { rows: T[] };

function mockDb(steps: Array<() => QueryResult<{ id: string; name?: string }>>) {
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
    () => ({ rows: [{ id: 'item-1' }] }),
    () => ({ rows: [{ id: 'item-1', name: 'WİNTER SARDONLU' }] }),
  ]);
  const hit = await findImportMaterialCodeCollision(db, 'co-1', 'WİNTER SARDONLU', 'CLO-2');
  assert.equal(hit, null);
});

test('findImportMaterialCodeCollision detects code owned by different material', async () => {
  const db = mockDb([
    () => ({ rows: [{ id: 'astrl-item' }] }),
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
