import { getPool } from '../db/pool.js';

/** تصنيف عملياتي مبسَّط لكل حركة — يُشتق من reference_type أولاً (الأدق)،
 * ثم movement_type كاحتياط. لا يغيّر أي بيانات، للعرض/الفلترة فقط. */
export type MovementKind =
  | 'PURCHASE' | 'SALE' | 'PROCESSING' | 'RETURN' | 'TRANSFER' | 'WASTE' | 'MANUAL' | 'INTAKE' | 'OTHER';

/** يُحسَب بالـSQL مباشرة (بدل جلب كل الصفوف وفلترتها بالتطبيق) — تصنيف
 * يطابق منطق القسم الموزَّع بالخدمات الأخرى حرفياً. */
const MOVEMENT_KIND_CASE_SQL = `
  CASE
    WHEN im.reference_type IN ('PURCHASE_INVOICE', 'PURCHASE_INVOICE_VOID') THEN 'PURCHASE'
    WHEN im.reference_type = 'SALES_INVOICE' THEN 'SALE'
    WHEN im.reference_type IN ('EXTERNAL_JOB', 'EXTERNAL_JOB_VOID') THEN 'PROCESSING'
    WHEN im.reference_type IN ('RETURN_INVOICE', 'RETURN_INVOICE_REVERSAL') THEN 'RETURN'
    WHEN im.reference_type = 'INVENTORY_TRANSFER' THEN 'TRANSFER'
    WHEN im.reference_type = 'INVENTORY_WASTE' THEN 'WASTE'
    WHEN im.reference_type = 'INTAKE_OPERATION' THEN 'INTAKE'
    WHEN im.movement_type = 'MANUAL_CREATE' THEN 'MANUAL'
    WHEN im.movement_type IN ('TRANSFER_OUT', 'TRANSFER_IN') THEN 'TRANSFER'
    WHEN im.movement_type = 'DAMAGE' THEN 'WASTE'
    ELSE 'OTHER'
  END
`;

/** مسار الانتقال المباشر لمصدر الحركة. كل حركة مرتبطة بتوب دائماً (roll_id
 * غير فارغ أبداً)، فهذا يبقى احتياطاً مضموناً دائماً حتى لو كان reference_type
 * غير موجود أو غير معروف — تعرض شاشة التوب كامل تفاصيله وتاريخه وإمكانية تعديله. */
function resolveSourceLink(referenceType: string | null, referenceId: string | null, rollId: string): string {
  if (referenceId) {
    if (referenceType === 'EXTERNAL_JOB' || referenceType === 'EXTERNAL_JOB_VOID') {
      return `/purchases/external-jobs/${referenceId}`;
    }
    if (referenceType === 'SALES_INVOICE') return `/invoices/sales/${referenceId}/edit`;
    if (referenceType === 'PURCHASE_INVOICE' || referenceType === 'PURCHASE_INVOICE_VOID') {
      return `/invoices/purchases/${referenceId}/edit`;
    }
  }
  if (referenceType === 'RETURN_INVOICE' || referenceType === 'RETURN_INVOICE_REVERSAL') return '/invoices/returns';
  if (referenceType === 'INVENTORY_TRANSFER') return '/inventory/transfers';
  if (referenceType === 'INTAKE_OPERATION') return '/inventory/intake-dispatch-slips';
  return `/inventory/rolls/${rollId}`;
}

export type InventoryMovementLogRow = {
  id: string;
  movement_no: number;
  movement_at: string;
  movement_type: string;
  movement_kind: MovementKind;
  barcode: string;
  item_name: string;
  color_name: string;
  length_delta_m: string | number | null;
  weight_delta_kg: string | number | null;
  from_warehouse_name: string | null;
  to_warehouse_name: string | null;
  reference_type: string | null;
  reference_no: string | null;
  notes: string | null;
  created_by_name: string | null;
  source_link: string;
};

export type InventoryMovementsLogFilters = {
  movementKind?: string;
  warehouseId?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  /** تصفية دقيقة لكل حركات مستند واحد فقط — تُستخدَم للدخول لتفاصيل مستند
   * من الشاشة المجمَّعة بالمستندات (كل سطر = مستند، لا توب). */
  referenceType?: string;
  referenceId?: string;
  page?: number;
  pageSize?: number;
};

