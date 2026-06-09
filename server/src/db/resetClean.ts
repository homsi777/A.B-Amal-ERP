/**
 * إعادة تهيئة قاعدة البيانات بالكامل — خطِر جداً، للتطوير فقط.
 * يتطلب: ALLOW_DB_RESET=true في البيئة.
 *
 * يحذف مخطط public بالكامل ثم يعيد migrations + seed.
 */
import { config as loadDotenv } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { spawnSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

loadDotenv({ path: path.resolve(__dirname, '../../.env') });

async function main() {
  if (process.env.ALLOW_DB_RESET !== 'true') {
    console.error(
      '[resetClean] مرفوض: عيّن ALLOW_DB_RESET=true في البيئة لتأكيد مسح قاعدة البيانات بالكامل.',
    );
    process.exit(1);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('[resetClean] DATABASE_URL غير معرّف.');
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();

  try {
    console.warn('[resetClean] جاري حذف مخطط public بالكامل...');
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
    console.log('[resetClean] تم إنشاء مخطط public فارغ.');
  } finally {
    client.release();
    await pool.end();
  }

  /** `__dirname` = server/src/db → ثلاثة مستويات = جذر المشروع (حيث package.json) */
  const root = path.resolve(__dirname, '../../..');
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const useShell = process.platform === 'win32';

  console.log('[resetClean] تشغيل الترحيلات...');
  const mig = spawnSync(npmCmd, ['run', 'server:migrate'], {
    cwd: root,
    stdio: 'inherit',
    shell: useShell,
    env: { ...process.env, ALLOW_DB_RESET: undefined },
  });
  if (mig.status !== 0) {
    console.error('[resetClean] فشل server:migrate');
    process.exit(mig.status ?? 1);
  }

  console.log('[resetClean] تشغيل البذور...');
  const seed = spawnSync(npmCmd, ['run', 'server:seed'], {
    cwd: root,
    stdio: 'inherit',
    shell: useShell,
    env: { ...process.env, ALLOW_DB_RESET: undefined },
  });
  if (seed.status !== 0) {
    console.error('[resetClean] فشل server:seed');
    process.exit(seed.status ?? 1);
  }

  console.log('[resetClean] اكتمل — قاعدة نظيفة مع بذور دنيا فقط.');
}

main().catch((err) => {
  console.error('[resetClean]', err instanceof Error ? err.message : err);
  process.exit(1);
});
