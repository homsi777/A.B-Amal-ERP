/**
 * تنظيف آخر استيراد مخزون + استيراد جديد نظيف من Excel (أمر واحد).
 *
 *   npm run stock-import:reset -- --list
 *   npm run stock-import:reset -- --file="مستودعات حلب-15.xlsx"
 *   npm run stock-import:reset -- --file="مستودعات حلب-15.xlsx" --apply
 */
import 'dotenv/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseStockWorkbook, pickDefaultSheet } from '../src/lib/stockExcelImport.ts';
import { getPool } from '../server/src/db/pool.ts';
import { listStockImportBatches } from '../server/src/services/repairStockImportItemsService.ts';
import { resetAndReimportStock } from '../server/src/services/resetAndReimportStockService.ts';

const cliLogger = {
  info: (obj, msg) => {
    if (msg) console.log(msg, typeof obj === 'object' ? JSON.stringify(obj) : obj);
    else console.log(obj);
  },
  error: (obj, msg) => {
    if (msg) console.error(msg, obj);
    else console.error(obj);
  },
};

function readArg(flag) {
  const hit = process.argv.find((a) => a === flag || a.startsWith(`${flag}=`));
  if (!hit) return undefined;
  if (hit.includes('=')) return hit.split('=').slice(1).join('=').trim() || undefined;
  const idx = process.argv.indexOf(hit);
  return process.argv[idx + 1]?.trim() || undefined;
}

async function resolveCompanyId() {
  const fromEnv = process.env.COMPANY_ID?.trim();
  if (fromEnv) return fromEnv;
  const pool = getPool();
  const c = await pool.query(`SELECT id FROM companies ORDER BY created_at ASC LIMIT 1`);
  if (!c.rows.length) {
    console.error('[stock-import:reset] لا توجد شركة في قاعدة البيانات');
    process.exit(1);
  }
  return c.rows[0].id;
}

async function resolveUserId(companyId) {
  const pool = getPool();
  const u = await pool.query(
    `SELECT id FROM users WHERE company_id = $1 ORDER BY created_at ASC LIMIT 1`,
    [companyId],
  );
  if (!u.rows.length) {
    console.error('[stock-import:reset] لا يوجد مستخدم للشركة');
    process.exit(1);
  }
  return u.rows[0].id;
}

async function loadImportPayload(filePath, sheetName) {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) throw new Error(`ملف Excel غير موجود: ${abs}`);

  const buf = fs.readFileSync(abs);
  const file = {
    name: path.basename(abs),
    size: buf.length,
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  };
  const preview = await parseStockWorkbook(file);

  let sheet = pickDefaultSheet(preview);
  if (sheetName?.trim()) {
    const wanted = sheetName.trim();
    const hit = preview.sheets.find((s) => s.sheetName === wanted || s.sheetName.includes(wanted));
    if (!hit) {
      throw new Error(`لم تُعثر على ورقة «${wanted}». الأوراق: ${preview.sheets.map((s) => s.sheetName).join(' | ')}`);
    }
    sheet = hit;
  }

  const rows = sheet.rows
    .filter((r) => Boolean(String(r.itemName ?? '').trim()) && Number(r.quantity) > 0)
    .map((r) => ({
      itemName: String(r.itemName).trim(),
      itemCode: String(r.itemCode ?? '').trim(),
      barcode: String(r.barcode ?? '').trim(),
      colorName: String(r.colorName ?? '').trim(),
      colorNameTr: String(r.colorNameTr ?? '').trim(),
      colorCode: String(r.colorCode ?? '').trim(),
      unit: String(r.unit ?? '').trim(),
      quantity: Number(r.quantity) || 0,
      price: Number(r.price ?? 0) || 0,
      costPrice: Number(r.costPrice ?? 0) || 0,
      widthCm: Number(r.widthCm ?? 0) || 0,
      gsm: Number(r.gsm ?? 0) || 0,
      actualWeightKg: Number(r.actualWeightKg ?? 0) || 0,
      date: String(r.date ?? '').trim(),
      purchaseInvoiceNo: '',
    }));

  if (!rows.length) {
    throw new Error(`لا توجد صفوف قابلة للاستيراد في «${sheet.sheetName}» (اسم صنف + كمية > 0).`);
  }

  return {
    fileName: preview.fileName,
    sheetName: sheet.sheetName,
    sheetKind: sheet.kind,
    importLayout: sheet.importLayout,
    headerRowIndex: sheet.headerRowIndex,
    rawHeaders: sheet.rawHeaders,
    rows,
  };
}

