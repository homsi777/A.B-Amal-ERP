/**
 * Print adapter abstraction layer.
 *
 * Current:  WebPrintAdapter       — window.open + window.print
 * Phase 7:  ElectronPrintAdapter  — IPC → hidden BrowserWindow → webContents.print
 * Phase 8:  ThermalPrintAdapter   — ZPL/EPL via serial/USB (NOT YET)
 */

import { WebPrintAdapter } from './webPrintAdapter';
import { ElectronPrintAdapter } from './electronPrintAdapter';

// ─── Options ─────────────────────────────────────────────────────────────────

/**
 * Page layout mode for a print job:
 *   - 'label'        : one label per physical page (matches widthMm × heightMm)
 *   - 'A4'           : multi-label flow on A4 paper (legacy free-flow layout)
 *   - 'A4_SHEET_6'   : A4 paper with a fixed 2×3 grid (6 labels per sheet) —
 *                      designed for off-the-shelf A4 self-adhesive sticker
 *                      sheets and standard A4 inkjet/laser printers.
 */
export type PrintPageSize = 'label' | 'A4' | 'A4_SHEET_6';

export interface PrintOptions {
  widthMm?: number;
  heightMm?: number;
  /** Layout mode — see PrintPageSize. */
  pageSize?: PrintPageSize;
  /** System printer name (Electron native only) */
  printerName?: string;
  /** Suppress Windows print dialog — requires printerName */
  silent?: boolean;
  copies?: number;
}

// ─── Result ───────────────────────────────────────────────────────────────────

export interface PrintResult {
  ok: boolean;
  /** True if the job bypassed the system print dialog */
  usedSilent: boolean;
  error?: string;
}

// ─── Interface ────────────────────────────────────────────────────────────────

export interface PrintAdapter {
  isAvailable(): boolean;
  print(html: string, options?: PrintOptions): Promise<PrintResult>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** True when running inside the Electron renderer process */
export function isElectronRenderer(): boolean {
  return typeof window !== 'undefined' && window.fabricApp?.isElectron === true;
}

/**
 * True when silent printing is enabled in Electron settings
 * AND a default label printer is configured.
 */
export function canUseSilentLabelPrinting(settings: {
  silentLabelPrintingEnabled?: boolean;
  defaultLabelPrinterName?: string | null;
}): boolean {
  return (
    isElectronRenderer() &&
    settings.silentLabelPrintingEnabled === true &&
    !!settings.defaultLabelPrinterName
  );
}

/** Map Electron's 'A4'/'ROLL_LABEL' page mode to the internal 'A4'/'label' mode */
export function toInternalPageSize(mode: 'A4' | 'ROLL_LABEL'): 'A4' | 'label' {
  return mode === 'A4' ? 'A4' : 'label';
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Returns the best available print adapter for the current environment.
 * Electron: ElectronPrintAdapter (native IPC-based printing).
 * Browser:  WebPrintAdapter (window.open + window.print).
 */
export function getPrintAdapter(): PrintAdapter {
  if (isElectronRenderer()) {
    return new ElectronPrintAdapter();
  }
  return new WebPrintAdapter();
}
