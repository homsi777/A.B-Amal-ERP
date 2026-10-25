import type { PoolClient } from 'pg';

export type FabricItemCartelaSpecs = {
  compositionLines: unknown[];
  careSymbols: string[];
  widthValue: string;
  widthUnit: string;
  widthToleranceEnabled: boolean;
  widthTolerancePercent: number;
  weightValue: string;
  weightUnit: string;
  weightToleranceEnabled: boolean;
  weightTolerancePercent: number;
};

/**
 * يحفظ مواصفات الكارتيله (تركيب/عرض/وزن/تحمّل/رموز عناية) على سجل الخامة
 * نفسها — لتُسحَب تلقائياً عند إنشاء أي كارتيله تالية لنفس الخامة، بدل
 * تكرار إدخالها يدوياً. يُستدعى فقط عند إنشاء كارتيله مرتبطة بخامة حقيقية
 * (fabricItemId موجود) — لا علاقة له بالكارتيلات القديمة غير المرتبطة.
 */
export async function upsertFabricItemCartelaSpecs(
  client: PoolClient,
  companyId: string,
  itemId: string,
  specs: FabricItemCartelaSpecs,
): Promise<void> {
  await client.query(
    `UPDATE fabric_items
     SET composition_lines=$3::jsonb, care_symbols=$4::jsonb,
         width_value=$5, width_unit=$6, width_tolerance_enabled=$7, width_tolerance_percent=$8,
         weight_value=$9, weight_unit=$10, weight_tolerance_enabled=$11, weight_tolerance_percent=$12,
         updated_at=now()
     WHERE id=$1 AND company_id=$2`,
    [
      itemId, companyId,
      JSON.stringify(specs.compositionLines), JSON.stringify(specs.careSymbols),
      specs.widthValue, specs.widthUnit, specs.widthToleranceEnabled, specs.widthTolerancePercent,
      specs.weightValue, specs.weightUnit, specs.weightToleranceEnabled, specs.weightTolerancePercent,
    ],
  );
}
