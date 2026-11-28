#!/usr/bin/env bash
# Deploy local MacBook Pro changes to Mac mini production server safely.
# - Non-destructive rsync (no --delete)
# - Never overwrites remote .env, frontend/.env.local, or backend/data/board.db
# - Creates timestamped code + SQLite snapshot before updating for rollback_production.sh
set -euo pipefail

MACMINI_HOST="${MACMINI_HOST:-macmini}"
REMOTE_DIR="${REMOTE_DIR:-~/AI-Challenge-earth-quake}"
PUBLIC_URL="${PUBLIC_URL:-https://syuns-mac-mini.tail375645.ts.net}"

SKIP_BACKEND_DEPS=0
SKIP_FRONTEND_BUILD=0
DRY_RUN=0

for arg in "$@"; do
  case "$arg" in
    --skip-backend-deps) SKIP_BACKEND_DEPS=1 ;;
    --skip-frontend-build) SKIP_FRONTEND_BUILD=1 ;;
    --dry-run) DRY_RUN=1 ;;
    -h|--help)
      cat <<EOF
Usage: $0 [--skip-backend-deps] [--skip-frontend-build] [--dry-run]

Safely deploys local code from MacBook Pro to Mac mini (${MACMINI_HOST}:${REMOTE_DIR}).
Protects production .env, frontend/.env.local, and backend/data/board.db.
EOF
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 1
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [[ "$(hostname -s | tr '[:upper:]' '[:lower:]')" == "syuns-mac-mini" ]]; then
  echo "Error: Run deploy_macmini.sh from the MacBook Pro development machine, not Mac mini." >&2
  exit 1
fi

echo "==> Checking SSH connectivity to ${MACMINI_HOST}..."
ssh -o BatchMode=yes "${MACMINI_HOST}" 'hostname && whoami' >/dev/null

TS="$(date +%Y%m%d-%H%M%S)"
LOCAL_COMMIT="$(git -C "${PROJECT_ROOT}" rev-parse --short HEAD 2>/dev/null || echo unknown)"
echo "==> Deploying from ${PROJECT_ROOT} (git HEAD: ${LOCAL_COMMIT}) -> ${MACMINI_HOST}:${REMOTE_DIR}"

if [[ "${DRY_RUN}" -eq 0 ]]; then
  echo "==> Creating remote pre-deploy backup snapshot (${TS})..."
  ssh -o BatchMode=yes "${MACMINI_HOST}" bash -s -- "${TS}" <<'REMOTE_BACKUP'
set -euo pipefail
TS="$1"
APP_DIR="${HOME}/AI-Challenge-earth-quake"
BACKUP_ROOT="${HOME}/AI-Challenge-earth-quake-backups"
SNAP_DIR="${BACKUP_ROOT}/${TS}"

mkdir -p "${SNAP_DIR}"
cd "${APP_DIR}"

if [[ -f backend/data/board.db ]]; then
  /usr/bin/sqlite3 backend/data/board.db ".backup '${SNAP_DIR}/board.db'"
  chmod 600 "${SNAP_DIR}/board.db"
fi

git rev-parse HEAD > "${SNAP_DIR}/git_head.txt" 2>/dev/null || true

/usr/bin/tar -czf "${SNAP_DIR}/code_snapshot.tar.gz" \
  --exclude='.git' \
  --exclude='.env' \
  --exclude='.env.*' \
  --exclude='frontend/.env.local' \
  --exclude='backend/.env' \
  --exclude='backend/.venv' \
  --exclude='backend/data/raw' \
  --exclude='backend/data/board.db*' \
  --exclude='frontend/node_modules' \
  --exclude='frontend/.next' \
  --exclude='__pycache__' \
  --exclude='.pytest_cache' \
  .

printf '%s\n' "${TS}" > "${BACKUP_ROOT}/LATEST"

# Keep only the latest 10 release backups
ls -1dt "${BACKUP_ROOT}"/20* 2>/dev/null | tail -n +11 | while IFS= read -r old_dir; do
  [[ -n "${old_dir}" ]] && rm -rf "${old_dir}"
done

echo "Backup saved: ${SNAP_DIR}"
REMOTE_BACKUP
fi

