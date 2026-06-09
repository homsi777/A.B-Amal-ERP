/**
 * Offline QR code generator — no external network requests.
 *
 * Uses the `qrcode` npm package which runs entirely in-browser and in Node.js.
 * Replaces the previous qrserver.com dependency in buildPrintDocument().
 *
 * Phase 5 issue fixed here: generated print HTML no longer contains
 * https://api.qrserver.com URLs.
 */

export interface QrOptions {
  /** Output pixel size (default 40) */
  size?: number;
  /** Quiet zone modules (default 0) */
  margin?: number;
  /** Dark module color (default #000000) */
  darkColor?: string;
  /** Light module color (default #ffffff) */
  lightColor?: string;
}

/**
 * Generate an SVG string for a single QR code payload.
 * Returns a complete <svg>...</svg> string suitable for embedding inline in HTML.
 */
export async function generateQrSvg(text: string, opts: QrOptions = {}): Promise<string> {
  const { size = 40, margin = 1, darkColor = '#000000', lightColor = '#ffffff' } = opts;
  const QRCode = await import('qrcode');
  const svg = await QRCode.default.toString(text, {
    type: 'svg',
    width: size,
    margin,
    errorCorrectionLevel: 'M',
    color: { dark: darkColor, light: lightColor },
  });
  return svg;
}

/**
 * Batch-generate QR SVG strings for multiple rolls.
 * Returns a map of rollId -> SVG string.
 */
export async function generateQrSvgMap(
  rolls: Array<{ rollId: string; qrPayload: string }>,
  opts: QrOptions = {},
): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  await Promise.all(
    rolls.map(async (roll) => {
      map[roll.rollId] = await generateQrSvg(roll.qrPayload, opts);
    }),
  );
  return map;
}
