/** عرض رقم الطلبية — أرقام فقط (يدعم التنسيق القديم CO0000123). */
export function displayCustomerOrderNumber(orderNo: string): string {
  const trimmed = String(orderNo ?? '').trim();
  const legacy = trimmed.match(/^CO0*(\d+)$/i);
  if (legacy) return legacy[1];
  return trimmed;
}

/** رقم النقشة / DESIGN NO — لا نكرّر اسم الخامة */
export function orderLineDesignNo(line: {
  materialName?: string;
  rollNo?: string;
  dsamNumber?: string;
}): string {
  const name = (line.materialName || '').trim().toLowerCase();
  const roll = (line.rollNo || '').trim();
  const dsam = (line.dsamNumber || '').trim();
  if (roll && roll.toLowerCase() !== name) return roll;
  if (dsam && dsam.toLowerCase() !== name) return dsam;
  if (/^\d+([./]\d+)?$/.test(roll)) return roll;
  if (/^\d+([./]\d+)?$/.test(dsam)) return dsam;
  if (roll.toLowerCase() === name || dsam.toLowerCase() === name) return '—';
  return roll || dsam || '—';
}

/** عرض اللون في الطباعة — الاسم + كود اللون */
export function orderLineColorLabel(line: { colorCode?: string; colorName?: string }): string {
  const code = (line.colorCode || '').trim();
  const name = (line.colorName || '').trim();
  if (name && code) return `${name} · ${code}`;
  return name || code || '—';
}
