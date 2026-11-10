import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { authenticateRequest } from '../middleware/auth.js';
import { sendError } from '../middleware/errorHandler.js';
import { ArabicErrors } from '../utils/arabicErrors.js';
import { importLegacyStatementAsRealRecords } from '../services/customerLegacyImportService.js';

const rowSchema = z.object({
  rowIndex: z.number().int().nonnegative(),
  headerRowIndex: z.number().int().nonnegative(),
  documentType: z.string().optional().nullable(),
  documentNo: z.string().optional().nullable(),
  documentDate: z.string().optional().nullable(),
  documentRef: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  unitPrice: z.coerce.number().optional().nullable(),
  quantity: z.coerce.number().optional().nullable(),
  bonus: z.coerce.number().optional().nullable(),
  pieceCount: z.coerce.number().optional().nullable(),
  lineTotal: z.coerce.number().optional().nullable(),
  unit: z.string().optional().nullable(),
  warehouseName: z.string().optional().nullable(),
  rollLotNo: z.string().optional().nullable(),
  itemCode: z.string().optional().nullable(),
  netAmount: z.coerce.number().optional().nullable(),
  priceWithTax: z.coerce.number().optional().nullable(),
  debit: z.coerce.number().optional().nullable(),
  credit: z.coerce.number().optional().nullable(),
  netDebit: z.coerce.number().optional().nullable(),
  netCredit: z.coerce.number().optional().nullable(),
  currencyCode: z.string().optional().nullable(),
  raw: z.unknown().default(null),
});

const importBody = z.object({
  fileName: z.string().min(1, 'اسم الملف مطلوب'),
  currencyCode: z.string().min(1, 'العملة مطلوبة'),
  exchangeRateToUsd: z.coerce.number().positive('سعر الصرف يجب أن يكون أكبر من صفر'),
  openingBalanceDebit: z.coerce.number().optional(),
  openingBalanceCredit: z.coerce.number().optional(),
  rows: z.array(rowSchema).min(1, 'لا توجد صفوف للاستيراد'),
});

export const customerLegacyImportRoutes: FastifyPluginAsync = async (app) => {
  app.post('/:customerId/legacy-statement-import', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const { customerId } = req.params as { customerId: string };
    const parsed = importBody.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, parsed.error.issues[0]?.message || ArabicErrors.validation, 'VALIDATION');
    const d = parsed.data;

    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await importLegacyStatementAsRealRecords(client, {
        companyId,
        userId,
        customerId,
        fileName: d.fileName,
        currencyCode: d.currencyCode,
        exchangeRateToUsd: d.exchangeRateToUsd,
        rows: d.rows,
        openingBalanceDebit: d.openingBalanceDebit,
        openingBalanceCredit: d.openingBalanceCredit,
      });
      await client.query('COMMIT');
      return reply.status(201).send({ ok: true, data: result });
    } catch (error) {
      await client.query('ROLLBACK');
      const err = error as { code?: string; message?: string };
      if (err?.code === 'VALIDATION') return sendError(reply, 400, err.message || ArabicErrors.validation, 'VALIDATION');
      if (err?.code === 'NOT_FOUND') return sendError(reply, 404, err.message || 'غير موجود', 'NOT_FOUND');
      if (err?.code === 'DUPLICATE') return sendError(reply, 409, err.message || 'مكرر', 'DUPLICATE');
      return sendError(reply, 500, ArabicErrors.server, 'SERVER');
    } finally {
      client.release();
    }
  });
};
