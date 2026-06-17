import type { CartelaCareSymbolId } from './careSymbols';

const SVG_BY_ID: Record<CartelaCareSymbolId, string> = {
  wash_30:
    '<svg viewBox="0 0 24 24" class="sym"><path fill="none" stroke="#000" stroke-width="1.2" d="M4 7h16v11H4z"/><path d="M6 10h12M6 13h8" stroke="#000" stroke-width="1"/><text x="12" y="16" text-anchor="middle" font-size="7" font-weight="700">30</text></svg>',
  wash_40:
    '<svg viewBox="0 0 24 24" class="sym"><path fill="none" stroke="#000" stroke-width="1.2" d="M4 7h16v11H4z"/><text x="12" y="16" text-anchor="middle" font-size="7" font-weight="700">40</text></svg>',
  wash_60:
    '<svg viewBox="0 0 24 24" class="sym"><path fill="none" stroke="#000" stroke-width="1.2" d="M4 7h16v11H4z"/><text x="12" y="16" text-anchor="middle" font-size="7" font-weight="700">60</text></svg>',
  iron_low:
    '<svg viewBox="0 0 24 24" class="sym"><path d="M6 4l12 8-12 8V4z" fill="#000"/><circle cx="17" cy="6" r="1.2" fill="#fff"/></svg>',
  iron_medium:
    '<svg viewBox="0 0 24 24" class="sym"><path d="M6 4l12 8-12 8V4z" fill="#000"/><circle cx="17" cy="6" r="1.2" fill="#fff"/><circle cx="19" cy="6" r="1.2" fill="#fff"/></svg>',
  iron_high:
    '<svg viewBox="0 0 24 24" class="sym"><path d="M6 4l12 8-12 8V4z" fill="#000"/><circle cx="15.5" cy="6" r="1.1" fill="#fff"/><circle cx="17.5" cy="6" r="1.1" fill="#fff"/><circle cx="19.5" cy="6" r="1.1" fill="#fff"/></svg>',
  no_bleach:
    '<svg viewBox="0 0 24 24" class="sym"><polygon points="12,3 21,20 3,20" fill="none" stroke="#000" stroke-width="1.2"/><line x1="5" y1="8" x2="19" y2="16" stroke="#000" stroke-width="1.8"/></svg>',
  no_tumble_dry:
    '<svg viewBox="0 0 24 24" class="sym"><rect x="5" y="5" width="14" height="14" fill="none" stroke="#000" stroke-width="1.2"/><circle cx="12" cy="12" r="5" fill="none" stroke="#000" stroke-width="1.2"/><line x1="6" y1="6" x2="18" y2="18" stroke="#000" stroke-width="1.8"/></svg>',
  tumble_dry:
    '<svg viewBox="0 0 24 24" class="sym"><rect x="5" y="5" width="14" height="14" fill="none" stroke="#000" stroke-width="1.2"/><circle cx="12" cy="12" r="5" fill="none" stroke="#000" stroke-width="1.2"/></svg>',
  dry_clean_p:
    '<svg viewBox="0 0 24 24" class="sym"><circle cx="12" cy="12" r="9" fill="none" stroke="#000" stroke-width="1.2"/><text x="12" y="15" text-anchor="middle" font-size="8" font-weight="700">P</text></svg>',
  dry_clean_f:
    '<svg viewBox="0 0 24 24" class="sym"><circle cx="12" cy="12" r="9" fill="none" stroke="#000" stroke-width="1.2"/><text x="12" y="15" text-anchor="middle" font-size="8" font-weight="700">F</text></svg>',
  line_dry:
    '<svg viewBox="0 0 24 24" class="sym"><rect x="4" y="10" width="16" height="2" fill="#000"/><path d="M8 12v6M12 12v8M16 12v6" stroke="#000" stroke-width="1.2"/></svg>',
};

export function renderCareSymbolsHtml(selected: string[]): string {
  const ids = selected.filter((id): id is CartelaCareSymbolId => id in SVG_BY_ID);
  if (!ids.length) return '';
  return `<div class="care" aria-hidden="true">${ids.map((id) => SVG_BY_ID[id]).join('')}</div>`;
}
