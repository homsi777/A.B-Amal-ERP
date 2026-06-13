/**
 * بعد تفعيل النظام لأول مرة بدون تشغيل server:seed:
 * يُكمّل العملات، الأدوار، الصلاحيات، المستودع، قالب اللصاقة، ومستخدم admin إن لم يوجد أحد.
 */
import bcrypt from 'bcryptjs';
import type { PoolClient } from 'pg';
import { resolveAdminPassword } from '../db/adminSeedPassword.js';
import { PERMISSIONS, ROLES } from '../db/seedConstants.js';
import { getPool } from '../db/pool.js';
import { ensureCompanyGlCoa } from '../services/glCoaService.js';

async function seedRbacWarehouseTemplate(client: PoolClient, companyId: string): Promise<void> {
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
  const adminRoleId = adminRole.rows[0]?.id;
  if (!adminRoleId) throw new Error('admin role missing after seed');

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
  const viewerId = viewerRole.rows[0]?.id;
  if (viewerId) {
    for (const code of viewerPermCodes) {
      const pid = permByCode.get(code);
      if (pid) {
        await client.query(
          `INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [viewerId, pid],
        );
      }
    }
  }

  await client.query(
    `INSERT INTO warehouses (company_id, code, name, type, is_active)
     VALUES ($1, 'MAIN', 'المستودع الرئيسي', 'MAIN', true)
     ON CONFLICT (company_id, code) DO NOTHING`,
    [companyId],
  );

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
    brandName: 'Alamal Trading',
    subtitle: 'DENIM & TEXTILE',
  });
  await client.query(
    `INSERT INTO label_templates
       (company_id, code, name, template_type, width_mm, height_mm, content_config, is_default, is_active)
     VALUES ($1,'DEFAULT_ROLL_100X80','لصاقة ثوب افتراضية 100×80','ROLL_LABEL',100,80,$2,true,true)
     ON CONFLICT (company_id, code) DO NOTHING`,
    [companyId, tmplContent],
  );
}

export async function runPostActivationBootstrap(companyId: string): Promise<void> {
  const pool = getPool();
  const countRow = await pool.query<{ n: string }>(
    'SELECT COUNT(*)::text AS n FROM users',
  );
  if (Number(countRow.rows[0]?.n ?? '0') > 0) {
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

  await seedRbacWarehouseTemplate(client, companyId);
  await ensureCompanyGlCoa(client, companyId);

  let plain: string | undefined;
    try {
      plain = resolveAdminPassword();
    } catch (e) {
      console.warn(
        '[bootstrap] لم يُنشَأ admin تلقائياً (ضبط SEED_ADMIN_PASSWORD ثم npm run server:seed):',
        e instanceof Error ? e.message : e,
      );
      await client.query('COMMIT');
      return;
    }

    const passwordHash = await bcrypt.hash(plain, 12);
    await client.query(
      `INSERT INTO users (company_id, username, full_name, password_hash, role, is_active)
       VALUES ($1, 'admin', 'مدير النظام', $2, 'admin', true)`,
      [companyId, passwordHash],
    );

    await client.query('COMMIT');
    console.log('[bootstrap] تم إنشاء مستخدم admin بعد التفعيل (كلمة المرور من SEED_ADMIN_PASSWORD أو admin123 في التطوير).');
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    console.error('[bootstrap] فشل التهيئة بعد التفعيل:', e instanceof Error ? e.message : e);
    throw e;
  } finally {
    client.release();
  }
}
