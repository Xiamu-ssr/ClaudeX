# CCodeBox

Claude Code 的桌面 GUI 客户端，以 Claude Code CLI 为后台引擎，视觉上参照 Codex 桌面端。

## 架构（已实现）

```
┌──────────────────────────────────────────┐
│  Renderer (React)                         │
│  useSessionStore (zustand) — Session 状态  │
│  ChatView/ChatMessage/ToolUseBlock 渲染    │
└──────────────────┬─────────────────────────┘
                    │ window.electronAPI.claude.* (contextBridge)
┌──────────────────▼─────────────────────────┐
│  preload/index.ts — 类型化 IPC 封装          │
└──────────────────┬─────────────────────────┘
                    │ ipcMain.handle / webContents.send
┌──────────────────▼─────────────────────────┐
│  main/index.ts — SessionManager + IPC 路由  │
│  main/claude/ClaudeSession.ts — 单会话子进程 │
│  main/claude/SessionManager.ts — 会话注册表  │
│  main/history/historyReader.ts — 读取历史    │
│  shared/eventTranslator.ts — 纯函数翻译层    │
└──────────────────┬─────────────────────────┘
                    │ spawn('claude', [...])
┌──────────────────▼─────────────────────────┐
│  claude -p --verbose --input-format         │
│  stream-json --output-format stream-json    │
│  --include-partial-messages                 │
│  --replay-user-messages --session-id <uuid> │
│  [--resume <id>]                            │
└──────────────────────────────────────────────┘
```

每个打开的会话 = 一个长驻 claude 子进程。用户追问通过 stdin 写入：
```json
{"type": "user", "message": {"role": "user", "content": "追问内容"}}
```
关闭 stdin 即优雅退出。恢复历史会话用 `--resume <session-id>` 重新 spawn。

`shared/eventTranslator.ts` 是零 I/O 纯函数模块：main 进程收到 stdout 行后调用它得到 `Step`/`AssistantTurn` 增量，再通过 IPC 推给渲染进程——渲染进程永远不直接处理原始 Anthropic 事件格式。同一套翻译逻辑也被 `historyReader.ts` 复用于重放磁盘上的历史 JSONL。

## 核心设计决策

### 为什么包装 CLI 而非 Agent SDK

- `stream-json` 已暴露所有事件（文本、工具调用、thinking、hook）
- 会话持久化内建，`--resume` 直接恢复
- 零额外鉴权，复用用户已登录的 Claude Code
- CLI 更新自动跟进，无需维护 SDK 版本

### 多轮对话实现（已验证）

用 `--input-format stream-json` 保持长驻进程，实测确认多轮上下文在同一进程内正确保持：

1. 新会话 → spawn claude 进程（`--session-id <生成的 uuid>`）
2. 用户发送消息 → 往 stdin 写入 user 消息行，本地立即插入占位的 `AssistantTurn(isProcessing:true)`
3. stdout 按行解析（`NdjsonLineSplitter` 处理跨 chunk 边界的行缓冲），喂给 `eventTranslator.applyLine`
4. 每条增量（步骤追加/更新、response 更新）通过 IPC 推给渲染进程
5. `result` 事件到达 → 该轮结束，`isProcessing:false`，步骤列表自动折叠为"已处理 Ns"
6. 用户继续追问 → 复用同一进程继续写 stdin
7. 关闭会话/应用退出 → 关闭 stdin，进程优雅退出（`app.on('before-quit')` 触发）
8. 恢复历史会话 → spawn 新进程 + `--resume <session-id>`

### stream-json 事件到 UI 类型的映射规则

- `assistant` 的 `text` content block → 追加为 `ThinkingStep`（模型中途的自然语言旁白），同时更新 `turn.response`（所以流式过程中 response 始终有内容，不会空白）；`result` 到达时用其 `result` 字段做最终校正
- `assistant` 的 `thinking` content block（真正的 API 扩展思考块）→ **丢弃，不展示**，不是 UI 里 ThinkingStep 的含义
- `assistant` 的 `tool_use` block → 新建 `ToolUseStep{pending:true}`；对应的 `tool_result`（`user` 消息里携带）到达后按 `tool_use_id` 匹配回填 `pending:false`/`isError`/`details`
- 一次工具调用会拆成多条独立的 `assistant` stdout 行（不是一条里塞多个 content block），翻译层按累加而非替换处理

### 错误与挂起恢复

真实使用中出现过"发消息后一直显示'...'，永远等不到回复"的问题。排查后确认是两个真实 bug，而非玄学：

1. **`result` 行的 `is_error` 字段之前被完全忽略**——一次格式良好但业务失败的回复（例如 Haiku 模型配 `CLAUDE_CODE_EFFORT_LEVEL=max` 这种不兼容组合，CLI 会正常吐出 `is_error:true` 的 `result` 行，`result` 文本类似"API Error: 400 This model does not support the effort parameter."）会被当成普通成功回复原样渲染，用户无法分辨是报错还是正常回答。现在 `is_error` 会一路透传（`eventTranslator.ts` → `ClaudeSession.ts` → IPC → `sessionStore.ts`），`ChatMessage.tsx` 对 `turn.isError` 渲染出带警告图标的红色边框区块，视觉上明确区分。
2. **`process-error`/`process-exited` 事件之前被 `sessionStore.ts` 无条件丢弃**——子进程在还没吐出 `result` 行之前就异常退出或报错（真实崩溃、被杀等），会导致当轮 `isProcessing` 永远卡在 `true`，"..." 指示器永久转下去，没有任何恢复路径。现在这两个事件会解析当前是否有"预期中的停止"（`pendingStopSessionId`，标记用户主动点停止或 `changeModelMidConversation` 内部的停止+重启），预期内的优雅结束成普通态，非预期的则 resolve 成红色错误态——两种情况下 `isProcessing` 都会正确解除。
3. **90 秒看门狗**（`WATCHDOG_TIMEOUT_MS`，`sessionStore.ts`）作为兜底：只要一轮对话超过 90 秒没有任何新的 step/response 增量，无论原因是否已知，都会主动 resolve 成超时错误而不是无限挂起。每次收到有进展的事件都会重新武装计时器；`turn-completed` 到达则直接解除。

