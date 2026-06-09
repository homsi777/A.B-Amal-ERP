import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, '../../.env') });

const raw = process.env.DATABASE_URL || '';
let tunnel5433 = false;
let dbName = '';
try {
  const u = new URL(raw.replace(/^postgres:/, 'postgresql:'));
  tunnel5433 =
    u.hostname === '127.0.0.1' && u.port === '5433' && u.pathname.replace(/^\//, '').split('?')[0] === 'fabric_erp';
  dbName = u.pathname.replace(/^\//, '').split('?')[0];
} catch {
  tunnel5433 = false;
}

console.log(
  JSON.stringify({
    tunnel5433,
    databaseName: dbName,
    hasPepper: Boolean(process.env.ACTIVATION_KEY_PEPPER?.trim()),
    hasJwt: Boolean(process.env.JWT_SECRET?.trim()),
    requireActive: process.env.ACTIVATION_REQUIRE_ACTIVE === 'true',
  }),
);
