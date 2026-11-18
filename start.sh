#!/usr/bin/env bash
set -euo pipefail

# Ensure uv, node/npm (nvm), homebrew, and conda paths are available even in non-login shells
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:$HOME/opt/anaconda3/bin:$PATH"
[[ -f "$HOME/.local/bin/env" ]] && source "$HOME/.local/bin/env"
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[[ -s "$NVM_DIR/nvm.sh" ]] && source "$NVM_DIR/nvm.sh"

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

cleanup() {
  echo ""
  echo "Stopping QuakeLens Japan servers..."
  [[ -n "${BACK_PID:-}" ]] && kill "$BACK_PID" 2>/dev/null || true
  [[ -n "${FRONT_PID:-}" ]] && kill "$FRONT_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "1/2 Starting FastAPI backend on http://127.0.0.1:8000 ..."
(
  cd "$ROOT_DIR/backend"
  uv sync --quiet
  exec uv run uvicorn app.main:app --host 127.0.0.1 --port 8000
) &
BACK_PID=$!

# Wait briefly for backend health check
for _ in $(seq 1 40); do
  if curl -sf http://127.0.0.1:8000/api/health >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

echo "2/2 Starting Next.js frontend on http://localhost:3000 ..."
(
  cd "$ROOT_DIR/frontend"
  if [[ ! -d node_modules ]]; then
    npm install
  fi
  exec npm run dev -- --port 3000
) &
FRONT_PID=$!

echo ""
echo "=========================================================="
echo " QuakeLens Japan is starting!"
echo "  Webアプリ (ブラウザで開く): http://localhost:3000"
echo "  Backend API Docs:           http://127.0.0.1:8000/docs"
echo "  終了するには Ctrl+C を押してください"
echo "=========================================================="
echo ""

wait
