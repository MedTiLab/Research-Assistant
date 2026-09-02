# 左侧工作台缺口修复清单

状态：已实施（自动验证通过，待 UI 手工验收）
日期：2026-09-01
分支：`codex/pi-only-agent`（基线 `ed840dc9`）
实施者：Codex
前置：`2026-09-01-meeting-loop-design.md`（组会闭环）、`2026-09-01-workbench-agent-bridge.md`（Agent 桥接）

---

## 0. 前提：先确认这些已经完成，不要重做

代码实测，以下已落地，**本清单不涉及**：

- 自动化中心：真实数据，走 `/api/agent-services/automations`，增删改查 / 暂停恢复 / 立即执行 / 执行历史齐全
- Workbench MCP 桥接：`server/workbench-mcp.js`、`server/workbench-bridge.js`、`server/bin/workbench-mcp.js`
- WebSocket 回推：`server/utils/workbench-websocket.js` 的 `broadcastWorkbenchUpdate`（按 userId 定向），
  `routes/meetings.js` 17 处 `notifyWorkbench` 调用，
  `useResearchSecretarySnapshot.ts` 已订阅 `workbench-updated` 并 refresh
- `WorkbenchCommand` 结构化命令：`domain/workbenchCommand.ts`
- `skills/medhelp-workbench-review/SKILL.md`

**核心判断：左侧现在缺的主要不是后端，是接线。** 五个恒空的 snapshot 字段里，三个的数据源已经在跑。

---

## 1. 优先级总览

| 编号 | 问题 | 类别 | 优先级 |
| --- | --- | --- | --- |
| P0-1 | action 提升为任务后从工作台消失 | 闭环断裂 | 最高 |
| P0-2 | 首页 signals 四组源三组恒空 | 数据源分裂 | 最高 |
| P0-3 | 日历/收件箱/今日目标只存 localStorage | Agent 盲区 | 高 |
| P1-1 | `literatureAlerts` / `artifacts` / `agentRuns` 未接线 | 接线 | 中 |
| P1-2 | 首页加载 N+1 | 性能 | 中 |
| P2-1 | 投稿中心是死壳，且按钮无 onClick | 假功能 | 中 |
| P2-2 | 导师事项只读，一半状态不可达 | 半成品 | 中 |
| P3-1 | 13 个组件零引用 | 死代码 | 低 |
| P3-2 | fixtures 仍在生产代码 import | 违反前置 spec | 低 |

---

## 2. P0-1：action 提升为任务后从工作台消失

### 现状

`POST /api/research/actions/:id/promote-task`（`server/routes/meetings.js:601`）把 action 写进
taskmaster，并在 `metadata` 里留了溯源信息：

```js
metadata: {
  source: 'meeting',
  sourceMeetingId: action.meeting_id,
  sourceMeetingActionId: action.id,
  dueAt: action.due_date || undefined,
}
```

但前端 `getSnapshot()`（`httpResearchSecretaryApi.ts:74`）的 tasks **只来自 meeting actions**：

```ts
snapshot.tasks = actions.map(actionAsTask);
```

结果：**用户点「转任务」，这条事项就从首页任务列表里消失了**——这恰好是组会闭环 spec 要闭的那个环。

### 目标

`snapshot.tasks` = meeting actions ∪ taskmaster tasks，**同一件事只出现一次**。

### 实现

1. `getSnapshot()` 需要项目列表。当前签名无参数，改为 `getSnapshot(projects: Project[])`；
   `useResearchSecretarySnapshot()` 增加 `projects` 参数，各 Center 把已有的 `projects` prop 传下去。
2. 并行拉取每个项目的 `GET /api/taskmaster/tasks/:projectName`（`routes/taskmaster.js:2064`）。
   单个项目失败不能拖垮整体，用 `Promise.allSettled`。
3. 状态映射（taskmaster → `ResearchTaskStatus`）：

   | taskmaster | ResearchTask |
   | --- | --- |
   | `pending` | `todo` |
   | `in-progress` | `in_progress` |
   | `review` | `in_progress` |
   | `deferred` | `blocked` |
   | `done` | `done` |
   | `cancelled` | **过滤掉，不进 snapshot** |

