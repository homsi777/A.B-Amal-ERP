import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { authenticateRequest } from '../middleware/auth.js';
import { ArabicErrors } from '../utils/arabicErrors.js';
import { sendError } from '../middleware/errorHandler.js';
import {
  TelegramDuplicateError,
  fetchUpdates,
  getBotSettingsMasked,
  getDetectedChats,
  linkChatToTarget,
  listChatLinks,
  saveBotToken,
  sendTelegramDocumentMessage,
  sendTestMessageToChat,
  testBotToken,
  unlinkChat,
  updateChatLink,
} from '../services/telegramService.js';

function requirePermission(user: { role: string; permissions: string[] } | undefined, code: string) {
  if (!user) return false;
  return user.role === 'admin' || user.permissions.includes(code);
}

const settingsBody = z.object({
  botToken: z.string().trim().optional().default(''),
  isEnabled: z.boolean().default(false),
});

const linkBody = z.object({
  chatId: z.string().trim().min(1),
  telegramUserId: z.string().trim().optional().default(''),
  telegramUsername: z.string().trim().optional().default(''),
  telegramFirstName: z.string().trim().optional().default(''),
  telegramLastName: z.string().trim().optional().default(''),
  telegramDisplayName: z.string().trim().optional().default(''),
  chatType: z.string().trim().optional().default(''),
  targetType: z.enum(['USER', 'CUSTOMER', 'SUPPLIER', 'EMPLOYEE', 'OTHER']),
  targetId: z.string().uuid().nullable().optional(),
  targetName: z.string().trim().min(1),
  canReceiveInvoices: z.boolean().default(true),
  canReceiveVouchers: z.boolean().default(true),
  canReceiveReports: z.boolean().default(false),
  canReceiveAlerts: z.boolean().default(true),
  notes: z.string().trim().optional().default(''),
});

const documentBody = z.object({
  documentType: z.enum(['INVOICE', 'STATEMENT', 'VOUCHER', 'TEST']),
  partyType: z.enum(['customer', 'supplier', 'user', 'employee', 'other', 'system']).optional(),
  partyId: z.string().uuid().nullable().optional(),
  targetType: z.enum(['USER', 'CUSTOMER', 'SUPPLIER', 'EMPLOYEE', 'OTHER']).optional(),
  targetId: z.string().uuid().nullable().optional(),
  chatId: z.string().trim().optional().default(''),
  message: z.string().trim().min(1),
  pdfHtml: z.string().optional().default(''),
  fileName: z.string().trim().optional().default('document.pdf'),
  caption: z.string().trim().optional().default('PDF'),
  eventType: z.string().trim().optional().default('DOCUMENT_SEND'),
});

