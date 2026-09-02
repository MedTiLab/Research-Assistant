import { canonicalAgentToolName } from '../../../../../shared/agentRuntimeEvents.js';
import { toolEditChanges, toolResultValue, toolSearchFiles, toolTodoItems } from '../../../../../shared/agentToolPresentation.js';
import { piCallIdentity, piToolConfig } from './piToolConfigs';

/**
 * Centralized tool configuration registry
 * Defines display behavior for all tool types 
 */

export interface ToolDisplayConfig {
  input: {
    type: 'one-line' | 'collapsible' | 'hidden';
    // One-line config
    icon?: string;
    label?: string;
    getValue?: (input: any) => string;
    getSecondary?: (input: any) => string | undefined;
    action?: 'copy' | 'open-file' | 'jump-to-results' | 'none';
    style?: string;
    wrapText?: boolean;
    colorScheme?: {
      primary?: string;
      secondary?: string;
      background?: string;
      border?: string;
      icon?: string;
    };
    // Collapsible config
    title?: string | ((input: any) => string);
    defaultOpen?: boolean;
    contentType?: 'diff' | 'markdown' | 'file-list' | 'todo-list' | 'text' | 'task' | 'question-answer';
    getContentProps?: (input: any, helpers?: any) => any;
    actionButton?: 'file-button' | 'none';
  };
  result?: {
    hidden?: boolean;
    hideOnSuccess?: boolean;
    type?: 'one-line' | 'collapsible' | 'special';
    title?: string | ((result: any) => string);
    defaultOpen?: boolean;
    // Special result handlers
    contentType?: 'markdown' | 'file-list' | 'todo-list' | 'text' | 'success-message' | 'task' | 'question-answer' | 'pi-result';
    getMessage?: (result: any) => string;
    getContentProps?: (result: any) => any;
  };
}

function formatActivateSkillResult(content: unknown): string {
  const raw = String(content || '').trim();
  if (!raw) return 'Skill activated.';

  const lines = raw.split('\n');
  const treeStart = lines.findIndex((line) => /^(\/|~\/|[A-Za-z]:[\\/])/.test(line.trim()));
  if (treeStart === -1) return raw;

  const beforeTree = lines.slice(0, treeStart).join('\n').trim();
  const treeSection = lines.slice(treeStart).join('\n').trim();

  return `${beforeTree}\n\n\`\`\`text\n${treeSection}\n\`\`\``.trim();
}

