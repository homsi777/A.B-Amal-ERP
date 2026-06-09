import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import type {IncomingMessage, ServerResponse} from 'http';
import https from 'https';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

const readJsonBody = async (req: IncomingMessage) =>
  new Promise<Record<string, unknown>>((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });

const sendJson = (res: ServerResponse, statusCode: number, payload: Record<string, unknown>) => {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
};

const findBrowserExecutable = () => {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean) as string[];

  return candidates.find((candidate) => fs.existsSync(candidate));
};

const renderPdf = async (html: string) => {
  const puppeteer = await import('puppeteer-core');
  const executablePath = findBrowserExecutable();
  if (!executablePath) {
    throw new Error('No Chrome/Edge executable found for PDF rendering');
  }

  const browser = await puppeteer.default.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, {waitUntil: 'networkidle0'});
    return await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {top: '10mm', right: '10mm', bottom: '10mm', left: '10mm'},
    });
  } finally {
    await browser.close();
  }
};

const postTelegramJson = async (botToken: string, method: string, payload: Record<string, unknown>) => {
  const requestBody = Buffer.from(JSON.stringify(payload), 'utf8');
  const {statusCode, responseBody} = await new Promise<{statusCode: number; responseBody: string}>((resolve, reject) => {
    const request = https.request(
      {
        hostname: 'api.telegram.org',
        path: `/bot${botToken}/${method}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': requestBody.length,
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        response.on('end', () =>
          resolve({
            statusCode: response.statusCode ?? 0,
            responseBody: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );

    request.on('error', reject);
    request.end(requestBody);
  });

  let body: unknown = responseBody;
  try {
    body = JSON.parse(responseBody);
  } catch {
    body = {raw: responseBody};
  }

  return {
    response: {ok: statusCode >= 200 && statusCode < 300},
    body,
  };
};

const sendTelegramDocument = async (botToken: string, chatId: string, pdf: Uint8Array, fileName: string, caption = 'ملف PDF للفاتورة') => {
  const boundary = `----erp-invoice-${Date.now()}`;
  const safeFileName = fileName.replace(/[\r\n"]/g, '_') || 'invoice.pdf';
  const safeCaption = caption.replace(/[\r\n"]/g, ' ').trim() || 'ملف PDF';
  const requestBody = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${safeCaption}\r\n`, 'utf8'),
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="${safeFileName}"\r\nContent-Type: application/pdf\r\n\r\n`,
    ),
    Buffer.from(pdf),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  const {statusCode, responseBody} = await new Promise<{statusCode: number; responseBody: string}>((resolve, reject) => {
    const request = https.request(
      {
        hostname: 'api.telegram.org',
        path: `/bot${botToken}/sendDocument`,
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': requestBody.length,
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        response.on('end', () =>
          resolve({
            statusCode: response.statusCode ?? 0,
            responseBody: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );

    request.on('error', reject);
    request.end(requestBody);
  });

  let body: unknown = responseBody;
  try {
    body = JSON.parse(responseBody);
  } catch {
    body = {raw: responseBody};
  }

  return {
    response: {ok: statusCode >= 200 && statusCode < 300},
    body,
  };
};

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [
      {
        // TODO (المرحلة 7): نقل إرسال تيليغرام بالكامل إلى الـ API الإنتاجي. هذا المسار يعمل فقط مع `vite` في التطوير.
        name: 'telegram-invoice-api',
        configureServer(server) {
          const handleTelegramPdfRequest = async (req: IncomingMessage, res: ServerResponse, defaultFileName: string, defaultCaption: string) => {
            if (req.method !== 'POST') {
              sendJson(res, 405, {ok: false, error: 'Method not allowed'});
              return;
            }

            const botToken = env.TELEGRAM_BOT_TOKEN;
            const chatId = env.TELEGRAM_CHAT_ID;
            if (!botToken || !chatId) {
              sendJson(res, 500, {ok: false, error: 'Telegram env vars are missing'});
              return;
            }

            try {
              const body = await readJsonBody(req);
              const message = typeof body.message === 'string' ? body.message : '';
              const pdfHtml = typeof body.pdfHtml === 'string' ? body.pdfHtml : '';
              const fileName = typeof body.fileName === 'string' ? body.fileName : defaultFileName;
              const caption = typeof body.caption === 'string' ? body.caption : defaultCaption;
              if (!message.trim()) {
                sendJson(res, 400, {ok: false, error: 'Message is required'});
                return;
              }

              const telegramResult = await postTelegramJson(botToken, 'sendMessage', {chat_id: chatId, text: message});
              const telegramBody = telegramResult.body;
              let documentBody = null;
              if (telegramResult.response.ok && pdfHtml.trim()) {
                const pdf = await renderPdf(pdfHtml);
                const documentResult = await sendTelegramDocument(botToken, chatId, pdf, fileName, caption);
                documentBody = documentResult.body;
                if (!documentResult.response.ok) {
                  sendJson(res, 502, {ok: false, telegram: telegramBody, document: documentBody});
                  return;
                }
              }

              sendJson(res, telegramResult.response.ok ? 200 : 502, {
                ok: telegramResult.response.ok,
                telegram: telegramBody,
                document: documentBody,
              });
            } catch (error) {
              sendJson(res, 500, {ok: false, error: error instanceof Error ? error.message : 'Failed to send Telegram message'});
            }
          };

          server.middlewares.use('/api/telegram/invoice', async (req, res) => {
            await handleTelegramPdfRequest(req, res, 'invoice.pdf', 'ملف PDF للفاتورة');
          });

          server.middlewares.use('/api/telegram/statement', async (req, res) => {
            await handleTelegramPdfRequest(req, res, 'statement.pdf', 'ملف PDF لكشف الحساب');
          });
        },
      },
      react(),
      tailwindcss(),
    ],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    // Use relative asset paths so the Vite build can be loaded from
    // Electron's file:// protocol as well as a web server root.
    base: './',
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify; file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