这套修复覆盖两个已确认的真实 bug + 一层不依赖具体根因的通用兜底——用户最初截图的具体挂起场景没能在测试里百分百复现出完全相同的触发路径，但上述三层修复共同保证"卡在'...'且没有任何反馈"这一具体症状不会再无声无息地发生。

### 历史记录

- 磁盘格式：`~/.claude/projects/<cwd 按 / 替换为 - 编码>/<session-uuid>.jsonl`，逐行 JSON，追加写入即按时间顺序
- 列项目时**不反解目录名**（有损：真实项目名可能本身带 `-`），而是读该目录下任一 session 文件里消息行自带的 `cwd` 字段；反过来，给定一个已知 `cwd` 去查该项目下的会话列表（`listSessionsInProject`）则是直接用 `cwd.replace(/\//g, '-')` 算出目录路径去读——这个方向不需要处理"目录名有损"的问题，因为 `cwd` 是调用方已经确定的，不是待发现的（写测试 fixture 时要注意：会话文件必须真的落在这个编码后的目录里，否则读不到）
- 回放历史会话时按文件顺序处理（不追踪 `parentUuid` 分支），对绝大多数非分支会话场景够用
- 会话标题取首条真实用户文本消息（跳过 `isMeta` 的内部行），无真实文本则显示"(空会话)"

### 项目/会话软状态（置顶 / 重命名 / 归档 / 移除 / 工作树）

置顶、自定义名称、归档、移除这几个"软状态"不写回 `~/.claude/projects` 下的真实 `.jsonl`（那是 Claude Code 自己的数据，永远只读），而是仿照 `modelProviders.ts` 已有的模式存成两个独立 sidecar JSON 文件（`app.getPath('userData')` 下）：

- `main/history/projectOverrides.ts` → `project-overrides.json`，形状 `{ [cwd]: { pinned?: boolean; customName?: string; removed?: boolean } }`
- `main/history/sessionOverrides.ts` → `session-overrides.json`，形状 `{ [sessionId]: { archived?: boolean; removed?: boolean } }`

`historyReader.ts` 的 `listProjectDirs`/`listSessionsInProject` 读取时合并这两个 sidecar：`removed:true` 的项目/会话从列表里整个过滤掉；`customName` 覆盖 `displayName`；`pinned` 项目排到列表最前（组内仍按最近活跃时间排序）。**"移除"只是隐藏，不删真实数据**——`.jsonl` 文件字节完全不受影响，理论上清掉 sidecar 里的记录就能"找回"。真正的文件系统删除是明显更高风险的不可逆操作，且本仓库目前没有任何二次确认弹窗的先例，这次没有做。

`archived` 和 `removed` 是两个独立的布尔位，但目前 UI 只各自对应一个"归档"/"移除"动作，两者效果在列表里目前是一样的（都被过滤掉），还没有"查看已归档"的单独入口——已知的范围缺口，见 TODO。Sidebar 项目菜单的"归档全部会话"没有引入新的批量 IPC，只是渲染进程对该项目下每个 session 循环调用同一个单会话 `archiveSession`。

`git.ts` 的 `createWorktree(cwd, branch)` 是这个文件里第一个"创建"而非"列出"worktree 的函数：跑 `git worktree add -b <branch> <sibling-path>`（目标路径固定是项目目录同级、加分支名后缀），冲突路径已存在或目标不是 git 仓库都优雅返回 `{ok:false, message}` 而不是抛异常。`showInFinder` 复用 `main/index.ts` 里 `openClaudeMd` 已有的 `shell.openPath` 同款模式，改调 `shell.showItemInFolder`，是本仓库第二处使用 `shell.*`。

重命名和创建工作树都需要一个文本输入，但 **Electron 不实现 `window.prompt()`**（调用会静默返回 `null`，不是报错也不是弹出真实系统对话框），所以两处都没有用原生 prompt，而是延续本仓库已有的"内联输入"惯例：重命名是行内 `<input>` 换掉项目名文本（Enter 提交/Escape 取消/失焦提交三条路径共享同一个带幂等保护的 `commitRename`，避免 Enter 触发的提交和随后可能的 blur 事件重复提交两次）；创建工作树是 `ProjectContextMenu` 内部切换到一个子状态（`mode: 'menu' | 'worktree'`），复用同一个下拉面板展示分支名输入框，不引入新的 modal 概念。

"归档"/"移除"当前都不会检查、也不会主动停止对应会话是否有正在运行的子进程——如果移除的正好是当前打开的活跃会话，底层子进程不会被 stop，这和"切换会话（新建/打开历史）不会 stop 前一个活跃子进程"是同一类已知、明确排除在本轮范围外的孤儿进程问题，留待之后统一处理。`sessionStore.ts` 的 `loadProjectList` 会在刷新后的项目列表不再包含当前 `selectedProjectCwd` 时自动回退到列表第一项，避免移除当前选中项目后残留一个悬空的选中态。

### 会话分叉

已实测确认可行性：`--resume` 接受一个手工截断重写过的 `.jsonl` 作为合法的"某个时间点的会话分叉"（用匹配的 `cache_read_input_tokens` 验证过）。基于这个事实，分叉的实现完全不碰 Claude Code CLI 本身，只是在文件系统层面复制+改名一份 session 记录，再走现成的 `--resume` 路径打开它：

