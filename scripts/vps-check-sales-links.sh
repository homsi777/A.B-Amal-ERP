#!/bin/bash
cd ~/ab-amal-erp && export $(grep -v '^#' server/.env | grep DATABASE_URL | xargs)
BATCH='52d9c5e6-6ad4-41fa-a015-be0ee9c4307f'
psql "$DATABASE_URL" <<SQL
SELECT si.document_status, COUNT(DISTINCT fr.id) AS rolls
FROM fabric_rolls fr
JOIN sales_invoice_lines sil ON sil.fabric_roll_id = fr.id
JOIN sales_invoices si ON si.id = sil.invoice_id
WHERE fr.import_batch_id = '$BATCH'
GROUP BY si.document_status
ORDER BY rolls DESC;

SELECT si.invoice_no, si.document_status, COUNT(DISTINCT fr.id) AS rolls
FROM fabric_rolls fr
JOIN sales_invoice_lines sil ON sil.fabric_roll_id = fr.id
JOIN sales_invoices si ON si.id = sil.invoice_id
WHERE fr.import_batch_id = '$BATCH'
GROUP BY si.id, si.invoice_no, si.document_status
ORDER BY rolls DESC
LIMIT 10;
SQL
