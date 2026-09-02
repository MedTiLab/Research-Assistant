import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronRight, Code2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '../../../../lib/utils';
import type { Project } from '../../../../types/app';
import {
  ANALYSIS_LANGUAGE_PREFERENCES,
  type AnalysisLanguagePreference,
  getStoredAnalysisLanguagePreference,
  setStoredAnalysisLanguagePreference,
} from '../../../../utils/analysisLanguagePreference';

interface AnalysisLanguageSelectorProps {
  selectedProject: Project | null;
  variant?: 'inline' | 'menu' | 'icon';
  className?: string;
  active?: boolean;
  inGroup?: boolean;
}

type LanguageOptionMeta = {
  value: AnalysisLanguagePreference;
  icon: JSX.Element;
};

function AnalysisLanguageIcon({ language }: { language: AnalysisLanguagePreference }) {
  if (language === 'python') {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4 flex-shrink-0" aria-hidden="true">
        <path
          d="M12.2 2.2c-4.4 0-4 2-4 2v2h4.1v1H6.6c0 0-2.8-.3-2.8 4.1 0 4.4 2.4 4.2 2.4 4.2h1.4v-2c0 0-.1-2.4 2.4-2.4h4.1c0 0 2.3 0 2.3-2.3V4.6c0 0 .4-2.4-4.2-2.4Z"
          fill="#3776AB"
        />
        <circle cx="10.2" cy="4.8" r="1" fill="#fff" />
        <path
          d="M11.8 21.8c4.4 0 4-2 4-2v-2h-4.1v-1h5.7c0 0 2.8.3 2.8-4.1 0-4.4-2.4-4.2-2.4-4.2h-1.4v2c0 0 .1 2.4-2.4 2.4H9.9c0 0-2.3 0-2.3 2.3v4.1c0 0-.4 2.4 4.2 2.4Z"
          fill="#FFD43B"
        />
        <circle cx="13.8" cy="19.2" r="1" fill="#fff" />
      </svg>
    );
  }

  if (language === 'r') {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4 flex-shrink-0" aria-hidden="true">
        <ellipse cx="11.4" cy="12" rx="8.4" ry="5.8" fill="#C6CDD3" />
        <ellipse cx="11.7" cy="12" rx="5.2" ry="3.2" fill="#fff" />
        <text
          x="8.2"
          y="16.1"
          fontSize="11"
          fontWeight="700"
          fill="#276DC3"
          fontFamily="ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
        >
          R
        </text>
      </svg>
    );
  }

  return <Code2 className="h-4 w-4 flex-shrink-0 text-muted-foreground" />;
}

const MENU_OPTIONS: LanguageOptionMeta[] = [
  { value: 'python', icon: <AnalysisLanguageIcon language="python" /> },
  { value: 'r', icon: <AnalysisLanguageIcon language="r" /> },
  { value: 'auto', icon: <AnalysisLanguageIcon language="auto" /> },
];

const ICON_BUTTON_CLASS = 'inline-flex h-7 min-h-7 w-7 min-w-7 flex-none items-center justify-center rounded-lg border p-0 leading-none shadow-sm transition-colors duration-150 [&_svg]:block [&_svg]:h-3.5 [&_svg]:w-3.5';
const MENU_MIN_WIDTH = 192;
const MENU_GAP = 8;
const MENU_Z_INDEX = 9999;

type MenuPosition = {
  top: number;
  left: number;
};

function useFloatingMenuPosition(
  isOpen: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  menuRef: RefObject<HTMLElement | null>,
) {
  const [position, setPosition] = useState<MenuPosition | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setPosition(null);
      return undefined;
    }

    const updatePosition = () => {
      const anchorRect = anchorRef.current?.getBoundingClientRect();
      if (!anchorRect) {
        return;
      }

      const menuWidth = menuRef.current?.offsetWidth ?? MENU_MIN_WIDTH;
      const menuHeight = menuRef.current?.offsetHeight ?? 0;
      const viewportPadding = 8;
      const nextLeft = Math.max(
        viewportPadding,
        Math.min(
          anchorRect.left - menuWidth - MENU_GAP,
          window.innerWidth - menuWidth - viewportPadding,
        ),
      );
      const nextTop = Math.max(
        viewportPadding,
        Math.min(
          anchorRect.top,
          window.innerHeight - Math.max(menuHeight, 1) - viewportPadding,
        ),
      );

      setPosition({ top: nextTop, left: nextLeft });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [anchorRef, isOpen, menuRef]);

  return position;
}

