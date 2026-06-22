/**
 * LabelCard – fabric-roll label, redesigned to mirror the layout of the
 * industry-standard textile label (TEXTORIA / international mill labels):
 *
 *   ┌─────────────────────────────────────────────────────────┐
 *   │                CLOTEX                                   │
 *   │             CLOTHES TEXTILE                             │
 *   │ ─────────────────────────────────────────────────────── │
 *   │ Order Nr      :  …                                      │
 *   │ Customer P/O  :  …                                      │
 *   │ ─────────────────────────────────────────────────────── │
 *   │ Article Code  :  VISKON KETEN     │ Colour Cd : 11      │
 *   │ Design Nr     :  ANKA-01          │                     │
 *   │ Colour Nr     :  KASAR            │ QUALITY  :  1       │
 *   │ ─────────────────────────────────────────────────────── │
 *   │ Note          :                  ┌──────────────────┐   │
 *   │ Lot Nr        :  LOT 1           │      QR-CODE     │   │
 *   │ Meters        :  125.00 MTS.     │                  │   │
 *   │ Net Weight    :  35.20 KGS.      └──────────────────┘   │
 *   │  ║║║│║│║║│║│║║│║│║║│║│║                                 │
 *   │             30367550                                    │
 *   │ THE CLAIMS WILL NOT BE ACCEPTABLE AFTER GOODS WERE CUT  │
 *   └─────────────────────────────────────────────────────────┘
 *
 * Dimensions: 100 mm × 80 mm (10 cm × 8 cm) — overridable via props.
 *
 * Architecture: This component is intentionally pure (no router / no fetch)
 * so it can be rendered for screen preview AND fed into Electron's silent
 * `printHtml()` adapter via `buildPrintDocument()` below.
 */

import React from 'react';
import { QRCodeSVG } from 'qrcode.react';
import type { RollLabelPreviewDto } from '../../lib/api/labelsApi';
import { BRAND } from '../../branding';
import { thermalBrandLogoHtml, thermalLogoImgReactStyle } from '../../lib/printing/thermalBrandLogo';

// ─── Code128 SVG generator ───────────────────────────────────────────────────

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

