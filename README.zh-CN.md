# 写书工具台（Writing Workbench）

[English](README.md)

写书工具台是一个轻量、本地优先的 Markdown/TXT 长篇写作工作区。它把章节导航、专注编辑、修改辅助和明确的保存安全机制放进一个可自行运行的 Flask 应用中。

核心写作流程可离线使用。AI 功能完全可选，默认调用本机 Hermes agent；项目也保留不会联网的确定性 mock provider。Writing Workbench 本身不需要 API Key。

> 截图占位说明：首次公开发布前，请使用项目自带的虚构示例书稿截取三栏工作区。截图中不得出现浏览器书签、本地路径、通知、账号或 provider 凭据；将清理后的图片放入 `docs/images/`，再在这里加入链接。

## 项目定位与边界

本仓库只包含一个产品：写书工具台。所有功能都必须直接服务于书稿的写作或维护。

## 功能

- 浏览、搜索和排序 `.md`、`.txt` 章节。
- 新建、读取、编辑并手动保存本地章节。
- 通过环境变量或 CLI 参数指定书稿目录。
- 首次启动自动建立完全虚构、中性的示例书稿。
- 拒绝不安全文件名和目录穿越。
- 使用 SHA-256 版本标识发现并发编辑，以 HTTP `409` 阻止静默覆盖。
- 使用临时文件和原子替换写入，覆盖前备份，并轮换旧备份。
- 提供字数统计、未保存提醒和常用快捷键。
- 支持 AI 改写预览、替换和撤销。
- 可围绕明确提交的书稿上下文进行书情问答。
- 可分析全部已保存章节的人物关系、伏笔、连续性风险，并给出下一章建议。
- 根据浏览器及操作系统语言偏好自动选择英文或简体中文界面。
- 在当前浏览器的 localStorage 中保留最多 60 条操作历史和 30 条问答消息，并提供界面内清空操作。
- 提供健康检查接口和一致的结构化错误。

## 快速开始

