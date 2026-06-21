import { BRAND } from '../../branding';

/** أسود واضح للطباعة الحرارية — يُعرض في المعاينة والطباعة (WYSIWYG). */
export const THERMAL_LOGO_FILTER = 'grayscale(100%) brightness(0.34) contrast(200%) saturate(0%)';

export type ThermalBrandLogoOptions = {
  heightMm?: number;
  maxWidthMm?: number;
  compact?: boolean;
};

export function thermalBrandLogoHeightMm(compact = false): number {
  return compact ? 14 : 18;
}

export function thermalBrandLogoMaxWidthMm(compact = false): number {
  return compact ? 72 : 82;
}

export function thermalLogoImgStyle(heightMm: number, maxWidthMm: number): string {
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

export function thermalLogoImgReactStyle(heightMm: number, maxWidthMm: number): Record<string, string | number> {
  return {
    height: `${heightMm}mm`,
    maxWidth: `${maxWidthMm}mm`,
    width: 'auto',
    objectFit: 'contain',
    display: 'block',
    margin: '0 auto',
    filter: THERMAL_LOGO_FILTER,
    WebkitFilter: THERMAL_LOGO_FILTER,
  };
}

export function thermalBrandLogoHtml(opts: ThermalBrandLogoOptions = {}): string {
  const compact = opts.compact ?? false;
  const heightMm = opts.heightMm ?? thermalBrandLogoHeightMm(compact);
  const maxWidthMm = opts.maxWidthMm ?? thermalBrandLogoMaxWidthMm(compact);
  const alt = BRAND.name.replace(/"/g, '&quot;');
  return `<img class="brand-logo" src="${BRAND.logoInline}" alt="${alt}" style="${thermalLogoImgStyle(heightMm, maxWidthMm)}" />`;
}

export function thermalBrandLogoClassCss(opts: ThermalBrandLogoOptions = {}): string {
  const compact = opts.compact ?? false;
  const heightMm = opts.heightMm ?? thermalBrandLogoHeightMm(compact);
  const maxWidthMm = opts.maxWidthMm ?? thermalBrandLogoMaxWidthMm(compact);
  return `
    .brand-logo {
      height: ${heightMm}mm;
      max-width: ${maxWidthMm}mm;
      width: auto;
      object-fit: contain;
      display: block;
      margin: 0 auto;
      filter: ${THERMAL_LOGO_FILTER} !important;
      -webkit-filter: ${THERMAL_LOGO_FILTER} !important;
    }`;
}

export function thermalBrandLogoBlockCss(opts: ThermalBrandLogoOptions = {}): string {
  return `
    .brand {
      text-align: center;
      border-bottom: 0.25mm solid #000;
      padding-bottom: 1.2mm;
      margin-bottom: 1.4mm;
    }
    ${thermalBrandLogoClassCss(opts)}`;
}
