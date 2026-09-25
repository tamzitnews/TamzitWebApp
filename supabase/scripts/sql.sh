#!/usr/bin/env bash
# Run SQL against the Supabase project through the Management API.
# Usage: supabase/scripts/sql.sh file.sql [file2.sql ...]   or   echo "select 1" | supabase/scripts/sql.sh -
# Needs SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF in the environment.
set -euo pipefail
: "${SUPABASE_ACCESS_TOKEN:?missing}" "${SUPABASE_PROJECT_REF:?missing}"
run() {
  local body out code
  body=$(mktemp)
  python3 -c 'import json,sys; sys.stdout.write(json.dumps({"query": sys.stdin.read()}))' > "$body"
  out=$(curl -sS -w '\n%{http_code}' -X POST "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/database/query" \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H 'Content-Type: application/json' --data-binary "@$body")
  rm -f "$body"
  code=${out##*$'\n'}
  out=${out%$'\n'*}
  echo "$out"
  if [[ "$code" != 2* ]]; then echo "HTTP $code" >&2; return 1; fi
}
if [[ $# -eq 0 || "$1" == "-" ]]; then
  run
else
  for f in "$@"; do
    echo "== $f" >&2
    run < "$f"
    echo
  done
fi
