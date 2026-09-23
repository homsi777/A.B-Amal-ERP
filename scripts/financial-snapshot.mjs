#!/usr/bin/env node
/**
 * لقطة مالية للمقارنة قبل/بعد أي نشر — للقراءة فقط، بلا أي بيانات اعتماد
 * داخل الملف (تُقرأ من DATABASE_URL بيئياً).
 *
 * الاستخدام:
 *   node scripts/financial-snapshot.mjs snapshot --out before.json
 *   node scripts/financial-snapshot.mjs compare before.json after.json --company <companyId>
 */
import fs from 'node:fs';
import pg from 'pg';

const TRANSACTIONAL_TABLES = [
  'sales_invoices',
  'sales_invoice_lines',
  'purchase_invoices',
  'purchase_invoice_lines',
  'return_invoices',
  'vouchers',
  'journal_entries',
  'journal_lines',
  'cashbox_movements',
  'inventory_movements',
  'fabric_rolls',
  'operating_expenses',
];

function requireDatabaseUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('[financial-snapshot] عرّف DATABASE_URL قبل التشغيل — مثال:');
    console.error("  $env:DATABASE_URL='postgresql://user:***@host:port/db?sslmode=disable'");
    process.exit(1);
  }
  return url;
}

async function withReadOnlyClient(fn) {
  const pool = new pg.Pool({ connectionString: requireDatabaseUrl(), max: 1 });
  const client = await pool.connect();
  try {
    await client.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
    await client.query('BEGIN READ ONLY');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

async function collectSnapshot(client) {
  const gl = await client.query(`
    SELECT company_id, currency_code,
           SUM(debit) AS total_debit, SUM(credit) AS total_credit,
           SUM(debit) - SUM(credit) AS difference
    FROM journal_lines
    GROUP BY company_id, currency_code
    ORDER BY company_id, currency_code
  `);

  const cashboxes = await client.query(`
    SELECT company_id, currency_code, code, current_balance
    FROM cashboxes
    ORDER BY company_id, currency_code, code
  `);

  const partyBalances = await client.query(`
    SELECT company_id, party_type, currency_code,
      CASE WHEN party_type = 'CUSTOMER' THEN SUM(debit - credit)
           ELSE SUM(credit - debit) END AS net_balance,
      COUNT(DISTINCT party_id) AS parties
    FROM journal_lines
    WHERE party_type IN ('CUSTOMER','SUPPLIER')
    GROUP BY company_id, party_type, currency_code
    ORDER BY company_id, party_type, currency_code
  `);

  const stock = await client.query(`
    SELECT company_id, COUNT(*) AS rolls, COALESCE(SUM(length_m),0) AS meters
    FROM fabric_rolls
    WHERE status = 'AVAILABLE'
    GROUP BY company_id
    ORDER BY company_id
  `);

  const rowCounts = [];
  for (const table of TRANSACTIONAL_TABLES) {
    const res = await client.query(
      `SELECT company_id, COUNT(*) AS count FROM ${table} GROUP BY company_id ORDER BY company_id`,
    );
    for (const row of res.rows) {
      rowCounts.push({ table, company_id: row.company_id, count: Number(row.count) });
    }
  }

  return {
    takenAt: new Date().toISOString(),
    gl: gl.rows,
    cashboxes: cashboxes.rows,
    partyBalances: partyBalances.rows,
    stock: stock.rows,
    rowCounts,
  };
}

function filterByCompany(snapshot, companyId) {
  if (!companyId) return snapshot;
  return {
    ...snapshot,
    gl: snapshot.gl.filter((r) => r.company_id === companyId),
    cashboxes: snapshot.cashboxes.filter((r) => r.company_id === companyId),
    partyBalances: snapshot.partyBalances.filter((r) => r.company_id === companyId),
    stock: snapshot.stock.filter((r) => r.company_id === companyId),
    rowCounts: snapshot.rowCounts.filter((r) => r.company_id === companyId),
  };
}

function rowKey(row, keys) {
  return keys.map((k) => String(row[k])).join('|');
}

function diffArrays(before, after, keys, valueKeys) {
  const diffs = [];
  const beforeMap = new Map(before.map((r) => [rowKey(r, keys), r]));
  const afterMap = new Map(after.map((r) => [rowKey(r, keys), r]));
  const allKeys = new Set([...beforeMap.keys(), ...afterMap.keys()]);
  for (const k of allKeys) {
    const b = beforeMap.get(k);
    const a = afterMap.get(k);
    if (!b || !a) {
      diffs.push({ key: k, before: b ?? null, after: a ?? null });
      continue;
    }
    for (const vk of valueKeys) {
      if (String(b[vk]) !== String(a[vk])) {
        diffs.push({ key: k, field: vk, before: b[vk], after: a[vk] });
      }
    }
  }
  return diffs;
}

function runSnapshot(outPath) {
  return withReadOnlyClient(collectSnapshot).then((snapshot) => {
    fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2));
    console.log(`[financial-snapshot] كُتبت اللقطة إلى ${outPath}`);
    console.log(JSON.stringify(snapshot, null, 2));
  });
}

