/** عرض رقم الطلبية — أرقام فقط (يدعم التنسيق القديم CO0000123). */
export function displayCustomerOrderNumber(orderNo: string): string {
  const trimmed = String(orderNo ?? '').trim();
  const legacy = trimmed.match(/^CO0*(\d+)$/i);
  if (legacy) return legacy[1];
  return trimmed;
}
