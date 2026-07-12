#!/bin/bash
cd ~/ab-amal-erp && export $(grep -v '^#' server/.env | grep DATABASE_URL | xargs)
psql "$DATABASE_URL" <<'SQL'
\echo '=== fabric_items: astrli / jupiter / jupi ==='
SELECT id, name, internal_code, supplier_code, is_active, created_at::date
FROM fabric_items
WHERE name ILIKE '%astrl%' OR name ILIKE '%jupi%' OR name ILIKE '%jupitter%'
   OR internal_code ILIKE '%jupi%' OR supplier_code ILIKE '%jupi%'
ORDER BY name, internal_code;

\echo '=== fabric_categories: astrli / jupiter ==='
SELECT id, name, code, parent_id
FROM fabric_categories
WHERE name ILIKE '%astrl%' OR name ILIKE '%jupi%' OR code ILIKE '%jupi%'
ORDER BY name;

\echo '=== import rows: astrli ==='
SELECT b.file_name, b.status, pir.row_no,
       pir.normalized_data->>'materialName' AS mat_name,
       pir.normalized_data->>'materialCode' AS mat_code,
       pir.normalized_data->>'supplierMaterialCode' AS desen,
       pir.matched_item_id
FROM purchase_import_rows pir
JOIN purchase_import_batches b ON b.id = pir.batch_id
WHERE pir.normalized_data::text ILIKE '%astrl%'
ORDER BY b.created_at, pir.row_no
LIMIT 25;

\echo '=== import rows: jupiter/jupi near astrli rows (aleppo 130-160) ==='
SELECT pir.row_no,
       pir.normalized_data->>'materialName' AS mat_name,
       pir.normalized_data->>'materialCode' AS mat_code,
       r.barcode, fi.name AS roll_item, fi.internal_code
FROM purchase_import_rows pir
LEFT JOIN fabric_rolls r ON r.id = pir.created_roll_id
LEFT JOIN fabric_items fi ON fi.id = r.item_id
WHERE pir.batch_id = '2baf30aa-dae7-4d48-95f3-9d1778616256'
  AND pir.row_no BETWEEN 125 AND 165
ORDER BY pir.row_no;

\echo '=== rolls on jupiter items ==='
SELECT r.barcode, fi.name, fi.internal_code, r.status, r.notes
FROM fabric_rolls r
JOIN fabric_items fi ON fi.id = r.item_id
WHERE fi.name ILIKE '%jupi%'
ORDER BY fi.name, r.barcode
LIMIT 30;

\echo '=== any roll ever linked astrli+jupiter mix ==='
SELECT r.barcode, fi.name, fi.internal_code, r.notes
FROM fabric_rolls r
JOIN fabric_items fi ON fi.id = r.item_id
WHERE (r.notes ILIKE '%astrl%' AND fi.name ILIKE '%jupi%')
   OR (r.notes ILIKE '%jupi%' AND fi.name ILIKE '%astrl%')
LIMIT 20;

\echo '=== distinct material names containing jup in all imports ==='
SELECT DISTINCT
       b.file_name,
       pir.normalized_data->>'materialName' AS mat_name,
       pir.normalized_data->>'materialCode' AS mat_code
FROM purchase_import_rows pir
JOIN purchase_import_batches b ON b.id = pir.batch_id
WHERE pir.normalized_data::text ILIKE '%jup%'
ORDER BY mat_name;
SQL
