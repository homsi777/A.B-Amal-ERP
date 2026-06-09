import pg from 'pg';
import { getEnv } from '../config/env.js';

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    const { DATABASE_URL } = getEnv();
    // Force UTF-8 on every new connection via the libpq `options` parameter
    // so Arabic / Turkish text never round-trips through a Windows codepage
    // and turns into `?` characters. Doing it in the connection string —
    // instead of via a `pool.on('connect')` async hook — avoids the
    // "client.query() called while client is already executing" race that
    // serialises everything to one slow query at a time.
    const url = new URL(DATABASE_URL);
    if (!url.searchParams.has('options')) {
      url.searchParams.set('options', '-c client_encoding=UTF8');
    }

    pool = new Pool({
      connectionString: url.toString(),
      max: 20,
      idleTimeoutMillis: 60_000,
      connectionTimeoutMillis: 30_000,
    });

    pool.on('error', (err) => {
      console.error('[db] خطأ غير متوقع في مجمع الاتصالات:', err.message);
    });
  }
  return pool;
}

export async function resetPool(): Promise<void> {
  const current = pool;
  pool = null;
  if (!current) return;
  await current.end().catch(() => undefined);
}

export async function dbHealthCheck(): Promise<boolean> {
  const p = getPool();
  const client = await p.connect();
  try {
    await client.query('SELECT 1');
    return true;
  } finally {
    client.release();
  }
}
