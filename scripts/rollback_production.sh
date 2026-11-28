#!/usr/bin/env bash
# Roll back Mac mini production code to a previous backup snapshot from ~/AI-Challenge-earth-quake-backups/.
# Preserves production .env, frontend/.env.local, and live backend/data/board.db.
set -euo pipefail

MACMINI_HOST="${MACMINI_HOST:-macmini}"
BACKUP_ID=""
LIST_ONLY=0

for arg in "$@"; do
  case "$arg" in
    --list) LIST_ONLY=1 ;;
    -h|--help)
      cat <<EOF
Usage: $0 [--list | <backup_id>]

Rolls back ~/AI-Challenge-earth-quake code on Mac mini to a timestamped backup created by deploy_macmini.sh.
If <backup_id> is omitted, uses the LATEST recorded backup.
Production .env, frontend/.env.local, and backend/data/board.db are NEVER overwritten automatically.
EOF
      exit 0
      ;;
    *)
      BACKUP_ID="$arg"
      ;;
  esac
done

run_on_target() {
  if [[ "$(hostname -s | tr '[:upper:]' '[:lower:]')" == "syuns-mac-mini" ]]; then
    bash -s -- "$LIST_ONLY" "$BACKUP_ID"
  else
    ssh -o BatchMode=yes "${MACMINI_HOST}" bash -s -- "$LIST_ONLY" "$BACKUP_ID"
  fi
}

run_on_target <<'EOF'
set -euo pipefail
LIST_ONLY="${1:-0}"
BACKUP_ID="${2:-}"
BACKUP_ROOT="${HOME}/AI-Challenge-earth-quake-backups"
APP_DIR="${HOME}/AI-Challenge-earth-quake"

if [[ "${LIST_ONLY}" -eq 1 ]]; then
  echo "Available backups in ${BACKUP_ROOT}:"
  ls -1dt "${BACKUP_ROOT}"/20* 2>/dev/null || echo "(none yet)"
  exit 0
fi

if [[ -z "${BACKUP_ID}" ]]; then
  if [[ -f "${BACKUP_ROOT}/LATEST" ]]; then
    BACKUP_ID="$(cat "${BACKUP_ROOT}/LATEST")"
  else
    echo "ERROR: No backup ID specified and ${BACKUP_ROOT}/LATEST not found." >&2
    exit 1
  fi
fi

SNAP_DIR="${BACKUP_ROOT}/${BACKUP_ID}"
ARCHIVE="${SNAP_DIR}/code_snapshot.tar.gz"
if [[ ! -f "${ARCHIVE}" ]]; then
  echo "ERROR: Snapshot archive not found: ${ARCHIVE}" >&2
  exit 1
fi

echo "==> Rolling back code to snapshot: ${BACKUP_ID}"
echo "    (Protecting .env, frontend/.env.local, and live backend/data/board.db)"

# Take a safety backup of live board.db before rollback
SAFETY_TS="$(date +%Y%m%d-%H%M%S)"
mkdir -p "${BACKUP_ROOT}/pre-rollback-${SAFETY_TS}"
if [[ -f "${APP_DIR}/backend/data/board.db" ]]; then
  /usr/bin/sqlite3 "${APP_DIR}/backend/data/board.db" ".backup '${BACKUP_ROOT}/pre-rollback-${SAFETY_TS}/board.db'"
  chmod 600 "${BACKUP_ROOT}/pre-rollback-${SAFETY_TS}/board.db"
fi

# Extract snapshot while strictly excluding secrets and live DB
/usr/bin/tar -xzf "${ARCHIVE}" -C "${APP_DIR}" \
  --exclude='.env' \
  --exclude='.env.*' \
  --exclude='frontend/.env.local' \
  --exclude='backend/.env' \
  --exclude='backend/data/board.db*'

export PATH="/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/bin:/bin"
echo "==> Rebuilding backend dependencies..."
(cd "${APP_DIR}/backend" && /opt/homebrew/bin/uv sync --frozen --python /opt/homebrew/bin/python3.12)

echo "==> Rebuilding frontend production bundle..."
(cd "${APP_DIR}/frontend" && npm ci && npm run build)

echo "==> Restarting launchd services..."
UID_NUM="$(id -u)"
for svc in com.quakelens.backend com.quakelens.frontend; do
  if launchctl print "gui/${UID_NUM}/${svc}" >/dev/null 2>&1; then
    launchctl kickstart -k "gui/${UID_NUM}/${svc}"
  else
    launchctl bootstrap "gui/${UID_NUM}" "${HOME}/Library/LaunchAgents/${svc}.plist"
  fi
done

echo "==> Waiting for health check..."
for i in $(seq 1 40); do
  if curl -fsS http://127.0.0.1:8000/api/health >/dev/null 2>&1 && curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
    echo "Rollback healthy after ${i}s"
    curl -sS http://127.0.0.1:3000/api/health
    echo ""
    break
  fi
  if [[ "$i" -eq 40 ]]; then
    echo "ERROR: Health check timed out after rollback" >&2
    exit 1
  fi
  sleep 1
done

echo "Note: If you also need to restore board.db from ${BACKUP_ID}, manually stop services and copy ${SNAP_DIR}/board.db."
EOF
