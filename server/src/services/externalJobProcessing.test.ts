/**
 * اختبارات مسار "مصنعية" (Processing) — بدون قاعدة بيانات حقيقية (لا يوجد نفق
 * متاح وقت كتابة هذا الاختبار)، بنفس نمط الـ fake-db المعتمد بالمشروع
 * (inventoryRollEditIsolation.test.ts): عميل مزيّف يحاكي شكل كل استعلام SQL
 * الذي تصدره الخدمة الحقيقية حرفياً، على جداول في الذاكرة.
 */
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';
import { createProcessingExternalJob, voidExternalJob } from './externalJobService.js';
import { generateSupplierOrderNo } from '../utils/documentNumbers.js';
import { verifyCurrentUserPassword, ReauthPasswordInvalidError, ReauthRateLimitedError } from '../utils/reauthGuard.js';
import bcrypt from 'bcryptjs';

type Row = Record<string, unknown>;

// معرّفات UUID صالحة فعلياً (nibble الإصدار '4' وnibble المتغيّر '8') — zod .uuid() يرفض غيرها.
const COMPANY_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const COMPANY_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SUPPLIER_1 = '11111111-1111-4111-8111-111111111111';
const SUPPLIER_2 = '22222222-2222-4222-8222-222222222222';
const PREP_TYPE = '33333333-3333-4333-8333-333333333333';
const WAREHOUSE_RAW = '44444444-4444-4444-8444-444444444444';
const WAREHOUSE_FINISHED = '55555555-5555-4555-8555-555555555555';
const ROLL_OK_1 = '66666666-6666-4666-8666-666666666661';
const ROLL_OK_2 = '66666666-6666-4666-8666-666666666662';
const ROLL_WRONG_WH = '66666666-6666-4666-8666-666666666663';
const ROLL_SOLD = '66666666-6666-4666-8666-666666666664';
const ROLL_OPEN_JOB = '66666666-6666-4666-8666-666666666665';