4. **去重规则**：taskmaster task 的 `metadata.sourceMeetingActionId` 有值时，
   从 `actions` 派生的那条同 id 记录**不再产出**——以 task 为准（它有更完整的 stage / priority）。
   反向兜底：action 有 `taskId` 但对应 task 拉取失败时，仍按 action 产出，避免整条消失。
5. `source` 字段：来自 meeting 的置 `'meeting'`，其余置 `'manual'`。

### 验收

- [ ] 把一条 action 转为任务后，它**仍然**出现在首页任务列表，且只出现一次
- [ ] 任务在 taskmaster 里改成 done，首页该条随之变 done
- [ ] 某个项目 tasks 接口 404 时，其余项目的任务正常显示，页面不报错

---

## 3. P0-2：首页 signals 四组源，三组恒空

### 现状

`ResearchSecretaryDashboard.tsx:257-313` 的 `signals` 读四类数据：
`snapshot.submissions`、`snapshot.advisorActions`、`activeRuns`、`snapshot.automationJobs`。

其中 `submissions`、`automationJobs`、`agentRuns` 在 `emptySnapshot()`
（`httpResearchSecretaryApi.ts:27-40`）里恒为 `[]`。

**最需要修的是 automationJobs**：自动化中心已经有真实数据，但它直连
`/api/agent-services/automations`，首页走 snapshot——**两套数据源，首页那套是死的**。
自动化跑失败了，首页不会告诉你。同理 `metrics` 里的「连续科研」只能靠
`activeAgentCount` prop 兜底（:206）。

### 目标

首页与自动化中心共用同一数据源。

### 实现

1. 把 `AutomationCenter.tsx` 里的自动化拉取逻辑抽成共享模块
   （建议 `src/features/research-secretary/services/automationsApi.ts`），
   `AutomationCenter` 与 `getSnapshot()` 都调它。**不要复制一份**。
2. `AutomationRecord` → `AutomationJob` 映射：

   | AutomationRecord | AutomationJob |
   | --- | --- |
   | `status: 'active'` | `'enabled'` |
   | `status: 'paused'` | `'paused'` |
   | `status: 'cancelled' \| 'completed'` | 不进 signals |
   | `lastStatus === 'failed'` | **覆写为 `'error'`**（这是 signals 唯一要显示的情形） |
   | `intervalMinutes` | `schedule: { kind: intervalMinutes ? 'interval' : 'manual' }` |
   | `title` / `projectKey` / `nextRunAt` / `lastRunAt` | `name` / `projectId` / `nextRunAt` / `lastRunAt` |

3. `agentRuns` 接 `GET /api/agent-runs`（`routes/agent-runs.js:24`）。
   确认返回字段后映射到 `AgentRun`；`status` 无法一一对应时，
   宁可少映射也不要猜——`waiting_for_user` 只在后端确实有该状态时才产出。

### 验收

- [ ] 自动化任务上次执行失败时，首页 signals 出现一条红色告警，点击跳转自动化页
- [ ] 「连续科研」指标不再依赖 `activeAgentCount` 兜底，能反映真实运行数
- [ ] 自动化页与首页显示的任务数量一致

---

## 4. P0-3：日历 / 收件箱 / 今日目标只存 localStorage

### 现状

`ResearchSecretaryDashboard.tsx:46-49`：

```ts
const FOCUS_STORAGE_KEY = 'research-secretary:daily-focus';
const GOAL_STORAGE_KEY = 'research-secretary:daily-goal';
const INBOX_STORAGE_KEY = 'research-secretary:inbox';
const CALENDAR_STORAGE_KEY = 'research-secretary:calendar-todos';
```

后果连锁：
- 不进库 → **workbench MCP 读不到** → `medhelp-workbench-review` 技能回答「我今天该做什么」时看到的世界是残缺的
- 没有提醒 → 与 `server/services/meetingReminders.js` 完全割裂
- 换设备 / 清缓存即丢失

