# 医学研究生研究工作台 v1：组会闭环

状态：待评审
日期：2026-09-01
基座仓库：`medhelp` 分支 `codex/graduate-secretary`
实施者：Codex

---

## 1. 结论先行

### 1.1 基座选择

改造 **medhelp `codex/graduate-secretary`**，单仓完成，**v1 不引入 qm_research**。

依据（均为代码实测）：

| 维度 | medhelp graduate-secretary | qm_research |
| --- | --- | --- |
| 前端 | React 18 + Vite + Tailwind + react-router，74 组件，114k 行 | 手写 DOM 的 vanilla TS，`research.ts` 1529 行且 `// @ts-nocheck`，共 ~20k 行 |
| 后端 | 83k 行，32 个路由，`server/agent-runtime/` 已有 claude/codex/pi 三运行时 | 53 模块，Postgres + pg-boss + croner，多 principal/ACL |
| 科研工作台现状 | `src/features/research-secretary/` UI 骨架齐全，走 fixtures 假数据 | `/research-api/*` 仅为反向代理壳（`plugins/web-ui/server/index.ts:774`），`RESEARCH_UPSTREAM` 未配置，页面无数据 |
| 桌面端 | Electron + electron-builder 已就绪 | 无 |
| 存储 | better-sqlite3，`server/database/init.sql` + `db.js` 手写迁移 | Postgres |

v1 要加的是 PDF 精读、PPT、日历、录音——全部是重前端。在 vanilla DOM + `@ts-nocheck` 上做这些，成本是 React 的数倍且无类型保护。

### 1.2 为什么不引入 qm

qm 的核心资产是 **多 principal / ACL / org 隔离、Postgres + pg-boss 分布式队列、Slack surface**。本项目确定为：

- 使用范围：**单人自用**
- 提醒渠道：**应用内 + Electron 桌面通知**

这两条使上述资产全部变成负担而非收益。引入 qm 会带来双数据库（Postgres vs sqlite）、双 agent runtime、双 auth、身份映射四项额外复杂度，且不换来任何 v1 需要的能力。

**qm 保留为未来选项**：若日后要做课题组多人版，届时替换的是「提醒 + 长任务 + 权限」的实现，而非 UI。为此 v1 保留 `ResearchSecretaryApi` 这一层接口作为缝（见 §4.1）——它已经存在，不是为此新造的抽象。

### 1.3 关于既有架构提案的更正

此前的「MedAutoData 身体 + QM 大脑」提案中，`Research Tools（PubMed / Crossref / Statistics / R+Python / DOCX+PPTX）` 被归在 qm 一侧。**qm 无此能力**：`src/tools/` 仅有一个 `primitives.ts`。这些能力实际位于 medhelp 的 skills 目录与用户的 Claude skills 中。实施时不要去 qm 寻找。

---

## 2. 范围

### 2.1 v1 做

**只打透组会闭环这一条线。** 四步：

```
会前  这次我讲什么 · 上次答应的还剩什么没做 · 导师上次提了什么
  ↓
会中  录音 → 边录边转写 → 逐行标说话人
  ↓
会后  转写 → AI 生成纪要草稿 → 人工确认 → 我的待办 → 挂到项目
  ↓
下次  未完成的自动出现在议程顶部        ← 闭环在这里
```

第四步是闭环的全部价值所在，也是 medhelp / qm / research_system 三个系统都未完成的一环。

### 2.2 v1 明确不做

| 不做项 | 理由 |
| --- | --- |
| 多用户、权限、分享 | 单人自用 |
| 引入 qm 的任何模块 | 见 §1.2 |
| 应用未启动时的提醒 | 需要常驻进程或系统级调度，v1 用 Electron 前台通知即可 |
| 自动说话人分离（diarization） | Whisper API 不提供；本地 pyannote 引入成本远高于收益。改为手动打标签（§5.5） |
| 本地转写（whisper.cpp） | 预留接口不实现，除非隐私评审否决云端方案（§5.6） |
| 文献精读器、PPT 生成、投稿流程 | 保留 UI 骨架但**移除 fixtures，显示真实空状态 + 下一步入口**（§7.3） |

### 2.3 反模式（硬约束）

