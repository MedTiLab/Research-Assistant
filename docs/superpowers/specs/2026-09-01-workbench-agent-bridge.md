# 工作台 ↔ 对话 ↔ 技能：Agent 桥接 v1

状态：待评审
日期：2026-09-01
基座仓库：`medhelp` 分支 `codex/graduate-secretary`
实施者：Codex
前置 spec：`docs/superpowers/specs/2026-09-01-meeting-loop-design.md`（组会闭环，已实现）

---

## 1. 结论先行

### 1.1 核心问题的回答

> 「是用对话来写 skill，还是让大模型直接获得这些格式？」

**两者都不是二选一——它们是两层，而且只有一层是可以省的。**

| 层 | 是什么 | 能否省 |
| --- | --- | --- |
| **工具层（MCP）** | 动词。模型对工作台数据的**类型化、经校验、走事务**的读写通道 | **不能省** |
| **技能层（SKILL.md）** | 流程与判断。什么时候用哪个工具、按什么顺序、核对什么才算完 | 可以后补，但这是「逐项核对」的正解 |

**为什么不能「让大模型直接获得这些格式」**（即把 JSON schema / sqlite / 文件格式交给模型，让它自己写）：

`server/routes/meetings.js` 里已经存在三样东西，模型自己重做一遍必然做坏：

1. **未知字段一律拒绝**的严格校验（`requireObject`，meetings.js:37）
2. **单事务 promote**（`notes/:id/promote`、`actions/:id/promote-task`，meetings.js:482 / 601）——失败必须整体回滚，不留半条记录
3. **user_id 作用域**

更关键：前置 spec 的硬约束「**AI 只产草稿，绝不直接写库**」在「模型直接拿格式」的方案下**无法强制执行**——没有拦截点。

**为什么不能「只写一个 skill 让模型去 curl」**：

得到的是一个字符串拼接的 API 客户端。没有 schema 校验、没有权限拦截、不能复用现有的
`claude-permission-request` 确认 UI，而且只在有 shell 的 runtime 里能跑。

**结论：工具管动词，技能管流程。** 先建工具层，技能层建在其上。

顺带澄清第三件事：「**用对话来写 skill**」是**技能创作**，与「操纵左边这些模块」是两回事。
它已经由 `create-skill` 场景 → `skill-creator` 覆盖（`guidedPromptScenarios.ts:282`），不要
把它当成操纵工作台的机制。

### 1.2 已经存在的缝，不要另造

仓库里已有一个**跨三 runtime 打通的 MCP 注入通道**，`medhelp_compute`：

| 环节 | 文件 |
| --- | --- |
| stdio MCP server 本体 | `server/bin/agent-compute-mcp.js` |
| 工具实现（与传输解耦） | `server/agent-compute-mcp.js` |
| bridge 解析 + 上下文块 | `server/agent-compute-bridge.js` |
| Claude 注入 | `server/claude-sdk.js:763`（resolve）、`:847`（mcpServers）、`:867`（prompt） |
| Codex 注入 | `server/openai-codex.js:594` / `:636` / `:816` |
| Pi 注入 | `server/agent-runtime/pi-runtime.js:204` / `:237-259` |
| 打包进 Kernel | `scripts/build-secure-headless-kernel.mjs:34` / `:225`（esbuild → `.cjs`） |

**v1 完全复刻这条链路**，新增 `medhelp_workbench`。一份实现，三个 runtime 同时拿到。
不要为 Claude 单独用 `createSdkMcpServer`（虽然 SDK 0.3.220 支持，见
`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:482`）——那会变成两套实现。

---

## 2. 现状（代码实测）

### 2.1 左侧导航十个入口的真实后端

导航定义：`src/components/sidebar/view/subcomponents/sidebarNavTiles.ts:72`

