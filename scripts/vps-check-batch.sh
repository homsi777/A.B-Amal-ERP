#!/bin/bash
cd ~/ab-amal-erp && export $(grep -v '^#' server/.env | grep DATABASE_URL | xargs)
psql "$DATABASE_URL" -c "SELECT id, file_name, status, confirmed_at::date FROM purchase_import_batches WHERE id='9012e8f5-e201-40f0-999b-273769e72d9a';"
