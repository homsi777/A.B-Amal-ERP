#!/bin/bash
set -euo pipefail
cd ~/ab-amal-erp
export PATH=/home/ubuntu/.nvm/versions/node/v22.22.3/bin:$PATH
export $(grep -v '^#' server/.env | grep DATABASE_URL | xargs)

echo "=== Cancelled batch settings ==="
psql "$DATABASE_URL" -c "
SELECT id, status, supplier_id, warehouse_id, default_location_id,
       currency_code, exchange_rate_to_usd, invoice_no, supplier_invoice_no,
       invoice_date::text, import_mode, notes
FROM purchase_import_batches
WHERE file_name='AHMET BARAKAT SURYA 1.xls'
ORDER BY created_at DESC LIMIT 1;"

echo ""
echo "=== Active users ==="
psql "$DATABASE_URL" -c "SELECT id, username, role FROM users WHERE is_active=true ORDER BY created_at LIMIT 5;"

echo ""
echo "=== Supplier AHMET / SURYA ==="
psql "$DATABASE_URL" -c "SELECT id, name FROM suppliers WHERE name ILIKE '%barakat%' OR name ILIKE '%surya%' OR name ILIKE '%ahmet%' LIMIT 5;"
