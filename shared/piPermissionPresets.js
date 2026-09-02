// Explicit, complete commands only. Adding a preset never grants a command prefix or wildcard.
export const PI_PERMISSION_PRESETS = Object.freeze([
  { id: 'pwd', command: 'pwd', description: '查看当前目录' },
  { id: 'ls', command: 'ls', description: '列出文件' },
  { id: 'ls-details', command: 'ls -la', description: '列出文件详情（含隐藏文件）' },
  { id: 'git-status', command: 'git status', description: '查看工作区状态' },
  { id: 'git-diff', command: 'git diff', description: '查看未暂存的修改' },
  { id: 'git-diff-stat', command: 'git diff --stat', description: '查看修改统计' },
  { id: 'git-log', command: 'git log --oneline -20', description: '查看最近 20 条提交' },
  { id: 'git-branch', command: 'git branch --show-current', description: '查看当前分支' },
].map((preset) => Object.freeze(preset)));
