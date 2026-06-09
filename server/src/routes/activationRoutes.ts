import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  activateProject,
  ActivationError,
  generateActivationKeys,
  getActivationStatus,
  listActivationDevices,
  listActivationEvents,
  listActivationKeysForAdmin,
  revokeActivationKey,
  type ActivationPlanCode,
} from '../services/activationService.js';
import { authenticateRequest, verifyAuthToken, type JwtPayload } from '../middleware/auth.js';
import { sendError } from '../middleware/errorHandler.js';
import { ArabicErrors } from '../utils/arabicErrors.js';

const activateBody = z.object({
  key: z.string().min(1),
  deviceFingerprint: z.string().trim().optional(),
  deviceName: z.string().trim().optional(),
  osInfo: z.string().trim().optional(),
  appVersion: z.string().trim().optional(),
});

const generateBody = z.object({
  count: z.coerce.number().int().min(1).max(100).default(20),
  planCode: z.enum(['LITE', 'PRO', 'FULL']).default('FULL'),
  expiresAt: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

const listQuery = z.object({
  status: z.string().optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

const attemptWindowMs = 10 * 60 * 1000;
const maxAttemptsPerWindow = 20;
const activationAttempts = new Map<string, { count: number; resetAt: number }>();

function requireAdmin(user: JwtPayload | undefined): boolean {
  return Boolean(user && (user.role === 'admin' || user.permissions.includes('settings.manage')));
}

function requestIp(req: FastifyRequest): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim();
  return req.ip || 'unknown';
}

function checkRateLimit(req: FastifyRequest, reply: FastifyReply): boolean {
  const ip = requestIp(req);
  const now = Date.now();
  const current = activationAttempts.get(ip);
  if (!current || current.resetAt <= now) {
    activationAttempts.set(ip, { count: 1, resetAt: now + attemptWindowMs });
    return true;
  }
  current.count += 1;
  if (current.count > maxAttemptsPerWindow) {
    sendError(reply, 429, 'محاولات التفعيل كثيرة حالياً. حاول لاحقاً.', 'RATE_LIMITED');
    return false;
  }
  return true;
}

async function optionalUser(req: FastifyRequest): Promise<JwtPayload | undefined> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return undefined;
  const token = header.slice('Bearer '.length).trim();
  if (!token) return undefined;
  try {
    return verifyAuthToken(token);
  } catch {
    return undefined;
  }
}

function handleActivationError(reply: FastifyReply, error: unknown) {
  if (error instanceof ActivationError) {
    return sendError(reply, error.statusCode, error.message, error.code);
  }
  throw error;
}

export const activationRoutes: FastifyPluginAsync = async (app) => {
  app.get('/status', async (req, reply) => {
    const user = await optionalUser(req);
    try {
      const status = await getActivationStatus(user?.companyId);
      return reply.send({ ok: true, data: status });
    } catch (error) {
      return handleActivationError(reply, error);
    }
  });

  app.post('/activate', async (req, reply) => {
    if (!checkRateLimit(req, reply)) return reply;

    const parsed = activateBody.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');

    const user = await optionalUser(req);
    try {
      const status = await activateProject(
        parsed.data.key,
        { companyId: user?.companyId, userId: user?.sub },
        {
          ipAddress: requestIp(req),
          userAgent: String(req.headers['user-agent'] || ''),
          deviceFingerprint: parsed.data.deviceFingerprint,
          deviceName: parsed.data.deviceName,
          osInfo: parsed.data.osInfo,
          appVersion: parsed.data.appVersion,
        },
      );
      return reply.send({ ok: true, data: status, message: 'تم تفعيل النظام بنجاح.' });
    } catch (error) {
      return handleActivationError(reply, error);
    }
  });

  app.get('/keys', { preHandler: authenticateRequest }, async (req, reply) => {
    if (!requireAdmin(req.user)) return sendError(reply, 403, ArabicErrors.forbidden, 'FORBIDDEN');
    const query = listQuery.safeParse(req.query);
    if (!query.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    const keys = await listActivationKeysForAdmin(query.data);
    return reply.send({ ok: true, data: keys });
  });

  app.post('/keys/generate', { preHandler: authenticateRequest }, async (req, reply) => {
    if (!requireAdmin(req.user)) return sendError(reply, 403, ArabicErrors.forbidden, 'FORBIDDEN');
    const parsed = generateBody.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');

    try {
      const keys = await generateActivationKeys(
        parsed.data.count,
        parsed.data.planCode as ActivationPlanCode,
        req.user?.sub,
        { expiresAt: parsed.data.expiresAt || null, notes: parsed.data.notes || null },
      );
      return reply.status(201).send({
        ok: true,
        data: {
          keys,
          warning: 'انسخ المفاتيح الآن. لن تظهر مرة أخرى.',
        },
      });
    } catch (error) {
      return handleActivationError(reply, error);
    }
  });

  app.patch('/keys/:id/revoke', { preHandler: authenticateRequest }, async (req, reply) => {
    if (!requireAdmin(req.user)) return sendError(reply, 403, ArabicErrors.forbidden, 'FORBIDDEN');
    const { id } = req.params as { id: string };
    try {
      const result = await revokeActivationKey(id, req.user?.sub);
      return reply.send({ ok: true, data: result });
    } catch (error) {
      return handleActivationError(reply, error);
    }
  });

  app.get('/events', { preHandler: authenticateRequest }, async (req, reply) => {
    if (!requireAdmin(req.user)) return sendError(reply, 403, ArabicErrors.forbidden, 'FORBIDDEN');
    const query = listQuery.safeParse(req.query);
    if (!query.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    const events = await listActivationEvents(query.data);
    return reply.send({ ok: true, data: events });
  });

  app.get('/devices', { preHandler: authenticateRequest }, async (req, reply) => {
    if (!requireAdmin(req.user)) return sendError(reply, 403, ArabicErrors.forbidden, 'FORBIDDEN');
    const devices = await listActivationDevices();
    return reply.send({ ok: true, data: devices });
  });
};
