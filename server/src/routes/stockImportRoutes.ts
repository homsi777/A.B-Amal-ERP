import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { authenticateRequest } from '../middleware/auth.js';
import { sendError } from '../middleware/errorHandler.js';
import {
  advanceStockImportBatch,
  getStockImportBatchStatus,
  queueStockImportBatchJob,
  startStockImportBatch,
  type StockImportSourceType,
} from '../services/stockImportJobService.js';

const stockRow = z.object({
  itemName: z.string().trim().min(1, 'اسم الصنف مطلوب').max(200),
  itemCode: z.string().trim().max(64).optional().default(''),
  barcode: z.string().trim().max(64).optional().default(''),
  colorName: z.string().trim().max(120).optional().default(''),
  colorNameTr: z.string().trim().max(120).optional().default(''),
  colorCode: z.string().trim().max(64).optional().default(''),
  unit: z.string().trim().max(32).optional().default(''),
  quantity: z.number().min(0),
  price: z.number().min(0).optional().default(0),
  costPrice: z.number().min(0).optional().default(0),
  widthCm: z.number().min(0).optional().default(0),
  gsm: z.number().min(0).optional().default(0),
  actualWeightKg: z.number().min(0).optional().default(0),
  date: z.string().trim().max(64).optional().default(''),
  purchaseInvoiceNo: z.string().trim().max(64).optional().default(''),
});

const importBody = z.object({
  warehouseId: z.string().uuid().optional(),
  supplierId: z.string().uuid().optional().nullable(),
  sourceType: z.enum(['OPENING_STOCK', 'DIRECT_STOCK_IMPORT', 'PURCHASE_INVOICE', 'STOCK_IMPORT']).optional().default('OPENING_STOCK'),
  fileName: z.string().trim().max(255).optional().default('Excel import'),
  sheetName: z.string().trim().max(255).optional().default(''),
  detectedColumns: z.array(z.record(z.string(), z.unknown())).optional().default([]),
  extractedMetadata: z.record(z.string(), z.unknown()).optional().default({}),
  sourceLabel: z.string().trim().max(120).optional().default(''),
  rows: z.array(stockRow).min(1, 'لا توجد صفوف للاستيراد').max(20_000),
});

const batchIdParams = z.object({
  batchId: z.string().uuid(),
});

export const stockImportRoutes: FastifyPluginAsync = async (app) => {
  app.post('/', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const parsed = importBody.safeParse(req.body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return sendError(reply, 400, first?.message || 'بيانات الاستيراد غير صالحة', 'VALIDATION');
    }

    try {
      const started = await startStockImportBatch({
        companyId,
        userId,
        warehouseId: parsed.data.warehouseId,
        supplierId: parsed.data.supplierId,
        sourceType: parsed.data.sourceType as StockImportSourceType,
        fileName: parsed.data.fileName,
        sheetName: parsed.data.sheetName,
        detectedColumns: parsed.data.detectedColumns,
        extractedMetadata: parsed.data.extractedMetadata,
        sourceLabel: parsed.data.sourceLabel,
        rows: parsed.data.rows,
      });

      queueStockImportBatchJob(app.log, {
        companyId,
        userId,
        warehouseId: started.warehouseId,
        warehouseName: started.warehouseName,
        supplierId: started.supplierId,
        supplierName: started.supplierName,
        sourceType: parsed.data.sourceType as StockImportSourceType,
        fileName: parsed.data.fileName,
        sheetName: parsed.data.sheetName,
        detectedColumns: parsed.data.detectedColumns,
        extractedMetadata: parsed.data.extractedMetadata,
        sourceLabel: parsed.data.sourceLabel,
        rows: parsed.data.rows,
        batchId: started.batchId,
        batchTag: started.batchTag,
      });

      return reply.send({
        ok: true,
        data: {
          batchId: started.batchId,
          batchTag: started.batchTag,
          warehouseId: started.warehouseId,
          warehouseName: started.warehouseName,
          supplierId: started.supplierId,
          supplierName: started.supplierName,
          sourceType: parsed.data.sourceType,
          totalRows: parsed.data.rows.length,
          status: 'VALIDATED',
          queued: true,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      app.log.error({ err }, 'stock-import start failed');
      return sendError(reply, 500, `فشل بدء استيراد المخزون: ${msg}`, 'INTERNAL');
    }
  });

  app.get('/:batchId/status', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const parsed = batchIdParams.safeParse(req.params);
    if (!parsed.success) {
      return sendError(reply, 400, 'معرّف دفعة الاستيراد غير صالح', 'VALIDATION');
    }

    try {
      await advanceStockImportBatch(app.log, companyId, parsed.data.batchId);
      const status = await getStockImportBatchStatus(companyId, parsed.data.batchId);
      if (!status) return sendError(reply, 404, 'دفعة الاستيراد غير موجودة', 'NOT_FOUND');
      return reply.send({ ok: true, data: status });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      app.log.error({ err }, 'stock-import status failed');
      return sendError(reply, 500, `تعذر قراءة حالة الاستيراد: ${msg}`, 'INTERNAL');
    }
  });
};
