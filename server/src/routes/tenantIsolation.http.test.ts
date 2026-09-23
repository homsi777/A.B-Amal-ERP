/**
 * اختبارات HTTP حقيقية لعزل البيانات بين الحسابات (company_id) وصلاحيات
 * مدير المنصة — باستخدام app.inject على نسخة Fastify كاملة، بلا mock.
 *
 * يرفض العمل إلا على قاعدة بيانات اسمها الحرفي clotex_test — أمان أساسي
 * ضد تشغيله عن طريق الخطأ على قاعدة إنتاجية أو حتى على clotex_restore_check.
 *
 * التشغيل (على Windows، بعد إنشاء وترحيل قاعدة clotex_test محلياً):
 *   $env:DATABASE_URL='postgresql://postgres@localhost:5432/clotex_test'
 *   npx tsx server/src/routes/tenantIsolation.http.test.ts
 */
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';

const rawUrl = process.env.DATABASE_URL || '';
let dbName = '';
try {
  dbName = new URL(rawUrl).pathname.replace(/^\//, '');
} catch {
  /* ignore */
}
if (dbName !== 'clotex_test') {
  console.error(
    `[tenantIsolation] رُفض التشغيل: DATABASE_URL يجب أن يشير حرفياً إلى قاعدة اسمها clotex_test (القيمة الحالية: "${dbName || '(غير محدد)'}").`,
  );
  process.exit(1);
}

const { buildApp } = await import('../app.js');
const { getPool } = await import('../db/pool.js');
const { provisionCompany } = await import('../services/companyProvisioningService.js');
const { setCompanyActivationStatus } = await import('../services/activationService.js');

const pool = getPool();
const app = await buildApp();

type Ctx = {
  companyAId: string;
  companyBId: string;
  adminAToken: string;
  adminBToken: string;
  platformAdminToken: string;
  platformAdminUserId: string;
  customerAId: string;
  supplierAId: string;
  warehouseAId: string;
  fabricItemAId: string;
  fabricRollAId: string;
  salesInvoiceAId: string;
  purchaseInvoiceAId: string;
  voucherAId: string;
};

async function login(username: string, password: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username, password },
  });
  const body = res.json();
  assert.equal(res.statusCode, 200, `login فشل لـ ${username}: ${JSON.stringify(body)}`);
  return body.token;
}

