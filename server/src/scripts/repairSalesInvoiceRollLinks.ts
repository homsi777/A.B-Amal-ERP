/**
 * إصلاح ربط أتواب فواتير المبيعات بالمخزون:
 * 1) ربط fabric_roll_id لأسطر المسودات (لتمييز «مسودة بيع» في المخزون والجرد)
 * 2) تطبيق حركة البيع على المخزون للفواتير المؤكدة التي لم تُحدّث الأتواب
 *
 * Usage:
 *   npm run repair:sales-roll-links              # معاينة
 *   npm run repair:sales-roll-links -- --apply   # تطبيق
 *   npm run repair:sales-roll-links -- --apply --invoice-id=<uuid>
 */
import 'dotenv/config';
import { getPool } from '../db/pool.js';
import { repairSalesInvoiceRollLinks } from '../services/repairSalesInvoiceRollLinksService.js';

function readArg(flag: string): string | undefined {
  const hit = process.argv.find((a) => a === flag || a.startsWith(`${flag}=`));
  if (!hit) return undefined;
  if (hit.includes('=')) return hit.split('=').slice(1).join('=').trim() || undefined;
  const idx = process.argv.indexOf(hit);
  return process.argv[idx + 1]?.trim() || undefined;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const invoiceId = readArg('--invoice-id');
  const pool = getPool();

  let companyId = process.env.COMPANY_ID?.trim();
  if (!companyId) {
    const c = await pool.query<{ id: string }>(`SELECT id FROM companies ORDER BY created_at ASC LIMIT 1`);
    if (!c.rows.length) {
      console.error('[repair-sales-rolls] لا توجد شركة في قاعدة البيانات');
      process.exit(1);
    }
    companyId = c.rows[0].id;
  }

  console.log(
    `[repair-sales-rolls] company=${companyId} invoice=${invoiceId ?? 'ALL'} mode=${apply ? 'APPLY' : 'DRY-RUN'}`,
  );

  const report = await repairSalesInvoiceRollLinks(pool, {
    companyId,
    dryRun: !apply,
    invoiceId: invoiceId ?? null,
  });

  console.log('');
  console.log(`[repair-sales-rolls] مسودات: ${report.draftInvoicesScanned} فاتورة — أسطر مربوطة: ${report.draftLinesLinked} — حجز: ${report.draftRollsReserved}`);
  console.log(
    `[repair-sales-rolls] مؤكدة: ${report.confirmedInvoicesScanned} فاتورة — مخزون مُصلَح: ${report.confirmedStockFixed} — تخطي: ${report.confirmedStockSkipped}`,
  );

  for (const line of report.details.slice(0, 200)) {
    console.log(`  ${line}`);
  }
  if (report.details.length > 200) {
    console.log(`  ... +${report.details.length - 200} more`);
  }

  if (!apply) {
    console.log('');
    console.log('[repair-sales-rolls] معاينة فقط. للتطبيق أضف: --apply');
  }
}

main().catch((err) => {
  console.error('[repair-sales-rolls] فشل:', err instanceof Error ? err.message : err);
  process.exit(1);
});
