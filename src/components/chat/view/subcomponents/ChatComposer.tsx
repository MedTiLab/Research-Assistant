import CommandMenu from '../../../CommandMenu';
import { MicButton } from '../../../MicButton.jsx';
import ImageAttachment from './ImageAttachment';
import PermissionRequestsBanner from './PermissionRequestsBanner';
import ChatInputControls from './ChatInputControls';
import ChatTaskProgressPill from './ChatTaskProgressPill';
import ReferencePicker from '../../../references/view/ReferencePicker';
import PromptBadgeDropdown from './PromptBadgeDropdown';
import QueuedTurnsPanel from './QueuedTurnsPanel';
import AgentSelector, { type ProviderDef } from './AgentSelector';
import ModelSelector from './ModelSelector';
import CustomModelInput, { type ModelCatalogMeta } from './CustomModelInput';
import SkillDropdown from './SkillDropdown';
import { AlertTriangle, BookOpen, FileText, FolderOpen, ListPlus, Plus, ShieldCheck, Square, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useCallback, useEffect, useRef, useState } from 'react';
import { localizeAttachedPrompt } from '../../utils/attachedPromptLocalization';
import type {
  ChangeEvent,
  ClipboardEvent,
  Dispatch,
  FormEvent,
  KeyboardEvent,
  MouseEvent,
  ReactNode,
  RefObject,
  SetStateAction,
  TouchEvent,
} from 'react';

import {
  CLAUDE_MODELS,
  CODEX_MODELS,
  PI_MODELS,
  normalizeCodexStoredModelSelection,
} from '../../../../../shared/modelConstants';
import type { CodexReasoningEffortId } from '../../constants/codexReasoningEfforts';
import type { ProviderAvailability } from '../../types/types';
import type { AttachedPrompt, PendingPermissionRequest, PermissionMode, Provider, QueuedChatTurn, TaskContext, TokenBudget } from '../../types/types';
import type { SessionProvider } from '../../../../types/app';
import type { ProjectFileChatContextItem } from '../../../../utils/projectFileChatContext';

interface MentionableFile {
  name: string;
  path: string;
}

