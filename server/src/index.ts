import { getEnv } from './config/env.js';
import { buildApp } from './app.js';

async function main() {
  const env = getEnv();
  const app = await buildApp();

  await app.listen({ port: env.PORT, host: '0.0.0.0' });

  console.log(`[fabric-api] يعمل على المنفذ ${env.PORT} — الوضع ${env.NODE_ENV}`);
}

main().catch((err) => {
  console.error('[fabric-api] فشل التشغيل:', err instanceof Error ? err.message : err);
  process.exit(1);
});
