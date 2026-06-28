import type { PoolClient } from 'pg';

/** Stable keys for system-posted accounts (per company). */
export const GL_KEYS = {
  CASH: 'GL_CASH',
  AR: 'GL_AR',
  AP: 'GL_AP',
  SUSPENSE_RECEIPT: 'GL_SUSPENSE_RECEIPT',
  SUSPENSE_PAYMENT: 'GL_SUSPENSE_PAYMENT',
  SALES_RETURNS: 'GL_SALES_RETURNS',
  PURCHASE_RETURNS: 'GL_PURCHASE_RETURNS',
  PAYROLL_EXPENSE: 'GL_PAYROLL_EXPENSE',
  PAYROLL_PAYABLE: 'GL_PAYROLL_PAYABLE',
  INVENTORY: 'GL_INVENTORY',
  SALES_REVENUE: 'GL_SALES_REVENUE',
  COGS: 'GL_COGS',
  /** حسم/خصم منح للعملاء — يُستخدم عند تخفيض ذمة العميل دون قبض نقدي */
  SALES_DISCOUNT_ALLOWANCE: 'GL_SALES_DISCOUNT_ALLOWANCE',
  OPERATING_EXPENSE_TRANSPORT: 'GL_OPERATING_EXPENSE_TRANSPORT',
  OPERATING_EXPENSE_HOSPITALITY: 'GL_OPERATING_EXPENSE_HOSPITALITY',
  OPERATING_EXPENSE_MAINTENANCE: 'GL_OPERATING_EXPENSE_MAINTENANCE',
  OPERATING_EXPENSE_RENT: 'GL_OPERATING_EXPENSE_RENT',
  OPERATING_EXPENSE_GENERAL: 'GL_OPERATING_EXPENSE_GENERAL',
} as const;

/**
 * Ensure default Arabic COA exists for company. Idempotent.
 */