| 入口 | UI 组件 | 服务端 | 状态 |
| --- | --- | --- | --- |
| meetings | `MeetingCenter.tsx` | `/api/research/*`（24 端点） | **真实** |
| news | `news-dashboard` | `/api/news`（14 端点） | 真实 |
| knowledgeBase | `KnowledgeBaseDashboard` | `/api/knowledge`（14 端点） | 真实 |
| companions | `CompanionCenter` | `/api/companions`（7 端点） | 真实 |
| miniApps | `MiniAppCenter` | `/api/mini-apps`（6 端点） | 真实 |
| skills | `SkillsDashboard` | `/api/skills` | 真实 |
| dashboard | `ResearchSecretaryDashboard` | **仅从 meetings 派生** | 部分 |
| advisor | `AdvisorActionCenter` | **仅从 meeting notes 派生** | 部分 |
| submissions | `SubmissionCenter` | **无** | 空壳 |
| automation | `AutomationCenter` | **无**（HTTP 实现直接 throw） | 空壳 |

派生逻辑见 `httpResearchSecretaryApi.ts:67-89`：`getSnapshot()` 拉全部 meeting，
再从中 flatMap 出 tasks 和 advisorActions。submissions / manuscripts / literatureAlerts /
artifacts / agentRuns / automationJobs 全部返回空数组（`emptySnapshot()`，:28）。

### 2.2 对话与左侧现在的连接：单向、有损

```
左侧卡片按钮 → onCommand(prompt: string)
              → handleResearchSecretaryCommand   MainContent.tsx:445
              → onStartWorkspaceQa(project, prompt)
              → handleStartWorkspaceQa           useProjectsState.ts:1004
              → queueWorkspaceQaDraft(project.name, prompt)   // 往输入框塞一段文字
```

就这些。传过去的只有一个**中文字符串**（例如 `AutomationCenter.tsx:59` 的
`` `立即执行自动化：${selected.name}` ``）。Agent 拿不到实体 id，做完也无法写回，
左侧不会刷新。**这就是「缺的那一块」。**

### 2.3 技能层现状

`skills/` 下 104 个 bundle；`guidedPromptScenarios.ts` 把场景映射到技能名数组；
三个 runtime 各自投影：`claudeSkillPlugin.js` / `codexSkillAccess.js` /
`pi-runtime/skill-projection.js`。

**没有任何一个技能能读到工作台数据。** 技能全是「怎么做研究」，没有「这个用户此刻有什么」。

---

## 3. 范围

### 3.1 v1 做

1. `medhelp_workbench` MCP 工具层，覆盖**已有真实后端**的组会闭环（meetings / agenda / notes / actions / transcript）
2. 变更类工具走**现有权限确认 UI**，保住「AI 只产草稿」的硬约束
3. `<medhelp_workbench_context>` 上下文块：让模型开局就知道「下次组会何时、几条未完成、几条逾期」
4. `medhelp-workbench-review` 技能：**逐项核对**流程（用户问题里的第二诉求）
5. 对话 → 左侧的**结构化命令**（带实体 id，不再是裸字符串）
6. Agent 写库后左侧**自动刷新**（WebSocket 广播）

### 3.2 v1 明确不做

| 不做项 | 理由 |
| --- | --- |
| submissions / automation 的工具 | **服务端根本不存在**。先建后端是另一个 spec 的事，不要为了凑齐十个入口而造假数据 |
| 录音 start/chunk/stop 工具 | 绑定用户设备与麦克风权限，属于 UI，不属于 agent |
| `summarize` 工具 | **循环**：模型是纪要的生成者，再给它一个「调另一个模型生成纪要」的工具毫无意义。模型应直接读 transcript 然后自己写 |
| news / knowledge / companions / miniApps 工具 | 有后端，但不在组会闭环这条线上。v1 先打透一条，架构验证后再按同一模式扩 |
| 让 agent 直接读写 sqlite | 会出现第二个写者，与主进程的 reminders scheduler 冲突 |
| 为 Claude 单独做 in-process MCP | 见 §1.2 |

### 3.3 反模式（硬约束，继承自前置 spec）

