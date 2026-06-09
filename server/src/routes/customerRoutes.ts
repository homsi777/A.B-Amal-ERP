import type { FastifyPluginAsync } from 'fastify';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { authenticateRequest } from '../middleware/auth.js';
import { ArabicErrors } from '../utils/arabicErrors.js';
import { generateSequentialDocumentNo } from '../utils/documentNumbers.js';
import { sendError } from '../middleware/errorHandler.js';
import { insertPartyActivityLog } from '../services/partyActivityLogService.js';
import { getCustomerStatement } from '../services/partyStatementService.js';
import { createSalesInvoice } from '../services/salesInvoiceService.js';
import { applyVoucherConfirmation, insertDraftVoucher } from '../services/voucherCashboxService.js';
import { ensureCompanyInvoiceGlAccounts, getGlAccountIdByKey, GL_KEYS } from '../services/glCoaService.js';

const customerBody = z.object({
  name: z.string().min(1, 'الاسم مطلوب'),
  code: z.string().optional(),
  phone: z.string().optional().default(''),
  email: z.string().email().optional().or(z.literal('')),
  address: z.string().optional().default(''),
  notes: z.string().optional().default(''),
  telegramChatId: z.string().trim().max(64).optional().default(''),
  telegramEnabled: z.boolean().optional().default(false),
  telegramLabel: z.string().trim().max(120).optional().default(''),
});

const importedSaleLineBody = z.object({
  date: z.string().optional(),
  originalDateValue: z.string().optional().default(''),
  dateParseSource: z.string().optional().default(''),
  materialName: z.string().optional().default(''),
  quantity: z.coerce.number().nonnegative().default(0),
  rolls: z.coerce.number().nonnegative().default(0),
  city: z.string().optional().default(''),
  unitPrice: z.coerce.number().nonnegative().default(0),
  total: z.coerce.number().positive(),
  note: z.string().optional().default(''),
});

const importedPaymentBody = z.object({
  date: z.string().min(1),
  originalDateValue: z.string().optional().default(''),
  dateParseSource: z.string().optional().default(''),
  amount: z.coerce.number().positive(),
  kind: z.enum(['payment', 'return']).default('payment'),
  rawLabel: z.string().optional().default(''),
});

const importStatementBody = z.object({
  fileName: z.string().min(1),
  customerName: z.string().min(1),
  orderDate: z.string().min(1),
  currencyCode: z.string().min(1).default('USD'),
  cashboxId: z.string().uuid().optional().nullable(),
  saleLines: z.array(importedSaleLineBody).default([]),
  payments: z.array(importedPaymentBody).default([]),
  returnPayments: z.array(importedPaymentBody).default([]),
  sheetBalance: z.coerce.number().optional().nullable(),
  computedSalesTotal: z.coerce.number().nonnegative(),
  paymentsTotal: z.coerce.number().nonnegative().default(0),
  returnsTotal: z.coerce.number().nonnegative().default(0),
  computedBalance: z.coerce.number().default(0),
  balanceDifference: z.coerce.number().default(0),
});

function genCode() {
  return `CUS-${Date.now().toString(36).toUpperCase().slice(-6)}`;
}

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function safeDocumentPart(value: string): string {
  return value
    .trim()
    .replace(/\.[^.]+$/, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36) || 'CUSTOMER';
}