1. **AI 只产草稿，绝不直接写库。** 所有 AI 输出必须经用户确认后才落库。
2. **不在生产界面写死演示数据。** 空状态给真实的下一步入口，不填充示例内容。
3. **promote 类操作必须单事务。** 见 §4.3。

---

## 3. 数据模型

新增 6 张表，写入 `server/database/init.sql`（沿用 `CREATE TABLE IF NOT EXISTS` 幂等风格），并在 `server/database/db.js` 中加一个 `migrateMeetingLoopV1()` 函数（沿用 `migrateSessionPersistenceV2()` 的既有模式，调用 `ensurePreMigrationBackup`）。

所有表带 `user_id`，与 `projects` 等既有表保持一致，即使 v1 单人。

### 3.1 `meetings`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | TEXT PK | |
| `user_id` | INTEGER NOT NULL | |
| `title` | TEXT NOT NULL | |
| `meeting_date` | TEXT NOT NULL | ISO 8601，含时区 |
| `meeting_type` | TEXT NOT NULL | `group` / `one_on_one` / `journal_club` / `progress` |
| `my_role` | TEXT NOT NULL | `presenter` / `attendee` |
| `location` | TEXT | |
| `project_id` | TEXT | 可空，外键 `projects` |
| `status` | TEXT NOT NULL | `upcoming` / `in_progress` / `done` |
| `created_at`, `updated_at` | TEXT NOT NULL | |

索引：`(user_id, meeting_date)`、`(user_id, status)`。

**导师一对一沟通不新建表**，即 `meeting_type = 'one_on_one'`。

### 3.2 `meeting_agenda_items`

| 字段 | 说明 |
| --- | --- |
| `id`, `meeting_id`, `user_id` | |
| `kind` | `my_report` / `carryover_action` / `question_for_advisor` / `literature` |
| `title`, `detail` | |
| `source_ref` | 来源对象引用，格式 `action:<id>` / `library:<id>` / `project:<id>`，可空 |
| `order_index` | INTEGER |
| `done` | INTEGER 0/1 |

### 3.3 `meeting_notes`

| 字段 | 说明 |
| --- | --- |
| `id`, `meeting_id`, `user_id` | |
| `speaker` | **TEXT 自由文本**，不建用户表、不设外键 |
| `content` | TEXT NOT NULL |
| `note_type` | `feedback` / `decision` / `question` / `idea` |
| `source_segment_id` | 可空，指向 `meeting_transcript_segments`，用于从纪要跳回录音位置 |
| `created_at` | |

### 3.4 `meeting_action_items`（闭环核心）

| 字段 | 说明 |
| --- | --- |
| `id`, `meeting_id`, `user_id` | |
| `source_note_id` | 可空 |
| `content` | TEXT NOT NULL |
| `due_date` | TEXT，可空 |
| `status` | `open` / `in_progress` / `done` / `dropped` |
| `owner` | TEXT，默认 `'me'`。v1 UI 不暴露此字段，保留列以避免后续迁移 |
| `task_id` | 可空，转为正式任务后的链接 |
| `project_id` | 可空 |
| `created_at`, `completed_at` | |

索引：`(user_id, status, due_date)`。

### 3.5 `meeting_transcript_segments`

| 字段 | 说明 |
| --- | --- |
| `id`, `meeting_id`, `user_id` | |
| `segment_index` | INTEGER，分片序号 |
| `start_ms`, `end_ms` | INTEGER，相对录音起点 |
| `text` | TEXT |
| `speaker` | TEXT 可空，手动标注 |
| `status` | `pending` / `transcribing` / `done` / `failed` |
| `error` | TEXT 可空 |
| `created_at`, `updated_at` | |

唯一索引：`(meeting_id, segment_index)`。

**为什么用分片表而非整块文本**：可按时间回放定位、失败可单片重试、支持后续说话人标注。

### 3.6 `meeting_attachments`

| 字段 | 说明 |
| --- | --- |
| `id`, `meeting_id`, `user_id` | |
| `kind` | `recording` / `slides` / `transcript` / `handout` |
| `file_path` | 相对于会议目录的路径 |
| `mime_type`, `size_bytes`, `duration_ms` | |
| `created_at` | |

### 3.7 闭环规则

**新建 meeting 时**，服务端在同一事务内执行：

