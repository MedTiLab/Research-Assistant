import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, ClipboardList, Pencil, Shield, Unlock } from 'lucide-react';
import ThinkingModeSelector from './ThinkingModeSelector';
import CodexReasoningEffortSelector from './CodexReasoningEffortSelector';
import TokenUsagePie from './TokenUsagePie';
import type { CodexReasoningEffortId } from '../../constants/codexReasoningEfforts';
import { supportsExplicitCodexReasoningEffort } from '../../constants/codexReasoningSupport';
import { getClaudeModelContextWindow, getCodexModelContextWindow } from '../../../../../shared/modelConstants';
import type { PermissionMode, Provider, TokenBudget } from '../../types/types';

interface ChatInputControlsProps {
  permissionMode: PermissionMode | string;
  permissionModes: PermissionMode[];
  onPermissionModeChange: (mode: PermissionMode) => void;
  onModeSwitch: () => void;
  provider: Provider | string;
  claudeModel: string;
  codexModel: string;
  piModel?: string;
  thinkingMode: string;
  setThinkingMode: React.Dispatch<React.SetStateAction<string>>;
  codexReasoningEffort: CodexReasoningEffortId;
  setCodexReasoningEffort: React.Dispatch<React.SetStateAction<CodexReasoningEffortId>>;
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
  hideCommandMenu?: boolean;
  compact?: boolean;
}

