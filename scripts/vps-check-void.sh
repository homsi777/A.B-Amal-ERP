#!/bin/bash
set -euo pipefail
cd ~/ab-amal-erp
export $(grep -v '^#' server/.env | grep DATABASE_URL | xargs)
BATCH='52d9c5e6-6ad4-41fa-a015-be0ee9c4307f'

psql "$DATABASE_URL" <<SQL
SELECT b.created_purchase_invoice_id, pi.invoice_no, pi.document_status, pi.total_amount
FROM purchase_import_batches b
LEFT JOIN purchase_invoices pi ON pi.id = b.created_purchase_invoice_id
WHERE b.id = '$BATCH';

SELECT fr.status, COUNT(*),
  COUNT(*) FILTER (WHERE EXISTS (
    SELECT 1 FROM sales_invoice_lines sil
    JOIN sales_invoices si ON si.id = sil.invoice_id
    WHERE sil.fabric_roll_id = fr.id AND si.document_status = 'CONFIRMED'
  )) AS with_confirmed_sale
FROM fabric_rolls fr
WHERE fr.import_batch_id = '$BATCH'
GROUP BY fr.status;
SQL
