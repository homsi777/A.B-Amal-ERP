import { BRAND } from '../../branding';
import { formatCompositionLinesForLabel, type CartelaCompositionLine } from '../cartela/careSymbols';
import { renderCareSymbolsHtml } from '../cartela/careSymbolSvg';
import type { CartelaCareSymbolId } from '../cartela/careSymbols';

export const CARTELA_WIDTH_MM = 80;
export const CARTELA_HEIGHT_MM = 50;

export type CartelaLabelData = {
  artCode: string;
  designNo: string;
  colour: string;
  widthValue: string;
  widthUnit: string;
  widthToleranceEnabled: boolean;
  widthTolerancePercent: number;
  weightValue: string;
  weightUnit: string;
  weightToleranceEnabled: boolean;
  weightTolerancePercent: number;
  compositionLines: CartelaCompositionLine[];
  careSymbols: CartelaCareSymbolId[];
  serialNo: string;
  showLogo: boolean;
  qrSvg?: string;
};

const CODE128_PATTERNS = [
  '212222','222122','222221','121223','121322','131222','122213','122312','132212','221213',
  '221312','231212','112232','122132','122231','113222','123122','123221','223211','221132',
  '221231','213212','223112','312131','311222','321122','321221','312212','322112','322211',
  '212123','212321','232121','111323','131123','131321','112313','132113','132311','211313',
  '231113','231311','112133','112331','132131','113123','113321','133121','313121','211331',
  '231131','213113','213311','213131','311123','311321','331121','312113','312311','332111',
  '314111','221411','431111','111224','111422','121124','121421','141122','141221','112214',
  '112412','122114','122411','142112','142211','241211','221114','413111','241112','134111',
  '111242','121142','121241','114212','124112','124211','411212','421112','421211','212141',
  '214121','412121','111143','111341','131141','114113','114311','411113','411311','113141',
  '114131','311141','411131','211412','211214','211232','2331112',
];

