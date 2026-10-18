# CareerLens 本地求职材料诊断与模拟面试系统

面向大学生和应届生的本地求职训练应用。导入简历与岗位描述，生成带原文证据的能力矩阵，再进行 5–12 轮文字面试，保存逐轮反馈并导出训练报告。所有 Web 资源在项目内，正式模式通过本机 Ollama 调用开源模型。

## 功能

- PDF / DOCX / TXT 简历导入，支持粘贴及编辑，上传原文件不落盘。
- 岗位要求提取，必需项/加分项分权重，有行动证据/仅提及/缺证据三种状态。
- 引用按简历和岗位原文核验，定位字符位置，剔除无效引用并显示提醒。
- BM25 本地检索个人材料与训练指南，分离方法知识与个人事实。
- 根据岗位、项目及本轮回答生成面试追问，六维评分与具体训练建议。
- 暂停、恢复、训练历史、材料版本与面试快照；重复提交冲突检查。
- HTML 诊断及面试报告，在浏览器打印保存为 PDF。
- 显式规则演示模式，用于不安装模型时检查工作流。规则结果始终标注，不会静默代替大模型。

## Linux 快速启动

推荐 Ubuntu 22.04/24.04，Python 3.10+，16 GB 内存，NVIDIA GPU 6 GB 以上；确保驱动能执行 `nvidia-smi`。硬件建议不构成性能保证。

首次安装需要联网，后续运行可断网。

```bash
# Ubuntu/Debian 系统先准备 Python venv（如尚未安装）
sudo apt-get install python3 python3-venv python3-pip

# 在项目目录安装应用依赖
bash scripts/install.sh

# 按 https://docs.ollama.com/linux 安装 Ollama
# 启动服务：若安装后 systemd 服务已运行，不必重复启动
ollama serve
```

另开终端，在项目目录运行：

```bash
# 首次准备本地模型，下载可能数 GB
ollama pull qwen2.5:3b

cp .env.example .env
.venv/bin/python scripts/doctor.py
bash scripts/start.sh
```

浏览器访问 http://127.0.0.1:8000 。点击“体验示例材料”，保存材料，进行岗位分析，再开启模拟面试。API 文档为 http://127.0.0.1:8000/docs 。Ctrl+C 停止 Web 服务，数据仍保留。

无需模型的功能演示：

```bash
bash scripts/start.sh --demo
```

规则演示仅走通流程，不能作为大模型能力实验。模型未连接时正式模式会报错，不会自动降级。

## 模型与显存

默认 `qwen2.5:3b`，针对 6 GB 显存优先选择较小模型。8–12 GB 可在 `.env` 设置 `OLLAMA_MODEL=qwen2.5:7b`，并提前 `ollama pull qwen2.5:7b`。3B 和 7B 的许可不同，分发模型前请阅读对应模型许可。7B 标签的模型文件约 4.7 GB，这不包括运行时与 KV Cache。

默认 `OLLAMA_NUM_CTX=4096`；分析、首题、逐轮反馈分别预留 1800、350、1000 token 输出。系统按中文字符与其他字符估算上下文预算，超限直接要求精简材料或提高上下文，避免静默截断。这是保守估算，并非模型精确分词。增加上下文会增加显存需求；长回答与会话历史可能触发预算提示。可优先简化简历、岗位或回答；显存允许时设置 8192。材料表单上限是存储上限，不保证所有上限长度能同时放入 4096 上下文。

推理质量与耗时需在目标机器实测。健康检查证明服务可达且模型已下载，不证明模型已完整驻留 GPU。运行 `ollama ps` 查看处理器与上下文，结合 `nvidia-smi` 检查显存；应用不保证纯 GPU 推理。

## 配置