1. **AI 只产草稿，绝不直接写库。** 在本 spec 中具体化为：所有 `mutation: true` 的工具**必须**经 `canUseTool` 弹确认，不得进 `allowedTools` 默认白名单。
2. **不在生产界面写死演示数据。**
3. **promote 类操作必须单事务。** 工具层不重新实现，直接调现有端点。

---

## 4. 架构

### 4.1 数据通路

```
Agent (Claude / Codex / Pi)
  │  MCP stdio
  ▼
server/bin/workbench-mcp.js          ← 新增，形如 bin/agent-compute-mcp.js
  │  HTTP  Authorization: Bearer <15min token>
  ▼
http://127.0.0.1:${PORT}/api/research/*   ← 已存在，24 端点，不改
  │
  ▼
better-sqlite3（主进程唯一写者）
```

**为什么走 HTTP 回环而不是直连 sqlite**：复用 `routes/meetings.js` 里已经写好的
字段校验、事务、user 作用域；且避免 MCP 子进程成为第二个 sqlite 写者。
性能不是问题——单人单机，回环调用。

### 4.2 鉴权

`/api/research` 挂在 `authenticateToken` 之后（`server/index.js:1235`）。子进程需要 token。

做法：bridge 在**每轮**解析时用 `generateToken(user, sessionId)`
（`server/middleware/auth.js:155`，导出于 :257）铸一个 15 分钟 access token，
经 env 传给子进程。

- 复用当前会话的 `authSessionId`；取不到则不注入 bridge（工具不可用，而不是降级到无鉴权）
- token 只在子进程 env 里，**不进入模型上下文**——与 `medhelp_compute` 同一信任模型
- `IS_PLATFORM` 模式下 `authenticateAccountToken` 自动取 first user（auth.js:100），无需 token

`buildWorkbenchMcpEnv()` 照抄 `buildAgentComputeMcpEnv()`（agent-compute-bridge.js:113）的
env 白名单写法，额外传 `MEDHELP_WORKBENCH_BASE_URL` 与 `MEDHELP_WORKBENCH_TOKEN`。

### 4.3 端口发现

bridge 在主进程内运行，直接读服务器实际监听端口（`server/index.js:6230` 处解析的值），
挂到 `app.locals` 或模块级导出，不要再从 env 猜。

---

## 5. 工具契约

新增 `server/workbench-mcp.js`（handlers，与传输解耦）+ `server/bin/workbench-mcp.js`
（`McpServer` + `StdioServerTransport` + zod schema，形如 `bin/agent-compute-mcp.js`）。

MCP server name：`medhelp_workbench`。

### 5.1 读工具（`readOnlyHint: true`，进默认白名单，不弹确认）

| 工具 | 说明 | 后端 |
| --- | --- | --- |
| `overview` | **一次调用拿到整个左侧状态**：下次组会、未完成 action 数、逾期数、最近 3 次会议标题。这是「逐项核对」的入口 | `GET /meetings` + `GET /actions/open` |
| `meeting_list` | 按 `from` / `to` / `status` 列会议摘要 | `GET /meetings` |
| `meeting_get` | 单个会议全量：agenda + notes + actions + transcript 摘要 | `GET /meetings/:id` |
| `action_list` | 未完成 action，可按 `status` / 是否逾期过滤 | `GET /actions/open` |
| `transcript_get` | 会议转写分片（含每片 status），供模型自己写纪要 | `GET /meetings/:id/transcript` |

`overview` 的返回必须**有界**：会议最多 10 条、action 最多 30 条，超出只回计数。
不要把整个库塞进上下文。

### 5.2 写工具（`readOnlyHint: false`，**逐次弹确认**）

| 工具 | 后端 | 事务 |
| --- | --- | --- |
| `meeting_create` | `POST /meetings` | 是（带入 carryover agenda） |
| `meeting_update` | `PATCH /meetings/:id` | |
| `agenda_add` / `agenda_update` | `POST /meetings/:id/agenda`、`PATCH /agenda/:id` | |
| `note_add` | `POST /meetings/:id/notes` | |
| `note_promote` | `POST /notes/:id/promote` | **是** |
| `action_create` / `action_update` | `POST /meetings/:id/actions`、`PATCH /actions/:id` | |
| `action_promote_task` | `POST /actions/:id/promote-task` | **是** |
| `transcript_update` | `PATCH /transcript/:segmentId`（改 text / speaker） | |

