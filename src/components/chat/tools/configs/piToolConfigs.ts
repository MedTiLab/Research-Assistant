import { toolResultValue } from '../../../../../shared/agentToolPresentation.js';
import type { ToolDisplayConfig } from './toolConfigs';

export const piText = (value: any): string => typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value, null, 2);
export const piRows = (value: any): any[] => Array.isArray(value) ? value : Array.isArray(value?.tools) ? value.tools : value ? [value] : [];
export const piSchedule = (value: any): string => {
  const date = value?.nextRunAt;
  const next = date && Number.isFinite(Date.parse(date)) ? new Date(date).toLocaleString() : date || '未安排';
  return `下次运行：${next} · ${value?.intervalMinutes ? `每 ${value.intervalMinutes} 分钟` : '仅一次'}`;
};

// tool_call may wrap integration_call; preserve the native input and only derive its label.
export function piCallIdentity(input: any): string {
  const args = input?.integration_id ? input : input?.arguments;
  return args?.integration_id ? `${args.integration_id} · ${args.tool || input?.name || 'tool'}` : input?.name || input?.tool || 'Tool';
}

export function piToolConfig(kind: string, label: string, inputValue: (input: any) => string): ToolDisplayConfig {
  return {
    input: { type: 'one-line', label, getValue: (input) => inputValue(input || {}), action: 'none', wrapText: true },
    result: {
      type: 'collapsible', contentType: 'pi-result',
      title: (result) => {
        const value = toolResultValue(result);
        if (result?.isError) return `${label} · 失败：${piText(value?.error?.message || value?.message || value).slice(0, 180)}`;
        if (kind === 'automation') return Array.isArray(value) ? `自动化 · ${value.length} 项` : `${value?.title || label} · ${value?.status || ''} · ${piSchedule(value)}`;
        if (kind === 'browser' || kind === 'web') return value?.status === 'closed' ? '浏览器 · 已关闭' : value?.url || `${label} · ${value?.status || value?.page_id || '结果'}`;
        if (kind === 'call') return value?.integration_id ? `${value.integration_id} · ${value.tool || '结果'}` : `${label} · 结果`;
        if (kind === 'tools' || kind === 'integrations' || kind === 'terminals') return `${label} · ${piRows(value).length} 项`;
        if (kind === 'schema') return `已加载工具 · ${value?.name || label}`;
        if (kind === 'authorization') return `${label} · ${value?.status || '结果'}`;
        return `${label} · 结果`;
      },
      getContentProps: (result) => ({ kind, data: toolResultValue(result), isError: Boolean(result?.isError) }),
    },
  };
}
