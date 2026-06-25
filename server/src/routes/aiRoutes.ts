import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { authenticateRequest } from '../middleware/auth.js';
import { ArabicErrors } from '../utils/arabicErrors.js';
import { sendError } from '../middleware/errorHandler.js';
import {
  getAiSettingsMasked,
  saveAiSettings,
  testOpenAiConnection,
} from '../services/ai/aiSettingsService.js';
import { isValidOpenAiKey } from '../services/ai/settingsEncryption.js';
import { runFabricChat } from '../services/ai/clotexAssistantService.js';

function requirePermission(user: { role: string; permissions: string[] } | undefined, code: string) {
  if (!user) return false;
  return user.role === 'admin' || user.permissions.includes(code);
}

const settingsBody = z.object({
  enabled: z.boolean(),
  model: z.string().trim().min(1).default('gpt-4o-mini'),
  apiKey: z.string().trim().optional(),
});

const testBody = z.object({
  apiKey: z.string().trim().optional(),
});

const chatBody = z.object({
  message: z.string().trim().min(1).max(4000),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string(),
      }),
    )
    .max(24)
    .optional()
    .default([]),
  sessionId: z.string().uuid().nullable().optional(),
});

export const aiRoutes: FastifyPluginAsync = async (app) => {
  app.get('/settings', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    return reply.send({ ok: true, data: await getAiSettingsMasked(companyId) });
  });

  app.put('/settings', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    if (!requirePermission(req.user, 'settings.manage')) {
      return sendError(reply, 403, ArabicErrors.forbidden, 'FORBIDDEN');
    }
    const parsed = settingsBody.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    const apiKey = parsed.data.apiKey?.trim();
    if (apiKey && !isValidOpenAiKey(apiKey)) {
      return sendError(reply, 400, 'مفتاح OpenAI غير صالح. يجب أن يبدأ بـ sk-.', 'INVALID_OPENAI_KEY');
    }
    try {
      const data = await saveAiSettings(companyId, userId, {
        enabled: parsed.data.enabled,
        model: parsed.data.model,
        apiKey,
      });
      return reply.send({ ok: true, data });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return sendError(reply, 400, message, 'AI_SETTINGS_FAILED');
    }
  });

  app.post('/test-connection', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    if (!requirePermission(req.user, 'settings.manage')) {
      return sendError(reply, 403, ArabicErrors.forbidden, 'FORBIDDEN');
    }
    const parsed = testBody.safeParse(req.body ?? {});
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    const key = parsed.data.apiKey?.trim();
    if (key && !isValidOpenAiKey(key)) {
      return sendError(reply, 400, 'مفتاح OpenAI غير صالح. يجب أن يبدأ بـ sk-.', 'INVALID_OPENAI_KEY');
    }
    try {
      const data = await testOpenAiConnection(companyId, key);
      return reply.send({ ok: true, data });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return sendError(reply, 400, message, 'AI_TEST_FAILED');
    }
  });

  app.post('/fabric-chat', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId, sub: userId } = req.user!;
    const parsed = chatBody.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    const result = await runFabricChat(
      companyId,
      userId,
      parsed.data.message,
      parsed.data.history,
      parsed.data.sessionId ?? null,
    );
    return reply.send({
      ok: true,
      data: {
        reply: result.reply,
        sessionId: result.sessionId,
        errorCode: result.errorCode ?? null,
      },
    });
  });
};