function buildCode128Svg(value: string, height = 40): string {
  const clean = String(value ?? '').replace(/[^\x20-\x7e]/g, '').slice(0, 48) || '0';
  const codes = [104, ...clean.split('').map(c => c.charCodeAt(0) - 32)];
  const checksum = codes.reduce((s, c, i) => s + c * (i === 0 ? 1 : i), 0) % 103;
  const seq = [...codes, checksum, 106];
  const mw = 2;
  let x = 0;
  const bars = seq.flatMap(code => {
    const pat = CODE128_PATTERNS[code] ?? CODE128_PATTERNS[0];
    return pat.split('').map((w, idx) => {
      const width = Number(w) * mw;
      const bar = idx % 2 === 0
        ? `<rect x="${x}" y="0" width="${width}" height="${height}" fill="#000"/>`
        : '';
      x += width;
      return bar;
    });
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${x}" height="${height}" viewBox="0 0 ${x} ${height}" preserveAspectRatio="none">${bars}</svg>`;
}

// ─── Label config ────────────────────────────────────────────────────────────

export interface LabelConfig {
  showBrandLogo?: boolean;
  /** اتجاه نص الحقول — لا يغيّر مواقع QR/الباركود */
  textDirection?: 'rtl' | 'ltr';
  showBarcode?: boolean;
  showQr?: boolean;
  showItemName?: boolean;
  showInternalCode?: boolean;
  showSupplierCode?: boolean;
  showColorName?: boolean;
  showColorCode?: boolean;
  showLength?: boolean;
  showWidth?: boolean;
  showGsm?: boolean;
  showActualWeight?: boolean;
  showCalculatedWeight?: boolean;
  showWarehouse?: boolean;
  showBatchNo?: boolean;
  showContainerNo?: boolean;
  showPurchaseInvoiceNo?: boolean;
  brandName?: string;
  subtitle?: string;
  /** Disclaimer printed at the bottom — pass empty string to hide. */
  disclaimer?: string;
  /** Quality grade printed in the upper-right corner (defaults to 1). */
  quality?: string;
}

/** Physical safe inset inside the sticker (content area = width−2×this × height−2×this). */
export const LABEL_SAFE_MARGIN_MM = 1;

const DEFAULT_CONFIG: Required<LabelConfig> = {
  showBrandLogo: true,
  textDirection: 'ltr',
  showBarcode: true, showQr: true,
  showItemName: true, showInternalCode: true, showSupplierCode: true,
  showColorName: true, showColorCode: true,
  showLength: true, showWidth: true, showGsm: true,
  showActualWeight: true, showCalculatedWeight: true,
  showWarehouse: true, showBatchNo: true,
  showContainerNo: true, showPurchaseInvoiceNo: true,
  brandName: BRAND.name, subtitle: BRAND.tagline,
  disclaimer: 'لا تُقبل المطالبات بعد قصّ البضاعة',
  quality: '1',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmt = (v: number | null | undefined, d = 2) =>
  v !== null && v !== undefined && Number.isFinite(Number(v))
    ? Number(v).toFixed(d)
    : '';

function pickWeight(roll: RollLabelPreviewDto): string {
  const a = roll.actualWeightKg;
  const c = roll.calculatedWeightKg;
  const v = a != null && Number(a) > 0 ? a : c;
  return v != null && Number(v) > 0 ? `${fmt(v)} KGS.` : '';
}

function pickMeters(roll: RollLabelPreviewDto): string {
  return roll.lengthM != null && Number(roll.lengthM) > 0
    ? `${fmt(roll.lengthM)} MTS.`
    : '';
}

function pickColorName(roll: RollLabelPreviewDto): string {
  return roll.colorNameAr || roll.colorNameTr || '';
}

function pickLot(roll: RollLabelPreviewDto): string {
  const lot = String(roll.batchNo ?? '').trim();
  const isImportNoise = /(\.xlsx?|excel|import|استيراد|وارد|مستودعات|warehouse)/i.test(lot);
  if (!lot || isImportNoise || lot.length > 24 || /^-+$/.test(lot)) return '-';
  return /^lot\b/i.test(lot) ? lot : `LOT ${lot}`;
}

function pickPrintableBarcode(roll: RollLabelPreviewDto): string {
  const barcode = String(roll.barcode ?? '').trim();
  return barcode;
}

// ─── Field row primitive ─────────────────────────────────────────────────────

const fieldRowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '20mm 2.5mm 1fr',
  columnGap: '0.5mm',
  alignItems: 'baseline',
  lineHeight: 1.3,
};

const labelTextStyle: React.CSSProperties = {
  fontSize: '6.5pt',
  fontWeight: 500,
  color: '#1f2937',
};

const valueTextStyle: React.CSSProperties = {
  fontSize: '7.5pt',
  fontWeight: 700,
  color: '#000',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  letterSpacing: '0.2px',
};

const FieldRow: React.FC<{
  label: string;
  value: string | null | undefined;
  emphasize?: boolean;
  textDirection?: 'rtl' | 'ltr';
  compact?: boolean;
}> = ({ label, value, emphasize, textDirection = 'ltr', compact = false }) => {
  const labelCol = compact ? '14mm' : '20mm';
  if (textDirection === 'rtl') {
    return (
      <div style={{ display: 'flex', direction: 'rtl', alignItems: 'baseline', gap: '0.5mm', width: '100%' }}>
        <span style={{ ...labelTextStyle, flex: '0 0 auto', textAlign: 'right', unicodeBidi: 'plaintext' }}>{label}</span>
        <span style={{ ...labelTextStyle, flex: '0 0 auto', textAlign: 'center' }}>:</span>
        <span style={{
          ...(emphasize ? { ...valueTextStyle, fontSize: '8pt', fontWeight: 800 } : valueTextStyle),
          flex: '0 1 auto',
          minWidth: 0,
          textAlign: 'right',
          unicodeBidi: 'plaintext',
        }}>
          {value ?? ''}
        </span>
      </div>
    );
  }
  return (
    <div style={{ ...fieldRowStyle, gridTemplateColumns: `${labelCol} 2.5mm 1fr`, direction: 'ltr' }}>
      <span style={labelTextStyle}>{label}</span>
      <span style={{ ...labelTextStyle, textAlign: 'center' }}>:</span>
      <span style={emphasize ? { ...valueTextStyle, fontSize: '8pt', fontWeight: 800 } : valueTextStyle}>
        {value ?? ''}
      </span>
    </div>
  );
};

// ─── LabelCard component (screen preview) ────────────────────────────────────

interface LabelCardProps {
  roll: RollLabelPreviewDto;
  config?: LabelConfig;
  widthMm?: number;
  heightMm?: number;
  printDate?: string;
  /** preview = on-screen (default); print = exact mm layout for debugging */
  mode?: 'preview' | 'print';
}

export const LabelCard: React.FC<LabelCardProps> = ({
  roll,
  config: configProp,
  widthMm = 100,
  heightMm = 80,
  mode = 'preview',
}) => {
  const cfg: Required<LabelConfig> = { ...DEFAULT_CONFIG, ...(configProp ?? {}) };
  const textDir = cfg.textDirection;
  const printableBarcode = pickPrintableBarcode(roll);
  const barcodeSvg = printableBarcode ? buildCode128Svg(printableBarcode, 38) : '';

  const meters = pickMeters(roll);
  const weight = pickWeight(roll);
  const lot    = pickLot(roll);
  const color  = pickColorName(roll);

  const safe = `${LABEL_SAFE_MARGIN_MM}mm`;

  return (
    <div
      className={`label-page ${mode === 'preview' ? 'label-page--preview' : ''}`}
      style={{
        width:  `${widthMm}mm`,
        height: `${heightMm}mm`,
        boxSizing: 'border-box',
        padding: safe,
        background: '#fff',
        color: '#000',
        fontFamily: "'Segoe UI', 'Noto Sans Arabic', Arial, sans-serif",
        fontSize: '7pt',
        direction: 'ltr',
        display: 'flex',
        flexDirection: 'column',
        pageBreakInside: 'avoid',
        breakInside: 'avoid',
        overflow: 'hidden',
        boxShadow: mode === 'preview' ? '0 2px 12px rgba(0,0,0,0.12)' : undefined,
      }}
    >
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          boxSizing: 'border-box',
          border: '0.35mm solid #000',
          borderRadius: mode === 'preview' ? '0.6mm' : 0,
          overflow: 'hidden',
          background: '#fff',
        }}
      >
      {/* ── Brand header (≈70% bigger logo + extra bottom padding) ── */}
      <div style={{ textAlign: 'center', paddingBottom: '1.2mm', borderBottom: '0.25mm solid #000', flexShrink: 0 }}>
        {cfg.showBrandLogo ? (
          <img
            src={BRAND.logoThermalInline}
            alt={BRAND.name}
            style={thermalLogoImgReactStyle(13, 72)}
          />
        ) : (
          <div style={{ height: '13mm' }} aria-hidden="true" />
        )}
      </div>

      {/* ── Article / Colour section (slight top padding nudges data down) ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1.55fr 1fr',
        padding: '0.8mm 0 0.45mm 0',
        borderBottom: '0.25mm solid #000',
        gap: '0.5mm',
        flexShrink: 0,
      }}>
        <div>
          {cfg.showItemName && <FieldRow label="رمز الصنف" value={roll.itemName} textDirection={textDir} />}
          {cfg.showInternalCode && (
            <FieldRow label="كود الخامة" value={(roll.internalCode || roll.supplierCode || '').trim() || ''} textDirection={textDir} />
          )}
          {(cfg.showColorName || cfg.showSupplierCode) && (
            <FieldRow label="اسم اللون" value={color} textDirection={textDir} />
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', paddingLeft: '2mm', borderLeft: '0.2mm dashed #999' }}>
          {cfg.showColorCode && (
            <FieldRow label="رمز اللون" value={roll.colorCode ?? ''} textDirection={textDir} compact emphasize />
          )}
          <div style={{ textAlign: 'center', marginTop: '0.35mm', direction: textDir, unicodeBidi: 'plaintext' }}>
            <div style={{ fontSize: '6.5pt', color: '#1f2937', fontWeight: 500 }}>الجودة :</div>
            <div style={{ fontSize: '11pt', fontWeight: 800, lineHeight: 1 }}>{cfg.quality}</div>
          </div>
        </div>
      </div>

      {/* ── Lower section: fields | QR ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 22mm',
        gap: '1mm',
        flex: 1,
        paddingTop: '0.45mm',
        minHeight: 0,
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
          <div>
            <FieldRow label="ملاحظة"       value="" textDirection={textDir} />
            <FieldRow label="رقم الدفعة"     value={lot} textDirection={textDir} />
            {cfg.showLength       && <FieldRow label="الأمتار"     value={meters} emphasize textDirection={textDir} />}
            {cfg.showActualWeight && <FieldRow label="الوزن الصافي" value={weight} emphasize textDirection={textDir} />}
          </div>
        </div>

        {/* ── QR code ── */}
        {cfg.showQr && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#fff',
          }}>
            <QRCodeSVG
              value={roll.qrPayload}
              size={94}
              level="M"
              marginSize={0}
              style={{ width: '22mm', height: '22mm' }}
            />
          </div>
        )}
      </div>

      {cfg.showBarcode && printableBarcode && (
        <div style={{ flexShrink: 0, textAlign: 'center', padding: '0.35mm 0 0.55mm' }}>
          <div
            dangerouslySetInnerHTML={{ __html: barcodeSvg }}
            style={{
              width: '100%',
              maxWidth: '58mm',
              margin: '0 auto',
              height: '8.5mm',
              overflow: 'hidden',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
            }}
          />
          <div style={{
            fontSize: '7pt',
            fontFamily: 'Consolas, monospace',
            fontWeight: 700,
            letterSpacing: '1pt',
            lineHeight: 1.15,
            marginTop: '0.25mm',
            paddingBottom: '0.15mm',
          }}>
            {printableBarcode}
          </div>
        </div>
      )}

      {/* ── Footer disclaimer ── */}
      {cfg.disclaimer && (
        <div style={{
          borderTop: '0.25mm solid #000',
          padding: '0.45mm 1.5mm 0.3mm',
          textAlign: 'center',
          fontSize: '5.2pt',
          fontWeight: 700,
          letterSpacing: '0.15pt',
          color: '#000',
          flexShrink: 0,
          lineHeight: 1.2,
          direction: textDir,
          unicodeBidi: 'plaintext',
        }}>
          {cfg.disclaimer}
        </div>
      )}
      </div>
    </div>
  );
};

