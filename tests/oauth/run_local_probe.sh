#!/usr/bin/env bash
# End-to-end OAuth lockdown probe on a throwaway LOCAL Supabase stack (needs Docker; never touches
# a real project). Boots Postgres, Auth (OAuth 2.1 server + dynamic registration + the access-token
# hook), PostgREST, Storage and Realtime with the repo's lockdown migration and a fixture shaped
# like production's sensitive tables, runs tests/oauth/probe.mjs (which also drives the MCP
# endpoint's token checks and Disconnect), then stops the stack.
#   bash tests/oauth/run_local_probe.sh
# With E2E_WEB=1 it also builds and starts web/ against the stack and runs tests/oauth/consent_e2e.mjs
# in a browser (consent page, /mcp, Settings › Connected AI apps); SHOTS=<dir> keeps screenshots.
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
s=re.sub(r'^site_url = .*$', 'site_url = "http://localhost:3105"', s, count=1, flags=re.M)
s=s.replace('# [auth.hook.custom_access_token]\n# enabled = true\n# uri = "pg-functions://<database>/<schema>/<hook_name>"','[auth.hook.custom_access_token]\nenabled = true\nuri = "pg-functions://postgres/public/custom_access_token_hook"')
s=re.sub(r'^secure_password_change = false', 'secure_password_change = true', s, flags=re.M)
for sec in ['studio','edge_runtime','analytics','inbucket']:
    s=re.sub(r'(\[%s\]\nenabled = )true'%sec, r'\1false', s)
open(p,'w').write(s)
PY
mkdir -p supabase/migrations
cp "$ROOT/tests/oauth/fixture.sql" supabase/migrations/20261031000000_fixture.sql
cp "$ROOT/supabase/migrations/20261031120000_oauth_lockdown.sql" "$ROOT/supabase/migrations/20261031130000_mcp_connected_apps.sql" supabase/migrations/
$CLI start > "$WORK/start.log" 2>&1 || { cat "$WORK/start.log"; exit 1; }
STATUS="$($CLI status -o json 2>/dev/null)"
DB_URL="$(echo "$STATUS" | python3 -c "import sys,json;print(json.load(sys.stdin)['DB_URL'])")"
echo "== supabase/checks/oauth_lockdown.sql on the local stack (expect no rows)"
VIOLATIONS="$(psql "$DB_URL" -At -f "$ROOT/supabase/checks/oauth_lockdown.sql")"
if [ -n "$VIOLATIONS" ]; then echo "$VIOLATIONS"; echo "FAIL  lockdown check"; exit 1; fi
echo "PASS  lockdown check: nothing reachable"
psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$ROOT/tests/oauth/after_start.sql"
cd "$ROOT/web"
API="$(echo "$STATUS" | python3 -c "import sys,json;print(json.load(sys.stdin)['API_URL'])")"
ANON="$(echo "$STATUS" | python3 -c "import sys,json;print(json.load(sys.stdin)['ANON_KEY'])")"
SERVICE="$(echo "$STATUS" | python3 -c "import sys,json;print(json.load(sys.stdin)['SERVICE_ROLE_KEY'])")"
API="$API" ANON="$ANON" SERVICE="$SERVICE" DB_URL="$DB_URL" node "$ROOT/tests/oauth/probe.mjs"

if [ -n "${E2E_WEB:-}" ]; then
  echo "== consent page, /mcp and Connected apps in a browser"
  export NEXT_PUBLIC_SUPABASE_URL="$API" NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$ANON" NEXT_PUBLIC_VERCEL_ENV=preview VERCEL_ENV=preview
  if curl -s -o /dev/null http://localhost:3105; then echo "Port 3105 is already in use (an old next start?)"; exit 1; fi
  ./node_modules/.bin/next build > "$WORK/next-build.log" 2>&1 || { tail -40 "$WORK/next-build.log"; exit 1; }
  # Run next directly (not through npx) so the trap below stops the server itself.
  ./node_modules/.bin/next start -p 3105 > "$WORK/next.log" 2>&1 &
  NEXT_PID=$!
  trap 'kill $NEXT_PID 2>/dev/null || true; cleanup' EXIT
  for _ in $(seq 1 60); do curl -fs -o /dev/null http://localhost:3105/login && break; sleep 1; done
  API="$API" ANON="$ANON" WEB=http://localhost:3105 SHOTS="${SHOTS:-}" node "$ROOT/tests/oauth/consent_e2e.mjs"
fi
