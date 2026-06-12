/**
 * Electron Main Process — CLOTEX (Clothes Textile)
 *
 * Security model:
 *  - contextIsolation: true  — preload runs isolated, cannot access renderer
 *  - nodeIntegration: false  — renderer has NO Node.js access
 *  - sandbox: true           — hardened process sandbox
 *  - webSecurity: true       — no mixed content, CSP respected
 *  - Renderer has no VPS/DB secrets; packaged flow passes DATABASE_URL/JWT_SECRET to the child Fastify process only (in-memory).
 *
 * Packaged EXE: embedded Fastify (single-file server-bundle/index.cjs) + local API on 127.0.0.1:4010;
 * Postgres on VPS via SSH/plink tunnel or optional public host (see vps-connection.json).
 */

import { app, BrowserWindow, ipcMain, shell, dialog, session } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';
import {
  AppSettings,
  DEFAULT_SETTINGS,
  IPC,
  BOOT_CONNECTION_INFO_CHANNEL,
  PrinterInfo,
  ElectronPrintOptions,
  ElectronPrintResult,
  ElectronPdfOptions,
  ElectronPdfResult,
  ElectronDeviceInfo,
  PickedFileResult,
  type ElectronBootConnectionInfo,
} from './types';
import {
  ensureDeliveryTunnel,
  stopDeliveryTunnel,
  readVpsLaunchConfig,
  resolveVpsConfigPathsForElectron,
  getLastTunnelTechDetails,
  databaseUrlFromEmbeddedDb,
  type VpsLaunchReadResult,
  type EmbeddedDbInfo,
} from './tunnel/deliveryVpsTunnel';
import {
  spawnEmbeddedFastify,
  stopEmbeddedFastify,
  getOrCreateEmbeddedJwtSecret,
} from './embedded-backend';

app.setAppUserModelId('com.alamal.ab.obada');

