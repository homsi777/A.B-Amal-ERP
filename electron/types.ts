/**
 * Shared types for Electron IPC communication.
 * Imported by both main.ts and preload.ts.
 * Must NOT import any browser-only or renderer-only APIs.
 */

// ─── App Settings ─────────────────────────────────────────────────────────────

export interface AppSettings {
  /** Backend API base URL — the ONLY connection credential stored locally */
  apiBaseUrl: string;
  /** Default label printer name for silent printing */
  defaultLabelPrinterName: string | null;
  /** Default A4 printer name */
  defaultA4PrinterName: string | null;
  /** Last used printer name (fallback) */
  lastPrinterName: string | null;
  /** Enable silent label printing — sends directly to defaultLabelPrinterName */
  silentLabelPrintingEnabled: boolean;
  /** Enable silent A4 printing */
  silentA4PrintingEnabled: boolean;
  /** Default label template UUID */
  defaultLabelTemplateId: string | null;
  /** Default print page mode */
  defaultPrintMode: 'A4' | 'A5' | 'ROLL_LABEL';
  /** Default label width in mm */
  labelWidthMm: number;
  /** Default label height in mm */
  labelHeightMm: number;
  /** Last used Excel import folder (for native file picker) */
  lastExcelFolder: string | null;
  /** Last used PDF export folder */
  lastPdfFolder: string | null;
}

export const DEFAULT_SETTINGS: AppSettings = {
  apiBaseUrl: 'http://127.0.0.1:4010',
  defaultLabelPrinterName: null,
  defaultA4PrinterName: null,
  lastPrinterName: null,
  silentLabelPrintingEnabled: false,
  silentA4PrintingEnabled: false,
  defaultLabelTemplateId: null,
  defaultPrintMode: 'ROLL_LABEL',
  labelWidthMm: 100,
  labelHeightMm: 80,
  lastExcelFolder: null,
  lastPdfFolder: null,
};

// ─── Printer info ─────────────────────────────────────────────────────────────

export interface PrinterInfo {
  name: string;
  displayName: string;
  description?: string;
  isDefault: boolean;
  status?: string;
}

// ─── Print options ────────────────────────────────────────────────────────────

export interface ElectronPrintOptions {
  /** Target printer name (required for silent printing) */
  printerName?: string;
  /** If true, suppress the Windows print dialog */
  silent: boolean;
  /** Page size mode */
  pageSize: 'A4' | 'A5' | 'ROLL_LABEL';
  /** Label width in mm — used when pageSize = ROLL_LABEL */
  widthMm?: number;
  /** Label height in mm — used when pageSize = ROLL_LABEL */
  heightMm?: number;
  landscape?: boolean;
  copies?: number;
  printBackground?: boolean;
  /** Chromium print scale (%). Default 100 for label jobs. */
  scaleFactor?: number;
}

export interface ElectronPrintResult {
  ok: boolean;
  printerName?: string;
  usedSilent: boolean;
  error?: string;
}

// ─── PDF options ──────────────────────────────────────────────────────────────

export interface ElectronPdfOptions {
  pageSize: 'A4' | 'A5' | 'ROLL_LABEL';
  widthMm?: number;
  heightMm?: number;
  landscape?: boolean;
  margins?: { top?: number; bottom?: number; left?: number; right?: number };
  defaultFileName?: string;
  outputPath?: string;
}

export interface ElectronPdfResult {
  ok: boolean;
  filePath?: string;
  error?: string;
}

// ─── File picker ──────────────────────────────────────────────────────────────

export interface PickedFileResult {
  filePath: string;
  fileName: string;
  lastFolder: string;
}

export interface ElectronDeviceInfo {
  deviceName: string;
  osInfo: string;
  appVersion: string;
  deviceFingerprint: string;
}

/** Payload sent when renderer loads and when boot state changes (packaged: tunnel + bundled API). */
export interface ElectronBootConnectionInfo {
  packaged: boolean;
  apiBaseUrl: string;
  /**
   * Packaged: bundled Fastify responds on GET /api/health/live (listening; DB may still be down).
   * Dev: GET /api/health returned 200 (includes DB).
   */
  apiHealthOk: boolean;
  apiHealthHttpStatus?: number;
  apiHealthError?: string;
  vpsConfigPath: string | null;
  /** Legacy / optional — remote HTTPS API seed (not primary when Fastify runs locally). */
  hadApiPublicUrlInFile: boolean;
  /** Dev: SSH tunnel begun without blocking startup. Packaged SSH: usually false while tunnel ran before the server. */
  postgresTunnelStartedInBackground: boolean;
  embeddedDbMode: 'missing' | 'ssh_tunnel' | 'direct_public';
  embeddedServerSpawnAttempted: boolean;
  postgresTunnelOk: boolean;
  postgresTunnelError?: string;
  /**
   * Packaged: result of GET /api/health (DB must be up for 200).
   * Undefined if the bundled server was not listening yet / not probed.
   */
  apiDatabaseHealthy?: boolean;
}

// ─── IPC channel names ────────────────────────────────────────────────────────
// Keep in sync between main.ts and preload.ts

export const IPC = {
  GET_SETTINGS:        'fabric:get-settings',
  SET_SETTINGS:        'fabric:set-settings',
  GET_API_URL:         'fabric:get-api-url',
  /** Synchronous read for preload bootstrapping (packaged app API URL before first paint). */
  GET_API_URL_SYNC:    'fabric:get-api-url-sync',
  SET_API_URL:         'fabric:set-api-url',
  GET_VERSION:         'fabric:get-version',
  GET_DEVICE_INFO:     'fabric:get-device-info',
  /** Synchronous snapshot of last boot payload (avoids missing early IPC before React subscribes). */
  GET_BOOT_CONNECTION_INFO_SYNC: 'fabric:get-boot-connection-info-sync',
  LIST_PRINTERS:       'fabric:list-printers',
  PRINT_HTML:          'fabric:print-html',
  PRINT_TO_PDF:        'fabric:print-to-pdf',
  PICK_EXCEL_FILE:     'fabric:pick-excel-file',
  PICK_SAVE_PDF_PATH:  'fabric:pick-save-pdf-path',
  PICK_PDF_FOLDER:     'fabric:pick-pdf-folder',
  RETRY_DELIVERY_TUNNEL: 'fabric:retry-delivery-tunnel',
  GET_DELIVERY_TUNNEL_TECH: 'fabric:get-delivery-tunnel-tech',
} as const;

/** Renderer listens via preload `fabricApp.onBootConnectionInfo`; main sends via `webContents.send`. */
export const BOOT_CONNECTION_INFO_CHANNEL = 'fabric:boot-connection-info' as const;
