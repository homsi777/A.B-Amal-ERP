#!/bin/bash
cd ~/ab-amal-erp && export $(grep -v '^#' server/.env | grep DATABASE_URL | xargs)
BATCH12='52d9c5e6-6ad4-41fa-a015-be0ee9c4307f'
BATCH11='6a38ba26-15c7-4e13-9c9d-df64b07dec88'

psql "$DATABASE_URL" <<SQL
-- Items touched by Jul12 import rows
\echo '=== Jul12 touched items vs active rolls not from Jul12 ==='
SELECT fi.id, fi.name, fi.internal_code, fi.supplier_code,
       fi.updated_at::date AS upd,
       COUNT(*) FILTER (WHERE fr.import_batch_id = '$BATCH12') AS rolls_batch12,
       COUNT(*) FILTER (WHERE fr.import_batch_id IS DISTINCT FROM '$BATCH12' AND fr.status IN ('AVAILABLE','RESERVED')) AS other_active
FROM fabric_items fi
JOIN purchase_import_rows pir ON pir.matched_item_id = fi.id AND pir.batch_id = '$BATCH12'
LEFT JOIN fabric_rolls fr ON fr.item_id = fi.id
GROUP BY fi.id, fi.name, fi.internal_code, fi.supplier_code, fi.updated_at
ORDER BY other_active DESC, fi.name;

\echo '=== Name from Jul11 import rows for same item ids ==='
SELECT fi.id, fi.name AS current_name, fi.internal_code,
       string_agg(DISTINCT pir.normalized_data->>'materialName', ' | ') AS jul11_excel_names
FROM fabric_items fi
JOIN purchase_import_rows pir ON pir.matched_item_id = fi.id AND pir.batch_id = '$BATCH11'
WHERE fi.id IN (SELECT DISTINCT matched_item_id FROM purchase_import_rows WHERE batch_id='$BATCH12' AND matched_item_id IS NOT NULL)
GROUP BY fi.id, fi.name, fi.internal_code
ORDER BY fi.name;

\echo '=== Items where current name differs from Jul11 excel name ==='
WITH j11 AS (
  SELECT matched_item_id AS item_id,
         mode() WITHIN GROUP (ORDER BY normalized_data->>'materialName') AS name_j11
  FROM purchase_import_rows
  WHERE batch_id='$BATCH11' AND matched_item_id IS NOT NULL
  GROUP BY matched_item_id
)
SELECT fi.id, fi.name AS current_name, j11.name_j11 AS should_be_name, fi.internal_code,
       (SELECT COUNT(*) FROM fabric_rolls fr WHERE fr.item_id=fi.id AND fr.status IN ('AVAILABLE','RESERVED')) AS active_rolls
FROM fabric_items fi
JOIN j11 ON j11.item_id = fi.id
WHERE lower(trim(fi.name)) <> lower(trim(j11.name_j11))
ORDER BY active_rolls DESC;

\echo '=== Duplicate / suspicious names (WINTER, ROYAL) ==='
SELECT name, internal_code, supplier_code, id
FROM fabric_items
WHERE lower(name) LIKE '%winter%' OR lower(name) LIKE '%royal%' OR lower(name) LIKE '%sardon%'
ORDER BY name, internal_code;
SQL
