import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { authenticateRequest, requirePlatformAdmin } from '../middleware/auth.js';
import { sendError } from '../middleware/errorHandler.js';
import { ArabicErrors } from '../utils/arabicErrors.js';
import {
  CompanyProvisioningError,
  listCompanies,
  provisionCompany,
} from '../services/companyProvisioningService.js';

const createCompanyBody = z.object({
  code: z.string().trim().min(2),
  name: z.string().trim().min(2),
  baseCurrencyCode: z.string().trim().optional(),
  adminUsername: z.string().trim().min(2),
  adminPassword: z.string().min(6),
  adminFullName: z.string().trim().optional(),
});

export const companyRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: authenticateRequest }, async (req, reply) => {
    if (!requirePlatformAdmin(req.user)) return sendError(reply, 403, ArabicErrors.forbidden, 'FORBIDDEN');
    const companies = await listCompanies();
    return reply.send({ ok: true, data: companies });
  });

  app.post('/', { preHandler: authenticateRequest }, async (req, reply) => {
    if (!requirePlatformAdmin(req.user)) return sendError(reply, 403, ArabicErrors.forbidden, 'FORBIDDEN');
    const parsed = createCompanyBody.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');

    try {
      const company = await provisionCompany(
        {
          code: parsed.data.code,
          name: parsed.data.name,
          baseCurrencyCode: parsed.data.baseCurrencyCode,
        },
        {
          username: parsed.data.adminUsername,
          password: parsed.data.adminPassword,
          fullName: parsed.data.adminFullName,
        },
      );
      return reply.status(201).send({ ok: true, data: company });
    } catch (error) {
      if (error instanceof CompanyProvisioningError) {
        return sendError(reply, error.statusCode, error.message, error.code);
      }
      throw error;
    }
  });
};
