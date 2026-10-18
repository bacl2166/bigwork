#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Run on an online Linux machine matching the target architecture and Python version.
mkdir -p wheelhouse
python3 -m pip download --only-binary=:all: -r requirements.txt -d wheelhouse
echo 'wheelhouse 已准备。另行复制 Ollama 安装文件和模型目录；参见 README 的离线部署章节。'