- `historyReader.ts` 的 `computeForkCutoffs(cwd, sessionId, projectsDir?)` 扫描目标 `.jsonl`，用**和历史回放逻辑同一个** `isTurnBoundaryLine` 谓词标出每个真实用户轮次的起始行，返回 `{turnIndex, lineCount}[]`——`lineCount` 是"保留到这一行（含）就能拿到这一轮完整内容（含后续的工具调用/助手回复），且不会溢出到下一轮"的截断点。用同一个谓词是为了让 UI 上看到的轮次序号和分叉截断逻辑内部用的轮次序号永远对齐，不会出现"点第 3 轮结果 fork 到第 4 轮"这种错位。
- `sessionForker.ts` 的 `forkSession(cwd, sourceSessionId, turnIndex, projectsDir?, forkRegistryPath?)`：读源文件，按 `computeForkCutoffs` 给出的 `lineCount` 截断，把保留下来的每一行的 `sessionId` 字段重写成新生成的 `randomUUID()`，写成一个新的 `<newSessionId>.jsonl`——**源文件字节不受任何影响**（同一份"真实数据只读"原则，参见上面项目/会话软状态一节）。个别无法解析的行（理论上不应该出现在真实数据里）原样保留而不是丢弃，避免破坏行序导致 `--resume` 读到结构不完整的文件。
- `forkRegistry.ts`：新的 sidecar 文件（`fork-registry.json`），形状 `{ [newSessionId]: { forkedFromSessionId; forkedAtTurnIndex; cwd; createdAt } }`，记录分叉血缘。本轮只写不读——UI 上没有展示"这是从哪个会话分叉来的"这类溯源信息，纯粹是为将来可能的功能预留的记录点，不是当前范围的一部分。
- IPC 层只暴露"从最新一轮分叉"：`forkSession` handler 内部调 `computeForkCutoffs` 取最后一个 cutoff，不接受调用方指定任意历史轮次。UI 目前也只在 ChatView "⋯" 菜单提供一个"分叉新对话"入口，没有做逐轮次的分叉选择器（消息级悬浮分叉图标需要先做消息级操作栏，工作量明显更大，本轮不做）。

**"仅支持历史会话分叉"的落地方式**：计划原文强调分叉不应对"正在运行的活跃会话"生效，理由是 `ClaudeSession.stop()` 的注释提到的 flush 时机问题。但重新核对 `stop()` 那条注释后发现，它描述的风险场景严格限定在"用 `--resume` 恢复**同一个** sessionId"（例如 `changeModelMidConversation` 的中途换模型：必须先 stop 旧进程等它把 `.jsonl` 完全 flush 完，再用同一个 sessionId 重新 spawn，否则新进程可能读到该 sessionId 自己文件的残缺状态）。分叉不属于这个场景——它总是生成一个全新的 sessionId，永远不会以任何方式重新打开或恢复源会话的 sessionId，源会话的进程（如果还活着）完全不受影响，也不需要被 stop。真正需要防范的风险窄得多：**不要在源会话某一轮还没跑完时就去读它的 `.jsonl`**（可能读到那一轮尚未写完的中间状态）。这个风险用 `isProcessing === false` 这一个已有信号就能完整覆盖，不需要"是否为历史会话"这种在当前架构下其实无法定义的区分（每个在 ChatView 里能看到的会话，不管是新建的还是从历史打开的，此刻都必然有一个真实在跑的子进程）。所以最终实现是：ChatView "⋯" 菜单的"分叉新对话"项只在 `!isProcessing && session.messages.length > 0` 时可点击，不要求用户先手动停止会话或从历史列表重新打开它——这样更贴近"一轮跑完随时可以分叉"的直觉，也没有放松计划原本想防的那个真实风险。

**`sessionStore.ts` 的 `forkSession` 实现**：没有复用 `changeModelMidConversation` 的 stop+respawn 套路（那是为"恢复同一个 sessionId"设计的，上面已经说明分叉不是这个场景），而是复用更简单的 `openHistoricalSession` 套路——调 IPC 拿到 `newSessionId` 后，刷新项目列表、直接把它当一个历史会话打开。分叉出来的新会话此后就是一个完全普通的会话，可以被再次分叉、归档、移除，没有任何特殊状态。

**`ChatView.tsx` 加了 `key={activeSession.id}`（在 `App.tsx` 里）**：分叉按钮有一个短暂的本地 `forking` 状态（IPC 往返期间禁用按钮、显示"分叉中..."）。因为 `ChatView` 组件在切换会话时不会卸载重建（只是 `session` prop 变了），如果没有这个 `key`，理论上用户可以在一次分叉的 IPC 往返窗口内切到另一个会话，那个残留的 `forking:true` 状态会错误地显示在新会话上。加 `key` 强制在会话切换时整个重挂载 `ChatView`，顺带也修掉了"⋯"菜单开合状态跨会话残留这个更早就存在、但从未被注意到的小问题。

已知的范围缺口：分叉出来的新会话标题取自源会话的第一条用户消息（`deriveSessionTitle` 读的是同一份内容），所以在 Sidebar 列表里分叉体和源会话目前会显示**完全相同的标题**，只能靠最近活跃时间区分——`forkRegistry.ts` 里其实已经记了血缘关系，但本轮没有在任何 UI 里展示它，属于已知但不影响功能正确性的表面缺口。

### 模型/供应商配置系统

UI 里的"供应商"= 一个命名分组的模型列表 + 一份 `Record<string,string>` 环境变量覆盖，spawn `claude` 子进程时注入（`ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN` 等）。内置的 Anthropic 供应商只读（Sonnet 5 / Opus 4.8 / Haiku 4.5 / Fable 5），用户可以增删自定义供应商，存在 `app.getPath('userData')/model-providers.json` 里，不进 git 仓库。

对话中途切换模型：Claude Code 的 `/model` 斜杠命令在 headless stream-json 模式下不生效，所以中途换模型的做法是**停止当前子进程 + 用 `--resume <sessionId> --model <newModel>` 重新 spawn**，session 文件延续，UI 侧感知不到进程重启。新建对话（尚无 sessionId）则直接把 `model` 传给首次 spawn。

推理强度（`--effort low|medium|high|xhigh|max`，真实 CLI 参数）只接入**新建对话**这一条路径，不接入"中途切换模型"和"恢复历史会话"——刻意的范围收窄，避免语义混乱。store 里 `effortLevel` 的类型是 `EffortLevel | null`，`null` 表示**完全不传 `--effort` 参数**，把决定权交还给 CLI 自身的默认值（可能来自用户真实设置的 `CLAUDE_CODE_EFFORT_LEVEL` 环境变量）——而不是 CCodeBox 用一个编造的默认值静默覆盖它。UI 上对应"CLI 默认"这个选项。

### 设置页真实数据来源（`main/system/*.ts`）