| 变量 | 默认值 | 说明 |
|---|---|---|
| CAREERLENS_MODE | ollama | ollama 正式推理 / demo 规则演示 |
| OLLAMA_URL | http://127.0.0.1:11434 | 只允许本机 HTTP 地址 |
| OLLAMA_MODEL | qwen2.5:3b | 已安装的本地模型标签 |
| OLLAMA_TIMEOUT | 180 | 单次模型调用秒数 |
| OLLAMA_NUM_CTX | 4096 | 上下文长度，2048–32768 |
| CAREERLENS_DATA_DIR | ./data | SQLite 数据存放目录 |
| CAREERLENS_HOST | 127.0.0.1 | 默认仅本机访问 |
| CAREERLENS_PORT | 8000 | Web 端口 |

`start.sh` 加载本地 `.env`，它是受信任的 Shell 配置文件，不要使用来历不明的 `.env`。直接运行 uvicorn 不会自动加载 `.env`，请先导出环境变量。

首版定位为本机单用户应用。不要直接暴露到公网；没有多用户认证。向局域网部署需要另行增加鉴权、TLS 及用户隔离。数据库为明文；包含个人信息的设备应使用系统磁盘加密。关闭应用后备份整个 `data` 目录；运行时不要只拷贝 `.sqlite3` 而遗漏 WAL。删除项目会级联删除关联分析和面试，应用不提供撤销。

## 离线安装与容器

在与目标机 Python 版本和 CPU 架构一致的联网 Linux 机器执行 `bash scripts/prepare-offline.sh`。复制源码和 wheelhouse 到目标机，运行 `bash scripts/install.sh --offline`。模型通过 Ollama 预先拉取后，按 Ollama 官方说明迁移模型目录（常见位置因服务用户和 OLLAMA_MODELS 配置而异），并准备对应 Linux Ollama 安装包。首次离线安装前须已经具备 Python、venv 与驱动，不能只复制 Windows 虚拟环境。

Linux 也可运行 `docker compose up --build -d`。配置使用 host 网络访问宿主机 Ollama，应用仍仅监听 127.0.0.1。默认构建需要联网下载基础镜像与依赖；离线使用须在联网机预先构建并通过 `docker save`/`docker load` 转移镜像。Compose 不安装 Ollama，也不下载模型。

## 开发与测试

```bash
bash scripts/test.sh
# Windows 开发验证
.venv\Scripts\python.exe -m pytest -q
$env:CAREERLENS_MODE='demo'
.venv\Scripts\python.exe -m uvicorn careerlens.app:create_app --factory --host 127.0.0.1 --port 8000
```

测试使用真实 SQLite、实际解析库及本地 HTTP 协议测试服务；规则测试不需要大模型。详细实测与未验证项目见 `docs/test-results.md`，课程报告见 `docs/课程报告.md`。

## 演示流程

1. 打开工作台，检查引擎状态，加载示例材料并保存。
2. 生成诊断，展示 Python 的项目引用及 Docker 等材料缺口。
3. 查看匹配公式、原文和逐条建议，解释“缺证据”与“不会”不同。
4. 开始 5 轮面试，第一轮简短回答，观察追问；后续补充个人行动和验证方法。
5. 暂停后刷新页面，从训练档案恢复；继续直到完成。
6. 打开训练报告，用浏览器打印保存 PDF。
7. 修改简历并保存，展示当前分析失效、历史面试保留旧快照。

## 局限

扫描 PDF 无 OCR；复杂多栏简历需人工核对解析结果。引用核验只能证明引文存在，不能证明经历真实或语义推断正确。行动词证据分级与 BM25 对同义表达有限；模型建议、评分和事实一致性判断均需人工复核。首版不执行自动简历改写，避免将未经确认的新事实写入材料。语音、视频与自动投递不在本版范围。

## 参考

- Ollama Chat API：https://docs.ollama.com/api/chat
- Ollama Linux 安装：https://docs.ollama.com/linux
- Qwen2.5 模型与许可：https://ollama.com/library/qwen2.5
- FastAPI：https://fastapi.tiangolo.com/
