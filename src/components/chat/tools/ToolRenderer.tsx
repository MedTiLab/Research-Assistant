import React, { memo, useMemo, useCallback } from 'react';
import { getToolConfig } from './configs/toolConfigs';
import { OneLineDisplay, CollapsibleDisplay, DiffViewer, MarkdownContent, FileListContent, TodoListContent, TaskListContent, TextContent, QuestionAnswerContent, SubagentContainer } from './components';
import type { Project } from '../../../types/app';
import type { SubagentState } from '../types/types';
import { normalizeToolPresentationInput } from '../../../../shared/agentToolPresentation.js';
import { formatProjectRelativePaths, getProjectRootPath, toProjectRelativeDisplayPath } from '../utils/projectPathDisplay';
import { PiToolContent } from './components/ContentRenderers/PiToolContent';

type DiffLine = {
  type: string;
  content: string;
  lineNum: number;
};

interface ToolRendererProps {
  toolName: string;
  toolInput: any;
  toolResult?: any;
  toolId?: string;
  mode: 'input' | 'result';
  onFileOpen?: (filePath: string, diffInfo?: any) => void;
  createDiff?: (oldStr: string, newStr: string) => DiffLine[];
  selectedProject?: Project | null;
  autoExpandTools?: boolean;
  showRawParameters?: boolean;
  rawToolInput?: string;
  isSubagentContainer?: boolean;
  subagentState?: SubagentState;
}

function getToolCategory(toolName: string): string {
  if (['Edit', 'Write', 'ApplyPatch', 'replace', 'write_file'].includes(toolName)) return 'edit';
  if (['Grep', 'Glob', 'grep_search', 'glob'].includes(toolName)) return 'search';
  if (['Bash', 'bash', 'run_shell_command'].includes(toolName)) return 'bash';
  if (['TerminalOpen', 'TerminalRead', 'TerminalWrite', 'TerminalClose', 'TerminalList'].includes(toolName)) return 'bash';
  if (['TodoWrite', 'TodoRead', 'write_todos'].includes(toolName)) return 'todo';
  if (['TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet'].includes(toolName)) return 'task';
  if (toolName === 'Task') return 'agent';  // Subagent task
  if (['exit_plan_mode', 'ExitPlanMode', 'enter_plan_mode', 'PlanUpdate', 'PlanRead'].includes(toolName)) return 'plan';
  if (toolName === 'AskUserQuestion') return 'question';
  return 'default';
}

/**
 * Main tool renderer router
 * Routes to OneLineDisplay or CollapsibleDisplay based on tool config
 */
