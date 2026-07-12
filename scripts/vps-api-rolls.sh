#!/bin/bash
cd ~/ab-amal-erp && export $(grep -v '^#' server/.env | xargs)
# login and fetch rolls
TOKEN=$(curl -s -X POST http://127.0.0.1:3001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}' | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null)
if [ -z "$TOKEN" ]; then
  echo "Login failed, try env"
  exit 1
fi
curl -s "http://127.0.0.1:3001/api/fabric-rolls?search=1000000&limit=5" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool 2>/dev/null | head -80
echo "---"
curl -s "http://127.0.0.1:3001/api/fabric-rolls?search=1000143&limit=5" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool 2>/dev/null | head -80
