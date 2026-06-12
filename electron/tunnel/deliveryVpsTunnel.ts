/**
 * Emergency delivery: SSH local forward + PostgreSQL ping.
 * Dev: ssh2 first, then PuTTY plink fallback.
 * Packaged (Windows): bundled resources/bin/plink.exe only — ssh2 is not used.
 * Credentials come ONLY from electron/config/vps-connection.json (gitignored).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';
import { spawn } from 'child_process';
export interface VpsConnectionConfig {
  enabled?: boolean;
  sshHost: string;
  sshPort: number;
  sshUser: string;
  sshPassword: string;
  localDbPort: number;
  remoteDbHost: string;
  remoteDbPort: number;
  dbUser: string;
  dbPassword: string;
  dbName: string;
  /** Optional path to plink.exe when ssh2 is unavailable */
  plinkPath?: string;
  /**
   * Public base URL of the Fastify API (e.g. https://api.example.com — no trailing slash).
   * When packaged, main seeds desktop `apiBaseUrl` from this if still default localhost.
   */
  apiPublicUrl?: string;
  /** PuTTY plink `-hostkey` value (e.g. ssh-ed25519 SHA256:...) for non-interactive trust */
  sshHostKey?: string;
  /**
   * When true, Electron runs SSH local forward + PostgreSQL ping on startup (packaged: plink only).
   * Packaged default in main: off — daily use goes through HTTPS API on VPS only.
   */
  verifyPostgresViaTunnel?: boolean;
}

export type EmbeddedDbInfo =
  | { kind: 'ssh_tunnel'; config: VpsConnectionConfig }
  | { kind: 'direct_public'; databaseUrl: string };

/** First existing vps config file + loose fields (api URL) even if tunnel credentials are missing. */
export type VpsLaunchReadResult = {
  pathUsed: string | null;
  pathsChecked: string[];
  apiPublicUrl?: string;
  /** From JSON; undefined = caller decides default */
  verifyPostgresViaTunnel?: boolean;
  tunnelConfig: VpsConnectionConfig | null;
  /** Parsed DB routing for bundled desktop backend (tunnel vs public Postgres). */
  embeddedDb: EmbeddedDbInfo | null;
  rawReadError?: string;
  activationKeyPepper?: string;
  telegramBotToken?: string;
  telegramChatId?: string;
};

function parseLooseBool(val: unknown): boolean | undefined {
  if (val === undefined || val === null) return undefined;
  const s = String(val).trim().toLowerCase();
  if (['false', '0', 'no', 'off'].includes(s)) return false;
  if (['true', '1', 'yes', 'on'].includes(s)) return true;
  return undefined;
}

