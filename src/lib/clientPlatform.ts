export type ClientPlatformCode = 'windows-desktop' | 'mobile-browser' | 'desktop-browser';

export function detectClientPlatform(): ClientPlatformCode {
  if (typeof window !== 'undefined' && window.fabricApp?.isElectron) {
    return 'windows-desktop';
  }
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (/Android|iPhone|iPad|iPod|Mobile|webOS|BlackBerry/i.test(ua)) {
    return 'mobile-browser';
  }
  return 'desktop-browser';
}
