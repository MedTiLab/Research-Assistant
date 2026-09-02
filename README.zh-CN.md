# MedHelp

MedHelp 是一个面向医学研究与分析场景的全栈工作区，支持对话驱动执行、研究/项目管理、证据与产物追踪以及多 Agent 工作流。

## 功能概览

- 在同一界面中集成 Chat、Agent 会话、文件浏览、Git、任务和项目看板
- 提供循证证据摄取、方案设计、研究实施、结果汇报与传播等结构化临床研究目录（对应 Survey、Ideation、Experiment、Publication、Promotion 阶段）
- 支持 Claude Code、Codex 等多种执行后端
- 提供适配桌面端和移动端的响应式 Web UI

## 快速开始

以下命令仅供有源码仓库权限的开发者使用。远程 Linux 服务器交付安装不需要 GitHub 权限，请直接使用下方链接中的正式安装包流程。

```bash
git clone git@github.com:MedTiLab/Research-Assistant.git
cd Research-Assistant
npm install
npm run dev
```

启动后，根据 Vite 输出的本地地址在浏览器中打开即可。

## 构建

```bash
npm run build
npm run server
```

后端主接口保持为 `/api/med-library`、`/api/concepts`、`/api/monitor`。

远程 Linux 服务器的生产部署、Claude/Codex 版本匹配、systemd/Nginx 配置和自动升级要求，请参见 [远程服务器安装与升级清单](docs/remote-server-installation.zh-CN.md)。

## 桌面端打包

可以通过 Electron Builder 将应用打包为桌面安装包。

```bash
# 本地启动桌面壳
npm run desktop:start

# 在 macOS 上构建 DMG
npm run desktop:dist:mac

# 在 Windows 上构建 EXE 安装包
npm run desktop:dist:win
```

产物会输出到 `release/` 目录。

## 兼容策略

- 对外产品名统一为 `MedHelp`，CLI 命令为 `medhelp`。
- 工作区根目录解析顺序为“配置 > 环境变量 > ~/medhelp_workspace”。
- 桌面端启动时会执行单实例保护、后端健康检查、窗口状态持久化，以及共享数据路径兼容处理。

## 说明

- 该分支已主动移除旧项目品牌、社群链接、二维码和展示性资源。
- 为了兼容历史数据与旧流程，少量内部标识可能仍然保留。

## 许可

请参见 `LICENSE` 与 `NOTICE`。
