import bcrypt from 'bcryptjs';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getPool } from '../db/pool.js';
import {
  authenticateRequest,
  requirePlatformAdmin,
  signAuthToken,
  type JwtPayload,
} from '../middleware/auth.js';
import { runPostActivationBootstrap } from '../services/postActivationBootstrap.js';
import { ArabicErrors } from '../utils/arabicErrors.js';
import { sendError } from '../middleware/errorHandler.js';
import { touchActiveSession } from '../services/activeSessionsService.js';
import { clientIp } from '../utils/clientIp.js';

const loginBodySchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const switchCompanyBodySchema = z.object({
  companyId: z.string().uuid(),
});

async function permissionCodesForRole(roleCode: string): Promise<string[]> {
  const pool = getPool();
  const result = await pool.query<{ code: string }>(
    `SELECT p.code
     FROM permissions p
     INNER JOIN role_permissions rp ON rp.permission_id = p.id
     INNER JOIN roles r ON r.id = rp.role_id
     WHERE r.code = $1
     ORDER BY p.code`,
    [roleCode],
  );
  return result.rows.map((row) => row.code);
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post('/login', async (request, reply) => {
    const parsed = loginBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');
    }

    const { username, password } = parsed.data;
    const pool = getPool();

    const userQuery = () =>
      pool.query<{
        id: string;
        company_id: string;
        username: string;
        full_name: string | null;
        password_hash: string;
        role: string;
        is_active: boolean;
        is_platform_admin: boolean;
      }>(
        `SELECT id, company_id, username, full_name, password_hash, role, is_active, is_platform_admin
         FROM users
         WHERE lower(trim(username)) = lower(trim($1::text))`,
        [username],
      );

    let userResult = await userQuery();

    if (userResult.rows.length === 0) {
      const nUsers = await pool.query<{ n: string }>('SELECT COUNT(*)::text AS n FROM users');
      const total = Number(nUsers.rows[0]?.n ?? '0');
      if (total === 0) {
        const comp = await pool.query<{ id: string }>(
          'SELECT id FROM companies ORDER BY created_at ASC LIMIT 1',
        );
        if (comp.rows[0]?.id) {
          try {
            await runPostActivationBootstrap(comp.rows[0].id);
          } catch (e) {
            console.error('[auth/login] فشل التهيئة التلقائية:', e);
          }
          userResult = await userQuery();
        }
      }

      if (userResult.rows.length === 0) {
        const nAfter = await pool.query<{ n: string }>('SELECT COUNT(*)::text AS n FROM users');
        if (Number(nAfter.rows[0]?.n ?? '0') === 0) {
          return sendError(reply, 401, ArabicErrors.noUsersYet, 'AUTH_NEEDS_SEED');
        }
        return sendError(reply, 401, ArabicErrors.invalidCredentials, 'AUTH');
      }
    }

    const user = userResult.rows[0];
    if (!user.is_active) {
      return sendError(reply, 401, ArabicErrors.userInactive, 'AUTH');
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return sendError(reply, 401, ArabicErrors.invalidCredentials, 'AUTH');
    }

    const permissions = await permissionCodesForRole(user.role);

    const payload: JwtPayload = {
      sub: user.id,
      companyId: user.company_id,
      username: user.username,
      role: user.role,
      permissions,
      isPlatformAdmin: user.is_platform_admin,
    };

    const token = signAuthToken(payload);

    touchActiveSession({
      payload,
      token,
      ip: clientIp(request),
      userAgent: String(request.headers['user-agent'] || '—'),
      clientPlatformHeader: request.headers['x-client-platform'],
      fullName: user.full_name,
    });

    return reply.send({
      ok: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        fullName: user.full_name,
        companyId: user.company_id,
        role: user.role,
        permissions,
        isPlatformAdmin: user.is_platform_admin,
      },
    });
  });

  app.post('/logout', async (_request, reply) => {
    return reply.send({ ok: true });
  });

  app.get('/presence', { preHandler: authenticateRequest }, async (_request, reply) => {
    return reply.send({ ok: true });
  });

  app.get('/me', { preHandler: authenticateRequest }, async (request, reply) => {
    const u = request.user;
    if (!u) {
      return sendError(reply, 401, ArabicErrors.unauthorized, 'UNAUTHORIZED');
    }

    const pool = getPool();
    const row = await pool.query<{
      id: string;
      username: string;
      full_name: string | null;
      company_id: string;
      role: string;
      is_platform_admin: boolean;
    }>(
      `SELECT id, username, full_name, company_id, role, is_platform_admin FROM users WHERE id = $1`,
      [u.sub],
    );

    if (row.rows.length === 0) {
      return sendError(reply, 401, ArabicErrors.unauthorized, 'UNAUTHORIZED');
    }

    const user = row.rows[0];
    const permissions = await permissionCodesForRole(user.role);

    return reply.send({
      ok: true,
      user: {
        id: user.id,
        username: user.username,
        fullName: user.full_name,
        companyId: user.company_id,
        role: user.role,
        permissions,
        isPlatformAdmin: user.is_platform_admin,
      },
    });
  });

  /**
   * تبديل السياق لمدير المنصة فقط: يُصدر توكن جديد لنفس هويته لكن بـ
   * companyId الحساب المُختار، فتعمل كل الشاشات (المعتمدة أصلاً على
   * req.user.companyId) تلقائياً على بيانات ذلك الحساب دون أي تعديل عليها.
   */
  app.post('/switch-company', { preHandler: authenticateRequest }, async (request, reply) => {
    if (!requirePlatformAdmin(request.user)) {
      return sendError(reply, 403, ArabicErrors.forbidden, 'FORBIDDEN');
    }
    const parsed = switchCompanyBodySchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, ArabicErrors.validation, 'VALIDATION');

    const pool = getPool();
    const companyRow = await pool.query<{ id: string; is_active: boolean }>(
      'SELECT id, is_active FROM companies WHERE id = $1',
      [parsed.data.companyId],
    );
    if (companyRow.rows.length === 0) {
      return sendError(reply, 404, 'الحساب المحدد غير موجود', 'NOT_FOUND');
    }
    if (!companyRow.rows[0].is_active) {
      return sendError(reply, 409, 'الحساب المحدد غير فعّال', 'COMPANY_INACTIVE');
    }

    const userRow = await pool.query<{
      id: string;
      username: string;
      full_name: string | null;
      role: string;
      is_platform_admin: boolean;
    }>(
      'SELECT id, username, full_name, role, is_platform_admin FROM users WHERE id = $1',
      [request.user!.sub],
    );
    const user = userRow.rows[0];
    const permissions = await permissionCodesForRole(user.role);

    const payload: JwtPayload = {
      sub: user.id,
      companyId: companyRow.rows[0].id,
      username: user.username,
      role: user.role,
      permissions,
      isPlatformAdmin: user.is_platform_admin,
    };
    const token = signAuthToken(payload);

    touchActiveSession({
      payload,
      token,
      ip: clientIp(request),
      userAgent: String(request.headers['user-agent'] || '—'),
      clientPlatformHeader: request.headers['x-client-platform'],
      fullName: user.full_name,
    });

    return reply.send({
      ok: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        fullName: user.full_name,
        companyId: companyRow.rows[0].id,
        role: user.role,
        permissions,
        isPlatformAdmin: user.is_platform_admin,
      },
    });
  });
};
