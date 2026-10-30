#!/usr/bin/env bash
# End-to-end OAuth lockdown probe on a throwaway LOCAL Supabase stack (needs Docker; never touches
# a real project). Boots Postgres, Auth (OAuth 2.1 server + dynamic registration + the access-token
# hook), PostgREST, Storage and Realtime with the repo's lockdown migration and a fixture shaped
# like production's sensitive tables, runs tests/oauth/probe.mjs, then stops the stack.
#   bash tests/oauth/run_local_probe.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(mktemp -d)"
CLI="npx -y supabase@2.122.0"
cleanup() { if [ -n "${KEEP:-}" ]; then echo "KEEP set: stack left running in $WORK"; return; fi; (cd "$WORK" && $CLI stop --no-backup >/dev/null 2>&1) || true; rm -rf "$WORK"; }
trap cleanup EXIT

cd "$WORK"
$CLI init --force >/dev/null
$CLI gen signing-key --algorithm ES256 2>/dev/null | python3 -c "import sys,json;d=json.load(sys.stdin);json.dump(d if isinstance(d,list) else [d],open('supabase/signing_keys.json','w'))"
python3 - <<'PY'
import re
p='supabase/config.toml'
s=open(p).read()
s=s.replace('# signing_keys_path = "./signing_keys.json"','signing_keys_path = "./signing_keys.json"')
s=re.sub(r'(\[auth\.oauth_server\]\n# Enable OAuth server functionality\nenabled = )false', r'\1true', s)
s=s.replace('allow_dynamic_registration = false','allow_dynamic_registration = true')
s=s.replace('# [auth.hook.custom_access_token]\n# enabled = true\n# uri = "pg-functions://<database>/<schema>/<hook_name>"','[auth.hook.custom_access_token]\nenabled = true\nuri = "pg-functions://postgres/public/custom_access_token_hook"')
s=re.sub(r'^secure_password_change = false', 'secure_password_change = true', s, flags=re.M)
for sec in ['studio','edge_runtime','analytics','inbucket']:
    s=re.sub(r'(\[%s\]\nenabled = )true'%sec, r'\1false', s)
open(p,'w').write(s)
PY
mkdir -p supabase/migrations
cp "$ROOT/tests/oauth/fixture.sql" supabase/migrations/20261031000000_fixture.sql
cp "$ROOT/supabase/migrations/20261031120000_oauth_lockdown.sql" supabase/migrations/
$CLI start > "$WORK/start.log" 2>&1 || { cat "$WORK/start.log"; exit 1; }
STATUS="$($CLI status -o json 2>/dev/null)"
DB_URL="$(echo "$STATUS" | python3 -c "import sys,json;print(json.load(sys.stdin)['DB_URL'])")"
echo "== supabase/checks/oauth_lockdown.sql on the local stack (expect no rows)"
VIOLATIONS="$(psql "$DB_URL" -At -f "$ROOT/supabase/checks/oauth_lockdown.sql")"
if [ -n "$VIOLATIONS" ]; then echo "$VIOLATIONS"; echo "FAIL  lockdown check"; exit 1; fi
echo "PASS  lockdown check: nothing reachable"
psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$ROOT/tests/oauth/after_start.sql"
cd "$ROOT/web"
API="$(echo "$STATUS" | python3 -c "import sys,json;print(json.load(sys.stdin)['API_URL'])")" \
ANON="$(echo "$STATUS" | python3 -c "import sys,json;print(json.load(sys.stdin)['ANON_KEY'])")" \
SERVICE="$(echo "$STATUS" | python3 -c "import sys,json;print(json.load(sys.stdin)['SERVICE_ROLE_KEY'])")" DB_URL="$DB_URL" \
  node "$ROOT/tests/oauth/probe.mjs"
