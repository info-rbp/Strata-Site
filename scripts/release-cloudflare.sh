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

export CLOUDFLARE_ACCOUNT_ID

summary() {
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    printf '%s\n' "$1" >> "$GITHUB_STEP_SUMMARY"
  else
    printf '%s\n' "$1"
  fi
}

cleanup() {
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

account_json="$(d1_json "SELECT COUNT(*) AS account_count FROM users WHERE email IN ('info@remotebusinesspartner.com.au','shan.goodlet@lpg.com.au','buildingmanager.prima@gmail.com','buildingmanager.meridian@gmail.com') AND status = 'active';")"
echo "$account_json" | jq -e '.[0].results[0].account_count == 4' >/dev/null

demo_users_json="$(d1_json "SELECT COUNT(*) AS active_demo_users FROM users WHERE email LIKE '%@pmhub.demo' AND status = 'active';")"
echo "$demo_users_json" | jq -e '.[0].results[0].active_demo_users == 0' >/dev/null

demo_sessions_json="$(d1_json "SELECT COUNT(*) AS active_demo_sessions FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.email LIKE '%@pmhub.demo';")"
echo "$demo_sessions_json" | jq -e '.[0].results[0].active_demo_sessions == 0' >/dev/null

demo_records_json="$(d1_json "SELECT (SELECT COUNT(*) FROM resident_requests WHERE id = 'req_demo_1') + (SELECT COUNT(*) FROM defects WHERE id = 'defect_demo_1') AS known_demo_records;")"
echo "$demo_records_json" | jq -e '.[0].results[0].known_demo_records == 0' >/dev/null

npx wrangler d1 execute "$D1_DATABASE" --remote --command "SELECT email, role, status, COALESCE(property_scope,'all') AS property_scope FROM users WHERE email IN ('info@remotebusinesspartner.com.au','shan.goodlet@lpg.com.au','buildingmanager.prima@gmail.com','buildingmanager.meridian@gmail.com') ORDER BY email;"
summary 'Production account and demo-lockdown checks passed.'

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

printf '\n== Authenticated role smoke checks ==\n'
if [ -n "${PROINSPECT_ADMIN_PASSWORD:-}" ] && \
   [ -n "${PROINSPECT_STRATA_PASSWORD:-}" ] && \
   [ -n "${PROINSPECT_PRIMA_BM_PASSWORD:-}" ] && \
   [ -n "${PROINSPECT_MERIDIAN_BM_PASSWORD:-}" ]; then
  smoke_role() {
    local email="$1"
    local password="$2"
    local page="$3"
    local api_path="$4"
    local jar payload
    jar="$(mktemp)"
    payload="$(jq -nc --arg email "$email" --arg password "$password" '{email:$email,password:$password}')"
    curl --fail --silent --show-error --cookie-jar "$jar" --header 'Content-Type: application/json' --data "$payload" "$LIVE_URL/api/login" >/dev/null
    curl --fail --silent --show-error --cookie "$jar" "$LIVE_URL$page" >/dev/null
    curl --fail --silent --show-error --cookie "$jar" "$LIVE_URL$api_path" >/dev/null
    rm -f "$jar"
  }

  smoke_role 'info@remotebusinesspartner.com.au' "$PROINSPECT_ADMIN_PASSWORD" '/strata' '/api/properties'
  smoke_role 'shan.goodlet@lpg.com.au' "$PROINSPECT_STRATA_PASSWORD" '/strata/reports' '/api/properties'
  smoke_role 'buildingmanager.prima@gmail.com' "$PROINSPECT_PRIMA_BM_PASSWORD" '/bm/forms' '/api/forms/options'
  smoke_role 'buildingmanager.meridian@gmail.com' "$PROINSPECT_MERIDIAN_BM_PASSWORD" '/bm/inspections' '/api/forms/options'
  summary 'Authenticated production role smoke checks passed.'
else
  summary 'Authenticated role smoke checks skipped because one or more production password secrets are not configured.'
fi

summary "Release commit: \`$RELEASE_SHA\`"
summary "Live URL: $LIVE_URL"
printf '\nProduction release completed successfully.\n'
