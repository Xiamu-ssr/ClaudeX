# CCodeBox

Desktop GUI for [Claude Code](https://github.com/anthropics/claude-code) —— 界面参照 Codex 桌面客户端，后台完全由 Claude Code CLI 驱动。

![screenshot](docs/screenshot.png)

## 这是什么

CCodeBox 是一个 Electron 桌面应用。界面仿照 OpenAI Codex 桌面端，但不调用任何私有 API 或 SDK——它只是把 `claude` CLI 已经暴露出来的能力（`stream-json` 协议、`--resume`、`--effort`、hooks、`.mcp.json` 等）包装成一层图形界面。**不修改 Claude Code CLI 本身的任何代码**，只是给它做一个更好看的壳。

打开一个会话＝后台 spawn 一个长驻的 `claude -p --input-format stream-json --output-format stream-json ...` 子进程，通过 stdin/stdout 双向通信；关闭会话即关闭 stdin，进程优雅退出。多轮对话、模型切换、历史回放、会话分叉——都是在这一层协议之上做的文件系统级/进程级操作。完整的设计动机和取舍见 [DESIGN.md](./DESIGN.md)。

## 功能

- **真实的多轮对话**：长驻子进程 + stream-json 双向通信，工具调用（Bash/Read/Write/Edit 等）实时展示为可展开的步骤列表，支持 thinking 旁白、错误态高亮
- **历史会话**：直接读取 `~/.claude/projects` 下的真实 `.jsonl` 记录，无需额外索引
- **项目/会话管理**：置顶、重命名、折叠、归档、移除、在 Finder 中显示、创建 git 工作树——软状态存在独立 sidecar 文件里，从不改动 Claude Code 自己的真实数据
- **会话分叉**：从任意历史会话的最新一轮分叉出一个新会话（基于"`--resume` 可以接受截断重写过的 `.jsonl`"这一验证过的事实）
- **模型/供应商配置**：内置 Anthropic 模型 + 自定义供应商（自定义 base URL/token），支持对话中途切换模型、设置推理强度（`--effort`）
- **右侧面板**：文件树浏览、Git diff 审查、真实终端（node-pty + xterm.js）、内嵌浏览器（`<webview>`）——四个 tab 背后全是真实数据/真实进程，没有占位
- **插件市场 / MCP**：读取 `claude plugin list --available --json` 和 `~/.claude.json` 里配置的 MCP 服务器
- **设置页**：钩子、权限、环境变量（脱敏展示）、Git 状态、用量统计——全部来自本机真实文件，没有编造的占位数据

每个设计决策背后的取舍理由（为什么包装 CLI 而不是用 Agent SDK、stream-json 到 UI 的映射规则、三层挂起恢复机制、node-pty 打包踩过的坑等）见 [DESIGN.md](./DESIGN.md)。

## 技术栈

Electron + electron-forge · Vite · React 19 + TypeScript · Tailwind CSS v4 · Zustand · node-pty/xterm.js（终端）· Playwright（测试）

## 环境要求

- macOS（目前只验证过 macOS 打包/运行；Windows/Linux 未测试）
- [Claude Code CLI](https://github.com/anthropics/claude-code) 已安装并登录（`claude auth status` 能返回已登录状态）
- Node.js —— **开发/构建请用 Node 22 LTS**，Node 24 下 `electron-forge` 会静默卡住不报错（细节见 DESIGN.md「打包踩坑记录」）

## 快速开始

```bash
nvm use 22.17.1   # 或任意 Node 22 LTS
npm install
npm run dev       # electron-forge start，带热重载
```

## 构建

```bash
nvm use 22.17.1
export HTTP_PROXY=http://127.0.0.1:7890 HTTPS_PROXY=http://127.0.0.1:7890   # electron-forge make 需要连 GitHub 做原生模块 rebuild
npm run build     # electron-forge make，产出 DMG
```

只打包不生成安装包：`npm run package`（产物在 `out/`，已 gitignore，纯磁盘占用）。

## 测试

```bash
npx playwright test
```

E2E 测试用 Playwright 的 `_electron` API 通过 CDP 直接驱动真实 Electron 窗口，不占用屏幕、不需要辅助功能权限；涉及发消息的测试会注入一个假的 `claude` 二进制（`tests/fixtures/fake-claude/fake-claude.mjs`）保证确定性，不消耗真实 API 额度。**改动 main/preload 代码后需要先跑一次构建**才能让 Playwright 测到新代码，细节和更省心的替代方案见 [DESIGN.md](./DESIGN.md#测试策略)。

## 已知局限

- 尚无应用图标（用的是 Electron 默认图标）
- 不支持多会话/多标签页同时打开（一次只能有一个 activeSession）
- 归档和移除目前效果相同（都从列表里隐藏），没有单独的"查看已归档"入口——只能手动清理 sidecar 文件找回
- 只在 macOS 上验证过

## 架构一览

```
Renderer (React + Zustand)
   │  window.electronAPI.claude.*（contextBridge）
Preload
   │  ipcMain.handle / webContents.send
Main process（SessionManager + IPC 路由 + historyReader + eventTranslator）
   │  spawn('claude', [...])
claude -p --input-format stream-json --output-format stream-json --include-partial-messages ...
```

更完整的架构图、每一层的职责边界、历史记录格式、node-pty 打包三个坑的完整根因分析，见 [DESIGN.md](./DESIGN.md)。
