const PLACEHOLDER_HEX = new Set(['#000000', '#000']);

function isValidHexColor(value: string): boolean {
  return /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(value.trim());
}

function isPlaceholderHex(value: string): boolean {
  return PLACEHOLDER_HEX.has(value.trim().toLowerCase());
}

/** لون عرض للمربع الصغير بجانب اسم اللون في المخزون */
export function rollColorSwatch(roll: {
  hex_color?: string | null;
  color_code?: string | null;
  color_name_ar?: string | null;
  color_name_tr?: string | null;
}): string | null {
  const hex = String(roll.hex_color ?? '').trim();
  if (isValidHexColor(hex) && !isPlaceholderHex(hex)) return hex;

  const code = String(roll.color_code ?? '').trim();
  if (isValidHexColor(code) && !isPlaceholderHex(code)) return code;

  const name = String(roll.color_name_ar ?? roll.color_name_tr ?? '').trim();
  if (!name) return null;

  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 55%, 45%)`;
}
