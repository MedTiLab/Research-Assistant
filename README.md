# Research Assistant · 科研助理

## 项目介绍

> 把科研对话、项目文件、文献追踪、组会日常与自动化放进同一个工作台。

Research Assistant 是面向研究生和科研人员的**开源 AI 科研助理**。你可以围绕项目与 AI 协作，整理研究材料、检索文献、记录组会与每日进展，也可以调用科研技能、UKB 小工具和个人应用完成具体任务。

**UKB 分析智能体是科研助理内置的一项免费小工具**，用于辅助 UK Biobank 字段查询、变量提取与后续分析。它是整个科研工作区的一部分。

**源码版本** `0.1.1` · **npm 包** `medhelpsec` · **Agent 运行时** Pi

界面中仍保留部分 MedHelp 名称。另行提供的非开源付费产品，详见 [MedHelp 产品说明](#medhelp-付费产品)。

[功能概览](#功能概览) · [快速开始](#快速开始) · [MedHelp 付费产品](#medhelp-付费产品) · [交流与联系](#联系我们与社群交流)

---

## 联系我们与社群交流

<table>
  <thead>
    <tr>
      <th width="33%" align="center">微信交流群</th>
      <th width="33%" align="center">个人微信 · 产品咨询</th>
      <th width="33%" align="center">QQ 交流群</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td align="center" valign="middle"><a href="public/community/medhelp-wechat-group.png"><img src="public/community/medhelp-wechat-group.png" alt="智能体 MedHelp 微信交流群二维码" height="240" /></a></td>
      <td align="center" valign="middle"><a href="public/community/medhelp-personal-wechat.jpg"><img src="public/community/medhelp-personal-wechat.jpg" alt="个人微信 Pa Gen 二维码" height="240" /></a></td>
      <td align="center" valign="middle"><a href="https://qm.qq.com/q/nHa7cJDwzI"><img src="https://github.com/user-attachments/assets/435e8280-ebfb-4f8c-a65c-ff64b534e70a" alt="Research-Assistant 官方 QQ 群二维码" height="240" /></a></td>
    </tr>
    <tr>
      <td align="center">使用交流 · 问题反馈</td>
      <td align="center">功能咨询 · 收费方案 · 合作</td>
      <td align="center"><a href="https://qm.qq.com/q/nHa7cJDwzI">点击加入官方 QQ 群</a></td>
    </tr>
  </tbody>
</table>

微信群二维码图片标注 **9 月 20 日前有效**；如过期或无法入群，请添加个人微信联系。添加好友时可备注「科研助理 / MedHelp 咨询」。点击微信二维码可查看原图。

**也可通过官网联系客服：** 打开 [MedHelp 官网](https://medtimehelp.com/)，点击页面右侧的「微信咨询」，扫码或使用弹窗中的添加好友入口联系官方客服，继续交流产品功能、使用方式、收费方案及合作事宜。

## MedHelp 付费产品

如果你需要更广泛的医学数据库研究支持，可以了解我们另外一款产品 **MedHelp**。

**付费版官网：[medtimehelp.com](https://medtimehelp.com/)** · 可点击官网右侧「微信咨询」联系官方客服，也可添加上方个人微信咨询。

**MedHelp 是非开源的付费产品，适配 31 个数据库的分析场景**，涵盖 UK Biobank、NHANES、MIMIC、CHARLS、HRS、SHARE、SEER 等数据库。它把变量检索、数据提取、队列构建、统计建模、图表生成和论文写作串联在同一个工作区，贴合医学数据库研究的实际流程。

| 项目 / 工具 | 定位与使用方式 |
| --- | --- |
| Research Assistant 科研助理 | 本仓库开源的科研工作区，支持项目协作与科研日常管理 |
| 内置 UKB 分析小工具 | 科研助理中的一项工具，目前免费开放使用 |
| MedHelp | 另一款非开源付费产品，面向 31 个数据库的分析场景；功能、使用方式和收费方案请联系咨询 |

欢迎大家体验科研助理，交流使用经验、反馈建议，也欢迎把项目分享给有需要的同学、同事和课题组。MedHelp 的产品咨询与合作沟通，可添加上方个人微信，或通过官网右侧「微信咨询」联系客服。

### MedHelp 产品演示

[▶ 观看 MedHelp 演示视频（约 58 秒）](public/videos/medhelp-demo.mp4) · [下载 MP4](https://github.com/MedTiLab/Research-Assistant/raw/refs/heads/main/public/videos/medhelp-demo.mp4)

## 功能概览

### 当前工作台入口

| 界面入口 | 当前功能 |
| --- | --- |
| 今日状态 | 设置今日焦点与目标，使用番茄时钟、工作打卡、日历待办和快速记录 |
| 组会日常 | 新建与查看组会，整理议程、会议记录、纪要和后续行动项 |
| 文献追踪 | 使用关键词或检索式查询 PubMed，将文献导入文献库，并访问 Zotero 文献中心 |
| 每日复盘 | 查看工作与专注时长、习惯和待办，记录当天完成事项、卡点、经验与明日重点 |
| 自动化 | 创建定时任务，管理启用、暂停和归档状态，查看运行记录、报告与错误信息 |
| 技能中心 | 按工作流分类搜索科研技能，上传或导入本地技能，将技能用于 Agent 对话 |
| 我的应用 | 导入 HTML 小应用，或与 Agent 协作创建个人科研应用 |
| 对话记录 | 搜索和查看当前账户已保存的对话内容 |

### 对话与项目工作区

- **项目与文件**：创建或打开研究项目，浏览、预览、编辑项目文件，并把材料加入对话。
- **对话与画布**：在对话模式和画布模式之间切换，查看与继续不同对话分支。
- **科研场景入口**：按日常事务、看新闻、选题与证据、设计与分析、图表与可视化、写作与发表、创建与自动化选择任务模板。
- **技能选择**：将场景提示词放入对话框后，增减本次使用的 Skill，再交给 Agent 执行。
- **模型与工具设置**：配置 Pi 模型服务、API 与 MCP 工具，并按任务选择执行权限。

### 内置 UKB 分析小工具

**UKB 是科研助理内置的一项免费小工具。** 在新对话中选择「设计与分析 → UKB」，即可带入 UKB 任务模板和对应技能，辅助查询 UK Biobank 字段与编码、提取研究变量，并衔接后续分析。

使用真实数据分析时，需要准备自己的可用数据和分析环境。工具免费指工具本身；模型 API、计算资源和数据访问条件取决于实际使用的服务与授权。

## 快速开始

### 1. 准备环境

- Git、npm。
- **Node.js 22.19.0 及以上的 22.x，或 Node.js 24.x**。虽然包的 `engines` 字段仍包含 20.x，当前 Pi 运行时要求至少 22.19.0，完整使用 Agent 请按此要求安装。
- 可用的模型服务和对应凭据，可在应用设置中配置。
- 执行 R / Python 分析时，另外安装相应运行环境与任务所需依赖。

项目使用 `better-sqlite3`、`node-pty` 等原生依赖。安装时如需本机编译，应准备操作系统对应的编译工具。

### 2. 获取源码并安装

```bash
git clone https://github.com/MedTiLab/Research-Assistant.git
cd Research-Assistant
npm install
```

如需自定义端口或数据位置，将 [环境变量模板](.env.example) 复制为 `.env` 后编辑。模板中仍有部分历史名称和兼容配置，当前 Agent 的配置请查看其中的 `PI RUNTIME` 部分。

### 3. 准备 Agent 运行时并启动

```bash
npm run pi-runtime:prepare
npm run dev
```

`pi-runtime:prepare` 会下载项目固定版本的 Pi 依赖，并准备独立运行时。`npm run dev` 会检查原生模块，启动后端和 Vite 开发服务器。

默认前端地址为 [http://localhost:5173](http://localhost:5173)，后端端口为 `3001`。端口被占用时可能自动调整，请以终端输出的地址为准。

### 4. 首次使用

1. 在浏览器打开前端，按页面提示完成账户与初始环境配置。
2. 在设置中配置模型提供方、模型名称、API 地址及密钥。
3. 创建或打开研究项目，添加需要分析的材料，再开始对话。
4. 按需使用文献追踪、科研技能、UKB 小工具、组会日常、每日复盘和自动化功能。

模型调用、语音转写及外部工具需要各自可用的服务配置；安装源码后，应先确认相关服务和本地分析环境已就绪。自动化执行时，承载任务的后端或计算节点需要保持运行。

### 生产运行

```bash
npm run build
npm run server
```

也可以使用 `npm start` 依次构建和启动。浏览器访问后端输出的服务地址，默认端口为 `3001`。`npm run preview` 仅预览前端构建，不包含后端 API。

### 更新源码

```bash
git pull --ff-only
npm install
npm run pi-runtime:prepare
```

更新后重启开发服务；生产运行还需重新执行 `npm run build` 并重启后端。Pi Host 缺失或版本不匹配时，也可重新运行 `npm run pi-runtime:prepare`。

## 开发与配置

### 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动后端与前端开发服务 |
| `npm run pi-runtime:prepare` | 安装并准备独立 Pi 运行时 |
| `npm run build` | 构建前端到 `dist/` |
| `npm run server` | 启动后端 |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm test` | 运行 Vitest 测试 |
| `npm run test:watch` | 监听模式运行 Vitest |

### 主要配置项

| 配置项 | 用途 |
| --- | --- |
| `PORT` / `VITE_PORT` | 后端 / 前端开发端口，默认 `3001` / `5173` |
| `HOST` | 服务监听地址 |
| `MEDHELP_DATA_DIR` | 自定义应用数据目录 |
| `DATABASE_PATH` | 自定义账户数据库文件位置 |
| `MEDHELP_PI_PROVIDER` / `MEDHELP_PI_MODEL` | 服务端默认模型提供方与模型 |
| `MEDHELP_PI_BASE_URL` / `MEDHELP_PI_API_KEY` | 服务端模型 API 地址与密钥 |
| `JWT_SECRET` | 登录令牌签名密钥 |

配置示例见 [.env.example](.env.example)。个人模型也可通过应用设置配置；免费托管模型目录默认关闭，自部署需配置自己的模型服务。

### 技术栈与目录

- **前端**：React 18、TypeScript、Vite、Tailwind CSS。
- **后端**：Node.js、Express、WebSocket、SQLite / better-sqlite3。
- **Agent**：Pi 运行时、科研技能与 MCP 工具。
- **验证工具**：Vitest、Node Test、Playwright。

```text
Research-Assistant/
├── src/
│   ├── features/research-secretary/  # 今日状态、组会日常、复盘与自动化等模块
│   ├── features/mini-apps/           # 个人科研小应用
│   ├── components/                  # 对话、文件、技能、设置等界面
│   └── i18n/                        # 界面语言资源
├── server/
│   ├── pi-runtime/                  # Pi Host、模型配置与工具权限
│   ├── routes/                      # 后端 API
│   └── database/                    # 数据存储与迁移
├── shared/                          # 前后端共享类型与规则
├── skills/                          # 内置科研技能与配套资源
├── scripts/                         # 开发启动、构建与运行时准备
├── public/                          # 图标、截图、二维码与演示视频
└── test/                            # 集成测试与验证脚本
```

## 数据与贡献

应用数据默认保存在用户目录下的 `.medhelpsec`，可用 `MEDHELP_DATA_DIR` 自定义。项目文件与应用运行数据分别管理；备份时请同时考虑研究文件和应用数据目录。

请勿提交 `.env`、模型密钥、账户数据库或私人研究数据。部署到公网前，应配置独立的 `JWT_SECRET` 并检查访问控制。数据库分析请使用自己有权访问的数据。

欢迎通过 [Issues](https://github.com/MedTiLab/Research-Assistant/issues) 反馈问题或功能建议，通过 [Pull Requests](https://github.com/MedTiLab/Research-Assistant/pulls) 贡献改进。报告问题时请附版本、运行环境、复现步骤及去除敏感信息后的日志。

## 许可

本项目包含 GPL-3.0 与 AGPL-3.0 许可范围内的代码。具体版权、上游来源和适用条款请参见 [LICENSE](LICENSE) 与 [NOTICE](NOTICE)。
