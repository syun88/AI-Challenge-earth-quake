#!/usr/bin/env bash
# Start QuakeLens production launchd services and ensure Tailscale Funnel is active.
# Works both locally on Mac mini and remotely from MacBook Pro via SSH.
set -euo pipefail

MACMINI_HOST="${MACMINI_HOST:-macmini}"
NO_FUNNEL=0

for arg in "$@"; do
  case "$arg" in
    --no-funnel) NO_FUNNEL=1 ;;
    -h|--help)
      echo "Usage: $0 [--no-funnel]"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 1
      ;;
  esac
done

run_on_target() {
  if [[ "$(hostname -s | tr '[:upper:]' '[:lower:]')" == "syuns-mac-mini" ]]; then
    bash -s -- "$NO_FUNNEL"
  else
    ssh -o BatchMode=yes "${MACMINI_HOST}" bash -s -- "$NO_FUNNEL"
  fi
}

run_on_target <<'EOF'
set -euo pipefail
NO_FUNNEL="$1"
UID_NUM="$(id -u)"
SERVICES=(
  com.quakelens.backend
  com.quakelens.frontend
  com.quakelens.caffeinate
  com.quakelens.logrotate
)

for svc in "${SERVICES[@]}"; do
  plist="${HOME}/Library/LaunchAgents/${svc}.plist"
  if [[ ! -f "${plist}" ]]; then
    echo "ERROR: Missing LaunchAgent plist: ${plist}" >&2
    exit 1
  fi
  if launchctl print "gui/${UID_NUM}/${svc}" >/dev/null 2>&1; then
    echo "Service already loaded: ${svc}"
  else
    launchctl bootstrap "gui/${UID_NUM}" "${plist}"
    echo "Bootstrapped: ${svc}"
  fi
done

echo "Waiting for local backend and frontend health..."
for i in $(seq 1 40); do
  if curl -fsS http://127.0.0.1:8000/api/health >/dev/null 2>&1 && curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
    echo "Healthy after ${i}s"
    break
  fi
  if [[ "$i" -eq 40 ]]; then
    echo "ERROR: Timed out waiting for /api/health" >&2
    exit 1
  fi
  sleep 1
done

if [[ "${NO_FUNNEL}" -eq 0 ]]; then
  TS="/Applications/Tailscale.app/Contents/MacOS/Tailscale"
  "${TS}" funnel --bg http://127.0.0.1:3000
  "${TS}" funnel status
fi

launchctl list | grep com.quakelens || true
EOF
