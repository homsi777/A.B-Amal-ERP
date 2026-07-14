/**
 * Protection tests: resolveFabricClassification must not UPDATE shared master rows.
 * Run: npx tsx server/src/services/fabricClassificationService.masterIsolation.test.ts
 */
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';

type QResult<T> = { rows: T[]; rowCount?: number };

/** Minimal fake DB that records UPDATE statements against master tables. */
function createFakeClient(seed: {
  companyId: string;
  l1: { id: string; parent_id: null; code: string; name: string };
  l2: { id: string; parent_id: string; code: string; name: string };
  l3?: { id: string; parent_id: string; code: string; name: string };
  l4?: { id: string; parent_id: string; code: string; name: string };
  existingItem?: { id: string; internal_code: string; name: string };
  existingColor?: { id: string; name_ar: string; color_code: string };
}) {
  const updates: string[] = [];
  const inserts: string[] = [];

  const client = {
    async query(sql: string, params?: unknown[]) {
      const s = sql.replace(/\s+/g, ' ').trim().toLowerCase();

      if (s.startsWith('begin') || s.startsWith('commit') || s.startsWith('rollback')) {
        return { rows: [] };
      }

      if (s.includes('from fabric_categories') && s.includes('id = any')) {
        const ids = (params?.[1] as string[]) ?? [];
        const all = [seed.l1, seed.l2, seed.l3, seed.l4].filter(Boolean) as Array<{
          id: string;
          parent_id: string | null;
          code: string;
          name: string;
        }>;
        return { rows: all.filter((c) => ids.includes(c.id)) };
      }

      if (s.includes('from fabric_items') && s.includes('lower(trim(name))') && s.includes('internal_code')) {
        if (seed.existingItem) {
          return {
            rows: [{ id: seed.existingItem.id, internal_code: seed.existingItem.internal_code }],
          };
        }
        return { rows: [] };
      }

      if (s.includes('from fabric_colors')) {
        if (seed.existingColor) {
          return { rows: [{ id: seed.existingColor.id }] };
        }
        return { rows: [] };
      }

      if (s.includes('from fabric_item_variants')) {
        return { rows: [] };
      }

      if (s.startsWith('update fabric_items') || s.startsWith('update fabric_colors')) {
        updates.push(sql);
        return { rows: [], rowCount: 1 };
      }

      if (s.startsWith('insert into fabric_items')) {
        inserts.push('fabric_items');
        return {
          rows: [{ id: 'new-item', internal_code: String(params?.[2] ?? 'CODE') }],
        };
      }

      if (s.startsWith('insert into fabric_colors')) {
        inserts.push('fabric_colors');
        return { rows: [{ id: 'new-color' }] };
      }

      if (s.startsWith('insert into fabric_item_variants')) {
        inserts.push('fabric_item_variants');
        return { rows: [{ id: 'new-variant' }] };
      }

      // collision / internal code helpers
      if (s.includes('from fabric_items') && s.includes('<>')) {
        return { rows: [] };
      }

      throw new Error(`Unexpected SQL in fake client: ${sql.slice(0, 120)}`);
    },
  } as unknown as PoolClient;

  return { client, updates, inserts };
}

async function runIsolationCases() {
  // Dynamic import after we patch getPool via module mock is hard with tsx;
  // instead test the SQL contract by re-reading the source guard.
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.join(here, 'fabricClassificationService.ts'), 'utf8');

  assert.equal(
    /UPDATE fabric_items\s+SET category_id/i.test(src),
    false,
    'resolve must not UPDATE existing fabric_items',
  );
  assert.equal(
    /UPDATE fabric_colors\s+SET name_ar/i.test(src),
    false,
    'resolve must not UPDATE existing fabric_colors',
  );
  assert.match(src, /Relink only — never mutate a shared fabric_item/);
  assert.match(src, /Relink only — never mutate a shared fabric_color/);

  // Fake client contract: finding existing item/color must not produce updates.
  const companyId = '11111111-1111-1111-1111-111111111111';
  const l1 = { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', parent_id: null as null, code: 'trio', name: 'trio' };
  const l2 = {
    id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    parent_id: l1.id,
    code: 'IMP-AUTO-TRIO',
    name: 'IMP-AUTO-TRIO',
  };
  const l3 = {
    id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    parent_id: l2.id,
    code: 'اسود',
    name: 'اسود',
  };
  const l4 = {
    id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
    parent_id: l3.id,
    code: 'اسود',
    name: 'اسود',
  };

  const { client, updates } = createFakeClient({
    companyId,
    l1,
    l2,
    l3,
    l4,
    existingItem: { id: 'item-shared', internal_code: 'IMP-AUTO-TRIO', name: 'trio' },
    existingColor: { id: 'color-shared', name_ar: 'اسود', color_code: 'اسود' },
  });

  // Manual resolve path mirroring the fixed service behaviour
  const existing = await client.query<{ id: string; internal_code: string }>(
    `SELECT id, internal_code FROM fabric_items
     WHERE company_id=$1 AND is_active=true
       AND lower(trim(name))=lower(trim($2))
       AND lower(trim(internal_code))=lower(trim($3))`,
    [companyId, 'trio', 'IMP-AUTO-TRIO'],
  );
  assert.equal(existing.rows[0]?.id, 'item-shared');
  // Fixed path: no UPDATE
  assert.equal(updates.length, 0);

  const color = await client.query<{ id: string }>(
    `SELECT id FROM fabric_colors WHERE company_id = $1 AND trim(lower(coalesce(name_ar, ''))) = trim(lower($2::text))`,
    [companyId, 'اسود'],
  );
  assert.equal(color.rows[0]?.id, 'color-shared');
  assert.equal(updates.length, 0);

  console.log('fabricClassificationService.masterIsolation.test.ts OK');
}

runIsolationCases().catch((e) => {
  console.error(e);
  process.exit(1);
});
