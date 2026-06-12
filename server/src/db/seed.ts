/**
 * بذور أولية idempotent — DATABASE_URL من server/.env فقط
 */
import { config as loadDotenv } from 'dotenv';
import bcrypt from 'bcryptjs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { resolveAdminPassword } from './adminSeedPassword.js';
import { PERMISSIONS, ROLES } from './seedConstants.js';
import { generateDevKeysIfEnabled } from '../services/activationService.js';
import { ensureCompanyGlCoa } from '../services/glCoaService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

loadDotenv({ path: path.resolve(__dirname, '../../.env') });

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('[seed] DATABASE_URL غير معرّف في server/.env');
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
  const client = await pool.connect();
  let committed = false;

  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE companies
          SET code = 'ALAMAL-MAIN',
              name = 'ALamal-AB',
              updated_at = now()
        WHERE code = 'TEXTILE-MAIN'`,
    );

    await client.query(
      `INSERT INTO companies (code, name, base_currency_code)
       VALUES ('ALAMAL-MAIN', 'ALamal-AB', 'USD')
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, updated_at = now()`,
    );

    const company = await client.query<{ id: string }>(
      `SELECT id FROM companies WHERE code = 'ALAMAL-MAIN'`,
    );
    const companyId = company.rows[0].id;

    for (const c of [
      { code: 'USD', name: 'دولار أمريكي', symbol: '$' },
      { code: 'TRY', name: 'ليرة تركية', symbol: '₺' },
      { code: 'SYP', name: 'ليرة سورية', symbol: 'ل.س' },
    ]) {
      await client.query(
        `INSERT INTO currencies (code, name, symbol, is_active)
         VALUES ($1, $2, $3, true)
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, symbol = EXCLUDED.symbol`,
        [c.code, c.name, c.symbol],
      );
    }

    for (const r of ROLES) {
      await client.query(
        `INSERT INTO roles (code, name) VALUES ($1, $2)
         ON CONFLICT (code) DO NOTHING`,
        [r.code, r.name],
      );
    }

    for (const p of PERMISSIONS) {
      await client.query(
        `INSERT INTO permissions (code, name, category) VALUES ($1, $2, $3)
         ON CONFLICT (code) DO NOTHING`,
        [p.code, p.name, p.category],
      );
    }

    const adminRole = await client.query<{ id: string }>(
      `SELECT id FROM roles WHERE code = 'admin'`,
    );
    const adminRoleId = adminRole.rows[0].id;

    const permRows = await client.query<{ id: string; code: string }>(
      `SELECT id, code FROM permissions`,
    );
    const permByCode = new Map(permRows.rows.map((r) => [r.code, r.id]));

    for (const p of PERMISSIONS) {
      const pid = permByCode.get(p.code);
      if (!pid) continue;
      await client.query(
        `INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [adminRoleId, pid],
      );
    }

    const viewerPermCodes = ['dashboard.view', 'reports.view'];
    const viewerRole = await client.query<{ id: string }>(
      `SELECT id FROM roles WHERE code = 'viewer'`,
    );
    for (const code of viewerPermCodes) {
      const pid = permByCode.get(code);
      if (pid) {
        await client.query(
          `INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [viewerRole.rows[0].id, pid],
        );
      }
    }

    await client.query(
      `INSERT INTO warehouses (company_id, code, name, type, is_active)
       VALUES ($1, 'MAIN', 'المستودع الرئيسي', 'MAIN', true)
       ON CONFLICT (company_id, code) DO NOTHING`,
      [companyId],
    );

    await client.query(
      `INSERT INTO cashboxes (company_id, code, name, currency_code, opening_balance, current_balance, is_default, is_active)
       VALUES ($1, 'MAIN-USD', 'الصندوق الرئيسي', 'USD', 0, 0, true, true)
       ON CONFLICT (company_id, code) DO NOTHING`,
      [companyId],
    );

    await ensureCompanyGlCoa(client, companyId);

    const plain = resolveAdminPassword();
    const passwordHash = await bcrypt.hash(plain, 12);

    const existing = await client.query<{ id: string }>(
      `SELECT id FROM users WHERE username = $1`,
      ['admin'],
    );
    if (existing.rows.length === 0) {
      await client.query(
        `INSERT INTO users (company_id, username, full_name, password_hash, role, is_active)
         VALUES ($1, 'admin', 'مدير النظام', $2, 'admin', true)`,
        [companyId, passwordHash],
      );
      console.log('[seed] تم إنشاء مستخدم admin (كلمة المرور غير مُعرَضة في السجلات).');
    } else {
      await client.query(
        `UPDATE users
            SET password_hash = $2,
                is_active = true,
                updated_at = now()
          WHERE id = $1`,
        [existing.rows[0].id, passwordHash],
      );
      console.log('[seed] مستخدم admin موجود مسبقاً — تم تحديث كلمة المرور من SEED_ADMIN_PASSWORD.');
    }

    const companySeed = await client.query<{ id: string }>('SELECT id FROM companies LIMIT 1');
    if (companySeed.rows.length > 0) {
      const cid = companySeed.rows[0].id;
      const tmplContent = JSON.stringify({
        showBarcode: true,
        showQr: true,
        showItemName: true,
        showInternalCode: true,
        showSupplierCode: true,
        showColorName: true,
        showColorCode: true,
        showLength: true,
        showWidth: true,
        showGsm: true,
        showActualWeight: true,
        showCalculatedWeight: true,
        showWarehouse: true,
        showBatchNo: true,
        showContainerNo: true,
        showPurchaseInvoiceNo: true,
        brandName: 'ALamal-AB',
        subtitle: 'DENIM & TEXTILE',
      });
      await client.query(
        `INSERT INTO label_templates
           (company_id, code, name, template_type, width_mm, height_mm, content_config, is_default, is_active)
         VALUES ($1,'DEFAULT_ROLL_100X80','لصاقة ثوب افتراضية 100×80','ROLL_LABEL',100,80,$2,true,true)
         ON CONFLICT (company_id, code) DO NOTHING`,
        [cid, tmplContent],
      );
      console.log('[seed] تم التحقق من القالب الافتراضي للصاقات.');
    }

    await client.query('COMMIT');
    committed = true;
    const activationSeed = await generateDevKeysIfEnabled(20);
    if (activationSeed.generated > 0) {
      console.log(`[seed] تم توليد ${activationSeed.generated} مفتاح تفعيل تطويري لأن ACTIVATION_GENERATE_DEV_KEYS=true.`);
    } else {
      console.log('[seed] توليد مفاتيح التفعيل معطل افتراضياً — استخدم API الإدارة لتوليد مفاتيح الإنتاج.');
    }
    console.log('[seed] اكتمل بنجاح.');
  } catch (e) {
    if (!committed) {
      await client.query('ROLLBACK');
    }
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[seed] فشل:', err instanceof Error ? err.message : err);
  process.exit(1);
});
