/**
 * Global Window augmentation for Electron context bridge APIs.
 * window.fabricApp is only defined when running inside Electron.
 * In browser mode, window.fabricApp is undefined.
 */

export interface AppSettings {
  apiBaseUrl: string;
  defaultLabelPrinterName: string | null;
  defaultA4PrinterName: string | null;
  lastPrinterName: string | null;
  silentLabelPrintingEnabled: boolean;
  silentA4PrintingEnabled: boolean;
  defaultLabelTemplateId: string | null;
  defaultPrintMode: 'A4' | 'A5' | 'ROLL_LABEL';
  labelWidthMm: number;
  labelHeightMm: number;
  lastExcelFolder: string | null;
  lastPdfFolder: string | null;
}

export interface PrinterInfo {
  name: string;
  displayName: string;
  description?: string;
  isDefault: boolean;
  status?: string;
}

export interface ElectronPrintOptions {
  printerName?: string;
  silent: boolean;
  pageSize: 'A4' | 'A5' | 'ROLL_LABEL';
  widthMm?: number;
  heightMm?: number;
  landscape?: boolean;
  copies?: number;
  printBackground?: boolean;
  scaleFactor?: number;
}

export interface ElectronPrintResult {
  ok: boolean;
  printerName?: string;
  usedSilent: boolean;
  error?: string;
}

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

/** Startup payload mirrored from electron/types.ts */
export interface ElectronBootConnectionInfo {
  packaged: boolean;
  apiBaseUrl: string;
  apiHealthOk: boolean;
  apiHealthHttpStatus?: number;
  apiHealthError?: string;
  vpsConfigPath: string | null;
  hadApiPublicUrlInFile: boolean;
  postgresTunnelStartedInBackground: boolean;
  embeddedDbMode: 'missing' | 'ssh_tunnel' | 'direct_public';
  embeddedServerSpawnAttempted: boolean;
  postgresTunnelOk: boolean;
  postgresTunnelError?: string;
  /** Packaged: true when GET /api/health returns 200 (Postgres reachable). */
  apiDatabaseHealthy?: boolean;
}

declare global {
  interface Window {
    fabricApp?: {
      readonly isElectron: true;
      /** Persisted API base URL at process start (from main settings JSON); used by getApiBaseUrl() before Vite env. */
      readonly desktopApiBaseAtBoot: string;

      // ── Settings ──────────────────────────────────────────────────────────
      getSettings(): Promise<AppSettings>;
      setSettings(partial: Partial<AppSettings>): Promise<AppSettings>;
      getApiBaseUrl(): Promise<string>;
      setApiBaseUrl(url: string): Promise<string>;
      getVersion(): Promise<string>;
      getDeviceInfo(): Promise<ElectronDeviceInfo>;

      // ── Printers ──────────────────────────────────────────────────────────
      listPrinters(): Promise<PrinterInfo[]>;

      // ── Printing ──────────────────────────────────────────────────────────
      /** Print HTML document — can be silent or with dialog */
      printHtml(html: string, options: ElectronPrintOptions): Promise<ElectronPrintResult>;
      /** Export HTML to PDF and save via native dialog */
      printToPdf(html: string, options: ElectronPdfOptions): Promise<ElectronPdfResult>;

      // ── File pickers ──────────────────────────────────────────────────────
      /** Open native file picker for Excel files */
      pickExcelFile(): Promise<PickedFileResult | null>;
      /** Open native save dialog for PDF export */
      pickSavePdfPath(defaultName?: string): Promise<string | null>;
      /** Open native folder picker for bulk PDF export */
      pickPdfFolder(): Promise<string | null>;

      retryDeliveryTunnel(): Promise<{ ok: boolean; error?: string }>;
      getDeliveryTunnelTechDetails(): Promise<string>;

      /** Boot payload (tunnel + API); includes sync replay of the latest snapshot on subscribe. */
      onBootConnectionInfo(listener: (info: ElectronBootConnectionInfo) => void): () => void;
    };
  }
}