// ─── Print document builder (Electron / Web) ─────────────────────────────────

/**
 * buildPrintDocument — generates a complete standalone HTML string for printing.
 *
 * The output is a self-contained HTML document with inline styles that mirrors
 * the on-screen `<LabelCard>` exactly (10cm × 8cm by default). It is fed to:
 *   - `window.fabricApp.printHtml()`  for silent Electron printing
 *   - `window.print()`                in browser fallback mode
 *
 * QR codes must be pre-generated with `generateQrSvgMap()` and passed in
 * through `qrSvgs` (a map of `rollId` → inline SVG) so this function stays
 * pure and works in both Electron and browser contexts.
 */
export function buildPrintDocument(
  rolls: RollLabelPreviewDto[],
  opts: {
    config?: LabelConfig;
    widthMm?: number;
    heightMm?: number;
    pageSize?: 'label' | 'A4' | 'A4_SHEET_6';
    printDate?: string;
    qrSvgs?: Record<string, string>;
    /**
     * wide = تدوير 90° لطابعات الرول في Electron فقط.
     * normal = صفحة واحدة بالأبعاد الفعلية (مطلوب للمتصفح).
     * auto = wide عندما العرض > الارتفاع (افتراضي لطباعة الأتواب من المكتب).
     */
    rollLayout?: 'auto' | 'normal' | 'wide';
  } = {},
): string {
  const {
    config = {},
    widthMm = 80,
    heightMm = 60,
    pageSize = 'label',
    qrSvgs  = {},
    rollLayout = 'auto',
  } = opts;
  const cfg: Required<LabelConfig> = { ...DEFAULT_CONFIG, ...config };
  const textDir = cfg.textDirection;
  const rowClass = textDir === 'rtl' ? 'row row-rtl' : 'row row-ltr';

  const safeMm = LABEL_SAFE_MARGIN_MM;
  const ultraCompactLabel = pageSize === 'label' && heightMm <= 62;
  const compactLabel = pageSize === 'label' && heightMm <= 65;
  const brandLogoHmm = ultraCompactLabel ? 11 : compactLabel ? 13 : 17;
  const brandLogoMaxWmm = ultraCompactLabel ? 68 : compactLabel ? 72 : 78;
  const BARCODE_PRINT_H = ultraCompactLabel ? 28 : compactLabel ? 32 : 38;
  const singleLabel = rolls.length === 1;
  /** لصاقة أعرض من ارتفاعها: تدوير 90° — للمتصفح نستخدم normal دائماً */
  const isWideRollLabel =
    pageSize === 'label' && widthMm > heightMm && rollLayout !== 'normal';

  const fieldRow = (label: string, value: string | null | undefined, emphasize = false, compact = false) => `
    <div class="${rowClass}${compact ? ' right-row' : ''}">
      <span class="rk">${label}</span>
      <span class="rc">:</span>
      <span class="${emphasize ? 'rv rv-em' : 'rv'}${compact ? ' rv-cd' : ''}">${value ?? ''}</span>
    </div>`;

  const renderLabel = (roll: RollLabelPreviewDto): string => {
    const meters = pickMeters(roll);
    const weight = pickWeight(roll);
    const lot    = pickLot(roll);
    const color  = pickColorName(roll);
    const printableBarcode = pickPrintableBarcode(roll);
    const barcodeSvg = cfg.showBarcode && printableBarcode ? buildCode128Svg(printableBarcode, BARCODE_PRINT_H) : '';
    const qrSvg = cfg.showQr ? (qrSvgs[roll.rollId] ?? '') : '';

    const inner = `
  <div class="brand">
    ${
      cfg.showBrandLogo
        ? thermalBrandLogoHtml({ heightMm: brandLogoHmm, maxWidthMm: brandLogoMaxWmm })
        : `<div class="brand-empty" aria-hidden="true"></div>`
    }
  </div>

  <div class="block grid-2">
    <div>
      ${cfg.showItemName ? fieldRow('رمز الصنف', roll.itemName) : ''}
      ${
        cfg.showInternalCode
          ? fieldRow('كود الخامة', (roll.internalCode || roll.supplierCode || '').trim() || '')
          : ''
      }
      ${
        cfg.showColorName || cfg.showSupplierCode
          ? fieldRow('اسم اللون', color)
          : ''
      }
    </div>
    <div class="right-col">
      ${cfg.showColorCode ? fieldRow('رمز اللون', roll.colorCode ?? '', false, true) : ''}
      <div class="quality text-${textDir}">
        <div class="ql">الجودة :</div>
        <div class="qv">${cfg.quality}</div>
      </div>
    </div>
  </div>

  <div class="lower">
    <div class="lower-fields">
      <div class="lower-list">
        ${fieldRow('ملاحظة',       '')}
        ${fieldRow('رقم الدفعة',     lot)}
        ${cfg.showLength       ? fieldRow('الأمتار',     meters, true) : ''}
        ${cfg.showActualWeight ? fieldRow('الوزن الصافي', weight, true) : ''}
      </div>
    </div>
    ${cfg.showQr ? `<div class="qr">${qrSvg}</div>` : ''}
  </div>

  ${cfg.showBarcode && printableBarcode ? `
  <div class="footer-bc">
    <div class="bc-svg">${barcodeSvg}</div>
    <div class="bc-text">${printableBarcode}</div>
  </div>` : ''}

  ${cfg.disclaimer ? `<div class="disc text-${textDir}">${cfg.disclaimer}</div>` : ''}`;

    if (pageSize === 'A4' || pageSize === 'A4_SHEET_6') {
      return `<div class="lbl">${inner}</div>`;
    }
    if (isWideRollLabel) {
      return `<div class="label-sheet label-sheet--wide-roll"><div class="label-page"><div class="lbl">${inner}</div></div></div>`;
    }
    return `<div class="label-page"><div class="lbl">${inner}</div></div>`;
  };

  // For A4_SHEET_6 we wrap every 6 labels in a printable "sheet" so the browser
  // / Electron PDF renderer emits one A4 page per sheet with hard page breaks
  // between sheets — exactly matching the physical 2×3 sticker sheets.
  let labelsHtml: string;
  if (pageSize === 'A4_SHEET_6') {
    const SHEET_SIZE = 6;
    const sheets: string[] = [];
    for (let i = 0; i < rolls.length; i += SHEET_SIZE) {
      const chunk = rolls.slice(i, i + SHEET_SIZE).map(renderLabel).join('\n');
      sheets.push(`<section class="a4-sheet">${chunk}</section>`);
    }
    labelsHtml = sheets.join('\n');
  } else {
    labelsHtml = rolls.map(renderLabel).join('\n');
  }

  const pageBreakAfter = singleLabel ? 'avoid' : 'always';
  const pageBreakAfterLast = singleLabel ? 'avoid' : 'auto';
  const breakAfterValue = singleLabel ? 'avoid' : 'page';
  const breakAfterLastValue = singleLabel ? 'avoid' : 'auto';
  /** Fixed height on html/body clips extra labels in Chromium/Edge print preview (shows 1 page only). */
  const singlePageShellCss = singleLabel
    ? `
        height: ${heightMm}mm;
        max-height: ${heightMm}mm;
        overflow: hidden !important;`
    : `
        height: auto !important;
        min-height: 0 !important;
        max-height: none !important;
        overflow: visible !important;`;

  const pageCssRollNormal = `
      @page { size: ${widthMm}mm ${heightMm}mm; margin: 0; }
      html {
        margin: 0 !important;
        padding: 0 !important;
        width: ${widthMm}mm;
        background: #fff;
        ${singlePageShellCss}
      }
      body {
        margin: 0 !important;
        padding: 0 !important;
        width: ${widthMm}mm;
        max-width: ${widthMm}mm;
        background: #fff;
        ${singlePageShellCss}
      }
      @media print {
        html, body {
          margin: 0 !important;
          padding: 0 !important;
          width: ${widthMm}mm;
          ${singlePageShellCss}
        }
      }
      .label-page {
        width: ${widthMm}mm;
        height: ${heightMm}mm;
        max-width: ${widthMm}mm;
        max-height: ${heightMm}mm;
        box-sizing: border-box;
        padding: ${safeMm}mm;
        overflow: hidden !important;
        page-break-after: ${pageBreakAfter};
        break-after: ${breakAfterValue};
        page-break-inside: avoid;
        break-inside: avoid;
      }
      .label-page:last-child { page-break-after: ${pageBreakAfterLast}; break-after: ${breakAfterLastValue}; }
    `;

  /** Physical page = narrow × long (matches swapped Electron pageSize); label box rotated 90° to read horizontal on the roll */
  const pageCssRollWide = `
      @page { size: ${heightMm}mm ${widthMm}mm; margin: 0; }
      html {
        margin: 0 !important;
        padding: 0 !important;
        width: ${heightMm}mm;
        min-height: ${widthMm}mm;
        background: #fff;
      }
      body {
        margin: 0 !important;
        padding: 0 !important;
        width: ${heightMm}mm;
        min-height: ${widthMm}mm;
        background: #fff;
        overflow: visible !important;
      }
      @media screen {
        html, body { height: ${widthMm}mm; }
      }
      @media print {
        html, body {
          margin: 0 !important;
          padding: 0 !important;
          width: ${heightMm}mm;
          min-height: ${widthMm}mm;
          overflow: visible !important;
        }
      }
      .label-sheet--wide-roll {
        position: relative;
        width: ${heightMm}mm;
        height: ${widthMm}mm;
        box-sizing: border-box;
        overflow: visible;
        page-break-after: always;
        break-after: page;
        page-break-inside: avoid;
        break-inside: avoid;
      }
      .label-sheet--wide-roll:last-child { page-break-after: auto; break-after: auto; }
      .label-sheet--wide-roll .label-page {
        position: absolute;
        left: 50%;
        top: 50%;
        width: ${widthMm}mm;
        height: ${heightMm}mm;
        max-width: ${widthMm}mm;
        max-height: ${heightMm}mm;
        box-sizing: border-box;
        padding: ${safeMm}mm;
        overflow: hidden !important;
        page-break-inside: avoid;
        break-inside: avoid;
        transform: translate(-50%, -50%) rotate(90deg);
      }
    `;

  // A4_SHEET_6 layout constants
  //   A4 printable area (with 8mm margins) = 194mm × 281mm
  //   2 columns × 3 rows with 3mm gutters → ~94mm × ~91mm per label.
  const SHEET6_MARGIN_MM = 8;
  const SHEET6_GAP_MM = 3;
  const SHEET6_COLS = 2;
  const SHEET6_ROWS = 3;
  const SHEET6_CELL_W_MM =
    (210 - SHEET6_MARGIN_MM * 2 - SHEET6_GAP_MM * (SHEET6_COLS - 1)) / SHEET6_COLS;
  const SHEET6_CELL_H_MM =
    (297 - SHEET6_MARGIN_MM * 2 - SHEET6_GAP_MM * (SHEET6_ROWS - 1)) / SHEET6_ROWS;

  const pageCssA4Sheet6 = `
      @page { size: A4 portrait; margin: ${SHEET6_MARGIN_MM}mm; }
      html, body {
        margin: 0;
        padding: 0;
        background: #fff;
        color: #000;
      }
      .a4-sheet {
        display: grid;
        grid-template-columns: repeat(${SHEET6_COLS}, ${SHEET6_CELL_W_MM}mm);
        grid-template-rows: repeat(${SHEET6_ROWS}, ${SHEET6_CELL_H_MM}mm);
        grid-auto-flow: column;
        gap: ${SHEET6_GAP_MM}mm;
        width: ${SHEET6_CELL_W_MM * SHEET6_COLS + SHEET6_GAP_MM * (SHEET6_COLS - 1)}mm;
        height: ${SHEET6_CELL_H_MM * SHEET6_ROWS + SHEET6_GAP_MM * (SHEET6_ROWS - 1)}mm;
        page-break-after: always;
        break-after: page;
      }
      .a4-sheet:last-child { page-break-after: auto; break-after: auto; }
      .a4-sheet .lbl {
        width: 100%;
        height: 100%;
        page-break-inside: avoid;
        break-inside: avoid;
      }
    `;

  const pageCss = pageSize === 'A4_SHEET_6'
    ? pageCssA4Sheet6
    : pageSize === 'A4'
      ? `
      @page { size: A4; margin: 8mm; }
      body { display: flex; flex-wrap: wrap; gap: 4mm; align-content: flex-start; }
      .lbl { page-break-inside: avoid; break-inside: avoid; }
    `
      : isWideRollLabel
        ? pageCssRollWide
        : pageCssRollNormal;

  const lblBoxCss = pageSize === 'A4_SHEET_6'
    ? `
.lbl {
  padding: 2mm 3mm;
  border: 0.4mm solid #000;
  border-radius: 1mm;
  display: flex;
  flex-direction: column;
  background: #fff;
  color: #000;
  overflow: hidden;
}`
    : pageSize === 'A4'
      ? `
.lbl {
  width: ${widthMm}mm;
  height: ${heightMm}mm;
  padding: 2mm 3mm;
  border: 0.4mm solid #000;
  border-radius: 1mm;
  display: flex;
  flex-direction: column;
  background: #fff;
  color: #000;
}`
      : `
.label-page .lbl {
  width: 100%;
  height: 100%;
  min-height: 0;
  border: 0.35mm solid #000;
  border-radius: 0;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) auto auto;
  background: #fff;
  color: #000;
  overflow: hidden;
}`;

  return `<!DOCTYPE html>
<html dir="ltr" lang="en">
<head>
<meta charset="UTF-8">
<title>Roll Labels</title>
<style>
${pageCss}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: 'Segoe UI', 'Noto Sans Arabic', Arial, sans-serif;
  font-size: 7pt;
  color: #000;
  background: #fff;
}
${lblBoxCss}

/* Brand — bigger logo (≈70% larger) with extra bottom padding to push the
   article block down a bit for visual balance. Print sizes stay in mm so
   thermal output is identical to the on-screen preview. */
.brand {
  flex-shrink: 0;
  text-align: center;
  padding-bottom: 1.2mm;
  border-bottom: 0.25mm solid #000;
}
.brand-logo {
  height: ${brandLogoHmm}mm;
  max-width: ${brandLogoMaxWmm}mm;
  width: auto;
  object-fit: contain;
  display: block;
  margin: 0 auto;
}
.brand-empty { height: ${brandLogoHmm}mm; }
.brand-mark { font-size: ${compactLabel ? '4.8mm' : '5.8mm'}; font-weight: 900; letter-spacing: 0.65mm; line-height: 1.05; }
.brand-tag  { font-size: ${compactLabel ? '2.1mm' : '2.4mm'}; letter-spacing: 0.45mm; color: #222; margin-top: 0.25mm; }

.block { padding: 0.8mm 0 0.45mm 0; border-bottom: 0.25mm solid #000; flex-shrink: 0; }
.grid-2 { display: grid; grid-template-columns: 1.55fr 1fr; gap: 0.45mm; }
.grid-2 .right-col {
  padding-left: 1mm;
  border-left: 0.2mm dashed #999;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.row { align-items: baseline; line-height: 1.25; }
.row-ltr {
  display: grid;
  grid-template-columns: 19mm 2.5mm 1fr;
  column-gap: 0.45mm;
  direction: ltr;
}
.row-ltr.right-row { grid-template-columns: 13mm 2.5mm 1fr; }
.row-rtl {
  display: flex;
  direction: rtl;
  gap: 0.45mm;
  width: 100%;
  justify-content: flex-start;
}
.row-rtl .rk { flex: 0 0 auto; text-align: right; unicode-bidi: plaintext; }
.row-rtl .rc { flex: 0 0 auto; text-align: center; }
.row-rtl .rv { flex: 0 1 auto; min-width: 0; text-align: right; unicode-bidi: plaintext; }
.text-rtl { direction: rtl; unicode-bidi: plaintext; }
.text-ltr { direction: ltr; unicode-bidi: plaintext; }
.rk { font-size: 2.5mm; font-weight: 500; color: #1f2937; }
.rc { font-size: 2.5mm; font-weight: 500; color: #1f2937; text-align: center; }
.rv { font-size: 3mm; font-weight: 700; color: #000; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rv-em { font-size: 3.2mm; font-weight: 800; }
.rv-cd { font-size: 3.3mm; font-weight: 800; }

.quality { text-align: center; margin-top: 0.35mm; }
.quality .ql { font-size: 2.5mm; font-weight: 500; color: #1f2937; }
.quality .qv { font-size: 11pt; font-weight: 800; line-height: 1; }

.lower {
  display: grid;
  grid-template-columns: 1fr 21mm;
  gap: 0.8mm;
  min-height: 0;
  overflow: hidden;
  padding-top: 0.35mm;
}
.lower-fields { display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
.lower-list { min-height: 0; }

.footer-bc {
  flex-shrink: 0;
  text-align: center;
  padding: 0.35mm 0 0.55mm;
}
.footer-bc .bc-svg {
  width: ${compactLabel ? '52mm' : '58mm'};
  max-width: 100%;
  height: ${ultraCompactLabel ? '7.5mm' : compactLabel ? '8.5mm' : '10mm'};
  margin: 0 auto;
  padding: 0 1mm;
  display: flex;
  justify-content: center;
  align-items: center;
  overflow: hidden;
}
.footer-bc .bc-svg svg {
  width: ${compactLabel ? '50mm' : '56mm'} !important;
  max-width: ${compactLabel ? '50mm' : '56mm'} !important;
  height: ${ultraCompactLabel ? '7.5mm' : compactLabel ? '8.5mm' : '10mm'} !important;
  display: block;
}
.footer-bc .bc-text {
  font-family: Consolas, monospace;
  font-size: ${ultraCompactLabel ? '2.4mm' : '2.6mm'};
  font-weight: 700;
  letter-spacing: 0.18mm;
  line-height: 1.15;
  margin-top: 0.2mm;
  padding-bottom: 0.15mm;
  max-width: 62mm;
  margin-left: auto;
  margin-right: auto;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.qr { display: flex; align-items: center; justify-content: center; }
.qr svg {
  width: ${compactLabel ? '18mm' : '22mm'} !important;
  height: ${compactLabel ? '18mm' : '22mm'} !important;
  max-width: ${compactLabel ? '18mm' : '22mm'} !important;
  opacity: 1 !important;
  shape-rendering: crispEdges;
}
.qr svg path,
.qr svg rect {
  fill-opacity: 1 !important;
  opacity: 1 !important;
}

.disc {
  flex-shrink: 0;
  border-top: 0.25mm solid #000;
  margin-top: 0;
  padding: 0.45mm 1.5mm 0.3mm;
  text-align: center;
  font-size: ${ultraCompactLabel ? '4.8pt' : '5.2pt'};
  font-weight: 700;
  letter-spacing: 0.12pt;
  line-height: 1.2;
  color: #000;
}
</style>
</head>
<body>${labelsHtml}</body>
</html>`;
}

