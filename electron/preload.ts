/**
 * Electron Preload Script — Context Bridge
 *
 * Exposes a WHITELIST of safe APIs to the renderer (React app) via
 * window.fabricApp. The renderer has NO direct Node.js access.
 *
 * Security rules:
 *  - contextIsolation: true — this script runs isolated from the renderer
 *  - sandbox: true          — only Electron module is requireable here
 *  - Only expose what is explicitly needed
 *  - No database credentials
 *  - No direct filesystem paths exposed to renderer
 *  - No eval, no remote module
 *
 * IMPORTANT: preload runs with sandbox:true — لا يُحمَّل `./types` في وقت التشغيل (يفشل require).
 * أبقِ import type من ./types فقط، وأي ثابت يلزم ينسخ هنا كنص مطابق لـ electron/types.ts.
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

const BOOT_CONNECTION_INFO_CHANNEL = 'fabric:boot-connection-info' as const;

/** Sync read persisted API URL before first React paint (see main IPC.GET_API_URL_SYNC). */
function readDesktopApiBaseAtBoot(): string {
  try {
    const v = ipcRenderer.sendSync('fabric:get-api-url-sync') as unknown;
    return typeof v === 'string' ? v.replace(/\/$/, '').trim() : '';
  } catch {
    return '';
  }
}

const desktopApiBaseAtBoot = readDesktopApiBaseAtBoot();
import type {
  AppSettings,
  PrinterInfo,
  ElectronPrintOptions,
  ElectronPrintResult,
  ElectronPdfOptions,
  ElectronPdfResult,
  ElectronDeviceInfo,
  PickedFileResult,
  ElectronBootConnectionInfo,
} from './types';

// IPC channel names — kept in sync with electron/types.ts and electron/main.ts.
// Inlined here on purpose: a sandboxed preload cannot `require('./types')`.
const IPC = {
  GET_SETTINGS:        'fabric:get-settings',
  SET_SETTINGS:        'fabric:set-settings',
  GET_API_URL:         'fabric:get-api-url',
  GET_API_URL_SYNC:    'fabric:get-api-url-sync',
  GET_BOOT_CONNECTION_INFO_SYNC: 'fabric:get-boot-connection-info-sync',
  SET_API_URL:         'fabric:set-api-url',
  GET_VERSION:         'fabric:get-version',
  GET_DEVICE_INFO:     'fabric:get-device-info',
  LIST_PRINTERS:       'fabric:list-printers',
  PRINT_HTML:          'fabric:print-html',
  PRINT_TO_PDF:        'fabric:print-to-pdf',
  PICK_EXCEL_FILE:     'fabric:pick-excel-file',
  PICK_SAVE_PDF_PATH:  'fabric:pick-save-pdf-path',
  PICK_PDF_FOLDER:     'fabric:pick-pdf-folder',
  RETRY_DELIVERY_TUNNEL: 'fabric:retry-delivery-tunnel',
  GET_DELIVERY_TUNNEL_TECH: 'fabric:get-delivery-tunnel-tech',
} as const;

contextBridge.exposeInMainWorld('fabricApp', {
  /** Detect that we are running inside Electron */
  isElectron: true as const,

  /** API base URL from desktop settings at app boot (sync); used before async getSettings(). */
  desktopApiBaseAtBoot,

  // ── Settings ──────────────────────────────────────────────────────────────

  getSettings: (): Promise<AppSettings> =>
    ipcRenderer.invoke(IPC.GET_SETTINGS),

  setSettings: (partial: Partial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke(IPC.SET_SETTINGS, partial),

  getApiBaseUrl: (): Promise<string> =>
    ipcRenderer.invoke(IPC.GET_API_URL),

  setApiBaseUrl: (url: string): Promise<string> =>
    ipcRenderer.invoke(IPC.SET_API_URL, url),

  getVersion: (): Promise<string> =>
    ipcRenderer.invoke(IPC.GET_VERSION),

  getDeviceInfo: (): Promise<ElectronDeviceInfo> =>
    ipcRenderer.invoke(IPC.GET_DEVICE_INFO),

  // ── Printers ──────────────────────────────────────────────────────────────

  /** List all system printers available on this Windows machine */
  listPrinters: (): Promise<PrinterInfo[]> =>
    ipcRenderer.invoke(IPC.LIST_PRINTERS),

  // ── Printing ──────────────────────────────────────────────────────────────

  /**
   * Print HTML to a physical printer.
   * Set silent=true and printerName for silent label printing.
   * Set silent=false to show the Windows print dialog.
   */
  printHtml: (html: string, options: ElectronPrintOptions): Promise<ElectronPrintResult> =>
    ipcRenderer.invoke(IPC.PRINT_HTML, html, options),

  /**
   * Export HTML to PDF and save via native save dialog.
   */
  printToPdf: (html: string, options: ElectronPdfOptions): Promise<ElectronPdfResult> =>
    ipcRenderer.invoke(IPC.PRINT_TO_PDF, html, options),

  // ── File pickers ──────────────────────────────────────────────────────────

  /** Open native Excel file picker dialog */
  pickExcelFile: (): Promise<PickedFileResult | null> =>
    ipcRenderer.invoke(IPC.PICK_EXCEL_FILE),

  /** Open native save dialog to pick a PDF save path */
  pickSavePdfPath: (defaultName?: string): Promise<string | null> =>
    ipcRenderer.invoke(IPC.PICK_SAVE_PDF_PATH, defaultName),

  /** Open native folder picker for bulk PDF export */
  pickPdfFolder: (): Promise<string | null> =>
    ipcRenderer.invoke(IPC.PICK_PDF_FOLDER),

  retryDeliveryTunnel: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.RETRY_DELIVERY_TUNNEL),

  getDeliveryTunnelTechDetails: (): Promise<string> =>
    ipcRenderer.invoke(IPC.GET_DELIVERY_TUNNEL_TECH),

  /**
   * Boot payload from main (tunnel + bundled API). Subscribes to updates and replays
   * the latest snapshot immediately so React never misses an early send.
   */
  onBootConnectionInfo: (listener: (info: ElectronBootConnectionInfo) => void): (() => void) => {
    const channel = BOOT_CONNECTION_INFO_CHANNEL;
    const wrapped = (_e: IpcRendererEvent, payload: ElectronBootConnectionInfo) => listener(payload);
    ipcRenderer.on(channel, wrapped);
    try {
      const snap = ipcRenderer.sendSync(IPC.GET_BOOT_CONNECTION_INFO_SYNC) as ElectronBootConnectionInfo | null | undefined;
      if (snap && typeof snap === 'object') listener(snap);
    } catch {
      /* ignore */
    }
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
});