- **版本/诊断**（`version.ts`）：`claude --version`、`claude doctor` 直接 `execFile` 真实二进制（复用 `resolveClaudeBinary()`）。`doctor` 会向目标 cwd 的 `.mcp.json` 里配置的 stdio MCP 服务器发真实探活请求，所以**只在用户点击时运行，绝不自动触发**，且必须传入调用方指定的 cwd（不能悄悄用别的目录）。
- **钩子 + 权限**（`settingsReader.ts`）：合并 `~/.claude/settings.json`（用户）→ `<cwd>/.claude/settings.json`（项目）→ `<cwd>/.claude/settings.local.json`（项目本地）三个文件，顺序即 Claude Code 自己的作用域优先级。`permissions` 的 `allow`/`ask`/`deny` 是**三个文件取并集**（不是后者覆盖前者），只有 `defaultMode` 是"最具体的文件生效"。`hooks` 按事件名动态读取、动态展示——**不硬编码一份"所有 hook 事件名"的枚举**，因为这份列表会随 Claude Code 版本增长，硬编码迟早过期；没配置就诚实地显示"当前没有配置任何钩子"，而不是显示一份编的 PreToolUse/PostToolUse 占位行。同理没有做"编辑 settings.json"按钮：钩子本身可能来自三个不同文件的合并结果，没有单一一个"那个文件"可以打开编辑，做一个模糊的按钮不如不做。
- **本机用量统计**（`usageStats.ts`）：扫一遍 `~/.claude/projects/**/*.jsonl`，单趟扫描里同时统计 token 总量（`assistant` 行的 `usage.*`）、活跃天数（用于连续天数计算）、以及每个文件的真实 `cwd`（`cwd` 字段可能出现在文件任意一行，不假设在第一行）——避免和 `historyReader.ts` 的 8KB 探测逻辑重复 I/O。技能使用次数读 `~/.claude.json` 的 `skillUsage` 字段。**没有本地可读的额度/账单数据**（Claude Code CLI 不提供），所以"使用情况和计费"页刻意不做假的配额进度条，改成按项目的 token 用量明细表。
- **Git 状态/工作树**（`git.ts`）：`execFile('git', [...])` 真实 shell 出。非 git 仓库诚实返回 `isRepo:false`（不是报错也不是伪装成"0 个文件变更"）；没配置上游分支时 `ahead`/`behind` 是 `undefined`（不是编造成 `0`）。
- **环境变量**（`settingsReader.ts` 的 `readGlobalEnvConfig`）：只读 `~/.claude/settings.json` 的 `env` 字段，值经过脱敏（`'•'.repeat(min(len,8)) + ' (N 字符)'`，只显示字符数不显示明文）才跨 IPC 传到渲染进程——这台机器的 repo 会传到公共 GitHub，任何形似密钥的值都不能以明文形式出现在渲染进程状态、测试产物或截图里。

以上贯穿的设计原则：**宁可诚实地显示"空"/"未配置"，也不用编造的占位数字**；**不硬编码假定"穷尽"的枚举**（如 hook 事件名），实际有什么就显示什么，避免未来随 Claude Code 版本更新而过期失真。

### 插件市场 / MCP 服务器 真实数据来源

- 连接器 + 官方技能：`claude plugin list --available --json`（本机 255 条），按 `source` 字段区分：`./plugins/`(36，官方技能) / `./external_plugins/`(15，MCP 连接器包装) / 其余第三方 git 源（204，`source` 是对象不是字符串，未在本机 vendor，不纳入目录展示）。
- 已配置的 MCP 服务器：直接读 `~/.claude.json` 的 `mcpServers` 字段，只读 `{name, type}` 两个字段——**服务器配置里可能直接嵌密钥**（如 URL 里带 `apiKey=`，或 stdio 服务器的 env），所以刻意不把完整 config 传过 IPC 到渲染进程，也不 shell 出 `claude mcp list`（它会做真实健康检查还会把带密钥的原始 URL 打到纯文本输出里）。状态显示"已配置"而非"已连接"，因为没有做存活检查，避免误导。
- 关键发现：本机唯一配置的 MCP 服务器 tavily 并不在 15 个官方连接器目录里（它是直接手工配置的远程 HTTP MCP，不是走 marketplace 装的）。所以插件目录数据模型拆成两半：`connectors`（15 个目录项，带 `installed` 标记，跟 `~/.claude.json` 的名字比对）+ `customMcpServers`（`~/.claude.json` 里存在但目录里找不到同名连接器的，如 tavily）——这样比"只查 installed 布尔值"更准确地反映真实状态。

### 右侧面板：Files / Review / Terminal / Browser

对话页右侧可切换面板，视觉上对应 Codex 桌面端的同类分栏，四个 tab 后面都是真实数据/真实进程，没有一个是占位：

- **Files**（`FilesTreePanel.tsx` + `main/system/fileTree.ts`）：真正的文件树浏览器，逐层懒加载（点开哪层才用 `listDirEntries` 查哪层，不做一次性整树递归扫描），点击文件走 `getFilePreview` 只读展示内容（二进制/超大/不存在都各自诚实提示，不做语法高亮，不做写回）。目录遍历用一个硬编码 denylist（`node_modules`/`.git`/`dist`/`build`/`.vite`/`out`）过滤，不是真正的 `.gitignore` 解析。
- **Review**（`ReviewPanel.tsx` + `main/system/git.ts` 的 `getGitDiff`，`FilesPanel.tsx` 原名）：对当前会话 cwd 跑 `git diff HEAD --` 分类出 `modified`/`added`/`deleted`/`untracked` 四种状态（porcelain 状态码解析规则见下），点击某个文件展示真实 diff 内容，头部聚合显示"已编辑 N 个文件 · +X -Y"（纯前端对已拿到的 diff 文本按行计数，零新增后端调用）；未跟踪文件没有 `git diff` 可跑，改为直接读文件内容格式化成全 `+` 行（二进制文件用空字节探测，命中则显示"(二进制文件，未预览)"占位而不是原样吐字节）。仅当 `getGitStatus(cwd).isRepo === true` 时才在 tab 栏出现（隐藏而非置灰），非仓库目录时自动把当前 tab 切回 Files，避免残留一个按钮已消失但内容还在的悬空态。不做撤销/丢弃变更——那是真正不可逆的 git 操作，本仓库没有任何二次确认弹窗先例，本轮只做只读展示。
- **Terminal**（`TerminalPanel.tsx` + `node-pty`）：真实 spawn 一个登录 shell（不是模拟终端），用 `@xterm/xterm` 渲染。
- **Browser**（`BrowserPanel.tsx` + `<webview>`）：地址栏 + 内嵌 `<webview>`，真实前进/后退/刷新（监听 `did-navigate`/`did-navigate-in-page` 同步按钮可用态和地址栏），URL 规范化（裸域名自动补 `https://`，带 scheme 的 URL 原样加载）。

