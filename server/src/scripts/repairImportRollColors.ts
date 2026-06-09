/**
 * إصلاح ألوان أثواب مستوردة من Excel دون إعادة الاستيراد.
 *
 * يقرأ اللون الأصلي من purchase_import_rows (normalized_data / raw_data)
 * ويحدّث fabric_rolls.color_id.
 *
 * Usage:
 *   npm run repair:import-colors              # معاينة فقط (dry-run)
 *   npm run repair:import-colors -- --apply   # تطبيق التعديلات
 *   npm run repair:import-colors -- --apply --batch-id=<uuid>
 */
import 'dotenv/config';
import { getPool } from '../db/pool.js';
import { repairImportRollColors } from '../services/repairImportRollColorsService.js';

function readArg(flag: string): string | undefined {
  const hit = process.argv.find((a) => a === flag || a.startsWith(`${flag}=`));
  if (!hit) return undefined;
  if (hit.includes('=')) return hit.split('=').slice(1).join('=').trim() || undefined;
  const idx = process.argv.indexOf(hit);
  return process.argv[idx + 1]?.trim() || undefined;
}

function readBarcodes(): string[] {
  const raw = readArg('--barcodes');
  if (!raw) return [];
  return raw.split(/[,\s;]+/).map((b) => b.trim()).filter(Boolean);
}

async function main() {
  const apply = process.argv.includes('--apply');
  const batchId = readArg('--batch-id');
  const barcodes = readBarcodes();
  const pool = getPool();

  let companyId = process.env.COMPANY_ID?.trim();
  if (!companyId) {
    const c = await pool.query<{ id: string }>(`SELECT id FROM companies ORDER BY created_at ASC LIMIT 1`);
    if (!c.rows.length) {
      console.error('[repair-colors] لا توجد شركة في قاعدة البيانات');
      process.exit(1);
    }
    companyId = c.rows[0].id;
  }

  console.log(
    `[repair-colors] company=${companyId} batch=${batchId ?? 'ALL'} barcodes=${barcodes.length ? barcodes.join(',') : 'ALL'} mode=${apply ? 'APPLY' : 'DRY-RUN'}`,
  );

  const report = await repairImportRollColors(pool, {
    companyId,
    batchId: batchId ?? null,
    barcodes,
    dryRun: !apply,
  });

  if (report.diagnosis) {
    const d = report.diagnosis;
    console.log(
      `[repair-colors] تشخيص: أثواب بدفعة استيراد=${d.rollsWithImportBatch} | صفوف استيراد=${d.importRowsTotal} (مربوطة=${d.importRowsLinked}) | أثواب بفاتورة شراء=${d.rollsWithInvoiceLine}`,
    );
  }

  for (const row of report.rows) {
    if (row.skipped) {
      console.log(
        `  SKIP barcode=${row.barcode ?? '—'} via=${row.matchVia} | ${row.skipped} | مصدر: ${row.colorLabel}`,
      );
      continue;
    }
    console.log(
      `  FIX  barcode=${row.barcode ?? '—'} via=${row.matchVia} | ${row.fromColor} → ${row.toColor} (مصدر: ${row.colorLabel})`,
    );
  }

  console.log('');
  console.log(
    `[repair-colors] تم فحص ${report.scanned} ثوب — تحديث: ${report.updated} — تخطي: ${report.skipped} — ألوان جديدة: ${report.createdColors}`,
  );
  if (report.scanned === 0) {
    console.log('[repair-colors] لم يُعثر على أثواب قابلة للإصلاح. جرّب مع باركودات محددة:');
    console.log('  npm run repair:import-colors -- --barcodes=9826158,5276148,2391353');
  } else if (!apply) {
    console.log('[repair-colors] معاينة فقط. للتطبيق أضف: --apply');
  }
}

main().catch((err) => {
  console.error('[repair-colors] فشل:', err instanceof Error ? err.message : err);
  process.exit(1);
});
