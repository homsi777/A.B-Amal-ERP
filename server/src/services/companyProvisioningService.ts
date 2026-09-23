/**
 * إنشاء حساب/شركة جديدة يدوياً من قبل مدير المنصة (مثال: "مستودع تركيا"
 * بجانب "مستودع سوريا" الموجود) — على عكس postActivationBootstrap.ts الذي
 * يعمل مرة واحدة فقط تلقائياً عند أول تفعيل للنظام بالكامل، هذه الخدمة
 * تُستدعى مرات متعددة، مرة لكل حساب جديد.
 */
import bcrypt from 'bcryptjs';
import { getPool } from '../db/pool.js';
import { ensureCompanyGlCoa } from './glCoaService.js';
import { seedRbacWarehouseTemplate } from './postActivationBootstrap.js';
import { setCompanyActivationStatus } from './activationService.js';
import { logPlatformAction } from './platformAuditService.js';

export class CompanyProvisioningError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public code: string,
  ) {
    super(message);
    this.name = 'CompanyProvisioningError';
  }
}

export type NewCompanyInput = {
  code: string;
  name: string;
  baseCurrencyCode?: string;
};

export type NewCompanyAdminInput = {
  username: string;
  password: string;
  fullName?: string | null;
};

export type ProvisionedCompany = {
  id: string;
  code: string;
  name: string;
  base_currency_code: string;
  is_active: boolean;
  created_at: string;
};

export type ProvisioningActor = {
  userId: string;
  ip?: string | null;
  userAgent?: string | null;
};

export async function provisionCompany(
  company: NewCompanyInput,
  admin: NewCompanyAdminInput,
  actor: ProvisioningActor,
): Promise<ProvisionedCompany> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let companyRow;
    try {
      companyRow = await client.query<ProvisionedCompany>(
        `INSERT INTO companies (code, name, base_currency_code)
         VALUES ($1, $2, $3)
         RETURNING id, code, name, base_currency_code, is_active, created_at`,
        [company.code.trim(), company.name.trim(), company.baseCurrencyCode?.trim() || 'USD'],
      );
    } catch (e: unknown) {
      if ((e as { code?: string }).code === '23505') {
        throw new CompanyProvisioningError('كود الحساب مستخدم مسبقاً', 409, 'COMPANY_CODE_DUPLICATE');
      }
      throw e;
    }
    const companyId = companyRow.rows[0].id;

    await seedRbacWarehouseTemplate(client, companyId);
    await ensureCompanyGlCoa(client, companyId);

    const passwordHash = await bcrypt.hash(admin.password, 12);
    try {
      await client.query(
        `INSERT INTO users (company_id, username, full_name, password_hash, role, is_active)
         VALUES ($1, $2, $3, $4, 'admin', true)`,
        [companyId, admin.username.trim(), admin.fullName?.trim() || null, passwordHash],
      );
    } catch (e: unknown) {
      if ((e as { code?: string }).code === '23505') {
        throw new CompanyProvisioningError('اسم المستخدم مستخدم مسبقاً', 409, 'USERNAME_DUPLICATE');
      }
      throw e;
    }

    // تفعيل تلقائي فور الإنشاء — نفس منطق تفعيل مفتاح حقيقي بالضبط
    // (نفس الدالة، بدون استهلاك أو توليد مفتاح تفعيل حقيقي).
    await setCompanyActivationStatus(client, companyId, {
      planCode: 'FULL',
      activatedAt: new Date().toISOString(),
    });
    await client.query(
      `INSERT INTO activation_events (company_id, event_type, message, created_by_user_id)
       VALUES ($1, 'PLATFORM_PROVISIONED', 'تفعيل تلقائي عند إنشاء حساب من مدير المنصة', $2)`,
      [companyId, actor.userId],
    );

    await logPlatformAction(client, {
      actorUserId: actor.userId,
      action: 'CREATE_COMPANY',
      fromCompanyId: null,
      toCompanyId: companyId,
      ip: actor.ip,
      userAgent: actor.userAgent,
      details: { code: company.code.trim(), name: company.name.trim() },
    });

    await client.query('COMMIT');
    return companyRow.rows[0];
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function listCompanies(): Promise<ProvisionedCompany[]> {
  const res = await getPool().query<ProvisionedCompany>(
    `SELECT id, code, name, base_currency_code, is_active, created_at
     FROM companies ORDER BY created_at ASC`,
  );
  return res.rows;
}
