/**
 * Spawn bundled Fastify (single-file server-bundle/index.cjs) using Electron executable as Node (ELECTRON_RUN_AS_NODE=1).
 * JS deps are inlined by esbuild; password hashing uses bundled bcryptjs, not native bcrypt.
 */

import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';
import { app } from 'electron';

let serverChild: ChildProcess | null = null;

export function getServerLogPath(): string {
  return path.join(app.getPath('userData'), 'clotex-server.log');
}

function appendServerLog(line: string): void {
  try {
    fs.mkdirSync(path.dirname(getServerLogPath()), { recursive: true });
    const stamp = new Date().toISOString();
    fs.appendFileSync(getServerLogPath(), `[${stamp}] ${line}\n`, 'utf-8');
  } catch {
    /* ignore */
  }
}

function redactDatabaseUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return '(unparseable DATABASE_URL)';
  }
}

/** Stable JWT secret per workstation — persists in userData, not in installer. */
export function getOrCreateEmbeddedJwtSecret(): string {
  const p = path.join(app.getPath('userData'), 'clotex-jwt-secret.txt');
  try {
    const existing = fs.readFileSync(p, 'utf-8').trim();
    if (existing.length >= 32) return existing;
  } catch {
    /* create */
  }
  const secret = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, secret, 'utf-8');
  return secret;
}

/**
 * Real filesystem path to server entry. Packaged: app.asar.unpacked/server-bundle/index.cjs.
 */
export function resolvedServerMain(): string {
  const bundleBasename = path.join('server-bundle', 'index.cjs');

  if (!app.isPackaged) {
    return path.join(process.cwd(), 'server-bundle', 'index.cjs');
  }

  const viaResources =
    typeof process.resourcesPath === 'string' && process.resourcesPath.trim()
      ? path.join(process.resourcesPath, 'app.asar.unpacked', bundleBasename)
      : '';
  if (viaResources && fs.existsSync(viaResources)) return viaResources;

  const asarRoot = app.getAppPath();
  const unpackedRoot = asarRoot.replace(/app\.asar$/i, 'app.asar.unpacked');
  const unpackedJs = path.join(unpackedRoot, bundleBasename);
  if (fs.existsSync(unpackedJs)) return unpackedJs;
  return path.join(asarRoot, bundleBasename);
}

function skipWindowsExe(name: string): boolean {
  const b = path.basename(name);
  if (/^uninst/i.test(b)) return true;
  const low = b.toLowerCase();
  if (low === 'elevate.exe') return true;
  return false;
}

/** Working directory for the ELECTRON_RUN_AS_NODE child: must be a real directory (DLL neighbours). Never app.asar. */
function embeddedChildCwdPackaged(runnerExe: string): string {
  const exeDir = path.dirname(path.resolve(runnerExe));
  try {
    if (fs.existsSync(exeDir) && fs.statSync(exeDir).isDirectory()) {
      return exeDir;
    }
  } catch {
    /* fall through */
  }
  const res = typeof process.resourcesPath === 'string' ? path.resolve(process.resourcesPath.trim()) : '';
  try {
    if (res && fs.existsSync(res) && fs.statSync(res).isDirectory()) {
      return res;
    }
  } catch {
    /* ignore */
  }
  return path.resolve(process.cwd());
}

/**
 * On some Windows installs process.execPath points at a path that does not exist on disk.
 * Prefer app.getPath('exe') hint from main, then re-anchor basenames under dirname(resources).
 */
