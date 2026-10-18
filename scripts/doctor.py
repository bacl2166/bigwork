"""Non-mutating deployment check. Run with the application's Python."""
import importlib.util
import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from careerlens.config import Settings
from careerlens.llm import OllamaClient


def main():
    print('系统:', platform.platform())
    print('Python:', sys.version.split()[0])
    missing = [name for name in ('fastapi', 'uvicorn', 'multipart', 'pypdf', 'docx', 'httpx') if not importlib.util.find_spec(name)]
    print('依赖:', ', '.join(missing) if missing else '全部可导入')
    if shutil.which('nvidia-smi'):
        subprocess.run(['nvidia-smi', '--query-gpu=name,memory.total,memory.free', '--format=csv,noheader'], check=False)
    settings = Settings()
    h = OllamaClient(settings).health()
    print('Ollama:', h['message'])
    print('目标模型:', settings.model, '上下文:', settings.num_ctx)
    return 0 if not missing and h['model_ready'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