function getFileKey(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

interface SlashCommand {
  name: string;
  description?: string;
  namespace?: string;
  path?: string;
  type?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

const PROVIDERS: ProviderDef[] = [
  { id: 'pi', name: 'Pi', accent: 'border-violet-600 dark:border-violet-400', ring: 'ring-violet-600/15', check: 'bg-violet-600 dark:bg-violet-500 text-white' },
];

function getModelConfig(
  provider: SessionProvider,
  piModel: string,
  piModelProviderId: string,
  piModelApi: string,
  piCatalogRevision: number | null,
) {
  if (provider === 'claude') return CLAUDE_MODELS;
  if (provider === 'codex') return CODEX_MODELS;
  if (provider === 'pi') return {
    ...PI_MODELS,
    ALLOWS_CUSTOM: false,
    OPTIONS: piModel ? [{
      value: piModel,
      label: piModel,
      modelProviderId: piModelProviderId || null,
      modelApi: piModelApi || null,
      catalogRevision: piCatalogRevision,
    }] : [],
  };
  return CLAUDE_MODELS;
}

function getModelValue(
  provider: SessionProvider,
  claudeModel: string,
  codexModel: string,
  piModel: string,
) {
  if (provider === 'claude') return claudeModel;
  if (provider === 'codex') return codexModel;
  if (provider === 'pi') return piModel;
  return claudeModel;
}

interface ChatComposerProps {
  pendingPermissionRequests: PendingPermissionRequest[];
  handlePermissionDecision: (
    requestIds: string | string[],
    decision: { allow?: boolean; message?: string; rememberEntry?: string | null; updatedInput?: unknown },
  ) => void;
  handleGrantToolPermission: (suggestion: { entry: string; toolName: string }) => { success: boolean };
  isLoading: boolean;
  onAbortSession: () => void;
  queuedTurns: QueuedChatTurn[];
  onEditQueuedTurn: (itemId: string, content: string) => void;
  onRemoveQueuedTurn: (itemId: string) => void;
  onReorderQueuedTurns: (itemIds: string[]) => void;
  onClearQueuedTurns: () => void;
  onStartTask?: (prompt?: string, task?: TaskContext | null) => void;
  provider: Provider | string;
  permissionMode: PermissionMode | string;
  permissionModes: PermissionMode[];
  onPermissionModeChange: (mode: PermissionMode) => void;
  onModeSwitch: () => void;
  thinkingMode: string;
  setThinkingMode: Dispatch<SetStateAction<string>>;
  codexReasoningEffort: CodexReasoningEffortId;
  setCodexReasoningEffort: Dispatch<SetStateAction<CodexReasoningEffortId>>;
  tokenBudget: TokenBudget | null;
  onCompactContext?: () => Promise<string | void>;
  canCompactContext?: boolean;
  slashCommandsCount: number;
  onToggleCommandMenu: () => void;
  hasInput: boolean;
  onClearInput: () => void;
  isUserScrolledUp: boolean;
  hasMessages: boolean;
  onScrollToBottom: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement> | MouseEvent<HTMLButtonElement> | TouchEvent<HTMLButtonElement>) => void;
  onSteer: (event: FormEvent<HTMLFormElement> | MouseEvent<HTMLButtonElement> | TouchEvent<HTMLButtonElement>) => void;
  isDragActive: boolean;
  attachedFiles: File[];
  onRemoveFile: (index: number) => void;
  attachedProjectFiles: ProjectFileChatContextItem[];
  onRemoveProjectFile: (index: number) => void;
  uploadingFiles: Map<string, number>;
  fileErrors: Map<string, string>;
  showFileDropdown: boolean;
  filteredFiles: MentionableFile[];
  selectedFileIndex: number;
  onSelectFile: (file: MentionableFile) => void;
  filteredCommands: SlashCommand[];
  selectedCommandIndex: number;
  onCommandSelect: (command: SlashCommand, index: number, isHover: boolean) => void;
  onCloseCommandMenu: () => void;
  isCommandMenuOpen: boolean;
  frequentCommands: SlashCommand[];
  getRootProps: (...args: unknown[]) => Record<string, unknown>;
  getInputProps: (...args: unknown[]) => Record<string, unknown>;
  openFilePicker: () => void;
  inputHighlightRef: RefObject<HTMLDivElement>;
  renderInputWithMentions: (text: string) => ReactNode;
  textareaRef: RefObject<HTMLTextAreaElement>;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  onInputChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onTextareaClick: (event: MouseEvent<HTMLTextAreaElement>) => void;
  onTextareaKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onTextareaPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  onTextareaScrollSync: (target: HTMLTextAreaElement) => void;
  onTextareaInput: (event: FormEvent<HTMLTextAreaElement>) => void;
  onInputFocusChange?: (focused: boolean) => void;
  isInputFocused?: boolean;
  placeholder: string;
  isTextareaExpanded: boolean;
  sendByCtrlEnter?: boolean;
  onTranscript: (text: string) => void;
  projectName?: string;
  sessionId?: string | null;
  onReferenceContext?: (context: string) => void;
  attachedPrompt: AttachedPrompt | null;
  onRemoveAttachedPrompt: () => void;
  onUpdateAttachedPrompt: (promptText: string) => void;
  setAttachedPrompt?: Dispatch<SetStateAction<AttachedPrompt | null>>;
  centered?: boolean;
  setProvider?: (next: SessionProvider) => void;
  claudeModel?: string;
  setClaudeModel?: (model: string) => void;
  codexModel?: string;
  setCodexModel?: (model: string) => void;
  piModel?: string;
  setPiModel?: (model: string) => void;
  piModelProviderId?: string;
  setPiModelProviderId?: (providerId: string) => void;
  piModelApi?: string;
  setPiModelApi?: (modelApi: string) => void;
  piCatalogRevision?: number | null;
  setPiCatalogRevision?: (revision: number | null) => void;
  providerAvailability?: Partial<Record<SessionProvider, ProviderAvailability>>;
  onOpenFolder?: () => void;
  workspaceLabel?: string;
  onRemoveWorkspace?: () => void;
}

export default function ChatComposer({
  pendingPermissionRequests,
  handlePermissionDecision,
  handleGrantToolPermission,
  isLoading,
  onAbortSession,
  queuedTurns,
  onEditQueuedTurn,
  onRemoveQueuedTurn,
  onReorderQueuedTurns,
  onClearQueuedTurns,
  onStartTask,
  provider,
  permissionMode,
  permissionModes,
  onPermissionModeChange,
  onModeSwitch,
  thinkingMode,
  setThinkingMode,
  codexReasoningEffort,
  setCodexReasoningEffort,
  tokenBudget,
  onCompactContext,
  canCompactContext,
  slashCommandsCount,
  onToggleCommandMenu,
  hasInput,
  onClearInput,
  isUserScrolledUp,
  hasMessages,
  onScrollToBottom,
  onSubmit,
  onSteer,
  isDragActive,
  attachedFiles,
  onRemoveFile,
  attachedProjectFiles,
  onRemoveProjectFile,
  uploadingFiles,
  fileErrors,
  showFileDropdown,
  filteredFiles,
  selectedFileIndex,
  onSelectFile,
  filteredCommands,
  selectedCommandIndex,
  onCommandSelect,
  onCloseCommandMenu,
  isCommandMenuOpen,
  frequentCommands,
  getRootProps,
  getInputProps,
  openFilePicker,
  inputHighlightRef,
  renderInputWithMentions,
  textareaRef,
  input,
  setInput,
  onInputChange,
  onTextareaClick,
  onTextareaKeyDown,
  onTextareaPaste,
  onTextareaScrollSync,
  onTextareaInput,
  onInputFocusChange,
  isInputFocused,
  placeholder,
  isTextareaExpanded,
  sendByCtrlEnter,
  onTranscript,
  projectName,
  sessionId,
  onReferenceContext,
  attachedPrompt,
  onRemoveAttachedPrompt,
  onUpdateAttachedPrompt,
  setAttachedPrompt,
  centered,
  setProvider,
  claudeModel: claudeModelProp,
  setClaudeModel,
  codexModel: codexModelProp,
  setCodexModel,
  piModel: piModelProp,
  setPiModel,
  piModelProviderId,
  setPiModelProviderId,
  piModelApi,
  setPiModelApi,
  piCatalogRevision,
  setPiCatalogRevision,
  providerAvailability,
  onOpenFolder,
  workspaceLabel,
  onRemoveWorkspace,
}: ChatComposerProps) {
  const { t, i18n } = useTranslation('chat');
  const [showReferencePicker, setShowReferencePicker] = useState(false);
  const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);
  const [piCatalogStatus, setPiCatalogStatus] = useState<{
    health?: ProviderAvailability['catalogHealth'];
    retryAt?: string | null;
    privacyNotice?: string | null;
    priceNotice?: string | null;
  }>({});
  const handlePiCatalogChange = useCallback((catalog: ModelCatalogMeta) => {
    setPiCatalogStatus({
      health: catalog.health || null,
      retryAt: catalog.retryAt || null,
      privacyNotice: catalog.privacyNotice || null,
      priceNotice: catalog.priceNotice || null,
    });
    if (Number.isInteger(catalog.catalogRevision)) {
      setPiCatalogRevision?.(catalog.catalogRevision ?? null);
      localStorage.setItem('pi-catalog-revision', String(catalog.catalogRevision));
    }
  }, [setPiCatalogRevision]);
  const attachmentMenuRef = useRef<HTMLDivElement>(null);
  const AnyCommandMenu = CommandMenu as any;
  const activeLanguage = i18n.resolvedLanguage || i18n.language;

  useEffect(() => {
    if (!setAttachedPrompt) {
      return;
    }

    setAttachedPrompt((previous) => previous
      ? localizeAttachedPrompt(t, previous)
      : previous);
  }, [activeLanguage, setAttachedPrompt, t]);
  const textareaRect = textareaRef.current?.getBoundingClientRect();
  const commandMenuPosition = {
    top: textareaRect ? Math.max(16, textareaRect.top - 316) : 0,
    left: textareaRect ? textareaRect.left : 16,
    bottom: textareaRect ? window.innerHeight - textareaRect.top + 8 : 90,
  };

  const hasQuestionPanel = pendingPermissionRequests.some((request) => request.toolName === 'AskUserQuestion');

  const mobileFloatingClass = isInputFocused
    ? 'max-sm:fixed max-sm:bottom-0 max-sm:left-0 max-sm:right-0 max-sm:z-50 max-sm:bg-background max-sm:shadow-[0_-4px_20px_rgba(0,0,0,0.15)]'
    : isLoading
      ? 'max-sm:fixed max-sm:left-0 max-sm:right-0 max-sm:bottom-[var(--mobile-nav-total)] max-sm:z-40 max-sm:bg-background max-sm:shadow-[0_-4px_20px_rgba(0,0,0,0.12)]'
      : '';

  const sessionProvider = provider as SessionProvider;
  const currentModel = getModelValue(
    sessionProvider,
    claudeModelProp || '',
    codexModelProp || '',
    piModelProp || '',
  );

  const rawModelConfig = getModelConfig(
    sessionProvider,
    piModelProp || '',
    piModelProviderId || '',
    piModelApi || '',
    piCatalogRevision ?? null,
  );
  const modelConfig = rawModelConfig;
  const activePiCatalogHealth = piCatalogStatus.health
    || providerAvailability?.pi?.catalogHealth
    || 'healthy';
  const activePiRetryAt = piCatalogStatus.retryAt || providerAvailability?.pi?.retryAt || null;
  const piCatalogTitle = [
    piCatalogStatus.privacyNotice
      || providerAvailability?.pi?.privacyNotice
      || t('providerSelection.managedFreePrivacy'),
    piCatalogStatus.priceNotice
      || providerAvailability?.pi?.priceNotice
      || t('providerSelection.managedFreePrice'),
    activePiCatalogHealth === 'rate_limited' && activePiRetryAt
      ? t('providerSelection.managedFreeRetryAt', {
        time: new Date(activePiRetryAt).toLocaleString(),
      })
      : null,
  ].filter(Boolean).join(' ');

  const selectProvider = (next: SessionProvider) => {
    if (
      providerAvailability?.[next]?.cliAvailable === false
      || providerAvailability?.[next]?.planLocked === true
    ) {
      return;
    }

    setProvider?.(next);
    localStorage.setItem('selected-provider', next);
    setTimeout(() => textareaRef.current?.focus(), 100);
  };

  const handleModelChange = (value: string) => {
    if (sessionProvider === 'claude') {
      setClaudeModel?.(value);
      localStorage.setItem('claude-model', value);
      return;
    }
    if (sessionProvider === 'codex') {
      const normalizedValue = normalizeCodexStoredModelSelection(value);
      setCodexModel?.(normalizedValue);
      localStorage.setItem('codex-model', normalizedValue);
      return;
    }
    if (sessionProvider === 'pi') {
      setPiModel?.(value);
      localStorage.setItem('pi-model', value);
      return;
    }
    setClaudeModel?.(value);
    localStorage.setItem('claude-model', value);
  };

  const maxWidthClass = 'max-w-5xl';
  const hasSubmissionContent =
    Boolean(input.trim()) ||
    attachedFiles.length > 0 ||
    attachedProjectFiles.length > 0 ||
    Boolean(attachedPrompt);
  const canAttachReferences = Boolean(projectName && onReferenceContext);

  useEffect(() => {
    if (!showAttachmentMenu) {
      return;
    }

    const handlePointerDown = (event: globalThis.MouseEvent) => {
      if (attachmentMenuRef.current && !attachmentMenuRef.current.contains(event.target as Node)) {
        setShowAttachmentMenu(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [showAttachmentMenu]);

  const handleAttachmentMenuToggle = () => {
    if (!canAttachReferences) {
      openFilePicker();
      return;
    }

    setShowAttachmentMenu((previous) => !previous);
  };

  const handleAttachFiles = () => {
    setShowAttachmentMenu(false);
    openFilePicker();
  };

  const handleAttachReferences = () => {
    setShowAttachmentMenu(false);
    setShowReferencePicker((previous) => !previous);
  };

  return (
    <div className={`medical-composer-dock medhelp-chat-composer px-2 pt-0 sm:px-4 sm:pt-1 md:px-4 md:pt-1 flex-shrink-0 ${centered ? 'pb-0' : 'pb-2 sm:pb-4 md:pb-6'} ${mobileFloatingClass}`}>
      <div className={`${maxWidthClass} mx-auto`}>
        <PermissionRequestsBanner
          provider={provider}
          pendingPermissionRequests={pendingPermissionRequests}
          handlePermissionDecision={handlePermissionDecision}
          handleGrantToolPermission={handleGrantToolPermission}
        />
      </div>

      <QueuedTurnsPanel
        items={queuedTurns}
        onEdit={onEditQueuedTurn}
        onRemove={onRemoveQueuedTurn}
        onReorder={onReorderQueuedTurns}
        onClear={onClearQueuedTurns}
      />

      {!hasQuestionPanel && (
        <form
          onSubmit={(event) => (isLoading ? onSteer(event) : onSubmit(event))}
          className={`relative mx-auto ${maxWidthClass}`}
        >
          {!centered && (
            <div className="pointer-events-none absolute bottom-full left-0 right-0 pb-1.5">
              <div className="relative flex w-full flex-wrap items-center gap-2 px-2">
                <div className="flex min-w-0 flex-1 items-center justify-center gap-2">
                  {isUserScrolledUp && hasMessages && (
                    <button
                      type="button"
                      onClick={onScrollToBottom}
                      className="pointer-events-auto h-7 w-7 flex-shrink-0 rounded-lg bg-primary text-primary-foreground shadow-sm transition-all duration-200 hover:scale-105 hover:bg-primary/90 sm:h-8 sm:w-8"
                      title={t('input.scrollToBottom', { defaultValue: 'Scroll to bottom' })}
                    >
                      <svg className="h-3.5 w-3.5 sm:h-4 sm:w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                      </svg>
                    </button>
                  )}
                </div>

                <div className="pointer-events-auto ml-auto flex min-w-0 justify-end">
                  <ChatTaskProgressPill
                    provider={provider}
                    projectName={projectName}
                    sessionId={sessionId}
                    compact
                    hideWhenEmpty
                    onStartTask={onStartTask}
                  />
                </div>
              </div>
            </div>
          )}

          {attachedFiles.length > 0 && (
            <div className="mb-2 p-2 bg-muted/40 rounded-xl">
              <div className="flex flex-wrap gap-2">
                {attachedFiles.map((file, index) => (
                  <ImageAttachment
                    key={index}
                    file={file}
                    onRemove={() => onRemoveFile(index)}
                    uploadProgress={uploadingFiles.get(getFileKey(file))}
                  />
                ))}
              </div>
            </div>
          )}

          {attachedProjectFiles.length > 0 && (
            <div className="mb-2 rounded-xl bg-muted/40 p-2">
              <div className="flex flex-wrap gap-2">
                {attachedProjectFiles.map((file, index) => (
                  <div
                    key={`${file.path}:${index}`}
                    className="flex max-w-full items-center gap-2 rounded-lg border border-border/50 bg-background/80 px-2.5 py-1.5 text-sm"
                  >
                    <FileText className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <div className="truncate font-medium text-foreground">{file.name}</div>
                      <div className="max-w-[260px] truncate font-mono text-[11px] text-muted-foreground">
                        {file.path}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="ml-1 rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => onRemoveProjectFile(index)}
                      aria-label={t('attachedPrompt.remove')}
                      title={t('attachedPrompt.remove')}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {fileErrors.size > 0 && (
            <div className="mb-2 rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2 text-sm text-red-600">
              {[...new Set(fileErrors.values())].map((error) => (
                <div key={error} className="truncate">
                  {error}
                </div>
              ))}
            </div>
          )}

          {showFileDropdown && filteredFiles.length > 0 && (
            <div className="absolute bottom-full left-0 right-0 mb-2 bg-card/95 backdrop-blur-md border border-border/50 rounded-xl shadow-lg max-h-48 overflow-y-auto z-50">
              {filteredFiles.map((file, index) => (
                <div
                  key={file.path}
                  className={`px-4 py-3 cursor-pointer border-b border-border/30 last:border-b-0 touch-manipulation ${
                    index === selectedFileIndex
                      ? 'bg-primary/8 text-primary'
                      : 'hover:bg-accent/50 text-foreground'
                  }`}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onSelectFile(file);
                  }}
                >
                  <div className="font-medium text-sm">{file.name}</div>
                  <div className="text-xs text-muted-foreground font-mono">{file.path}</div>
                </div>
              ))}
            </div>
          )}

          {showReferencePicker && projectName && onReferenceContext && (
            <ReferencePicker
              projectName={projectName}
              onSelect={(context) => {
                onReferenceContext?.(context);
              }}
              onClose={() => setShowReferencePicker(false)}
            />
          )}

          <AnyCommandMenu
            commands={filteredCommands}
            selectedIndex={selectedCommandIndex}
            onSelect={onCommandSelect}
            onClose={onCloseCommandMenu}
            position={commandMenuPosition}
            isOpen={isCommandMenuOpen}
            frequentCommands={frequentCommands}
          />

          {(onOpenFolder || workspaceLabel) && (
            <div className="mb-2 flex items-center px-1">
              {workspaceLabel && (
                <div
                  className="flex h-7 max-w-56 items-center gap-1.5 rounded-full bg-muted/60 pl-2 pr-1 text-xs text-muted-foreground"
                  title={t('input.connectedFolder', { name: workspaceLabel })}
                >
                  <FolderOpen className="h-4 w-4 shrink-0" />
                  <span className="truncate">{workspaceLabel}</span>
                  {onRemoveWorkspace && (
                    <button
                      type="button"
                      onClick={onRemoveWorkspace}
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-accent hover:text-foreground"
                      title={t('input.removeFolder')}
                      aria-label={t('input.removeFolder')}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              )}

              {onOpenFolder && !workspaceLabel && (
                <button
                  type="button"
                  onClick={onOpenFolder}
                  className="flex h-7 items-center gap-1.5 rounded-full px-2 text-xs text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
                  title={t('input.openFolder')}
                  aria-label={t('input.openFolder')}
                >
                  <FolderOpen className="h-4 w-4" />
                  <span>{t('input.openFolder')}</span>
                </button>
              )}
            </div>
          )}

          <div
            {...getRootProps()}
            className={`medical-composer-card relative bg-card/80 backdrop-blur-sm rounded-3xl shadow-sm border border-border/75 focus-within:shadow-md focus-within:border-primary/40 focus-within:ring-1 focus-within:ring-primary/20 transition-all duration-200 ${
              isTextareaExpanded ? 'chat-input-expanded' : ''
            }`}
          >
            <input {...getInputProps()} />
            {isDragActive && (
              <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center rounded-3xl border-2 border-dashed border-primary/50 bg-primary/15">
                <div className="rounded-xl border border-border/30 bg-card p-4 shadow-lg">
                  <svg className="mx-auto mb-2 h-8 w-8 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                    />
                  </svg>
                  <p className="text-sm font-medium">{t('input.dropFilesHere')}</p>
                </div>
              </div>
            )}
            {attachedPrompt && (
              <PromptBadgeDropdown
                prompt={attachedPrompt}
                onRemove={onRemoveAttachedPrompt}
                onUpdate={onUpdateAttachedPrompt}
              />
            )}

            <div ref={inputHighlightRef} aria-hidden="true" className="absolute inset-0 pointer-events-none overflow-hidden rounded-3xl">
              <div className="chat-input-placeholder block w-full px-5 py-1.5 sm:py-4 text-base text-transparent leading-6 whitespace-pre-wrap break-words">
                {renderInputWithMentions(input)}
              </div>
            </div>

            <div className="relative z-10">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={onInputChange}
                onClick={onTextareaClick}
                onKeyDown={onTextareaKeyDown}
                onPaste={onTextareaPaste}
                onScroll={(event) => onTextareaScrollSync(event.target as HTMLTextAreaElement)}
                onFocus={() => onInputFocusChange?.(true)}
                onBlur={() => onInputFocusChange?.(false)}
                onInput={onTextareaInput}
                placeholder={placeholder}
                className="chat-input-placeholder block w-full px-5 py-1.5 sm:py-4 min-h-[50px] sm:min-h-[80px] max-h-[40vh] sm:max-h-[300px] text-base bg-transparent rounded-3xl focus:outline-none text-foreground placeholder-muted-foreground/50 resize-none overflow-y-auto leading-6 transition-all duration-200"
                style={{ height: '50px' }}
              />

              {!centered && (
                <div
                  className={`absolute bottom-1 left-5 right-5 text-xs text-muted-foreground/50 pointer-events-none hidden sm:block transition-opacity duration-200 ${
                    input.trim() ? 'opacity-0' : 'opacity-100'
                  }`}
                >
                  {sendByCtrlEnter ? t('input.hintText.ctrlEnter') : t('input.hintText.enter')}
                </div>
              )}
            </div>

            <div className="relative z-10 border-t border-border/30">
              <div className="flex min-w-0 items-center gap-2 px-4 py-2">
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2.5">
                  <div ref={attachmentMenuRef} className="relative">
                    <button
                      type="button"
                      onClick={handleAttachmentMenuToggle}
                      className="flex items-center justify-center rounded-full p-1 text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
                      title={t('input.attachMenu')}
                      aria-label={t('input.attachMenu')}
                      aria-haspopup={canAttachReferences ? 'menu' : undefined}
                      aria-expanded={canAttachReferences ? showAttachmentMenu : undefined}
                    >
                      <Plus className="h-4 w-4" />
                    </button>

                    {canAttachReferences && showAttachmentMenu && (
                      <div
                        role="menu"
                        className="absolute bottom-full left-0 z-50 mb-2 w-40 overflow-hidden rounded-xl border border-border/60 bg-popover py-1 text-sm shadow-xl"
                      >
                        <button
                          type="button"
                          role="menuitem"
                          onClick={handleAttachFiles}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                        >
                          <FileText className="h-4 w-4" />
                          <span>{t('input.attachFiles')}</span>
                        </button>

                        <button
                          type="button"
                          role="menuitem"
                          onClick={handleAttachReferences}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                        >
                          <BookOpen className="h-4 w-4" />
                          <span>{t('input.attachReferences')}</span>
                        </button>
                      </div>
                    )}
                  </div>

                  {!centered && setAttachedPrompt && (
                    <SkillDropdown
                      setInput={setInput}
                      textareaRef={textareaRef}
                      setAttachedPrompt={setAttachedPrompt}
                      t={t}
                    />
                  )}

                  {centered && providerAvailability && setProvider && (
                    <AgentSelector
                      providers={PROVIDERS}
                      activeProvider={sessionProvider}
                      providerAvailability={providerAvailability}
                      onSelect={selectProvider}
                      t={t}
                    />
                  )}

                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    {(modelConfig as any).MODEL_ENDPOINT ? (
                      <CustomModelInput
                        value={currentModel}
                        options={modelConfig.OPTIONS}
                        onChange={handleModelChange}
                        endpoint={(modelConfig as any).MODEL_ENDPOINT}
                        customStorageKey={(modelConfig as any).CUSTOM_STORAGE_KEY}
                        fallbackValue={modelConfig.OPTIONS[0]?.value || ''}
                        allowCustom={(modelConfig as any).ALLOWS_CUSTOM !== false}
                        selectedModelProviderId={sessionProvider === 'pi' ? piModelProviderId : null}
                        onCatalogChange={sessionProvider === 'pi' ? handlePiCatalogChange : undefined}
                        onOptionChange={(option) => {
                          if (sessionProvider !== 'pi') return;
                          if (option.modelProviderId) {
                            setPiModelProviderId?.(option.modelProviderId);
                            localStorage.setItem('pi-model-provider', option.modelProviderId);
                          }
                          if (option.modelApi) {
                            setPiModelApi?.(option.modelApi);
                            localStorage.setItem('pi-model-api', option.modelApi);
                          }
                          if (Number.isInteger(option.catalogRevision)) {
                            setPiCatalogRevision?.(option.catalogRevision ?? null);
                            localStorage.setItem('pi-catalog-revision', String(option.catalogRevision));
                          }
                        }}
                      />
                    ) : (
                      <ModelSelector
                        value={currentModel}
                        options={modelConfig.OPTIONS}
                        onChange={handleModelChange}
                      />
                    )}

                    {sessionProvider === 'pi' && piModelProviderId === 'managed-free' && (
                      <span
                        className={`inline-flex h-7 items-center gap-1 rounded-lg border px-2 text-[10px] ${
                          activePiCatalogHealth === 'rate_limited'
                            ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200'
                            : 'border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-800 dark:bg-violet-950/30 dark:text-violet-200'
                        }`}
                        title={piCatalogTitle}
                      >
                        {activePiCatalogHealth === 'rate_limited'
                          ? <AlertTriangle className="h-3 w-3" />
                          : <ShieldCheck className="h-3 w-3" />}
                        {t(`providerSelection.managedFreeHealth.${activePiCatalogHealth}`)}
                        <span aria-hidden="true">·</span>
                        {t('providerSelection.managedFreePrivacyShort')}
                      </span>
                    )}

                    <ChatInputControls
                      permissionMode={permissionMode}
                      permissionModes={permissionModes}
                      onPermissionModeChange={onPermissionModeChange}
                      onModeSwitch={onModeSwitch}
                      provider={provider}
                      claudeModel={claudeModelProp || ''}
                      codexModel={codexModelProp || ''}
                      piModel={piModelProp || ''}
                      thinkingMode={thinkingMode}
                      setThinkingMode={setThinkingMode}
                      codexReasoningEffort={codexReasoningEffort}
                      setCodexReasoningEffort={setCodexReasoningEffort}
                      tokenBudget={tokenBudget}
                      onCompactContext={onCompactContext}
                      canCompactContext={canCompactContext}
                      slashCommandsCount={slashCommandsCount}
                      onToggleCommandMenu={onToggleCommandMenu}
                      hasInput={hasInput}
                      onClearInput={onClearInput}
                      isUserScrolledUp={isUserScrolledUp}
                      hasMessages={hasMessages}
                      onScrollToBottom={onScrollToBottom}
                      hideCommandMenu
                      compact
                    />
                  </div>
                </div>

                <div className="ml-auto flex flex-shrink-0 items-center gap-1">
                  <MicButton onTranscript={onTranscript} className="!h-7 !w-7 [&_svg]:!h-3.5 [&_svg]:!w-3.5" />
                  {isLoading && (
                    <>
                      <button
                        type="button"
                        onMouseDown={(event) => {
                          event.preventDefault();
                          onAbortSession();
                        }}
                        onTouchStart={(event) => {
                          event.preventDefault();
                          onAbortSession();
                        }}
                        className="flex h-7 w-7 items-center justify-center rounded-lg border border-red-300/70 bg-red-50 text-red-600 shadow-sm transition-all duration-200 hover:bg-red-100 focus:outline-none focus:ring-1 focus:ring-red-500/20 dark:border-red-500/35 dark:bg-red-950/25 dark:text-red-300 dark:hover:bg-red-950/40"
                        aria-label={t('input.stop')}
                        title={t('input.stop')}
                      >
                        <Square className="h-3.5 w-3.5 fill-current stroke-current" strokeWidth={2.4} />
                      </button>
                      {(provider === 'claude' || provider === 'codex' || provider === 'pi') && (
                        <button
                          type="button"
                          disabled={!hasSubmissionContent}
                          onMouseDown={(event) => {
                            event.preventDefault();
                            onSubmit(event);
                          }}
                          onTouchStart={(event) => {
                            event.preventDefault();
                            onSubmit(event);
                          }}
                          className="flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground shadow-sm transition-all duration-200 hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/20"
                          aria-label={t('queue.send')}
                          title={t('queue.send')}
                        >
                          <ListPlus className="h-3.5 w-3.5" strokeWidth={2.2} />
                        </button>
                      )}
                    </>
                  )}
                  <button
                    type="button"
                    disabled={!hasSubmissionContent}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      if (isLoading) onSteer(event);
                      else onSubmit(event);
                    }}
                    onTouchStart={(event) => {
                      event.preventDefault();
                      if (isLoading) onSteer(event);
                      else onSubmit(event);
                    }}
                    className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary transition-all duration-200 hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/30"
                    aria-label={isLoading ? t('steer.send') : t('input.send')}
                    title={isLoading ? t('steer.hint') : t('input.send')}
                  >
                    <svg className="h-3.5 w-3.5 rotate-90 transform text-primary-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}