```sql
SELECT * FROM meeting_action_items
WHERE user_id = ? AND owner = 'me' AND status IN ('open', 'in_progress')
ORDER BY due_date IS NULL, due_date ASC
```

对每条结果插入一行 `meeting_agenda_items(kind='carryover_action', source_ref='action:<id>')`，置于 `order_index` 最前。

---

## 4. API 契约

新增 `server/routes/meetings.js`，挂载于 `/api/research`。所有路由走既有 `authenticateToken` 中间件。

### 4.1 保留 `ResearchSecretaryApi` 接口

`src/features/research-secretary/services/researchSecretaryApi.ts` 中已有接口定义，其注释写明是「等待接入未来 runtime」的 V1 adapter。

**做法**：保留该接口的形状，新增 `createHttpResearchSecretaryApi()` 实现，调用真实 HTTP 端点；`createFixtureResearchSecretaryApi()` 保留但仅供测试使用，不在生产路径引用。

这一层不是新造的抽象，是复用既有的缝。

### 4.2 端点

```
GET    /api/research/meetings?from=&to=&status=
POST   /api/research/meetings                    建会，事务性带入 carryover
GET    /api/research/meetings/:id                含 agenda + notes + actions + segments 摘要
PATCH  /api/research/meetings/:id
DELETE /api/research/meetings/:id

POST   /api/research/meetings/:id/agenda
PATCH  /api/research/agenda/:id
DELETE /api/research/agenda/:id

POST   /api/research/meetings/:id/notes
PATCH  /api/research/notes/:id
POST   /api/research/notes/:id/promote           纪要行 → action item（事务）

POST   /api/research/meetings/:id/actions
PATCH  /api/research/actions/:id
POST   /api/research/actions/:id/promote-task    → 正式任务（事务）
GET    /api/research/actions/open                首页卡片数据源

POST   /api/research/meetings/:id/recording/start
POST   /api/research/meetings/:id/recording/chunk 上传单个分片
POST   /api/research/meetings/:id/recording/stop
GET    /api/research/meetings/:id/transcript      含每片 status
POST   /api/research/transcript/:segmentId/retry
PATCH  /api/research/transcript/:segmentId        改 text 或 speaker

POST   /api/research/meetings/:id/summarize       AI：转写 → 纪要草稿，只回不写
```

### 4.3 事务要求

以下三个操作必须在单个 sqlite 事务内完成，任一步失败整体回滚：

| 操作 | 事务内容 |
| --- | --- |
| `POST /meetings` | 建 meeting + 批量插入 carryover agenda items |
| `POST /notes/:id/promote` | 建 action item + 更新 note 状态 + 写 `project_activity_events` |
| `POST /actions/:id/promote-task` | 建 task + 回填 `action_items.task_id` + 写 `project_activity_events` |

### 4.4 校验

服务端逐项校验：日期格式（ISO 8601）、枚举取值、文本长度上限、**未知字段一律拒绝**（不静默忽略）。

---

## 5. 录音转写管线

### 5.1 现有链路不可复用

`server/index.js:5412` 的 `POST /api/transcribe` 存在三处阻断性问题：

1. `formData.append('language', 'en')` **写死英文** —— 中文组会转写结果为音译乱码。
2. `multer.memoryStorage()` 整个音频进内存；Whisper API 单文件上限 25MB ≈ 25 分钟 webm。组会 1–2 小时必然失败。
3. 一次性请求，无分片、无进度、无断点续传。

`src/components/MicButton.jsx` 使用浏览器 `SpeechRecognition`（非 `MediaRecorder`）：在 Electron 打包版中依赖 Google 云端服务，通常直接报 `network` 错误；且**不产生音频文件**，无法回听、无法留证。

**结论**：新建管线。仅复用 `/api/transcribe` 的 OpenAI 凭据读取方式（`process.env.OPENAI_API_KEY`）。现有 `/api/transcribe`、`MicButton`、`src/utils/whisper.js` 保持不动，继续服务聊天输入场景。

### 5.2 采集

渲染进程使用 `MediaRecorder`：

- 格式 `audio/webm;codecs=opus`
- `start(30_000)` —— 30 秒 timeslice
- 每个 `dataavailable` 分片立即 `POST /recording/chunk` 落盘，**不在内存累积**