### 目标

四类数据入库，纳入 `/api/research` 与 workbench MCP 的读取范围。

### 实现

1. `server/database/init.sql` 新增两张表，沿用 `CREATE TABLE IF NOT EXISTS` 幂等风格：

   **`workbench_calendar_todos`**：`id` TEXT PK、`user_id` INTEGER NOT NULL、`title` TEXT NOT NULL、
   `date` TEXT NOT NULL（`YYYY-MM-DD`）、`completed` INTEGER NOT NULL DEFAULT 0、
   `project_id` TEXT、`created_at`、`updated_at`。索引 `(user_id, date)`。

   **`workbench_notes`**：`id` TEXT PK、`user_id` INTEGER NOT NULL、
   `kind` TEXT NOT NULL（`inbox` / `daily_focus` / `daily_goal`）、`content` TEXT NOT NULL、
   `day` TEXT（`daily_focus` / `daily_goal` 按天唯一，`inbox` 为空）、`created_at`、`updated_at`。
   唯一索引 `(user_id, kind, day)` 且仅对 `day IS NOT NULL` 生效（用部分索引）。

2. `server/database/db.js` 新增 `migrateWorkbenchNotesV1()`，
   **沿用 `migrateMeetingLoopV1()` 的既有模式**，调用 `ensurePreMigrationBackup`。

3. `server/routes/meetings.js` 增加端点（同一路由文件，仍挂 `/api/research`）：

   ```
   GET    /calendar-todos?from=&to=
   POST   /calendar-todos
   PATCH  /calendar-todos/:id
   DELETE /calendar-todos/:id
   GET    /notes/workbench?kind=&day=
   PUT    /notes/workbench            按 (kind, day) upsert，inbox 为纯 append
   DELETE /notes/workbench/:id
   ```

   校验沿用该文件已有的 `requireObject` / `textValue` / `isoValue` / `enumValue`，
   **未知字段一律拒绝**。每个写端点成功后调 `notifyWorkbench(req, 'calendar')` / `'note'`。

4. 前端：`ResearchSecretaryDashboard` 的四个 `localStorage` 读写换成 API 调用。
   **加一次性迁移**：首次加载时若 localStorage 有数据且服务端为空，导入后清除本地键，
   不要静默丢弃用户已有的内容。

5. Workbench MCP 增加读工具 `calendar_list`、`notes_list`，并让
   `buildWorkbenchContext()` 的摘要包含「今日待办 N 条」。
   写工具 `calendar_create` / `calendar_update` 走既有的确认弹窗链路。

### 验收

- [ ] 日历待办重启应用后仍在，换浏览器仍在
- [ ] 对话里问「我今天有什么安排」，agent 能读到日历待办
- [ ] 原 localStorage 里的待办在升级后自动迁移，不丢失
- [ ] 写入类日历工具仍会弹确认

---

## 5. P1-1：三个恒空字段接线

`emptySnapshot()`（`httpResearchSecretaryApi.ts:27`）里五个字段恒空，其中三个后端已存在：

| 字段 | 数据源 | 说明 |
| --- | --- | --- |
| `literatureAlerts` | `GET /api/news/bootstrap`（`routes/news.js:542`） | 一次性返回 `{ sources, configs, results }`，`results[source].top_papers` 是论文数组。**用 bootstrap，不要逐 source 拉 `/results/:source`**，否则又是 N 次请求 |
| `artifacts` | `GET /api/taskmaster/artifacts/:projectName`（`routes/taskmaster.js:2137`） | 返回 `{ artifacts, latestArtifact, totalArtifacts }` |
| `agentRuns` | `GET /api/agent-runs`（`routes/agent-runs.js:24`） | 见 §3.3 |

映射到 `LiteratureAlert` 时：
- `relevanceScore` 前端已兼容 0–1 与 0–100 两种刻度（`toRelevancePercent`，Dashboard :110），后端给哪种都行
- `read` 字段后端若无对应概念，**先恒置 `false`**，并在本清单外另立「已读状态」任务；不要为了填字段而伪造

