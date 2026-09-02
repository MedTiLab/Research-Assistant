import { useEffect, useRef, useState } from 'react';
import { Brain, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { codexReasoningEfforts } from '../../constants/codexReasoningEfforts';
import type { CodexReasoningEffortId } from '../../constants/codexReasoningEfforts';
import { getSupportedCodexReasoningEfforts } from '../../constants/codexReasoningSupport';

type CodexReasoningEffortSelectorProps = {
  model: string;
  selectedEffort: CodexReasoningEffortId;
  onEffortChange: (effortId: CodexReasoningEffortId) => void;
  onClose?: () => void;
  className?: string;
  compact?: boolean;
};

export default function CodexReasoningEffortSelector({
  model,
  selectedEffort,
  onEffortChange,
  onClose,
  className = '',
  compact,
}: CodexReasoningEffortSelectorProps) {
  const { t } = useTranslation('chat');
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        onClose?.();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  const supportedEffortIds = getSupportedCodexReasoningEfforts(model);
  const translatedEfforts = codexReasoningEfforts
    .filter((effort) => supportedEffortIds.includes(effort.id))
    .map((effort) => ({
      ...effort,
      name: t(`codexReasoningEffort.levels.${effort.id}.name`),
      description: t(`codexReasoningEffort.levels.${effort.id}.description`),
    }));
  const currentEffort = translatedEfforts.find((effort) => effort.id === selectedEffort) || translatedEfforts[0];

  if (!currentEffort) {
    return null;
  }

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`${compact ? 'h-7 w-7 rounded-lg' : 'h-10 w-10 rounded-lg'} flex items-center justify-center border border-border/60 bg-white text-slate-700 shadow-sm transition-colors hover:bg-slate-50 focus:outline-none focus:ring-1 focus:ring-primary/30`}
        aria-label={t('codexReasoningEffort.buttonTitle', { level: currentEffort.name })}
        title={t('codexReasoningEffort.buttonTitle', { level: currentEffort.name })}
      >
        <Brain className={`${compact ? 'w-3.5 h-3.5' : 'w-5 h-5'} ${currentEffort.color}`} />
      </button>

      {isOpen && (
        <div className={`absolute bottom-full ${compact ? 'left-0' : 'right-0'} z-50 mb-2 ${compact ? 'w-52' : 'w-72'} max-h-[min(420px,70vh)] bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 overflow-y-auto`}>
          <div className={`${compact ? 'px-2.5 py-2' : 'p-3'} border-b border-gray-200 dark:border-gray-700`}>
            <div className="flex items-center justify-between">
              <h3 className={`${compact ? 'text-xs' : 'text-sm'} font-semibold text-gray-900 dark:text-white`}>
                {t('codexReasoningEffort.selector.title')}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  onClose?.();
                }}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
              >
                <X className={`${compact ? 'w-3 h-3' : 'w-4 h-4'} text-gray-500`} />
              </button>
            </div>
            {!compact && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {t('codexReasoningEffort.selector.description')}
              </p>
            )}
          </div>

          <div className="py-0.5">
            {translatedEfforts.map((effort) => {
              const EffortIcon = effort.icon;
              const isSelected = effort.id === selectedEffort;

              return (
                <button
                  key={effort.id}
                  type="button"
                  onClick={() => {
                    onEffortChange(effort.id);
                    setIsOpen(false);
                    onClose?.();
                  }}
                  className={`w-full ${compact ? 'px-2.5 py-1.5' : 'px-4 py-3'} text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ${
                    isSelected ? 'bg-gray-50 dark:bg-gray-700' : ''
                  }`}
                >
                  <div className={`flex items-start ${compact ? 'gap-2' : 'gap-3'}`}>
                    <div className={`mt-0.5 ${effort.color}`}>
                      <EffortIcon className={`${compact ? 'w-3.5 h-3.5' : 'w-5 h-5'}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className={`font-medium ${compact ? 'text-[11px]' : 'text-sm'} ${
                          isSelected ? 'text-gray-900 dark:text-white' : 'text-gray-700 dark:text-gray-300'
                        }`}>
                          {effort.name}
                        </span>
                        {isSelected && (
                          <span className={`${compact ? 'text-[9px] px-1.5 py-px' : 'text-xs px-2 py-0.5'} bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300 rounded`}>
                            {t('codexReasoningEffort.selector.active')}
                          </span>
                        )}
                      </div>
                      {!compact && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                          {effort.description}
                        </p>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {!compact && (
            <div className="p-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
              <p className="text-xs text-gray-600 dark:text-gray-400">
                <strong>Tip:</strong> {t('codexReasoningEffort.selector.tip')}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
