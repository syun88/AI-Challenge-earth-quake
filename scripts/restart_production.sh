#!/usr/bin/env bash
# Restart QuakeLens production backend and frontend launchd services cleanly and verify health.
set -euo pipefail

MACMINI_HOST="${MACMINI_HOST:-macmini}"

run_on_target() {
  if [[ "$(hostname -s | tr '[:upper:]' '[:lower:]')" == "syuns-mac-mini" ]]; then
    bash -s
  else
    ssh -o BatchMode=yes "${MACMINI_HOST}" bash -s
  fi
}

run_on_target <<'EOF'
set -euo pipefail
UID_NUM="$(id -u)"

for svc in com.quakelens.backend com.quakelens.frontend; do
  if launchctl print "gui/${UID_NUM}/${svc}" >/dev/null 2>&1; then
    launchctl kickstart -k "gui/${UID_NUM}/${svc}"
    echo "Restarted: ${svc}"
  else
    launchctl bootstrap "gui/${UID_NUM}" "${HOME}/Library/LaunchAgents/${svc}.plist"
    echo "Bootstrapped: ${svc}"
  fi
done

echo "Waiting for backend & frontend health..."
for i in $(seq 1 40); do
  if curl -fsS http://127.0.0.1:8000/api/health >/dev/null 2>&1 && curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
    echo "Healthy after ${i}s"
    curl -sS http://127.0.0.1:3000/api/health
    echo ""
    break
  fi
  if [[ "$i" -eq 40 ]]; then
    echo "ERROR: Health check timed out after restart" >&2
    exit 1
  fi
  sleep 1
done

launchctl list | grep com.quakelens || true
EOF
