import fs from 'node:fs';
import type { Browser } from 'puppeteer-core';

let sharedBrowser: Browser | null = null;
let sharedBrowserPromise: Promise<Browser> | null = null;

export function findChromiumExecutable(): string | null {
  const fromEnv = process.env.PUPPETEER_EXECUTABLE_PATH?.trim();
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;

  const candidates = [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/snap/bin/chromium',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

async function launchBrowser(): Promise<Browser> {
  const puppeteer = await import('puppeteer-core');
  const executablePath = findChromiumExecutable();
  if (!executablePath) {
    throw new Error(
      'Chromium/Chrome غير متوفر على الخادم لتصدير PDF. ثبّت chromium-browser أو عيّن PUPPETEER_EXECUTABLE_PATH.',
    );
  }

  return puppeteer.default.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
}

async function getBrowser(): Promise<Browser> {
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

/** نفس محرك الطباعة (Chromium) — يحترم @page و printBackground */
export async function renderHtmlToPrintPdf(html: string): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 45_000 });
    await page.evaluate(`(() => {
      if (document.fonts && document.fonts.ready) return document.fonts.ready;
    })()`);
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
