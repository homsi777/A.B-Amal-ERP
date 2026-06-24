/**
 * إصلاح استيراد مخزون Excel سابق (ربط كل ثوب بالخامة الصحيحة حسب اسم الصنف في Excel).
 *
 * Usage (على السحابة من مجلد المشروع — يقرأ server/.env):
 *
 *   npm run repair:stock-import -- --list
 *   npm run repair:stock-import -- --file-name=حلب-15
 *   npm run repair:stock-import -- --file-name=حلب-15 --apply
 *   npm run repair:stock-import -- --batch-id=<uuid> --apply --fix-colors
 *   npm run repair:stock-import -- --batch-id=<uuid> --apply --purge-orphans
 *   npm run repair:stock-import -- --batch-id=<uuid> --rollback --apply
 */
import 'dotenv/config';
import { getPool } from '../db/pool.js';
import {
  listStockImportBatches,
  repairStockImportItems,
  rollbackStockImportBatch,
} from '../services/repairStockImportItemsService.js';

function readArg(flag: string): string | undefined {
  const hit = process.argv.find((a) => a === flag || a.startsWith(`${flag}=`));
  if (!hit) return undefined;
  if (hit.includes('=')) return hit.split('=').slice(1).join('=').trim() || undefined;
  const idx = process.argv.indexOf(hit);
  return process.argv[idx + 1]?.trim() || undefined;
}

async function resolveCompanyId(pool: ReturnType<typeof getPool>): Promise<string> {
  const fromEnv = process.env.COMPANY_ID?.trim();
  if (fromEnv) return fromEnv;
  const c = await pool.query<{ id: string }>(`SELECT id FROM companies ORDER BY created_at ASC LIMIT 1`);
  if (!c.rows.length) {
    console.error('[repair-stock-import] لا توجد شركة في قاعدة البيانات');
    process.exit(1);
  }
  return c.rows[0].id;
}

async function main() {
  const pool = getPool();
  const companyId = await resolveCompanyId(pool);
  const listOnly = process.argv.includes('--list');
  const apply = process.argv.includes('--apply');
  const fixColors = process.argv.includes('--fix-colors');
  const purgeOrphans = process.argv.includes('--purge-orphans');
  const rollback = process.argv.includes('--rollback');
  const batchId = readArg('--batch-id');
  const fileName = readArg('--file-name');

  if (listOnly) {
    const batches = await listStockImportBatches(pool, companyId, fileName);
    if (!batches.length) {
      console.log('[repair-stock-import] لا توجد دفعات استيراد مخزون مطابقة.');
      return;
    }
    console.log(`[repair-stock-import] دفعات استيراد مخزون (company=${companyId}):`);
    for (const b of batches) {
      console.log(
        `  ${b.id} | ${b.fileName} | ورقة=${b.sheetName ?? '—'} | ${b.status} | صفوف=${b.rowCount} | أثواب=${b.createdRolls} | ${b.createdAt}`,
      );
    }
    return;
  }

  if (rollback) {
    if (!batchId) {
      console.error('[repair-stock-import] --rollback يتطلب --batch-id=<uuid>');
      process.exit(1);
    }
    console.log(
      `[repair-stock-import] rollback batch=${batchId} mode=${apply ? 'APPLY' : 'DRY-RUN'}`,
    );
    const report = await rollbackStockImportBatch(pool, {
      companyId,
      batchId,
      dryRun: !apply,
    });
    console.log(
      `[repair-stock-import] حذف أثواب متاحة: ${report.rollsDeleted} | تخطي (مباع/محجوز): ${report.rollsSkippedSold}`,
    );
    if (!apply) console.log('[repair-stock-import] معاينة فقط. للتطبيق أضف: --apply');
    return;
  }

  console.log(
    `[repair-stock-import] company=${companyId} batch=${batchId ?? 'AUTO'} file=${fileName ?? 'ANY'} colors=${fixColors} purge=${purgeOrphans} mode=${apply ? 'APPLY' : 'DRY-RUN'}`,
  );

  const report = await repairStockImportItems(pool, {
    companyId,
    batchId: batchId ?? null,
    fileNameContains: fileName ?? null,
    dryRun: !apply,
    fixColors,
    purgeOrphanItems: purgeOrphans,
  });

  if (!report.batchIds.length) {
    console.log('[repair-stock-import] لم تُعثر على دفعة. جرّب: npm run repair:stock-import -- --list');
    return;
  }

  const changes = report.rows.filter((r) => r.action === 'relocated').slice(0, 40);
  for (const row of changes) {
    console.log(
      `  FIX row=${row.rowNo} barcode=${row.barcode ?? '—'} | Excel: ${row.excelItemName} (${row.excelItemCode || '—'}) | ${row.fromItemName} [${row.fromItemCode}] → ${row.toItemName} [${row.toItemCode}]`,
    );
  }
  if (report.relocated > changes.length) {
    console.log(`  ... و ${report.relocated - changes.length} صف إضافي`);
  }

  console.log('');
  console.log(
    `[repair-stock-import] دفعات=${report.batchIds.length} | فُحص=${report.scannedRows} | صحيح مسبقاً=${report.alreadyOk} | نُقل=${report.relocated} | تخطي=${report.skipped} | خامات جديدة=${report.itemsCreated} | ألوان=${report.colorsFixed} | تصنيفات=${report.categoriesCreated} | خامات يتيمة محذوفة=${report.orphansPurged}`,
  );

  if (!apply) {
    console.log('[repair-stock-import] معاينة فقط. للتطبيق على السحابة:');
    console.log('  npm run repair:stock-import -- --file-name=حلب-15 --apply');
    console.log('  npm run repair:stock-import -- --batch-id=<uuid> --apply --fix-colors');
  }
}

main().catch((err) => {
  console.error('[repair-stock-import] فشل:', err instanceof Error ? err.message : err);
  process.exit(1);
});