**生命周期决策：只有 Terminal 做懒挂载 + 之后常驻（sticky mount），其余三个 tab 都是首次渲染即无条件挂载、只用 CSS 隐藏切换**——这里更正一处过去的不准确表述：早先这里写的是"三个 tab 都懒挂载常驻"，但实际代码里 Files/Browser（现在是 Files/Review/Browser 三个）从来都不是懒挂载的，只有 Terminal 真正持有一个需要保活的外部资源（一个 shell 进程）。如果每次切走再切回来都重新渲染 Terminal 组件，naive 实现会重新 spawn 一个 shell，之前的工作目录/环境变量/运行中的命令全部丢失——不符合真实终端"切走再切回来还是同一个会话"的直觉预期。Files/Review 背后只是文件树查询/git diff 查询，没有这个保活需求，沿用更简单的即时挂载方式即可。这个懒挂载+常驻的改动本身是在没有明确被要求的情况下做出的判断，已有 Playwright 回归测试（`right-panel.spec.ts` 的 "switching tabs and back keeps the same shell session alive"）覆盖。

### node-pty：一个原生模块在 Electron 打包全流程里踩的三个坑

`node-pty` 是本项目唯一的原生（编译型）依赖，也是这套 Electron + Vite + electron-forge 组合里最容易出问题的一环。三个坑各自独立，分别发生在开发、构建、打包三个不同阶段：

1. **可执行位丢失**（开发阶段）：`node-pty` 的 `prebuilds/*/spawn-helper` 需要保留可执行权限，某些安装/同步路径会丢失这个权限位。`package.json` 的 `postinstall` 脚本在每次 `npm install` 后显式 `chmod +x` 所有 prebuild 目录下的 `spawn-helper`，不依赖它在源头就有正确权限。
2. **Vite 打包路径解析**（构建阶段）：`node-pty` 在 `require` 时用相对自身 `lib/` 目录的路径去找预编译的 `.node` 二进制。如果让 Vite 把它的 JS 一起打包进 `main.js`，运行时相对路径基准会变成 `.vite/build/`，导致找不到二进制。`vite.main.config.ts` 用 `rollupOptions.external: ['node-pty']` 把它排除在打包之外，保留成运行时真实 `require()`。
3. **打包阶段整个 `node_modules` 被裁掉**（发现于本轮，最隐蔽）：`@electron-forge/plugin-vite` 默认会把 `packagerConfig.ignore` 设成"只保留 `.vite/*`"，前提假设是"Vite 已经把所有依赖打包进 JS 了"——这个假设恰好被第 2 点的 `external` 配置打破。第一次尝试修复时写了一个自定义 `ignore` 函数，只放行 `/node_modules/node-pty` 前缀的路径，构建后发现 asar 里依然一个 node_modules 文件都没有。根因：`@electron/packager` 底层用 `fs-extra` 的 `copy({filter})` 做文件拷贝，这个 `filter` 是**目录级短路**的——对一个目录调用 filter 得到 `false` 时，`fs-extra` 直接跳过整个子树，根本不会再递归进去挨个测试里面的文件（`fs-extra/lib/copy/copy.js` 的 `handleFilter` 直接在 `include` 为假时 `return cb()`，压根不会调用 `getStats`/`copyDir`)。裸目录 `/node_modules` 本身不匹配"以 `/node_modules/node-pty` 开头"这个前缀，所以被判定为忽略，导致其下所有内容（包括 node-pty）从未被访问过。**修复**：改为放行整个 `/node_modules`，把"哪些包该留、哪些该剪"完全交给 `packagerConfig.prune`（默认开启）——它用 `galactus` 库真实解析 `package.json` 依赖图，只保留生产依赖（`node-pty` 在内），正确剔除 `devDependencies`（`vite`/`typescript`/`electron` 本体等）。代价是被保留的生产依赖集合比"只要 node-pty"更宽（`react`/`zustand`/`lucide-react`/`@xterm/*` 等也会连同它们自己的生产依赖一起被拷进去，即便这些已经被 Vite 打包进 JS、node_modules 里的副本完全不会被用到），使打包体积增大（约 363MB app / 56MB asar），但这是自愿接受的、可验证正确的取舍，好过继续跟"精确只留 node-pty"的过滤器逻辑较劲。三层修复用真实打包产物验证：`npx asar list` 确认 node-pty 的 `.node` 二进制正确落在 `app.asar.unpacked`（原生二进制不能从 asar 内 `dlopen`），且对**实际打包出的 `.app`**（不是开发模式）跑了一次端到端 Playwright 验证（真实 spawn shell、真实执行命令），而不是只验证文件存在。

## 技术栈

| 层 | 选型 | 理由 |
|----|------|------|
| 桌面框架 | Electron + electron-forge | Codex 同款，成熟稳定，原生 DMG 打包 |
| 构建 | Vite | 快速 HMR，Codex 同款 |
| 前端 | React + TypeScript | 生态最大，组件库丰富 |
| 样式 | Tailwind CSS | 快速原型，保持轻量 |
| 状态 | Zustand | 轻量，订阅 IPC 事件驱动 UI |
| 后台通信 | Node child_process spawn | 直接 spawn Claude Code CLI |
| 测试 | Playwright (`_electron` API) | 通过 CDP 驱动真实 Electron app，不占用屏幕、不需要系统权限 |

## 项目结构

