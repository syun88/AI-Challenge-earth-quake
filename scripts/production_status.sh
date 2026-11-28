#!/usr/bin/env bash
# Inspect live status of QuakeLens production services, ports, RAM, DB integrity, Funnel, and recent error logs.
set -euo pipefail

MACMINI_HOST="${MACMINI_HOST:-macmini}"
PUBLIC_URL="${PUBLIC_URL:-https://syuns-mac-mini.tail375645.ts.net}"

run_on_target() {
  if [[ "$(hostname -s | tr '[:upper:]' '[:lower:]')" == "syuns-mac-mini" ]]; then
    bash -s -- "$PUBLIC_URL"
  else
    ssh -o BatchMode=yes "${MACMINI_HOST}" bash -s -- "$PUBLIC_URL"
  fi
}

run_on_target <<'EOF'
set -euo pipefail
PUBLIC_URL="$1"
TS="/Applications/Tailscale.app/Contents/MacOS/Tailscale"

echo "=== Host & Uptime ==="
hostname
uptime

echo "=== launchd Services ==="
launchctl list | grep com.quakelens || echo "(none running)"

echo "=== Listening Ports (3000 / 8000) ==="
lsof -iTCP:3000,8000 -sTCP:LISTEN -n -P 2>/dev/null || echo "(not listening)"

echo "=== Process Memory (RSS KB) ==="
PIDS=$(launchctl list | awk '/com\.quakelens\.(backend|frontend|caffeinate)/ && $1 != "-" {print $1}' | paste -sd, -)
if [[ -n "${PIDS}" ]]; then
  ps -o pid,rss,pcpu,pmem,etime,comm -p "${PIDS}"
fi

echo "=== Local Health Checks ==="
printf "Backend  127.0.0.1:8000 -> HTTP %s\n" "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8000/api/health || echo 000)"
printf "Frontend 127.0.0.1:3000 -> HTTP %s\n" "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/health || echo 000)"
curl -sS http://127.0.0.1:3000/api/health || true
echo ""

echo "=== Public HTTPS Health (${PUBLIC_URL}) ==="
printf "Public HTTPS            -> HTTP %s\n" "$(curl -s -o /dev/null -w '%{http_code}' "${PUBLIC_URL}/api/health" || echo 000)"

echo "=== Tailscale Funnel Status ==="
"${TS}" funnel status || true

echo "=== SQLite Integrity & Row Counts ==="
DB="${HOME}/AI-Challenge-earth-quake/backend/data/board.db"
if [[ -f "${DB}" ]]; then
  /usr/bin/sqlite3 "${DB}" "PRAGMA integrity_check;"
  /usr/bin/sqlite3 "${DB}" "SELECT 'auth_profiles', count(*) FROM auth_profiles UNION ALL SELECT 'board_entries', count(*) FROM board_entries UNION ALL SELECT 'damage_reports', count(*) FROM damage_reports;"
fi

echo "=== Disk Usage (/) ==="
df -h /

echo "=== Recent Error Logs (last 10 lines each) ==="
for lf in "${HOME}/Library/Logs/quakelens/backend.err.log" "${HOME}/Library/Logs/quakelens/frontend.err.log"; do
  echo "--- ${lf} ---"
  tail -n 10 "${lf}" 2>/dev/null || echo "(empty)"
done
EOF
