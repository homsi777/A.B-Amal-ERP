#!/bin/bash
# READ-ONLY: compare last SURYA purchase import vs inventory leftovers
cd ~/ab-amal-erp && export $(grep -v '^#' server/.env | grep DATABASE_URL | xargs)

FILE='AHMET BARAKAT SURYA 1.xls'

psql "$DATABASE_URL" <<SQL
\echo '========== 1) ALL BATCHES FOR THIS FILE =========='
SELECT id, status, confirmed_at::date AS confirmed, created_at::date AS created,
       (SELECT count(*) FROM purchase_import_rows r WHERE r.batch_id = b.id) AS rows,
       (SELECT count(*) FROM purchase_import_rows r WHERE r.batch_id = b.id AND r.created_roll_id IS NOT NULL) AS rolls_created
FROM purchase_import_batches b
WHERE file_name = '$FILE'
ORDER BY created_at;

\echo '========== 2) CANCELLED BATCH (Jul 12 rollback target) =========='
SELECT id, status, confirmed_at, cancelled_at
FROM purchase_import_batches
WHERE file_name = '$FILE' AND status = 'CANCELLED';

\echo '========== 3) PURCHASE INVOICE LINKED =========='
SELECT pi.id, pi.invoice_no, pi.status, pi.voided_at, pi.import_batch_id
FROM purchase_invoices pi
WHERE pi.import_batch_id IN (
  SELECT id FROM purchase_import_batches WHERE file_name = '$FILE'
)
ORDER BY pi.created_at;

\echo '========== 4) ROLLS FROM CANCELLED BATCH — status breakdown =========='
SELECT fr.status, count(*) AS cnt
FROM fabric_rolls fr
JOIN purchase_import_rows pir ON pir.created_roll_id = fr.id
JOIN purchase_import_batches b ON b.id = pir.batch_id
WHERE b.file_name = '$FILE' AND b.status = 'CANCELLED'
GROUP BY fr.status
ORDER BY fr.status;

\echo '========== 5) ACTIVE/AVAILABLE ROLLS STILL LINKED TO CANCELLED BATCH =========='
SELECT fr.barcode, fr.status, fi.name AS item_name, fi.internal_code,
       b.id AS batch_id, b.status AS batch_status
FROM fabric_rolls fr
JOIN purchase_import_rows pir ON pir.created_roll_id = fr.id
JOIN purchase_import_batches b ON b.id = pir.batch_id
JOIN fabric_items fi ON fi.id = fr.item_id
WHERE b.file_name = '$FILE' AND b.status = 'CANCELLED'
  AND fr.status NOT IN ('INACTIVE')
ORDER BY fi.name, fr.barcode
LIMIT 50;

\echo '========== 6) CONFIRMED BATCHES — rolls still ACTIVE/AVAILABLE =========='
SELECT b.id AS batch_id, b.confirmed_at::date, fr.status, count(*) AS cnt
FROM fabric_rolls fr
JOIN purchase_import_rows pir ON pir.created_roll_id = fr.id
JOIN purchase_import_batches b ON b.id = pir.batch_id
WHERE b.file_name = '$FILE' AND b.status = 'CONFIRMED'
GROUP BY b.id, b.confirmed_at, fr.status
ORDER BY b.confirmed_at, fr.status;

\echo '========== 7) FABRIC_ITEMS touched by CANCELLED batch rolls (any status) =========='
SELECT fi.name, fi.internal_code, fi.created_at::date,
       count(*) FILTER (WHERE fr.status = 'INACTIVE') AS inactive_rolls,
       count(*) FILTER (WHERE fr.status NOT IN ('INACTIVE')) AS non_inactive_rolls,
       count(*) AS total_rolls
FROM fabric_rolls fr
JOIN fabric_items fi ON fi.id = fr.item_id
JOIN purchase_import_rows pir ON pir.created_roll_id = fr.id
JOIN purchase_import_batches b ON b.id = pir.batch_id
WHERE b.file_name = '$FILE' AND b.status = 'CANCELLED'
GROUP BY fi.id, fi.name, fi.internal_code, fi.created_at
ORDER BY non_inactive_rolls DESC, total_rolls DESC
LIMIT 40;

\echo '========== 8) Items created/modified ONLY by cancelled batch (no other active rolls) =========='
WITH cancelled_items AS (
  SELECT DISTINCT fr.item_id
  FROM fabric_rolls fr
  JOIN purchase_import_rows pir ON pir.created_roll_id = fr.id
  JOIN purchase_import_batches b ON b.id = pir.batch_id
  WHERE b.file_name = '$FILE' AND b.status = 'CANCELLED'
)
SELECT fi.name, fi.internal_code, fi.is_active,
       count(fr.id) FILTER (WHERE fr.status NOT IN ('INACTIVE')) AS active_rolls,
       count(fr.id) AS all_rolls
FROM cancelled_items ci
JOIN fabric_items fi ON fi.id = ci.item_id
LEFT JOIN fabric_rolls fr ON fr.item_id = fi.id
GROUP BY fi.id, fi.name, fi.internal_code, fi.is_active
HAVING count(fr.id) FILTER (WHERE fr.status NOT IN ('INACTIVE')) > 0
   OR count(fr.id) = count(fr.id) FILTER (WHERE fr.status = 'INACTIVE')
ORDER BY active_rolls DESC, all_rolls DESC
LIMIT 30;

\echo '========== 9) Compare: materials in CANCELLED batch vs currently AVAILABLE in inventory =========='
SELECT DISTINCT
       pir.normalized_data->>'materialName' AS import_name,
       coalesce(pir.normalized_data->>'supplierMaterialCode', pir.normalized_data->>'materialCode', '') AS import_code,
       fi.name AS current_item_name,
       fi.internal_code AS current_item_code,
       fr.status AS roll_status,
       fr.barcode
FROM purchase_import_rows pir
JOIN purchase_import_batches b ON b.id = pir.batch_id
JOIN fabric_rolls fr ON fr.id = pir.created_roll_id
JOIN fabric_items fi ON fi.id = fr.item_id
WHERE b.file_name = '$FILE' AND b.status = 'CANCELLED'
  AND fr.status IN ('AVAILABLE', 'RESERVED', 'SOLD')
ORDER BY import_name, import_code, fr.barcode
LIMIT 60;

\echo '========== 10) Draft sales invoices from cancelled batch =========='
SELECT si.invoice_no, si.status, count(sil.id) AS lines
FROM sales_invoices si
JOIN sales_invoice_lines sil ON sil.invoice_id = si.id
JOIN fabric_rolls fr ON fr.id = sil.roll_id
JOIN purchase_import_rows pir ON pir.created_roll_id = fr.id
JOIN purchase_import_batches b ON b.id = pir.batch_id
WHERE b.file_name = '$FILE' AND b.status = 'CANCELLED'
GROUP BY si.id, si.invoice_no, si.status;
SQL
