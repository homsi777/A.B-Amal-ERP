import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { authenticateRequest } from '../middleware/auth.js';
import { sendError } from '../middleware/errorHandler.js';
import { ArabicErrors } from '../utils/arabicErrors.js';
import {
  importLegacyStatementBatch,
  listLegacyStatementBatches,
  getLegacyStatementBatchEntries,
  deleteLegacyStatementBatch,
} from '../services/customerLegacyStatementService.js';

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
  sheetName: z.string().optional().nullable(),
  openingBalanceDebit: z.coerce.number().optional(),
  openingBalanceCredit: z.coerce.number().optional(),
  closingBalanceDebit: z.coerce.number().optional(),
  closingBalanceCredit: z.coerce.number().optional(),
  totalDebit: z.coerce.number().optional(),
  totalCredit: z.coerce.number().optional(),
  rows: z.array(rowSchema).min(1, 'لا توجد صفوف للاستيراد'),
});

export const customerLegacyStatementRoutes: FastifyPluginAsync = async (app) => {
  app.post('/:customerId/legacy-statement-batches', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const { customerId } = req.params as { customerId: string };
    const parsed = importBody.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, parsed.error.issues[0]?.message || ArabicErrors.validation, 'VALIDATION');
    const d = parsed.data;

    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const batch = await importLegacyStatementBatch(client, {
        companyId,
        customerId,
        userId,
        fileName: d.fileName,
        sheetName: d.sheetName,
        openingBalanceDebit: d.openingBalanceDebit,
        openingBalanceCredit: d.openingBalanceCredit,
        closingBalanceDebit: d.closingBalanceDebit,
        closingBalanceCredit: d.closingBalanceCredit,
        totalDebit: d.totalDebit,
        totalCredit: d.totalCredit,
        rows: d.rows,
      });
      await client.query('COMMIT');
      return reply.status(201).send({ ok: true, data: batch });
    } catch (error) {
      await client.query('ROLLBACK');
      const err = error as { code?: string; message?: string };
      if (err?.code === 'VALIDATION') return sendError(reply, 400, err.message || ArabicErrors.validation, 'VALIDATION');
      if (err?.code === 'NOT_FOUND') return sendError(reply, 404, err.message || 'غير موجود', 'NOT_FOUND');
      return sendError(reply, 500, ArabicErrors.server, 'SERVER');
    } finally {
      client.release();
    }
  });

  app.get('/:customerId/legacy-statement-batches', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { customerId } = req.params as { customerId: string };
    const batches = await listLegacyStatementBatches(companyId, customerId);
    return reply.send({ ok: true, data: batches });
  });

  app.get('/legacy-statement-batches/:batchId/entries', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { batchId } = req.params as { batchId: string };
    try {
      const entries = await getLegacyStatementBatchEntries(companyId, batchId);
      return reply.send({ ok: true, data: entries });
    } catch (error) {
      const err = error as { code?: string; message?: string };
      if (err?.code === 'NOT_FOUND') return sendError(reply, 404, err.message || 'غير موجود', 'NOT_FOUND');
      return sendError(reply, 500, ArabicErrors.server, 'SERVER');
    }
  });

  app.delete('/legacy-statement-batches/:batchId', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const { batchId } = req.params as { batchId: string };
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await deleteLegacyStatementBatch(client, companyId, batchId);
      await client.query('COMMIT');
      return reply.send({ ok: true });
    } catch (error) {
      await client.query('ROLLBACK');
      const err = error as { code?: string; message?: string };
      if (err?.code === 'NOT_FOUND') return sendError(reply, 404, err.message || 'غير موجود', 'NOT_FOUND');
      return sendError(reply, 500, ArabicErrors.server, 'SERVER');
    } finally {
      client.release();
    }
  });
};