/** بعض النسخ تستخدم host بدل sshHost */
function resolveJsonSshHost(j: Record<string, unknown>): string | undefined {
  const keys = ['sshHost', 'host', 'ssh_host', 'vpsHost', 'vps_host', 'sshHostIp', 'serverHost'];
  for (const k of keys) {
    const v = j[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

/**
 * PuTTY `plink -hostkey` expects e.g. `ssh-ed25519 SHA256:...` — not `ssh-ed25519 255 SHA256:...`.
 * Users often paste a stray bit-length (`255`) from OpenSSH-style prompts.
 */
export function normalizePlinkHostKeySpec(raw: string): string {
  const s = raw.trim();
  if (!s) return s;
  let out = s.replace(/^(ssh-ed25519)\s+\d+\s+(?=SHA256:)/i, '$1 ');
  out = out.replace(/^(ssh-rsa)\s+\d+\s+(?=SHA256:)/i, '$1 ');
  return out;
}

function coerceDbTunnel(raw: Record<string, unknown>): 'ssh_tunnel' | 'direct_public' {
  const keys = ['dbTunnel', 'db_tunnel', 'dbConnectionMode'];
  for (const k of keys) {
    const v = raw[k];
    if (typeof v !== 'string') continue;
    const s = v.trim().toLowerCase().replace(/-/g, '_');
    if (s === 'ssh' || s === 'tunnel' || s === 'ssh_tunnel') return 'ssh_tunnel';
    if (s === 'direct' || s === 'public' || s === 'none' || s === 'direct_public') return 'direct_public';
  }

  const hostKeys = ['postgresPublicHost', 'postgres_public_host', 'publicPostgresHost', 'postgresHostRemote'];
  for (const k of hostKeys) {
    const v = raw[k];
    if (typeof v === 'string' && v.trim()) return 'direct_public';
  }
  return 'ssh_tunnel';
}

function readPgTriple(j: Record<string, unknown>): { user: string; password: string; db: string } {
  const user =
    typeof j.dbUser === 'string'
      ? j.dbUser
      : typeof j.database_user === 'string'
        ? j.database_user
        : 'erp_user';
  const password = String(j.dbPassword ?? j.database_password ?? '');
  const db =
    typeof j.dbName === 'string'
      ? j.dbName
      : typeof j.database_name === 'string'
        ? j.database_name
        : 'obada';
  return { user, password, db };
}

/** Build EmbeddedDbInfo from parsed JSON (desktop EXE bundles Fastify locally; DB is remote). */
export function parseEmbeddedDbFromVpsJson(j: Record<string, unknown>): EmbeddedDbInfo | null {
  if (j.enabled === false) return null;

  const mode = coerceDbTunnel(j);
  const { user: dbUser, password: dbPassword, db: dbName } = readPgTriple(j);

  if (mode === 'direct_public') {
    const hostKeys = ['postgresPublicHost', 'postgres_public_host', 'publicPostgresHost', 'postgresHostRemote'];
    let publicHost = '';
    for (const k of hostKeys) {
      const v = j[k];
      if (typeof v === 'string' && v.trim()) {
        publicHost = v.trim();
        break;
      }
    }
    if (!publicHost) return null;
    let publicPort = 5432;
    const portCandidates = ['postgresPublicPort', 'postgres_public_port', 'publicPostgresPort'];
    for (const pk of portCandidates) {
      const pv = j[pk];
      if (typeof pv === 'number' && Number.isFinite(pv)) {
        publicPort = pv;
        break;
      }
      if (typeof pv === 'string' && pv.trim()) {
        publicPort = Number(pv);
        break;
      }
    }
    const sslRaw = String(j.postgresSslMode ?? j.postgres_ssl_mode ?? 'prefer').trim().toLowerCase();
    const sslmode = ['disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full'].includes(sslRaw)
      ? sslRaw
      : 'prefer';
    const u = encodeURIComponent(dbUser);
    const p = encodeURIComponent(dbPassword);
    const url = `postgresql://${u}:${p}@${publicHost}:${publicPort}/${encodeURIComponent(dbName)}?sslmode=${sslmode}`;
    return { kind: 'direct_public', databaseUrl: url };
  }

  const sshHostResolved = resolveJsonSshHost(j);
  const sshOk =
    sshHostResolved !== undefined &&
    typeof j.sshUser === 'string' &&
    j.sshPassword !== undefined &&
    j.sshPassword !== null;
  if (!sshOk) return null;

  const cfg: VpsConnectionConfig = {
    enabled: j.enabled !== false,
    sshHost: sshHostResolved,
    sshPort: Number(j.sshPort ?? 2727),
    sshUser: String(j.sshUser),
    sshPassword: String(j.sshPassword),
    localDbPort: Number(j.localDbPort ?? 5433),
    remoteDbHost: typeof j.remoteDbHost === 'string' ? j.remoteDbHost : '127.0.0.1',
    remoteDbPort: Number(j.remoteDbPort ?? 5432),
    dbUser,
    dbPassword,
    dbName,
    ...(typeof j.plinkPath === 'string' ? { plinkPath: j.plinkPath } : {}),
    ...(typeof j.apiPublicUrl === 'string' ? { apiPublicUrl: j.apiPublicUrl } : {}),
    ...(typeof j.sshHostKey === 'string' ? { sshHostKey: j.sshHostKey } : {}),
    ...(() => {
      const vpt = parseLooseBool(j.verifyPostgresViaTunnel);
      return vpt === undefined ? {} : { verifyPostgresViaTunnel: vpt };
    })(),
  };

  return { kind: 'ssh_tunnel', config: cfg };
}

let tunnelStop: (() => void) | null = null;
let tunnelStartedByUs = false;
let lastTechDetails = '';

export function getLastTunnelTechDetails(): string {
  return lastTechDetails;
}

export function buildDatabaseUrl(cfg: VpsConnectionConfig): string {
  const u = encodeURIComponent(cfg.dbUser);
  const p = encodeURIComponent(cfg.dbPassword);
  return `postgresql://${u}:${p}@127.0.0.1:${cfg.localDbPort}/${cfg.dbName}?sslmode=disable`;
}

export function databaseUrlFromEmbeddedDb(info: EmbeddedDbInfo): string {
  if (info.kind === 'direct_public') return info.databaseUrl;
  return buildDatabaseUrl(info.config);
}

export function loadVpsConnectionFile(configPath: string): VpsConnectionConfig | null {
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const j = JSON.parse(raw) as Record<string, unknown>;
    if (j.enabled === false) return null;
    const sshHost = resolveJsonSshHost(j);
    if (!sshHost || typeof j.sshUser !== 'string' || j.sshPassword == null) return null;
    return {
      enabled: j.enabled !== false,
      sshHost,
      sshPort: Number(j.sshPort ?? 2727),
      sshUser: j.sshUser,
      sshPassword: String(j.sshPassword),
      localDbPort: Number(j.localDbPort ?? 5433),
      remoteDbHost: typeof j.remoteDbHost === 'string' ? j.remoteDbHost : '127.0.0.1',
      remoteDbPort: Number(j.remoteDbPort ?? 5432),
      dbUser: typeof j.dbUser === 'string' ? j.dbUser : 'erp_user',
      dbPassword: String(j.dbPassword ?? ''),
      dbName: typeof j.dbName === 'string' ? j.dbName : 'obada',
      plinkPath: typeof j.plinkPath === 'string' ? j.plinkPath : undefined,
      apiPublicUrl: typeof j.apiPublicUrl === 'string' ? j.apiPublicUrl : undefined,
      sshHostKey: typeof j.sshHostKey === 'string' ? j.sshHostKey : undefined,
      ...(() => {
        const vpt = parseLooseBool(j.verifyPostgresViaTunnel);
        return vpt === undefined ? {} : { verifyPostgresViaTunnel: vpt };
      })(),
    };
  } catch {
    return null;
  }
}

/**
 * Read the first existing vps-connection.json along the search paths.
 * always extracts apiPublicUrl / verifyPostgresViaTunnel when present; tunnelConfig only if SSH fields are valid.
 */
export function readVpsLaunchConfig(paths: string[]): VpsLaunchReadResult {
  const pathsChecked: string[] = [];
  for (const p of paths) {
    pathsChecked.push(p);
    if (!fs.existsSync(p)) continue;

    let raw: string;
    try {
      raw = fs.readFileSync(p, 'utf-8');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        pathUsed: p,
        pathsChecked,
        tunnelConfig: null,
        embeddedDb: null,
        rawReadError: msg,
      };
    }

    try {
      const j = JSON.parse(raw) as Record<string, unknown>;
      const apiPublicUrl =
        typeof j.apiPublicUrl === 'string' && j.apiPublicUrl.trim()
          ? j.apiPublicUrl.trim().replace(/\/$/, '')
          : undefined;
      const verifyPostgresViaTunnel = parseLooseBool(j.verifyPostgresViaTunnel);

      let embeddedDb = parseEmbeddedDbFromVpsJson(j);
      if (!embeddedDb) {
        const fallback = loadVpsConnectionFile(p);
        embeddedDb = fallback ? { kind: 'ssh_tunnel', config: fallback } : null;
      }
      const tunnelConfig = embeddedDb?.kind === 'ssh_tunnel' ? embeddedDb.config : null;

      const activationKeyPepper =
        typeof j.activationKeyPepper === 'string' ? j.activationKeyPepper.trim() : undefined;
      const telegramBotToken =
        typeof j.telegramBotToken === 'string' ? j.telegramBotToken.trim() : undefined;
      const telegramChatId =
        typeof j.telegramChatId === 'string' ? j.telegramChatId.trim() : undefined;

      return {
        pathUsed: p,
        pathsChecked,
        apiPublicUrl,
        verifyPostgresViaTunnel,
        tunnelConfig,
        embeddedDb,
        ...(activationKeyPepper ? { activationKeyPepper } : {}),
        ...(telegramBotToken ? { telegramBotToken } : {}),
        ...(telegramChatId ? { telegramChatId } : {}),
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        pathUsed: p,
        pathsChecked,
        tunnelConfig: null,
        embeddedDb: null,
        rawReadError: msg,
      };
    }
  }

  return {
    pathUsed: null,
    pathsChecked,
    tunnelConfig: null,
    embeddedDb: null,
  };
}

export function resolveVpsConfigPathsForElectron(app: { isPackaged: boolean }): string[] {
  if (app.isPackaged) {
    return [path.join(process.resourcesPath, 'config', 'vps-connection.json')];
  }
  return [path.join(__dirname, '..', '..', 'electron', 'config', 'vps-connection.json')];
}

export function resolveVpsConfigPathForCli(projectRoot: string): string {
  return path.join(projectRoot, 'electron', 'config', 'vps-connection.json');
}

export function loadFirstExistingVpsConfig(paths: string[]): VpsConnectionConfig | null {
  for (const p of paths) {
    if (fs.existsSync(p)) {
      const c = loadVpsConnectionFile(p);
      if (c) return c;
    }
  }
  return null;
}

export async function isTcpPortOpen(port: number, host = '127.0.0.1', ms = 900): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host }, () => {
      socket.end();
      resolve(true);
    });
    socket.setTimeout(ms);
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('error', () => resolve(false));
  });
}

