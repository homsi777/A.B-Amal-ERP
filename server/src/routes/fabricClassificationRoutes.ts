import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { authenticateRequest } from '../middleware/auth.js';
import { sendError } from '../middleware/errorHandler.js';
import { ArabicErrors } from '../utils/arabicErrors.js';
import { resolveFabricClassification } from '../services/fabricClassificationService.js';

const resolveBody = z.object({
  level1CategoryId: z.string().uuid('معرّف اسم الخامة غير صالح'),
  level2CategoryId: z.string().uuid('معرّف كود الخامة غير صالح'),
  level3CategoryId: z.string().uuid('معرّف لون الخامة غير صالح'),
  level4CategoryId: z.string().uuid('معرّف كود اللون غير صالح'),
  widthCm: z.number().positive().nullable().optional(),
  gsm: z.number().positive().nullable().optional(),
});

export const fabricClassificationRoutes: FastifyPluginAsync = async (app) => {
  /**
   * Ensures fabric_item + fabric_color (+ optional variant) exist for the
   * 3-level category selection. Idempotent: reuses existing master rows.
   */
  app.post('/resolve', { preHandler: authenticateRequest }, async (req, reply) => {
    const parsed = resolveBody.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    const d = parsed.data;
    try {
      const data = await resolveFabricClassification({
        companyId: req.user!.companyId,
        level1CategoryId: d.level1CategoryId,
        level2CategoryId: d.level2CategoryId,
        level3CategoryId: d.level3CategoryId,
        level4CategoryId: d.level4CategoryId,
        widthCm: d.widthCm ?? null,
        gsm: d.gsm ?? null,
      });
      return reply.send({ ok: true, data });
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message?: string };
      if (err.statusCode === 404) return sendError(reply, 404, err.message ?? 'غير موجود', 'NOT_FOUND');
      if (err.statusCode === 400) return sendError(reply, 400, err.message ?? 'VALIDATION', 'VALIDATION');
      throw e;
    }
  });
};