function buildCode128Svg(value: string, height = 24): string {
  const clean = String(value ?? '').replace(/[^\x20-\x7e]/g, '').slice(0, 48) || '0';
  const codes = [104, ...clean.split('').map((c) => c.charCodeAt(0) - 32)];
  const checksum = codes.reduce((s, c, i) => s + c * (i === 0 ? 1 : i), 0) % 103;
  const seq = [...codes, checksum, 106];
  const mw = 1.6;
  let x = 0;
  const bars = seq
    .flatMap((code) => {
      const pat = CODE128_PATTERNS[code] ?? CODE128_PATTERNS[0];
      return pat.split('').map((w, idx) => {
        const width = Number(w) * mw;
        const bar = idx % 2 === 0 ? `<rect x="${x}" y="0" width="${width}" height="${height}" fill="#000"/>` : '';
        x += width;
        return bar;
      });
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${x}" height="${height}" viewBox="0 0 ${x} ${height}" preserveAspectRatio="none">${bars}</svg>`;
}

const esc = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function formatWidth(data: CartelaLabelData): string {
  const base = `${data.widthValue.trim()} ${data.widthUnit.trim()}`.trim();
  if (!data.widthValue.trim()) return '';
  if (!data.widthToleranceEnabled) return base;
  return `${base} (-/+ %${Math.round(data.widthTolerancePercent)})`;
}

function formatWeight(data: CartelaLabelData): string {
  const base = `${data.weightValue.trim()} ${data.weightUnit.trim()}`.trim();
  if (!data.weightValue.trim()) return '';
  if (!data.weightToleranceEnabled) return base;
  return `${base} (-/+ %${Math.round(data.weightTolerancePercent)})`;
}

function row(label: string, value: string): string {
  if (!value.trim()) return '';
  return `
    <div class="row">
      <span class="lbl">${esc(label)}</span>
      <span class="sep">:</span>
      <span class="val">${esc(value)}</span>
    </div>`;
}

function compositionRow(lines: CartelaCompositionLine[]): string {
  const compLines = formatCompositionLinesForLabel(lines);
  if (!compLines.length) return '';
  const linesHtml = compLines.map((line) => `<span class="comp-line">${esc(line)}</span>`).join('');
  return `
    <div class="row row-comp">
      <span class="lbl">COMP.</span>
      <span class="sep">:</span>
      <div class="val val-comp">${linesHtml}</div>
    </div>`;
}

/** ISO care symbols — selected ids only, black for thermal printing. */
function careSymbolsHtml(selected: CartelaCareSymbolId[]): string {
  return renderCareSymbolsHtml(selected);
}

export function buildCartelaLabelHtml(data: CartelaLabelData): string {
  const serial = data.serialNo.trim();
  const barcodeSvg = serial ? buildCode128Svg(serial, 22) : '';
  const qrBlock = data.qrSvg
    ? `<div class="qr">${data.qrSvg.replace('<svg ', '<svg class="qr-svg" ')}</div>`
    : '';
  const brandStripe = data.showLogo
    ? `<aside class="brand-stripe"><span>CLOTEX</span></aside>`
    : '';

  const rows = [
    row('ART CODE', data.artCode),
    row('DESIGN NO', data.designNo),
    row('COLOUR', data.colour),
    row('WIDTH', formatWidth(data)),
    row('WEIGHT', formatWeight(data)),
    compositionRow(data.compositionLines),
  ].join('');

  return `<!doctype html>
<html lang="en" dir="ltr">
<head>
  <meta charset="utf-8" />
  <style>
    @page { size: ${CARTELA_WIDTH_MM}mm ${CARTELA_HEIGHT_MM}mm; margin: 0; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    html, body { margin: 0; padding: 0; background: #fff; color: #000; }
    body { font-family: Arial, Helvetica, sans-serif; }
    .sheet {
      width: ${CARTELA_WIDTH_MM}mm;
      height: ${CARTELA_HEIGHT_MM}mm;
      padding: 1.5mm;
      overflow: hidden;
      page-break-after: always;
    }
    .frame {
      width: 100%;
      height: 100%;
      border: 0.35mm solid #000;
      display: grid;
      grid-template-columns: ${data.showLogo ? '1fr 9mm' : '1fr'};
      grid-template-rows: 1fr;
      overflow: hidden;
    }
    .content {
      padding: 1.2mm 1.5mm 1mm;
      display: flex;
      flex-direction: column;
      min-width: 0;
      min-height: 0;
    }
    .rows { flex: 1; min-height: 0; overflow: hidden; }
    .row {
      display: grid;
      grid-template-columns: 17mm 2mm 1fr;
      gap: 0.5mm;
      align-items: baseline;
      line-height: 1.15;
      margin-bottom: 0.35mm;
    }
    .lbl { font-size: 6.2pt; font-weight: 700; letter-spacing: 0.2px; white-space: nowrap; }
    .sep { font-size: 6.2pt; font-weight: 700; text-align: center; }
    .val { font-size: 6.8pt; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .row-comp { align-items: start; }
    .val-comp {
      white-space: normal;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      gap: 0.12mm;
      line-height: 1.08;
      font-size: 6.2pt;
      min-width: 0;
    }
    .comp-line {
      display: block;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .footer {
      display: grid;
      grid-template-columns: ${data.qrSvg ? '13mm 1fr 1fr' : '1fr 1fr'};
      align-items: end;
      gap: 1mm;
      margin-top: 0.5mm;
      min-height: 14mm;
    }
    .qr {
      width: 12mm;
      height: 12mm;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #fff;
    }
    .qr svg, .qr-svg {
      width: 12mm !important;
      height: 12mm !important;
      display: block;
    }
    .care {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.6mm;
      flex-wrap: nowrap;
    }
    .sym { width: 4.2mm; height: 4.2mm; fill: #000; stroke: #000; stroke-width: 0.8; }
    .bc-wrap { text-align: center; min-width: 0; }
    .bc-svg svg { width: 100%; max-width: 28mm; height: 5.5mm; display: block; margin: 0 auto; }
    .bc-num { font-size: 6pt; font-weight: 700; letter-spacing: 0.8px; margin-top: 0.3mm; }
    .brand-stripe {
      border-left: 0.25mm solid #000;
      display: flex;
      align-items: center;
      justify-content: center;
      writing-mode: vertical-rl;
      text-orientation: mixed;
      transform: rotate(180deg);
      font-size: 11pt;
      font-weight: 900;
      letter-spacing: 1.5px;
      padding: 1mm 0;
    }
    .brand-stripe span { display: block; }
    @media screen {
      html, body {
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: #fff;
      }
      .sheet {
        width: 100%;
        height: 100%;
        background: #fff;
        box-shadow: none;
      }
    }
  </style>
</head>
<body>
  <main class="sheet">
    <section class="frame">
      <div class="content">
        <div class="rows">${rows}</div>
        <div class="footer">
          ${qrBlock}
          ${careSymbolsHtml(data.careSymbols)}
          <div class="bc-wrap">
            ${barcodeSvg ? `<div class="bc-svg">${barcodeSvg}</div>` : ''}
            ${serial ? `<div class="bc-num">${esc(serial)}</div>` : ''}
          </div>
        </div>
      </div>
      ${brandStripe}
    </section>
  </main>
</body>
</html>`;
}

export function cartelaQrPayload(data: Pick<CartelaLabelData, 'artCode' | 'designNo' | 'serialNo'>): string {
  const parts = [data.artCode.trim(), data.designNo.trim(), data.serialNo.trim()].filter(Boolean);
  return parts.length ? `CLOTEX|${parts.join('|')}` : 'CLOTEX|CARTELA';
}

/** Optional small logo for screen preview only — thermal uses text stripe. */
export const CARTELA_LOGO_INLINE = BRAND.logoInline;
