/**
 * One-shot: open SSH tunnel (if needed), run migrations + financial audit, then close tunnel.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  ensureDeliveryTunnel,
  readVpsLaunchConfig,
  stopDeliveryTunnel,
} from '../../../electron/tunnel/deliveryVpsTunnel.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const cfgPath = path.join(root, 'electron', 'config', 'vps-connection.json');

async function main() {
  const launch = readVpsLaunchConfig([cfgPath]);
  const ed = launch.embeddedDb;
  if (!ed || ed.kind !== 'ssh_tunnel') {
    console.error('[migrate-audit] يتطلب dbTunnel=ssh_tunnel في vps-connection.json');
    process.exit(1);
  }

  console.log('[migrate-audit] جارٍ فتح نفق SSH…');
  const tunnel = await ensureDeliveryTunnel(ed.config, { packaged: false });
  if (!tunnel.ok || !tunnel.databaseUrl) {
    console.error('[migrate-audit] فشل النفق:', tunnel.error ?? 'unknown');
    process.exit(1);
  }

  const env = { ...process.env, DATABASE_URL: tunnel.databaseUrl };
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

  try {
    console.log('[migrate-audit] تشغيل server:migrate…');
    const mig = spawnSync(npm, ['run', 'server:migrate'], { cwd: root, env, stdio: 'inherit', shell: true });
    if (mig.status !== 0) process.exit(mig.status ?? 1);

    console.log('[migrate-audit] تشغيل audit:financial…');
    const aud = spawnSync(npm, ['run', 'audit:financial'], { cwd: root, env, stdio: 'inherit', shell: true });
    process.exit(aud.status ?? 0);
  } finally {
    await stopDeliveryTunnel();
  }
}

main().catch((e) => {
  console.error('[migrate-audit] خطأ:', e instanceof Error ? e.message : e);
  process.exit(1);
});
