#!/bin/bash
cd ~/ab-amal-erp && export $(grep -v '^#' server/.env | grep DATABASE_URL | xargs)
psql "$DATABASE_URL" -c "SELECT name, internal_code FROM fabric_items WHERE internal_code ILIKE '%clo%' ORDER BY internal_code, name LIMIT 25;"
