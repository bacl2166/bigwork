#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
PYTHON="${PYTHON:-python3}"
"$PYTHON" -c 'import sys; assert sys.version_info >= (3,10), "需要 Python 3.10 或以上"'
"$PYTHON" -m venv .venv
if [[ "${1:-}" == "--offline" ]]; then
  .venv/bin/python -m pip install --no-index --find-links wheelhouse -r requirements.txt
else
  .venv/bin/python -m pip install -r requirements.txt
fi
echo '依赖安装完成。正式运行前请准备 Ollama 和本地模型，详见 README.md。'
echo '启动：bash scripts/start.sh；无模型流程演示：bash scripts/start.sh --demo'
