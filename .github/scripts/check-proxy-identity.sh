#!/usr/bin/env bash
# Proves the trust boundary the deployment depends on: a visitor cannot become
# somebody else by sending the identity header the app reads.
#
# Both halves are checked, because either alone is insufficient — the proxy
# stripping the header does nothing for a request that never goes through the
# proxy, and the app's secret does nothing if the proxy forwards a forged
# header alongside its own.
set -euo pipefail

proxy="http://localhost:8080"
direct="http://localhost:3000"
forged="oai-authenticated-user-id: attacker-claims-this"
failures=0

fail() { echo "FAIL: $1"; failures=$((failures + 1)); }
ok() { echo "ok: $1"; }

# 1. Through the proxy, carrying a forged identity. The request succeeds —
#    the session is valid — but must be filed under the session's owner.
code=$(curl -s -o /dev/null -w '%{http_code}' --noproxy '*' -X POST "$proxy/api/projects" \
  -H 'content-type: application/json' -H "$forged" \
  -d '{"name":"Forged through the proxy","description":"","parts":[]}')
[ "$code" = 201 ] || fail "a signed-in write through the proxy should succeed, got $code"

owner=$(docker exec cabinet node -e "
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync(process.env.DATABASE_PATH);
const row=db.prepare('SELECT owner_id FROM projects WHERE name = ?').get('Forged through the proxy');
process.stdout.write(row ? row.owner_id : 'MISSING');
" 2>/dev/null)
if [ "$owner" = "real-user" ]; then
  ok "the forged header was replaced by the verified session ($owner)"
else
  fail "the row landed under '$owner' rather than the verified 'real-user'"
fi

# 2. Straight at the container, bypassing the proxy. No proof, no identity.
code=$(curl -s -o /dev/null -w '%{http_code}' --noproxy '*' -X POST "$direct/api/projects" \
  -H 'content-type: application/json' -H "$forged" \
  -d '{"name":"Bypassed the proxy","description":"","parts":[]}')
if [ "$code" = 401 ]; then ok "a direct request with a forged header is refused"; else
  fail "bypassing the proxy should be refused, got $code"
fi

# 3. Straight at the container with a wrong secret.
code=$(curl -s -o /dev/null -w '%{http_code}' --noproxy '*' -X POST "$direct/api/projects" \
  -H 'content-type: application/json' -H "$forged" -H 'x-cabinet-proxy-secret: not-the-secret' \
  -d '{"name":"Guessed the secret","description":"","parts":[]}')
if [ "$code" = 401 ]; then ok "a guessed proxy secret is refused"; else
  fail "a wrong proxy secret should be refused, got $code"
fi

# 4. Nothing forged was ever written.
leaked=$(docker exec cabinet node -e "
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync(process.env.DATABASE_PATH);
process.stdout.write(String(db.prepare(\"SELECT COUNT(*) AS c FROM projects WHERE owner_id = 'attacker-claims-this'\").get().c));
" 2>/dev/null)
if [ "$leaked" = "0" ]; then ok "no row belongs to the claimed identity"; else
  fail "$leaked row(s) were written as the attacker"
fi

[ "$failures" -eq 0 ] || { echo "$failures check(s) failed"; exit 1; }
echo "the trust boundary holds"
