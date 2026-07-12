#!/bin/bash
cd ~/ab-amal-erp && export $(grep -v '^#' server/.env | grep DATABASE_URL | xargs)
psql "$DATABASE_URL" -c "SELECT id, file_name, extracted_metadata FROM purchase_import_batches WHERE id='2baf30aa-dae7-4d48-95f3-9d1778616256';"