export default function AnalysisLanguageSelector({
  selectedProject,
  variant = 'inline',
  className = '',
  active = false,
  inGroup = false,
}: AnalysisLanguageSelectorProps) {
  const { t } = useTranslation('chat');
  const containerRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState<AnalysisLanguagePreference>(() => (
    getStoredAnalysisLanguagePreference(selectedProject)
  ));
  const [isOpen, setIsOpen] = useState(false);
  const menuPosition = useFloatingMenuPosition(isOpen, anchorRef, menuRef);

  useEffect(() => {
    setValue(getStoredAnalysisLanguagePreference(selectedProject));
  }, [selectedProject?.fullPath, selectedProject?.name]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      const clickedTrigger = containerRef.current?.contains(target);
      const clickedMenu = menuRef.current?.contains(target);

      if (!clickedTrigger && !clickedMenu) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleSelectOption = useCallback((optionValue: AnalysisLanguagePreference) => {
    if (!selectedProject) {
      return;
    }

    const nextValue = setStoredAnalysisLanguagePreference(selectedProject, optionValue);
    setValue(nextValue);
    setIsOpen(false);
  }, [selectedProject]);

  const renderFloatingMenu = (itemClassName: string, panelClassName: string) => {
    if (!isOpen || typeof document === 'undefined') {
      return null;
    }

    const anchorRect = anchorRef.current?.getBoundingClientRect();
    const resolvedPosition = menuPosition ?? (anchorRect
      ? {
          top: anchorRect.top,
          left: Math.max(8, anchorRect.left - MENU_MIN_WIDTH - MENU_GAP),
        }
      : null);

    if (!resolvedPosition) {
      return null;
    }

    return createPortal(
      <div
        ref={menuRef}
        className={cn(
          'fixed min-w-[12rem] overflow-hidden border border-border bg-background p-1.5 shadow-2xl',
          panelClassName,
        )}
        style={{
          top: resolvedPosition.top,
          left: resolvedPosition.left,
          zIndex: MENU_Z_INDEX,
        }}
        role="menu"
      >
        {MENU_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => handleSelectOption(option.value)}
            className={cn(
              'flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors',
              itemClassName,
              option.value === value
                ? 'bg-primary/8 text-foreground'
                : 'text-foreground/88 hover:bg-muted/60',
            )}
            role="menuitem"
          >
            <span className="flex min-w-0 flex-1 items-center gap-3">
              {option.icon}
              <span className="truncate">{t(`analysisLanguage.options.${option.value}`)}</span>
            </span>

            {option.value === value ? (
              <Check className="h-4 w-4 flex-shrink-0 text-foreground" />
            ) : null}
          </button>
        ))}
      </div>,
      document.body,
    );
  };

  if (!selectedProject) {
    return null;
  }

  if (variant === 'icon') {
    const currentOption = MENU_OPTIONS.find((option) => option.value === value) || MENU_OPTIONS[0];

    return (
      <div className={cn('relative flex-shrink-0', className)} ref={containerRef}>
        <button
          ref={anchorRef}
          type="button"
          onClick={() => setIsOpen((previous) => !previous)}
          className={cn(
            ICON_BUTTON_CLASS,
            inGroup
              ? isOpen || active
                ? 'border-primary/30 bg-primary/10 text-foreground'
                : 'border-border/70 bg-background/85 text-muted-foreground hover:text-foreground'
              : isOpen || active
                ? 'border-primary/30 bg-primary/10 text-foreground'
                : 'border-border/70 bg-background/85 text-muted-foreground hover:text-foreground',
          )}
          aria-label={t('analysisLanguage.selector.label')}
          title={t('analysisLanguage.selector.title')}
          aria-haspopup="menu"
          aria-expanded={isOpen}
        >
          {currentOption.icon}
        </button>

        {renderFloatingMenu('rounded-md', 'rounded-lg')}
      </div>
    );
  }

  if (variant === 'menu') {
    const currentOption = MENU_OPTIONS.find((option) => option.value === value) || MENU_OPTIONS[0];

    return (
      <div
        className="relative"
        ref={containerRef}
      >
        <button
          ref={anchorRef}
          type="button"
          onClick={() => setIsOpen((previous) => !previous)}
          className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${
            isOpen ? 'bg-primary/8 text-foreground' : 'text-foreground/88 hover:bg-muted/60'
          }`}
          aria-label={t('analysisLanguage.selector.label')}
          title={t('analysisLanguage.selector.description')}
          aria-haspopup="menu"
          aria-expanded={isOpen}
        >
          <span className="flex min-w-0 flex-1 items-center gap-3">
            <Code2 className="h-4 w-4 flex-shrink-0" />
            <span className="truncate">{t('analysisLanguage.selector.title')}</span>
          </span>

          <span className="flex items-center gap-2 text-muted-foreground">
            {currentOption.icon}
            <ChevronRight className={`h-4 w-4 transition-transform ${isOpen ? 'translate-x-0.5' : ''}`} />
          </span>
        </button>

        {renderFloatingMenu('rounded-xl', 'rounded-2xl')}
      </div>
    );
  }

  return (
    <label
      className="hidden md:flex items-center gap-2 rounded-md border border-border/70 bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground"
      title={t('analysisLanguage.selector.description')}
    >
      <span className="flex items-center gap-1.5 whitespace-nowrap">
        <Code2 className="h-3.5 w-3.5" />
        <span>{t('analysisLanguage.selector.title')}</span>
      </span>

      <select
        value={value}
        onChange={(event) => {
          const nextValue = setStoredAnalysisLanguagePreference(
            selectedProject,
            event.target.value as AnalysisLanguagePreference,
          );
          setValue(nextValue);
        }}
        className="min-w-[96px] border-0 bg-transparent p-0 text-xs font-medium text-foreground focus:outline-none"
        aria-label={t('analysisLanguage.selector.label')}
      >
        {ANALYSIS_LANGUAGE_PREFERENCES.map((option) => (
          <option key={option} value={option}>
            {t(`analysisLanguage.options.${option}`)}
          </option>
        ))}
      </select>
    </label>
  );
}