function resolveElectronRunnerForNode(electronExePathFromMain?: string): string {
  if (!app.isPackaged) {
    const p = process.execPath;
    appendServerLog(`[runner] dev: packaged=false process.execPath exists=${fs.existsSync(p)} path=${p}`);
    return p;
  }

  appendServerLog('--- embedded Fastify: electron runner diagnostics (packaged) ---');
  appendServerLog(`[runner] app.isPackaged=true`);

  let appExe = '';
  try {
    appExe = app.getPath('exe');
  } catch (e) {
    appendServerLog(`[runner] app.getPath('exe') threw: ${e instanceof Error ? e.message : String(e)}`);
  }

  appendServerLog(`[runner] process.resourcesPath=${process.resourcesPath ?? '(n/a)'}`);
  appendServerLog(`[runner] process.execPath=${process.execPath}`);
  appendServerLog(`[runner] electronExePathFromMain=${electronExePathFromMain?.trim() ?? '(n/a)'}`);
  appendServerLog(`[runner] app.getPath('exe')=${appExe || '(n/a)'}`);

  const hint = electronExePathFromMain?.trim();
  appendServerLog(
    `[runner] exists(electronExePathFromMain)=${hint ? fs.existsSync(path.resolve(hint)) : '(n/a)'}`,
  );
  appendServerLog(`[runner] exists(app.getPath exe)=${appExe ? fs.existsSync(path.resolve(appExe)) : '(n/a)'}`);
  appendServerLog(`[runner] exists(process.execPath)=${fs.existsSync(path.resolve(process.execPath))}`);

  const candidates: string[] = [];
  const pushUnique = (raw?: string | null) => {
    const t = raw?.trim();
    if (!t) return;
    const r = path.resolve(t);
    if (!candidates.includes(r)) candidates.push(r);
  };

  pushUnique(electronExePathFromMain);
  pushUnique(appExe);
  pushUnique(process.execPath);

  const installRoot =
    typeof process.resourcesPath === 'string' && process.resourcesPath.trim()
      ? path.dirname(process.resourcesPath)
      : '';
  appendServerLog(`[runner] installRoot=dirname(resources)=${installRoot || '(n/a)'}`);
  appendServerLog(`[runner] installRoot exists=${installRoot ? fs.existsSync(installRoot) : false}`);

  if (installRoot && fs.existsSync(installRoot)) {
    const basenames = new Set<string>();
    for (const c of candidates) {
      basenames.add(path.basename(c));
    }
    for (const base of basenames) {
      if (base.toLowerCase().endsWith('.exe')) pushUnique(path.join(installRoot, base));
    }

    try {
      const names = fs.readdirSync(installRoot);
      appendServerLog(
        `[runner] exe beside resources folder: ${names.filter((n) => n.endsWith('.exe')).join('; ') || '(none)'}`,
      );
      for (const n of names) {
        if (!n.endsWith('.exe') || skipWindowsExe(n)) continue;
        pushUnique(path.join(installRoot, n));
      }
    } catch (e) {
      appendServerLog(`[runner] readdir installRoot failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  appendServerLog('[runner] ordered candidates / exists:');
  for (const c of candidates) {
    appendServerLog(`[runner]   exists=${fs.existsSync(c)} :: ${c}`);
  }

  const chosen = candidates.find((c) => fs.existsSync(c));
  if (chosen) {
    appendServerLog(`[runner] CHOSEN_EXE=${chosen}`);
    return chosen;
  }

  appendServerLog('[runner] WARN: no exe on disk in list — fallback process.execPath (may ENOENT)');
  return process.execPath;
}

export function isEmbeddedServerRunning(): boolean {
  return !!(serverChild && !serverChild.killed && serverChild.exitCode === null);
}

export function spawnEmbeddedFastify(opts: {
  databaseUrl: string;
  jwtSecret: string;
  port?: number;
  activationKeyPepper?: string;
  telegramBotToken?: string;
  telegramChatId?: string;
  /** From main — app.getPath('exe'); avoids wrong process.execPath on some installs. */
  electronExePathFromMain?: string;
  onFatal?: (reason: string) => void;
}): void {
  if (serverChild && !serverChild.killed && serverChild.exitCode === null) return;

  const serverJs = resolvedServerMain();
  const usesServerBundle = /server-bundle[/\\]index\.cjs$/i.test(serverJs);
  appendServerLog(`[spawn] serverEntry=${serverJs}`);
  appendServerLog(`[spawn] serverEntry exists=${fs.existsSync(serverJs)}`);
  appendServerLog(`[spawn] usesServerBundle=${usesServerBundle}`);
  appendServerLog('[spawn] passwordHashProvider=bcryptjs nativeBcryptUsed=false');

  if (!fs.existsSync(serverJs)) {
    const msg = `missing server entry ${serverJs} — run npm run server:bundle before electron:build`;
    appendServerLog(msg);
    throw new Error(msg);
  }

  const electronCmd = resolveElectronRunnerForNode(opts.electronExePathFromMain);
  appendServerLog(`[spawn] command=${electronCmd} commandExists=${fs.existsSync(electronCmd)}`);

  if (!fs.existsSync(electronCmd)) {
    const msg = `electron runner not found: ${electronCmd}. See clotex-server.log «runner» section for candidates.`;
    appendServerLog(msg);
    throw new Error(msg);
  }

  const port = opts.port ?? 4010;

  const mergedCors =
    process.env.CORS_ORIGIN_EMBEDDED ??
    [
      `http://127.0.0.1:${port}`,
      `http://localhost:${port}`,
      `http://127.0.0.1:3000`,
      'http://localhost:3000',
      'null',
    ].join(',');

  const baseEnv = { ...process.env } as NodeJS.ProcessEnv;
  /** ESM ignores NODE_PATH; avoid inheriting misleading paths in packaged embedded mode unless explicitly debugging */
  const debugNodePath = Boolean(process.env.CLOTEX_DEBUG_EMBEDDED_NODE_PATH?.trim());
  const savedNodePath = typeof baseEnv.NODE_PATH === 'string' ? baseEnv.NODE_PATH : undefined;
  if (app.isPackaged && !debugNodePath) {
    delete baseEnv.NODE_PATH;
  }

  const env = {
    ...baseEnv,
    ELECTRON_RUN_AS_NODE: '1',
    CLOTEX_EMBEDDED_SERVER: '1',
    NODE_ENV: 'production',
    PORT: String(port),
    DATABASE_URL: opts.databaseUrl,
    JWT_SECRET: opts.jwtSecret,
    CORS_ORIGIN: mergedCors,
    APP_BASE_URL: baseEnv.APP_BASE_URL ?? `http://127.0.0.1:${port}`,
    ACTIVATION_REQUIRE_ACTIVE:
      baseEnv.ACTIVATION_REQUIRE_ACTIVE_EMBEDDED ??
      baseEnv.ACTIVATION_REQUIRE_ACTIVE ??
      'true',
    ...(opts.activationKeyPepper ? { ACTIVATION_KEY_PEPPER: opts.activationKeyPepper } : {}),
    ...(opts.telegramBotToken ? { TELEGRAM_BOT_TOKEN: opts.telegramBotToken } : {}),
    ...(opts.telegramChatId ? { TELEGRAM_CHAT_ID: opts.telegramChatId } : {}),
    ...(debugNodePath && savedNodePath ? { NODE_PATH: savedNodePath } : {}),
  };

  const cwd = app.isPackaged ? embeddedChildCwdPackaged(electronCmd) : path.resolve(process.cwd());

  appendServerLog(`[spawn] DATABASE_URL(redacted)=${redactDatabaseUrl(opts.databaseUrl)}`);
  appendServerLog(`[spawn] activationKeyPepperConfigured=${Boolean(opts.activationKeyPepper?.trim())}`);

  appendServerLog(
    `[spawn] cwd=${cwd} cwdIsDirectory=${(() => {
      try {
        return fs.existsSync(cwd) && fs.statSync(cwd).isDirectory();
      } catch {
        return false;
      }
    })()} (packaged installs: beside Clotex-ERP.exe, not resources/app.asar)`,
  );

  appendServerLog(
    `[spawn] spawning Electron-as-Node argv0=${electronCmd} script=${serverJs} port=${port} ${usesServerBundle ? '(server-bundle CJS)' : ''}`,
  );

  appendServerLog(
    `[spawn] diagnostics NODE_PATH propagated=${Boolean(debugNodePath && env.NODE_PATH)} (set CLOTEX_DEBUG_EMBEDDED_NODE_PATH only for debugging)`,
  );

  serverChild = spawn(electronCmd, [serverJs], {
    cwd,
    env,
    windowsHide: true,
    detached: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let firstStdErr = true;
  serverChild.stdout?.on('data', (d: Buffer) =>
    appendServerLog(`[stdout] ${d.toString().trimEnd().slice(-4000)}`),
  );
  serverChild.stderr?.on('data', (d: Buffer) => {
    const text = d.toString();
    if (firstStdErr) {
      firstStdErr = false;
      appendServerLog(`[stderr:first-full]\n${text.trimEnd()}`);
    }
    appendServerLog(`[stderr] ${text.trimEnd().slice(-4000)}`);
  });

  serverChild.once('exit', (code, signal) => {
    appendServerLog(`embedded Fastify exited code=${code} signal=${signal ?? ''}`);
    serverChild = null;
    opts.onFatal?.(`server-exit:${code}:${signal ?? ''}`);
  });

  serverChild.once('error', (err: Error) => {
    appendServerLog(`embedded Fastify spawn error: ${err.message}`);
    serverChild = null;
    opts.onFatal?.(`spawn:${err.message}`);
  });
}

export function stopEmbeddedFastify(): void {
  if (!serverChild) return;
  try {
    serverChild.kill('SIGTERM');
  } catch {
    /* ignore */
  }
  serverChild = null;
  appendServerLog('[main] embedded Fastify stop requested (SIGTERM)');
}
