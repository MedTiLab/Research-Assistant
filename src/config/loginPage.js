export const LOGIN_PAGE_CONTENT = {
  'zh-CN': {
    brand: 'MedHelp®',
    eyebrow: '你的研究生 AI 助理',
    title: '从研究问题到可复现产物的一站式工作台',
    description:
      'MedHelp® 将智能体对话、文献动态、资源库、任务流水线、文件管理和计算资源整合到同一个入口，帮助团队持续推进临床数据研究。',
    highlights: [
      '围绕研究问题组织分析会话、资料和任务',
      '沉淀变量证据、文献追踪和研究产物',
      '衔接本地工作区、Git、终端和多智能体流程',
    ],
    metrics: [
      { value: '5', label: '阶段研究流水线' },
      { value: '1', label: '统一工作区入口' },
      { value: 'AI', label: '辅助证据分析' },
    ],
    form: {
      eyebrow: '账号访问',
      loginDescription: '登录后继续访问你的研究工作区、分析会话和自动化任务。',
      registerDescription: '创建账户后即可配置通知邮箱，并开始管理你的研究工作区。',
      securityNote: '账户用于隔离本机服务中的研究工作区和个人配置。',
      complianceNote: '平台仅提供科研分析工具，不提供、转授权或分发任何第三方数据库原始数据。',
    },
  },
  en: {
    brand: 'MedHelp®',
    eyebrow: 'Your graduate AI assistant',
    title: 'One workspace from research question to reproducible output',
    description:
      'MedHelp® brings agent chat, evidence monitoring, the resource library, task pipelines, files, and compute into one focused entry point for clinical data research.',
    highlights: [
      'Organize analysis sessions, materials, and tasks around each study question',
      'Capture variable evidence, literature traces, and research outputs',
      'Connect local workspaces, Git, shell access, and multi-agent workflows',
    ],
    metrics: [
      { value: '5', label: 'stage study pipeline' },
      { value: '1', label: 'unified workspace entry' },
      { value: 'AI', label: 'evidence assistance' },
    ],
    form: {
      eyebrow: 'Account Access',
      loginDescription: 'Sign in to continue your workspaces, analysis sessions, and automation tasks.',
      registerDescription: 'Create an account to configure notifications and start managing research workspaces.',
      securityNote: 'Accounts separate research workspaces and personal settings inside this local service.',
      complianceNote: 'The platform provides research tools only; it does not provide, sublicense, or distribute third-party raw datasets.',
    },
  },
};

export function getLoginPageContent(language = 'zh-CN') {
  const normalized = language.toLowerCase();
  return normalized.startsWith('zh') ? LOGIN_PAGE_CONTENT['zh-CN'] : LOGIN_PAGE_CONTENT.en;
}