export async function listInventoryMovementsLog(
  companyId: string,
  filters: InventoryMovementsLogFilters,
): Promise<{ rows: InventoryMovementLogRow[]; total: number; page: number; pageSize: number }> {
  const pool = getPool();
  const page = Math.max(1, Number(filters.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(filters.pageSize) || 50));
  const offset = (page - 1) * pageSize;

  // كل الفلاتر تُطبَّق هنا، على مستوى inventory_movements مباشرة (im)، قبل
  // حساب الترقيم المتسلسل — لكن الترقيم (movement_no) نفسه يُحسَب أولاً بمعزل
  // عن أي فلتر (بالـCTE n) حتى لا يتغيّر رقم حركة معيّنة حسب الفلاتر الظاهرة.
  const conditions: string[] = ['n.company_id = $1'];
  const params: unknown[] = [companyId];
  let p = 2;

  if (filters.movementKind) {
    conditions.push(`n.movement_kind = $${p}`);
    params.push(filters.movementKind);
    p++;
  }
  if (filters.warehouseId) {
    conditions.push(`(n.from_warehouse_id = $${p} OR n.to_warehouse_id = $${p})`);
    params.push(filters.warehouseId);
    p++;
  }
  if (filters.dateFrom) {
    conditions.push(`n.created_at::date >= $${p}::date`);
    params.push(filters.dateFrom);
    p++;
  }
  if (filters.dateTo) {
    conditions.push(`n.created_at::date <= $${p}::date`);
    params.push(filters.dateTo);
    p++;
  }
  if (filters.referenceType) {
    conditions.push(`n.reference_type = $${p}`);
    params.push(filters.referenceType);
    p++;
  }
  if (filters.referenceId) {
    conditions.push(`n.reference_id = $${p}`);
    params.push(filters.referenceId);
    p++;
  }
  if (filters.search) {
    conditions.push(
      `(fr.barcode ILIKE $${p} OR COALESCE(n.reference_no,'') ILIKE $${p} OR COALESCE(n.notes,'') ILIKE $${p} OR fi.name ILIKE $${p})`,
    );
    params.push(`%${filters.search}%`);
    p++;
  }

  const where = conditions.join(' AND ');

  const baseCte = `
    WITH n AS (
      SELECT im.*, ${MOVEMENT_KIND_CASE_SQL} AS movement_kind,
             ROW_NUMBER() OVER (PARTITION BY im.company_id ORDER BY im.created_at, im.id) AS movement_no
      FROM inventory_movements im
      WHERE im.company_id = $1
    )
  `;

  const countQ = await pool.query<{ c: string }>(
    `${baseCte}
     SELECT COUNT(*)::int AS c
     FROM n
     JOIN fabric_rolls fr ON fr.id = n.roll_id AND fr.company_id = n.company_id
     JOIN fabric_items fi ON fi.id = fr.item_id AND fi.company_id = fr.company_id
     WHERE ${where}`,
    params,
  );

  const dataQ = await pool.query(
    `${baseCte}
     SELECT n.id, n.movement_no, n.created_at AS movement_at, n.movement_type, n.movement_kind,
            fr.barcode, fi.name AS item_name,
            COALESCE(fc.name_ar, fc.name_tr, '') AS color_name,
            n.length_delta_m, n.weight_delta_kg,
            fw.name AS from_warehouse_name, tw.name AS to_warehouse_name,
            n.reference_type, n.reference_id, n.reference_no, n.notes, n.roll_id,
            u.full_name AS created_by_name
     FROM n
     JOIN fabric_rolls fr ON fr.id = n.roll_id AND fr.company_id = n.company_id
     JOIN fabric_items fi ON fi.id = fr.item_id AND fi.company_id = fr.company_id
     LEFT JOIN fabric_colors fc ON fc.id = fr.color_id
     LEFT JOIN warehouses fw ON fw.id = n.from_warehouse_id
     LEFT JOIN warehouses tw ON tw.id = n.to_warehouse_id
     LEFT JOIN users u ON u.id = n.created_by_user_id
     WHERE ${where}
     ORDER BY n.movement_no DESC
     LIMIT $${p} OFFSET $${p + 1}`,
    [...params, pageSize, offset],
  );

  const rows = (dataQ.rows as Record<string, unknown>[]).map((r) => {
    const referenceType = (r.reference_type as string | null) ?? null;
    return {
      id: String(r.id),
      movement_no: Number(r.movement_no),
      movement_at: String(r.movement_at),
      movement_type: String(r.movement_type),
      movement_kind: r.movement_kind as MovementKind,
      barcode: String(r.barcode),
      item_name: String(r.item_name),
      color_name: String(r.color_name ?? ''),
      length_delta_m: r.length_delta_m as string | number | null,
      weight_delta_kg: r.weight_delta_kg as string | number | null,
      from_warehouse_name: (r.from_warehouse_name as string | null) ?? null,
      to_warehouse_name: (r.to_warehouse_name as string | null) ?? null,
      reference_type: referenceType,
      reference_no: (r.reference_no as string | null) ?? null,
      notes: (r.notes as string | null) ?? null,
      created_by_name: (r.created_by_name as string | null) ?? null,
      source_link: resolveSourceLink(referenceType, (r.reference_id as string | null) ?? null, String(r.roll_id)),
    } satisfies InventoryMovementLogRow;
  });

  return { rows, total: Number(countQ.rows[0]?.c ?? 0), page, pageSize };
}
