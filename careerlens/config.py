import os
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent


@dataclass
class Settings:
    data_dir: Path = field(default_factory=lambda: Path(os.getenv('CAREERLENS_DATA_DIR', ROOT / 'data')))
    mode: str = field(default_factory=lambda: os.getenv('CAREERLENS_MODE', 'ollama'))
    ollama_url: str = field(default_factory=lambda: os.getenv('OLLAMA_URL', 'http://127.0.0.1:11434'))
    model: str = field(default_factory=lambda: os.getenv('OLLAMA_MODEL', 'qwen2.5:3b'))
    timeout: float = field(default_factory=lambda: float(os.getenv('OLLAMA_TIMEOUT', '180')))
    num_ctx: int = field(default_factory=lambda: int(os.getenv('OLLAMA_NUM_CTX', '4096')))
    public_origin: str = field(default_factory=lambda: os.getenv('CAREERLENS_PUBLIC_ORIGIN', '').strip())

    def __post_init__(self):
        self.data_dir = Path(self.data_dir)
        p = urlparse(self.ollama_url)
        if p.scheme != 'http' or p.hostname not in ('127.0.0.1', 'localhost', '::1') or p.username or p.password or p.path not in ('', '/') or p.query or p.fragment:
            raise ValueError('仅允许本机 http://127.0.0.1:11434 Ollama 服务地址')
        if self.mode not in ('ollama', 'demo'):
            raise ValueError('CAREERLENS_MODE 仅支持 ollama 或 demo')
        if not 2048 <= self.num_ctx <= 32768 or self.timeout <= 0:
            raise ValueError('上下文须为 2048–32768，超时须大于 0')
        if self.public_origin:
            origin = urlparse(self.public_origin)
            if (origin.scheme not in ('http', 'https') or not origin.hostname or
                    '*' in origin.netloc or origin.username is not None or origin.password is not None or
                    origin.path not in ('', '/') or origin.query or origin.fragment or
                    any(char.isspace() for char in self.public_origin)):
                raise ValueError('CAREERLENS_PUBLIC_ORIGIN 必须是完整的 http/https 来源地址，不含路径、通配符或认证信息')
            port = origin.port  # Validates numeric port and range.
            hostname = origin.hostname.lower()
            hostname = '[' + hostname + ']' if ':' in hostname else hostname
            default_port = 443 if origin.scheme == 'https' else 80
            authority = hostname if port in (None, default_port) else f'{hostname}:{port}'
            self.public_origin = f'{origin.scheme}://{authority}'
