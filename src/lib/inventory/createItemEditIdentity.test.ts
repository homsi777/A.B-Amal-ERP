/**
 * Behavioral tests for CreateItem edit identity resolution.
 */
import assert from 'node:assert/strict';
import {
  createItemEditFailureMessage,
  resolveFabricItemForCreateItemEdit,
} from './createItemEditIdentity.js';

const candidates = [
  { id: 'item-winter', name: 'WİNTER SARDONLU', internal_code: 'CLO-2', supplier_code: 'CLO-2' },
  { id: 'item-astrl', name: 'ASTRLI EKOSE', internal_code: 'IMP-ASTRLI-EKOSE-CLO-2', supplier_code: 'CLO-2' },
  { id: 'item-trio', name: 'trio', internal_code: 'IMP-AUTO-TRIO', supplier_code: null },
];

{
  const r = resolveFabricItemForCreateItemEdit(
    { fabricItemId: 'item-trio', originalName: 'changed', originalCode: 'CHANGED' },
    candidates,
  );
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.item.id, 'item-trio');
    assert.equal(r.source, 'id');
  }
}

{
  const r = resolveFabricItemForCreateItemEdit(
    { originalName: 'WİNTER SARDONLU', originalCode: 'CLO-2' },
    candidates,
  );
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.item.id, 'item-winter');
}

{
  // New form values must NOT be used — searching ASTRLI would be wrong for Winter identity.
  const r = resolveFabricItemForCreateItemEdit(
    { originalName: 'WİNTER SARDONLU', originalCode: 'CLO-2' },
    candidates,
  );
  assert.equal(r.ok && r.item.id === 'item-winter', true);
}

{
  const r = resolveFabricItemForCreateItemEdit(
    { originalName: 'MISSING', originalCode: 'NOPE' },
    candidates,
  );
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, 'not_found');
    assert.match(createItemEditFailureMessage(r), /لم يُعثر/);
  }
}

{
  const dupes = [
    { id: 'a', name: 'same', internal_code: 'X', supplier_code: null },
    { id: 'b', name: 'same', internal_code: 'X', supplier_code: null },
  ];
  const r = resolveFabricItemForCreateItemEdit(
    { originalName: 'same', originalCode: 'X' },
    dupes,
  );
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, 'ambiguous');
    assert.equal(r.count, 2);
    assert.match(createItemEditFailureMessage(r), /أكثر من سجل/);
  }
}

{
  const r = resolveFabricItemForCreateItemEdit(
    { originalName: '', originalCode: '' },
    candidates,
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'missing_identity');
}

console.log('createItemEditIdentity.test.ts OK');
