/**
 * Single source of truth for the project's brand identity.
 *
 * To rebrand the app, change only this file (and re-run any backend seed
 * if the company name needs to change in the DB).
 */

import brandMarkUrl from '../logo.png?url';
import brandMarkInline from '../logo.png?inline';

export const BRAND = {
  /** Primary product/brand mark (the big word in the logo). */
  name: 'CLOTEX',
  /** Tagline directly under the mark on the logo. */
  tagline: 'CLOTHES TEXTILE',
  /** Long product name used in installers, window titles, etc. */
  fullName: 'CLOTEX — Clothes Textile',
  /** Short Arabic descriptor used as a subtitle/description. */
  descriptionAr: 'نظام إدارة مستودعات الأقمشة',
  /** Long English descriptor used in metadata and installers. */
  descriptionEn: 'CLOTEX — Clothes Textile Warehouse ERP',
  /** Brand color tokens (matches the navy in the logo image). */
  primaryColor: '#2C405A',
  primaryColorSoft: '#5B6B82',
  /** Resolved asset URLs (Vite `?url` — works with Electron `file://` and `base: './'). */
  logoPng: brandMarkUrl,
  /** Inline data URI for print/PDF HTML contexts where file URLs may fail. */
  logoInline: brandMarkInline,
  logoSvg: brandMarkUrl,
  /** Copyright holder shown in footers. */
  copyrightHolder: 'CLOTEX',
} as const;

export type Brand = typeof BRAND;