`manuscripts` / `submissions` / `presentations` 确实无后端，见 §6。

### 验收

- [ ] 首页「待读文献」指标显示真实数字，点击跳转 news 页
- [ ] news 无结果缓存时指标显示 0 且不报错

---

## 6. P1-2：首页加载 N+1

### 现状

`getSnapshot()`（`httpResearchSecretaryApi.ts:70-73`）：

```ts
const summaries = await listMeetings();
const meetings = await Promise.all(summaries.map((meeting) => getMeeting(meeting.id)));
```

1 次 list + N 次 get，**每次 get 返回完整 agenda + notes + actions + transcript**。
每次进首页都跑一遍。会议攒到几十个就会明显卡，且 transcript 数据在首页完全用不到。

### 目标

首页一次请求拿完，且不传输用不到的字段。

### 实现

新增 `GET /api/research/snapshot`，服务端一次 SQL 聚合返回：

```
{
  meetings: [...],        // 摘要 + agenda，不含 notes/transcript 全文
  openActions: [...],     // status IN ('open','in_progress')
  advisorNotes: [...],    // note_type = 'feedback'，仅最近 N 条
  counts: { overdueActions, todayActions, upcomingMeetings }
}
```

**有界**：meetings 最多 20 条（按日期倒序 + 未来会议优先），advisorNotes 最多 50 条，
超出只回计数。前端 `getSnapshot()` 改调此端点；`getMeeting()` 保留给会议详情页按需拉取。

### 验收

- [ ] 首页加载只发一次 `/api/research/snapshot`（加上 taskmaster / news / automations 的并行请求）
- [ ] 50 个会议时首页首屏在 1 秒内出内容
- [ ] 会议详情页仍能拿到完整 notes 与 transcript

---

## 7. P2-1：投稿中心是死壳

### 现状

- `snapshot.submissions` / `snapshot.manuscripts` 恒为 `[]`，无任何后端
- `SubmissionCenter.tsx:75` 的「登记稿件」按钮**没有 onClick**
- 空状态却写着「点击"登记稿件"开始跟踪真实投稿进度」（:85）——引导用户去点一个没反应的按钮

UI 本身做得很完整：4 个筛选器、9 种 `SubmissionStatus`、9 种 `SubmissionDocumentKind`。

### 决策：先隐藏入口，不要留假按钮

投稿是一条完整的业务线（稿件表 + 投稿表 + 文档清单 + 状态机 + Deadline），
不是一个按钮能补上的。**在真正实现之前，带假按钮的页面比没有页面更糟**。

### 实现

1. `src/config/appModules.ts` 中把 `submissions` 模块置 `visible: false`，
   **沿用 `projectProgress` 的既有写法**（该模块已用同样方式退役，见 appModules.ts 中
   "Retired project overview page. Kept hidden so persisted tabs redirect to Home." 的注释）。
2. 保留 `SubmissionCenter.tsx` / `SubmissionCard.tsx` / 相关类型，加一行注释说明为何隐藏及恢复条件。
3. 首页 `quickLinks` 里的「投稿中心」项会被 `isAppTabVisible` 自动过滤（Dashboard :330），无需额外改动——**但要验证**。
4. 首页 signals 中读 `snapshot.submissions` 的分支保留（数据恒空时自然不产出），不必删。

**若产品决定现在就做投稿后端**，则另立 spec：至少需要 `manuscripts` + `submissions` 两张表、
状态机迁移规则、文档就绪度计算，工作量与组会闭环相当，不属于本清单。

### 验收

- [ ] 左侧导航不再出现「投稿中心」
- [ ] 首页快捷入口不再出现「投稿中心」
- [ ] 已持久化在 localStorage 里的 `activeTab === 'submissions'` 能正确回落到首页，不白屏

---

## 8. P2-2：导师事项只读，一半状态不可达

### 现状

`AdvisorAction` 定义了 4 个状态（`open` / `in_progress` / `waiting` / `done`）、
`dueAt`、`nextAction`、4 种 `source`。但投影逻辑（`httpResearchSecretaryApi.ts:84`）只做：

