import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  Browser,
  computeExecutablePath,
  detectBrowserPlatform,
  getInstalledBrowsers,
  install,
  resolveBuildId,
} from '@puppeteer/browsers';
import type { Browser as PuppeteerBrowser } from 'puppeteer-core';

let sharedBrowser: PuppeteerBrowser | null = null;
let sharedBrowserPromise: Promise<PuppeteerBrowser> | null = null;
let puppeteerChromeInstallPromise: Promise<string | null> | null = null;

function isSnapChromiumExecutable(executablePath: string): boolean {
  if (executablePath.includes('/snap/')) return true;

  try {
    const resolved = fs.realpathSync(executablePath);
    if (resolved.includes('/snap/')) return true;

    const stat = fs.statSync(executablePath);
    if (!stat.isFile()) return false;

    const preview = fs.readFileSync(executablePath, { encoding: 'utf8' }).slice(0, 600);
    if (/snap\/bin\/chromium/i.test(preview)) return true;
  } catch {
    /* ignore unreadable paths */
  }

  return false;
}

function isUsableBrowserExecutable(executablePath: string): boolean {
  if (!executablePath || !fs.existsSync(executablePath)) return false;
  return !isSnapChromiumExecutable(executablePath);
}

export function findChromiumExecutable(): string | null {
  const fromEnv = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    process.env.GOOGLE_CHROME_BIN,
  ]
    .map((value) => value?.trim())
    .find(Boolean);

  if (fromEnv && isUsableBrowserExecutable(fromEnv)) return fromEnv;

  const candidates = [
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/opt/google/chrome/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ];

  return candidates.find((candidate) => isUsableBrowserExecutable(candidate)) ?? null;
}

async function findPuppeteerCachedChrome(): Promise<string | null> {
  const platform = detectBrowserPlatform();
  if (!platform) return null;

  const cacheDir = process.env.PUPPETEER_CACHE_DIR?.trim() || path.join(os.homedir(), '.cache', 'puppeteer');
  const installed = await getInstalledBrowsers({ cacheDir });
  const chrome = installed.find((browser) => browser.browser === Browser.CHROME);
  if (!chrome) return null;

  const executablePath = computeExecutablePath({
    browser: Browser.CHROME,
    platform,
    buildId: chrome.buildId,
    cacheDir,
  });

  return isUsableBrowserExecutable(executablePath) ? executablePath : null;
}

async function ensurePuppeteerChrome(): Promise<string | null> {
  const cached = await findPuppeteerCachedChrome();
  if (cached) return cached;

  if (!puppeteerChromeInstallPromise) {
    puppeteerChromeInstallPromise = (async () => {
      const platform = detectBrowserPlatform();
      if (!platform) return null;

      const cacheDir = process.env.PUPPETEER_CACHE_DIR?.trim() || path.join(os.homedir(), '.cache', 'puppeteer');
      try {
        const buildId = await resolveBuildId(Browser.CHROME, platform, 'stable');
        await install({ browser: Browser.CHROME, buildId, platform, cacheDir });
        const executablePath = computeExecutablePath({
          browser: Browser.CHROME,
          platform,
          buildId,
          cacheDir,
        });
        return isUsableBrowserExecutable(executablePath) ? executablePath : null;
      } catch {
        return null;
      } finally {
        puppeteerChromeInstallPromise = null;
      }
    })();
  }

  return puppeteerChromeInstallPromise;
}

async function resolveChromiumExecutable(): Promise<string> {
  const systemExecutable = findChromiumExecutable();
  if (systemExecutable) return systemExecutable;

  const cachedExecutable = await findPuppeteerCachedChrome();
  if (cachedExecutable) return cachedExecutable;

  const installedExecutable = await ensurePuppeteerChrome();
  if (installedExecutable) return installedExecutable;

  throw new Error(
    'Chromium/Chrome غير متوفر على الخادم لتصدير PDF. ثبّت google-chrome-stable (deb) أو عيّن PUPPETEER_EXECUTABLE_PATH. تجنّب نسخة snap — لا تعمل مع PM2.',
  );
}

const CHROMIUM_LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-software-rasterizer',
  '--disable-extensions',
  '--no-first-run',
  '--no-zygote',
  '--headless=new',
];

async function launchBrowser(): Promise<PuppeteerBrowser> {
  const puppeteer = await import('puppeteer-core');
  const executablePath = await resolveChromiumExecutable();

  return puppeteer.default.launch({
    executablePath,
    headless: true,
    args: CHROMIUM_LAUNCH_ARGS,
  });
}

async function getBrowser(): Promise<PuppeteerBrowser> {
  if (sharedBrowser?.connected) return sharedBrowser;
  if (!sharedBrowserPromise) {
    sharedBrowserPromise = launchBrowser()
      .then((browser) => {
        sharedBrowser = browser;
        browser.on('disconnected', () => {
          sharedBrowser = null;
          sharedBrowserPromise = null;
        });
        return browser;
      })
      .catch((error) => {
        sharedBrowserPromise = null;
        throw error;
      });
  }
  return sharedBrowserPromise;
}

async function waitForDocumentAssets(page: import('puppeteer-core').Page): Promise<void> {
  await page.evaluate(`(() => {
    const waitImages = Array.from(document.images).map((img) => {
      if (img.complete) return Promise.resolve();
      return new Promise((resolve) => {
        img.addEventListener('load', resolve, { once: true });
        img.addEventListener('error', resolve, { once: true });
      });
    });
    const waitFonts = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    return Promise.all([...waitImages, waitFonts]);
  })()`);
}

function isVoucherA5Html(html: string): boolean {
  return /data-clotex-doc\s*=\s*["']voucher-a5["']/.test(html);
}

function isAccountStatementHtml(html: string): boolean {
  return /class\s*=\s*["']stmt-page["']/.test(html);
}

function isInvoiceStatementA4Html(html: string): boolean {
  return /data-clotex-doc\s*=\s*["']invoice-statement-a4["']/.test(html);
}

function resolvePdfViewport(html: string): { width: number; height: number } {
  if (isVoucherA5Html(html)) return { width: 559, height: 794 };
  if (isAccountStatementHtml(html) || isInvoiceStatementA4Html(html)) return { width: 794, height: 1123 };
  return { width: 794, height: 1123 };
}

/** نفس محرك الطباعة (Chromium) — يحترم @page و printBackground */
export async function renderHtmlToPrintPdf(html: string): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  const viewport = resolvePdfViewport(html);

  try {
    await page.setViewport({ ...viewport, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 45_000 });
    await waitForDocumentAssets(page);
    await page.emulateMediaType('print');

    const pdf = await page.pdf({
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });

    return Buffer.from(pdf);
  } finally {
    await page.close().catch(() => undefined);
  }
}
