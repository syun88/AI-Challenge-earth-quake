#!/usr/bin/env bash
set -euo pipefail

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
for _ in $(seq 1 30); do
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