/**
 * buildSingleRollPrintHtml — convenience wrapper for the "auto-print after save"
 * flow used by `CreateItem.tsx` and `CreateRoll.tsx`. Builds a one-label
 * print document directly from a plain object, without going through the
 * server-side preview API.
 *
 * The shape mirrors `RollLabelPreviewDto` so the same template code can render
 * labels for both already-persisted rolls and freshly-entered form values.
 */
export interface AdHocLabelInput {
  barcode: string;
  qrPayload?: string;
  rollNo?: string | null;
  itemName?: string | null;
  internalCode?: string | null;
  supplierCode?: string | null;
  colorNameAr?: string | null;
  colorNameTr?: string | null;
  colorCode?: string | null;
  lengthM?: number | null;
  widthCm?: number | null;
  gsm?: number | null;
  actualWeightKg?: number | null;
  calculatedWeightKg?: number | null;
  warehouseName?: string | null;
  batchNo?: string | null;
  containerNo?: string | null;
  purchaseInvoiceNo?: string | null;
  supplierRollRef?: string | null;
}

export function buildSingleRollPrintHtml(
  input: AdHocLabelInput,
  opts: {
    widthMm?: number;
    heightMm?: number;
    config?: LabelConfig;
    qrSvg?: string;
    rollLayout?: 'auto' | 'normal' | 'wide';
  } = {},
): string {
  const dto: RollLabelPreviewDto = {
    rollId:            input.barcode,
    barcode:           input.barcode,
    qrPayload:         input.qrPayload ?? input.barcode,
    rollNo:            input.rollNo            ?? null,
    itemName:          input.itemName          ?? null,
    internalCode:      input.internalCode      ?? null,
    supplierCode:      input.supplierCode      ?? null,
    colorNameAr:       input.colorNameAr       ?? null,
    colorNameTr:       input.colorNameTr       ?? null,
    colorCode:         input.colorCode         ?? null,
    supplierColorCode: null,
    variantCode:       null,
    lengthM:            input.lengthM            ?? null,
    widthCm:            input.widthCm            ?? null,
    gsm:                input.gsm                ?? null,
    calculatedWeightKg: input.calculatedWeightKg ?? null,
    actualWeightKg:     input.actualWeightKg     ?? null,
    supplierName:       null,
    warehouseName:      input.warehouseName      ?? null,
    locationName:       null,
    batchNo:            input.batchNo            ?? null,
    containerNo:        input.containerNo        ?? null,
    purchaseInvoiceNo:  input.purchaseInvoiceNo  ?? null,
    supplierRollRef:    input.supplierRollRef    ?? null,
    status:             'AVAILABLE',
    currencyCode:       null,
    unitCost:           null,
  };

  return buildPrintDocument([dto], {
    widthMm:  opts.widthMm  ?? 80,
    heightMm: opts.heightMm ?? 60,
    pageSize: 'label',
    config:   opts.config,
    qrSvgs:   opts.qrSvg ? { [dto.rollId]: opts.qrSvg } : {},
    rollLayout: opts.rollLayout ?? 'normal',
  });
}
