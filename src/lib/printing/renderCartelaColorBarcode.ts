import { buildCode128Svg } from './renderCartelaLabel';
import type { CartelaColorPrintSettings } from '../cartela/cartelaColorPrintSettings';
import {
  DEFAULT_CARTELA_COLOR_PRINT_SETTINGS,
  stripPageHeightMm,
  stripPageWidthMm,
} from '../cartela/cartelaColorPrintSettings';

export const CARTELA_COLOR_STICKER_WIDTH_MM = 25;
export const CARTELA_COLOR_STICKER_HEIGHT_MM = 15;
export const CARTELA_COLOR_CODE_FONT_PT = 7;

export type CartelaColorStickerCell = {
  barcodeCode: string;
  displayCode: string;
  subtitle?: string;
};

export type CartelaColorStickerData = CartelaColorStickerCell & {
  widthMm?: number;
  heightMm?: number;
  codeFontPt?: number;
  barcodeHeightMm?: number;
  settings?: CartelaColorPrintSettings;
};

const esc = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function resolveStickerMetrics(data: CartelaColorStickerData, settings: CartelaColorPrintSettings) {
  return {
    widthMm: data.widthMm ?? settings.cellWidthMm,
    heightMm: data.heightMm ?? settings.cellHeightMm,
    codeFontPt: data.codeFontPt ?? settings.codeFontPt,
    barcodeHeightMm: data.barcodeHeightMm ?? settings.barcodeHeightMm,
  };
}

function buildCellInner(cell: CartelaColorStickerCell | null, metrics: ReturnType<typeof resolveStickerMetrics>): string {
  if (!cell?.barcodeCode?.trim()) {
    return `<div class="cell cell-empty"></div>`;
  }
  const barcode = cell.barcodeCode.trim();
  const barcodeSvg = buildCode128Svg(barcode, Math.round(metrics.barcodeHeightMm * 3.78));
  const subtitle = cell.subtitle?.trim()
    ? `<div class="name">${esc(cell.subtitle)}</div>`
    : '';
  return `<div class="cell">
    <div class="bc-wrap">
      ${barcodeSvg ? `<div class="bc-svg">${barcodeSvg}</div>` : ''}
      <div class="code" dir="ltr">${esc(cell.displayCode || barcode)}</div>
      ${subtitle}
    </div>
  </div>`;
}

function buildStripCss(settings: CartelaColorPrintSettings, pageWidthMm: number, pageHeightMm: number): string {
  const { cellWidthMm, cellHeightMm, gapMm, codeFontPt } = settings;
  return `
    @page { size: ${pageWidthMm}mm ${pageHeightMm}mm; margin: 0; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    html, body { margin: 0; padding: 0; background: #fff; color: #000; }
    body { font-family: Arial, Helvetica, sans-serif; }
    .strip {
      width: ${pageWidthMm}mm;
      height: ${pageHeightMm}mm;
      padding: 0;
      display: flex;
      flex-direction: row;
      align-items: stretch;
      justify-content: flex-start;
      gap: ${gapMm}mm;
      overflow: hidden;
      page-break-after: always;
      break-after: page;
    }
    .strip:last-child { page-break-after: auto; break-after: auto; }
    .cell {
      width: ${cellWidthMm}mm;
      height: ${cellHeightMm}mm;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    .cell-empty { visibility: hidden; }
    .bc-wrap { width: 100%; text-align: center; padding: 0 0.3mm; }
    .bc-svg svg {
      width: 100%;
      max-width: ${Math.max(10, cellWidthMm - 1)}mm;
      height: ${settings.barcodeHeightMm}mm;
      display: block;
      margin: 0 auto;
    }
    .code {
      font-size: ${codeFontPt}pt;
      font-weight: 800;
      letter-spacing: 0.3px;
      line-height: 1.05;
      text-align: center;
      color: #000;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      margin-top: 0.3mm;
    }
    .name {
      font-size: ${Math.max(4, codeFontPt - 1.5)}pt;
      font-weight: 600;
      line-height: 1.05;
      color: #111;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      margin-top: 0.2mm;
    }
  `;
}