async function waitForPort(port: number, timeoutMs: number): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await isTcpPortOpen(port)) return true;
    await new Promise((r) => setTimeout(r, 350));
  }
  return false;
}

/** Packaged app: plink.exe next to app.asar under resources/bin (see electron-builder extraResources). */
export function resolvePackagedPlinkPath(): string {
  return path.join(process.resourcesPath, 'bin', 'plink.exe');
}

function appendTunnelLog(line: string): void {
  if (typeof process.resourcesPath !== 'string' || !process.resourcesPath) return;
  const stamp = new Date().toISOString();
  const row = `[${stamp}] ${line}\n`;
  const preferredFile = path.join(process.resourcesPath, 'logs', 'tunnel.log');
  try {
    fs.mkdirSync(path.dirname(preferredFile), { recursive: true });
    fs.appendFileSync(preferredFile, row, 'utf-8');
  } catch {
    try {
      // Fallback when resources/ is read-only (e.g. some Program Files installs).
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const electron = require('electron') as typeof import('electron');
      const fb = path.join(electron.app.getPath('userData'), 'clotex-tunnel.log');
      fs.appendFileSync(fb, row, 'utf-8');
    } catch {
      /* ignore */
    }
  }
}

/**
 * Packaged Windows build only: spawn bundled plink from resources/bin (no ssh2).
 * Command shape: plink -ssh -P <port> -l <user> -pw <pass> -L local:remoteHost:remotePort <host> -N
 */