**不新增任何业务逻辑。** 每个工具就是一次 HTTP 调用 + 错误透传。
服务端 400 的校验信息原样回给模型，让它自己改参数重试。

### 5.3 命名与描述规范

沿用 `server/agent-runtime/service-tools.js` 的风格：动词短、描述写清**副作用与边界**，
例如 `medhelp_compute` 的 run 描述明确写了「不要重复 sync」。工具描述是给模型看的**唯一**
说明书，写不清就等于没有。

---

## 6. 权限与确认

### 6.1 已有机制，不要新造

`server/claude-sdk.js:869-940` 的 `canUseTool` 已经实现了完整链路：

```
非白名单工具 → ws.send({ type: 'claude-permission-request', toolName, input })
             → 前端弹窗 → waitForToolApproval → allow / deny
```

MCP 工具在 SDK 里名为 `mcp__medhelp_workbench__meeting_create`，**天然走这条路**。

### 6.2 具体要求

1. 五个读工具加入默认 `allowedTools`（`claude-sdk.js:251` 附近的 settings 合并处），
   否则每次读都弹窗，不可用。
2. **所有写工具不得进白名单**，也不得被 `rememberEntry` 永久记住——需要在
   `claude-sdk.js:929` 的 remember 分支里对 `mcp__medhelp_workbench__*` 写工具做例外，
   否则用户点一次「记住」就永久绕过了「AI 只产草稿」的约束。
3. 前端权限弹窗需要能**可读地渲染** workbench 工具的 input（现在是裸 JSON）。
   最低要求：`meeting_create` 显示标题+时间，`note_promote` 显示将要生成的 action 文本。
4. Codex / Pi 各有自己的批准链路，v1 至少保证**不比 Claude 松**；若某 runtime 无法拦截，
   则该 runtime 只注入读工具。

---

## 7. 上下文块

新增 `buildWorkbenchContext()`，照抄 `buildAgentComputeContext()`
（agent-compute-bridge.js:62）的形状：

```
<medhelp_workbench_context>
[MedHelp 科研工作台]
下次组会：2026-09-05 14:00「课题进展汇报」（我是汇报人）
未完成 action：7 条，其中逾期 2 条
最近一次会议：2026-08-29「组会」，已生成纪要

用 medhelp_workbench 工具读取与修改工作台数据，不要凭记忆回答工作台状态。
写入类工具会向用户弹出确认；生成的纪要、待办一律作为草稿提交确认，不要声称已保存。
</medhelp_workbench_context>
```

**约束**：整块 ≤ 1500 字符；查询失败时降级为一行「工作台数据暂不可用」，
**不要**因此阻塞整轮对话（照抄 claude-sdk.js:768 的 try/catch 降级）。

---

## 8. 技能层

### 8.1 `skills/medhelp-workbench-review/SKILL.md`（新增）

这是用户第二个诉求——「让它帮我写一个计划，逐项核对周边这些事情」——的落点。

```yaml
---
name: medhelp-workbench-review
description: 核对科研工作台当前状态并给出下一步计划。当用户问「我现在有什么要做的」
  「帮我核对一下」「下次组会我该讲什么」「有什么漏掉的」，或需要在组会前后梳理待办时使用。
---
```

正文规定固定流程（**读 → 核 → 提议 → 确认**）：

1. 调 `overview` 拿全局；只在需要细节时再调 `meeting_get`
2. 逐项核对，每项给出**证据**（哪次会议、哪条 note），不得凭空断言
3. 产出**分类清单**：逾期 / 本周到期 / 下次组会要讲 / 缺失信息
4. 需要落库时，**先把提议列成清单让用户挑**，再逐条调写工具
5. 硬约束写进技能：「不得在未经用户确认的情况下调用任何写入工具」

