#!/bin/bash
cd ~/ab-amal-erp && export $(grep -v '^#' server/.env | grep DATABASE_URL | xargs)
psql "$DATABASE_URL" <<'SQL'
\echo '=== Purchase invoices (SURYA related) ==='
SELECT pi.invoice_no, pi.document_status, pi.voided_at::date, pi.created_at::date,
       b.file_name, b.status AS batch_status
FROM purchase_invoices pi
JOIN purchase_import_batches b ON b.created_purchase_invoice_id = pi.id
WHERE b.file_name = 'AHMET BARAKAT SURYA 1.xls'
ORDER BY pi.created_at;

\echo '=== Summary counts ==='
SELECT 'cancelled_batch_rolls' AS metric, count(*) AS val
FROM purchase_import_rows pir
JOIN fabric_rolls fr ON fr.id = pir.created_roll_id
WHERE pir.batch_id = '52d9c5e6-6ad4-41fa-a015-be0ee9c4307f'
UNION ALL
SELECT 'cancelled_batch_INACTIVE', count(*)
FROM purchase_import_rows pir
JOIN fabric_rolls fr ON fr.id = pir.created_roll_id
WHERE pir.batch_id = '52d9c5e6-6ad4-41fa-a015-be0ee9c4307f' AND fr.status = 'INACTIVE'
UNION ALL
SELECT 'cancelled_batch_live', count(*)
FROM purchase_import_rows pir
JOIN fabric_rolls fr ON fr.id = pir.created_roll_id
WHERE pir.batch_id = '52d9c5e6-6ad4-41fa-a015-be0ee9c4307f' AND fr.status NOT IN ('INACTIVE')
UNION ALL
SELECT 'all_SURYA_file_live_rolls', count(*)
FROM fabric_rolls fr
JOIN purchase_import_rows pir ON pir.created_roll_id = fr.id
JOIN purchase_import_batches b ON b.id = pir.batch_id
WHERE b.file_name = 'AHMET BARAKAT SURYA 1.xls' AND fr.status IN ('AVAILABLE','RESERVED');
SQL
