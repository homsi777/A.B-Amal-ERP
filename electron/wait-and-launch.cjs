/**
 * Replaces the silent `wait-on ... && electron` chain with a chatty,
 * progress-driven launcher that:
 *
 *   1. Prints a heartbeat every second so the user can SEE that something
 *      is still happening (the previous silent wait made the user press
 *      Ctrl+C every time).
 *   2. Polls the backend health endpoint AND the Vite dev server.
 *   3. Spawns Electron the moment both are reachable.
 *   4. Forwards Electron's stdout/stderr and exit code to the parent.
 *
 * No external deps — only Node built-ins.
 */
'use strict';

const { spawn } = require('node:child_process');
const http = require('node:http');

// Use 127.0.0.1 (not "localhost") so we never depend on the user's DNS
// resolver. On some Windows configurations, "localhost" resolves to ::1
// (IPv6 loopback) before 127.0.0.1, but Fastify binds to IPv4 only — which
// causes the launcher to spin forever waiting for the backend even though
// the server is up and listening.
// ليس /api/health — ذلك يعيد 503 بدون Postgres؛ المطلوب هنا هو «وجود عملية Fastify» فقط
const HEALTH_URL = 'http://127.0.0.1:4010/api/health/live';
const VITE_URL   = 'http://127.0.0.1:3000';
const TIMEOUT_MS = 120_000;
const POLL_MS    = 1_000;

const WHITE = '\x1b[97m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[96m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

function tag() {
  const t = new Date().toISOString().slice(11, 19);
  return `${DIM}${t}${RESET} ${CYAN}[launcher]${RESET}`;
}

function probe(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 1500 }, (res) => {
      // Drain to free socket; any 2xx/3xx counts as "up".
      res.resume();
      resolve(res.statusCode != null && res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function waitFor(label, url) {
  const t0 = Date.now();
  let gavePortHint = false;
  let gaveDbHint = false;
  process.stdout.write(`${tag()} ${YELLOW}waiting${RESET} ${WHITE}${label}${RESET} ${DIM}(${url})${RESET}\n`);
  while (Date.now() - t0 < TIMEOUT_MS) {
    const ok = await probe(url);
    const elapsed = Math.floor((Date.now() - t0) / 1000);
    if (ok) {
      process.stdout.write(`${tag()} ${GREEN}✓ ${label} ready${RESET} ${DIM}after ${elapsed}s${RESET}\n`);
      return;
    }
    process.stdout.write(`${tag()} ${DIM}... still waiting for ${label} (${elapsed}s)${RESET}\n`);
    // Backend: common failure = EADDRINUSE on 4010 while health never comes from our new process
    if (
      label === 'backend' &&
      !gavePortHint &&
      elapsed >= 12 &&
      url.includes(':4010')
    ) {
      gavePortHint = true;
      process.stdout.write(
        `${tag()} ${YELLOW}hint:${RESET} ` +
          `إن سطر [server] يظهر EADDRINUSE فالمنفذ 4010 مشغول — أغلِق EXE أو server قديم، أو نفّذ ` +
          `${WHITE}npm run dev:free-port${RESET}\n`,
      );
    }
    if (
      label === 'backend' &&
      !gaveDbHint &&
      elapsed >= 20
    ) {
      gaveDbHint = true;
      process.stdout.write(
        `${tag()} ${YELLOW}note:${RESET} ` +
          `${WHITE}/api/health${RESET} قد يبقى 503 بدون PostgreSQL؛ التطبيق سيُحمّل. ` +
          `إذا رأيتِ ECONNREFUSED على 5433 فشغّلي نفق SSH أو عدّلي ${WHITE}DATABASE_URL${RESET} في ${WHITE}server/.env${RESET}.\n`,
      );
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  const extra =
    label === 'backend'
      ? ' (تحقّق من سجل [server]: EADDRINUSE؟ ثم npm run dev:free-port أو أوقف Electron المضمّن)'
      : '';
  throw new Error(`${label} did not become ready within ${TIMEOUT_MS / 1000}s${extra}`);
}

async function main() {
  process.stdout.write(`${tag()} ${WHITE}starting full dev environment — please wait, do NOT press Ctrl+C${RESET}\n`);

  await waitFor('backend', HEALTH_URL);
  await waitFor('vite', VITE_URL);

  process.stdout.write(
    `${tag()} ${WHITE}env:${RESET} NODE_ENV=development ELECTRON_DEV=1 VITE_DEV_SERVER_URL=${VITE_URL}\n`,
  );
  process.stdout.write(`${tag()} ${GREEN}launching Electron now${RESET}\n`);

  // `require('electron')` — when called from a regular Node.js process —
  // returns the absolute path to the Electron binary that ships with the
  // installed `electron` npm package. This avoids the Windows
  // `spawn EINVAL` error that occurs when shelling out to `npx.cmd`.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const electronPath = require('electron');
  const env = { ...process.env, NODE_ENV: 'development', ELECTRON_DEV: '1', VITE_DEV_SERVER_URL: VITE_URL };
  // Some shells inherit ELECTRON_RUN_AS_NODE=1 from tooling. If it reaches
  // electron.exe, the main process runs as plain Node and require('electron')
  // returns the binary path instead of Electron APIs.
  delete env.ELECTRON_RUN_AS_NODE;

  const child = spawn(electronPath, ['.'], {
    stdio: 'inherit',
    env,
    shell: false,
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.stdout.write(`${tag()} ${YELLOW}electron stopped by signal ${signal}${RESET}\n`);
      process.exit(0);
    }
    process.exit(code ?? 0);
  });

  // Forward Ctrl+C / SIGTERM cleanly.
  ['SIGINT', 'SIGTERM', 'SIGHUP'].forEach((sig) => {
    process.on(sig, () => {
      try { child.kill(sig); } catch { /* ignore */ }
    });
  });
}

main().catch((err) => {
  process.stderr.write(`${tag()} ${RED}✗ ${err.message}${RESET}\n`);
  process.exit(1);
});
