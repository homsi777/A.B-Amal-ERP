/**
 * Web Print Adapter — uses window.open() + window.print(), with an iframe
 * fallback when popups are blocked (common on mobile Safari / in-app browsers).
 */

import type { PrintAdapter, PrintOptions, PrintResult } from './printAdapters';

function waitForIframeLoad(iframe: HTMLIFrameElement): Promise<void> {
  return new Promise((resolve, reject) => {
    iframe.onload = () => resolve();
    iframe.onerror = () => reject(new Error('تعذر تحميل مستند الطباعة'));
    iframe.srcdoc = iframe.getAttribute('data-srcdoc') ?? '';
  });
}

async function printViaHiddenIframe(html: string): Promise<PrintResult> {
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.left = '-10000px';
  iframe.style.top = '0';
  iframe.style.width = '1200px';
  iframe.style.height = '1800px';
  iframe.style.opacity = '1';
  iframe.style.pointerEvents = 'none';
  iframe.setAttribute('aria-hidden', 'true');
  iframe.setAttribute('data-srcdoc', html);
  document.body.appendChild(iframe);

  try {
    await waitForIframeLoad(iframe);
    await new Promise<void>((resolve) => setTimeout(resolve, 500));
    const win = iframe.contentWindow;
    if (!win) {
      return { ok: false, usedSilent: false, error: 'تعذر فتح نافذة الطباعة داخل المتصفح.' };
    }
    win.focus();
    win.print();
    await new Promise<void>((resolve) => setTimeout(resolve, 1500));
    return { ok: true, usedSilent: false };
  } finally {
    iframe.remove();
  }
}

export class WebPrintAdapter implements PrintAdapter {
  isAvailable(): boolean {
    return typeof window !== 'undefined' && typeof window.print === 'function';
  }

  async print(html: string, _options?: PrintOptions): Promise<PrintResult> {
    const win = window.open('', '_blank', 'width=900,height=700');
    if (win) {
      win.document.write(html);
      win.document.close();
      win.focus();
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          win.print();
          resolve();
        }, 600);
      });
      return { ok: true, usedSilent: false };
    }

    try {
      return await printViaHiddenIframe(html);
    } catch (e: unknown) {
      const message = (e as { message?: string }).message ?? 'تعذر فتح نافذة الطباعة. يرجى السماح بالنوافذ المنبثقة.';
      return { ok: false, usedSilent: false, error: message };
    }
  }
}
