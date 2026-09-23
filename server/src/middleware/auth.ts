import type { FastifyReply, FastifyRequest } from 'fastify';
import jwt, { type Secret, type SignOptions } from 'jsonwebtoken';
import { getEnv } from '../config/env.js';
import { getPool } from '../db/pool.js';
import { ArabicErrors } from '../utils/arabicErrors.js';
import { sendError } from './errorHandler.js';
import { touchActiveSession, isSessionRevoked } from '../services/activeSessionsService.js';
import { clientIp } from '../utils/clientIp.js';

export type JwtPayload = {
  sub: string;
  companyId: string;
  username: string;
  role: string;
  permissions: string[];
  /** مدير منصة حقيقي (مالك نظام clotex) — منفصل عن "أدمن" أي شركة عميل. */
  isPlatformAdmin: boolean;
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
      isPlatformAdmin: payload.isPlatformAdmin,
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
  // متساهل عمداً: توكنات صادرة قبل إضافة هذا الحقل لا تحمله — تُعامل كـ false
  // (أضيق صلاحية) بدل رفض الجلسة بالكامل.
  p.isPlatformAdmin = p.isPlatformAdmin === true;
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
    // بحث واحد بمفتاح id (PK، مفهرس أصلاً) يجلب كل ما يلزم: الحالة، الاسم،
    // الشركة الأصلية، وحالة "مدير المنصة" — تُقرأ من قاعدة البيانات مباشرة
    // بكل طلب، لا تُؤخذ من التوكن.
    const userCheck = await pool.query<{
      is_active: boolean;
      full_name: string | null;
      company_id: string;
      is_platform_admin: boolean;
    }>(
      'SELECT is_active, full_name, company_id, is_platform_admin FROM users WHERE id = $1',
      [payload.sub],
    );
    if (userCheck.rows.length === 0 || !userCheck.rows[0].is_active) {
      return sendError(reply, 401, ArabicErrors.userInactive, 'UNAUTHORIZED');
    }

    // التوكن يمثّل شركة غير الشركة الأصلية للمستخدم (بعد switch-company) —
    // هذا لا يُسمح به إلا لمدير منصة ما زال فعّالاً *الآن*، وليس وقت إصدار
    // التوكن. مدير منصة أُلغيت صلاحيته يفقد الوصول لحسابات الآخرين فوراً،
    // بدل انتظار انتهاء صلاحية التوكن.
    if (payload.companyId !== userCheck.rows[0].company_id && !userCheck.rows[0].is_platform_admin) {
      return sendError(reply, 403, ArabicErrors.forbidden, 'FORBIDDEN');
    }

    if (isSessionRevoked(payload.sub, token)) {
      return sendError(reply, 401, 'تم إنهاء الجلسة من قبل المدير', 'SESSION_REVOKED');
    }

    request.user = payload;
    request.authToken = token;
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

/**
 * إدارة الحسابات (companies) وتراخيص كل الحسابات تخص مالك منصة clotex فقط
 * — وليست صلاحية "أدمن" عادية، لأن "أدمن" موجود بكل حساب على حدة ولا يجوز
 * أن يرى أو يتحكم بحسابات/تراخيص حسابات أخرى.
 */
export function requirePlatformAdmin(user: JwtPayload | undefined): boolean {
  return Boolean(user?.isPlatformAdmin);
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: JwtPayload;
    authToken?: string;
  }
}
