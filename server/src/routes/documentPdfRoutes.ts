import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { authenticateRequest } from '../middleware/auth.js';
import { sendError } from '../middleware/errorHandler.js';
import { renderHtmlToPrintPdf } from '../services/htmlPrintPdfService.js';

const renderBody = z.object({
  html: z.string().min(1, 'HTML مطلوب'),
  fileName: z.string().trim().optional().default('document.pdf'),
});

export const documentPdfRoutes: FastifyPluginAsync = async (app) => {
  app.post('/render', { preHandler: authenticateRequest }, async (request, reply) => {
    const parsed = renderBody.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'بيانات غير صالحة', 'VALIDATION_ERROR');
    }

    try {
      const pdf = await renderHtmlToPrintPdf(parsed.data.html);
      const safeName = parsed.data.fileName.replace(/[\r\n"\\/]+/g, '_') || 'document.pdf';
      const downloadName = safeName.toLowerCase().endsWith('.pdf') ? safeName : `${safeName}.pdf`;

      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `attachment; filename="${encodeURIComponent(downloadName)}"`)
        .send(pdf);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'تعذر إنشاء PDF';
      return sendError(reply, 503, message, 'PDF_RENDER_FAILED');
    }
  });
};
