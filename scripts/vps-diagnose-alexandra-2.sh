#!/bin/bash
cd ~/ab-amal-erp && export $(grep -v '^#' server/.env | grep DATABASE_URL | xargs)

psql "$DATABASE_URL" <<'SQL'
\echo '=== Import batch 2baf30aa ==='
SELECT id, file_name, status, confirmed_at::date FROM purchase_import_batches
WHERE id = '2baf30aa-dae7-4d48-95f3-9d1778616256';

\echo '=== Category tree for ALEXANDRA / ASTRLI ==='
SELECT fc.id, fc.name, fc.code, fc.parent_id,
  p.name AS parent_name, p.code AS parent_code
FROM fabric_categories fc
LEFT JOIN fabric_categories p ON p.id = fc.parent_id
WHERE lower(fc.name) LIKE '%alexandra%' OR lower(fc.name) LIKE '%astrl%'
   OR lower(p.name) LIKE '%alexandra%' OR lower(p.name) LIKE '%astrl%'
ORDER BY p.name NULLS FIRST, fc.name;

\echo '=== Grouped inventory API style (active rolls) ==='
SELECT fi.name AS item_name, fi.internal_code,
       COUNT(fr.id) AS rolls, SUM(fr.length_m) AS meters
FROM fabric_rolls fr
JOIN fabric_items fi ON fi.id = fr.item_id
WHERE fr.status IN ('AVAILABLE','RESERVED')
  AND (lower(fi.name) LIKE '%alexandra%' OR lower(fi.name) LIKE '%astrl%')
GROUP BY fi.name, fi.internal_code;

\echo '=== Missing ASTRLI items CLO-1 CLO-2 ==='
SELECT id, name, internal_code FROM fabric_items
WHERE lower(name) LIKE '%astrl%' OR internal_code ILIKE 'CLO-%'
ORDER BY internal_code;

\echo '=== Rolls that should be CLO-1 or CLO-2 from stock import batch ==='
SELECT fr.barcode, fi.name, fi.internal_code, pir.normalized_data->>'supplierMaterialCode' AS excel_desen
FROM fabric_rolls fr
JOIN fabric_items fi ON fi.id = fr.item_id
LEFT JOIN purchase_import_rows pir ON pir.created_roll_id = fr.id
WHERE fr.import_batch_id = '2baf30aa-dae7-4d48-95f3-9d1778616256'
  AND (lower(fi.name) LIKE '%astrl%' OR lower(fi.name) LIKE '%alexandra%')
ORDER BY fi.name, excel_desen;
SQL
