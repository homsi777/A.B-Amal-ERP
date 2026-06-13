import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { ArabicErrors } from '../utils/arabicErrors.js';

export function sendError(
  reply: FastifyReply,
  statusCode: number,
  message: string,
  code?: string,
  details?: unknown,
) {
  return reply.status(statusCode).send({
    ok: false,
    message,
    code: code ?? 'ERROR',
    ...(details !== undefined ? { details } : {}),
  });
}

export function globalErrorHandler(
  error: FastifyError,
  _request: FastifyRequest,
  reply: FastifyReply,
) {
  if (error instanceof ZodError) {
    return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
  }

  const status = error.statusCode ?? 500;
  const message =
    status >= 500 ? ArabicErrors.server : error.message || ArabicErrors.server;

  if (status >= 500) {
    console.error('[error]', error.message);
  }

  return sendError(reply, status, message, status >= 500 ? 'SERVER' : 'CLIENT');
}
