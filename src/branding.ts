/**
 * هوية Alamal Trading — مصدر واحد للعلامة في الواجهة والمطبوعات.
 */

import brandMarkUrl from '../logo.png?url';
import brandMarkInline from '../logo.png?inline';

export const BRAND = {
  name: 'Alamal Trading',
  nameAr: 'أملام للتجارة',
  tagline: 'DENIM & TEXTILE',
  fullName: 'Alamal Trading — Denim & Textile',
  descriptionAr: 'نظام إدارة جملة الأقمشة — دينيم وتكستيل',
  descriptionEn: 'Alamal Trading Wholesale Denim & Textile ERP',
  primaryColor: '#C9A227',
  primaryColorSoft: '#A0B0B9',
  logoBg: '#000000',
  logoPng: brandMarkUrl,
  logoInline: brandMarkInline,
  logoSvg: brandMarkUrl,
  copyrightHolder: 'Alamal Trading',
} as const;

export type Brand = typeof BRAND;