同时把它加进 `guidedPromptScenarios.ts` 的 `daily` 组（现在只有
`today-tasks` 和 `reply-advisor` 两个，且 `today-tasks` 的 `skills: []` 是空的——
正好用这个技能填上）。

### 8.2 现有技能不改

104 个研究类技能与工作台正交，不动。

---

## 9. 前端：对话 ↔ 左侧双向

### 9.1 左 → 对话：把裸字符串换成结构化命令

现在：`onCommand(prompt: string)`。改为：

```ts
type WorkbenchCommand = {
  prompt: string;                    // 仍然是给用户看的自然语言
  entity?: { kind: 'meeting' | 'action' | 'note'; id: string };
  skills?: string[];                 // 建议启用的技能
};
```

改动点：
- `MainContent.tsx:445` `handleResearchSecretaryCommand` 接收 `WorkbenchCommand`
- 透传到 `handleStartWorkspaceQa`（`useProjectsState.ts:1004`），把 `entity` 一并入草稿
- 各 Center 的调用点补上 entity（如 `AutomationCenter.tsx:59`、
  `ResearchSecretaryDashboard.tsx:134`）

**收益**：agent 开局就知道用户点的是哪一条，不用靠标题字符串去猜。

### 9.2 对话 → 左：写库后刷新

服务端：新增 `broadcastWorkbenchUpdate(wss, { scope, meetingId })`，
形如 `server/utils/taskmaster-websocket.js:15`。在 `routes/meetings.js` 所有
POST / PATCH / DELETE 成功后调用（该文件已经 import 了
`broadcastTaskMasterTasksUpdate`，是同一模式）。

前端：`useResearchSecretarySnapshot`（`useResearchSecretarySnapshot.ts:10`）订阅该消息，
收到即 `refresh()`。

**这一步是「双向」的关键**：没有它，agent 改完库用户还得手动刷页面。

### 9.3 不做

不做「对话框里嵌入左侧组件」的富交互渲染。v1 用「agent 写库 → 左侧自动刷新」
达成同样效果，成本低一个数量级。

---

## 10. 改动点清单

### 新增

```
server/workbench-mcp.js                       工具 handlers（HTTP 客户端 + 错误透传）
server/bin/workbench-mcp.js                   stdio MCP server（zod schema）
server/workbench-bridge.js                    bridge 解析 + 上下文块 + env 构造 + token 铸造
server/utils/workbench-websocket.js           broadcastWorkbenchUpdate
skills/medhelp-workbench-review/SKILL.md      逐项核对技能
server/__tests__/workbench-mcp.test.mjs
server/__tests__/workbench-bridge.test.mjs
```

### 修改

| 文件 | 改动 |
| --- | --- |
| `server/claude-sdk.js` | :763 附近解析 workbenchBridge；:847 注入 mcpServers；:867 拼上下文；:251 读工具入白名单；:929 写工具排除 remember |
| `server/openai-codex.js` | :594 / :636 / :816 三处同上 |
| `server/agent-runtime/pi-runtime.js` | :204 `buildPiResourceProjection` 增加 workbench server；:237-259 并行解析 |
| `server/routes/meetings.js` | 所有写端点成功后广播 |
| `server/index.js` | 导出实际监听端口供 bridge 使用 |
| `scripts/build-secure-headless-kernel.mjs` | :34 / :225 增加 `workbench-mcp.cjs` 打包条目 |
| `src/components/main-content/view/MainContent.tsx` | :445 `WorkbenchCommand` |
| `src/hooks/useProjectsState.ts` | :1004 透传 entity |
| `src/features/research-secretary/services/useResearchSecretarySnapshot.ts` | 订阅 WebSocket 刷新 |
| `src/features/research-secretary/**/[各 Center]` | 调用点补 entity |
| `src/components/chat/constants/guidedPromptScenarios.ts` | `today-tasks` 补上技能 |
| 权限弹窗组件 | 渲染 workbench 工具 input |

