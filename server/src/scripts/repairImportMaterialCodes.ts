/**
 * إصلاح أثواب استُورد كود لونها ككود خامة (مثل 8 بدل KL-199).
 *
 * Usage:
 *   npm run repair:material-codes -- --list
 *   npm run repair:material-codes -- --material=ROYAL
 *   npm run repair:material-codes -- --material=ROYAL --apply
 *   npm run repair:material-codes -- --batch-id=<uuid> --apply --fix-colors
 */
import 'dotenv/config';
import { getPool } from '../db/pool.js';
import {
  diagnoseImportMaterialCodes,
  listMaterialCodeRepairBatches,
  repairImportMaterialCodes,
} from '../services/repairImportMaterialCodesService.js';

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
    console.error('[repair-material-codes] لا توجد شركة في قاعدة البيانات');
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
  const batchId = readArg('--batch-id');
  const fileName = readArg('--file-name');
  const material = readArg('--material');
  const diagnose = process.argv.includes('--diagnose');

  if (diagnose) {
    await diagnoseImportMaterialCodes(pool, companyId, material ?? null);
    return;
  }

  if (listOnly) {
    const batches = await listMaterialCodeRepairBatches(pool, companyId, fileName);
    if (!batches.length) {
      console.log('[repair-material-codes] لا توجد دفعات استيراد مطابقة.');
      return;
    }
    console.log(`[repair-material-codes] دفعات الاستيراد (company=${companyId}):`);
    for (const b of batches) {
      console.log(
        `  ${b.id} | ${b.fileName} | ${b.sourceType} | ${b.status} | صفوف=${b.rowCount} | أثواب=${b.createdRolls} | ${b.createdAt}`,
      );
    }
    return;
  }

  console.log(
    `[repair-material-codes] company=${companyId} batch=${batchId ?? 'ALL'} file=${fileName ?? 'ANY'} material=${material ?? 'ANY'} colors=${fixColors} mode=${apply ? 'APPLY' : 'DRY-RUN'}`,
  );

  const report = await repairImportMaterialCodes(pool, {
    companyId,
    batchId: batchId ?? null,
    fileNameContains: fileName ?? null,
    materialNameContains: material ?? null,
    dryRun: !apply,
    fixColors,
  });

  if (!report.batchIds.length) {
    console.log('[repair-material-codes] لم تُعثر على دفعة. جرّب: npm run repair:material-codes -- --list');
    return;
  }

  const fixes = report.rows.filter((r) => r.action === 'fixed').slice(0, 50);
  for (const row of fixes) {
    console.log(
      `  FIX row=${row.rowNo} barcode=${row.barcode ?? '—'} | ${row.materialName} | كود خطأ: ${row.wrongMaterialCode} → ${row.toItemCode} | لون: ${row.correctedColorCode || '—'}`,
    );
  }
  if (report.fixedRows > fixes.length) {
    console.log(`  ... و ${report.fixedRows - fixes.length} صف إضافي`);
  }

  console.log('');
  console.log(
    `[repair-material-codes] دفعات=${report.batchIds.length} | فُحص=${report.scannedRows} | أُصلح=${report.fixedRows} | صحيح=${report.alreadyOk} | تخطي=${report.skipped} | خامات جديدة=${report.itemsCreated} | خامات مُصححة=${report.itemsCorrected} | ألوان=${report.colorsFixed}`,
  );

  if (!apply) {
    console.log('[repair-material-codes] معاينة فقط. للتطبيق:');
    console.log('  npm run repair:material-codes -- --material=ROYAL --apply --fix-colors');
    console.log('  npm run repair:material-codes -- --batch-id=<uuid> --apply');
  }
}

main().catch((err) => {
  console.error('[repair-material-codes] فشل:', err instanceof Error ? err.message : err);
  process.exit(1);
});
