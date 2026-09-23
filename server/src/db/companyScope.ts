/**
 * غلاف موحّد لعزل بيانات الشركات (multi-tenant isolation).
 *
 * يفتح transaction قصيرة لكل استعلام، يضبط بها متغير الجلسة
 * app.current_company_id عبر set_config، ثم ينفّذ الاستعلام الأصلي.
 * هذا يجهّز القناة اللازمة لسياسات Row-Level Security المستقبلية:
 * أي استعلام يمر من هنا يحمل هوية الشركة، وأي استعلام لا يمر من هنا
 * (بعد تفعيل RLS) لن يرى أي صف بدل أن يسرّب صفوف شركة أخرى.
 *
 * بديل مباشر (drop-in) لـ pool.query(text, params) بنفس شكل الإرجاع.
 */
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { getPool } from './pool.js';

const COMPANY_SCOPE_SETTING = 'app.current_company_id';

export async function applyCompanyScope(client: PoolClient, companyId: string): Promise<void> {
  await client.query('SELECT set_config($1, $2, true)', [COMPANY_SCOPE_SETTING, companyId]);
}

export async function companyQuery<T extends QueryResultRow = QueryResultRow>(
  companyId: string,
  text: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await applyCompanyScope(client, companyId);
    const result = await client.query<T>(text, params);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * لمعالجات فيها عدة استعلامات ضمن نفس transaction (BEGIN/COMMIT صريحة
 * عبر pool.connect()) — تُستدعى مرة واحدة فور BEGIN وقبل أي استعلام آخر
 * على نفس الـ client.
 */
export async function withCompanyScopedClient<T>(
  companyId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await applyCompanyScope(client, companyId);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
