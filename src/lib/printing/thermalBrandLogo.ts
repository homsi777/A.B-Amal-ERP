import { BRAND } from '../../branding';

/**
 * يحوّل شعار CLOTEX (X ذهبي) إلى أسود للطباعة الحرارية.
 * brightness منخفض + contrast عالٍ حتى يظهر X بوضوح على الطابعات الحرارية.
 */
export const THERMAL_LOGO_FILTER = 'grayscale(100%) brightness(0.34) contrast(200%) saturate(0%)';

export function thermalLogoInlineStyle(heightMm: number, maxWidthMm: number): string {
  return [
    `height:${heightMm}mm`,
    `max-width:${maxWidthMm}mm`,
    'width:auto',
    'object-fit:contain',
    'display:block',
    'margin:0 auto',
    `filter:${THERMAL_LOGO_FILTER}`,
    `-webkit-filter:${THERMAL_LOGO_FILTER}`,
  ].join(';');
}

export type ThermalBrandLogoOptions = {
  /** ارتفاع الشعار بالمليمتر */
  heightMm?: number;
  /** أقصى عرض بالمليمتر */
  maxWidthMm?: number;
  compact?: boolean;
};

export function thermalBrandLogoHeightMm(compact = false): number {
  return compact ? 14 : 18;
}

export function thermalBrandLogoMaxWidthMm(compact = false): number {
  return compact ? 72 : 82;
}

export function thermalBrandLogoHtml(opts: ThermalBrandLogoOptions = {}): string {
  const compact = opts.compact ?? false;
  const heightMm = opts.heightMm ?? thermalBrandLogoHeightMm(compact);
  const maxWidthMm = opts.maxWidthMm ?? thermalBrandLogoMaxWidthMm(compact);
  const alt = BRAND.name.replace(/"/g, '&quot;');
  return `<img class="brand-logo" src="${BRAND.logoInline}" alt="${alt}" style="${thermalLogoInlineStyle(heightMm, maxWidthMm)}" />`;
}

export function thermalBrandLogoBlockCss(opts: ThermalBrandLogoOptions = {}): string {
  const compact = opts.compact ?? false;
  const heightMm = opts.heightMm ?? thermalBrandLogoHeightMm(compact);
  const maxWidthMm = opts.maxWidthMm ?? thermalBrandLogoMaxWidthMm(compact);
  return `
    .brand {
      text-align: center;
      border-bottom: 0.25mm solid #000;
      padding-bottom: 1.2mm;
      margin-bottom: 1.4mm;
    }
    .brand-logo {
      height: ${heightMm}mm;
      width: auto;
      max-width: ${maxWidthMm}mm;
      object-fit: contain;
      display: block;
      margin: 0 auto;
      filter: ${THERMAL_LOGO_FILTER} !important;
      -webkit-filter: ${THERMAL_LOGO_FILTER} !important;
    }`;
}