function resolveAppIconPath(): string | undefined {
  const candidates = [
    path.join(__dirname, '..', 'build', 'icon.ico'),
    path.join(__dirname, '..', 'dist', 'alamal-logo.png'),
    path.join(process.cwd(), 'build', 'icon.ico'),
    path.join(process.cwd(), 'public', 'alamal-logo.png'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function getElectronExePathHintForEmbedded(): string | undefined {
  try {
    const p = app.getPath('exe');
    const t = typeof p === 'string' ? p.trim() : '';
    return t || undefined;
  } catch {
    return undefined;
  }
}

const isDev =
  process.env.NODE_ENV === 'development' || String(process.env.ELECTRON_DEV ?? '').trim() === '1';
let devApiChild: ChildProcess | null = null;

// In development Vite needs 'unsafe-eval' for HMR; the harmless CSP warning
// from Electron only adds noise to the DevTools console. Suppress it in dev
// so the console stays clean. Production runs with a strict CSP injected
// below in createWindow().
if (isDev) {
  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';
}

console.log(
  `[main] Electron startup — isDev=${isDev} NODE_ENV=${process.env.NODE_ENV ?? '(unset)'} ELECTRON_DEV=${process.env.ELECTRON_DEV ?? '(unset)'}`,
);

// ─── Settings persistence ────────────────────────────────────────────────────

function getSettingsPath(): string {
  return path.join(app.getPath('userData'), 'obada-erp-settings.json');
}

function loadSettings(): AppSettings {
  try {
    const raw = fs.readFileSync(getSettingsPath(), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(settings: AppSettings): void {
  const filePath = getSettingsPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf-8');
}

function getMainLogPath(): string {
  return path.join(app.getPath('userData'), 'clotex-main.log');
}

/** Append line to local troubleshooting log under userData — no secrets here. */
function appendMainLog(line: string): void {
  try {
    const stamp = new Date().toISOString();
    const row = `[${stamp}] ${line}\n`;
    const p = getMainLogPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.appendFileSync(p, row, 'utf-8');
  } catch {
    /* ignore */
  }
  console.log(line);
}

/** Packaged desktop talks to bundled Fastify — never a remote HTTP API in this deployment model. */
const LOCAL_EMBEDDED_API = 'http://127.0.0.1:4030';

function bootstrapPackagedEmbeddedApi(): void {
  if (!app.isPackaged) return;
  const s = loadSettings();
  saveSettings({
    ...s,
    apiBaseUrl: LOCAL_EMBEDDED_API.replace(/\/+$/, ''),
  });
  appendMainLog('[main] packaged: apiBaseUrl locked to bundled Fastify ' + LOCAL_EMBEDDED_API);
}

async function waitForBundledApiListening(maxMs: number): Promise<{ ok: boolean; lastError?: string }> {
  const t0 = Date.now();
  let lastErr: string | undefined;
  while (Date.now() - t0 < maxMs) {
    const h = await probeApiListening(LOCAL_EMBEDDED_API);
    if (h.ok) return { ok: true };
    lastErr = h.error;
    await new Promise((r) => setTimeout(r, 400));
  }
  return { ok: false, lastError: lastErr };
}

function normalizeApiBase(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/** HTTP only — confirms Fastify is bound (does not require Postgres). */
async function probeApiListening(apiBaseUrl: string): Promise<{
  ok: boolean;
  httpStatus?: number;
  error?: string;
}> {
  const base = normalizeApiBase(apiBaseUrl);
  if (!base) {
    return { ok: false, error: 'empty-api-url' };
  }
  const liveUrl = `${base}/api/health/live`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 12000);
  try {
    const response = await fetch(liveUrl, { method: 'GET', signal: ac.signal });
    clearTimeout(timer);
    if (!response.ok) {
      return { ok: false, httpStatus: response.status, error: `live-http-${response.status}` };
    }
    return { ok: true, httpStatus: response.status };
  } catch (e) {
    clearTimeout(timer);
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

async function probeApiHealth(apiBaseUrl: string): Promise<{
  ok: boolean;
  httpStatus?: number;
  error?: string;
}> {
  const base = normalizeApiBase(apiBaseUrl);
  if (!base) {
    return { ok: false, error: 'empty-api-url' };
  }
  const healthUrl = `${base}/api/health`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 12000);
  try {
    const response = await fetch(healthUrl, { method: 'GET', signal: ac.signal });
    clearTimeout(timer);
    if (!response.ok) {
      return { ok: false, httpStatus: response.status, error: `http-${response.status}` };
    }
    return { ok: true, httpStatus: response.status };
  } catch (e) {
    clearTimeout(timer);
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

function embeddedDbMode(embedded: EmbeddedDbInfo | null): 'missing' | 'ssh_tunnel' | 'direct_public' {
  if (!embedded) return 'missing';
  return embedded.kind === 'ssh_tunnel' ? 'ssh_tunnel' : 'direct_public';
}

/** Dev Electron: optional non-blocking SSH tunnel for local Fastify pointing at 127.0.0.1:localDbPort */
function maybeStartDevTunnelBackground(launch: VpsLaunchReadResult): boolean {
  if (app.isPackaged) return false;
  const ed = launch.embeddedDb;
  if (!ed || ed.kind !== 'ssh_tunnel') return false;
  if (ed.config.verifyPostgresViaTunnel === false) {
    appendMainLog('[main] dev tunnel: skipped (verifyPostgresViaTunnel: false)');
    return false;
  }
  appendMainLog('[main] dev tunnel: starting in background (non-blocking)');
  void ensureDeliveryTunnel(ed.config, { packaged: false })
    .then((res) => {
      if (res.ok) appendMainLog('[main] dev tunnel: PostgreSQL ping OK');
      else appendMainLog(`[main] dev tunnel: failed (${res.error ?? ''})`);
    })
    .catch((e) => {
      appendMainLog(`[main] dev tunnel: ${e instanceof Error ? e.message : String(e)}`);
    });
  return true;
}

async function startPackagedEmbeddedStack(launch: VpsLaunchReadResult): Promise<ElectronBootConnectionInfo> {
  /** apiBase يضبَّط في bootstrapPackagedEmbeddedApi() قبل استدعاء هذه الدالة */
  const apiBase = normalizeApiBase(loadSettings().apiBaseUrl || LOCAL_EMBEDDED_API);
  const ed = launch.embeddedDb;

  if (!ed) {
    appendMainLog('[main] packaged: embeddedDb missing — cannot start bundled server');
    return {
      packaged: true,
      apiBaseUrl: apiBase,
      apiHealthOk: false,
      apiHealthError: 'missing-vps-db-config',
      vpsConfigPath: launch.pathUsed,
      hadApiPublicUrlInFile: Boolean(launch.apiPublicUrl),
      postgresTunnelStartedInBackground: false,
      embeddedDbMode: 'missing',
      embeddedServerSpawnAttempted: false,
      postgresTunnelOk: false,
      postgresTunnelError: 'embeddedDb missing in vps-connection.json',
    };
  }

  const mode = embeddedDbMode(ed);
  let postgresTunnelOk = mode !== 'ssh_tunnel';
  let postgresTunnelError: string | undefined;
  let databaseUrl = '';

  if (ed.kind === 'ssh_tunnel') {
    appendMainLog('[main] packaged: establishing SSH tunnel (plink) …');
    const tun = await ensureDeliveryTunnel(ed.config, { packaged: true });
    postgresTunnelOk = tun.ok;
    postgresTunnelError = tun.error;
    databaseUrl = tun.databaseUrl ?? databaseUrlFromEmbeddedDb(ed);
    if (!tun.ok) {
      appendMainLog(`[main] packaged: tunnel failed — ${tun.error ?? ''}`);
      return {
        packaged: true,
        apiBaseUrl: apiBase,
        apiHealthOk: false,
        apiHealthError: `tunnel:${tun.error ?? 'failed'}`,
        vpsConfigPath: launch.pathUsed,
        hadApiPublicUrlInFile: Boolean(launch.apiPublicUrl),
        postgresTunnelStartedInBackground: false,
        embeddedDbMode: 'ssh_tunnel',
        embeddedServerSpawnAttempted: false,
        postgresTunnelOk: false,
        postgresTunnelError: tun.error,
      };
    }
  } else {
    databaseUrl = databaseUrlFromEmbeddedDb(ed);
  }

  appendMainLog('[main] packaged: starting embedded Fastify …');
  let embeddedServerSpawnAttempted = false;
  try {
    spawnEmbeddedFastify({
      databaseUrl,
      jwtSecret: getOrCreateEmbeddedJwtSecret(),
      activationKeyPepper: launch.activationKeyPepper,
      telegramBotToken: launch.telegramBotToken,
      telegramChatId: launch.telegramChatId,
      electronExePathFromMain: getElectronExePathHintForEmbedded(),
    });
    embeddedServerSpawnAttempted = true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    appendMainLog(`[main] packaged: spawn embedded server failed — ${msg}`);
    return {
      packaged: true,
      apiBaseUrl: apiBase,
      apiHealthOk: false,
      apiHealthError: msg,
      vpsConfigPath: launch.pathUsed,
      hadApiPublicUrlInFile: Boolean(launch.apiPublicUrl),
      postgresTunnelStartedInBackground: false,
      embeddedDbMode: mode,
      embeddedServerSpawnAttempted: true,
      postgresTunnelOk,
      postgresTunnelError,
    };
  }

  const listenWait = await waitForBundledApiListening(55_000);
  appendMainLog(
    `[main] bundled API listening ${LOCAL_EMBEDDED_API}/api/health/live: ${listenWait.ok ? 'OK' : `FAIL ${listenWait.lastError ?? ''}`}`,
  );

  let apiDatabaseHealthy: boolean | undefined;
  let apiHealthHttpStatus: number | undefined;
  if (listenWait.ok) {
    const dbProbe = await probeApiHealth(LOCAL_EMBEDDED_API);
    apiDatabaseHealthy = dbProbe.ok;
    apiHealthHttpStatus = dbProbe.httpStatus;
    appendMainLog(
      `[main] bundled DB health ${LOCAL_EMBEDDED_API}/api/health: ${dbProbe.ok ? 'OK (200)' : `FAIL ${dbProbe.error ?? ''}`}`,
    );
  }

  return {
    packaged: true,
    apiBaseUrl: apiBase,
    apiHealthOk: listenWait.ok,
    apiHealthHttpStatus,
    apiHealthError: listenWait.ok ? undefined : listenWait.lastError,
    apiDatabaseHealthy,
    vpsConfigPath: launch.pathUsed,
    hadApiPublicUrlInFile: Boolean(launch.apiPublicUrl),
    postgresTunnelStartedInBackground: false,
    embeddedDbMode: mode,
    embeddedServerSpawnAttempted,
    postgresTunnelOk,
    postgresTunnelError,
  };
}

async function retryPackagedDbTunnelAndEmbeddedServer(): Promise<{ ok: boolean; error?: string }> {
  const launch = readVpsLaunchConfig(resolveVpsConfigPathsForElectron(app));
  const ed = launch.embeddedDb;
  stopEmbeddedFastify();
  await stopDeliveryTunnel();
  appendMainLog('[main] retryDeliveryTunnel: stopped embedded server + tunnel');

  if (!ed) {
    appendMainLog('[main] retry: no embeddedDb in config');
    return { ok: false, error: 'missing-db-config' };
  }

  if (ed.kind === 'direct_public') {
    try {
      spawnEmbeddedFastify({
        databaseUrl: databaseUrlFromEmbeddedDb(ed),
        jwtSecret: getOrCreateEmbeddedJwtSecret(),
        activationKeyPepper: launch.activationKeyPepper,
        telegramBotToken: launch.telegramBotToken,
        telegramChatId: launch.telegramChatId,
        electronExePathFromMain: getElectronExePathHintForEmbedded(),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: msg };
    }
    const w = await waitForBundledApiListening(45_000);
    return w.ok ? { ok: true } : { ok: false, error: w.lastError ?? 'listen-timeout' };
  }

  const tun = await ensureDeliveryTunnel(ed.config, { packaged: true });
  if (!tun.ok || !tun.databaseUrl) {
    return { ok: false, error: tun.error ?? 'tunnel-failed' };
  }

  try {
    spawnEmbeddedFastify({
      databaseUrl: tun.databaseUrl,
      jwtSecret: getOrCreateEmbeddedJwtSecret(),
      activationKeyPepper: launch.activationKeyPepper,
      telegramBotToken: launch.telegramBotToken,
      telegramChatId: launch.telegramChatId,
      electronExePathFromMain: getElectronExePathHintForEmbedded(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }

  const w = await waitForBundledApiListening(45_000);
  return w.ok ? { ok: true } : { ok: false, error: w.lastError ?? 'listen-timeout' };
}

async function startDevLocalApiIfNeeded(): Promise<{ ok: boolean; error?: string }> {
  const current = await probeApiListening(LOCAL_EMBEDDED_API);
  if (current.ok) return { ok: true };

  if (devApiChild && !devApiChild.killed && devApiChild.exitCode === null) {
    const waitExisting = await waitForBundledApiListening(20_000);
    return waitExisting.ok ? { ok: true } : { ok: false, error: waitExisting.lastError ?? 'dev-api-timeout' };
  }

  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  appendMainLog('[main] dev API not listening; spawning npm run server:start');
  try {
    devApiChild = spawn(npmCmd, ['run', 'server:start'], {
      cwd: process.cwd(),
      env: { ...process.env, NODE_ENV: 'development' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    appendMainLog(`[main] dev API spawn failed: ${msg}`);
    return { ok: false, error: msg };
  }

  devApiChild.stdout?.on('data', (chunk: Buffer) => {
    appendMainLog(`[dev-api stdout] ${chunk.toString('utf8').trimEnd()}`);
  });
  devApiChild.stderr?.on('data', (chunk: Buffer) => {
    appendMainLog(`[dev-api stderr] ${chunk.toString('utf8').trimEnd()}`);
  });
  devApiChild.once('exit', (code, signal) => {
    appendMainLog(`[main] dev API exited code=${code} signal=${signal ?? ''}`);
    devApiChild = null;
  });
  devApiChild.once('error', (err) => {
    appendMainLog(`[main] dev API process error: ${err.message}`);
    devApiChild = null;
  });

  const wait = await waitForBundledApiListening(45_000);
  return wait.ok ? { ok: true } : { ok: false, error: wait.lastError ?? 'dev-api-timeout' };
}

function getDeviceIdPath(): string {
  return path.join(app.getPath('userData'), 'fabric-erp-device-id.txt');
}

function getOrCreateDeviceId(): string {
  const filePath = getDeviceIdPath();
  try {
    const existing = fs.readFileSync(filePath, 'utf-8').trim();
    if (existing) return existing;
  } catch {
    // create below
  }
  const id = crypto.randomUUID();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, id, 'utf-8');
  return id;
}

// ─── Print helpers ────────────────────────────────────────────────────────────

/**
 * Write HTML to a temp file and return the file path.
 * Caller must delete the file when done.
 */
function writeTempHtml(html: string): string {
  const tmpPath = path.join(os.tmpdir(), `fabric-print-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
  fs.writeFileSync(tmpPath, html, 'utf-8');
  return tmpPath;
}

function cleanupTemp(tmpPath: string): void {
  try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
}

/** Custom page size for Electron's print() and printToPDF() in micrometers */
interface CustomPageSize {
  width: number;
  height: number;
}

/**
 * Convert mm to Electron's micron unit for custom page sizes.
 * 1 mm = 1000 µm
 */
function mmToMicrons(mm: number): number {
  return Math.round(mm * 1000);
}

function buildElectronPageSize(
  pageSize: 'A4' | 'A5' | 'ROLL_LABEL',
  widthMm?: number,
  heightMm?: number,
): string | CustomPageSize {
  if (pageSize === 'A4') return 'A4';
  if (pageSize === 'A5') return 'A5';
  const w = widthMm ?? 100;
  const h = heightMm ?? 80;
  // Wide roll labels (e.g. 100×80): many thermal drivers ignore Chromium «landscape»
  // and still feed «portrait». Send a portrait physical page (short×long mm) that
  // matches the HTML/CSS swap + rotate() in buildPrintDocument — see LabelCard.tsx.
  if (w > h) {
    return { width: mmToMicrons(h), height: mmToMicrons(w) };
  }
  return { width: mmToMicrons(w), height: mmToMicrons(h) };
}

/**
 * Chromium landscape + custom µm is unreliable on Windows thermal printers.
 * Wide labels use swapped page dimensions + CSS rotate instead; keep landscape off unless explicit.
 */
function resolvePrintLandscape(options: {
  pageSize: 'A4' | 'A5' | 'ROLL_LABEL';
  landscape?: boolean;
  widthMm?: number;
  heightMm?: number;
}): boolean {
  if (options.pageSize === 'A4' || options.pageSize === 'A5') {
    return options.landscape ?? false;
  }
  return options.landscape ?? false;
}

function mapPrintError(failureReason: string): string {
  const map: Record<string, string> = {
    PrintingFailed:   'فشلت عملية الطباعة',
    PrinterNotFound:  'الطابعة غير موجودة أو غير متصلة',
    PrintingCanceled: 'تم إلغاء الطباعة من المستخدم',
    InvalidPrinter:   'اسم الطابعة غير صالح',
  };
  return map[failureReason] ?? `خطأ في الطباعة: ${failureReason}`;
}

/**
 * Create a hidden BrowserWindow, load HTML from a temp file,
 * wait for it to load, then call webContents.print().
 * Cleans up the window and temp file when done.
 */
async function printHtmlInBackground(
  html: string,
  options: ElectronPrintOptions,
): Promise<ElectronPrintResult> {
  let tmpPath: string | null = null;

  return new Promise<ElectronPrintResult>((resolve) => {
    try {
      tmpPath = writeTempHtml(html);
    } catch {
      resolve({ ok: false, usedSilent: options.silent, error: 'فشل إنشاء ملف الطباعة المؤقت' });
      return;
    }

    const printWin = new BrowserWindow({
      show: false,
      width: 1200,
      height: 900,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        javascript: true,
        images: true,
      },
    });

    let settled = false;
    const settle = (result: ElectronPrintResult) => {
      if (settled) return;
      settled = true;
      if (tmpPath) cleanupTemp(tmpPath);
      try { printWin.destroy(); } catch { /* ignore */ }
      resolve(result);
    };

    // Safety timeout (30 s)
    const timeout = setTimeout(() => {
      settle({ ok: false, usedSilent: options.silent, error: 'انتهت مهلة الطباعة (30 ثانية)' });
    }, 30000);

    printWin.webContents.once('did-finish-load', () => {
      // Small delay to allow CSS/fonts to finish rendering
      setTimeout(() => {
        const ps = buildElectronPageSize(options.pageSize, options.widthMm, options.heightMm);
        const isRoll = options.pageSize === 'ROLL_LABEL';
        printWin.webContents.print(
          {
            silent: options.silent,
            deviceName: options.printerName ?? '',
            printBackground: options.printBackground ?? true,
            copies: options.copies ?? 1,
            scaleFactor: isRoll ? (options.scaleFactor ?? 100) : options.scaleFactor,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            pageSize: ps as any,
            landscape: resolvePrintLandscape(options),
            margins: isRoll ? { marginType: 'none' } : undefined,
          },
          (success: boolean, failureReason: string) => {
            clearTimeout(timeout);
            if (success) {
              settle({ ok: true, printerName: options.printerName, usedSilent: options.silent });
            } else {
              settle({ ok: false, printerName: options.printerName, usedSilent: options.silent, error: mapPrintError(failureReason) });
            }
          },
        );
      }, 400);
    });

    printWin.webContents.once('did-fail-load', (_event, _errCode, errDesc) => {
      clearTimeout(timeout);
      settle({ ok: false, usedSilent: options.silent, error: `فشل تحميل مستند الطباعة: ${errDesc}` });
    });

    // Prevent navigation in print window
    printWin.webContents.on('will-navigate', (event) => { event.preventDefault(); });

    printWin.loadFile(tmpPath);
  });
}

/**
 * Export HTML to PDF using Electron's printToPDF.
 */
async function exportHtmlToPdf(
  html: string,
  options: ElectronPdfOptions,
): Promise<ElectronPdfResult> {
  let tmpPath: string | null = null;

  try {
    tmpPath = writeTempHtml(html);
  } catch {
    return { ok: false, error: 'فشل إنشاء ملف PDF المؤقت' };
  }

  const printWin = new BrowserWindow({
    show: false,
    width: 1200,
    height: 900,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });

  try {
    await new Promise<void>((resolve, reject) => {
      printWin.webContents.once('did-finish-load', resolve);
      printWin.webContents.once('did-fail-load', (_e, _c, desc) => reject(new Error(desc)));
      printWin.loadFile(tmpPath!);
      setTimeout(() => reject(new Error('timeout')), 20000);
    });

    // Small delay for rendering
    await new Promise<void>((r) => setTimeout(r, 300));

    const ps = buildElectronPageSize(options.pageSize, options.widthMm, options.heightMm);
    const pdfBuffer = await printWin.webContents.printToPDF({
      printBackground: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pageSize: ps as any,
      landscape: resolvePrintLandscape(options),
      margins: options.pageSize === 'ROLL_LABEL'
        ? { marginType: 'none' }
        : options.margins
        ? {
            marginType: 'custom',
            top: (options.margins.top ?? 10) / 25.4,   // mm → inches
            bottom: (options.margins.bottom ?? 10) / 25.4,
            left: (options.margins.left ?? 10) / 25.4,
            right: (options.margins.right ?? 10) / 25.4,
          }
        : { marginType: 'printableArea' },
    });

    // Ask user where to save
    let filePath = typeof options.outputPath === 'string' ? options.outputPath.trim() : '';
    if (!filePath) {
      const settings = loadSettings();
      const defaultPath = path.join(
        settings.lastPdfFolder ?? app.getPath('documents'),
        options.defaultFileName ?? 'labels.pdf',
      );
      const result = await dialog.showSaveDialog({
        defaultPath,
        filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
      });

      if (result.canceled || !result.filePath) {
      return { ok: false, error: 'تم إلغاء حفظ PDF' };
      }
      filePath = result.filePath;
    }

    if (!filePath.toLowerCase().endsWith('.pdf')) {
      filePath += '.pdf';
    }

    fs.writeFileSync(filePath, pdfBuffer);

    // Persist last folder
    const updated = loadSettings();
    saveSettings({ ...updated, lastPdfFolder: path.dirname(filePath) });

    return { ok: true, filePath };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `فشل تصدير PDF: ${msg}` };
  } finally {
    if (tmpPath) cleanupTemp(tmpPath);
    try { printWin.destroy(); } catch { /* ignore */ }
  }
}

// ─── IPC handlers ────────────────────────────────────────────────────────────

function registerIpcHandlers(): void {
  // Settings
  ipcMain.handle(IPC.GET_SETTINGS, () => loadSettings());

  ipcMain.handle(IPC.SET_SETTINGS, (_event, partial: Partial<AppSettings>) => {
    const updated = { ...loadSettings(), ...partial };
    saveSettings(updated);
    return updated;
  });

  ipcMain.handle(IPC.GET_API_URL, () => loadSettings().apiBaseUrl);

  ipcMain.on(IPC.GET_API_URL_SYNC, (event) => {
    event.returnValue = loadSettings().apiBaseUrl ?? '';
  });

  ipcMain.on(IPC.GET_BOOT_CONNECTION_INFO_SYNC, (event) => {
    event.returnValue = pendingBootInfo;
  });

  ipcMain.handle(IPC.SET_API_URL, (_event, url: string) => {
    const updated = { ...loadSettings(), apiBaseUrl: url.replace(/\/$/, '') };
    saveSettings(updated);
    return updated.apiBaseUrl;
  });

  ipcMain.handle(IPC.GET_VERSION, () => app.getVersion());

  ipcMain.handle(IPC.GET_DEVICE_INFO, (): ElectronDeviceInfo => ({
    deviceName: os.hostname(),
    osInfo: `${os.type()} ${os.release()} ${os.arch()}`,
    appVersion: app.getVersion(),
    deviceFingerprint: getOrCreateDeviceId(),
  }));

  // Printers — use the main window's webContents to enumerate system printers
  ipcMain.handle(IPC.LIST_PRINTERS, async (): Promise<PrinterInfo[]> => {
    const wins = BrowserWindow.getAllWindows();
    const win = wins[0];
    if (!win) return [];
    try {
      const printers = await win.webContents.getPrintersAsync();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (printers as any[]).map((p) => ({
        name: String(p.name ?? ''),
        displayName: String(p.displayName || p.name || ''),
        description: p.description ? String(p.description) : undefined,
        isDefault: Boolean(p.isDefault),
        status: p.status != null ? String(p.status) : undefined,
      }));
    } catch {
      return [];
    }
  });

  // Print HTML
  ipcMain.handle(
    IPC.PRINT_HTML,
    async (_event, html: string, options: ElectronPrintOptions): Promise<ElectronPrintResult> => {
      return printHtmlInBackground(html, options);
    },
  );

  // Export to PDF
  ipcMain.handle(
    IPC.PRINT_TO_PDF,
    async (_event, html: string, options: ElectronPdfOptions): Promise<ElectronPdfResult> => {
      return exportHtmlToPdf(html, options);
    },
  );

  // Native Excel file picker
  ipcMain.handle(IPC.PICK_EXCEL_FILE, async (): Promise<PickedFileResult | null> => {
    const settings = loadSettings();
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Excel Files', extensions: ['xlsx', 'xls'] }],
      defaultPath: settings.lastExcelFolder ?? app.getPath('documents'),
    });
    if (canceled || !filePaths.length) return null;

    const filePath = filePaths[0];
    const lastFolder = path.dirname(filePath);
    const fileName = path.basename(filePath);
    saveSettings({ ...loadSettings(), lastExcelFolder: lastFolder });
    return { filePath, fileName, lastFolder };
  });

  // Save PDF path picker
  ipcMain.handle(
    IPC.PICK_SAVE_PDF_PATH,
    async (_event, defaultName = 'labels.pdf'): Promise<string | null> => {
      const settings = loadSettings();
      const { canceled, filePath } = await dialog.showSaveDialog({
        defaultPath: path.join(settings.lastPdfFolder ?? app.getPath('documents'), defaultName),
        filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
      });
      if (canceled || !filePath) return null;
      saveSettings({ ...loadSettings(), lastPdfFolder: path.dirname(filePath) });
      return filePath;
    },
  );

  ipcMain.handle(IPC.PICK_PDF_FOLDER, async (): Promise<string | null> => {
    const settings = loadSettings();
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: settings.lastPdfFolder ?? app.getPath('documents'),
    });
    if (canceled || !filePaths.length) return null;
    const folderPath = filePaths[0];
    saveSettings({ ...loadSettings(), lastPdfFolder: folderPath });
    return folderPath;
  });

  ipcMain.handle(
    IPC.RETRY_DELIVERY_TUNNEL,
    async (): Promise<{ ok: boolean; error?: string }> => {
      if (app.isPackaged) {
        appendMainLog('[main] IPC retryDeliveryTunnel (packaged: tunnel + embedded server)');
        return retryPackagedDbTunnelAndEmbeddedServer();
      }
      const launch = readVpsLaunchConfig(resolveVpsConfigPathsForElectron(app));
      if (launch.tunnelConfig) {
        const res = await ensureDeliveryTunnel(launch.tunnelConfig, { packaged: false });
        if (!res.ok) return { ok: false, error: res.error };
      }
      return startDevLocalApiIfNeeded();
    },
  );

  ipcMain.handle(IPC.GET_DELIVERY_TUNNEL_TECH, () => getLastTunnelTechDetails());
}

// ─── Browser window ──────────────────────────────────────────────────────────

let cspHeaderAttached = false;
function attachCspHeader(): void {
  // Strict CSP in production only. In dev we rely on Vite's middleware
  // (which needs 'unsafe-eval' for HMR) — the Electron warning is silenced
  // via ELECTRON_DISABLE_SECURITY_WARNINGS at startup.
  if (isDev) return;
  if (cspHeaderAttached) return;
  cspHeaderAttached = true;
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          [
            "default-src 'self'",
            "img-src 'self' data: blob:",
            "font-src 'self' data: https://fonts.gstatic.com",
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
            // Inline theme bootstrap in dist/index.html (fabric-erp-ui-preferences)
            "script-src 'self' 'sha256-eXke8UfeatRaMnqEAcibleUwnrlVgflwzSOrLT/GsfI='",
            "connect-src 'self' http: https: ws: wss: data: blob: http://localhost:* http://127.0.0.1:*",
          ].join('; '),
        ],
      },
    });
  });
}

let mainWindow: BrowserWindow | null = null;
let pendingBootInfo: ElectronBootConnectionInfo | null = null;
let packagedConnectionWatchdog: ReturnType<typeof setInterval> | null = null;
let packagedHealthFailures = 0;
let packagedWatchdogRepairing = false;

/** إعادة إرسال معلومات الإقلاع للواجهة بعد تحديث pendingBootInfo (التطبيق المعبأ). */
function relayBootInfoToRenderer(): void {
  const win = mainWindow;
  if (!win || win.isDestroyed() || !pendingBootInfo) return;
  try {
    win.webContents.send(BOOT_CONNECTION_INFO_CHANNEL, pendingBootInfo);
  } catch {
    /* ignore */
  }
}

function stopPackagedConnectionWatchdog(): void {
  if (!packagedConnectionWatchdog) return;
  clearInterval(packagedConnectionWatchdog);
  packagedConnectionWatchdog = null;
}

function startPackagedConnectionWatchdog(): void {
  if (!app.isPackaged || packagedConnectionWatchdog) return;

  packagedConnectionWatchdog = setInterval(() => {
    if (packagedWatchdogRepairing) return;

    void (async () => {
      const health = await probeApiHealth(LOCAL_EMBEDDED_API);
      if (health.ok) {
        if (packagedHealthFailures > 0) {
          appendMainLog('[main] packaged watchdog: DB health recovered');
        }
        packagedHealthFailures = 0;
        return;
      }

      packagedHealthFailures += 1;
      appendMainLog(
        `[main] packaged watchdog: DB health failed #${packagedHealthFailures} (${health.error ?? health.httpStatus ?? 'unknown'})`,
      );

      if (packagedHealthFailures < 2) return;

      packagedWatchdogRepairing = true;
      appendMainLog('[main] packaged watchdog: restarting SSH tunnel + embedded Fastify');
      try {
        const repair = await retryPackagedDbTunnelAndEmbeddedServer();
        if (!repair.ok) {
          appendMainLog(`[main] packaged watchdog: restart failed (${repair.error ?? 'unknown'})`);
          return;
        }

        const post = await probeApiHealth(LOCAL_EMBEDDED_API);
        packagedHealthFailures = post.ok ? 0 : 1;
        pendingBootInfo = {
          ...(pendingBootInfo ?? {
            packaged: true,
            apiBaseUrl: LOCAL_EMBEDDED_API,
            vpsConfigPath: null,
            hadApiPublicUrlInFile: false,
            postgresTunnelStartedInBackground: false,
            embeddedDbMode: 'ssh_tunnel',
            embeddedServerSpawnAttempted: true,
            postgresTunnelOk: true,
          }),
          apiHealthOk: post.ok,
          apiHealthHttpStatus: post.httpStatus,
          apiHealthError: post.ok ? undefined : post.error,
          apiDatabaseHealthy: post.ok,
          embeddedServerSpawnAttempted: true,
          postgresTunnelOk: post.ok,
        };
        appendMainLog(`[main] packaged watchdog: restart ${post.ok ? 'OK' : `still unhealthy ${post.error ?? ''}`}`);
        relayBootInfoToRenderer();
      } finally {
        packagedWatchdogRepairing = false;
      }
    })();
  }, 30_000);

  appendMainLog('[main] packaged watchdog: enabled (30s DB health probe, auto-restart after 2 failures)');
}

async function startClotexApplication(): Promise<void> {
  const paths = resolveVpsConfigPathsForElectron(app);
  const launch = readVpsLaunchConfig(paths);

  appendMainLog(`[main] clotex start packaged=${app.isPackaged} NODE_ENV=${process.env.NODE_ENV ?? ''}`);
  appendMainLog(`[main] vps paths checked: ${launch.pathsChecked.join(' | ')}`);
  appendMainLog(
    launch.pathUsed
      ? `[main] vps config file resolved: ${launch.pathUsed}`
      : '[main] vps config file: (missing — place vps-connection.json under electron/config before build)',
  );
  if (launch.rawReadError) {
    appendMainLog(`[main] vps config parse/read error: ${launch.rawReadError}`);
  }

  appendMainLog(`[main] optional apiPublicUrl in JSON (not primary for bundled API): ${Boolean(launch.apiPublicUrl)}`);
  appendMainLog(`[main] activationKeyPepper configured: ${Boolean(launch.activationKeyPepper)}`);

  if (app.isPackaged) {
    /** نفتح النافذة فوراً ثم نضبط النفق/الخادم — كانت الانتظار تُخفي التطبيق دقيقة+ فظن المستخدم أنه لا يعمل */
    bootstrapPackagedEmbeddedApi();
    const apiBaseEarly = normalizeApiBase(loadSettings().apiBaseUrl || LOCAL_EMBEDDED_API);
    pendingBootInfo = {
      packaged: true,
      apiBaseUrl: apiBaseEarly,
      apiHealthOk: false,
      apiHealthError: 'starting-backend',
      vpsConfigPath: launch.pathUsed,
      hadApiPublicUrlInFile: Boolean(launch.apiPublicUrl),
      postgresTunnelStartedInBackground: false,
      embeddedDbMode: embeddedDbMode(launch.embeddedDb),
      embeddedServerSpawnAttempted: false,
      postgresTunnelOk: false,
    };
    createMainWindow();
    try {
      pendingBootInfo = await startPackagedEmbeddedStack(launch);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      appendMainLog(`[main] startPackagedEmbeddedStack error: ${msg}`);
      pendingBootInfo = {
        packaged: true,
        apiBaseUrl: apiBaseEarly,
        apiHealthOk: false,
        apiHealthError: msg,
        vpsConfigPath: launch.pathUsed,
        hadApiPublicUrlInFile: Boolean(launch.apiPublicUrl),
        postgresTunnelStartedInBackground: false,
        embeddedDbMode: embeddedDbMode(launch.embeddedDb),
        embeddedServerSpawnAttempted: false,
        postgresTunnelOk: false,
      };
    }
    appendMainLog(
      `[main] packaged boot: postgresTunnelOk=${pendingBootInfo.postgresTunnelOk} embeddedSpawnAttempted=${pendingBootInfo.embeddedServerSpawnAttempted} apiListeningOk=${pendingBootInfo.apiHealthOk} apiDatabaseHealthy=${pendingBootInfo.apiDatabaseHealthy}`,
    );
    appendMainLog(
      `[main] probes ${pendingBootInfo.apiBaseUrl ? `${pendingBootInfo.apiBaseUrl}/api/health/live` : '(no-url)'} → ${pendingBootInfo.apiHealthOk ? 'listen-OK' : `listen-FAIL ${pendingBootInfo.apiHealthError ?? ''}`}; ${pendingBootInfo.apiBaseUrl ? `${pendingBootInfo.apiBaseUrl}/api/health` : ''} DB=${pendingBootInfo.apiDatabaseHealthy === undefined ? '(n/a)' : pendingBootInfo.apiDatabaseHealthy ? 'OK' : 'FAIL'}`,
    );
    startPackagedConnectionWatchdog();
    relayBootInfoToRenderer();
    return;
  } else {
    const tunnelBg = maybeStartDevTunnelBackground(launch);
    const apiBase =
      normalizeApiBase(loadSettings().apiBaseUrl || '') ||
      LOCAL_EMBEDDED_API.replace(/\/+$/, '');
    appendMainLog(`[main] dev stored apiBaseUrl (no secrets): ${apiBase || '(empty)'}`);
    const health = await probeApiHealth(apiBase);
    const mode = embeddedDbMode(launch.embeddedDb);

    pendingBootInfo = {
      packaged: false,
      apiBaseUrl: apiBase,
      apiHealthOk: health.ok,
      apiHealthHttpStatus: health.httpStatus,
      apiHealthError: health.error,
      vpsConfigPath: launch.pathUsed,
      hadApiPublicUrlInFile: Boolean(launch.apiPublicUrl),
      postgresTunnelStartedInBackground: tunnelBg,
      embeddedDbMode: mode,
      embeddedServerSpawnAttempted: false,
      postgresTunnelOk: true,
    };
  }

  appendMainLog(
    `[main] probe ${pendingBootInfo.apiBaseUrl ? `${pendingBootInfo.apiBaseUrl}/api/health` : '(no-url)'}: ${pendingBootInfo.apiHealthOk ? 'OK' : `FAIL ${pendingBootInfo.apiHealthError ?? ''}`}`,
  );

  createMainWindow();
}

function createMainWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) return;
  attachCspHeader();
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1200,
    minHeight: 760,
    icon: resolveAppIconPath(),
    title: 'ALamal-AB · الامل.AB — نظام إدارة جملة الأقمشة',
    /** في الإنتاج المعبأ تظهر النافذة مبكراً؛ في التطوير ننتظر الجاهزية لتجنب وميض فاضِ */
    show: !isDev,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  // Safety net: always show the window even if `ready-to-show` never fires.
  // Some Vite startup edge cases (slow HMR boot, renderer error before paint)
  // can suppress the event and leave the user staring at a black screen.
  let shown = false;
  const showOnce = (reason: string) => {
    if (shown) return;
    shown = true;
    try {
      win.show();
      win.focus();
      console.log(`[main] window shown (${reason})`);
    } catch (err) {
      console.error('[main] win.show() failed:', err);
    }
    if (isDev) {
      try { win.webContents.openDevTools({ mode: 'detach' }); } catch { /* ignore */ }
    }
  };

  win.once('ready-to-show', () => showOnce('ready-to-show'));
  win.webContents.once('did-finish-load', () => {
    showOnce('did-finish-load');
    relayBootInfoToRenderer();
  });
  setTimeout(() => showOnce('safety-timeout-8s'), 8000);

  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    const line = `[main] did-fail-load url=${validatedURL} code=${errorCode} ${errorDescription}`;
    console.error(line);
    appendMainLog(line);
    showOnce('did-fail-load');
  });

  win.on('unresponsive', () => console.warn('[main] window became unresponsive'));
  win.webContents.on('render-process-gone', (_e, details) =>
    console.error('[main] render-process-gone:', details),
  );

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    const allowed = isDev
      ? (url.startsWith('http://localhost:') || url.startsWith('http://127.0.0.1:'))
      : url.startsWith('file://');
    if (!allowed) event.preventDefault();
  });

  mainWindow = win;
  win.on('closed', () => {
    mainWindow = null;
  });

  // Use 127.0.0.1 instead of "localhost" so the renderer never depends on
  // the user's DNS resolver (some Windows setups resolve localhost to ::1
  // first, but Vite binds to IPv4 only).
  const devServerUrl = normalizeApiBase(
    process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:3000',
  );
  const targetUrl = isDev
    ? devServerUrl
    : `file://${path.join(__dirname, '../dist/index.html')}`;
  if (isDev) {
    appendMainLog(`[main] dev: loading renderer from ${devServerUrl}`);
    appendMainLog(`[main] dev: API expected at ${LOCAL_EMBEDDED_API} (Fastify from npm run dev:server)`);
    console.log(`[main] dev renderer URL: ${devServerUrl}`);
    console.log(`[main] dev API URL: ${LOCAL_EMBEDDED_API}`);
  }
  console.log(`[main] loading: ${targetUrl}`);
  if (isDev) {
    win.loadURL(targetUrl).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      appendMainLog(`[main] loadURL failed: ${msg}`);
      console.error('[main] loadURL failed:', err);
    });
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html')).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      appendMainLog(`[main] loadFile failed: ${msg}`);
      console.error('[main] loadFile failed:', err);
    });
  }
}

// ─── App lifecycle ───────────────────────────────────────────────────────────

console.log(`[main] booting Electron — mode=${isDev ? 'development' : 'production'} pid=${process.pid}`);

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  // إطار رسالة بدل الخروج الصامت — يصدِّق المستخدم أن التطبيق «لم يفتح»
  void app
    .whenReady()
    .then(() =>
      dialog.showMessageBoxSync({
        type: 'info',
        title: 'CLOTEX',
        message: 'تطبيق CLOTEX يعمل بالفعل',
        detail:
          'هناك نسخة أخرى مفتوحة. أغلقها من شريط المهام أو «إنهاء المهمة» ثم حاول مجدداً.',
      }),
    )
    .finally(() => app.quit());
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    appendMainLog('[main] app.whenReady — IPC register + startup');
    console.log('[main] app ready — registering IPC handlers');
    try {
      registerIpcHandlers();
    } catch (regErr) {
      const m = regErr instanceof Error ? regErr.message : String(regErr);
      appendMainLog(`[main] registerIpcHandlers failed: ${m}`);
      pendingBootInfo = {
        packaged: app.isPackaged,
        apiBaseUrl: LOCAL_EMBEDDED_API.replace(/\/+$/, ''),
        apiHealthOk: false,
        apiHealthError: m,
        vpsConfigPath: null,
        hadApiPublicUrlInFile: false,
        postgresTunnelStartedInBackground: false,
        embeddedDbMode: 'missing',
        embeddedServerSpawnAttempted: false,
        postgresTunnelOk: false,
      };
      createMainWindow();
      return;
    }
    try {
      await startClotexApplication();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      appendMainLog(`[main] startClotexApplication error: ${msg}`);
      console.error('[main] startClotexApplication failed:', e);
      createMainWindow();
    }
  }).catch((err) => {
    console.error('[main] app.whenReady() failed:', err);
    appendMainLog(`[main] app.whenReady failed: ${err instanceof Error ? err.message : String(err)}`);
    try {
      registerIpcHandlers();
    } catch {
      /* ignore duplicate */
    }
    pendingBootInfo = {
      packaged: app.isPackaged,
      apiBaseUrl: LOCAL_EMBEDDED_API.replace(/\/+$/, ''),
      apiHealthOk: false,
      apiHealthError: err instanceof Error ? err.message : String(err),
      vpsConfigPath: null,
      hadApiPublicUrlInFile: false,
      postgresTunnelStartedInBackground: false,
      embeddedDbMode: 'missing',
      embeddedServerSpawnAttempted: false,
      postgresTunnelOk: false,
    };
    createMainWindow();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void startClotexApplication().catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        appendMainLog(`[main] activate startClotexApplication error: ${msg}`);
        createMainWindow();
      });
    }
  });

  app.on('before-quit', () => {
    appendMainLog('[main] before-quit: stopping embedded Fastify (if any) and SSH tunnel (if any)');
    stopPackagedConnectionWatchdog();
    stopEmbeddedFastify();
    if (devApiChild && !devApiChild.killed) {
      try {
        devApiChild.kill('SIGTERM');
        appendMainLog('[main] before-quit: stopping dev API child');
      } catch {
        /* ignore */
      }
      devApiChild = null;
    }
    void stopDeliveryTunnel();
  });

  app.on('window-all-closed', () => {
    console.log('[main] window-all-closed — quitting');
    if (process.platform !== 'darwin') app.quit();
  });
}
