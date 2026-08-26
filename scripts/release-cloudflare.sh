#!/usr/bin/env bash
set -euo pipefail

CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-8ca23ac6d2cc906d4dd13b8da5ea2b25}"
D1_DATABASE="${D1_DATABASE:-pmhub-production}"
R2_BUCKET="${R2_BUCKET:-pmhub-evidence}"
PAGES_PROJECT="${PAGES_PROJECT:-pmhub}"
LIVE_URL="${LIVE_URL:-https://pmhub.pages.dev}"
RELEASE_SHA="${GITHUB_SHA:-$(git rev-parse HEAD 2>/dev/null || echo manual)}"
RELEASE_RUN_ID="${GITHUB_RUN_ID:-manual-$(date -u +%Y%m%dT%H%M%SZ)}"
WORK_DIR="release-work"
BACKUP_R2_KEY="production-backups/${RELEASE_RUN_ID}/${D1_DATABASE}-${RELEASE_SHA}.sql"
SMOKE_USERS_CREATED=0

export CLOUDFLARE_ACCOUNT_ID

summary() {
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    printf '%s\n' "$1" >> "$GITHUB_STEP_SUMMARY"
  else
    printf '%s\n' "$1"
  fi
}

cleanup_smoke_users() {
  if [ "$SMOKE_USERS_CREATED" != '1' ] || [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
    return 0
  fi
  npx wrangler d1 execute "$D1_DATABASE" --remote --command "
    DELETE FROM sessions WHERE user_id LIKE 'user_release_smoke_%';
    DELETE FROM notifications WHERE user_id LIKE 'user_release_smoke_%';
    DELETE FROM audit_events WHERE actor_user_id LIKE 'user_release_smoke_%' OR (entity_type = 'user' AND entity_id LIKE 'user_release_smoke_%');
    DELETE FROM users WHERE id LIKE 'user_release_smoke_%';
  " >/dev/null 2>&1 || true
  SMOKE_USERS_CREATED=0
}

cleanup() {
  cleanup_smoke_users
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

require_command() {
  command -v "$1" >/dev/null 2>&1 || { echo "Required command '$1' is unavailable." >&2; exit 1; }
}

require_command node
require_command npm
require_command jq
require_command curl

test -n "${CLOUDFLARE_API_TOKEN:-}" || {
  echo 'CLOUDFLARE_API_TOKEN is required for production release.' >&2
  exit 1
}

# Prevent this workflow being triggered before the release PR containing the
# production migrations has actually reached main.
test -f migrations/0006_finalised_report_immutability.sql || {
  echo 'Production release migrations are not present on main. Merge the release candidate first.' >&2
  exit 1
}
test -f src/routes/operations.ts || {
  echo 'ProInspect operational routes are not present on main.' >&2
  exit 1
}

mkdir -p "$WORK_DIR"

printf '\n== Install and validate ==\n'
npm ci --ignore-scripts --no-audit --no-fund
npx --yes --package=typescript@5.9.2 tsc --noEmit
npm run build

printf '\n== Backup production D1 ==\n'
backup_file="$WORK_DIR/${D1_DATABASE}-${RELEASE_SHA}.sql"
npx wrangler d1 export "$D1_DATABASE" --remote --skip-confirmation --output="$backup_file"
test -s "$backup_file"
npx wrangler r2 object put "$R2_BUCKET/$BACKUP_R2_KEY" --remote --file="$backup_file" --content-type="application/sql"
rm -f "$backup_file"
summary "Production D1 backup: R2 key \`$BACKUP_R2_KEY\`"

printf '\n== Apply D1 migrations ==\n'
npx wrangler d1 migrations apply "$D1_DATABASE" --remote

printf '\n== Verify production data hardening ==\n'
d1_json() {
  npx wrangler d1 execute "$D1_DATABASE" --remote --json --command "$1"
}

account_json="$(d1_json "SELECT COUNT(*) AS account_count FROM users WHERE status = 'active' AND ((lower(email) = 'info@remotebusinesspartner.com.au' AND role = 'system_administrator' AND property_scope IS NULL) OR (lower(email) = 'shan.goodlet@lpg.com.au' AND role = 'strata_manager' AND property_scope IS NULL) OR (lower(email) = 'buildingmanager.prima@gmail.com' AND role = 'building_manager' AND property_scope = 'prop_prima') OR (lower(email) = 'buildingmanager.meridian@gmail.com' AND role = 'building_manager' AND property_scope = 'prop_meridian')); ")"
echo "$account_json" | jq -e '.[0].results[0].account_count == 4' >/dev/null

demo_users_json="$(d1_json "SELECT COUNT(*) AS active_demo_users FROM users WHERE email LIKE '%@pmhub.demo' AND status = 'active';")"
echo "$demo_users_json" | jq -e '.[0].results[0].active_demo_users == 0' >/dev/null

demo_sessions_json="$(d1_json "SELECT COUNT(*) AS active_demo_sessions FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.email LIKE '%@pmhub.demo';")"
echo "$demo_sessions_json" | jq -e '.[0].results[0].active_demo_sessions == 0' >/dev/null

demo_records_json="$(d1_json "SELECT (SELECT COUNT(*) FROM resident_requests WHERE id = 'req_demo_1') + (SELECT COUNT(*) FROM defects WHERE id = 'defect_demo_1') AS known_demo_records;")"
echo "$demo_records_json" | jq -e '.[0].results[0].known_demo_records == 0' >/dev/null

seed_reference_json="$(d1_json "SELECT (SELECT COUNT(*) FROM units WHERE id IN ('unit_prima_101','unit_prima_205','unit_prima_312','unit_meridian_1002','unit_meridian_1503','unit_meridian_607')) + (SELECT COUNT(*) FROM contractors WHERE id IN ('ctr_ace_plumbing','ctr_bright_electrical','ctr_liftcare','ctr_greenclean')) + (SELECT COUNT(*) FROM keys_register WHERE id IN ('key_prima_plant','key_prima_waste','key_meridian_plant','key_meridian_waste')) AS seeded_reference_records;")"
echo "$seed_reference_json" | jq -e '.[0].results[0].seeded_reference_records == 0' >/dev/null

npx wrangler d1 execute "$D1_DATABASE" --remote --command "SELECT email, role, status, COALESCE(property_scope,'all') AS property_scope FROM users WHERE lower(email) IN ('info@remotebusinesspartner.com.au','shan.goodlet@lpg.com.au','buildingmanager.prima@gmail.com','buildingmanager.meridian@gmail.com') ORDER BY email;"
summary 'Production account, demo-lockdown and seed-data checks passed.'

printf '\n== Deploy Cloudflare Pages ==\n'
npx wrangler pages deploy dist --project-name "$PAGES_PROJECT" --branch main --commit-hash "$RELEASE_SHA"

printf '\n== Wait for edge propagation ==\n'
sleep 12

printf '\n== Public smoke checks ==\n'
curl --fail --silent --show-error --retry 5 --retry-delay 3 "$LIVE_URL/api/health" > "$WORK_DIR/health.json"
grep -q 'ProInspect Building Management' "$WORK_DIR/health.json"
curl --fail --silent --show-error --retry 5 --retry-delay 3 "$LIVE_URL/login" > "$WORK_DIR/login.html"
grep -q 'ProInspect Building Management' "$WORK_DIR/login.html"
curl --fail --silent --show-error --retry 5 --retry-delay 3 "$LIVE_URL/manifest.webmanifest" > "$WORK_DIR/manifest.webmanifest"
grep -q 'ProInspect Building Management' "$WORK_DIR/manifest.webmanifest"
summary 'Public production smoke checks passed.'

printf '\n== Create ephemeral role smoke users ==\n'
smoke_password="$(node -e "process.stdout.write(require('crypto').randomBytes(30).toString('base64url'))")"
smoke_hash="$(SMOKE_PASSWORD="$smoke_password" node -e "const c=require('crypto'); const salt=c.randomBytes(16).toString('hex'); const hash=c.pbkdf2Sync(process.env.SMOKE_PASSWORD,salt,100000,32,'sha256').toString('hex'); process.stdout.write('pbkdf2$100000$'+salt+'$'+hash);")"

# Clear leftovers from a previously interrupted release before inserting this
# run's temporary accounts. The EXIT trap repeats the cleanup after testing.
SMOKE_USERS_CREATED=1
cleanup_smoke_users
SMOKE_USERS_CREATED=1
npx wrangler d1 execute "$D1_DATABASE" --remote --command "
  INSERT INTO users (id, person_id, email, password_hash, role, property_scope, status) VALUES
    ('user_release_smoke_admin', NULL, 'release-smoke-admin@proinspect.invalid', '$smoke_hash', 'system_administrator', NULL, 'active'),
    ('user_release_smoke_strata', NULL, 'release-smoke-strata@proinspect.invalid', '$smoke_hash', 'strata_manager', NULL, 'active'),
    ('user_release_smoke_council', NULL, 'release-smoke-council@proinspect.invalid', '$smoke_hash', 'council_member', NULL, 'active'),
    ('user_release_smoke_bm_prima', NULL, 'release-smoke-bm-prima@proinspect.invalid', '$smoke_hash', 'building_manager', 'prop_prima', 'active'),
    ('user_release_smoke_bm_meridian', NULL, 'release-smoke-bm-meridian@proinspect.invalid', '$smoke_hash', 'building_manager', 'prop_meridian', 'active'),
    ('user_release_smoke_relief', NULL, 'release-smoke-relief@proinspect.invalid', '$smoke_hash', 'relief_building_manager', 'prop_prima', 'active'),
    ('user_release_smoke_contractor', NULL, 'release-smoke-contractor@proinspect.invalid', '$smoke_hash', 'contractor', 'prop_prima', 'active'),
    ('user_release_smoke_resident', NULL, 'release-smoke-resident@proinspect.invalid', '$smoke_hash', 'resident', 'prop_prima', 'active');
" >/dev/null

printf '\n== Authenticated role smoke checks ==\n'
smoke_role() {
  local email="$1"
  local page="$2"
  local api_path="$3"
  local jar payload
  jar="$(mktemp)"
  payload="$(jq -nc --arg email "$email" --arg password "$smoke_password" '{email:$email,password:$password}')"
  curl --fail --silent --show-error --cookie-jar "$jar" --header 'Content-Type: application/json' --data "$payload" "$LIVE_URL/api/login" >/dev/null
  curl --fail --silent --show-error --cookie "$jar" "$LIVE_URL$page" >/dev/null
  curl --fail --silent --show-error --cookie "$jar" "$LIVE_URL$api_path" >/dev/null
  rm -f "$jar"
}

smoke_role 'release-smoke-admin@proinspect.invalid' '/strata' '/api/properties'
smoke_role 'release-smoke-strata@proinspect.invalid' '/strata/reports' '/api/properties'
smoke_role 'release-smoke-council@proinspect.invalid' '/strata' '/api/properties'
smoke_role 'release-smoke-bm-prima@proinspect.invalid' '/bm/forms' '/api/forms/options'
smoke_role 'release-smoke-bm-meridian@proinspect.invalid' '/bm/inspections' '/api/forms/options'
smoke_role 'release-smoke-relief@proinspect.invalid' '/bm' '/api/forms/options'
smoke_role 'release-smoke-contractor@proinspect.invalid' '/contractor' '/api/me'
smoke_role 'release-smoke-resident@proinspect.invalid' '/resident' '/api/me'

cleanup_smoke_users
remaining_smoke_json="$(d1_json "SELECT COUNT(*) AS smoke_users FROM users WHERE id LIKE 'user_release_smoke_%';")"
echo "$remaining_smoke_json" | jq -e '.[0].results[0].smoke_users == 0' >/dev/null
summary 'Authenticated role smoke checks passed for Admin, Strata, Council, both Building Managers, Relief BM, Contractor and Resident.'

summary "Release commit: \`$RELEASE_SHA\`"
summary "Live URL: $LIVE_URL"
printf '\nProduction release completed successfully.\n'
