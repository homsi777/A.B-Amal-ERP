/**
 * هوية ALamal-AB Obada — مصدر واحد للعلامة في الواجهة والمطبوعات.
 */

import brandMarkUrl from '../logo.png?url';
import brandMarkInline from '../logo.png?inline';

export const BRAND = {
  name: 'ALamal-AB',
  nameAr: 'الامل.AB',
  tagline: 'DENIM & TEXTILE',
  fullName: 'ALamal-AB — Denim & Textile',
  descriptionAr: 'نظام إدارة جملة الأقمشة — دينيم وتكستيل',
  descriptionEn: 'ALamal-AB Wholesale Denim & Textile ERP',
  primaryColor: '#B8956B',
  primaryColorSoft: '#8B7355',
  logoPng: brandMarkUrl,
  logoInline: brandMarkInline,
  logoSvg: brandMarkUrl,
  copyrightHolder: 'Alamal Trading',
} as const;

export type Brand = typeof BRAND;