function stableUuid(seed: string): string {
  const hex = createHash('sha1').update(seed).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function isValidIsoDateOnly(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [yearText, monthText, dayText] = value.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function validateImportedStatementDates(input: z.infer<typeof importStatementBody>): string[] {
  const errors: string[] = [];
  if (!isValidIsoDateOnly(input.orderDate)) errors.push('تاريخ الكشف غير صالح أو غير مفهوم.');
  input.saleLines.forEach((line, index) => {
    if (!isValidIsoDateOnly(line.date)) errors.push(`تاريخ بند المبيعات رقم ${index + 1} غير صالح أو غير مفهوم.`);
  });
  [...input.payments, ...input.returnPayments].forEach((payment, index) => {
    if (!isValidIsoDateOnly(payment.date)) errors.push(`تاريخ الدفعة/المرتجع رقم ${index + 1} غير صالح أو غير مفهوم.`);
  });
  return errors;
}

async function resolveImportedCustomer(client: any, companyId: string, customerName: string) {
  const exact = await client.query(
    `SELECT id, code, name FROM customers WHERE company_id=$1 AND lower(trim(name))=lower(trim($2)) LIMIT 1`,
    [companyId, customerName],
  );
  if (exact.rows.length) return exact.rows[0] as { id: string; code: string; name: string };

  const created = await client.query(
    `INSERT INTO customers(company_id, code, name, notes)
     VALUES($1,$2,$3,$4)
     RETURNING id, code, name`,
    [companyId, genCode(), customerName.trim(), 'أضيف تلقائياً من استيراد كشف حساب عميل Excel'],
  );
  return created.rows[0] as { id: string; code: string; name: string };
}

async function existingSalesInvoiceId(client: any, companyId: string, invoiceNos: string[], fileName: string) {
  const row = await client.query(
    `SELECT id, invoice_no
     FROM sales_invoices
     WHERE company_id=$1
       AND (invoice_no = ANY($2::text[]) OR COALESCE(notes,'') ILIKE $3)
     ORDER BY created_at ASC
     LIMIT 1`,
    [companyId, invoiceNos, `%${fileName}%`],
  );
  return row.rows[0] ?? null;
}

async function syncImportedInvoiceLineMetadata(
  client: any,
  input: {
    companyId: string;
    invoiceId: string;
    fileName: string;
    saleLines: z.infer<typeof importedSaleLineBody>[];
  },
) {
  if (!input.saleLines.length) return 0;
  let updated = 0;
  for (let i = 0; i < input.saleLines.length; i++) {
    const line = input.saleLines[i];
    const result = await client.query(
      `UPDATE sales_invoice_lines
       SET metadata = COALESCE(metadata, '{}'::jsonb) || $4::jsonb
       WHERE company_id=$1 AND invoice_id=$2 AND line_no=$3`,
      [
        input.companyId,
        input.invoiceId,
        i + 1,
        JSON.stringify({
          statementImport: true,
          fileName: input.fileName,
          rowDate: line.date,
          originalDateValue: line.originalDateValue || null,
          dateParseSource: line.dateParseSource || null,
          materialName: line.materialName,
          city: line.city,
          unitPrice: line.unitPrice,
          rolls: line.rolls,
          sourceLine: i + 1,
          note: line.note,
        }),
      ],
    );
    updated += result.rowCount ?? 0;
  }
  return updated;
}

async function voucherAlreadyImported(
  client: any,
  input: {
    companyId: string;
    customerId: string;
    voucherDate: string;
    amount: number;
    referenceNo: string;
    legacyReferenceNo: string;
  },
) {
  const row = await client.query(
    `SELECT id FROM vouchers
     WHERE company_id=$1 AND party_type='CUSTOMER' AND party_id=$2
       AND voucher_type='RECEIPT' AND voucher_date=$3::date
       AND amount=$4 AND status <> 'CANCELLED'
       AND (
         (reference_document_type='CUSTOMER_STATEMENT_IMPORT' AND reference_document_no=$5)
         OR (reference_document_type='OLD_CUSTOMER_STATEMENT_IMPORT' AND reference_document_no=$6)
       )
     LIMIT 1`,
    [input.companyId, input.customerId, input.voucherDate.slice(0, 10), input.amount, input.referenceNo, input.legacyReferenceNo],
  );
  return row.rows.length > 0;
}

async function insertCustomerCreditJournal(
  client: any,
  input: {
    companyId: string;
    userId: string | null;
    customerId: string;
    entryDate: string;
    amount: number;
    sourceSeed: string;
    description: string;
  },
) {
  const amount = round2(input.amount);
  if (amount <= 0) return false;
  const sourceId = stableUuid(input.sourceSeed);
  const exists = await client.query(
    `SELECT id FROM journal_entries WHERE company_id=$1 AND source_type='OPENING' AND source_id=$2::uuid LIMIT 1`,
    [input.companyId, sourceId],
  );
  if (exists.rows.length) return false;

  await ensureCompanyInvoiceGlAccounts(client, input.companyId);
  const arId = await getGlAccountIdByKey(client, input.companyId, GL_KEYS.AR);
  const salesReturnId = await getGlAccountIdByKey(client, input.companyId, GL_KEYS.SALES_RETURNS);
  const entryNo = await generateSequentialDocumentNo(client, input.companyId, 'ACCOUNT_STATEMENT');

  const ins = await client.query(
    `INSERT INTO journal_entries (company_id, entry_no, entry_date, description, source_type, source_id, status, created_by_user_id)
     VALUES ($1,$2,$3::date,$4,'OPENING',$5::uuid,'POSTED',$6)
     RETURNING id`,
    [input.companyId, entryNo, input.entryDate.slice(0, 10), input.description, sourceId, input.userId],
  );
  const entryId = ins.rows[0].id;
  await client.query(
    `INSERT INTO journal_lines (company_id, entry_id, line_no, gl_account_id, description, debit, credit, currency_code)
     VALUES ($1,$2,1,$3,$4,$5,0,'USD')`,
    [input.companyId, entryId, salesReturnId, input.description, amount],
  );
  await client.query(
    `INSERT INTO journal_lines (company_id, entry_id, line_no, gl_account_id, party_type, party_id, description, debit, credit, currency_code)
     VALUES ($1,$2,2,$3,'CUSTOMER',$4,$5,0,$6,'USD')`,
    [input.companyId, entryId, arId, input.customerId, input.description, amount],
  );
  return true;
}

async function assertTelegramChatAvailable(companyId: string, chatId: string, targetId?: string) {
  const value = chatId.trim();
  if (!value) return;
  const duplicate = await getPool().query<{ target_name: string }>(
    `SELECT target_name FROM telegram_chat_links
     WHERE company_id=$1 AND chat_id=$2 AND is_active=true
       AND ($3::uuid IS NULL OR target_id IS DISTINCT FROM $3::uuid)
     LIMIT 1`,
    [companyId, value, targetId ?? null],
  );
  if (duplicate.rows.length) {
    throw Object.assign(new Error(`هذا Chat ID مرتبط مسبقاً بـ ${duplicate.rows[0].target_name}.`), { code: 'TELEGRAM_DUPLICATE' });
  }
}

export const customerRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const q = req.query as Record<string, string>;
    const search = q.search?.trim() || '';
    const status = q.status;
    const page = Math.max(1, parseInt(q.page) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(q.pageSize) || 20));
    const offset = (page - 1) * pageSize;

    const conditions: string[] = ['company_id = $1'];
    const params: unknown[] = [companyId];
    let p = 2;

    if (search) {
      conditions.push(`(name ILIKE $${p} OR code ILIKE $${p} OR phone ILIKE $${p})`);
      params.push(`%${search}%`);
      p++;
    }
    if (status === 'active') conditions.push('is_active = true');
    else if (status === 'inactive') conditions.push('is_active = false');

    const where = conditions.join(' AND ');
    const pool = getPool();
    const [rows, countRow] = await Promise.all([
      pool.query(
        `SELECT id,code,name,phone,email,address,notes,telegram_chat_id,telegram_enabled,telegram_label,is_active,created_at,updated_at
         FROM customers WHERE ${where} ORDER BY name ASC LIMIT $${p} OFFSET $${p + 1}`,
        [...params, pageSize, offset],
      ),
      pool.query(`SELECT COUNT(*)::int AS total FROM customers WHERE ${where}`, params),
    ]);

    return reply.send({ ok: true, data: rows.rows, total: countRow.rows[0].total, page, pageSize });
  });

  app.get('/:id/statement', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const q = req.query as Record<string, string>;
    try {
      const data = await getCustomerStatement(companyId, id, {
        fromDate: q.fromDate?.trim() || undefined,
        toDate: q.toDate?.trim() || undefined,
        currency: q.currency?.trim() || undefined,
      });
      return reply.send({ ok: true, data });
    } catch (e) {
      if ((e as { code?: string }).code === 'NOT_FOUND') {
        return sendError(reply, 404, e instanceof Error ? e.message : 'العميل غير موجود', 'NOT_FOUND');
      }
      throw e;
    }
  });

  app.get('/:id', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const pool = getPool();
    const row = await pool.query(
      `SELECT id,code,name,phone,email,address,notes,telegram_chat_id,telegram_enabled,telegram_label,is_active,created_at,updated_at
       FROM customers WHERE id=$1 AND company_id=$2`,
      [id, companyId],
    );
    if (!row.rows.length) return sendError(reply, 404, 'العميل غير موجود', 'NOT_FOUND');
    return reply.send({ ok: true, data: row.rows[0] });
  });

  app.post('/', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const parsed = customerBody.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    const d = parsed.data;
    const code = d.code?.trim() || genCode();
    const pool = getPool();
    try {
      await assertTelegramChatAvailable(companyId, d.telegramChatId);
      const row = await pool.query(
        `INSERT INTO customers(company_id,code,name,phone,email,address,notes,telegram_chat_id,telegram_enabled,telegram_label)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING id,code,name,phone,email,address,notes,telegram_chat_id,telegram_enabled,telegram_label,is_active,created_at`,
        [companyId, code, d.name, d.phone, d.email || null, d.address, d.notes, d.telegramChatId || null, d.telegramEnabled, d.telegramLabel || null],
      );
      try {
        await insertPartyActivityLog(pool, {
          companyId,
          partyType: 'CUSTOMER',
          partyId: row.rows[0].id,
          partyName: row.rows[0].name,
          activityType: 'CREATED',
          description: 'إنشاء عميل جديد',
          userId: req.user!.sub,
        });
      } catch {
        /* لا نمنع إنشاء العميل إذا فشل السجل */
      }
      return reply.status(201).send({ ok: true, data: row.rows[0] });
    } catch (e: unknown) {
      if ((e as { code?: string }).code === '23505')
        return sendError(reply, 409, 'كود العميل مستخدم مسبقاً', 'DUPLICATE');
      if ((e as { code?: string }).code === 'TELEGRAM_DUPLICATE')
        return sendError(reply, 409, e instanceof Error ? e.message : 'Chat ID مستخدم مسبقاً', 'TELEGRAM_DUPLICATE_CHAT');
      throw e;
    }
  });

  app.post('/import-statement', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const parsed = importStatementBody.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    const d = parsed.data;
    const currencyCode = String(d.currencyCode || 'USD').trim().toUpperCase();
    if (currencyCode !== 'USD') {
      return sendError(reply, 400, 'استيراد كشوف العملاء القديمة مدعوم حالياً بالدولار فقط.', 'VALIDATION');
    }
    const dateErrors = validateImportedStatementDates(d);
    if (dateErrors.length > 0) {
      return sendError(reply, 400, `لا يمكن استيراد الكشف قبل تصحيح التواريخ: ${dateErrors.slice(0, 5).join(' ')}`, 'VALIDATION');
    }
    if (d.payments.length > 0 && !d.cashboxId) {
      return sendError(reply, 400, 'يجب اختيار صندوق لتأكيد سندات القبض المستوردة.', 'VALIDATION');
    }

    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const customer = await resolveImportedCustomer(client, companyId, d.customerName);
      const fileKey = safeDocumentPart(d.fileName);
      const customerKey = safeDocumentPart(customer.name);
      const dateKey = d.orderDate.slice(0, 10).replace(/-/g, '');
      const smartInvoiceNo = `STMT-${dateKey}-${customerKey}`;
      const legacyInvoiceNo = `OLD-${customer.name.replace(/\s+/g, '-')}-${d.orderDate.slice(0, 10)}`;
      const referenceNo = `STMT:${fileKey}:${customer.id}:${dateKey}`;

      let createdInvoice = false;
      const existingInvoice = await existingSalesInvoiceId(client, companyId, [smartInvoiceNo, legacyInvoiceNo], d.fileName);
      if (existingInvoice && d.saleLines.length) {
        await syncImportedInvoiceLineMetadata(client, {
          companyId,
          invoiceId: existingInvoice.id,
          fileName: d.fileName,
          saleLines: d.saleLines,
        });
      }
      if (!existingInvoice && d.computedSalesTotal > 0) {
        const lines = d.saleLines.length
          ? d.saleLines
          : [
              {
                date: d.orderDate,
                originalDateValue: d.orderDate,
                dateParseSource: 'backend_fallback_order_date',
                materialName: 'رصيد مبيعات مستورد من كشف حساب',
                quantity: 1,
                rolls: 0,
                city: '',
                unitPrice: d.computedSalesTotal,
                total: d.computedSalesTotal,
                note: d.fileName,
              },
            ];
        await createSalesInvoice(client, companyId, userId, {
          invoiceNo: smartInvoiceNo,
          invoiceDate: d.orderDate,
          customerId: customer.id,
          warehouseId: null,
          warehouseLabel: 'استيراد مالي من كشف حساب عميل',
          currencyCode,
          exchangeRateToUsd: 1,
          notes: `استيراد كشف حساب عميل: ${d.fileName}. رقم مرجعي للكشف: ${referenceNo}`,
          subtotal: d.computedSalesTotal,
          discountTotal: 0,
          taxTotal: 0,
          totalAmount: d.computedSalesTotal,
          paidAmount: 0,
          remainingAmount: d.computedSalesTotal,
          subtotalUsd: d.computedSalesTotal,
          discountTotalUsd: 0,
          taxTotalUsd: 0,
          totalAmountUsd: d.computedSalesTotal,
          paidAmountUsd: 0,
          remainingAmountUsd: d.computedSalesTotal,
          paymentStatus: 'unpaid',
          confirm: true,
          cashboxId: null,
          partyNameForVoucher: customer.name,
          lines: lines.map((line, index) => ({
            fabricRollId: null,
            fabricItemId: null,
            variantId: null,
            warehouseId: null,
            description: [line.materialName || 'بند مالي مستورد', line.city, line.note].filter(Boolean).join(' - '),
            quantity: line.quantity > 0 ? line.quantity : 1,
            unit: 'meter',
            unitPrice: line.unitPrice > 0 ? line.unitPrice : line.total,
            lineDiscount: 0,
            lineTax: 0,
            lineTotal: line.total,
            metadata: {
              statementImport: true,
              fileName: d.fileName,
              rowDate: line.date,
              originalDateValue: line.originalDateValue || null,
              dateParseSource: line.dateParseSource || null,
              materialName: line.materialName,
              city: line.city,
              unitPrice: line.unitPrice,
              rolls: line.rolls,
              sourceLine: index + 1,
              note: line.note,
            },
          })),
        });
        createdInvoice = true;
      }

      let createdReceipts = 0;
      for (let i = 0; i < d.payments.length; i++) {
        const payment = d.payments[i];
        const amount = round2(payment.amount);
        const paymentNotes = [
          payment.rawLabel,
          payment.originalDateValue ? `originalDate=${payment.originalDateValue}` : '',
          payment.dateParseSource ? `dateSource=${payment.dateParseSource}` : '',
          `normalizedDate=${payment.date}`,
        ].filter(Boolean).join(' | ');
        const exists = await voucherAlreadyImported(client, {
          companyId,
          customerId: customer.id,
          voucherDate: payment.date,
          amount,
          referenceNo,
          legacyReferenceNo: d.fileName,
        });
        if (exists) continue;
        const voucher = await insertDraftVoucher(client, {
          companyId,
          userId,
          voucherType: 'RECEIPT',
          voucherDate: payment.date,
          cashboxId: d.cashboxId!,
          partyType: 'CUSTOMER',
          partyId: customer.id,
          partyName: customer.name,
          amount,
          currencyCode,
          exchangeRateToUsd: 1,
          amountUsd: amount,
          description: `قبض مستورد من كشف حساب ${d.fileName}`,
          notes: paymentNotes || null,
          referenceDocumentType: 'CUSTOMER_STATEMENT_IMPORT',
          referenceDocumentNo: referenceNo,
        });
        await applyVoucherConfirmation(client, {
          companyId,
          voucherId: voucher.id,
          voucherNo: voucher.voucherNo,
          voucherDate: payment.date,
          voucherType: 'RECEIPT',
          amount,
          currencyCode,
          exchangeRateToUsd: 1,
          amountUsd: amount,
          cashboxId: d.cashboxId!,
          partyType: 'CUSTOMER',
          partyId: customer.id,
          partyName: customer.name,
          description: `قبض مستورد من كشف حساب ${d.fileName}`,
          userId,
        });
        await client.query(
          `UPDATE vouchers SET status='CONFIRMED', confirmed_at=now(), updated_at=now() WHERE id=$1 AND company_id=$2`,
          [voucher.id, companyId],
        );
        createdReceipts++;
      }

      let createdCredits = 0;
      for (let i = 0; i < d.returnPayments.length; i++) {
        const returned = d.returnPayments[i];
        const returnedDateNote = [
          returned.rawLabel || returned.date,
          returned.originalDateValue ? `originalDate=${returned.originalDateValue}` : '',
          returned.dateParseSource ? `dateSource=${returned.dateParseSource}` : '',
          `normalizedDate=${returned.date}`,
        ].filter(Boolean).join(' | ');
        const didCreate = await insertCustomerCreditJournal(client, {
          companyId,
          userId,
          customerId: customer.id,
          entryDate: returned.date,
          amount: returned.amount,
          sourceSeed: `${referenceNo}:RETURN:${i}:${returned.date}:${returned.amount}`,
          description: `مرتجع/حسم مستورد من كشف حساب ${d.fileName} - ${returnedDateNote}`,
        });
        if (didCreate) createdCredits++;
      }

      const adjustmentAmount = round2(Math.abs(d.balanceDifference));
      let createdAdjustment = false;
      if (d.sheetBalance != null && adjustmentAmount > 0.05) {
        const needsCredit = d.balanceDifference < 0;
        if (needsCredit) {
          createdAdjustment = await insertCustomerCreditJournal(client, {
            companyId,
            userId,
            customerId: customer.id,
            entryDate: d.orderDate,
            amount: adjustmentAmount,
            sourceSeed: `${referenceNo}:BALANCE-CREDIT:${adjustmentAmount}`,
            description: `تسوية فرق رصيد كشف ${d.fileName} للوصول إلى ${round2(d.sheetBalance)}`,
          });
        } else {
          const adjInvoiceNo = `${smartInvoiceNo}-ADJ`;
          const existingAdj = await existingSalesInvoiceId(client, companyId, [adjInvoiceNo], `${referenceNo}:BALANCE-DEBIT`);
          if (!existingAdj) {
            await createSalesInvoice(client, companyId, userId, {
              invoiceNo: adjInvoiceNo,
              invoiceDate: d.orderDate,
              customerId: customer.id,
              warehouseId: null,
              warehouseLabel: 'تسوية مالية من كشف حساب عميل',
              currencyCode,
              exchangeRateToUsd: 1,
              notes: `تسوية مدينة من استيراد كشف حساب ${d.fileName}. ${referenceNo}:BALANCE-DEBIT`,
              subtotal: adjustmentAmount,
              discountTotal: 0,
              taxTotal: 0,
              totalAmount: adjustmentAmount,
              paidAmount: 0,
              remainingAmount: adjustmentAmount,
              subtotalUsd: adjustmentAmount,
              discountTotalUsd: 0,
              taxTotalUsd: 0,
              totalAmountUsd: adjustmentAmount,
              paidAmountUsd: 0,
              remainingAmountUsd: adjustmentAmount,
              paymentStatus: 'unpaid',
              confirm: true,
              cashboxId: null,
              partyNameForVoucher: customer.name,
              lines: [
                {
                  fabricRollId: null,
                  description: 'تسوية فرق رصيد كشف حساب مستورد',
                  quantity: 1,
                  unit: 'meter',
                  unitPrice: adjustmentAmount,
                  lineDiscount: 0,
                  lineTax: 0,
                  lineTotal: adjustmentAmount,
                },
              ],
            });
            createdAdjustment = true;
          }
        }
      }

      await insertPartyActivityLog(client, {
        companyId,
        partyType: 'CUSTOMER',
        partyId: customer.id,
        partyName: customer.name,
        activityType: 'UPDATED',
        description: `استيراد كشف حساب عميل من Excel: ${d.fileName}`,
        userId,
        referenceType: 'CUSTOMER_STATEMENT_IMPORT',
        referenceNo,
        amount: d.sheetBalance ?? d.computedBalance,
        currencyCode,
      });

      await client.query('COMMIT');
      return reply.status(201).send({
        ok: true,
        data: {
          customer,
          invoiceNo: existingInvoice?.invoice_no ?? smartInvoiceNo,
          createdInvoice,
          createdReceipts,
          createdCredits,
          createdAdjustment,
          referenceNo,
        },
      });
    } catch (error) {
      await client.query('ROLLBACK');
      const err = error as { code?: string; message?: string };
      if (err?.code === 'VALIDATION') return sendError(reply, 400, err.message || ArabicErrors.validation, 'VALIDATION');
      if (err?.code === 'DUPLICATE' || err?.code === '23505') return sendError(reply, 409, err.message || 'بيانات مكررة', 'CONFLICT');
      if (err?.code === 'NOT_FOUND') return sendError(reply, 404, err.message || 'غير موجود', 'NOT_FOUND');
      if (err?.code === 'GL_UNBALANCED' || err?.code === 'GL_CONFIG') return sendError(reply, 400, err.message || 'خلل في القيد المحاسبي', 'VALIDATION');
      throw error;
    } finally {
      client.release();
    }
  });

  app.put('/:id', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const parsed = customerBody.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    const d = parsed.data;
    const pool = getPool();
    try {
      await assertTelegramChatAvailable(companyId, d.telegramChatId, id);
      const row = await pool.query(
        `UPDATE customers SET name=$3,phone=$4,email=$5,address=$6,notes=$7,
           telegram_chat_id=$8,telegram_enabled=$9,telegram_label=$10,updated_at=now()
         WHERE id=$1 AND company_id=$2
         RETURNING id,code,name,phone,email,address,notes,telegram_chat_id,telegram_enabled,telegram_label,is_active,updated_at`,
        [id, companyId, d.name, d.phone, d.email || null, d.address, d.notes, d.telegramChatId || null, d.telegramEnabled, d.telegramLabel || null],
      );
      if (!row.rows.length) return sendError(reply, 404, 'العميل غير موجود', 'NOT_FOUND');
      try {
        await insertPartyActivityLog(pool, {
          companyId,
          partyType: 'CUSTOMER',
          partyId: id,
          partyName: row.rows[0].name,
          activityType: 'UPDATED',
          description: 'تحديث بيانات العميل',
          userId: req.user!.sub,
        });
      } catch {
        /* ignore log failure */
      }
      return reply.send({ ok: true, data: row.rows[0] });
    } catch (e: unknown) {
      if ((e as { code?: string }).code === '23505')
        return sendError(reply, 409, 'كود العميل مستخدم مسبقاً', 'DUPLICATE');
      if ((e as { code?: string }).code === 'TELEGRAM_DUPLICATE')
        return sendError(reply, 409, e instanceof Error ? e.message : 'Chat ID مستخدم مسبقاً', 'TELEGRAM_DUPLICATE_CHAT');
      throw e;
    }
  });

  app.patch('/:id/toggle-status', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { id } = req.params as { id: string };
    const pool = getPool();
    const row = await pool.query(
      `UPDATE customers SET is_active = NOT is_active, updated_at=now()
       WHERE id=$1 AND company_id=$2 RETURNING id,is_active`,
      [id, companyId],
    );
    if (!row.rows.length) return sendError(reply, 404, 'العميل غير موجود', 'NOT_FOUND');
    return reply.send({ ok: true, data: row.rows[0] });
  });
};
