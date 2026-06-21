import { BRAND } from '../../branding';

/** CSS url() for logo mask — avoids filter dark box on transparent PNG areas. */
function logoMaskUrl(): string {
  return `url("${String(BRAND.logoInline).replace(/"/g, '\\"')}")`;
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

/** Inline styles for mask-based thermal logo (screen preview + print HTML). */
export function thermalLogoMaskStyle(heightMm: number, maxWidthMm: number): string {
  const mask = logoMaskUrl();
  return [
    `height:${heightMm}mm`,
    `width:${maxWidthMm}mm`,
    `max-width:${maxWidthMm}mm`,
    'display:block',
    'margin:0 auto',
    'background-color:#000',
    `mask-image:${mask}`,
    `-webkit-mask-image:${mask}`,
    'mask-size:contain',
    '-webkit-mask-size:contain',
    'mask-repeat:no-repeat',
    '-webkit-mask-repeat:no-repeat',
    'mask-position:center',
    '-webkit-mask-position:center',
  ].join(';');
}

export function thermalLogoMaskReactStyle(heightMm: number, maxWidthMm: number): Record<string, string | number> {
  const mask = logoMaskUrl();
  return {
    height: `${heightMm}mm`,
    width: `${maxWidthMm}mm`,
    maxWidth: `${maxWidthMm}mm`,
    display: 'block',
    margin: '0 auto',
    backgroundColor: '#000',
    maskImage: mask,
    WebkitMaskImage: mask,
    maskSize: 'contain',
    WebkitMaskSize: 'contain',
    maskRepeat: 'no-repeat',
    WebkitMaskRepeat: 'no-repeat',
    maskPosition: 'center',
    WebkitMaskPosition: 'center',
  };
}

export function thermalBrandLogoHtml(opts: ThermalBrandLogoOptions = {}): string {
  const compact = opts.compact ?? false;
  const heightMm = opts.heightMm ?? thermalBrandLogoHeightMm(compact);
  const maxWidthMm = opts.maxWidthMm ?? thermalBrandLogoMaxWidthMm(compact);
  const alt = BRAND.name.replace(/"/g, '&quot;');
  return `<div class="brand-logo" role="img" aria-label="${alt}" style="${thermalLogoMaskStyle(heightMm, maxWidthMm)}"></div>`;
}

export function thermalBrandLogoClassCss(opts: ThermalBrandLogoOptions = {}): string {
  const compact = opts.compact ?? false;
  const heightMm = opts.heightMm ?? thermalBrandLogoHeightMm(compact);
  const maxWidthMm = opts.maxWidthMm ?? thermalBrandLogoMaxWidthMm(compact);
  const mask = logoMaskUrl();
  return `
    .brand-logo {
      height: ${heightMm}mm;
      width: ${maxWidthMm}mm;
      max-width: ${maxWidthMm}mm;
      display: block;
      margin: 0 auto;
      background-color: #000;
      mask-image: ${mask};
      -webkit-mask-image: ${mask};
      mask-size: contain;
      -webkit-mask-size: contain;
      mask-repeat: no-repeat;
      -webkit-mask-repeat: no-repeat;
      mask-position: center;
      -webkit-mask-position: center;
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
