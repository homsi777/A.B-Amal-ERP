/** RFC4122 v4 — يعمل بدون Secure Context (HTTP على IP) */
function fallbackRandomUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** يُستدعى قبل React — crypto.randomUUID غير متاح على http://IP */
export function installCryptoPolyfill(): void {
  if (typeof globalThis === 'undefined') return;

  const existing = globalThis.crypto;
  if (existing && typeof existing.randomUUID === 'function') return;

  const randomUUID = () => fallbackRandomUUID();

  try {
    if (existing) {
      Object.defineProperty(existing, 'randomUUID', {
        value: randomUUID,
        writable: true,
        configurable: true,
      });
      return;
    }
  } catch {
    /* defineProperty may fail on some embeds */
  }

  try {
    (globalThis as { crypto: Crypto }).crypto = {
      ...(existing as Crypto | undefined),
      randomUUID,
    } as Crypto;
  } catch {
    (globalThis as { crypto: { randomUUID: () => string } }).crypto = { randomUUID };
  }
}

export function randomId(): string {
  try {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }
  } catch {
    /* ignore */
  }
  return fallbackRandomUUID();
}

installCryptoPolyfill();