export async function ensureCompanyGlCoa(client: PoolClient, companyId: string): Promise<void> {
  const c = await client.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM gl_accounts WHERE company_id=$1`,
    [companyId],
  );
  if (Number(c.rows[0]?.n ?? '0') > 0) return;

  type Row = {
    code: string;
    name: string;
    account_type: string;
    parent_code: string | null;
    is_posting: boolean;
    system_key: string | null;
    sort_order: number;
  };

  const rows: Row[] = [
    { code: '1', name: 'الأصول', account_type: 'ASSET', parent_code: null, is_posting: false, system_key: null, sort_order: 10 },
    { code: '11', name: 'الأصول المتداولة', account_type: 'ASSET', parent_code: '1', is_posting: false, system_key: null, sort_order: 20 },
    {
      code: '1101',
      name: 'النقدية والصناديق',
      account_type: 'ASSET',
      parent_code: '11',
      is_posting: true,
      system_key: GL_KEYS.CASH,
      sort_order: 30,
    },
    {
      code: '1120',
      name: 'العملاء (ذمم مدينة)',
      account_type: 'ASSET',
      parent_code: '11',
      is_posting: true,
      system_key: GL_KEYS.AR,
      sort_order: 40,
    },
    {
      code: '1130',
      name: 'مخزون الأقمشة',
      account_type: 'ASSET',
      parent_code: '11',
      is_posting: true,
      system_key: GL_KEYS.INVENTORY,
      sort_order: 45,
    },
    {
      code: '1990',
      name: 'حسابات وسيطة — قبض عام',
      account_type: 'ASSET',
      parent_code: '1',
      is_posting: true,
      system_key: GL_KEYS.SUSPENSE_RECEIPT,
      sort_order: 50,
    },
    { code: '2', name: 'الخصوم', account_type: 'LIABILITY', parent_code: null, is_posting: false, system_key: null, sort_order: 60 },
    { code: '21', name: 'خصوم متداولة', account_type: 'LIABILITY', parent_code: '2', is_posting: false, system_key: null, sort_order: 70 },
    {
      code: '2100',
      name: 'الموردون (ذمم دائنة)',
      account_type: 'LIABILITY',
      parent_code: '21',
      is_posting: true,
      system_key: GL_KEYS.AP,
      sort_order: 80,
    },
    {
      code: '2210',
      name: 'رواتب مستحقة',
      account_type: 'LIABILITY',
      parent_code: '21',
      is_posting: true,
      system_key: GL_KEYS.PAYROLL_PAYABLE,
      sort_order: 85,
    },
    {
      code: '2990',
      name: 'حسابات وسيطة — صرف عام',
      account_type: 'LIABILITY',
      parent_code: '2',
      is_posting: true,
      system_key: GL_KEYS.SUSPENSE_PAYMENT,
      sort_order: 90,
    },
    { code: '4', name: 'الإيرادات', account_type: 'REVENUE', parent_code: null, is_posting: false, system_key: null, sort_order: 100 },
    {
      code: '4001',
      name: 'إيرادات مبيعات أقمشة',
      account_type: 'REVENUE',
      parent_code: '4',
      is_posting: true,
      system_key: GL_KEYS.SALES_REVENUE,
      sort_order: 102,
    },
    {
      code: '4101',
      name: 'مرتجعات المشتريات (تخفيض تكلفة)',
      account_type: 'REVENUE',
      parent_code: '4',
      is_posting: true,
      system_key: GL_KEYS.PURCHASE_RETURNS,
      sort_order: 110,
    },
    { code: '5', name: 'المصروفات', account_type: 'EXPENSE', parent_code: null, is_posting: false, system_key: null, sort_order: 120 },
    {
      code: '5101',
      name: 'مرتجعات المبيعات / خصومات مبيعات',
      account_type: 'EXPENSE',
      parent_code: '5',
      is_posting: true,
      system_key: GL_KEYS.SALES_RETURNS,
      sort_order: 130,
    },
    {
      code: '5102',
      name: 'حسومات منحة للعملاء',
      account_type: 'EXPENSE',
      parent_code: '5',
      is_posting: true,
      system_key: GL_KEYS.SALES_DISCOUNT_ALLOWANCE,
      sort_order: 132,
    },
    {
      code: '5131',
      name: 'تكلفة البضاعة المباعة',
      account_type: 'EXPENSE',
      parent_code: '5',
      is_posting: true,
      system_key: GL_KEYS.COGS,
      sort_order: 135,
    },
    {
      code: '6101',
      name: 'مصروف الرواتب',
      account_type: 'EXPENSE',
      parent_code: '5',
      is_posting: true,
      system_key: GL_KEYS.PAYROLL_EXPENSE,
      sort_order: 140,
    },
    {
      code: '6201',
      name: 'مصاريف نقل ومواصلات',
      account_type: 'EXPENSE',
      parent_code: '5',
      is_posting: true,
      system_key: GL_KEYS.OPERATING_EXPENSE_TRANSPORT,
      sort_order: 150,
    },
    {
      code: '6202',
      name: 'مصاريف ضيافة',
      account_type: 'EXPENSE',
      parent_code: '5',
      is_posting: true,
      system_key: GL_KEYS.OPERATING_EXPENSE_HOSPITALITY,
      sort_order: 151,
    },
    {
      code: '6203',
      name: 'مصاريف صيانة',
      account_type: 'EXPENSE',
      parent_code: '5',
      is_posting: true,
      system_key: GL_KEYS.OPERATING_EXPENSE_MAINTENANCE,
      sort_order: 152,
    },
    {
      code: '6204',
      name: 'إيجار ومرافق',
      account_type: 'EXPENSE',
      parent_code: '5',
      is_posting: true,
      system_key: GL_KEYS.OPERATING_EXPENSE_RENT,
      sort_order: 153,
    },
    {
      code: '6205',
      name: 'مصاريف إدارية عامة',
      account_type: 'EXPENSE',
      parent_code: '5',
      is_posting: true,
      system_key: GL_KEYS.OPERATING_EXPENSE_GENERAL,
      sort_order: 154,
    },
  ];

  for (const r of rows) {
    await client.query(
      `INSERT INTO gl_accounts (
         company_id, code, name, account_type, parent_id, is_posting, system_key, sort_order
       )
       SELECT $1, $2, $3, $4,
         (SELECT id FROM gl_accounts WHERE company_id=$1 AND code = $5::text),
         $6, $7, $8`,
      [companyId, r.code, r.name, r.account_type, r.parent_code, r.is_posting, r.system_key, r.sort_order],
    );
  }
}

/** Ensures posting accounts for fabric invoices exist (companies created before migration 016). */
export async function ensureCompanyInvoiceGlAccounts(client: PoolClient, companyId: string): Promise<void> {
  await ensureCompanyGlCoa(client, companyId);

  const upserts: Array<{
    code: string;
    name: string;
    account_type: string;
    parent_code: string;
    system_key: string;
    sort_order: number;
  }> = [
    { code: '1130', name: 'مخزون الأقمشة', account_type: 'ASSET', parent_code: '11', system_key: GL_KEYS.INVENTORY, sort_order: 45 },
    { code: '4001', name: 'إيرادات مبيعات أقمشة', account_type: 'REVENUE', parent_code: '4', system_key: GL_KEYS.SALES_REVENUE, sort_order: 102 },
    { code: '5102', name: 'حسومات منحة للعملاء', account_type: 'EXPENSE', parent_code: '5', system_key: GL_KEYS.SALES_DISCOUNT_ALLOWANCE, sort_order: 132 },
    { code: '5131', name: 'تكلفة البضاعة المباعة', account_type: 'EXPENSE', parent_code: '5', system_key: GL_KEYS.COGS, sort_order: 135 },
  ];

  for (const u of upserts) {
    await client.query(
      `INSERT INTO gl_accounts (company_id, code, name, account_type, parent_id, is_posting, system_key, sort_order)
       SELECT $1, $2, $3, $4,
         (SELECT id FROM gl_accounts p WHERE p.company_id = $1 AND p.code = $5 LIMIT 1),
         true, $6, $7
       WHERE NOT EXISTS (SELECT 1 FROM gl_accounts g WHERE g.company_id = $1 AND g.system_key = $6)`,
      [companyId, u.code, u.name, u.account_type, u.parent_code, u.system_key, u.sort_order],
    );
  }
}

export async function getGlAccountIdByKey(
  client: PoolClient,
  companyId: string,
  systemKey: string,
): Promise<string> {
  const r = await client.query<{ id: string }>(
    `SELECT id FROM gl_accounts WHERE company_id=$1 AND system_key=$2`,
    [companyId, systemKey],
  );
  if (!r.rows.length) {
    throw Object.assign(new Error(`حساب GL ناقص: ${systemKey}`), { code: 'GL_CONFIG' });
  }
  return r.rows[0].id;
}

const OPERATING_EXPENSE_GL_UPSERTS = [
  { code: '6201', name: 'مصاريف نقل ومواصلات', system_key: GL_KEYS.OPERATING_EXPENSE_TRANSPORT, sort_order: 150 },
  { code: '6202', name: 'مصاريف ضيافة', system_key: GL_KEYS.OPERATING_EXPENSE_HOSPITALITY, sort_order: 151 },
  { code: '6203', name: 'مصاريف صيانة', system_key: GL_KEYS.OPERATING_EXPENSE_MAINTENANCE, sort_order: 152 },
  { code: '6204', name: 'إيجار ومرافق', system_key: GL_KEYS.OPERATING_EXPENSE_RENT, sort_order: 153 },
  { code: '6205', name: 'مصاريف إدارية عامة', system_key: GL_KEYS.OPERATING_EXPENSE_GENERAL, sort_order: 154 },
] as const;

const DEFAULT_EXPENSE_CATEGORIES = [
  { code: 'TRANSPORT', name: 'نقل ومواصلات', glKey: GL_KEYS.OPERATING_EXPENSE_TRANSPORT, sort_order: 10 },
  { code: 'HOSPITALITY', name: 'ضيافة', glKey: GL_KEYS.OPERATING_EXPENSE_HOSPITALITY, sort_order: 20 },
  { code: 'MAINTENANCE', name: 'صيانة', glKey: GL_KEYS.OPERATING_EXPENSE_MAINTENANCE, sort_order: 30 },
  { code: 'RENT', name: 'إيجار ومرافق', glKey: GL_KEYS.OPERATING_EXPENSE_RENT, sort_order: 40 },
  { code: 'ADMIN', name: 'مصاريف إدارية عامة', glKey: GL_KEYS.OPERATING_EXPENSE_GENERAL, sort_order: 50 },
] as const;

/** Ensures operating expense GL accounts + default categories exist (idempotent). */
export async function ensureCompanyOperatingExpenseCoa(client: PoolClient, companyId: string): Promise<void> {
  await ensureCompanyGlCoa(client, companyId);

  for (const u of OPERATING_EXPENSE_GL_UPSERTS) {
    await client.query(
      `INSERT INTO gl_accounts (company_id, code, name, account_type, parent_id, is_posting, system_key, sort_order)
       SELECT $1, $2, $3, 'EXPENSE',
         (SELECT id FROM gl_accounts p WHERE p.company_id = $1 AND p.code = '5' LIMIT 1),
         true, $4, $5
       WHERE NOT EXISTS (SELECT 1 FROM gl_accounts g WHERE g.company_id = $1 AND g.system_key = $4)`,
      [companyId, u.code, u.name, u.system_key, u.sort_order],
    );
  }

  for (const cat of DEFAULT_EXPENSE_CATEGORIES) {
    const glAccountId = await getGlAccountIdByKey(client, companyId, cat.glKey);
    await client.query(
      `INSERT INTO expense_categories (company_id, code, name, gl_account_id, sort_order)
       SELECT $1, $2, $3, $4, $5
       WHERE NOT EXISTS (
         SELECT 1 FROM expense_categories ec WHERE ec.company_id = $1 AND ec.code = $2
       )`,
      [companyId, cat.code, cat.name, glAccountId, cat.sort_order],
    );
  }
}