### 不动

`server/agent-compute-*.js`、`AGENT_SERVICE_TOOLS`、104 个研究技能、`/api/research` 的 24 个端点。

---

## 11. 分阶段实施

每阶段独立可验、可停。

**阶段 1：工具层能跑通（最小闭环）**
- `server/workbench-mcp.js` + `server/bin/workbench-mcp.js`，只做 `overview` 一个读工具
- `server/workbench-bridge.js`，只接 Claude 一个 runtime
- 验：对话里问「我现在有什么没做完」，模型调用 `overview` 并给出真实数据

**阶段 2：读工具补齐 + 上下文块**
- 其余四个读工具；`buildWorkbenchContext()`
- 验：不主动调工具时，模型也知道下次组会时间

**阶段 3：写工具 + 权限**
- 八个写工具；白名单例外；弹窗渲染
- 验：说「把导师这条意见转成待办」→ 弹确认 → 确认后库里真的多一条，取消则没有

**阶段 4：双向刷新 + 结构化命令**
- WebSocket 广播；`WorkbenchCommand`
- 验：agent 建会后左侧列表**不刷新页面**就出现

**阶段 5：技能 + 跨 runtime + 打包**
- `medhelp-workbench-review`；Codex / Pi 注入；esbuild 打包条目
- 验：Codex 会话里同样能用；打包版 Kernel 里工具不消失（参见既往教训：
  编译产物只打包 JS，资产需显式复制）

---

## 12. 验收标准

**工具层**
- [ ] 三个 runtime 都能列出 `medhelp_workbench` 的工具
- [ ] 读工具不弹确认；写工具**每次**弹确认
- [ ] 写工具**不能**通过「记住此选择」永久放行
- [ ] 服务端 400 校验信息原样传到模型，模型能据此修正参数
- [ ] token 不出现在模型上下文、日志、错误信息里

**闭环**
- [ ] 对话里说「把这条意见转成待办」→ 确认后 `meeting_action_items` 真多一条，且 note 状态同步更新（事务）
- [ ] 取消确认后，库里**没有**任何半条记录
- [ ] agent 写库后左侧列表自动刷新，无需手动刷页面

**核对技能**
- [ ] 问「帮我核对一下」，产出分类清单（逾期 / 本周 / 下次组会 / 缺信息），每项带来源证据
- [ ] 技能在提议落库前先列清单等用户挑，不擅自写入

**降级**
- [ ] 服务端未启动 / token 铸造失败时，bridge 不注入，对话正常进行，模型明确说明工作台不可用
- [ ] `overview` 超时不阻塞整轮对话

**打包**
- [ ] 打包后的 Kernel 中工具仍可用（`workbench-mcp.cjs` 在产物内）

---

## 13. 风险与取舍

| 风险 | 处理 |
| --- | --- |
| 15 分钟 token 在长会话中过期 | bridge 每轮重铸；子进程收到 401 时返回明确错误而非静默失败 |
| 模型绕过确认，声称「已保存」 | 上下文块显式写明「写入需确认，不要声称已保存」；工具返回值里带 `confirmed: true`，技能要求以此为准 |
| `overview` 上下文占用 | 硬性截断（会议 10 / action 30），超出只回计数 |
| Codex / Pi 批准链路弱于 Claude | 该 runtime 只注入读工具，不降级放行写工具 |
| 打包遗漏导致工具静默消失 | 阶段 5 的验收项；沿用 compute MCP 的 esbuild 条目写法 |
| 十个入口只打通一个，观感上「没做完」 | 有意取舍。submissions / automation **没有后端**，为凑数造假数据违反硬约束 §3.3.2。架构验证后按同一模式扩，每个新模块只需加一组 handler |

---

## 14. 后续（不在本 spec）

- 按同一模式扩到 news / knowledge / references / companions（这四个**已有真实后端**，成本最低）
- submissions / automation：先补后端，再补工具
- 工作台事件回灌技能：让技能能读到「上次这个建议用户拒绝了」
