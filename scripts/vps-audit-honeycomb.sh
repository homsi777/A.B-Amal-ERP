#!/bin/bash
cd ~/ab-amal-erp && export $(grep -v '^#' server/.env | grep DATABASE_URL | xargs)
psql "$DATABASE_URL" <<'SQL'
\echo '=== fabric_items HONEYCOMB ==='
SELECT id, name, internal_code, supplier_code, is_active,
       (SELECT count(*) FROM fabric_rolls r WHERE r.item_id=fi.id AND r.status IN ('AVAILABLE','RESERVED')) AS live,
       (SELECT count(*) FROM fabric_rolls r WHERE r.item_id=fi.id) AS total
FROM fabric_items fi
WHERE name ILIKE '%honey%' OR internal_code ILIKE '%honey%'
ORDER BY name, internal_code;

\echo '=== All rolls that should be HONEYCOMB (aleppo rows 134-152) ==='
SELECT r.barcode, fi.name, fi.internal_code, fi.supplier_code, r.status,
       pir.normalized_data->>'materialCode' AS excel_code
FROM purchase_import_rows pir
JOIN fabric_rolls r ON r.id = pir.created_roll_id
JOIN fabric_items fi ON fi.id = r.item_id
WHERE pir.batch_id = '2baf30aa-dae7-4d48-95f3-9d1778616256'
  AND pir.row_no BETWEEN 134 AND 152
ORDER BY r.barcode;

\echo '=== HONEYCOMB name mismatches in full aleppo batch ==='
SELECT count(*) AS mismatch_count
FROM purchase_import_rows pir
JOIN fabric_rolls r ON r.id = pir.created_roll_id
JOIN fabric_items fi ON fi.id = r.item_id
WHERE pir.batch_id = '2baf30aa-dae7-4d48-95f3-9d1778616256'
  AND pir.normalized_data->>'materialName' ILIKE '%honey%'
  AND lower(trim(fi.name)) <> lower(trim(pir.normalized_data->>'materialName'));

\echo '=== Categories HONEYCOMB ==='
SELECT id, name, code, parent_id FROM fabric_categories
WHERE name ILIKE '%honey%' OR code ILIKE '%honey%';
SQL