function norm(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** عميل PostgreSQL مزيّف يحاكي كل استعلام تصدره createProcessingExternalJob/generateSupplierOrderNo. */
function createFakeDb() {
  const externalJobs: Row[] = [];
  const externalJobLines: Row[] = [];
  const inventoryMovements: Row[] = [];
  const fabricRolls: Row[] = [
    { id: ROLL_OK_1, company_id: COMPANY_A, barcode: 'B001', status: 'AVAILABLE', warehouse_id: WAREHOUSE_RAW, length_m: '50.000', color_id: null, actual_weight_kg: null, calculated_weight_kg: null },
    { id: ROLL_OK_2, company_id: COMPANY_A, barcode: 'B002', status: 'AVAILABLE', warehouse_id: WAREHOUSE_RAW, length_m: '30.000', color_id: null, actual_weight_kg: null, calculated_weight_kg: null },
    { id: ROLL_WRONG_WH, company_id: COMPANY_A, barcode: 'B003', status: 'AVAILABLE', warehouse_id: WAREHOUSE_FINISHED, length_m: '20.000', color_id: null, actual_weight_kg: null, calculated_weight_kg: null },
    { id: ROLL_SOLD, company_id: COMPANY_A, barcode: 'B004', status: 'SOLD', warehouse_id: WAREHOUSE_RAW, length_m: '20.000', color_id: null, actual_weight_kg: null, calculated_weight_kg: null },
    { id: ROLL_OPEN_JOB, company_id: COMPANY_A, barcode: 'B005', status: 'AVAILABLE', warehouse_id: WAREHOUSE_RAW, length_m: '20.000', color_id: null, actual_weight_kg: null, calculated_weight_kg: null },
  ];
  // محاكاة: ROLL_OPEN_JOB مرتبط مسبقاً بسطر SENT بمهمة أخرى.
  externalJobLines.push({ id: 'preexisting-line', job_id: 'other-job', company_id: COMPANY_A, roll_id: ROLL_OPEN_JOB, line_status: 'SENT' });

  const suppliers: Row[] = [
    { id: SUPPLIER_1, company_id: COMPANY_A, is_processing_party: true, is_active: true },
    { id: SUPPLIER_2, company_id: COMPANY_A, is_processing_party: true, is_active: true },
  ];
  const prepTypes: Row[] = [
    { id: PREP_TYPE, company_id: COMPANY_A, is_active: true },
  ];
  const warehouses: Row[] = [
    { id: WAREHOUSE_RAW, company_id: COMPANY_A, is_active: true, fabric_stage: 'RAW' },
    { id: WAREHOUSE_FINISHED, company_id: COMPANY_A, is_active: true, fabric_stage: 'FINISHED' },
  ];

  const query = async (text: string, params: unknown[] = []): Promise<{ rows: Row[] }> => {
    const sql = norm(text);

    if (sql.includes('pg_advisory_xact_lock')) return { rows: [] };

    if (sql.includes('select is_processing_party, is_active from suppliers')) {
      const [id, companyId] = params as [string, string];
      const row = suppliers.find((s) => s.id === id && s.company_id === companyId);
      return { rows: row ? [row] : [] };
    }
    if (sql.includes('select is_active from external_job_preparation_types')) {
      const [id, companyId] = params as [string, string];
      const row = prepTypes.find((p) => p.id === id && p.company_id === companyId);
      return { rows: row ? [row] : [] };
    }
    if (sql.includes('select is_active, fabric_stage from warehouses')) {
      const [id, companyId] = params as [string, string];
      const row = warehouses.find((w) => w.id === id && w.company_id === companyId);
      return { rows: row ? [row] : [] };
    }
    if (sql.includes('from fabric_rolls where company_id=$1 and id = any($2::uuid[])')) {
      const [companyId, ids] = params as [string, string[]];
      return { rows: fabricRolls.filter((r) => r.company_id === companyId && ids.includes(r.id as string)) };
    }
    if (sql.includes("from external_job_lines where company_id=$1 and roll_id=$2 and line_status='sent'")) {
      const [companyId, rollId] = params as [string, string];
      const rows = externalJobLines.filter((l) => l.company_id === companyId && l.roll_id === rollId && l.line_status === 'SENT');
      return { rows };
    }
    if (sql.includes('select max(') && sql.includes('from external_jobs') && sql.includes('job_no')) {
      // generateSequentialDocumentNo — لا توجد مهام سابقة بهذا الاختبار.
      return { rows: [{ max_seq: null }] };
    }
    if (sql.includes('select coalesce(max(supplier_order_no), 0) + 1 as next_no')) {
      const [companyId, supplierId] = params as [string, string];
      const existing = externalJobs
        .filter((j) => j.company_id === companyId && j.supplier_id === supplierId && j.supplier_order_no != null)
        .map((j) => Number(j.supplier_order_no));
      const next = existing.length ? Math.max(...existing) + 1 : 1;
      return { rows: [{ next_no: String(next) }] };
    }
    if (sql.startsWith('insert into external_jobs')) {
      const id = `job-${externalJobs.length + 1}`;
      const [companyId, jobNo, supplierId, notes, fabricStage, preparationTypeId, sourceWarehouseId, supplierOrderNo, processDescription] = params as [
        string, string, string, string | null, string, string, string, number, string | null,
      ];
      externalJobs.push({
        id, company_id: companyId, job_no: jobNo, supplier_id: supplierId, notes, document_status: 'CONFIRMED',
        job_kind: 'PROCESSING', fabric_stage: fabricStage, preparation_type_id: preparationTypeId,
        source_warehouse_id: sourceWarehouseId, supplier_order_no: supplierOrderNo, process_description: processDescription,
      });
      return { rows: [{ id }] };
    }
    if (sql.startsWith('insert into external_job_lines')) {
      const [jobId, companyId, rollId, colorId, lengthM, barcode] = params as [string, string, string, string | null, string, string];
      externalJobLines.push({ id: `line-${externalJobLines.length + 1}`, job_id: jobId, company_id: companyId, roll_id: rollId, sent_color_id: colorId, sent_length_m: lengthM, sent_barcode: barcode, line_status: 'SENT' });
      return { rows: [] };
    }
    if (sql.startsWith("update fabric_rolls set status='at_external_job'")) {
      const [rollId, companyId] = params as [string, string];
      const roll = fabricRolls.find((r) => r.id === rollId && r.company_id === companyId);
      if (roll) roll.status = 'AT_EXTERNAL_JOB';
      return { rows: [] };
    }
    if (sql.startsWith('insert into inventory_movements')) {
      inventoryMovements.push({ id: `mv-${inventoryMovements.length + 1}` });
      return { rows: [] };
    }
    if (sql.startsWith('select * from external_jobs where id=$1 and company_id=$2 for update')) {
      const [id, companyId] = params as [string, string];
      const row = externalJobs.find((j) => j.id === id && j.company_id === companyId);
      return { rows: row ? [row] : [] };
    }
    if (sql.includes('from external_job_lines l') && sql.includes('inner join fabric_rolls fr') && sql.includes('for update of fr')) {
      const [jobId, companyId] = params as [string, string];
      const rows = externalJobLines
        .filter((l) => l.job_id === jobId && l.company_id === companyId)
        .map((l) => {
          const roll = fabricRolls.find((r) => r.id === l.roll_id);
          return { id: l.id, roll_id: l.roll_id, line_status: l.line_status, roll_status: roll?.status };
        });
      return { rows };
    }
    if (sql.startsWith("update fabric_rolls set status='available'")) {
      const [rollId, companyId] = params as [string, string];
      const roll = fabricRolls.find((r) => r.id === rollId && r.company_id === companyId);
      if (roll) roll.status = 'AVAILABLE';
      return { rows: [] };
    }
    if (sql.startsWith("update external_jobs set document_status='voided'")) {
      const [id, companyId] = params as [string, string];
      const row = externalJobs.find((j) => j.id === id && j.company_id === companyId);
      if (row) row.document_status = 'VOIDED';
      return { rows: [] };
    }

    throw new Error(`Unhandled fake query: ${sql}`);
  };

  return {
    client: { query } as unknown as PoolClient,
    externalJobs,
    externalJobLines,
    inventoryMovements,
    fabricRolls,
  };
}

async function run() {
  // ── 1) رقم طلبية المورّد: تسلسل مستقل لكل (شركة، مورّد) ──
  {
    const { client, externalJobs } = createFakeDb();
    const n1 = await generateSupplierOrderNo(client, COMPANY_A, SUPPLIER_1);
    externalJobs.push({ company_id: COMPANY_A, supplier_id: SUPPLIER_1, supplier_order_no: n1 });
    const n2 = await generateSupplierOrderNo(client, COMPANY_A, SUPPLIER_1);
    externalJobs.push({ company_id: COMPANY_A, supplier_id: SUPPLIER_1, supplier_order_no: n2 });
    const n3 = await generateSupplierOrderNo(client, COMPANY_A, SUPPLIER_1);
    assert.deepEqual([n1, n2, n3], [1, 2, 3], 'supplier order numbers increment 1,2,3');

    const otherSupplierFirst = await generateSupplierOrderNo(client, COMPANY_A, SUPPLIER_2);
    assert.equal(otherSupplierFirst, 1, 'a different supplier starts again at 1');

    const otherCompanyFirst = await generateSupplierOrderNo(client, COMPANY_B, SUPPLIER_1);
    assert.equal(otherCompanyFirst, 1, 'a different company starts again at 1 even for the same supplier id');
  }
  console.log('  ✓ generateSupplierOrderNo sequencing');

  // ── 2) إنشاء مصنعية ناجح: أتواب صحيحة بمستودع ومرحلة مطابقين ──
  {
    const { client, externalJobs, externalJobLines, inventoryMovements, fabricRolls } = createFakeDb();
    const result = await createProcessingExternalJob(client, COMPANY_A, 'user-1', {
      supplierId: SUPPLIER_1,
      fabricStage: 'RAW',
      preparationTypeId: PREP_TYPE,
      sourceWarehouseId: WAREHOUSE_RAW,
      rollIds: [ROLL_OK_1, ROLL_OK_2],
    });
    assert.equal(result.totalRolls, 2);
    assert.equal(result.supplierOrderNo, 1);
    assert.equal(externalJobs.length, 1);
    assert.equal(externalJobs[0].document_status, 'CONFIRMED');
    assert.equal(externalJobLines.filter((l) => l.job_id === result.id).length, 2);
    assert.equal(inventoryMovements.length, 2);
    assert.equal(fabricRolls.find((r) => r.id === ROLL_OK_1)!.status, 'AT_EXTERNAL_JOB');
    assert.equal(fabricRolls.find((r) => r.id === ROLL_OK_2)!.status, 'AT_EXTERNAL_JOB');
  }
  console.log('  ✓ createProcessingExternalJob success path');

  // ── 3) رفض: توب من مستودع خاطئ ──
  {
    const { client, externalJobs } = createFakeDb();
    await assert.rejects(
      () => createProcessingExternalJob(client, COMPANY_A, 'user-1', {
        supplierId: SUPPLIER_1, fabricStage: 'RAW', preparationTypeId: PREP_TYPE, sourceWarehouseId: WAREHOUSE_RAW,
        rollIds: [ROLL_OK_1, ROLL_WRONG_WH],
      }),
      (e: unknown) => (e as { code?: string }).code === 'INVALID_STOCK',
    );
    assert.equal(externalJobs.length, 0, 'nothing saved — atomic rejection');
  }
  console.log('  ✓ rejects a roll from the wrong warehouse (atomic — nothing saved)');

  // ── 4) رفض: مرحلة المستودع لا تطابق مرحلة المهمة ──
  {
    const { client, externalJobs } = createFakeDb();
    await assert.rejects(
      () => createProcessingExternalJob(client, COMPANY_A, 'user-1', {
        supplierId: SUPPLIER_1, fabricStage: 'FINISHED', preparationTypeId: PREP_TYPE, sourceWarehouseId: WAREHOUSE_RAW,
        rollIds: [ROLL_OK_1],
      }),
      (e: unknown) => (e as { code?: string }).code === 'VALIDATION',
    );
    assert.equal(externalJobs.length, 0);
  }
  console.log('  ✓ rejects a RAW warehouse for a FINISHED job (stage mismatch)');

  // ── 5) رفض: توب غير AVAILABLE ──
  {
    const { client, externalJobs } = createFakeDb();
    await assert.rejects(
      () => createProcessingExternalJob(client, COMPANY_A, 'user-1', {
        supplierId: SUPPLIER_1, fabricStage: 'RAW', preparationTypeId: PREP_TYPE, sourceWarehouseId: WAREHOUSE_RAW,
        rollIds: [ROLL_OK_1, ROLL_SOLD],
      }),
      (e: unknown) => (e as { code?: string }).code === 'INVALID_STOCK',
    );
    assert.equal(externalJobs.length, 0, 'the whole request fails — one bad roll means nothing saved');
  }
  console.log('  ✓ rejects a non-AVAILABLE roll (atomic rollback)');

  // ── 6) رفض: توب مرتبط بمهمة مفتوحة أخرى ──
  {
    const { client, externalJobs } = createFakeDb();
    await assert.rejects(
      () => createProcessingExternalJob(client, COMPANY_A, 'user-1', {
        supplierId: SUPPLIER_1, fabricStage: 'RAW', preparationTypeId: PREP_TYPE, sourceWarehouseId: WAREHOUSE_RAW,
        rollIds: [ROLL_OPEN_JOB],
      }),
      (e: unknown) => (e as { code?: string }).code === 'INVALID_STOCK',
    );
    assert.equal(externalJobs.length, 0);
  }
  console.log('  ✓ rejects a roll already linked to an open external job');

  // ── 7) كلمة المرور: صحيحة/خاطئة/تحديد محاولات ──
  {
    const plain = 'correct-password-123';
    const hash = await bcrypt.hash(plain, 4);
    const fakeClient = {
      query: async () => ({ rows: [{ password_hash: hash }] }),
    } as unknown as PoolClient;

    await verifyCurrentUserPassword(fakeClient, 'user-x', plain);

    await assert.rejects(
      () => verifyCurrentUserPassword(fakeClient, 'user-y', 'wrong-password'),
      ReauthPasswordInvalidError,
    );

    // 5 محاولات فاشلة متتالية لنفس المستخدم → المحاولة السادسة تُرفض بـ rate limit.
    const rateLimitUser = 'user-rate-limit-test';
    for (let i = 0; i < 5; i += 1) {
      await assert.rejects(() => verifyCurrentUserPassword(fakeClient, rateLimitUser, 'wrong'), ReauthPasswordInvalidError);
    }
    await assert.rejects(() => verifyCurrentUserPassword(fakeClient, rateLimitUser, 'wrong'), ReauthRateLimitedError);
  }
  console.log('  ✓ password verification: correct / incorrect / rate-limited after 5 failures');

  // ── 8) voidExternalJob على مهمة مصنعية: يُعيد الأتواب لـAVAILABLE بالمستودع نفسه ──
  {
    const { client, externalJobLines, fabricRolls } = createFakeDb();
    const result = await createProcessingExternalJob(client, COMPANY_A, 'user-1', {
      supplierId: SUPPLIER_1, fabricStage: 'RAW', preparationTypeId: PREP_TYPE, sourceWarehouseId: WAREHOUSE_RAW,
      rollIds: [ROLL_OK_1, ROLL_OK_2],
    });
    assert.equal(fabricRolls.find((r) => r.id === ROLL_OK_1)!.status, 'AT_EXTERNAL_JOB');

    await voidExternalJob(client, COMPANY_A, 'user-1', result.id, null);

    const roll1 = fabricRolls.find((r) => r.id === ROLL_OK_1)!;
    const roll2 = fabricRolls.find((r) => r.id === ROLL_OK_2)!;
    assert.equal(roll1.status, 'AVAILABLE', 'void returns the roll to AVAILABLE');
    assert.equal(roll1.warehouse_id, WAREHOUSE_RAW, 'void never moves the roll — same original warehouse');
    assert.equal(roll2.status, 'AVAILABLE');
  }
  console.log('  ✓ voidExternalJob returns processing-job rolls to AVAILABLE in the original warehouse');

  // ── 9) voidExternalJob يُرفض إن استُلم سطر واحد على الأقل ──
  {
    const { client, externalJobLines } = createFakeDb();
    const result = await createProcessingExternalJob(client, COMPANY_A, 'user-1', {
      supplierId: SUPPLIER_1, fabricStage: 'RAW', preparationTypeId: PREP_TYPE, sourceWarehouseId: WAREHOUSE_RAW,
      rollIds: [ROLL_OK_1],
    });
    const line = externalJobLines.find((l) => l.job_id === result.id)!;
    line.line_status = 'RECEIVED'; // محاكاة استلام هذا السطر فعلياً

    await assert.rejects(
      () => voidExternalJob(client, COMPANY_A, 'user-1', result.id, null),
      (e: unknown) => (e as { code?: string }).code === 'INVALID_STATE',
    );
  }
  console.log('  ✓ voidExternalJob rejects when any line is already RECEIVED');

  console.log('externalJobProcessing.test.ts OK');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