function runCompare(beforePath, afterPath, companyId) {
  const before = filterByCompany(JSON.parse(fs.readFileSync(beforePath, 'utf8')), companyId);
  const after = filterByCompany(JSON.parse(fs.readFileSync(afterPath, 'utf8')), companyId);

  const allDiffs = [
    ...diffArrays(before.gl, after.gl, ['company_id', 'currency_code'], ['total_debit', 'total_credit', 'difference']),
    ...diffArrays(before.cashboxes, after.cashboxes, ['company_id', 'code'], ['current_balance']),
    ...diffArrays(
      before.partyBalances,
      after.partyBalances,
      ['company_id', 'party_type', 'currency_code'],
      ['net_balance', 'parties'],
    ),
    ...diffArrays(before.stock, after.stock, ['company_id'], ['rolls', 'meters']),
    ...diffArrays(before.rowCounts, after.rowCounts, ['table', 'company_id'], ['count']),
  ];

  if (allDiffs.length === 0) {
    console.log(`[financial-snapshot] لا فرق${companyId ? ` للحساب ${companyId}` : ''} — مطابق تماماً.`);
    return 0;
  }

  console.error(`[financial-snapshot] ${allDiffs.length} فرقاً${companyId ? ` للحساب ${companyId}` : ''}:`);
  for (const d of allDiffs) {
    console.error(JSON.stringify(d));
  }
  return 1;
}

async function main() {
  const [, , mode, ...rest] = process.argv;

  if (mode === 'snapshot') {
    const outIdx = rest.indexOf('--out');
    const outPath = outIdx >= 0 ? rest[outIdx + 1] : null;
    if (!outPath) {
      console.error('الاستخدام: node scripts/financial-snapshot.mjs snapshot --out <file.json>');
      process.exit(1);
    }
    await runSnapshot(outPath);
    return;
  }

  if (mode === 'compare') {
    const [beforePath, afterPath] = rest;
    const companyIdx = rest.indexOf('--company');
    const companyId = companyIdx >= 0 ? rest[companyIdx + 1] : null;
    if (!beforePath || !afterPath) {
      console.error('الاستخدام: node scripts/financial-snapshot.mjs compare <before.json> <after.json> [--company <id>]');
      process.exit(1);
    }
    const code = runCompare(beforePath, afterPath, companyId);
    process.exit(code);
  }

  console.error('الاستخدام: node scripts/financial-snapshot.mjs snapshot --out <file.json>');
  console.error('        أو: node scripts/financial-snapshot.mjs compare <before.json> <after.json> [--company <id>]');
  process.exit(1);
}

main().catch((err) => {
  console.error('[financial-snapshot] فشل:', err instanceof Error ? err.message : err);
  process.exit(1);
});
