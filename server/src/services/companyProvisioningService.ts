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

export async function provisionCompany(
  company: NewCompanyInput,
  admin: NewCompanyAdminInput,
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