const pool = getPool();
const companyId = await resolveCompanyId();
const listOnly = process.argv.includes('--list');
const apply = process.argv.includes('--apply');
const cleanOnly = process.argv.includes('--clean-only');
const force = process.argv.includes('--force');
const filePath = readArg('--file');
const batchId = readArg('--batch-id');
const sheetName = readArg('--sheet');
const warehouseId = readArg('--warehouse-id');

if (listOnly) {
  const batches = await listStockImportBatches(pool, companyId);
  if (!batches.length) {
    console.log('[stock-import:reset] لا توجد دفعات استيراد مخزون.');
    process.exit(0);
  }
  console.log(`[stock-import:reset] دفعات (company=${companyId}):`);
  for (const b of batches) {
    console.log(`  ${b.id} | ${b.fileName} | ورقة=${b.sheetName ?? '—'} | ${b.status} | أثواب=${b.createdRolls}`);
  }
  process.exit(0);
}

const userId = await resolveUserId(companyId);
const importPayload = !cleanOnly && filePath ? await loadImportPayload(filePath, sheetName) : null;

console.log(
  `[stock-import:reset] mode=${apply ? 'APPLY' : 'DRY-RUN'} cleanOnly=${cleanOnly} force=${force} file=${filePath ?? '—'}`,
);
if (importPayload) {
  console.log(
    `[stock-import:reset] ورقة=${importPayload.sheetName} (${importPayload.sheetKind}) | صفوف=${importPayload.rows.length} | layout=${importPayload.importLayout}`,
  );
}

const report = await resetAndReimportStock(pool, cliLogger, {
  companyId,
  userId,
  importPayload,
  batchId: batchId ?? null,
  warehouseId: warehouseId ?? null,
  dryRun: !apply,
  cleanOnly,
  force,
});

if (report.blockedReason) {
  console.error(`[stock-import:reset] ⛔ ${report.blockedReason}`);
  process.exit(1);
}

console.log('');
console.log('[stock-import:reset] === تنظيف ===');
console.log(`  دفعة قديمة: ${report.cleanedBatchId} (${report.cleanedBatchFileName ?? '—'})`);
if (report.rollback) {
  console.log(`  أثواب محذوفة: ${report.rollback.rollsDeleted} | تخطي (مباع/محجوز): ${report.rollback.rollsSkippedSold}`);
}
console.log(`  خامات يتيمة محذوفة: ${report.orphansPurged}`);

if (!cleanOnly) {
  console.log('');
  console.log('[stock-import:reset] === استيراد جديد ===');
  console.log(`  ملف: ${report.importFile}`);
  console.log(`  ورقة: ${report.importSheet} | صفوف: ${report.importRows}`);
  console.log(`  دفعة جديدة: ${report.newBatchId ?? '—'}`);
  if (report.importResult) {
    console.log(
      `  حالة: ${report.importResult.status} | أثواب=${report.importResult.createdRolls} | خامات=${report.importResult.createdItems} | أخطاء=${report.importResult.errorCount}`,
    );
    if (report.importResult.errors.length) {
      console.log('  أخطاء (أول 10):');
      for (const e of report.importResult.errors.slice(0, 10)) {
        console.log(`    صف ${e.rowIndex}: ${e.reason}`);
      }
    }
  }
}

if (!apply) {
  console.log('');
  console.log('[stock-import:reset] معاينة فقط. للتنفيذ:');
  console.log('  npm run stock-import:reset -- --file="مسار/الملف.xlsx" --apply');
} else if (report.importResult?.status === 'CONFIRMED') {
  console.log('');
  console.log('[stock-import:reset] ✅ اكتمل التنظيف والاستيراد بنجاح.');
} else if (report.importResult?.status === 'PARTIALLY_CONFIRMED') {
  console.log('');
  console.log('[stock-import:reset] ⚠️ اكتمل جزئياً — راجع الأخطاء أعلاه.');
  process.exit(2);
} else if (report.importResult?.status === 'FAILED') {
  console.log('');
  console.log('[stock-import:reset] ❌ فشل الاستيراد.');
  process.exit(2);
} else if (cleanOnly) {
  console.log('');
  console.log('[stock-import:reset] ✅ اكتمل التنظيف.');
}

await pool.end();