```ts
status: note.promotedActionId ? 'in_progress' : 'open',
priority: 'medium',
```

于是 `waiting` / `done` 永远到不了，`dueAt` / `nextAction` 永远 `undefined`，
`source` 的 `email` / `calendar` / `manual` 三个取值不可达。
`AdvisorActionCenter.tsx:45` 的「添加事项」按钮同样**没有 onClick**。
页面底部那张「授权数据来源」表还在标 V2（`AdvisorActionCenter.tsx:49`）。

### 决策：让它诚实，而不是让它完整

邮件 / Calendar 接入不在当前范围。手动录入则**应该做**——成本低，且是「把导师口头要求记下来」的常见入口。

### 实现

1. **实现「添加事项」**：复用 `meeting_notes`，即手动创建一条 `note_type = 'feedback'` 的记录，
   挂在用户选择的会议上（或一条 `meeting_type = 'one_on_one'` 的轻量会议）。
   **不新建 advisor 专用表**——避免与组会闭环出现两套导师意见存储。
2. **状态可流转**：导师事项的状态直接复用其 promoted action 的 `status`
   （`open` / `in_progress` / `done` / `dropped`），映射到 `AdvisorActionStatus`；
   `dropped → waiting` 不成立，**建议把 `AdvisorActionStatus` 的 `waiting` 删掉**，
   让类型与真实可达状态一致，而不是留一个永远到不了的枚举值。
3. `dueAt` 取 promoted action 的 `due_date`。
4. 「授权数据来源」表：把「邮件」「Calendar」两行**删掉**，或改为不带 "V2 接入" 承诺的说明文字。
   不要在生产界面对未排期的功能作时间承诺。

### 验收

- [ ] 「添加事项」能创建一条导师事项，刷新后仍在
- [ ] 事项状态能改，且与对应 action item 的状态保持一致
- [ ] 类型里不再存在无法到达的枚举值

---

## 9. P3-1：13 个组件零引用

`grep` 实测无任何 import：

```
src/features/research-secretary/dashboard/LiteratureUpdatesCard.tsx
src/features/research-secretary/dashboard/SubmissionStatusCard.tsx
src/features/research-secretary/dashboard/RecentArtifactsCard.tsx
src/features/research-secretary/dashboard/AgentRunsCard.tsx
src/features/research-secretary/dashboard/ProjectProgressCard.tsx
src/features/research-secretary/dashboard/DeadlineCard.tsx
src/features/research-secretary/dashboard/ResearchAlertsCard.tsx
src/features/research-secretary/dashboard/TodayTasksCard.tsx
src/features/research-secretary/dashboard/AdvisorActionsCard.tsx
src/features/research-secretary/dashboard/MeetingPrepCard.tsx
src/features/research-secretary/automation/AutomationJobCard.tsx
src/features/research-secretary/automation/AutomationRunHistory.tsx
src/features/research-secretary/meetings/PresentationCard.tsx
```

首页已改用 `dashboard/home/*`，这批 Card 是上一版首页的遗留。

### 实现

**先删 11 个，保留 2 个待评估**：

- 直接删除：上表中除 `DeadlineCard` 与 `ResearchAlertsCard` 之外的 11 个
- **`DeadlineCard` 和 `ResearchAlertsCard` 单独处理**：它们代表的「截止日期汇总」和
  「风险预警」两项能力，**现在首页完全没有**。删代码之前，先确认产品是否要在
  `home/*` 里重建这两块；若要，则改造后接入而非删除；若不要，再删。
  这个决定需要产品拍板，**不要由实施者顺手删掉**。

删除后跑一遍 `npx tsc --noEmit` 与既有测试，确认没有间接引用。

### 验收

- [ ] 11 个文件删除后类型检查与测试全绿
- [ ] `DeadlineCard` / `ResearchAlertsCard` 的去留有明确结论并记录在本文件

---

## 10. P3-2：fixtures 仍在生产代码 import

