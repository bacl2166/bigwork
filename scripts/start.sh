#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -f .env ]]; then
  set -a
  source .env
  set +a
fi
if [[ "${1:-}" == "--demo" ]]; then export CAREERLENS_MODE=demo; fi
if [[ ! -x .venv/bin/python ]]; then echo '请先运行 bash scripts/install.sh'; exit 1; fi
export CAREERLENS_MODE="${CAREERLENS_MODE:-ollama}"
export OLLAMA_MODEL="${OLLAMA_MODEL:-qwen2.5:3b}"
echo "CareerLens 模式：$CAREERLENS_MODE，模型：$OLLAMA_MODEL"
echo "访问 http://${CAREERLENS_HOST:-127.0.0.1}:${CAREERLENS_PORT:-8000}，按 Ctrl+C 停止。"
exec .venv/bin/python -m uvicorn careerlens.app:create_app --factory --host "${CAREERLENS_HOST:-127.0.0.1}" --port "${CAREERLENS_PORT:-8000}"
