import type { FastifyReply, FastifyRequest } from 'fastify';
import type { JwtPayload } from './auth.js';
import { ArabicErrors } from '../utils/arabicErrors.js';
import { sendError } from './errorHandler.js';

export function userHasPermission(user: JwtPayload | undefined, code: string): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return user.permissions.includes(code);
}

export function userHasAnyPermission(user: JwtPayload | undefined, codes: string[]): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return codes.some((code) => user.permissions.includes(code));
}

export function requirePermission(code: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!userHasPermission(request.user, code)) {
      return sendError(reply, 403, ArabicErrors.forbidden, 'FORBIDDEN');
    }
  };
}
