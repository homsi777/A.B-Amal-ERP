import { getApiBaseUrl, getStoredToken, ApiRequestError } from './client';

function sanitizeDownloadName(fileName: string): string {
  const trimmed = fileName.trim().replace(/[\\/:*?"<>|]+/g, '_') || 'document.pdf';
  return trimmed.toLowerCase().endsWith('.pdf') ? trimmed : `${trimmed}.pdf`;
}

/** Chromium على الخادم — نفس محرك الطباعة، تطابق 100% مع معاينة الطباعة */
export async function renderDocumentPdfBlob(html: string, fileName = 'document.pdf'): Promise<Blob> {
  const base = getApiBaseUrl();
  if (!base) {
    throw new ApiRequestError('لم يُضبط عنوان خادم CLOTEX API.', 0, { ok: false, code: 'NETWORK' });
  }

  const token = getStoredToken();
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId = controller ? window.setTimeout(() => controller.abort(), 120_000) : null;

  let response: Response;
  try {
    response = await fetch(`${base}/api/documents/render`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ html, fileName: sanitizeDownloadName(fileName) }),
      signal: controller?.signal,
    });
  } finally {
    if (timeoutId != null) window.clearTimeout(timeoutId);
  }

  if (!response.ok) {
    let message = 'تعذر تصدير PDF من الخادم.';
    try {
      const body = (await response.json()) as { message?: string; error?: string };
      message = body.message || body.error || message;
    } catch {
      /* ignore */
    }
    throw new ApiRequestError(message, response.status);
  }

  return response.blob();
}

export function downloadPdfBlob(blob: Blob, fileName: string): void {
  const safeName = sanitizeDownloadName(fileName);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = safeName;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadPrintPdf(html: string, fileName: string): Promise<void> {
  const blob = await renderDocumentPdfBlob(html, fileName);
  downloadPdfBlob(blob, fileName);
}