export const ToolRenderer: React.FC<ToolRendererProps> = memo(({
  toolName,
  toolInput,
  toolResult,
  toolId,
  mode,
  onFileOpen,
  createDiff,
  selectedProject,
  autoExpandTools = false,
  showRawParameters = false,
  rawToolInput,
  isSubagentContainer,
  subagentState
}) => {
  const projectRoot = getProjectRootPath(selectedProject);

  const config = getToolConfig(toolName);
  const displayConfig: any = mode === 'input' ? config.input : config.result;

  const parsedData = useMemo(() => {
    try {
      const rawData = mode === 'input' ? normalizeToolPresentationInput(toolName, toolInput) : toolResult;
      return typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
    } catch {
      return mode === 'input' ? toolInput : toolResult;
    }
  }, [mode, toolName, toolInput, toolResult]);

  const handleAction = useCallback(() => {
    if (displayConfig?.action === 'open-file' && onFileOpen) {
      const value = displayConfig.getValue?.(parsedData) || '';
      onFileOpen(value);
    }
  }, [displayConfig, parsedData, onFileOpen]);

  if (isSubagentContainer && subagentState) {
    return mode === 'result' ? null : (
      <SubagentContainer toolInput={toolInput} toolResult={toolResult} subagentState={subagentState} projectRoot={projectRoot} />
    );
  }

  // Keep hooks above this guard so hook call order stays stable across renders.
  if (!displayConfig) return null;

  if (displayConfig.type === 'one-line') {
    const value = displayConfig.getValue?.(parsedData) || '';
    const secondary = displayConfig.getSecondary?.(parsedData);
    const displayValue = formatProjectRelativePaths(value, projectRoot);
    const displaySecondary = secondary ? formatProjectRelativePaths(secondary, projectRoot) : secondary;

    return (
      <OneLineDisplay
        toolName={toolName}
        toolResult={toolResult}
        toolId={toolId}
        icon={displayConfig.icon}
        label={displayConfig.label}
        value={displayValue}
        copyValue={value}
        secondary={displaySecondary}
        action={displayConfig.action}
        onAction={handleAction}
        style={displayConfig.style}
        wrapText={displayConfig.wrapText}
        colorScheme={displayConfig.colorScheme}
        resultId={mode === 'input' ? `tool-result-${toolId}` : undefined}
      />
    );
  }

  if (displayConfig.type === 'collapsible') {
    const rawTitle = typeof displayConfig.title === 'function'
      ? displayConfig.title(parsedData)
      : displayConfig.title || 'Details';
    const title = formatProjectRelativePaths(rawTitle, projectRoot);

    // The user preference is authoritative. Per-tool defaults previously won
    // here, which meant turning "Auto-expand tools" off still left several
    // tool cards open.
    const defaultOpen = autoExpandTools;

    const contentProps = displayConfig.getContentProps?.(parsedData, {
      selectedProject,
      createDiff,
      onFileOpen
    }) || {};

    // Build the content component based on contentType
    let contentComponent: React.ReactNode = null;

    switch (displayConfig.contentType) {
      case 'pi-result':
        contentComponent = <PiToolContent kind={contentProps.kind} data={contentProps.data} isError={contentProps.isError} />;
        break;
      case 'diff':
        if (createDiff) {
          contentComponent = (
            <div className="space-y-2">
              {(contentProps.changes || [contentProps]).map((change: any, index: number) => (
                <DiffViewer key={index} {...contentProps} {...change}
                  displayFilePath={toProjectRelativeDisplayPath(change.filePath, projectRoot)}
                  createDiff={createDiff} onFileClick={() => onFileOpen?.(change.filePath)} />
              ))}
            </div>
          );
        }
        break;

      case 'markdown':
        contentComponent = (
          <MarkdownContent
            content={contentProps.content || ''}
            onFileOpen={onFileOpen}
            projectName={selectedProject?.name}
            projectRoot={projectRoot}
          />
        );
        break;

      case 'file-list':
        contentComponent = (
          <div><FileListContent
            files={contentProps.files || []}
            onFileClick={onFileOpen}
            title={contentProps.title}
            projectRoot={projectRoot}
          />
          {typeof contentProps.content === 'string' && (
            <TextContent content={contentProps.content} format="plain" onFileOpen={onFileOpen} projectName={selectedProject?.name} projectRoot={projectRoot} />
          )}</div>
        );
        break;

      case 'todo-list':
        if (contentProps.todos?.length > 0) {
          contentComponent = (
            <TodoListContent
              todos={contentProps.todos}
              isResult={contentProps.isResult}
            />
          );
        }
        break;

      case 'task':
        contentComponent = <TaskListContent content={contentProps.content || ''} />;
        break;

      case 'question-answer':
        contentComponent = (
          <QuestionAnswerContent
            questions={contentProps.questions || []}
            answers={contentProps.answers || {}}
          />
        );
        break;

      case 'text':
        contentComponent = (
          <TextContent
            content={contentProps.content || ''}
            format={contentProps.format || 'plain'}
            onFileOpen={onFileOpen}
            projectName={selectedProject?.name}
            projectRoot={projectRoot}
          />
        );
        break;

      case 'success-message': {
        const msg = displayConfig.getMessage?.(parsedData) || 'Success';
        contentComponent = (
          <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            {formatProjectRelativePaths(msg, projectRoot)}
          </div>
        );
        break;
      }
    }

    // For edit tools, make the title (filename) clickable to open the file
    const handleTitleClick = (toolName === 'Edit' || toolName === 'Write' || toolName === 'ApplyPatch') && contentProps.filePath && onFileOpen
      ? () => onFileOpen(contentProps.filePath, contentProps.changes?.length > 1 ? undefined : {
          old_string: contentProps.oldContent,
          new_string: contentProps.newContent
        })
      : undefined;

    return (
      <CollapsibleDisplay
        toolName={toolName}
        toolId={toolId}
        title={title}
        defaultOpen={defaultOpen}
        onTitleClick={handleTitleClick}
        showRawParameters={mode === 'input' && showRawParameters}
        rawContent={rawToolInput ? formatProjectRelativePaths(rawToolInput, projectRoot) : rawToolInput}
        toolCategory={getToolCategory(toolName)}
      >
        {contentComponent}
      </CollapsibleDisplay>
    );
  }

  return null;
});

ToolRenderer.displayName = 'ToolRenderer';