```
CCodeBox/
├── src/
│   ├── main/
│   │   ├── index.ts                # 主进程入口，窗口 + IPC 路由 + SessionManager 生命周期
│   │   ├── claude/
│   │   │   ├── ClaudeSession.ts     # 单会话 child_process 封装
│   │   │   └── SessionManager.ts    # Map<sessionId, ClaudeSession> 注册表
│   │   ├── history/
│   │   │   ├── historyReader.ts     # 扫 ~/.claude/projects，列项目/会话/回放历史；合并下面两个 sidecar
│   │   │   ├── projectOverrides.ts  # sidecar：项目 pinned/customName/removed（不改真实 .jsonl）
│   │   │   └── sessionOverrides.ts  # sidecar：会话 archived/removed（不改真实 .jsonl）
│   │   └── system/                 # 设置页背后的真实数据读取，零 mock
│   │       ├── version.ts           # claude --version / claude doctor（仅点击时运行）
│   │       ├── settingsReader.ts    # 合并 hooks/permissions（3 个 settings 文件）+ 脱敏 env
│   │       ├── usageStats.ts        # 扫 session jsonl 算 token/连续天数/按项目分布
│   │       ├── git.ts               # git status / worktree list --porcelain / getGitDiff（Review 面板）/ createWorktree
│   │       └── fileTree.ts          # listDirEntries / getFilePreview（Files 面板，逐层懒加载 + 路径穿越防护）
│   ├── preload/index.ts            # contextBridge 暴露 window.electronAPI.claude.*
│   ├── shared/                     # 主进程和渲染进程共用
│   │   ├── chat.ts                  # Step/AssistantTurn/Session 等类型
│   │   ├── ipc.ts                   # IPC channel 常量 + 请求/响应类型
│   │   ├── eventTranslator.ts       # 纯函数：stream-json 行 → UI 增量
│   │   └── ndjson.ts                # NDJSON 按行缓冲（跨 chunk 边界）
│   └── renderer/
│       ├── App.tsx                  # 视图路由 (home/chat/plugins/settings)
│       ├── electron.d.ts            # window.electronAPI 类型声明
│       ├── store/sessionStore.ts    # zustand，订阅 IPC 事件驱动会话状态
│       ├── types/chat.ts            # 从 shared/chat.ts 重新导出（历史兼容）
│       └── components/
│           ├── Sidebar.tsx           # 真实项目/会话列表 + 用户菜单；每项目悬浮菜单(置顶/重命名/在 Finder 中显示/创建工作树/归档全部/移除) + 折叠展开
│           ├── ProjectContextMenu.tsx # Sidebar 项目悬浮菜单面板(含创建工作树的行内分支名输入子状态)
│           ├── MainContent.tsx       # 首页
│           ├── ChatView.tsx          # 对话页容器；"⋯" 菜单支持归档/移除当前会话
│           ├── ChatMessage.tsx       # 消息渲染(用户气泡/assistant 折叠块)
│           ├── ToolUseBlock.tsx      # 工具调用摘要(可展开，含 pending/error 状态)
│           ├── FileCard.tsx / InputBar.tsx / IntegrationCards.tsx
│           ├── PluginsView.tsx       # 插件市场(连接器/技能，读取真实 plugin catalog + ~/.claude.json)
│           ├── ModelSettingsModal.tsx # 模型供应商 CRUD 弹窗
│           ├── ModelEffortPicker.tsx # 级联 模型→推理强度→供应商 选择器
│           ├── SettingsView.tsx      # 设置页：常规/个人资料/配置/MCP/钩子/使用情况/Git/工作树/环境均为真实数据；
│           │                         # 外观/键盘快捷键/连接/已归档对话仍是"即将推出"占位（Codex 专属概念或超出本轮范围）
│           ├── RightPanel.tsx        # Files/Review/Terminal/Browser 四 tab 容器，仅 Terminal 懒挂载+之后常驻(sticky)
│           ├── FilesTreePanel.tsx    # 真实文件树浏览器，逐层懒加载 + 只读预览
│           ├── ReviewPanel.tsx       # 真实 git diff 列表 + 内容预览（仅 Git 仓库时出现）
│           ├── TerminalPanel.tsx     # node-pty 真实 shell + @xterm/xterm 渲染
│           ├── BrowserPanel.tsx      # 地址栏 + <webview>，真实前进/后退/刷新 + URL 规范化
│           └── RichText.tsx
├── tests/
│   ├── app.spec.ts                  # Playwright E2E，用 fake-claude 二进制保证确定性
│   ├── eventTranslator.spec.ts      # 纯函数单测，用真实抓包 fixture
│   ├── historyReader.spec.ts        # 用临时目录 fixture，不依赖真实 ~/.claude
│   ├── git.spec.ts                  # 纯函数单测：真实临时 git 仓库 + parseWorktreePorcelain + getGitDiff
│   ├── usageStats.spec.ts           # 纯函数单测：临时 session fixture + 连续天数边界用例
│   ├── right-panel.spec.ts          # Files/Review/Terminal/Browser 四 tab 的 E2E（真实 git repo/真实 shell）
│   ├── sidebar.spec.ts              # 项目菜单(置顶/重命名/移除) + ChatView 会话菜单(移除)的 E2E
│   └── fixtures/
│       ├── stream-json/*.jsonl       # 真实抓包的协议样本
│       ├── browser-panel-test.html   # Browser tab 测试用的本地 file:// 页面
│       └── fake-claude/fake-claude.mjs  # 模拟 stream-json + doctor + --version 的假 CLI，供 E2E 测试用
├── DESIGN.md
├── package.json / tsconfig.json / forge.config.ts / playwright.config.ts
└── vite.{main,preload,renderer}.config.ts
```

## 测试策略

