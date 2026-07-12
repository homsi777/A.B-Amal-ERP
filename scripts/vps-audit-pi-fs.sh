#!/bin/bash
cd ~/ab-amal-erp && export $(grep -v '^#' server/.env | grep DATABASE_URL | xargs)
psql "$DATABASE_URL" -c "SELECT invoice_no, document_status, voided_at::date FROM purchase_invoices WHERE invoice_no LIKE 'FS%' ORDER BY created_at DESC LIMIT 15;"
psql "$DATABASE_URL" -c "SELECT id, file_name, status, created_purchase_invoice_id FROM purchase_import_batches WHERE file_name = 'AHMET BARAKAT SURYA 1.xls';"
