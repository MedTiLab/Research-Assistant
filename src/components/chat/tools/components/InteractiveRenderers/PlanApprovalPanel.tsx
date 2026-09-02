import React from 'react';
import ReactMarkdown from 'react-markdown';
import type { PermissionPanelProps } from '../../configs/permissionPanelRegistry';

export default function PlanApprovalPanel({ request, onDecision }: PermissionPanelProps) {
  const input = request.input as { title?: string; plan?: string; revision?: number };
  return (
    <section className="rounded-xl border border-indigo-300 bg-indigo-50 p-4 dark:border-indigo-800 dark:bg-indigo-950/30">
      <h3 className="font-semibold">{input?.title || '计划审批'}{input?.revision ? ` · v${input.revision}` : ''}</h3>
      <div className="prose prose-sm dark:prose-invert my-3 max-h-80 overflow-auto"><ReactMarkdown>{input?.plan || '未提供计划正文'}</ReactMarkdown></div>
      <p className="mb-3 text-xs text-muted-foreground">批准后进入 Ask 模式。终端、写文件和外部操作仍需单独确认。</p>
      <div className="flex gap-2">
        <button type="button" disabled={!input?.plan} className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white disabled:opacity-50" onClick={() => onDecision(request.requestId, { allow: true })}>批准计划并继续</button>
        <button type="button" className="rounded border px-3 py-1.5 text-sm" onClick={() => onDecision(request.requestId, { allow: false, message: 'Revise the plan before implementation' })}>退回修改</button>
      </div>
    </section>
  );
}
