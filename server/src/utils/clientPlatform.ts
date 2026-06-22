export type ClientPlatformCode = 'windows-desktop' | 'mobile-browser' | 'desktop-browser';

const ALLOWED: ClientPlatformCode[] = ['windows-desktop', 'mobile-browser', 'desktop-browser'];

export function resolveClientPlatform(header: string | string[] | undefined, userAgent: string): ClientPlatformCode {
  const raw = Array.isArray(header) ? header[0] : header;
  const normalized = String(raw || '').trim().toLowerCase();
  if (ALLOWED.includes(normalized as ClientPlatformCode)) {
    return normalized as ClientPlatformCode;
  }

  const ua = String(userAgent || '').toLowerCase();
  if (ua.includes('electron') || ua.includes('fabric-erp-desktop')) {
    return 'windows-desktop';
  }
  if (/android|iphone|ipad|ipod|mobile|webos|blackberry/i.test(ua)) {
    return 'mobile-browser';
  }
  return 'desktop-browser';
}

export function clientPlatformLabel(code: ClientPlatformCode): string {
  switch (code) {
    case 'windows-desktop':
      return 'تطبيق ويندوز';
    case 'mobile-browser':
      return 'متصفح موبايل';
    case 'desktop-browser':
      return 'متصفح';
    default:
      return 'غير معروف';
  }
}