收益：长会不占内存；应用崩溃只丢最后 30 秒；天然支持边录边转。

### 5.3 转写

服务端维护一个**串行队列**（单人单机，无需并发）：

- 每片独立调 Whisper API
- `language` 从应用语言设置读取，默认 `zh`
- 单片失败标记 `status='failed'` 并记录 `error`，**不阻塞后续分片**，支持单片重试
- 分片进度通过既有 SSE / 轮询通道推给前端

### 5.4 分片边界处理

固定分片会在词中间切断。v1 方案：**前后各保留 5 秒 overlap，转写后按重叠区文本做去重拼接**。

不做静音检测切分（VAD）——引入依赖且对 v1 收益有限。

### 5.5 说话人

**v1 不做自动分离。** Whisper API 不提供 diarization；本地 pyannote 需要 Python 运行时 + 模型权重 + GPU 调优，成本比手动标注高一个数量级。

替代方案：转写行**手动一键打标签**。UI 提供快捷标签（我 / 导师 / 自定义），点击即写入 `segment.speaker`。单人组会场景说话人通常不超过 5 个，此方案实际体验优于不准的自动分离。

### 5.6 隐私（需用户确认）

**组会内容包含未发表数据，本方案会将音频上传至 OpenAI。**

实现要求：

- 设置项 `meetingTranscription.provider`，v1 仅 `openai` 一个取值，但**代码结构预留** `local` 分支
- 首次开启录音时显示一次性明确告知，用户确认后记录，不再重复弹出
- 若隐私评审否决云端方案，v1 改为本地 whisper.cpp，**工作量 +1~2 周**，需重新排期

---

## 6. 提醒

### 6.1 实现

一个 **in-process scheduler**，应用启动时装载，每 60 秒 tick 查询 sqlite：

| 触发源 | 时机 |
| --- | --- |
| `meetings.meeting_date` | 提前 1 天、提前 1 小时 |
| `meeting_action_items.due_date` | 当天 09:00、逾期后每日一次 |

投递：Electron `Notification` + 应用内通知中心（红点 + 列表）。

### 6.2 明确不引入

不引入 cron 库、不引入任务队列、不引入 qm 的 `cron-store` / `job-queue` / `scheduler`。单人单机场景下 `setInterval` + sqlite 查询完全够用，引入调度基础设施是纯粹的成本。

已发送的提醒需去重（记录 `last_notified_at`），避免应用重启后重复通知。

---

## 7. 前端

### 7.1 `MeetingCenter.tsx` 按状态切三态

改造 `src/features/research-secretary/meetings/MeetingCenter.tsx`，**不新建页面**。

**会前（upcoming）**
- 顶部固定「上次未完成 N 项」区，来自 `kind='carryover_action'` 的 agenda items，可勾选/编辑/删除
- 下方议程编辑器：拖拽排序，按 `kind` 分组

**会中（in_progress）**
- 左右分栏：左侧议程勾选，右侧实时记录
- 右侧上方：录音控制（开始/暂停/停止）+ 分片转写进度条
- 右侧下方：转写行流式追加，每行可点击标 speaker、标 `note_type`、一键「转 action」
- 手动输入与转写行混排，来源不同但结构一致

**会后（done）**
- 转写全文只读，支持按 `start_ms` 点击回放
- 「生成纪要草稿」按钮 → 调 `/summarize` → 候选 action items 列表，**勾选后才落库**
- action items 看板：状态流转 + 「转任务」

### 7.2 Dashboard 卡片接真数据

| 组件 | 数据源 |
| --- | --- |
| `dashboard/MeetingPrepCard.tsx` | 下次组会倒计时 + 我要讲的条目 + 未完成 carryover 数 |
| `dashboard/AdvisorActionsCard.tsx` | `note_type='feedback'` 且来自 `meeting_type='one_on_one'` 或 `group` 的导师意见 |

### 7.3 其余卡片处理

`LiteratureUpdatesCard` / `SubmissionStatusCard` / `RecentArtifactsCard` / `AgentRunsCard` / `ProjectProgressCard` / `DeadlineCard` / `ResearchAlertsCard`：

