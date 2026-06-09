import type { FastifyPluginAsync } from 'fastify';
import { authenticateRequest } from '../middleware/auth.js';
import { sendError } from '../middleware/errorHandler.js';
import { ArabicErrors } from '../utils/arabicErrors.js';
import { runFinancialAudit } from '../services/financialAuditService.js';

function requireAdmin(user: { role: string; permissions: string[] } | undefined): boolean {
  if (!user) return false;
  return user.role === 'admin' || user.permissions.includes('settings.manage');
}

export const financialAuditRoutes: FastifyPluginAsync = async (app) => {
  app.get('/full', { preHandler: authenticateRequest }, async (req, reply) => {
    if (!requireAdmin(req.user)) {
      return sendError(reply, 403, ArabicErrors.forbidden, 'FORBIDDEN');
    }
    const report = await runFinancialAudit(req.user!.companyId);
    return reply.send({ ok: true, report });
  });

  app.get('/invoice-consistency', { preHandler: authenticateRequest }, async (req, reply) => {
    if (!requireAdmin(req.user)) {
      return sendError(reply, 403, ArabicErrors.forbidden, 'FORBIDDEN');
    }
    const report = await runFinancialAudit(req.user!.companyId);
    return reply.send({
      ok: true,
      report: {
        generatedAt: report.generatedAt,
        issues: report.invoiceConsistency,
        summary: {
          total: report.invoiceConsistency.length,
          critical: report.invoiceConsistency.filter((i) => i.severity === 'critical').length,
          warning: report.invoiceConsistency.filter((i) => i.severity === 'warning').length,
        },
      },
    });
  });
};