- **`eventTranslator`/`historyReader`/`git`/`usageStats` 单测**：喂真实抓包/构造的 fixture 数据，零 Electron 依赖，跑得快、确定性强。故意用逐字节切片测试覆盖"跨 chunk 边界的行缓冲"这个最容易踩的坑。`git.spec.ts` 直接在临时目录里跑真实 `git init`/`git worktree add` 命令再断言解析结果（而不是 mock `child_process`），因为这些操作本地又快又零副作用；`isRepo:true` 分支之所以选择这条路线而不是 Playwright E2E，是因为 CCodeBox 自己这台机器上并不是 git 仓库（`git rev-parse --is-inside-work-tree` 会失败），要在 E2E 里覆盖"是仓库"这个分支得额外搭一个"看起来像真实项目"的临时 git 仓库 fixture，复杂度不划算。`usageStats.spec.ts` 把 `computeStreakDays`/`localDateKey` 单独导出做纯函数测试，传入固定的 `now: Date` 覆盖"今天/昨天有无活动""断档"等边界情况，不依赖真实系统时钟（避免午夜时间片的 flaky）。
- **E2E (`tests/app.spec.ts`)**：Playwright 的 `_electron` API 通过 Chrome DevTools Protocol 直接驱动真实 Electron app——不需要屏幕录制/辅助功能权限，不占用物理屏幕，能真正点击按钮、输入文字、断言 DOM 状态。发送消息类测试通过 `CCODEBOX_CLAUDE_BIN` 环境变量注入 `tests/fixtures/fake-claude/fake-claude.mjs`（模拟 stream-json 协议、`doctor`、`--version` 的假 CLI，前二者带人为延时以便断言"运行中"这类过渡态），保证确定性、不消耗真实 API 额度、不受网络影响。真实 CLI 只做开发时的手动抽查，不进自动化套件。设置页里那些直接读本机真实文件（`~/.claude/projects` 用量统计、`~/.claude.json` 技能使用、`~/.claude/settings.json` 钩子/权限/环境变量）的分区，E2E 测试断言的是"结构性存在"（区块标题、说明文案、非卡死在加载态）而非具体数值——这些数值真实且会随这台机器的实际使用而变化，跟已有的"MCP 服务器/插件目录读真实数据"测试是同一种取舍。
- **已知的测试环境坑**：`_electron.launch({args:['.']})` 读取的是 `.vite/build/main.js`（上一次构建产物），main/preload 代码改动后必须先跑一次 `electron-forge start` 才能让 Playwright 测到新代码；且必须让这个 dev server **持续在后台跑着**（不能跑几秒就杀掉），否则 main.js 里编译进的 Vite dev server URL 会指向一个已经死掉的地址，导致后续启动的 Electron 窗口加载失败（`chrome-error://chromewebdata/`）。
- **`app.close()` 有时会挂起**：观察到的现象是——只要该测试会话内曾经 spawn 过 claude 子进程（无论真实还是 fake），Electron 主进程本身能正常退出（`before-quit`/`will-quit`/`process exit` 全部按预期触发，exit code 0），但 Playwright 的 `.close()` promise 依然不 resolve，怀疑是 CDP/调试协议的收尾竞态，不是本项目代码的 bug。`afterEach` 里用"限时 race + 强制 kill"兜底，避免拖垮整个测试运行。
- **测试必须用独立的 `--user-data-dir`**：`_electron.launch({args: ['.', `--user-data-dir=${tmpDir}`]})` 能完全隔离 `app.getPath('userData')`（新建/删除 model-provider 之类的测试不会污染这台机器上的真实 CCodeBox 配置）。注意 macOS 上 `/var` 是 `/private/var` 的符号链接，校验落地路径时要用 `fs.realpathSync` 才能对得上。
- **Playwright 穿不进 `<webview>` 的 guest 内容**：`page.frames()` 不会列出 webview 的 guest frame，`.contentFrame()` 明确要求 `<iframe>` 而拒绝 webview。所以 `right-panel.spec.ts` 里 Browser tab 的测试断言的是 `<webview>` 元素自己的 `src` 属性（CCodeBox 自己的 URL 规范化逻辑），而不是 guest 页面渲染出的内容（那是 Chromium 自己的职责，不需要我们测）。
- **`CCODEBOX_PROJECTS_DIR` 环境变量**：`historyReader.ts` 认 `cwd` 字段不认目录名（见上文"历史记录"一节），这意味着测试 fixture 的目录名可以随便起（如 `fake-project`），只要 jsonl 内容里的 `cwd` 字段指向真实临时目录即可，不需要正确编码路径到目录名——`right-panel.spec.ts` 的 Files tab 测试组用这个环境变量注入一次性 fixture 项目，让右侧面板的 cwd 解析到一个真实临时 git 仓库。
- **`overflow-hidden` 会裁掉自己撑出去的下拉菜单，且短菜单可能掩盖这个 bug**：`InputBar.tsx` 的输入卡片外层曾经带 `overflow-hidden`（本意是配合 `rounded-2xl` 裁圆角），工具栏里的下拉菜单用 `absolute bottom-full` 从卡片底部往上弹出。当菜单比"工具栏顶部到卡片顶部"的可用空间更高时，超出部分会被 `overflow-hidden` 直接裁掉——不是盖住，是裁剪：`document.elementFromPoint`/`elementsFromPoint` 在那个位置根本找不到菜单项，直接穿透到卡片外面的元素。Playwright 的 `toBeVisible()` 断言不会发现这个问题（它只查 CSS 可见性属性，不做真正的裁剪感知命中测试），只有真实的 `.click()` 动作会在重试几十次后因"element intercepts pointer events"超时暴露出来。权限模式下拉菜单（只有 2 项）恰好矮到没触发这个坑，才掩盖了它——同样的下拉结构，菜单一旦变长（模型选择器有 4+ 个模型分组）就会踩上。**修复：去掉卡片外层的 `overflow-hidden`**（卡片内部没有任何子元素的背景色/内容需要靠它来裁圆角，去掉后视觉无变化）。排查这类"元素报告可见但点击超时"的问题时，`page.evaluate(() => document.elementsFromPoint(x, y))` 比反复读 Playwright 重试日志更快定位真相。

## TODO