RSYNC_OPTS=(
  -az
  --itemize-changes
  --exclude='.env'
  --exclude='.env.*'
  --exclude='backend/.env'
  --exclude='frontend/.env.local'
  --exclude='frontend/.env.*'
  --exclude='backend/data/board.db'
  --exclude='backend/data/board.db-*'
  --exclude='backend/data/raw'
  --exclude='backend/.venv'
  --exclude='backend/__pycache__'
  --exclude='**/__pycache__'
  --exclude='.pytest_cache'
  --exclude='**/.pytest_cache'
  --exclude='*.pyc'
  --exclude='frontend/node_modules'
  --exclude='frontend/.next'
  --exclude='frontend/.turbo'
  --exclude='.DS_Store'
  --exclude='*.mp4'
  --exclude='*.pdf'
  --exclude='*.log'
  --exclude='quakelens_google_ai_challenge_2026_*'
  --exclude='frontend/tsconfig.tsbuildinfo'
  --exclude='frontend/public/maplibre-gl-worker.cjs'
  --exclude='もちまも.jpg'
  --exclude='backend/package-lock.json'
)

if [[ "${DRY_RUN}" -eq 1 ]]; then
  RSYNC_OPTS+=(--dry-run)
  echo "==> Running rsync dry-run (no files modified)..."
  rsync "${RSYNC_OPTS[@]}" "${PROJECT_ROOT}/" "${MACMINI_HOST}:${REMOTE_DIR}/"
  exit 0
fi

echo "==> Syncing files to ${MACMINI_HOST} (protecting .env and board.db)..."
rsync "${RSYNC_OPTS[@]}" "${PROJECT_ROOT}/" "${MACMINI_HOST}:${REMOTE_DIR}/"

echo "==> Rebuilding production runtime on Mac mini and restarting services..."
ssh -o BatchMode=yes "${MACMINI_HOST}" bash -s -- "${SKIP_BACKEND_DEPS}" "${SKIP_FRONTEND_BUILD}" <<'REMOTE_BUILD'
set -euo pipefail
SKIP_BACKEND_DEPS="$1"
SKIP_FRONTEND_BUILD="$2"
export PATH="/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/bin:/bin"
cd "${HOME}/AI-Challenge-earth-quake"
chmod +x scripts/*.sh 2>/dev/null || true

if [[ "${SKIP_BACKEND_DEPS}" -eq 0 ]]; then
  echo "--- uv sync (backend) ---"
  (cd backend && /opt/homebrew/bin/uv sync --frozen --python /opt/homebrew/bin/python3.12)
fi

if [[ "${SKIP_FRONTEND_BUILD}" -eq 0 ]]; then
  echo "--- npm ci & next build (frontend) ---"
  (cd frontend && npm ci && npm run build)
  echo "--- Checking GEMINI_API_KEY & GOV_REGISTRATION_CODE non-leakage in .next/static ---"
  /opt/homebrew/bin/python3.12 - <<'PY'
from pathlib import Path

env_text = Path(".env").read_text(encoding="utf-8")
for key_name in ("GEMINI_API_KEY", "GOV_REGISTRATION_CODE"):
    secret = ""
    for line in env_text.splitlines():
        if line.strip().startswith(key_name + "="):
            secret = line.split("=", 1)[1].strip().strip("\"'")
            break
    if secret:
        hits = [
            str(p)
            for p in Path("frontend/.next/static").rglob("*")
            if p.is_file() and secret.encode("utf-8") in p.read_bytes()
        ]
        assert not hits, f"SECRET LEAK DETECTED ({key_name}) in {hits}"
print("Secret leakage check passed (0 hits).")
PY
fi

echo "--- Restarting launchd services ---"
UID_NUM="$(id -u)"
for svc in com.quakelens.backend com.quakelens.frontend; do
  if launchctl print "gui/${UID_NUM}/${svc}" >/dev/null 2>&1; then
    launchctl kickstart -k "gui/${UID_NUM}/${svc}"
  else
    launchctl bootstrap "gui/${UID_NUM}" "${HOME}/Library/LaunchAgents/${svc}.plist"
  fi
done

echo "--- Waiting for local health checks ---"
for i in $(seq 1 40); do
  if curl -fsS http://127.0.0.1:8000/api/health >/dev/null 2>&1 && curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
    echo "Local services healthy (${i}s)"
    break
  fi
  if [[ "$i" -eq 40 ]]; then
    echo "ERROR: Local health check timed out!" >&2
    exit 1
  fi
  sleep 1
done
REMOTE_BUILD

echo "==> Verifying public HTTPS endpoint (${PUBLIC_URL}/api/health)..."
curl -fsS "${PUBLIC_URL}/api/health"
echo ""
echo "==> Deploy complete! Rollback snapshot ID: ${TS}"