`src/features/research-secretary/services/researchSecretaryApi.ts:14`：

```ts
import { createWorkbenchFixtures } from '../fixtures/workbenchFixtures';
```

`createFixtureResearchSecretaryApi` 零调用。前置 spec（组会闭环 §7.3）明确要求
「`fixtures/workbenchFixtures.ts` 移入测试目录，生产代码不再引用」。

### 实现

把 `workbenchFixtures.ts` 与 `createFixtureResearchSecretaryApi` 一起移到测试目录
（如 `src/features/research-secretary/__tests__/fixtures/`），
`researchSecretaryApi.ts` 只保留 `ResearchSecretaryApi` 接口与 `StartAgentRunInput` 类型定义。

### 验收

- [ ] 生产构建产物中不含 fixtures 代码
- [ ] 现有引用 fixtures 的测试仍能通过

---

## 11. 实施顺序

```
P0-1 tasks 接 taskmaster        ← 先做，闭环断裂是真 bug
P0-2 自动化数据源统一            ← 顺带修掉首页 metrics 兜底
P1-2 /api/research/snapshot     ← 在接更多数据源之前先解决 N+1，否则越接越慢
P1-1 三个字段接线
P0-3 日历入库 + MCP 工具         ← 后端改动最大，但直接决定 agent 的可用度
P2-1 隐藏投稿入口               ← 一行配置，随时可做
P2-2 导师事项手动录入
P3-1 / P3-2 清理
```

**注意 P1-2 排在 P1-1 之前**：先建聚合端点，再往里加数据源，否则每加一个字段就多一轮 N+1。

---

## 12. 全局约束（继承自前置 spec，不得违反）

1. **AI 只产草稿，绝不直接写库。** 新增的日历 / 笔记写工具必须走确认弹窗，不得进默认白名单。
2. **不在生产界面写死演示数据。** 接不上真数据的卡片显示真实空状态，不填充示例内容。
3. **不留假按钮。** 无 onClick 的按钮要么实现，要么连同入口一起隐藏。
4. **未知字段一律拒绝。** 新增端点沿用 `routes/meetings.js` 的 `requireObject` 校验风格。
5. **不复制数据源。** 同一份数据在首页与详情页必须走同一个模块（见 §3）。

---

## 13. 不做

| 不做项 | 理由 |
| --- | --- |
| 投稿 / 稿件后端 | 独立业务线，工作量与组会闭环相当，另立 spec |
| 邮件 / Calendar 接入 | 需要 OAuth 与外部授权，不在当前范围 |
| `presentations` 数据源 | 依赖 PPT 生成能力，属前置 spec 的 v3 |
| 文献「已读」状态 | 需要 news 侧新增字段，另立任务；本清单先恒置 `false` |
| 多设备同步 | 前置 spec 已明确 v1 不做 |

---

## 14. 实施记录（2026-09-01）

已完成：

- `snapshot.tasks` 合并 meeting actions 与 TaskMaster tasks，按 `sourceMeetingActionId` 去重；项目级失败隔离
- 新增有界 `/api/research/snapshot`，会议详情继续按需加载
- 自动化、Agent runs、news bootstrap、project artifacts 接入首页 snapshot；首页运行数不再使用会话数兜底
- 日历待办、收件箱、今日重点与目标持久化；旧 localStorage 数据仅在服务端对应集合为空时一次性导入
- Workbench MCP 新增 `calendar_list`、`notes_list`、`calendar_create`、`calendar_update`；写工具仍在 mutation 集合中，需用户确认
- 投稿入口隐藏并支持持久化 tab 回落；导师事项支持手动录入、提升行动项和状态流转
- 删除 11 个零引用遗留组件及生产 fixtures；`DeadlineCard`、`ResearchAlertsCard` 本轮明确保留，不擅自删除，待产品决定是否在 `home/*` 重建

自动验证：TypeScript 类型检查、research-secretary 前端测试、meeting/workbench MCP/bridge 路由测试通过。首屏耗时、跨浏览器迁移和真实确认弹窗仍需在桌面应用中手工验收。