export const telegramRoutes: FastifyPluginAsync = async (app) => {
  app.get('/settings', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    if (!requirePermission(req.user, 'settings.view')) return sendError(reply, 403, ArabicErrors.forbidden, 'FORBIDDEN');
    return reply.send({ ok: true, data: await getBotSettingsMasked(companyId) });
  });

  app.put('/settings', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    if (!requirePermission(req.user, 'settings.manage')) return sendError(reply, 403, ArabicErrors.forbidden, 'FORBIDDEN');
    const parsed = settingsBody.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    try {
      return reply.send({ ok: true, data: await saveBotToken(companyId, parsed.data.botToken, parsed.data.isEnabled, userId) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return sendError(reply, 400, message, 'TELEGRAM_SETTINGS_FAILED');
    }
  });

  app.post('/test-bot', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    if (!requirePermission(req.user, 'settings.manage')) return sendError(reply, 403, ArabicErrors.forbidden, 'FORBIDDEN');
    try {
      return reply.send({ ok: true, data: await testBotToken(companyId) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return sendError(reply, 502, `فشل اختبار تيليغرام: ${message}`, 'TELEGRAM_FAILED');
    }
  });

  app.post('/fetch-updates', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    if (!requirePermission(req.user, 'settings.manage')) return sendError(reply, 403, ArabicErrors.forbidden, 'FORBIDDEN');
    try {
      return reply.send({ ok: true, data: await fetchUpdates(companyId) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return sendError(reply, 502, `فشل جلب محادثات تيليغرام: ${message}`, 'TELEGRAM_FAILED');
    }
  });

  app.get('/detected-chats', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    if (!requirePermission(req.user, 'settings.view')) return sendError(reply, 403, ArabicErrors.forbidden, 'FORBIDDEN');
    return reply.send({ ok: true, data: await getDetectedChats(companyId) });
  });

  app.get('/chat-links', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    if (!requirePermission(req.user, 'settings.view')) return sendError(reply, 403, ArabicErrors.forbidden, 'FORBIDDEN');
    const q = req.query as Record<string, string>;
    return reply.send({
      ok: true,
      ...(await listChatLinks(companyId, {
        search: q.search,
        targetType: q.targetType,
        active: q.active,
        page: q.page ? Number(q.page) : undefined,
        pageSize: q.pageSize ? Number(q.pageSize) : undefined,
      })),
    });
  });

  app.post('/chat-links', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    if (!requirePermission(req.user, 'settings.manage')) return sendError(reply, 403, ArabicErrors.forbidden, 'FORBIDDEN');
    const parsed = linkBody.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    try {
      const data = await linkChatToTarget(companyId, parsed.data, userId);
      return reply.status(201).send({ ok: true, data });
    } catch (error) {
      if (error instanceof TelegramDuplicateError) {
        return sendError(reply, 409, error.message, 'TELEGRAM_DUPLICATE_CHAT');
      }
      const message = error instanceof Error ? error.message : String(error);
      return sendError(reply, 400, message, 'TELEGRAM_LINK_FAILED');
    }
  });

  app.put('/chat-links/:id', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    if (!requirePermission(req.user, 'settings.manage')) return sendError(reply, 403, ArabicErrors.forbidden, 'FORBIDDEN');
    const { id } = req.params as { id: string };
    const parsed = linkBody.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    return reply.send({ ok: true, data: await updateChatLink(companyId, id, parsed.data) });
  });

  app.patch('/chat-links/:id/toggle-status', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    if (!requirePermission(req.user, 'settings.manage')) return sendError(reply, 403, ArabicErrors.forbidden, 'FORBIDDEN');
    const { id } = req.params as { id: string };
    const body = z.object({ isActive: z.boolean().optional() }).safeParse(req.body ?? {});
    const active = body.success && typeof body.data.isActive === 'boolean' ? body.data.isActive : false;
    return reply.send({ ok: true, data: await unlinkChat(companyId, id, active) });
  });

  app.delete('/chat-links/:id', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    if (!requirePermission(req.user, 'settings.manage')) return sendError(reply, 403, ArabicErrors.forbidden, 'FORBIDDEN');
    const { id } = req.params as { id: string };
    return reply.send({ ok: true, data: await unlinkChat(companyId, id, false) });
  });

  app.post('/chat-links/:id/test-message', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    if (!requirePermission(req.user, 'settings.manage')) return sendError(reply, 403, ArabicErrors.forbidden, 'FORBIDDEN');
    const { id } = req.params as { id: string };
    try {
      return reply.send({ ok: true, data: await sendTestMessageToChat(companyId, id, userId) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return sendError(reply, 502, `فشل إرسال رسالة الاختبار: ${message}`, 'TELEGRAM_SEND_FAILED');
    }
  });

  const sendDocument = async (req: FastifyRequest, reply: FastifyReply, documentType: 'INVOICE' | 'STATEMENT' | 'VOUCHER') => {
    const { companyId, sub: userId } = req.user!;
    const parsed = documentBody.safeParse({ ...(req.body as Record<string, unknown>), documentType });
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    try {
      return reply.send({ ok: true, data: await sendTelegramDocumentMessage(companyId, parsed.data, userId) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return sendError(reply, 502, `فشل إرسال تيليغرام: ${message}`, 'TELEGRAM_SEND_FAILED');
    }
  };

  app.post('/invoice', { preHandler: authenticateRequest }, async (req, reply) => {
    return sendDocument(req, reply, 'INVOICE');
  });

  app.post('/statement', { preHandler: authenticateRequest }, async (req, reply) => {
    return sendDocument(req, reply, 'STATEMENT');
  });

  app.post('/voucher', { preHandler: authenticateRequest }, async (req, reply) => {
    return sendDocument(req, reply, 'VOUCHER');
  });
};
