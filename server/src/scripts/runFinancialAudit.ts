/**
 * Read-only financial audit CLI.
 * Usage: npm run audit:financial
 * Requires DATABASE_URL and uses first company in DB (or COMPANY_ID env).
 */
import 'dotenv/config';
import { getPool } from '../db/pool.js';
import { runFinancialAudit } from '../services/financialAuditService.js';

async function main() {
  const pool = getPool();
  const companyId = process.env.COMPANY_ID?.trim();
  let targetCompany = companyId;
  if (!targetCompany) {
    const c = await pool.query<{ id: string }>(`SELECT id FROM companies ORDER BY created_at ASC LIMIT 1`);
    if (!c.rows.length) {
      console.error('[audit] لا توجد شركة في قاعدة البيانات');
      process.exit(1);
    }
    targetCompany = c.rows[0].id;
  }

  const report = await runFinancialAudit(targetCompany);
  console.log(JSON.stringify(report, null, 2));
  console.log(
    `\n[audit] إجمالي المشكلات: ${report.summary.totalIssues} (حرج: ${report.summary.critical}، تحذير: ${report.summary.warning})`,
  );
  if (report.summary.critical > 0) process.exit(2);
}

main().catch((err) => {
  console.error('[audit] فشل:', err instanceof Error ? err.message : err);
  process.exit(1);
});
