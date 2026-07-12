#!/bin/bash
cd ~/ab-amal-erp && export $(grep -v '^#' server/.env | grep DATABASE_URL | xargs)

psql "$DATABASE_URL" <<'SQL'
-- Rolls on WİNTER Clo1 item: design code in metadata vs item code
SELECT fi.name, fi.internal_code,
  COUNT(*) AS rolls,
  COUNT(*) FILTER (WHERE fr.import_batch_id IS NULL) AS no_batch,
  COUNT(*) FILTER (WHERE fr.import_batch_id IS NOT NULL) AS from_import
FROM fabric_rolls fr
JOIN fabric_items fi ON fi.id = fr.item_id
WHERE fi.id = '680649e5-479d-4ef1-ad6f-d37d3f8af425'
  AND fr.status IN ('AVAILABLE','RESERVED')
GROUP BY fi.name, fi.internal_code;

-- Mismatch: roll linked to item but internal_code != expected from barcode prefix patterns
\echo '=== Active rolls where item internal_code looks wrong vs import row design ==='
SELECT fi.id, fi.name, fi.internal_code, fi.supplier_code,
       pir.normalized_data->>'supplierMaterialCode' AS excel_desen,
       pir.normalized_data->>'materialName' AS excel_name,
       COUNT(DISTINCT fr.id) AS rolls
FROM fabric_rolls fr
JOIN fabric_items fi ON fi.id = fr.item_id
JOIN purchase_import_rows pir ON pir.created_roll_id = fr.id
WHERE fr.status IN ('AVAILABLE','RESERVED','INACTIVE')
  AND pir.batch_id IN ('6a38ba26-15c7-4e13-9c9d-df64b07dec88','8414a2dd-a20d-4cfd-ba3e-777f123d5785')
  AND pir.normalized_data->>'supplierMaterialCode' IS NOT NULL
  AND lower(trim(COALESCE(fi.internal_code,''))) <> lower(trim(pir.normalized_data->>'supplierMaterialCode'))
  AND lower(trim(COALESCE(fi.supplier_code,''))) <> lower(trim(pir.normalized_data->>'supplierMaterialCode'))
GROUP BY 1,2,3,4,5,6
ORDER BY rolls DESC
LIMIT 25;

\echo '=== Items updated Jul12 with pre-Jul7 rolls (created before first bad import) ==='
SELECT fi.id, fi.name, fi.internal_code,
       COUNT(*) FILTER (WHERE fr.created_at < '2026-07-07') AS old_rolls,
       COUNT(*) FILTER (WHERE fr.status IN ('AVAILABLE','RESERVED')) AS active
FROM fabric_items fi
JOIN fabric_rolls fr ON fr.item_id = fi.id
WHERE fi.updated_at::date = '2026-07-12'
GROUP BY fi.id, fi.name, fi.internal_code
HAVING COUNT(*) FILTER (WHERE fr.created_at < '2026-07-07') > 0
ORDER BY old_rolls DESC
LIMIT 20;

\echo '=== fabric_items with name != L1 category name ==='
SELECT fi.id, fi.name AS item_name, fc.name AS cat_l1, fi.internal_code
FROM fabric_items fi
JOIN fabric_rolls fr ON fr.item_id = fi.id AND fr.status IN ('AVAILABLE','RESERVED')
JOIN fabric_categories fc ON fc.id = (
  SELECT c.id FROM fabric_categories c
  WHERE c.company_id = fi.company_id AND c.parent_id IS NULL
    AND lower(trim(c.name)) = lower(trim(split_part(fi.name, ' ', 1)))
  LIMIT 1
)
WHERE fi.updated_at::date >= '2026-07-11'
LIMIT 5;
SQL
