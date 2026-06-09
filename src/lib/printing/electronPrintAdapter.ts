/**
 * Electron Print Adapter — Phase 7 real implementation.
 *
 * Uses window.fabricApp IPC bridge to:
 *  - Print HTML silently to a named Windows printer (no dialog)
 *  - Print HTML with the Windows dialog (silent=false)
 *  - Export HTML to PDF via native save dialog
 *
 * Phase 8 will add: ESC/POS raw command thermal printing.
 */

import type { PrintAdapter, PrintOptions, PrintResult } from './printAdapters';
import { WebPrintAdapter } from './webPrintAdapter';

export class ElectronPrintAdapter implements PrintAdapter {
  private webAdapter = new WebPrintAdapter();

  isAvailable(): boolean {
    return typeof window !== 'undefined' && window.fabricApp?.isElectron === true;
  }

  async print(html: string, options?: PrintOptions): Promise<PrintResult> {
    if (!window.fabricApp) {
      // Fallback: should not happen, but be safe
      return this.webAdapter.print(html, options);
    }

    const silent = options?.silent ?? false;
    const printerName = options?.printerName;

    // Validate: silent printing requires a printer name
    if (silent && !printerName) {
      return {
        ok: false,
        usedSilent: false,
        error: 'الطباعة الصامتة تتطلب تحديد اسم الطابعة. يرجى تعيين طابعة لصاقات افتراضية في الإعدادات.',
      };
    }

    // Map internal page size to Electron page size.
    // Both 'A4' (legacy free-flow layout) and 'A4_SHEET_6' (2×3 grid sheets)
    // print on physical A4 paper — the layout difference is handled entirely
    // by the CSS inside the HTML document.
    const electronPageSize: 'A4' | 'ROLL_LABEL' =
      options?.pageSize === 'A4' || options?.pageSize === 'A4_SHEET_6'
        ? 'A4'
        : 'ROLL_LABEL';

    const result = await window.fabricApp.printHtml(html, {
      printerName: printerName ?? '',
      silent,
      pageSize: electronPageSize,
      widthMm: options?.widthMm,
      heightMm: options?.heightMm,
      copies: options?.copies ?? 1,
      printBackground: true,
      scaleFactor: electronPageSize === 'ROLL_LABEL' ? 100 : undefined,
    });

    return {
      ok: result.ok,
      usedSilent: result.usedSilent,
      error: result.error,
    };
  }

  /**
   * Export HTML to PDF using Electron's native printToPDF.
   * Shows a native save-file dialog.
   */
  async exportToPdf(
    html: string,
    opts: {
      pageSize?: 'A4' | 'ROLL_LABEL';
      widthMm?: number;
      heightMm?: number;
      defaultFileName?: string;
    } = {},
  ): Promise<PrintResult & { filePath?: string }> {
    if (!window.fabricApp) {
      return { ok: false, usedSilent: false, error: 'تصدير PDF متاح فقط داخل تطبيق Windows' };
    }

    const result = await window.fabricApp.printToPdf(html, {
      pageSize: opts.pageSize ?? 'A4',
      widthMm: opts.widthMm,
      heightMm: opts.heightMm,
      defaultFileName: opts.defaultFileName ?? 'labels.pdf',
    });

    return {
      ok: result.ok,
      usedSilent: false,
      filePath: result.filePath,
      error: result.error,
    };
  }
}
