import type { FastifyReply, FastifyRequest } from 'fastify';
import jwt, { type Secret, type SignOptions } from 'jsonwebtoken';
import { getEnv } from '../config/env.js';
import { getPool } from '../db/pool.js';
import { ArabicErrors } from '../utils/arabicErrors.js';
import { sendError } from './errorHandler.js';
import { touchActiveSession } from '../services/activeSessionsService.js';
import { clientIp } from '../utils/clientIp.js';

export type JwtPayload = {
  sub: string;
  companyId: string;
  username: string;
  role: string;
  permissions: string[];
};

export function signAuthToken(payload: JwtPayload): string {
  const env = getEnv();
  const secret: Secret = env.JWT_SECRET;
  const signOpts = { expiresIn: env.JWT_EXPIRES_IN } as SignOptions;
  return jwt.sign(
    {
      sub: payload.sub,
      companyId: payload.companyId,
      username: payload.username,
      role: payload.role,
      permissions: payload.permissions,
    },
    secret,
    signOpts,
  );
}

export function verifyAuthToken(token: string): JwtPayload {
  const env = getEnv();
  const secret: Secret = env.JWT_SECRET;
  const decoded = jwt.verify(token, secret);
  const p = decoded as unknown as JwtPayload;
  if (
    typeof p.sub !== 'string' ||
    typeof p.companyId !== 'string' ||
    typeof p.username !== 'string' ||
    typeof p.role !== 'string' ||
    !Array.isArray(p.permissions)
  ) {
    throw new Error('invalid_token_payload');
  }
  return p;
}

export async function authenticateRequest(request: FastifyRequest, reply: FastifyReply) {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return sendError(reply, 401, ArabicErrors.unauthorized, 'UNAUTHORIZED');
  }

  const token = header.slice('Bearer '.length).trim();
  if (!token) {
    return sendError(reply, 401, ArabicErrors.unauthorized, 'UNAUTHORIZED');
  }

  try {
    const payload = verifyAuthToken(token);
    const pool = getPool();
    const userCheck = await pool.query<{ is_active: boolean; full_name: string | null }>(
      'SELECT is_active, full_name FROM users WHERE id = $1',
      [payload.sub],
    );
    if (userCheck.rows.length === 0 || !userCheck.rows[0].is_active) {
      return sendError(reply, 401, ArabicErrors.userInactive, 'UNAUTHORIZED');
    }

    request.user = payload;
    touchActiveSession({
      payload,
      token,
      ip: clientIp(request),
      userAgent: String(request.headers['user-agent'] || '—'),
      clientPlatformHeader: request.headers['x-client-platform'],
      fullName: userCheck.rows[0].full_name,
    });
  } catch {
    return sendError(reply, 401, ArabicErrors.tokenInvalid, 'UNAUTHORIZED');
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: JwtPayload;
  }
}