**删除 fixtures 引用，改为真实空状态 + 明确的下一步入口**（例如「导入文献」「新建投稿」）。不显示假数据。

`fixtures/workbenchFixtures.ts` 移入测试目录，生产代码不再引用。

---

## 8. 改动点清单

### 新增

```
server/routes/meetings.js
server/services/meetingTranscription.js       分片队列 + Whisper 调用
server/services/meetingReminders.js           in-process scheduler
src/features/research-secretary/meetings/MeetingRecorder.tsx
src/features/research-secretary/meetings/TranscriptPane.tsx
src/features/research-secretary/meetings/ActionItemBoard.tsx
src/features/research-secretary/services/httpResearchSecretaryApi.ts
```

### 修改

| 文件 | 改动 |
| --- | --- |
| `server/database/init.sql` | 新增 6 张表 DDL |
| `server/database/db.js` | 新增 `migrateMeetingLoopV1()` |
| `server/index.js` | 挂载 `/api/research` 路由；启动时装载 reminders |
| `src/features/research-secretary/meetings/MeetingCenter.tsx` | 三态改造 |
| `src/features/research-secretary/domain/types.ts` | 补 meeting 相关类型 |
| `src/features/research-secretary/services/researchSecretaryApi.ts` | 生产路径切到 HTTP 实现 |
| `src/features/research-secretary/dashboard/*.tsx` | 接真数据或改空状态 |
| `src/components/main-content/view/MainContent.tsx:454` | 传入真实 api 实例 |
| Electron 主进程 | 注册 `Notification` 通道 |

### 不动

`server/index.js:5412` 的 `/api/transcribe`、`src/components/MicButton.jsx`、`src/utils/whisper.js` —— 继续服务聊天输入场景。

---

## 9. 验收标准

**闭环**
- [ ] 新建组会时，上次未完成的 action items 自动出现在议程顶部
- [ ] 纪要行可一键转 action item，事务完整（失败不留半条记录）
- [ ] action item 可转为正式任务并在任务列表中可见，双向链接保留
- [ ] 关闭应用重启后，所有数据仍在

**录音转写**
- [ ] 90 分钟中文录音可完整转写，不因体积失败
- [ ] 转写语言为中文，非音译
- [ ] 单片失败不影响其他分片，可单独重试
- [ ] 录音中途关闭应用，已上传分片不丢失
- [ ] 转写行可点击定位到录音对应时间点

**AI 边界**
- [ ] `/summarize` 只返回草稿，未经用户确认不产生任何数据库写入

**提醒**
- [ ] 会前 1 天与 1 小时各触发一次桌面通知，不重复
- [ ] action item 到期日当天触发，逾期每日一次
- [ ] 应用重启不导致重复通知

**空状态**
- [ ] 生产界面无任何 fixtures 假数据
- [ ] 每个空卡片都有可点击的下一步入口

---

## 10. 风险与取舍

| 风险 | 处理 |
| --- | --- |
| 音频上传 OpenAI 涉及未发表数据 | §5.6，需用户明确确认；否则改本地转写，+1~2 周 |
| 分片 overlap 去重可能残留重复词 | 可接受；转写行可编辑。若实测不佳再考虑 VAD |
| Whisper 中文对医学术语识别率有限 | v1 接受；转写行可编辑。后续可加术语提示词（Whisper `prompt` 参数） |
| 无自动说话人分离 | 有意取舍，见 §5.5 |
| 应用未启动则无提醒 | v1 明确不做，见 §2.2 |
| better-sqlite3 单机存储，无多设备同步 | v1 明确不做。多设备是引入 qm 的真正理由，留待 v2 评估 |

---

## 11. 后续版本（不在本 spec 范围）

- **v2**：文献精读 → 证据表（PDF 页码锚定笔记、PICO/纳排/结局结构化抽取、Zotero 同步）
- **v3**：组会汇报 PPT 生成（需引入 pptxgenjs 或等价方案，当前仓库只有 `docx`）
- **v4**：投稿全流程 + 学术日程源（投稿 DDL、会议摘要 DDL、基金申报、伦理年审、开题/中期/答辩）
- **若要做课题组多人版**：届时替换提醒/长任务/权限的实现，qm 的 principal + ACL + queue 成为候选