async function setup(): Promise<Ctx> {
  // شركة A تُنشأ يدوياً (bootstrap) — provisionCompany تحتاج "فاعلاً" (actor)
  // موجوداً أصلاً بجدول users لسجل التدقيق، وهذا غير متوفر لأول شركة في
  // قاعدة اختبار فارغة تماماً. في الواقع الحقيقي بشير موجود مسبقاً دائماً
  // قبل أي إنشاء حساب، فهذا لا يمثّل مساراً حقيقياً يحتاج اختباراً بذاته.
  const companyARow = await pool.query<{ id: string }>(
    `INSERT INTO companies (code, name, base_currency_code) VALUES ('TEST-A','شركة اختبار A','USD') RETURNING id`,
  );
  const companyAId = companyARow.rows[0].id;
  await setCompanyActivationStatus(pool, companyAId, { planCode: 'FULL', activatedAt: new Date().toISOString() });

  const passwordHash = await bcrypt.hash('password123', 12);
  await pool.query(
    `INSERT INTO users (company_id, username, full_name, password_hash, role, is_active, is_platform_admin)
     VALUES ($1, 'admin_a_test', 'أدمن A', $2, 'admin', true, false)`,
    [companyAId, passwordHash],
  );
  const platformAdminRow = await pool.query<{ id: string }>(
    `INSERT INTO users (company_id, username, full_name, password_hash, role, is_active, is_platform_admin)
     VALUES ($1, 'platform_admin_test', 'مدير المنصة', $2, 'admin', true, true) RETURNING id`,
    [companyAId, passwordHash],
  );

  // شركة B تُنشأ عبر المسار الحقيقي provisionCompany (بفاعل حقيقي = مدير
  // المنصة) — يفحص هذا فعلياً كامل مسار التزريع + التفعيل التلقائي + سجل
  // التدقيق (بند 6 و4)، وليس فقط bootstrap يدوي.
  const companyB = await provisionCompany(
    { code: 'TEST-B', name: 'شركة اختبار B' },
    { username: 'admin_b_test', password: 'password123', fullName: 'أدمن B' },
    { userId: platformAdminRow.rows[0].id, ip: '127.0.0.1', userAgent: 'tenantIsolation.http.test.ts' },
  );

  const adminAToken = await login('admin_a_test', 'password123');
  const adminBToken = await login('admin_b_test', 'password123');
  const platformAdminToken = await login('platform_admin_test', 'password123');

  // بيانات حقيقية بشركة A عبر SQL مباشر (أسرع من محاكاة كل شاشة إنشاء
  // بكامل تحقّقاتها، ونفس النتيجة من ناحية عزل company_id).
  const customerA = await pool.query<{ id: string }>(
    `INSERT INTO customers (company_id, code, name) VALUES ($1,'CUST-A','عميل A') RETURNING id`,
    [companyAId],
  );
  const supplierA = await pool.query<{ id: string }>(
    `INSERT INTO suppliers (company_id, code, name) VALUES ($1,'SUP-A','مورد A') RETURNING id`,
    [companyAId],
  );
  const warehouseA = await pool.query<{ id: string }>(
    `INSERT INTO warehouses (company_id, code, name) VALUES ($1,'WH-A','مستودع A') RETURNING id`,
    [companyAId],
  );
  const fabricItemA = await pool.query<{ id: string }>(
    `INSERT INTO fabric_items (company_id, internal_code, name) VALUES ($1,'ITEM-A','خامة A') RETURNING id`,
    [companyAId],
  );
  const fabricRollA = await pool.query<{ id: string }>(
    `INSERT INTO fabric_rolls (company_id, barcode, item_id, warehouse_id, length_m, status)
     VALUES ($1,'BARCODE-A',$2,$3,10,'AVAILABLE') RETURNING id`,
    [companyAId, fabricItemA.rows[0].id, warehouseA.rows[0].id],
  );
  const salesInvoiceA = await pool.query<{ id: string }>(
    `INSERT INTO sales_invoices (company_id, invoice_no, customer_id) VALUES ($1,'FB-TEST-A',$2) RETURNING id`,
    [companyAId, customerA.rows[0].id],
  );
  const purchaseInvoiceA = await pool.query<{ id: string }>(
    `INSERT INTO purchase_invoices (company_id, invoice_no, supplier_id) VALUES ($1,'FS-TEST-A',$2) RETURNING id`,
    [companyAId, supplierA.rows[0].id],
  );
  const voucherA = await pool.query<{ id: string }>(
    `INSERT INTO vouchers (company_id, voucher_no, voucher_type, party_name, amount)
     VALUES ($1,'SQ-TEST-A','RECEIPT','عميل A',100) RETURNING id`,
    [companyAId],
  );

  return {
    companyAId: companyAId,
    companyBId: companyB.id,
    adminAToken,
    adminBToken,
    platformAdminToken,
    platformAdminUserId: platformAdminRow.rows[0].id,
    customerAId: customerA.rows[0].id,
    supplierAId: supplierA.rows[0].id,
    warehouseAId: warehouseA.rows[0].id,
    fabricItemAId: fabricItemA.rows[0].id,
    fabricRollAId: fabricRollA.rows[0].id,
    salesInvoiceAId: salesInvoiceA.rows[0].id,
    purchaseInvoiceAId: purchaseInvoiceA.rows[0].id,
    voucherAId: voucherA.rows[0].id,
  };
}

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${e instanceof Error ? e.message : e}`);
  }
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function main() {
  console.log('[tenantIsolation] إعداد شركتين + مدير منصة + بيانات حقيقية بشركة A ...');
  const ctx = await setup();
  console.log('[tenantIsolation] بدء الاختبارات:\n');

  // (a) GET-by-id لبيانات A من B — 404 في كل الحالات
  const getByIdCases: { label: string; path: string }[] = [
    { label: 'customer', path: `/api/customers/${ctx.customerAId}` },
    { label: 'supplier', path: `/api/suppliers/${ctx.supplierAId}` },
    { label: 'warehouse', path: `/api/warehouses/${ctx.warehouseAId}` },
    { label: 'fabric item', path: `/api/fabric/items/${ctx.fabricItemAId}` },
    { label: 'fabric roll', path: `/api/inventory/rolls/${ctx.fabricRollAId}` },
    { label: 'sales invoice', path: `/api/sales-invoices/${ctx.salesInvoiceAId}` },
    { label: 'purchase invoice', path: `/api/purchase-invoices/${ctx.purchaseInvoiceAId}` },
    { label: 'voucher', path: `/api/vouchers/${ctx.voucherAId}` },
  ];
  for (const c of getByIdCases) {
    await test(`(a) GET ${c.label} لـ A من B → 404`, async () => {
      const res = await app.inject({ method: 'GET', url: c.path, headers: auth(ctx.adminBToken) });
      assert.equal(res.statusCode, 404, `توقعت 404، وصل ${res.statusCode}: ${res.body}`);
    });
  }
  console.log('  ملاحظة: journal_entries ليس له GET /:id مباشر (تحققت بالكود) — لا حالة (a) له.');

  // (b) PUT على بيانات A من B — يُرفض والصف لا يتغيّر
  await test('(b) PUT customer لـ A من B → مرفوض، الاسم لم يتغيّر', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/customers/${ctx.customerAId}`,
      headers: auth(ctx.adminBToken),
      payload: { code: 'CUST-A', name: 'تم التعديل من B' },
    });
    assert.ok(res.statusCode === 404 || res.statusCode === 403, `توقعت 404/403، وصل ${res.statusCode}`);
    const row = await pool.query('SELECT name FROM customers WHERE id=$1', [ctx.customerAId]);
    assert.equal(row.rows[0].name, 'عميل A', 'الاسم تغيّر رغم الرفض!');
  });

  await test('(b) PUT fabric item لـ A من B → مرفوض، لم يتغيّر', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/fabric/items/${ctx.fabricItemAId}`,
      headers: auth(ctx.adminBToken),
      payload: { name: 'تم التعديل من B', internal_code: 'ITEM-A' },
    });
    assert.ok(res.statusCode === 404 || res.statusCode === 403, `توقعت 404/403، وصل ${res.statusCode}`);
    const row = await pool.query('SELECT name FROM fabric_items WHERE id=$1', [ctx.fabricItemAId]);
    assert.equal(row.rows[0].name, 'خامة A', 'الاسم تغيّر رغم الرفض!');
  });

  // (c) إنشاء فاتورة مبيعات بـ customer_id تابع لـ A، كأدمن B → مرفوض
  await test('(c) POST sales invoice بعميل A من B → مرفوض (ليس 201)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/sales-invoices',
      headers: auth(ctx.adminBToken),
      payload: { customerId: ctx.customerAId, items: [] },
    });
    assert.notEqual(res.statusCode, 201, `توقعت رفضاً، لكن أنشأ الفاتورة (201): ${res.body}`);
  });

  // (d) GET /api/system/users كـ B لا يُرجع مستخدمي A
  await test('(d) GET /system/users كـ B لا يحتوي مستخدمي A', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/system/users', headers: auth(ctx.adminBToken) });
    assert.equal(res.statusCode, 200);
    const usernames = res.json().data.map((u: { username: string }) => u.username);
    assert.ok(!usernames.includes('admin_a_test'), 'B شاف مستخدم A!');
  });

  // (e) POST /system/users مع companyId=A من B → يُنشأ بـ B فعلياً (يُتجاهل الحقل)
  await test('(e) POST /system/users بـ companyId=A من B → يُنشأ بحساب B لا A', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/system/users',
      headers: auth(ctx.adminBToken),
      payload: { username: 'sneaky_user_test', password: 'password123', role: 'viewer', companyId: ctx.companyAId },
    });
    assert.equal(res.statusCode, 201, res.body);
    const row = await pool.query('SELECT company_id FROM users WHERE username=$1', ['sneaky_user_test']);
    assert.equal(row.rows[0].company_id, ctx.companyBId, 'انضاف المستخدم لحساب A رغم أن المنشئ أدمن B!');
  });

  // (f) غير مدير منصة → 403 على نقاط مدير المنصة
  const platformOnlyCases: { method: 'GET' | 'POST' | 'PUT' | 'PATCH'; path: string }[] = [
    { method: 'POST', path: '/api/auth/switch-company' },
    { method: 'GET', path: '/api/companies' },
    { method: 'POST', path: '/api/companies' },
    { method: 'GET', path: '/api/activation/keys' },
    { method: 'POST', path: '/api/activation/keys/generate' },
    { method: 'PATCH', path: '/api/activation/keys/00000000-0000-0000-0000-000000000000/revoke' },
    { method: 'GET', path: '/api/activation/events' },
    { method: 'GET', path: '/api/activation/devices' },
    { method: 'PUT', path: '/api/system/roles/viewer' },
  ];
  for (const c of platformOnlyCases) {
    await test(`(f) ${c.method} ${c.path} من أدمن شركة عادي → 403`, async () => {
      const res = await app.inject({ method: c.method, url: c.path, headers: auth(ctx.adminAToken), payload: {} });
      assert.equal(res.statusCode, 403, `توقعت 403، وصل ${res.statusCode}: ${res.body}`);
    });
  }

  // (g) مدير منصة يتبدّل لـ B → /me يرجع B، سجل تدقيق موجود، البيانات فقط لـ B
  await test('(g) switch-company إلى B ثم /me يرجع B + سجل تدقيق + بيانات B فقط', async () => {
    const switchRes = await app.inject({
      method: 'POST',
      url: '/api/auth/switch-company',
      headers: auth(ctx.platformAdminToken),
      payload: { companyId: ctx.companyBId },
    });
    assert.equal(switchRes.statusCode, 200, switchRes.body);
    const switchedToken = switchRes.json().token;

    const meRes = await app.inject({ method: 'GET', url: '/api/auth/me', headers: auth(switchedToken) });
    assert.equal(meRes.json().user.companyId, ctx.companyBId, '/me لم يرجع B بعد التبديل');
    assert.equal(meRes.json().user.homeCompanyId, ctx.companyAId, 'homeCompanyId يجب أن يبقى A');

    const auditRow = await pool.query(
      `SELECT * FROM platform_audit_log WHERE action='SWITCH_COMPANY' AND actor_user_id=$1 AND to_company_id=$2`,
      [ctx.platformAdminUserId, ctx.companyBId],
    );
    assert.ok(auditRow.rows.length > 0, 'لا يوجد سجل تدقيق لـ SWITCH_COMPANY');

    const customersRes = await app.inject({ method: 'GET', url: '/api/customers', headers: auth(switchedToken) });
    const names = customersRes.json().data.map((c: { name: string }) => c.name);
    assert.ok(!names.includes('عميل A'), 'شاف عميل A بعد التبديل لـ B!');
  });

  // (h) إلغاء صلاحية مدير المنصة من قاعدة البيانات → الطلب التالي بنفس التوكن المُبدَّل يُرفض فوراً
  await test('(h) سحب is_platform_admin ثم طلب بالتوكن المُبدَّل → مرفوض فوراً', async () => {
    const switchRes = await app.inject({
      method: 'POST',
      url: '/api/auth/switch-company',
      headers: auth(ctx.platformAdminToken),
      payload: { companyId: ctx.companyBId },
    });
    const switchedToken = switchRes.json().token;

    await pool.query('UPDATE users SET is_platform_admin=false WHERE id=$1', [ctx.platformAdminUserId]);

    const res = await app.inject({ method: 'GET', url: '/api/customers', headers: auth(switchedToken) });
    assert.equal(res.statusCode, 403, `توقعت 403 فوراً بعد سحب الصلاحية، وصل ${res.statusCode}`);

    // إرجاع الصلاحية لبقية الاختبارات إن وُجدت لاحقاً
    await pool.query('UPDATE users SET is_platform_admin=true WHERE id=$1', [ctx.platformAdminUserId]);
  });

  // (i) حساب جديد مُنشأ حديثاً يعمل فوراً بدون 403 تفعيل
  await test('(i) حساب جديد مُفعَّل تلقائياً — أول أدمن يقدر يسرد العملاء فوراً', async () => {
    const newCompanyRes = await app.inject({
      method: 'POST',
      url: '/api/companies',
      headers: auth(ctx.platformAdminToken),
      payload: {
        code: 'TEST-C',
        name: 'شركة اختبار C',
        adminUsername: 'admin_c_test',
        adminPassword: 'password123',
      },
    });
    assert.equal(newCompanyRes.statusCode, 201, newCompanyRes.body);
    const newAdminToken = await login('admin_c_test', 'password123');
    const listRes = await app.inject({ method: 'GET', url: '/api/customers', headers: auth(newAdminToken) });
    assert.equal(listRes.statusCode, 200, `توقعت 200 (مفعّل تلقائياً)، وصل ${listRes.statusCode}: ${listRes.body}`);
  });

  console.log(`\n[tenantIsolation] النتيجة: ${passed} نجح، ${failed} فشل.`);
  await app.close();
  await pool.end();
  if (failed > 0) process.exit(1);
}

main().catch(async (e) => {
  console.error('[tenantIsolation] خطأ غير متوقع:', e);
  try {
    await app.close();
    await pool.end();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
