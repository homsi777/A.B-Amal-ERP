/**
 * autoPrintLabel — fire-and-forget single-label printing helper used by the
 * "auto-print after save" flow in `CreateItem.tsx` and `CreateRoll.tsx`.
 *
 * Behavior:
 *  1. Render the canonical TEXTORIA-style label HTML from the input data
 *     (via `buildSingleRollPrintHtml` in `LabelCard.tsx`).
 *  2. If running inside Electron AND silent label printing is enabled AND
 *     a default label printer is configured → send straight to that printer
 *     with no dialog. The user gets a tactile printer cycle and no UI noise.
 *  3. Otherwise, open a hidden iframe and call `window.print()`. The browser
 *     will show its native print dialog — that is the best we can do outside
 *     of Electron.
 *
 * Intentionally returns a `PrintResult` so the calling page can show a
 * success / failure toast without re-implementing the silent-vs-dialog
 * branching logic.
 */

import {
  buildSingleRollPrintHtml,
  type AdHocLabelInput,
  type LabelConfig,
} from '../../components/labels/LabelCard';
import { ElectronPrintAdapter } from './electronPrintAdapter';
import { generateQrSvg } from './qrGenerator';
import type { AppSettings } from '../../electron-env.d';

export const DEFAULT_LABEL_WIDTH_MM = 80;
export const DEFAULT_LABEL_HEIGHT_MM = 60;

export interface AutoPrintResult {
  ok: boolean;
  /** True if printed silently via Electron with no dialog. */
  silent: boolean;
  /** Printer used, when known. */
  printerName?: string;
  error?: string;
}

export interface AutoPrintOptions {
  input: AdHocLabelInput;
  /** Loaded electron settings; can be null if not yet ready. */
  settings: AppSettings | null;
  /** Optional template overrides — falls back to defaults from settings. */
  widthMm?: number;
  heightMm?: number;
  /** Override label content config (which fields appear, brand, etc.). */
  config?: LabelConfig;
}

/**
 * True when we can send a print job straight to a Windows printer with no
 * dialog. Requires the Electron context AND a saved printer name AND the
 * silent-printing toggle.
 */
function canPrintSilent(settings: AppSettings | null): boolean {
  if (typeof window === 'undefined') return false;
  if (!window.fabricApp?.isElectron)  return false;
  if (!settings?.silentLabelPrintingEnabled) return false;
  if (!settings?.defaultLabelPrinterName)    return false;
  return true;
}

function resolveLabelSize(settings: AppSettings | null, opts: AutoPrintOptions) {
  return {
    widthMm: opts.widthMm ?? settings?.labelWidthMm ?? DEFAULT_LABEL_WIDTH_MM,
    heightMm: opts.heightMm ?? settings?.labelHeightMm ?? DEFAULT_LABEL_HEIGHT_MM,
  };
}

/**
 * Build the print HTML once and dispatch through the right adapter for the
 * current environment. Silent-when-possible, dialog-as-fallback.
 */
export async function autoPrintLabel(opts: AutoPrintOptions): Promise<AutoPrintResult> {
  const { widthMm, heightMm } = resolveLabelSize(opts.settings, opts);
  const inElectron = Boolean(typeof window !== 'undefined' && window.fabricApp?.isElectron);
  const rollLayout = inElectron && widthMm > heightMm ? 'auto' : 'normal';

  let qrSvg = '';
  try {
    qrSvg = await generateQrSvg(opts.input.qrPayload || opts.input.barcode);
  } catch {
    // Continue without a QR — still better than failing the whole print.
  }

  const html = buildSingleRollPrintHtml(opts.input, {
    widthMm,
    heightMm,
    qrSvg,
    config: opts.config,
    rollLayout,
  });

  // ── Silent Electron path ──
  if (canPrintSilent(opts.settings) && window.fabricApp) {
    try {
      const printerName = opts.settings!.defaultLabelPrinterName!;
      const adapter = new ElectronPrintAdapter();
      const res = await adapter.print(html, {
        printerName,
        silent:    true,
        pageSize:  'label',
        widthMm,
        heightMm,
        copies:    1,
      });
      return {
        ok:          res.ok,
        silent:      res.usedSilent,
        printerName,
        error:       res.error,
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Silent print failed';
      return { ok: false, silent: false, error: msg };
    }
  }

  // ── Browser / dialog fallback path ──
  return printHtmlInIframe(html, widthMm, heightMm);
}

/**
 * Renders an HTML document inside a hidden iframe and triggers
 * `iframe.contentWindow.print()`.
 */
function printHtmlInIframe(html: string, widthMm: number, heightMm: number): Promise<AutoPrintResult> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve({ ok: false, silent: false, error: 'document not available' });
      return;
    }

    const iframe = document.createElement('iframe');
    iframe.setAttribute('title', 'label-print');
    iframe.style.position = 'fixed';
    iframe.style.right    = '0';
    iframe.style.bottom   = '0';
    iframe.style.width    = `${widthMm}mm`;
    iframe.style.height   = `${heightMm}mm`;
    iframe.style.border   = '0';
    iframe.style.opacity  = '0';
    iframe.style.pointerEvents = 'none';

    const cleanup = () => {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    };

    const finish = (ok: boolean, error?: string) => {
      setTimeout(() => {
        cleanup();
        resolve({ ok, silent: false, error });
      }, 800);
    };

    const triggerPrint = () => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
        finish(true);
      } catch (e: unknown) {
        cleanup();
        resolve({
          ok: false,
          silent: false,
          error: e instanceof Error ? e.message : 'iframe print failed',
        });
      }
    };

    iframe.onload = () => {
      const doc = iframe.contentWindow?.document;
      const images = doc?.images;
      if (!images?.length) {
        window.setTimeout(triggerPrint, 150);
        return;
      }
      let pending = images.length;
      const done = () => {
        pending -= 1;
        if (pending <= 0) window.setTimeout(triggerPrint, 100);
      };
      for (let i = 0; i < images.length; i += 1) {
        const img = images[i];
        if (img.complete) done();
        else {
          img.addEventListener('load', done, { once: true });
          img.addEventListener('error', done, { once: true });
        }
      }
    };

    document.body.appendChild(iframe);
    const doc = iframe.contentWindow?.document;
    if (!doc) {
      cleanup();
      resolve({ ok: false, silent: false, error: 'iframe has no document' });
      return;
    }
    doc.open();
    doc.write(html);
    doc.close();
  });
}
