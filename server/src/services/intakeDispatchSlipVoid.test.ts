/**
 * اختبارات voidIntakeDispatchSlip — بلا قاعدة بيانات حقيقية، بنفس نمط
 * fake-db المعتمد بالمشروع (externalJobProcessing.test.ts). الإلغاء ورقي
 * بالكامل: لا يلمس fabric_rolls ولا inventory_movements إطلاقاً — فقط يُعلِّم
 * intake_operations.status='VOID'، لذا لا استعلامات على هذين الجدولين هنا
 * أصلاً (عدم استدعائهما هو جزء من السلوك الصحيح المُختبَر ضمنياً).
 */
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';
import { voidIntakeDispatchSlip } from './intakeDispatchSlipService.js';

type Row = Record<string, unknown>;

const COMPANY_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const COMPANY_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SLIP_1 = '11111111-1111-4111-8111-111111111111';
const SLIP_PRICED = '11111111-1111-4111-8111-111111111112';
const SLIP_ALREADY_VOID = '11111111-1111-4111-8111-111111111113';
const OP_1 = '22222222-2222-4222-8222-222222222221';
const OP_PRICED = '22222222-2222-4222-8222-222222222222';
const OP_ALREADY_VOID = '22222222-2222-4222-8222-222222222223';

function norm(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().toLowerCase();
}

function createFakeDb() {
  const intakeOperations: Row[] = [
    { id: OP_1, company_id: COMPANY_A, status: 'COMPLETED' },
    { id: OP_PRICED, company_id: COMPANY_A, status: 'COMPLETED' },
    { id: OP_ALREADY_VOID, company_id: COMPANY_A, status: 'VOID' },
  ];
  const dispatchSlips: Row[] = [
    { id: SLIP_1, company_id: COMPANY_A, intake_operation_id: OP_1 },
    { id: SLIP_PRICED, company_id: COMPANY_A, intake_operation_id: OP_PRICED },
    { id: SLIP_ALREADY_VOID, company_id: COMPANY_A, intake_operation_id: OP_ALREADY_VOID },
  ];
  const dispatchSlipLines: Row[] = [
    { id: 'line-1', slip_id: SLIP_1, unit_price: null },
    { id: 'line-2', slip_id: SLIP_PRICED, unit_price: '12.5000' },
  ];

  const query = async (text: string, params: unknown[] = []): Promise<{ rows: Row[] }> => {
    const sql = norm(text);

    if (sql.includes('select intake_operation_id from intake_dispatch_slips')) {
      const [id, companyId] = params as [string, string];
      const row = dispatchSlips.find((s) => s.id === id && s.company_id === companyId);
      return { rows: row ? [row] : [] };
    }
    if (sql.includes('select status from intake_operations')) {
      const [id, companyId] = params as [string, string];
      const row = intakeOperations.find((o) => o.id === id && o.company_id === companyId);
      return { rows: row ? [{ status: row.status }] : [] };
    }
    if (sql.includes('select 1 from intake_dispatch_slip_lines')) {
      const [slipId] = params as [string];
      const rows = dispatchSlipLines.filter((l) => l.slip_id === slipId && l.unit_price != null);
      return { rows: rows.length ? [{ '?column?': 1 }] : [] };
    }
    if (sql.startsWith("update intake_operations set status='void'")) {
      const [id] = params as [string];
      const row = intakeOperations.find((o) => o.id === id);
      if (row) row.status = 'VOID';
      return { rows: [] };
    }

    throw new Error(`Unhandled fake query: ${sql}`);
  };

  return {
    client: { query } as unknown as PoolClient,
    intakeOperations,
  };
}

async function run() {
  // نجاح: إرسالية COMPLETED بلا أي تسعير — يُصبح status='VOID' فقط.
  {
    const { client, intakeOperations } = createFakeDb();
    await voidIntakeDispatchSlip(client, COMPANY_A, SLIP_1);
    const op = intakeOperations.find((o) => o.id === OP_1);
    assert.equal(op?.status, 'VOID');
  }

  // رفض: بدأ التسعير على سطر واحد على الأقل.
  {
    const { client } = createFakeDb();
    await assert.rejects(
      () => voidIntakeDispatchSlip(client, COMPANY_A, SLIP_PRICED),
      (err: unknown) => (err as { code?: string }).code === 'INVALID_STATE',
    );
  }

  // رفض: ملغاة مسبقاً.
  {
    const { client } = createFakeDb();
    await assert.rejects(
      () => voidIntakeDispatchSlip(client, COMPANY_A, SLIP_ALREADY_VOID),
      (err: unknown) => (err as { code?: string }).code === 'INVALID_STATE',
    );
  }

  // رفض: إرسالية لا تنتمي لهذه الشركة.
  {
    const { client } = createFakeDb();
    await assert.rejects(
      () => voidIntakeDispatchSlip(client, COMPANY_B, SLIP_1),
      (err: unknown) => (err as { code?: string }).code === 'NOT_FOUND',
    );
  }

  console.log('  ✓ voids a dispatch slip and marks the intake operation VOID');
  console.log('  ✓ rejects voiding once any line has been priced');
  console.log('  ✓ rejects voiding an already-voided operation');
  console.log('  ✓ rejects a slip belonging to another company');
  console.log('intakeDispatchSlipVoid.test.ts OK');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