async function startTunnelPlinkPackagedOnly(cfg: VpsConnectionConfig): Promise<{ stop: () => void }> {
  const exe = resolvePackagedPlinkPath();
  if (!fs.existsSync(exe)) {
    appendTunnelLog(`MISSING ${exe} — copy PuTTY plink.exe into electron/bin before npm run electron:build`);
    throw new Error(
      'النسخة المغلّفة تحتاج plink.exe في resources\\\\bin\\\\ — انسخ plink من PuTTY إلى مجلد electron\\\\bin قبل البناء (راجع electron\\\\bin\\\\README.txt).',
    );
  }

  const forward = `${cfg.localDbPort}:${cfg.remoteDbHost}:${cfg.remoteDbPort}`;
  const rawHostKey = cfg.sshHostKey?.trim() ?? '';
  const normHostKey = rawHostKey ? normalizePlinkHostKeySpec(rawHostKey) : '';
  if (rawHostKey && normHostKey !== rawHostKey) {
    appendTunnelLog('host key: normalized stray bits field (PuTTY expects "alg SHA256:..." without a number between)');
  }
  const args = buildPlinkTunnelArgs(cfg);

  appendTunnelLog(`plink started: ${exe}`);
  appendTunnelLog(
    `args (password hidden): -ssh -batch -P ${cfg.sshPort} -l ${cfg.sshUser} -pw (hidden)${
      normHostKey ? ' -hostkey (set)' : ''
    } -L ${forward} ${cfg.sshHost} -N`,
  );

  const child = spawn(exe, args, {
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe'],
    detached: false,
  });

  let stderrBuf = '';
  child.stderr?.on('data', (d: Buffer) => {
    const chunk = d.toString();
    stderrBuf += chunk;
    const tail = stderrBuf.slice(-2000);
    appendTunnelLog(`plink stderr: ${chunk.trimEnd()}`);
    if (tail.length !== stderrBuf.length) stderrBuf = tail;
  });

  child.on('error', (err) => {
    appendTunnelLog(`plink spawn error: ${err instanceof Error ? err.message : String(err)}`);
  });
  child.on('exit', (code, signal) => {
    appendTunnelLog(`plink exit code=${code === null ? 'null' : code} signal=${signal == null ? '' : String(signal)}`);
  });

  const stop = (): void => {
    try {
      child.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  };

  appendTunnelLog(`waiting for 127.0.0.1:${cfg.localDbPort} (max 20s)`);
  const ok = await waitForPort(cfg.localDbPort, 20_000);
  if (!ok) {
    stop();
    appendTunnelLog('FAILURE: local port did not accept connections within 20s');
    const hint = stderrBuf.trim() ? ` — plink: ${stderrBuf.trim().slice(0, 500)}` : '';
    throw new Error(
      `plink: الممر المحلي لم يفتح خلال 20 ثانية — تحقق من الشبكة أو كلمة مرور SSH أو أضف sshHostKey في الإعداد (راجع tunnel.log).${hint}`,
    );
  }
  appendTunnelLog(`port ${cfg.localDbPort} is listening (TCP connect OK)`);
  return { stop };
}

async function pgPing(databaseUrl: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const pg = await import('pg');
    const pool = new pg.Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 8000 });
    try {
      await pool.query('SELECT 1 AS ok');
      return { ok: true };
    } finally {
      await pool.end();
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

function findPlinkExecutable(cfg: VpsConnectionConfig): string | null {
  if (cfg.plinkPath && fs.existsSync(cfg.plinkPath)) return cfg.plinkPath;
  const besideExe = path.join(path.dirname(process.execPath || ''), 'plink.exe');
  if (fs.existsSync(besideExe)) return besideExe;
  if (process.resourcesPath) {
    const r = path.join(process.resourcesPath, 'plink.exe');
    if (fs.existsSync(r)) return r;
  }
  const common = `${process.env.ProgramFiles}\\PuTTY\\plink.exe`;
  if (fs.existsSync(common)) return common;
  return null;
}

function buildPlinkTunnelArgs(cfg: VpsConnectionConfig): string[] {
  const forward = `${cfg.localDbPort}:${cfg.remoteDbHost}:${cfg.remoteDbPort}`;
  const args: string[] = ['-ssh', '-batch', '-P', String(cfg.sshPort), '-l', cfg.sshUser, '-pw', cfg.sshPassword];
  const rawHostKey = cfg.sshHostKey?.trim() ?? '';
  const normHostKey = rawHostKey ? normalizePlinkHostKeySpec(rawHostKey) : '';
  if (normHostKey) args.push('-hostkey', normHostKey);
  args.push('-L', forward, cfg.sshHost, '-N');
  return args;
}

async function startTunnelPlink(cfg: VpsConnectionConfig): Promise<{ stop: () => void }> {
  const exe = findPlinkExecutable(cfg);
  if (!exe) {
    throw new Error('لم يُعثر على plink.exe — ثبّت PuTTY أو ضع plink.exe بجانب التطبيق أو حدّد plinkPath في الملف.');
  }
  const args = buildPlinkTunnelArgs(cfg);
  const child = spawn(exe, args, {
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr?.on('data', (d: Buffer) => {
    stderr += d.toString();
  });
  const stop = (): void => {
    try {
      child.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  };

  const ok = await waitForPort(cfg.localDbPort, 20_000);
  if (!ok) {
    stop();
    throw new Error(
      stderr.trim() ||
        'plink: الممر المحلي لم يفتح خلال 20 ثانية — تحقق من الشبكة أو كلمة مرور SSH أو sshHostKey',
    );
  }
  return { stop };
}

async function startTunnelSsh2(cfg: VpsConnectionConfig): Promise<{ stop: () => void }> {
  type ClientCtor = typeof import('ssh2').Client;
  let Client: ClientCtor;
  try {
    Client = (await import('ssh2')).Client;
  } catch {
    throw new Error('حزمة ssh2 غير مثبتة — نفّذ npm install في مجلد المشروع');
  }

  const ssh = new Client();
  await new Promise<void>((resolve, reject) => {
    ssh.once('ready', () => resolve());
    ssh.once('error', (err: Error) => reject(err));
    ssh.connect({
      host: cfg.sshHost,
      port: cfg.sshPort,
      username: cfg.sshUser,
      password: cfg.sshPassword,
      readyTimeout: 20_000,
      hostVerifier: () => true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  });

  const server = net.createServer((socket) => {
    ssh.forwardOut(
      socket.remoteAddress ?? '127.0.0.1',
      socket.remotePort ?? 0,
      cfg.remoteDbHost,
      cfg.remoteDbPort,
      (err, stream) => {
        if (err) {
          socket.destroy();
          return;
        }
        socket.pipe(stream as NodeJS.ReadWriteStream).pipe(socket);
      },
    );
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(cfg.localDbPort, '127.0.0.1', () => resolve());
  });

  const stop = (): void => {
    try {
      server.close();
    } catch {
      /* ignore */
    }
    try {
      ssh.end();
    } catch {
      /* ignore */
    }
  };

  return { stop };
}

export async function stopDeliveryTunnel(): Promise<void> {
  if (tunnelStop) {
    tunnelStop();
    tunnelStop = null;
    tunnelStartedByUs = false;
  }
}

/** Kill orphaned LISTEN on local tunnel port (e.g. zombie plink from a prior dev session). */
async function releaseStaleLocalTunnelPort(port: number): Promise<void> {
  if (process.platform === 'win32') {
    try {
      const { execSync } = await import('child_process');
      const script = [
        `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue`,
        '| Select-Object -ExpandProperty OwningProcess -Unique',
        '| ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }',
      ].join(' ');
      execSync(`powershell -NoProfile -Command "${script}"`, { stdio: 'ignore' });
    } catch {
      /* ignore */
    }
    return;
  }
  try {
    const { execSync } = await import('child_process');
    execSync(`fuser -k ${port}/tcp`, { stdio: 'ignore' });
  } catch {
    /* ignore */
  }
}

export function tunnelWasStartedByApp(): boolean {
  return tunnelStartedByUs;
}

export async function ensureDeliveryTunnel(
  cfg: VpsConnectionConfig | null,
  opts?: { packaged?: boolean },
): Promise<{ ok: boolean; databaseUrl?: string; error?: string }> {
  lastTechDetails = '';
  if (!cfg) {
    return { ok: true };
  }

  const databaseUrl = buildDatabaseUrl(cfg);
  const packaged = opts?.packaged === true;

  if (await isTcpPortOpen(cfg.localDbPort)) {
    const ping = await pgPing(databaseUrl);
    if (ping.ok) return { ok: true, databaseUrl };
    // Port open but DB unreachable — stale plink/ssh from a previous session.
    lastTechDetails = ping.error || 'فشل التحقق من PostgreSQL';
    await stopDeliveryTunnel();
    await releaseStaleLocalTunnelPort(cfg.localDbPort);
    await new Promise((r) => setTimeout(r, 400));
  } else {
    await stopDeliveryTunnel();
  }

  try {
    let stopFn: () => void;
    if (packaged) {
      appendTunnelLog('--- ensureDeliveryTunnel (packaged) ---');
      try {
        appendTunnelLog('attempt #1: plink (bundled)');
        const t = await startTunnelPlinkPackagedOnly(cfg);
        stopFn = t.stop;
      } catch (ePlink: unknown) {
        const a = ePlink instanceof Error ? ePlink.message : String(ePlink);
        appendTunnelLog(`plink failed: ${a}`);
        appendTunnelLog('attempt #2: ssh2 (in-process fallback)');
        const t = await startTunnelSsh2(cfg);
        stopFn = t.stop;
      }
    } else {
      const tryPlinkFirst = process.platform === 'win32';
      const startPlink = () => startTunnelPlink(cfg);
      const startSsh2 = () => startTunnelSsh2(cfg);
      try {
        const t = await (tryPlinkFirst ? startPlink() : startSsh2());
        stopFn = t.stop;
      } catch (eFirst: unknown) {
        try {
          const t = await (tryPlinkFirst ? startSsh2() : startPlink());
          stopFn = t.stop;
        } catch (eSecond: unknown) {
          const a = eFirst instanceof Error ? eFirst.message : String(eFirst);
          const b = eSecond instanceof Error ? eSecond.message : String(eSecond);
          lastTechDetails = `${a}\n---\n${b}`;
          return { ok: false, error: 'تعذّر بدء نفق SSH.', databaseUrl };
        }
      }
    }

    tunnelStop = stopFn;
    tunnelStartedByUs = true;

    const ping = await pgPing(databaseUrl);
    if (!ping.ok) {
      lastTechDetails = ping.error || 'فشل الاتصال بقاعدة البيانات بعد النفق';
      if (packaged) appendTunnelLog(`FAILURE after tunnel: ${lastTechDetails}`);
      await stopDeliveryTunnel();
      return { ok: false, error: lastTechDetails, databaseUrl };
    }

    if (packaged) appendTunnelLog('SUCCESS: PostgreSQL ping OK after plink tunnel');
    return { ok: true, databaseUrl };
  } catch (e) {
    await stopDeliveryTunnel();
    const msg = e instanceof Error ? e.message : String(e);
    lastTechDetails = msg;
    if (packaged) appendTunnelLog(`FAILURE: ${msg}`);
    return { ok: false, error: msg, databaseUrl };
  }
}
