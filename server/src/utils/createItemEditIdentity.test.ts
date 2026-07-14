/**
 * Inventory edit identity: CreateItem edit must look up by ORIGINAL name+code.
 * Run: npx tsx server/src/utils/createItemEditIdentity.test.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const createItemPath = path.join(root, 'src/pages/inventory/CreateItem.tsx');
const src = fs.readFileSync(createItemPath, 'utf8');

assert.match(
  src,
  /ORIGINAL identity of the edited record/,
  'CreateItem edit must document original-identity lookup',
);
assert.match(src, /editingItem\.name/);
assert.match(src, /editingItem\.fabricCode/);
assert.equal(
  /listFabricItems\(\{\s*search:\s*name\.trim\(\)/.test(
    src.slice(src.indexOf('isEditMode && editingItem'), src.indexOf('إنشاء ثوب جديد')),
  ),
  false,
  'Edit mode must not search fabric items by the NEW form name',
);

console.log('createItemEditIdentity.test.ts OK');