- [x] 设计文档
- [x] 项目骨架搭建 (Electron + Vite + React)
- [x] UI：首页 / 对话页 / 插件市场 / 设置页
- [x] DMG 打包配置并验证可安装运行
- [x] 主进程：Claude CLI 长驻子进程通信层
- [x] Preload：真实 IPC bridge
- [x] 渲染进程消费真实 stream-json，替换 mock session
- [x] 历史会话加载（解析 `~/.claude/projects` session 文件）
- [x] 新建对话的项目选择 UI（首页 + 对话页都有真实项目选择器）
- [x] 模型/供应商配置系统（内置 Anthropic + 自定义供应商，支持对话中途切换模型）
- [x] 插件市场接入真实数据（连接器/技能读 `claude plugin list --available --json` + `~/.claude.json`）
- [x] 设置页 MCP 服务器一节接入真实数据
- [x] 设置页其余分区接入真实数据（常规/个人资料/配置/钩子/使用情况/Git/工作树/环境均已改为真实数据；外观/键盘快捷键/连接/已归档对话是 Codex 专属概念或超出本轮范围，保留"即将推出"占位）
- [x] 新建对话接入推理强度 `--effort` 参数（仅新建对话路径，`null` 表示不传该参数、交由 CLI 自身默认值决定）
- [x] 统一的级联 模型+推理强度+供应商 选择器
- [x] 右侧面板：Files（真实文件树）/ Review（真实 git diff，仅 Git 仓库时出现）/ Terminal（真实 node-pty shell）/ Browser（内嵌 webview，真实前进/后退/刷新）四 tab，仅 Terminal 懒挂载+常驻，其余即时挂载
- [x] DMG 打包正确带上 node-pty 原生模块（`packagerConfig.ignore`/`prune` 交互踩坑，见下）
- [x] Sidebar 项目悬浮菜单（置顶/重命名/在 Finder 中显示/创建工作树/归档全部会话/移除）+ 折叠展开；ChatView `⋯` 菜单改为会话级归档/移除入口（原滑块图标死按钮已删除，详见"项目/会话软状态"一节）
- [ ] 应用图标（当前用 Electron 默认图标）
- [ ] 多会话/多标签页同时打开（当前架构按 sessionId 设计，UI 层还只支持单一 activeSession）
- [ ] 查看已归档的会话/项目——目前"归档"和"移除"在列表里效果相同（整个过滤掉），没有单独的"已归档"视图能把它们找回来，只能手动清 sidecar 文件

## 打包踩坑记录

本机 Node 默认是 v24（nvm）。构建链路里几个非直觉的坑：

1. **npm install 的 electron 下载会因网络超时失败**，`node_modules/electron/dist` 可能残缺（只有几百 KB）。用 `ELECTRON_MIRROR` 或代理重装，并检查 `dist/Electron.app/Contents/Frameworks/` 是否完整（应有上百 MB）。
2. **`electron-forge package`/`make` 在 Node 24 下会静默吞掉错误**：卡在某一步不再输出，但进程 exit code 是 0，也不产出任何文件。这不是签名/沙盒问题，是 Node 24 + listr2 渲染器的兼容性问题。**排查这类"卡住但不报错"的问题时，先切到 Node 22 LTS 跑一遍**（`nvm use 22.17.1`），错误会正常抛出。
3. **vite.main.config.ts / vite.preload.config.ts 不能是空配置**：两个 target 会都输出成默认文件名（如 `index.js`）互相覆盖，导致 packager 报错找不到 `main.js`。必须显式设置 `build.rollupOptions.output.entryFileNames` 为 `main.js` / `preload.js`。
4. **原生模块（如 `macos-alias`，DMG maker 依赖）按 Node ABI 编译**：切换 Node 版本后如果报 `NODE_MODULE_VERSION` 不匹配，跑 `npm rebuild <module>` 针对当前 Node 版本重新编译，不要整个删 node_modules 重装。
5. **forge.config.ts 里引用不存在的 icon 路径**（如 `./assets/icon`）会导致 macOS 打包在 "Finalizing package" 阶段出问题。没有真实图标文件前不要配置 `icon` 字段。
6. **`electron-forge make` 需要连 GitHub**（native module rebuild 相关），走代理：`HTTP_PROXY`/`HTTPS_PROXY` 指向本机代理端口（Clash Verge 默认 `127.0.0.1:7890`）。
7. **`claude` 命令在本机有多个安装，PATH 顺序敏感**：`nvm use` 切换 Node 版本会改变 PATH 顺序，可能导致命令解析撞到一个装了一半的坏版本（如 Homebrew 装的 `@anthropic-ai/claude-code` 缺原生二进制），报 `spawn ENOEXEC`。`ClaudeSession.ts` 里通过登录 shell（`$SHELL -lic 'command -v claude'`）解析真实可用路径，而不是依赖裸 PATH 查找——这对最终打包的 app 也是必要的健壮性处理，因为 Finder 启动的 GUI app 的 PATH 通常比终端更简陋。
8. **`@electron-forge/plugin-vite` 的默认 `packagerConfig.ignore` 会把 node-pty 整个漏掉**：该插件假设 Vite 把所有依赖都打包进 JS，默认只保留 `.vite/*`。本项目的 `node-pty` 因为原生二进制路径解析的原因被 `vite.main.config.ts` 显式 `external` 排除在打包之外（见上文"node-pty 踩的三个坑"一节的详细分析），所以需要自定义 `ignore` 函数把它放行——但**放行必须以整个 `/node_modules` 为粒度，不能只放行 `/node_modules/node-pty` 这个前缀**：`@electron/packager` 底层的 `fs-extra` `copy({filter})` 在目录级别短路，filter 对裸 `/node_modules` 目录返回"忽略"就会跳过整个子树的递归，永远不会走到里面单独判断 `node-pty`。正确做法是放行整个 `/node_modules`，交给默认开启的 `packagerConfig.prune`（真实解析 `package.json` 依赖图，只留生产依赖）去做精细裁剪。**验证时不要只看 `npx asar list` 有没有列出文件——一定要对实际打包出的 `.app` 跑一次真实功能测试**（本项目是用 Playwright 的 `_electron.launch({executablePath: ".../Contents/MacOS/ccodebox"})` 直接启动打包产物，重复一遍开发模式下验证过的操作），因为"文件存在于 asar 里"和"原生模块在这个具体路径布局下真的能被 `dlopen`/`require` 成功"是两件事。

**结论：本项目的构建命令固定用 Node 22 LTS + 代理**，例如：
```bash
nvm use 22.17.1
export HTTP_PROXY=http://127.0.0.1:7890 HTTPS_PROXY=http://127.0.0.1:7890
CI=true npx electron-forge make
```
