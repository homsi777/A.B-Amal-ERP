/**
 * أمر التطوير الواحد: يقرأ electron/config/vps-connection.json، يفتح نفق SSH عند الحاجة،
 * يضبط DATABASE_URL في بيئة عمليات server/vite/electron (لا يُستبدَل بـ server/.env طالما موجود في process.env).
 *
 * التشغيل: npm run electron:dev:stack
 */
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import {
  ensureDeliveryTunnel,
  stopDeliveryTunnel,
  readVpsLaunchConfig,
  databaseUrlFromEmbeddedDb,
} from '../electron/tunnel/deliveryVpsTunnel.js';

const root = process.cwd();

function tsStamp(): string {
  const d = new Date();
  const pad2 = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
}

function safeWrite(file: string, text: string): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, text, 'utf8');
  } catch {
    /* ignore */
  }
}

async function main(): Promise<void> {
  const cfgPath = path.join(root, 'electron', 'config', 'vps-connection.json');
  const launch = readVpsLaunchConfig([cfgPath]);
  const ed = launch.embeddedDb;

  if (!ed) {
    console.error(
      '[dev-stack] تعذّر استنتاج إعدادات قاعدة البيانات من electron/config/vps-connection.json.',
    );
    console.error(
      '[dev-stack] انسخ من vps-connection.example.json واملأ الحقول (sshHost / dbTunnel / postgresPublicHost…).',
    );
    console.error('[dev-stack] للتشغيل بدون هذا الملف: npm run electron:dev:stack:raw');
    process.exit(1);
  }

  let databaseUrl: string;
  if (ed.kind === 'ssh_tunnel') {
    console.log('[dev-stack] جارٍ ضبط نفق SSH (نفس منطق Electron)…');
    const r = await ensureDeliveryTunnel(ed.config, { packaged: false });
    if (!r.ok || !r.databaseUrl) {
      console.error('[dev-stack] فشل النفق أو الاتصال بـ PostgreSQL:', r.error ?? 'unknown');
      process.exit(1);
    }
    databaseUrl = r.databaseUrl;
    console.log('[dev-stack] DATABASE_URL مضبوط من النفق إلى 127.0.0.1:' + ed.config.localDbPort);
  } else {
    databaseUrl = databaseUrlFromEmbeddedDb(ed);
    console.log('[dev-stack] DATABASE_URL مضبوط من وضع Postgres العام (بدون نفق SSH).');
  }

  const env = { ...process.env, DATABASE_URL: databaseUrl };
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

  const logsDir = path.join(root, 'logs');
  const stamp = tsStamp();
  const logLatest = path.join(logsDir, 'dev-stack-last.log');
  const logStamped = path.join(logsDir, `dev-stack-${stamp}.log`);
  const header =
    `================================================================================\n` +
    `CLOTEX — electron:dev:stack (سجل التشغيل)\n` +
    `بدء: ${new Date().toISOString()}\n` +
    `المجلّد: ${root}\n` +
    `================================================================================\n\n`;
  try {
    fs.mkdirSync(logsDir, { recursive: true });
    fs.writeFileSync(logLatest, header, 'utf8');
    fs.writeFileSync(logStamped, header, 'utf8');
  } catch {
    /* ignore */
  }
  console.log(`[dev-stack] سجل التشغيل: ${logStamped}`);
  console.log(`[dev-stack] سجل آخر تشغيل: ${logLatest}`);

  const child = spawn(npmCmd, ['run', 'electron:dev:stack:inner'], {
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
    env,
    cwd: root,
  });

  child.stdout?.on('data', (buf: Buffer) => {
    const s = buf.toString('utf8');
    safeWrite(logStamped, s);
    safeWrite(logLatest, s);
    process.stdout.write(s);
  });
  child.stderr?.on('data', (buf: Buffer) => {
    const s = buf.toString('utf8');
    safeWrite(logStamped, s);
    safeWrite(logLatest, s);
    process.stderr.write(s);
  });

  const onClose = (code: number | null) => {
    const footer =
      `\n================================================================================\n` +
      `انتهاء: ${new Date().toISOString()}\n` +
      `كود الخروج تقريبي: ${code ?? 0}\n` +
      `نسخ موسومة: ${logStamped}\n` +
      `نسخ آخر تشغيل: ${logLatest}\n` +
      `================================================================================\n`;
    safeWrite(logStamped, footer);
    safeWrite(logLatest, footer);
    void stopDeliveryTunnel().finally(() => process.exit(code ?? 0));
  };

  child.on('exit', onClose);
  child.on('error', (err) => {
    console.error('[dev-stack]', err);
    void stopDeliveryTunnel().finally(() => process.exit(1));
  });

  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(sig, () => {
      try {
        child.kill('SIGINT');
      } catch {
        /* ignore */
      }
    });
  }
}

await main().catch(async (e: unknown) => {
  console.error(e);
  await stopDeliveryTunnel();
  process.exit(1);
});
