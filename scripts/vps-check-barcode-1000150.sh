#!/bin/bash
cd ~/ab-amal-erp && export $(grep -v '^#' server/.env | grep DATABASE_URL | xargs)
BC='1000150'

psql "$DATABASE_URL" <<SQL
\echo '========== 1) Roll 1000150 — current state =========='
SELECT r.barcode, r.status, r.length_m, r.notes,
       fi.name AS item_name, fi.internal_code, fi.supplier_code,
       fc.name_ar AS color_ar, fc.name_tr AS color_tr, fc.color_code
FROM fabric_rolls r
JOIN fabric_items fi ON fi.id = r.item_id
LEFT JOIN fabric_colors fc ON fc.id = r.color_id
WHERE r.barcode = '$BC';

\echo '========== 2) Original Aleppo import row for this roll =========='
SELECT pir.row_no, b.file_name, b.status AS batch_status, b.confirmed_at::date,
       pir.normalized_data
FROM purchase_import_rows pir
JOIN purchase_import_batches b ON b.id = pir.batch_id
JOIN fabric_rolls r ON r.id = pir.created_roll_id
WHERE r.barcode = '$BC';

\echo '========== 3) Was roll 1000150 ever in SURYA purchase import? =========='
SELECT pir.row_no, b.file_name, b.status, b.confirmed_at::date,
       pir.normalized_data->>'materialName' AS name,
       pir.normalized_data->>'supplierMaterialCode' AS code,
       pir.normalized_data->>'colorName' AS color,
       pir.normalized_data->>'lengthM' AS len
FROM purchase_import_rows pir
JOIN purchase_import_batches b ON b.id = pir.batch_id
JOIN fabric_rolls r ON r.id = pir.created_roll_id
WHERE r.barcode = '$BC'
  AND b.file_name ILIKE '%SURYA%';

\echo '========== 4) All import batches that touched this roll =========='
SELECT b.file_name, b.status, b.confirmed_at::date, pir.row_no,
       pir.normalized_data->>'materialName' AS imp_name,
       pir.normalized_data->>'materialCode' AS imp_code
FROM purchase_import_rows pir
JOIN purchase_import_batches b ON b.id = pir.batch_id
JOIN fabric_rolls r ON r.id = pir.created_roll_id
WHERE r.barcode = '$BC'
ORDER BY b.created_at;

\echo '========== 5) Neighbour rolls 1000148-1000152 (Aleppo rows 149-153) =========='
SELECT r.barcode, fi.name, fi.internal_code,
       fc.name_ar AS color, r.length_m, r.status,
       pir.normalized_data->>'materialName' AS orig_name,
       pir.normalized_data->>'materialCode' AS orig_code
FROM fabric_rolls r
JOIN fabric_items fi ON fi.id = r.item_id
LEFT JOIN fabric_colors fc ON fc.id = r.color_id
LEFT JOIN purchase_import_rows pir ON pir.created_roll_id = r.id
  AND pir.batch_id = '2baf30aa-dae7-4d48-95f3-9d1778616256'
WHERE r.barcode BETWEEN '1000148' AND '1000152'
ORDER BY r.barcode;
SQL
