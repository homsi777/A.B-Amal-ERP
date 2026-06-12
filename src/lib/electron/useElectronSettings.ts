/**
 * useElectronSettings — React hook for reading and writing desktop app settings.
 *
 * In Electron: reads/writes via window.fabricApp IPC bridge (persisted to userData JSON).
 * In Browser:  reads/writes via localStorage (no printer APIs, silent printing disabled).
 */

import { useState, useEffect, useCallback } from 'react';
import type { AppSettings } from '../../electron-env.d';

const STORAGE_KEY = 'obada_erp_desktop_settings_v2';

const BROWSER_DEFAULTS: AppSettings = {
  apiBaseUrl: '',
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

function readLocalStorage(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...BROWSER_DEFAULTS };
    return { ...BROWSER_DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...BROWSER_DEFAULTS };
  }
}

function writeLocalStorage(settings: AppSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch { /* ignore */ }
}

export function useElectronSettings() {
  const isElectron = typeof window !== 'undefined' && !!window.fabricApp?.isElectron;
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isElectron) {
      window.fabricApp!.getSettings()
        .then((s) => { setSettings(s); setLoading(false); })
        .catch(() => { setSettings({ ...BROWSER_DEFAULTS }); setLoading(false); });
    } else {
      setSettings(readLocalStorage());
      setLoading(false);
    }
  }, [isElectron]);

  const updateSettings = useCallback(
    async (partial: Partial<AppSettings>): Promise<AppSettings> => {
      if (isElectron && window.fabricApp) {
        const updated = await window.fabricApp.setSettings(partial);
        setSettings(updated);
        return updated;
      } else {
        const current = settings ?? { ...BROWSER_DEFAULTS };
        const updated = { ...current, ...partial };
        writeLocalStorage(updated);
        setSettings(updated);
        return updated;
      }
    },
    [isElectron, settings],
  );

  return { settings, loading, updateSettings, isElectron };
}
