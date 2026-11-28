#!/usr/bin/env bash
# Stop QuakeLens production launchd services on Mac mini.
# Pass --unpublish to also disable Tailscale Funnel public HTTPS exposure.
set -euo pipefail

MACMINI_HOST="${MACMINI_HOST:-macmini}"
UNPUBLISH=0

for arg in "$@"; do
  case "$arg" in
    --unpublish) UNPUBLISH=1 ;;
    -h|--help)
      echo "Usage: $0 [--unpublish]"
      echo "  --unpublish   Also stop Tailscale Funnel HTTPS exposure (tailscale funnel --https=443 off)"
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
    bash -s -- "$UNPUBLISH"
  else
    ssh -o BatchMode=yes "${MACMINI_HOST}" bash -s -- "$UNPUBLISH"
  fi
}

run_on_target <<'EOF'
set -euo pipefail
UNPUBLISH="$1"
UID_NUM="$(id -u)"
SERVICES=(
  com.quakelens.frontend
  com.quakelens.backend
  com.quakelens.caffeinate
  com.quakelens.logrotate
)

if [[ "${UNPUBLISH}" -eq 1 ]]; then
  TS="/Applications/Tailscale.app/Contents/MacOS/Tailscale"
  echo "Disabling Tailscale Funnel HTTPS exposure..."
  "${TS}" funnel --https=443 off || true
  "${TS}" funnel status || true
else
  echo "Note: Tailscale Funnel config left unchanged (pass --unpublish to disable public HTTPS)."
fi

for svc in "${SERVICES[@]}"; do
  if launchctl print "gui/${UID_NUM}/${svc}" >/dev/null 2>&1; then
    launchctl bootout "gui/${UID_NUM}/${svc}" || true
    echo "Stopped: ${svc}"
  else
    echo "Already stopped: ${svc}"
  fi
done
EOF