需要 Python 3.11 或更高版本。

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -e '.[dev]'
python -m writing_workbench
```

打开 <http://127.0.0.1:8787>。默认书稿目录不存在时会自动创建。如需更换目录，可直接设置环境变量：

```bash
WRITING_WORKBENCH_DIR="$PWD/my-manuscript" python -m writing_workbench
```

也可以用 CLI 明确指定：

```bash
python -m writing_workbench --manuscripts-dir "$PWD/my-manuscript" --host 127.0.0.1 --port 8787
```

同一配置同时出现时，CLI 参数优先于环境变量。以 `python -m writing_workbench --help` 列出的参数为准。

### 测试与代码检查

```bash
ruff check .
ruff format --check .
pytest
```

### Docker Compose

```bash
docker compose up --build
```

Compose 默认将服务发布到 <http://127.0.0.1:8000>，书稿保存在本地命名卷。正式用于重要书稿前，请自行审阅挂载位置和备份方案。

## 配置

应用在启动时读取配置。密钥只能通过进程环境提供；浏览器不接收密钥，项目也不会把密钥写入配置文件。

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `WRITING_WORKBENCH_DIR` | `./manuscripts` | 存放 `.md` 和 `.txt` 章节的目录 |
| `WRITING_WORKBENCH_HOST` | `127.0.0.1` | 监听地址；未加入访问控制前应保持回环地址 |
| `WRITING_WORKBENCH_PORT` | `8787` | HTTP 端口 |
| `WRITING_WORKBENCH_MAX_REQUEST_BYTES` | `2097152` | 请求体字节上限 |
| `WRITING_WORKBENCH_MAX_FILE_BYTES` | `1900000` | 单章字节上限 |
| `WRITING_WORKBENCH_BACKUP_LIMIT` | `10` | 每章最多保留的备份数 |
| `WRITING_WORKBENCH_CREATE_EXAMPLES` | `true` | 书稿目录为空时创建两章中性示例稿 |
| `WRITING_WORKBENCH_BOOK_TITLE` | 根据目录推断 | 当前书稿的界面显示名称 |
| `WRITING_WORKBENCH_TARGET_WORDS` | `80000` | 宿主工具台显示书稿进度时使用的目标字数 |
| `WRITING_WORKBENCH_SUITE_HOME_URL` | 空 | 挂载到其他本地工具台时可选的返回链接 |
| `WRITING_WORKBENCH_SUITE_HOME_LABEL` | `Back to local tools` | 可选返回链接的无障碍说明 |
| `WRITING_WORKBENCH_SUITE_MARK` | `WW` | 可选返回链接内显示的短标识 |
| `WRITING_WORKBENCH_AI_PROVIDER` | `hermes` | `hermes`、`mock` 或 `off` |
| `WRITING_WORKBENCH_HERMES_COMMAND` | 从 `PATH` 自动发现 | 本机 Hermes 可执行文件 |
| `WRITING_WORKBENCH_HERMES_PROFILE` | 空 | 可选的隔离 Hermes profile；留空时使用 Hermes 当前默认 profile |
| `WRITING_WORKBENCH_AI_TIMEOUT` | `120` | 本机 agent 超时秒数 |
| `WRITING_WORKBENCH_ANALYSIS_CONTEXT_CHARS` | `100000` | 单次全书分析最多读取的已保存书稿字符数 |

应用配置统一使用 `WRITING_WORKBENCH_` 前缀。浏览器不能更改 Hermes 命令或 profile。

占位配置见 [.env.example](.env.example)。请导出这些变量或交给进程管理器设置；应用本身不会自动加载 `.env`。不要提交填写后的 `.env`。

## 本机 AI provider

`hermes` 会以子进程调用指定的本机 Hermes profile；`mock` 用于确定性本地演示，不会联网；`off` 禁用 AI 请求。Hermes 调用只开放非修改型工具集、忽略工作区规则，并要求把书稿视作不可信内容而不是指令。

执行 AI 操作时，只会把所需文本交给本机 Hermes 进程：改写使用选中文本与附近上下文，问答使用当前章节与最近对话，全书分析使用经过长度限制的全部已保存章节。仅打开、编辑或保存章节不会调用 Hermes；全书分析也不会包含编辑器中的未保存改动。

## 安全与隐私模型

写书工具台面向“可信设备上的单一可信用户”设计：

- 开发服务器默认绑定回环地址，不包含多用户认证。
- 只接受书稿根目录内的简单 `.md`、`.txt` 文件名。
- 在解析 JSON 前限制请求大小。
- 保存必须携带上次读取时得到的 SHA-256 版本标识；写入使用临时文件、原子替换，并备份旧版本。
- 书稿文本保留在本应用与本机 Hermes 的边界内，只有用户主动执行 AI 操作时才会调用本地 agent。
- 当前来源的浏览器 localStorage 会保留最多 60 条操作记录和 30 条问答消息。操作记录可能包含章节标题以及较短的改写或问答摘要；每条问答消息最多保存 4,000 个字符。这些数据会一直保留到用户清除或浏览器将其回收。历史面板中的“清空”会同时清空两类记录，但不会删除稿件；也可通过浏览器的网站数据设置清除。未保存的编辑器缓冲区不会作为书稿备份存入其中。

不要把开发服务器直接暴露到公网或不可信网络。共享部署至少还需认证、TLS、CSRF 防护、生产级 WSGI server、限流和明确的授权模型。详见 [SECURITY.md](SECURITY.md) 与 [PRIVACY.md](PRIVACY.md)。

## 架构

项目刻意保持技术栈精简：

```text
浏览器（原生 HTML/CSS/JS）
        │ 回环 HTTP 上的 JSON
Flask 路由与结构化错误
        ├── 安全章节存储 ── 书稿文件与轮换备份
        └── provider 接口 ── 本机 Hermes / mock / off
```

章节存储层统一负责文件名验证、版本计算、备份轮换与原子写入。provider adapter 共用小型接口，使编辑流程不依赖任何 AI 服务。设计细节和信任边界见 [docs/architecture.md](docs/architecture.md)。

## API

JSON API 包括：

- `GET /api/health`
- `GET, POST /api/chapters`
- `GET, PUT, DELETE /api/chapters/<filename>`
- `POST /api/ai/rewrite`
- `POST /api/ai/ask`
- `POST /api/ai/analyze`

保存时需携带上次读取返回的版本标识。文件若已被其他客户端更改，服务端返回 `409 conflict` 和当前版本，客户端应明确选择重新加载或人工合并。请求与响应示例见 [docs/api.md](docs/api.md)。

## 路线图

- 对支持的浏览器进行键盘和屏幕阅读器可访问性审查。
- 增加用户可控的章节顺序与书稿元数据。
- 在界面中浏览并恢复备份。
- 导出到少量开放且有文档的格式。
- 增加带能力检测的可插拔本地推理 adapter。
- 增加英文和简体中文以外的社区翻译。

路线图只是提案，不代表已经完成或承诺交付。投入大型改动前，请先提交 feature request 讨论。

## 参与贡献

欢迎提交 bug、聚焦的功能改进、测试、文档和可访问性优化。请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)，遵守 [行为准则](CODE_OF_CONDUCT.md)，并避免在 issue、fixture、截图和日志中加入真实书稿或凭据。

安全问题请按 [SECURITY.md](SECURITY.md) 私下报告，不要创建公开 issue。

## 许可证

项目采用 Apache License 2.0，见 [LICENSE](LICENSE)。

Copyright 2026 Alan.
