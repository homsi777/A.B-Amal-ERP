import type { FastifyPluginAsync } from 'fastify';
import { dbHealthCheck } from '../db/pool.js';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  /** فقط أن الخاد يستمع على HTTP — يُستخدم لمُطلق التطوير قبل أن يكون النفق/Postgres جاهزين */
  app.get('/health/live', async (_request, reply) =>
    reply.status(200).send({
      ok: true,
      live: true,
      service: 'alamal-ab-obada-api',
      time: new Date().toISOString(),
    }),
  );

  app.get('/health', async (_request, reply) => {
    let database: 'connected' | 'disconnected' = 'disconnected';
    try {
      const ok = await dbHealthCheck();
      database = ok ? 'connected' : 'disconnected';
    } catch {
      database = 'disconnected';
    }

    const healthy = database === 'connected';

    return reply.status(healthy ? 200 : 503).send({
      ok: healthy,
      service: 'alamal-ab-obada-api',
      database,
      time: new Date().toISOString(),
    });
  });
};
