#!/bin/bash
cd ~/ab-amal-erp && export $(grep -v '^#' server/.env | grep DATABASE_URL | xargs)
psql "$DATABASE_URL" <<'SQL'
\echo '=== fabric_items ALEXANDRA / ASTRLI ==='
SELECT id, name, internal_code, category_id, created_at::date
FROM fabric_items
WHERE name ILIKE '%alexandra%' OR name ILIKE '%astrl%'
ORDER BY name, internal_code;

\echo '=== active rolls ALEXANDRA / ASTRLI ==='
SELECT r.barcode, fi.name, fi.internal_code, r.status, r.notes,
       pi.file_name, pi.id AS batch_id
FROM fabric_rolls r
JOIN fabric_items fi ON fi.id = r.item_id
LEFT JOIN purchase_import_batches pi ON pi.id = r.purchase_import_batch_id
WHERE fi.name ILIKE '%alexandra%' OR fi.name ILIKE '%astrl%'
  AND r.status = 'ACTIVE'
ORDER BY fi.name, fi.internal_code, r.barcode;

\echo '=== ASTRLI in all import rows ==='
SELECT b.file_name, b.status, pir.row_no,
       pir.normalized_data->>'materialName' AS name,
       pir.normalized_data->>'materialCode' AS code,
       pir.normalized_data->>'supplierMaterialCode' AS desen,
       pir.matched_item_id
FROM purchase_import_rows pir
JOIN purchase_import_batches b ON b.id = pir.batch_id
WHERE pir.normalized_data::text ILIKE '%astrl%'
ORDER BY b.created_at, pir.row_no
LIMIT 20;

\echo '=== ALEXANDRA in all import rows (SURYA) ==='
SELECT b.file_name, b.status, pir.row_no,
       pir.normalized_data->>'materialName' AS name,
       pir.normalized_data->>'materialCode' AS code,
       pir.normalized_data->>'supplierMaterialCode' AS desen,
       pir.matched_item_id
FROM purchase_import_rows pir
JOIN purchase_import_batches b ON b.id = pir.batch_id
WHERE pir.normalized_data::text ILIKE '%alexandra%'
  AND b.file_name ILIKE '%SURYA%'
ORDER BY b.created_at, pir.row_no
LIMIT 15;

\echo '=== categories ASTRLI / ALEXANDRA ==='
SELECT c.id, c.name, c.code, c.parent_id
FROM fabric_categories c
WHERE c.name ILIKE '%alexandra%' OR c.name ILIKE '%astrl%' OR c.code ILIKE '%CLO%' OR c.code ILIKE '%5130%'
ORDER BY c.name;
SQL
