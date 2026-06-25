import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { authenticateRequest } from '../middleware/auth.js';
import { ArabicErrors } from '../utils/arabicErrors.js';
import { sendError } from '../middleware/errorHandler.js';
import { normalizeAiProvider } from '../services/ai/aiProviders.js';
import {
  getAiSettingsMasked,
  saveAiSettings,
  testAiConnection,
} from '../services/ai/aiSettingsService.js';
import {
  apiKeyValidationMessage,
  isValidApiKey,
} from '../services/ai/settingsEncryption.js';
import { runFabricChat } from '../services/ai/clotexAssistantService.js';

function requirePermission(user: { role: string; permissions: string[] } | undefined, code: string) {
  if (!user) return false;
  return user.role === 'admin' || user.permissions.includes(code);
}

const providerSchema = z.enum(['openai', 'gemini', 'deepseek']);

const settingsBody = z.object({
  enabled: z.boolean(),
  provider: providerSchema.default('openai'),
  model: z.string().trim().min(1).default('gpt-4o-mini'),
  apiKey: z.string().trim().optional(),
});

const testBody = z.object({
  apiKey: z.string().trim().optional(),
  model: z.string().trim().optional(),
  provider: providerSchema.optional(),
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
    const provider = normalizeAiProvider(parsed.data.provider);
    const apiKey = parsed.data.apiKey?.trim();
    if (apiKey && !isValidApiKey(provider, apiKey)) {
      return sendError(reply, 400, apiKeyValidationMessage(provider), 'INVALID_API_KEY');
    }
    try {
      const data = await saveAiSettings(companyId, userId, {
        enabled: parsed.data.enabled,
        provider,
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
    const provider = normalizeAiProvider(parsed.data.provider);
    const key = parsed.data.apiKey?.trim();
    if (key && !isValidApiKey(provider, key)) {
      return reply.send({
        ok: true,
        data: { success: false, message: apiKeyValidationMessage(provider) },
      });
    }
    try {
      const data = await testAiConnection(companyId, key, parsed.data.model?.trim(), provider);
      return reply.send({ ok: true, data: { success: true, model: data.model, provider: data.provider } });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'فشل اختبار الاتصال.';
      return reply.send({ ok: true, data: { success: false, message } });
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
