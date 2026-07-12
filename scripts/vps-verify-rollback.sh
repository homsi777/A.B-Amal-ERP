#!/bin/bash
cd ~/ab-amal-erp && export $(grep -v '^#' server/.env | grep DATABASE_URL | xargs)
BATCH='52d9c5e6-6ad4-41fa-a015-be0ee9c4307f'
psql "$DATABASE_URL" <<SQL
SELECT 'batch_status' AS k, status::text AS v FROM purchase_import_batches WHERE id='$BATCH';
SELECT 'purchase_invoice' AS k, document_status::text AS v FROM purchase_invoices WHERE invoice_no='FS0000009';
SELECT 'batch_rolls' AS k, status::text AS v, COUNT(*)::text AS n FROM fabric_rolls WHERE import_batch_id='$BATCH' GROUP BY status;
SELECT 'draft_sales_left' AS k, COUNT(*)::text AS v FROM sales_invoices si
  JOIN sales_invoice_lines sil ON sil.invoice_id=si.id
  JOIN fabric_rolls fr ON fr.id=sil.fabric_roll_id
  WHERE fr.import_batch_id='$BATCH' AND si.document_status='DRAFT';
SELECT 'available_rolls_total' AS k, COUNT(*)::text AS v FROM fabric_rolls WHERE status='AVAILABLE';
SQL
