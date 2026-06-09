import bcrypt from 'bcryptjs';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { authenticateRequest, signAuthToken, type JwtPayload } from '../middleware/auth.js';
import { runPostActivationBootstrap } from '../services/postActivationBootstrap.js';
import { ArabicErrors } from '../utils/arabicErrors.js';
import { sendError } from '../middleware/errorHandler.js';

const loginBodySchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
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
      }>(
        `SELECT id, company_id, username, full_name, password_hash, role, is_active
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
    };

    const token = signAuthToken(payload);

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
      },
    });
  });

  app.post('/logout', async (_request, reply) => {
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
    }>(
      `SELECT id, username, full_name, company_id, role FROM users WHERE id = $1`,
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
      },
    });
  });
};