function parseJsonSafe(input: unknown): any | null {
  if (typeof input !== 'string') return null;
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

function parseLsResultPayload(result: any): {
  directory: string;
  total: number;
  truncated: boolean;
  summary: string;
  files: string[];
  items: Array<{ name: string; path: string; isDirectory: boolean }>;
} | null {
  const raw = result?.content ?? result;
  const parsed = typeof raw === 'object' && raw !== null ? raw : parseJsonSafe(String(raw || ''));
  if (!parsed || typeof parsed !== 'object') return null;

  const directory = typeof parsed.directory === 'string' ? parsed.directory : '.';
  const summary = typeof parsed.summary === 'string' ? parsed.summary : '';
  const truncated = Boolean(parsed.truncated);
  const total = typeof parsed.total === 'number' ? parsed.total : 0;
  const files = Array.isArray(parsed.files)
    ? parsed.files.filter((f: unknown) => typeof f === 'string')
    : [];

  let items: Array<{ name: string; path: string; isDirectory: boolean }> = [];
  if (Array.isArray(parsed.items)) {
    items = parsed.items
      .map((item: any) => ({
        name: typeof item?.name === 'string' ? item.name : '',
        path: typeof item?.path === 'string' ? item.path : '',
        isDirectory: Boolean(item?.isDirectory)
      }))
      .filter((item: { name: string; path: string; isDirectory: boolean }) => item.path);
  }

  if (items.length === 0 && files.length > 0) {
    items = files.map((filePath: string) => {
      const normalized = filePath.replace(/\\/g, '/');
      const isDirectory = normalized.endsWith('/');
      const clean = isDirectory ? normalized.slice(0, -1) : normalized;
      const parts = clean.split('/');
      return {
        name: parts[parts.length - 1] || clean,
        path: normalized,
        isDirectory
      };
    });
  }

  return { directory, total, truncated, summary, files, items };
}

function formatLsResultAsMarkdown(result: any): string {
  const payload = parseLsResultPayload(result);
  if (!payload) {
    const raw = String(result?.content || result || '').trim();
    return raw || 'No directory entries returned.';
  }

  const sortedItems = [...payload.items].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) {
      return a.isDirectory ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  const visibleCount = sortedItems.length;
  const dirCount = sortedItems.filter((item) => item.isDirectory).length;
  const fileCount = visibleCount - dirCount;
  const treeHeader = payload.directory === '.' ? './' : `${payload.directory.replace(/\/+$/, '')}/`;
  const treeLines = [treeHeader];

  sortedItems.forEach((item, index) => {
    const prefix = index === visibleCount - 1 ? '└── ' : '├── ';
    treeLines.push(`${prefix}${item.name}${item.isDirectory ? '/' : ''}`);
  });

  if (visibleCount === 0) {
    treeLines.push('└── (empty)');
  }

  const lines = [
    `**Path:** \`${payload.directory}\``,
    `**Entries:** ${visibleCount}${payload.total > visibleCount ? ` (showing first ${visibleCount} of ${payload.total})` : ''}`,
    `**Breakdown:** ${dirCount} dirs, ${fileCount} files`,
    '',
    '```text',
    treeLines.join('\n'),
    '```'
  ];

  if (payload.truncated) {
    lines.push('', '_Results truncated to keep the panel responsive._');
  }

  if (payload.summary && !/listed\s+\d+\s+items?/i.test(payload.summary)) {
    lines.push('', `**Tool output:** ${payload.summary.trim()}`);
  }

  return lines.join('\n');
}

function getShellToolTitle(input: any): string {
  const description = typeof input?.description === 'string'
    ? input.description.trim()
    : '';
  const command = typeof input === 'string'
    ? input
    : (typeof input?.command === 'string' ? input.command : input?.cmd);
  const commandSummary = typeof command === 'string'
    ? command.replace(/\s+/g, ' ').trim()
    : '';

  return description || commandSummary || 'Shell command';
}

const SHELL_TOOL_CONFIG: ToolDisplayConfig = {
  input: {
    type: 'collapsible',
    title: getShellToolTitle,
    contentType: 'text',
    getContentProps: (input) => ({
      content: typeof input === 'string' ? input : input?.command || input?.cmd || '',
      format: 'code'
    })
  },
  result: {
    type: 'collapsible',
    title: (result) => result?.streaming ? 'Running · live output' : result?.isError ? 'Command failed' : 'Command output',
    contentType: 'text',
    getContentProps: (result) => {
      const value = toolResultValue(result);
      return { content: (typeof value === 'string' ? value : JSON.stringify(value, null, 2)) || '(no output)', format: 'code' };
    }
  }
};

const TERMINAL_SESSION_CONFIG: ToolDisplayConfig = {
  input: { type: 'collapsible', title: (input) => input.title || input.command || `Terminal ${input.terminal_id || ''}`, contentType: 'text', getContentProps: (input) => ({ content: input.command || input.input || input.terminal_id || '', format: 'code' }) },
  result: { type: 'collapsible', defaultOpen: true, title: (result) => { const data = parseJsonSafe(result.content); return data ? `Terminal · ${data.status || ''} · ${data.terminal_id || data.id || ''}` : 'Terminal result'; }, contentType: 'text', getContentProps: (result) => { const data = parseJsonSafe(result.content); return { content: data ? `${data.output || '(no new output)'}${data.truncated ? '\n[Earlier output truncated]' : ''}` : String(result.content || ''), format: 'code' }; } },
};
const PLAN_CONFIG: ToolDisplayConfig = {
  input: { type: 'collapsible', defaultOpen: true, title: (input) => input.title || 'Plan', contentType: 'markdown', getContentProps: (input) => ({ content: input.plan || '' }) },
  result: { type: 'collapsible', title: 'Plan', contentType: 'markdown', getContentProps: (result) => ({ content: parseJsonSafe(result.content)?.plan || result.content || '' }) },
};

export const TOOL_CONFIGS: Record<string, ToolDisplayConfig> = {
  BrowserOpen: piToolConfig('browser', '浏览器', (input) => input.url || ''),
  BrowserShow: piToolConfig('browser', '内置浏览器', (input) => input.url || ''),
  BrowserSnapshot: piToolConfig('browser', '页面快照', (input) => input.page_id || ''),
  BrowserAction: piToolConfig('browser', '浏览器操作', (input) => input.action === 'close' ? `关闭 ${input.page_id || ''}` : `${input.action || ''} · 元素 ${input.element ?? ''} · ${input.page_id || ''}`),
  IntegrationCall: piToolConfig('call', 'MCP', piCallIdentity),
  ToolCall: piToolConfig('call', '工具调用', piCallIdentity),
  AutomationCreate: piToolConfig('automation', '创建自动化', (input) => input.title || ''),
  AutomationList: piToolConfig('automation', '自动化列表', () => '项目排程'),
  AutomationUpdate: piToolConfig('automation', '更新自动化', (input) => `${input.automation_id || ''} · ${input.status || ''}`),
  IntegrationList: piToolConfig('integrations', '集成列表', () => '连接与授权状态'),
  IntegrationTools: piToolConfig('tools', '集成工具', (input) => input.integration_id || ''),
  McpReconnect: piToolConfig('tools', '重新连接', (input) => input.integration_id || ''),
  McpAuthorize: piToolConfig('authorization', '集成授权', (input) => input.integration_id || ''),
  WebFetch: piToolConfig('web', '网页', (input) => input.url || ''),
  Remember: piToolConfig('memory', '保存记忆', (input) => `${input.scope || 'project'} · ${input.content || ''}`),
  MemoryRetrieve: piToolConfig('memory', '检索记忆', (input) => input.query || '项目与用户记忆'),
  TerminalList: piToolConfig('terminals', '终端列表', () => '会话终端状态'),
  ToolSearch: piToolConfig('tools', '查找工具', (input) => input.query || '可用工具'),
  ToolDescribe: piToolConfig('schema', '加载工具', (input) => input.name || ''),
  SystemInfo: piToolConfig('text', '系统信息', () => '运行环境'),
  // ============================================================================
  // COMMAND TOOLS
  // ============================================================================

  // Claude/Codex integrations normally normalize shell calls to Bash, while
  // some compatible providers keep the original tool name. Render both with
  // the same compact, click-to-expand presentation.
  Bash: SHELL_TOOL_CONFIG,
  bash: SHELL_TOOL_CONFIG,
  run_shell_command: SHELL_TOOL_CONFIG,
  TerminalOpen: TERMINAL_SESSION_CONFIG,
  TerminalRead: TERMINAL_SESSION_CONFIG,
  TerminalWrite: TERMINAL_SESSION_CONFIG,
  TerminalClose: TERMINAL_SESSION_CONFIG,
  PlanUpdate: PLAN_CONFIG,
  PlanRead: PLAN_CONFIG,
  ArtifactPublish: {
    input: { type: 'one-line', label: 'Artifact', getValue: (input) => input.path || '', action: 'open-file' },
    result: { type: 'collapsible', title: 'Published artifact', contentType: 'file-list', getContentProps: (result) => ({ files: [parseJsonSafe(result.content)?.artifact?.path].filter(Boolean) }) },
  },
  MediaGenerate: {
    input: { type: 'one-line', label: 'Media', getValue: (input) => `${input.integration_id || ''} · ${input.tool || ''}`, action: 'none' },
    result: { type: 'collapsible', defaultOpen: true, title: 'Generated media', contentType: 'markdown', getContentProps: (result) => {
      const data = parseJsonSafe(result.content);
      if (!data) return { content: String(result.content || '') };
      const files = (data.artifacts || []).filter((item: any) => typeof item.path === 'string').map((item: any) => `[${item.path}](${encodeURI(item.path)})`);
      const remote = (data.resources || []).filter((item: any) => /^https?:\/\//.test(item.uri || '')).map((item: any) => `[${String(item.name || 'Media').replace(/[\[\]]/g, '')}](${encodeURI(item.uri)})`);
      return { content: [data.text || '', ...files, ...remote].join('\n\n') };
    } },
  },

  WebSearch: {
    input: {
      type: 'one-line',
      label: 'Web Search',
      getValue: (input) => input.command || input.query || '',
      action: 'none',
      colorScheme: {
        primary: 'text-blue-500 dark:text-blue-400',
        secondary: 'text-gray-400',
        background: '',
        border: 'border-blue-400 dark:border-blue-500',
        icon: 'text-blue-500 dark:text-blue-400'
      }
    }
  },

  activate_skill: {
    input: {
      type: 'one-line',
      label: 'Activate Skill',
      getValue: (input) => input.name || input.skill || 'skill',
      action: 'none',
      colorScheme: {
        primary: 'text-indigo-600 dark:text-indigo-300',
        border: 'border-indigo-400 dark:border-indigo-500',
        icon: 'text-indigo-500 dark:text-indigo-400'
      }
    },
    result: {
      type: 'collapsible',
      defaultOpen: true,
      title: 'Skill activation details',
      contentType: 'markdown',
      getContentProps: (result) => ({
        content: formatActivateSkillResult(result?.content || result)
      })
    }
  },

  // ============================================================================
  // FILE OPERATION TOOLS
  // ============================================================================

  Read: {
    input: {
      type: 'one-line',
      label: 'Read',
      getValue: (input) => input.file_path || input.path || '',
      action: 'open-file',
      colorScheme: {
        primary: 'text-gray-700 dark:text-gray-300',
        background: '',
        border: 'border-gray-300 dark:border-gray-600',
        icon: 'text-gray-500 dark:text-gray-400'
      }
    },
    result: {
      hidden: true
    }
  },

  Edit: {
    input: {
      type: 'collapsible',
      title: (input) => {
        const filePath = input.file_path || input.path || '';
        const filename = filePath?.split('/').pop() || filePath || 'file';
        return `${filename}`;
      },
      defaultOpen: false,
      contentType: 'diff',
      actionButton: 'none',
      getContentProps: (input) => ({
        ...toolEditChanges(input)[0],
        changes: toolEditChanges(input),
        badge: 'Edit',
        badgeColor: 'gray'
      })
    },
    result: {
      hideOnSuccess: true
    }
  },

  Write: {
    input: {
      type: 'collapsible',
      title: (input) => {
        const filePath = input.file_path || input.path || '';
        const filename = filePath?.split('/').pop() || filePath || 'file';
        return `${filename}`;
      },
      defaultOpen: false,
      contentType: 'diff',
      actionButton: 'none',
      getContentProps: (input) => ({
        oldContent: '',
        newContent: input.content,
        filePath: input.file_path || input.path,
        badge: 'New',
        badgeColor: 'green'
      })
    },
    result: {
      hideOnSuccess: true
    }
  },

  ApplyPatch: {
    input: {
      type: 'collapsible',
      title: (input) => {
        const filePath = input.file_path || input.path || '';
        const filename = filePath?.split('/').pop() || filePath || 'file';
        return `${filename}`;
      },
      defaultOpen: false,
      contentType: 'diff',
      actionButton: 'none',
      getContentProps: (input) => ({
        oldContent: input.old_string,
        newContent: input.new_string,
        filePath: input.file_path || input.path,
        badge: 'Patch',
        badgeColor: 'gray'
      })
    },
    result: {
      hideOnSuccess: true
    }
  },

  // ============================================================================
  // SEARCH TOOLS
  // ============================================================================

  Grep: {
    input: {
      type: 'one-line',
      label: 'Grep',
      getValue: (input) => input.pattern,
      getSecondary: (input) => input.path ? `in ${input.path}` : undefined,
      action: 'jump-to-results',
      colorScheme: {
        primary: 'text-gray-700 dark:text-gray-300',
        secondary: 'text-gray-500 dark:text-gray-400',
        background: '',
        border: 'border-gray-400 dark:border-gray-500',
        icon: 'text-gray-500 dark:text-gray-400'
      }
    },
    result: {
      type: 'collapsible',
      defaultOpen: false,
      title: (result) => {
        const count = toolSearchFiles(result).length;
        return `Found ${count} ${count === 1 ? 'file' : 'files'}`;
      },
      contentType: 'file-list',
      getContentProps: (result) => {
        return {
          files: toolSearchFiles(result),
          content: toolResultValue(result)
        };
      }
    }
  },

  Glob: {
    input: {
      type: 'one-line',
      label: 'Glob',
      getValue: (input) => input.pattern,
      getSecondary: (input) => input.path ? `in ${input.path}` : undefined,
      action: 'jump-to-results',
      colorScheme: {
        primary: 'text-gray-700 dark:text-gray-300',
        secondary: 'text-gray-500 dark:text-gray-400',
        background: '',
        border: 'border-gray-400 dark:border-gray-500',
        icon: 'text-gray-500 dark:text-gray-400'
      }
    },
    result: {
      type: 'collapsible',
      defaultOpen: false,
      title: (result) => {
        const count = toolSearchFiles(result).length;
        return `Found ${count} ${count === 1 ? 'file' : 'files'}`;
      },
      contentType: 'file-list',
      getContentProps: (result) => {
        return {
          files: toolSearchFiles(result),
          content: toolResultValue(result)
        };
      }
    }
  },

  LS: {
    input: {
      type: 'one-line',
      label: 'LS',
      getValue: (input) => input.dir_path || input.path || '.',
      action: 'none',
      colorScheme: {
        primary: 'text-gray-700 dark:text-gray-300',
        border: 'border-gray-300 dark:border-gray-600',
        icon: 'text-gray-500 dark:text-gray-400'
      }
    },
    result: {
      type: 'collapsible',
      defaultOpen: true,
      title: (result) => {
        const payload = parseLsResultPayload(result);
        const count = payload?.items?.length ?? 0;
        return `Directory listing${count > 0 ? ` (${count})` : ''}`;
      },
      contentType: 'markdown',
      getContentProps: (result) => ({
        content: formatLsResultAsMarkdown(result)
      })
    }
  },

  // ============================================================================
  // TODO TOOLS
  // ============================================================================

  TodoWrite: {
    input: {
      type: 'collapsible',
      title: 'Updating todo list',
      defaultOpen: false,
      contentType: 'todo-list',
      getContentProps: (input) => ({
        todos: input.todos
      })
    },
    result: {
      type: 'collapsible',
      contentType: 'success-message',
      getMessage: () => 'Todo list updated'
    }
  },

  TodoRead: {
    input: {
      type: 'one-line',
      label: 'TodoRead',
      getValue: () => 'reading list',
      action: 'none',
      colorScheme: {
        primary: 'text-gray-500 dark:text-gray-400',
        border: 'border-violet-400 dark:border-violet-500'
      }
    },
    result: {
      type: 'collapsible',
      contentType: 'todo-list',
      getContentProps: (result) => ({ todos: toolTodoItems(result), isResult: true })
    }
  },

  // ============================================================================
  // TASK TOOLS (TaskCreate, TaskUpdate, TaskList, TaskGet)
  // ============================================================================

  TaskCreate: {
    input: {
      type: 'one-line',
      label: 'Task',
      getValue: (input) => input.subject || input.title || 'Creating task',
      getSecondary: (input) => input.status || undefined,
      action: 'none',
      colorScheme: {
        primary: 'text-gray-700 dark:text-gray-300',
        border: 'border-violet-400 dark:border-violet-500',
        icon: 'text-violet-500 dark:text-violet-400'
      }
    },
    result: {
      hideOnSuccess: true
    }
  },

  TaskUpdate: {
    input: {
      type: 'one-line',
      label: 'Task',
      getValue: (input) => {
        const parts = [];
        if (input.taskId || input.task_id) parts.push(`#${input.taskId || input.task_id}`);
        if (input.status) parts.push(input.status);
        if (input.subject || input.title) parts.push(`"${input.subject || input.title}"`);
        return parts.join(' → ') || 'updating';
      },
      action: 'none',
      colorScheme: {
        primary: 'text-gray-700 dark:text-gray-300',
        border: 'border-violet-400 dark:border-violet-500',
        icon: 'text-violet-500 dark:text-violet-400'
      }
    },
    result: {
      hideOnSuccess: true
    }
  },

  TaskList: {
    input: {
      type: 'one-line',
      label: 'Tasks',
      getValue: () => 'listing tasks',
      action: 'none',
      colorScheme: {
        primary: 'text-gray-500 dark:text-gray-400',
        border: 'border-violet-400 dark:border-violet-500',
        icon: 'text-violet-500 dark:text-violet-400'
      }
    },
    result: {
      type: 'collapsible',
      defaultOpen: true,
      title: 'Task list',
      contentType: 'task',
      getContentProps: (result) => ({
        content: toolResultValue(result)
      })
    }
  },

  TaskGet: {
    input: {
      type: 'one-line',
      label: 'Task',
      getValue: (input) => (input.taskId || input.task_id) ? `#${input.taskId || input.task_id}` : 'fetching',
      action: 'none',
      colorScheme: {
        primary: 'text-gray-700 dark:text-gray-300',
        border: 'border-violet-400 dark:border-violet-500',
        icon: 'text-violet-500 dark:text-violet-400'
      }
    },
    result: {
      type: 'collapsible',
      defaultOpen: true,
      title: 'Task details',
      contentType: 'task',
      getContentProps: (result) => ({
        content: toolResultValue(result)
      })
    }
  },

  // ============================================================================
  // SUBAGENT TASK TOOL
  // ============================================================================

  Task: {
    input: {
      type: 'collapsible',
      title: (input) => {
        const subagentType = input.subagent_type || 'Agent';
        const description = input.description || 'Running task';
        return `Subagent / ${subagentType}: ${description}`;
      },
      defaultOpen: false,
      contentType: 'markdown',
      getContentProps: (input) => {
        // If only prompt exists (and required fields), show just the prompt
        // Otherwise show all available fields
        const hasOnlyPrompt = input.prompt &&
          !input.model &&
          !input.resume;

        if (hasOnlyPrompt) {
          return {
            content: input.prompt || ''
          };
        }

        // Format multiple fields
        const parts = [];

        if (input.model) {
          parts.push(`**Model:** ${input.model}`);
        }

        if (input.prompt) {
          parts.push(`**Prompt:**\n${input.prompt}`);
        }

        if (input.resume) {
          parts.push(`**Resuming from:** ${input.resume}`);
        }

        return {
          content: parts.join('\n\n')
        };
      },
      colorScheme: {
        border: 'border-purple-500 dark:border-purple-400',
        icon: 'text-purple-500 dark:text-purple-400'
      }
    },
    result: {
      type: 'collapsible',
      title: 'Subagent result',
      defaultOpen: false,
      contentType: 'markdown',
      getContentProps: (result) => {
        // Handle agent results which may have complex structure
        if (result && result.content) {
          let content = result.content;
          // If content is a JSON string, try to parse it (agent results may arrive serialized)
          if (typeof content === 'string') {
            try {
              const parsed = JSON.parse(content);
              if (Array.isArray(parsed)) {
                content = parsed;
              }
            } catch {
              // Not JSON — use as-is
              return { content };
            }
          }
          // If content is an array (typical for agent responses with multiple text blocks)
          if (Array.isArray(content)) {
            const textContent = content
              .filter((item: any) => item.type === 'text')
              .map((item: any) => item.text)
              .join('\n\n');
            return { content: textContent || 'No response text' };
          }
          return { content: String(content) };
        }
        // Fallback to string representation
        return { content: String(result || 'No response') };
      }
    }
  },

  // ============================================================================
  // INTERACTIVE TOOLS
  // ============================================================================

  AskUserQuestion: {
    input: {
      type: 'collapsible',
      title: (input: any) => {
        const count = input.questions?.length || 0;
        const hasAnswers = input.answers && Object.keys(input.answers).length > 0;
        if (count === 1) {
          const header = input.questions[0]?.header || 'Question';
          return hasAnswers ? `${header} — answered` : header;
        }
        return hasAnswers ? `${count} questions — answered` : `${count} questions`;
      },
      defaultOpen: true,
      contentType: 'question-answer',
      getContentProps: (input: any) => ({
        questions: Array.isArray(input.questions) ? input.questions : [],
        answers: (input.answers && typeof input.answers === 'object') ? input.answers : {}
      }),
    },
    result: {
      hideOnSuccess: true
    }
  },

  // ============================================================================
  // PLAN TOOLS
  // ============================================================================

  exit_plan_mode: {
    input: {
      type: 'collapsible',
      title: 'Implementation plan',
      defaultOpen: true,
      contentType: 'markdown',
      getContentProps: (input) => ({
        content: input.plan?.replace(/\\n/g, '\n') || input.plan
      })
    },
    result: {
      type: 'collapsible',
      contentType: 'markdown',
      getContentProps: (result) => {
        try {
          let parsed = result.content;
          if (typeof parsed === 'string') {
            parsed = JSON.parse(parsed);
          }
          return {
            content: parsed.plan?.replace(/\\n/g, '\n') || parsed.plan
          };
        } catch (e) {
          return { content: '' };
        }
      }
    }
  },

  // Also register as ExitPlanMode (the actual tool name used by Claude)
  ExitPlanMode: {
    input: {
      type: 'collapsible',
      title: 'Implementation plan',
      defaultOpen: true,
      contentType: 'markdown',
      getContentProps: (input) => ({
        content: input.plan?.replace(/\\n/g, '\n') || input.plan
      })
    },
    result: {
      type: 'collapsible',
      contentType: 'markdown',
      getContentProps: (result) => {
        try {
          let parsed = result.content;
          if (typeof parsed === 'string') {
            parsed = JSON.parse(parsed);
          }
          return {
            content: parsed.plan?.replace(/\\n/g, '\n') || parsed.plan
          };
        } catch (e) {
          return { content: '' };
        }
      }
    }
  },

  // ============================================================================
  // DEFAULT FALLBACK
  // ============================================================================

  Default: {
    input: {
      type: 'collapsible',
      title: 'Parameters',
      defaultOpen: false,
      contentType: 'text',
      getContentProps: (input) => ({
        content: typeof input === 'string' ? input : JSON.stringify(input, null, 2),
        format: 'code'
      })
    },
    result: {
      type: 'collapsible',
      contentType: 'text',
      getContentProps: (result) => ({
        content: String(result?.content || ''),
        format: 'plain'
      })
    }
  }
};

/**
 * Get configuration for a tool, with fallback to default
 */
export function getToolConfig(toolName: string): ToolDisplayConfig {
  return TOOL_CONFIGS[canonicalAgentToolName(toolName)] || TOOL_CONFIGS[toolName] || TOOL_CONFIGS.Default;
}

/**
 * Check if a tool result should be hidden
 */
export function shouldHideToolResult(toolName: string, toolResult: any): boolean {
  const config = getToolConfig(toolName);

  if (!config.result) return false;

  const normalizedContent = String(toolResult?.content || '').toLowerCase();
  const isLegacyTaskMasterInstallError =
    config.result.contentType !== 'pi-result' &&
    Boolean(toolResult?.isError) &&
    normalizedContent.includes('taskmaster') &&
    (normalizedContent.includes('not installed') || normalizedContent.includes('not configured'));
  if (isLegacyTaskMasterInstallError) {
    return true;
  }
  if (toolResult?.isError) return false;

  // Always hidden
  if (config.result.hidden) return true;

  // Hide on success only
  if (config.result.hideOnSuccess && toolResult && !toolResult.isError) {
    return true;
  }

  return false;
}