export default function ChatInputControls({
  permissionMode,
  permissionModes,
  onPermissionModeChange,
  onModeSwitch,
  provider,
  claudeModel,
  codexModel,
  piModel,
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
  hideCommandMenu,
  compact,
}: ChatInputControlsProps) {
  const { t } = useTranslation('chat');
  const [permissionMenuOpen, setPermissionMenuOpen] = useState(false);
  const permissionMenuRef = useRef<HTMLDivElement>(null);
  const fallbackContextWindow = provider === 'codex'
    ? getCodexModelContextWindow(codexModel)
    : provider === 'claude'
      ? getClaudeModelContextWindow(claudeModel)
      : provider === 'pi' ? 0 : parseInt(import.meta.env.VITE_CONTEXT_WINDOW) || 256000;
  const permissionModeLabel =
    permissionMode === 'auto'
      ? t('codex.modes.auto')
      : permissionMode === 'readOnly'
      ? t('codex.modes.readOnly')
      : permissionMode === 'ask'
        ? t('codex.modes.ask')
      : permissionMode === 'default'
      ? t('codex.modes.default')
      : permissionMode === 'acceptEdits'
        ? t('codex.modes.acceptEdits')
        : permissionMode === 'bypassPermissions'
          ? t('codex.modes.bypassPermissions')
          : permissionMode === 'plan'
            ? t('codex.modes.plan')
            : String(permissionMode || '');
  const PermissionModeIcon =
    permissionMode === 'auto'
      ? Unlock
      : permissionMode === 'acceptEdits'
      ? Pencil
      : permissionMode === 'bypassPermissions'
        ? Unlock
        : permissionMode === 'plan'
          ? ClipboardList
          : Shield;
  const getPermissionModeLabel = (mode: PermissionMode | string) =>
    mode === 'auto'
      ? t('codex.modes.auto')
      : mode === 'readOnly'
      ? t('codex.modes.readOnly')
      : mode === 'ask'
        ? t('codex.modes.ask')
      : mode === 'default'
      ? t('codex.modes.default')
      : mode === 'acceptEdits'
        ? t('codex.modes.acceptEdits')
        : mode === 'bypassPermissions'
          ? t('codex.modes.bypassPermissions')
          : mode === 'plan'
            ? t('codex.modes.plan')
            : String(mode || '');
  const getPermissionModeIcon = (mode: PermissionMode | string) =>
    mode === 'auto'
      ? Unlock
      : mode === 'acceptEdits'
      ? Pencil
      : mode === 'bypassPermissions'
        ? Unlock
        : mode === 'plan'
          ? ClipboardList
          : Shield;

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (permissionMenuRef.current && !permissionMenuRef.current.contains(event.target as Node)) {
        setPermissionMenuOpen(false);
      }
    };

    if (permissionMenuOpen) {
      document.addEventListener('mousedown', handlePointerDown);
    }

    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [permissionMenuOpen]);

  return (
    <>
      <div ref={permissionMenuRef} className="relative">
        <button
          type="button"
          onClick={() => setPermissionMenuOpen((previous) => !previous)}
          className={`flex ${compact ? 'h-7 px-2 text-[11px]' : 'h-10 px-3 text-sm'} items-center gap-1.5 rounded-lg border border-border/60 bg-white font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 focus:outline-none focus:ring-1 focus:ring-primary/30`}
          aria-label={permissionModeLabel}
          title={permissionModeLabel || t('input.clickToChangeMode')}
        >
          <PermissionModeIcon className={`${compact ? 'h-3.5 w-3.5' : 'h-5 w-5'} shrink-0 text-muted-foreground`} />
          {permissionModeLabel && <span className="whitespace-nowrap">{permissionModeLabel}</span>}
          <ChevronDown className={`h-3 w-3 shrink-0 text-muted-foreground transition-transform ${permissionMenuOpen ? 'rotate-180' : ''}`} />
        </button>

        {permissionMenuOpen && (
          <div className="absolute bottom-full left-0 z-50 mb-1 w-48 overflow-hidden rounded-xl border border-border bg-popover shadow-xl">
            {permissionModes.map((mode) => {
              const active = mode === permissionMode;
              const ModeIcon = getPermissionModeIcon(mode);

              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => {
                    onPermissionModeChange(mode);
                    setPermissionMenuOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] transition-colors ${
                    active
                      ? 'bg-primary/8 font-medium text-foreground'
                      : 'text-muted-foreground hover:bg-muted/50'
                  }`}
                >
                  <ModeIcon className="h-3.5 w-3.5 shrink-0" />
                  <span className="flex-1">{getPermissionModeLabel(mode)}</span>
                  {active && <Check className="h-3 w-3 shrink-0 text-primary" />}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {(provider === 'claude' || provider === 'pi') && (
        <ThinkingModeSelector
          selectedMode={thinkingMode}
          onModeChange={setThinkingMode}
          provider={provider}
          onClose={() => {}}
          className=""
          compact={compact}
        />
      )}

      {provider === 'codex' && supportsExplicitCodexReasoningEffort(codexModel) && (
        <CodexReasoningEffortSelector
          model={codexModel}
          selectedEffort={codexReasoningEffort}
          onEffortChange={setCodexReasoningEffort}
          onClose={() => {}}
          className=""
          compact={compact}
        />
      )}

      {hasMessages && <TokenUsagePie
        used={tokenBudget?.used}
        total={tokenBudget?.total || fallbackContextWindow}
        estimated={tokenBudget?.estimated}
        unsupportedContext={tokenBudget?.unsupportedContext || (provider === 'pi' && !tokenBudget?.total)}
        message={tokenBudget?.message}
        model={tokenBudget?.model || (provider === 'codex' ? codexModel : provider === 'pi' ? piModel : claudeModel)}
        provider={provider}
        breakdown={tokenBudget?.breakdown}
        totalSource={tokenBudget?.total ? 'runtime' : 'fallback'}
        onCompact={provider === 'codex' || provider === 'pi' ? onCompactContext : undefined}
        canCompact={canCompactContext}
        showUnavailable={provider !== 'codex'}
      />}

      {!hideCommandMenu && (
        <button
          type="button"
          onClick={onToggleCommandMenu}
          className="relative w-7 h-7 sm:w-8 sm:h-8 text-muted-foreground hover:text-foreground rounded-lg flex items-center justify-center transition-colors hover:bg-accent/60"
          title={t('input.showAllCommands')}
        >
          <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"
            />
          </svg>
          {slashCommandsCount > 0 && (
            <span
              className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-[10px] font-bold rounded-full w-4 h-4 sm:w-5 sm:h-5 flex items-center justify-center"
            >
              {slashCommandsCount}
            </span>
          )}
        </button>
      )}

      {hasInput && !compact && (
        <button
          type="button"
          onClick={onClearInput}
          className="w-7 h-7 sm:w-8 sm:h-8 bg-card hover:bg-accent/60 border border-border/50 rounded-lg flex items-center justify-center transition-all duration-200 group shadow-sm"
          title={t('input.clearInput', { defaultValue: 'Clear input' })}
        >
          <svg
            className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-muted-foreground group-hover:text-foreground transition-colors"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}

      {isUserScrolledUp && hasMessages && !compact && (
        <button
          onClick={onScrollToBottom}
          className="w-7 h-7 sm:w-8 sm:h-8 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg shadow-sm flex items-center justify-center transition-all duration-200 hover:scale-105"
          title={t('input.scrollToBottom', { defaultValue: 'Scroll to bottom' })}
        >
          <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </button>
      )}
    </>
  );
}
