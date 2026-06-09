/**
 * Web Print Adapter — uses window.open() + window.print().
 * Works in all browsers and in Electron's renderer process (non-silent mode).
 */

import type { PrintAdapter, PrintOptions, PrintResult } from './printAdapters';

export class WebPrintAdapter implements PrintAdapter {
  isAvailable(): boolean {
    return typeof window !== 'undefined' && typeof window.open === 'function';
  }

  async print(html: string, _options?: PrintOptions): Promise<PrintResult> {
    const win = window.open('', '_blank', 'width=900,height=700');
    if (!win) {
      return { ok: false, usedSilent: false, error: 'تعذر فتح نافذة الطباعة. يرجى السماح بالنوافذ المنبثقة.' };
    }
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
}
