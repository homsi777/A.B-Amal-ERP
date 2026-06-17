import type { CartelaCareSymbolId } from './careSymbols';

import wash30 from '../../assets/care-symbols/wash_30.svg?raw';
import wash40 from '../../assets/care-symbols/wash_40.svg?raw';
import wash60 from '../../assets/care-symbols/wash_60.svg?raw';
import ironLow from '../../assets/care-symbols/iron_low.svg?raw';
import ironMedium from '../../assets/care-symbols/iron_medium.svg?raw';
import ironHigh from '../../assets/care-symbols/iron_high.svg?raw';
import noBleach from '../../assets/care-symbols/no_bleach.svg?raw';
import noTumbleDry from '../../assets/care-symbols/no_tumble_dry.svg?raw';
import tumbleDry from '../../assets/care-symbols/tumble_dry.svg?raw';
import dryCleanP from '../../assets/care-symbols/dry_clean_p.svg?raw';
import dryCleanF from '../../assets/care-symbols/dry_clean_f.svg?raw';
import lineDry from '../../assets/care-symbols/line_dry.svg?raw';

/** ISO 3758 / GINETEX-style symbols (Wikimedia Commons reference, black for thermal). */
const SVG_RAW_BY_ID: Record<CartelaCareSymbolId, string> = {
  wash_30: wash30,
  wash_40: wash40,
  wash_60: wash60,
  iron_low: ironLow,
  iron_medium: ironMedium,
  iron_high: ironHigh,
  no_bleach: noBleach,
  no_tumble_dry: noTumbleDry,
  tumble_dry: tumbleDry,
  dry_clean_p: dryCleanP,
  dry_clean_f: dryCleanF,
  line_dry: lineDry,
};

function inlineCareSvg(raw: string): string {
  const inner = raw
    .replace(/<\?xml[^?]*\?>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim()
    .replace(/^<svg\b([^>]*)>/i, (_match, attrs: string) => {
      const viewBox = /viewBox="([^"]+)"/i.exec(attrs)?.[1] ?? '0 0 375 375';
      return `<svg class="sym" viewBox="${viewBox}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">`;
    });
  return inner;
}

const SVG_BY_ID: Record<CartelaCareSymbolId, string> = Object.fromEntries(
  (Object.entries(SVG_RAW_BY_ID) as Array<[CartelaCareSymbolId, string]>).map(([id, raw]) => [
    id,
    inlineCareSvg(raw),
  ]),
) as Record<CartelaCareSymbolId, string>;

export function getCareSymbolSvg(id: CartelaCareSymbolId): string {
  return SVG_BY_ID[id] ?? '';
}

export function renderCareSymbolsHtml(selected: string[]): string {
  const ids = selected.filter((id): id is CartelaCareSymbolId => id in SVG_BY_ID);
  if (!ids.length) return '';
  return `<div class="care" aria-hidden="true">${ids.map((id) => SVG_BY_ID[id]).join('')}</div>`;
}
