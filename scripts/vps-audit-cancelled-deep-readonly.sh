#!/bin/bash
# READ-ONLY deep compare: cancelled Jul-12 batch vs live inventory
cd ~/ab-amal-erp && export $(grep -v '^#' server/.env | grep DATABASE_URL | xargs)
CANCEL='52d9c5e6-6ad4-41fa-a015-be0ee9c4307f'
FILE='AHMET BARAKAT SURYA 1.xls'

psql "$DATABASE_URL" <<SQL
\echo '========== Purchase invoices for SURYA file =========='
SELECT pi.id, pi.invoice_no, pi.document_status, pi.voided_at::date, pi.import_batch_id,
       b.status AS batch_status, b.confirmed_at::date
FROM purchase_invoices pi
LEFT JOIN purchase_import_batches b ON b.id = pi.import_batch_id
WHERE pi.import_batch_id IN (SELECT id FROM purchase_import_batches WHERE file_name = '$FILE')
   OR b.file_name = '$FILE'
ORDER BY pi.created_at;

\echo '========== Distinct materials in CANCELLED batch (from import rows) =========='
SELECT DISTINCT
  pir.normalized_data->>'materialName' AS name,
  coalesce(nullif(pir.normalized_data->>'supplierMaterialCode',''),
           nullif(pir.normalized_data->>'materialCode',''), '—') AS code,
  count(*) AS rows_in_cancelled_batch
FROM purchase_import_rows pir
WHERE pir.batch_id = '$CANCEL'
GROUP BY 1, 2
ORDER BY 1, 2;

\echo '========== For each cancelled-batch material: AVAILABLE rolls and their SOURCE batch =========='
WITH cb_materials AS (
  SELECT DISTINCT
    lower(trim(pir.normalized_data->>'materialName')) AS mat_key,
    pir.normalized_data->>'materialName' AS mat_name,
    coalesce(nullif(pir.normalized_data->>'supplierMaterialCode',''),
             nullif(pir.normalized_data->>'materialCode','')) AS mat_code
  FROM purchase_import_rows pir
  WHERE pir.batch_id = '$CANCEL'
)
SELECT cm.mat_name, cm.mat_code,
       b.file_name AS source_file,
       b.status AS batch_status,
       b.confirmed_at::date,
       fr.status AS roll_status,
       count(*) AS roll_count
FROM cb_materials cm
JOIN fabric_items fi ON lower(trim(fi.name)) = lower(trim(cm.mat_name))
  AND (
    cm.mat_code IS NULL OR cm.mat_code = ''
    OR lower(trim(fi.internal_code)) = lower(trim(cm.mat_code))
    OR lower(trim(coalesce(fi.supplier_code,''))) = lower(trim(cm.mat_code))
  )
JOIN fabric_rolls fr ON fr.item_id = fi.id
LEFT JOIN purchase_import_rows pir ON pir.created_roll_id = fr.id
LEFT JOIN purchase_import_batches b ON b.id = pir.batch_id
WHERE fr.status IN ('AVAILABLE', 'RESERVED')
GROUP BY cm.mat_name, cm.mat_code, b.file_name, b.status, b.confirmed_at, fr.status
ORDER BY cm.mat_name, cm.mat_code, b.file_name;

\echo '========== AVAILABLE inventory NOT from Aleppo — linked to ANY SURYA batch =========='
SELECT fi.name, fi.internal_code, fr.barcode, fr.status,
       b.file_name, b.status AS batch_status, b.confirmed_at::date
FROM fabric_rolls fr
JOIN fabric_items fi ON fi.id = fr.item_id
JOIN purchase_import_rows pir ON pir.created_roll_id = fr.id
JOIN purchase_import_batches b ON b.id = pir.batch_id
WHERE b.file_name = '$FILE'
  AND fr.status IN ('AVAILABLE', 'RESERVED')
ORDER BY fi.name, fr.barcode;

\echo '========== fabric_items created on/after Jul 7 (SURYA import era) still with AVAILABLE rolls =========='
SELECT fi.name, fi.internal_code, fi.created_at::date,
       count(*) FILTER (WHERE fr.status IN ('AVAILABLE','RESERVED')) AS live_rolls,
       count(*) FILTER (WHERE fr.status = 'INACTIVE') AS inactive_rolls,
       string_agg(DISTINCT coalesce(b.file_name,'?'), ', ') AS import_sources
FROM fabric_items fi
JOIN fabric_rolls fr ON fr.item_id = fi.id
LEFT JOIN purchase_import_rows pir ON pir.created_roll_id = fr.id
LEFT JOIN purchase_import_batches b ON b.id = pir.batch_id
WHERE fi.created_at >= '2026-07-07'
GROUP BY fi.id, fi.name, fi.internal_code, fi.created_at
HAVING count(*) FILTER (WHERE fr.status IN ('AVAILABLE','RESERVED')) > 0
ORDER BY live_rolls DESC, fi.name;

\echo '========== Cancelled batch: item records that ONLY have inactive rolls but item still active =========='
SELECT fi.name, fi.internal_code,
       count(fr.id) FILTER (WHERE pir.batch_id = '$CANCEL') AS rolls_from_cancelled,
       count(fr.id) FILTER (WHERE fr.status IN ('AVAILABLE','RESERVED')) AS live_rolls_total
FROM fabric_items fi
JOIN fabric_rolls fr ON fr.item_id = fi.id
LEFT JOIN purchase_import_rows pir ON pir.created_roll_id = fr.id
WHERE EXISTS (
  SELECT 1 FROM purchase_import_rows p2
  WHERE p2.batch_id = '$CANCEL' AND p2.created_roll_id = fr.id
)
GROUP BY fi.id, fi.name, fi.internal_code
ORDER BY live_rolls_total DESC, rolls_from_cancelled DESC;
SQL
