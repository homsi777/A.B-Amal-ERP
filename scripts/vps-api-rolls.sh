#!/bin/bash
cd ~/ab-amal-erp && export $(grep -v '^#' server/.env | xargs)
if [ -z "$VPS_API_USERNAME" ] || [ -z "$VPS_API_PASSWORD" ]; then
  echo "عرّف VPS_API_USERNAME و VPS_API_PASSWORD قبل التشغيل" >&2
  exit 1
fi
# login and fetch rolls
TOKEN=$(curl -s -X POST http://127.0.0.1:3001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"$VPS_API_USERNAME\",\"password\":\"$VPS_API_PASSWORD\"}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null)
if [ -z "$TOKEN" ]; then
  echo "Login failed, try env"
  exit 1
fi
curl -s "http://127.0.0.1:3001/api/fabric-rolls?search=1000000&limit=5" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool 2>/dev/null | head -80
echo "---"
curl -s "http://127.0.0.1:3001/api/fabric-rolls?search=1000143&limit=5" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool 2>/dev/null | head -80