function buildSingleSheetCss(metrics: ReturnType<typeof resolveStickerMetrics>): string {
  const { widthMm, heightMm, codeFontPt, barcodeHeightMm } = metrics;
  return `
    @page { size: ${widthMm}mm ${heightMm}mm; margin: 0; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    html, body { margin: 0; padding: 0; background: #fff; color: #000; }
    body { font-family: Arial, Helvetica, sans-serif; }
    .strip {
      width: ${widthMm}mm;
      height: ${heightMm}mm;
      display: flex;
      align-items: center;
      justify-content: center;
      page-break-after: always;
      break-after: page;
    }
    .strip:last-child { page-break-after: auto; break-after: auto; }
    .cell { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }
    .bc-wrap { width: 100%; text-align: center; padding: 0.5mm; }
    .bc-svg svg {
      width: 100%;
      max-width: ${Math.max(12, widthMm - 2)}mm;
      height: ${barcodeHeightMm}mm;
      display: block;
      margin: 0 auto;
    }
    .code {
      font-size: ${codeFontPt}pt;
      font-weight: 800;
      letter-spacing: 0.4px;
      line-height: 1;
      text-align: center;
      color: #000;
    }
    .name {
      font-size: ${Math.max(4, codeFontPt - 1.5)}pt;
      margin-top: 0.3mm;
      font-weight: 600;
      color: #111;
    }
  `;
}

export function chunkCartelaColorCells<T>(items: T[], size = 3): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    rows.push(items.slice(i, i + size));
  }
  return rows;
}

export function buildCartelaColorStripRowsHtml(
  rows: Array<Array<CartelaColorStickerCell | null>>,
  settings: CartelaColorPrintSettings = DEFAULT_CARTELA_COLOR_PRINT_SETTINGS,
): string {
  const pageWidthMm = stripPageWidthMm(settings);
  const pageHeightMm = stripPageHeightMm(settings);
  const metrics = resolveStickerMetrics({}, settings);
  const strips = rows
    .map((row) => {
      const cells = Array.from({ length: 3 }, (_, index) => row[index] ?? null);
      const inner = cells.map((cell) => buildCellInner(cell, metrics)).join('');
      return `<main class="strip">${inner}</main>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en" dir="ltr">
<head>
  <meta charset="utf-8" />
  <style>${buildStripCss(settings, pageWidthMm, pageHeightMm)}</style>
</head>
<body>
  ${strips || '<main class="strip"></main>'}
</body>
</html>`;
}

export function buildCartelaColorStripPreviewHtml(
  rows: Array<Array<CartelaColorStickerCell | null>>,
  settings: CartelaColorPrintSettings = DEFAULT_CARTELA_COLOR_PRINT_SETTINGS,
): string {
  const pageWidthMm = stripPageWidthMm(settings);
  const pageHeightMm = stripPageHeightMm(settings);
  const fitCss = `
    <style id="cartela-color-strip-preview">
      @media screen {
        html, body {
          margin: 0 !important;
          padding: 8px !important;
          background: #f1f5f9 !important;
        }
        .strip {
          background: #fff;
          border: 1px dashed #cbd5e1;
          margin-bottom: 8px;
          box-shadow: 0 1px 2px rgba(15,23,42,0.08);
        }
        .cell:not(.cell-empty) { outline: 1px dotted #e2e8f0; }
      }
    </style>`;
  return buildCartelaColorStripRowsHtml(rows, settings).replace(
    '</head>',
    `${fitCss}
    <meta name="viewport" content="width=${pageWidthMm}mm, height=${pageHeightMm}mm" />
    </head>`,
  );
}

export function buildCartelaColorStickerHtml(data: CartelaColorStickerData): string {
  const settings = data.settings ?? DEFAULT_CARTELA_COLOR_PRINT_SETTINGS;
  const metrics = resolveStickerMetrics(data, settings);
  const cell: CartelaColorStickerCell = {
    barcodeCode: data.barcodeCode,
    displayCode: data.displayCode,
    subtitle: data.subtitle,
  };
  return `<!doctype html>
<html lang="en" dir="ltr">
<head>
  <meta charset="utf-8" />
  <style>${buildSingleSheetCss(metrics)}</style>
</head>
<body>
  <main class="strip">${buildCellInner(cell, metrics)}</main>
</body>
</html>`;
}

export function buildCartelaColorStickerPreviewHtml(data: CartelaColorStickerData): string {
  const fitCss = `
    <style id="cartela-color-preview-fit">
      @media screen {
        html, body {
          margin: 0 !important; padding: 0 !important; width: 100% !important; height: 100% !important;
          display: flex !important; align-items: center !important; justify-content: center !important;
          background: #fff !important;
        }
      }
    </style>`;
  return buildCartelaColorStickerHtml(data).replace('</head>', `${fitCss}</head>`);
}

export function buildCartelaColorStickersBatchHtml(
  stickers: CartelaColorStickerData[],
  settings: CartelaColorPrintSettings = DEFAULT_CARTELA_COLOR_PRINT_SETTINGS,
): string {
  const rows = chunkCartelaColorCells(
    stickers.map((item) => ({
      barcodeCode: item.barcodeCode,
      displayCode: item.displayCode,
      subtitle: item.subtitle,
    })),
  );
  return buildCartelaColorStripRowsHtml(rows, settings);
}
