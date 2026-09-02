import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, KeyboardEvent, RefObject, SetStateAction } from 'react';
import Fuse from 'fuse.js';
import { authenticatedFetch } from '../../../utils/api';
import { safeLocalStorage } from '../utils/chatStorage';
import type { Project, SessionProvider } from '../../../types/app';
import {
  normalizeSkillMentionCandidates,
  type SkillMentionCandidate,
} from '../utils/skillMentions';

const COMMAND_QUERY_DEBOUNCE_MS = 150;

export interface SlashCommand {
  name: string;
  description?: string;
  namespace?: string;
  path?: string;
  type?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

interface UseSlashCommandsOptions {
  selectedProject: Project | null;
  provider: SessionProvider;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  textareaRef: RefObject<HTMLTextAreaElement>;
  onExecuteCommand: (command: SlashCommand, rawInput?: string) => void | Promise<void>;
}

const getCommandHistoryKey = (projectName: string) => `command_history_${projectName}`;

const readCommandHistory = (projectName: string): Record<string, number> => {
  const history = safeLocalStorage.getItem(getCommandHistoryKey(projectName));
  if (!history) {
    return {};
  }

  try {
    return JSON.parse(history);
  } catch (error) {
    console.error('Error parsing command history:', error);
    return {};
  }
};

const saveCommandHistory = (projectName: string, history: Record<string, number>) => {
  safeLocalStorage.setItem(getCommandHistoryKey(projectName), JSON.stringify(history));
};

const isPromiseLike = (value: unknown): value is Promise<unknown> =>
  Boolean(value) && typeof (value as Promise<unknown>).then === 'function';

export function useSlashCommands({
  selectedProject,
  provider,
  input,
  setInput,
  textareaRef,
  onExecuteCommand,
}: UseSlashCommandsOptions) {
  const [slashCommands, setSlashCommands] = useState<SlashCommand[]>([]);
  const [skillMentionCandidates, setSkillMentionCandidates] = useState<SkillMentionCandidate[]>([]);
  const [filteredCommands, setFilteredCommands] = useState<SlashCommand[]>([]);
  const [showCommandMenu, setShowCommandMenu] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(-1);
  const [slashPosition, setSlashPosition] = useState(-1);

  const commandQueryTimerRef = useRef<number | null>(null);

  const clearCommandQueryTimer = useCallback(() => {
    if (commandQueryTimerRef.current !== null) {
      window.clearTimeout(commandQueryTimerRef.current);
      commandQueryTimerRef.current = null;
    }
  }, []);

  const resetCommandMenuState = useCallback(() => {
    setShowCommandMenu(false);
    setSlashPosition(-1);
    setCommandQuery('');
    setSelectedCommandIndex(-1);
    clearCommandQueryTimer();
  }, [clearCommandQueryTimer]);

  useEffect(() => {
    let cancelled = false;
    setSlashCommands([]);
    setFilteredCommands([]);
    const fetchSlashItems = async () => {
      if (!selectedProject) {
        setSlashCommands([]);
        setSkillMentionCandidates([]);
        setFilteredCommands([]);
        return;
      }

      try {
        const [commandsResponse, skillsResponse] = await Promise.all([
          authenticatedFetch('/api/commands/list', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              projectPath: selectedProject.path,
              provider,
            }),
          }),
          authenticatedFetch('/api/skills/mentions'),
        ]);

        if (!commandsResponse.ok) {
          throw new Error('Failed to fetch commands');
        }

        const data = await commandsResponse.json();
        const allCommands: SlashCommand[] = [
          ...((data.builtIn || []) as SlashCommand[]).map((command) => ({
            ...command,
            type: 'built-in',
          })),
          ...((data.custom || []) as SlashCommand[]).map((command) => ({
            ...command,
            type: 'custom',
          })),
        ];

        let skills: SkillMentionCandidate[] = [];
        if (skillsResponse.ok) {
          const skillsData = await skillsResponse.json();
          skills = normalizeSkillMentionCandidates(skillsData?.skills || []);
        }

        const parsedHistory = readCommandHistory(selectedProject.name);
        const sortedCommands = [...allCommands].sort((commandA, commandB) => {
          const commandAUsage = parsedHistory[commandA.name] || 0;
          const commandBUsage = parsedHistory[commandB.name] || 0;
          return commandBUsage - commandAUsage;
        });

        if (cancelled) return;
        setSlashCommands(sortedCommands);
        setSkillMentionCandidates(skills);
      } catch (error) {
        if (cancelled) return;
        console.error('Error fetching slash commands:', error);
        setSlashCommands([]);
        setSkillMentionCandidates([]);
      }
    };

    fetchSlashItems();
    return () => { cancelled = true; };
  }, [selectedProject, provider]);

  const skillSlashCommands = useMemo<SlashCommand[]>(
    () => skillMentionCandidates.map((skill) => ({
      name: `/${skill.mention}`,
      description: skill.description || skill.name,
      namespace: 'skill',
      type: 'skill',
      metadata: {
        type: 'skill',
        skillMention: skill.mention,
        skillName: skill.name,
        skillDirPath: skill.dirPath,
      },
    })),
    [provider, skillMentionCandidates],
  );

  const slashItems = useMemo<SlashCommand[]>(
    () => [...slashCommands, ...skillSlashCommands],
    [skillSlashCommands, slashCommands],
  );

  const isSkillCommand = useCallback((command: SlashCommand | null | undefined) => (
    command?.namespace === 'skill' || command?.type === 'skill' || command?.metadata?.type === 'skill'
  ), []);

  const insertSlashItem = useCallback(
    (command: SlashCommand) => {
      const textBeforeSlash = input.slice(0, slashPosition);
      const textAfterSlash = input.slice(slashPosition);
      const spaceIndex = textAfterSlash.indexOf(' ');
      const textAfterQuery = spaceIndex !== -1 ? textAfterSlash.slice(spaceIndex) : '';
      const needsSpace = !textAfterQuery.startsWith(' ');
      const newInput = `${textBeforeSlash}${command.name}${needsSpace ? ' ' : ''}${textAfterQuery}`;
      const cursorPosition = textBeforeSlash.length + command.name.length + (needsSpace ? 1 : 0);

      setInput(newInput);
      resetCommandMenuState();

      requestAnimationFrame(() => {
        if (!textareaRef.current) {
          return;
        }
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(cursorPosition, cursorPosition);
      });
    },
    [input, resetCommandMenuState, setInput, slashPosition, textareaRef],
  );

  useEffect(() => {
    if (!showCommandMenu) {
      setSelectedCommandIndex(-1);
    }
  }, [showCommandMenu]);

  const fuse = useMemo(() => {
    if (!slashItems.length) {
      return null;
    }

    return new Fuse(slashItems, {
      keys: [
        { name: 'name', weight: 2 },
        { name: 'description', weight: 1 },
      ],
      threshold: 0.4,
      includeScore: true,
      minMatchCharLength: 1,
    });
  }, [slashItems]);

  useEffect(() => {
    if (!commandQuery) {
      setFilteredCommands(slashItems);
      return;
    }

    if (!fuse) {
      setFilteredCommands([]);
      return;
    }

    const results = fuse.search(commandQuery);
    setFilteredCommands(results.map((result) => result.item));
  }, [commandQuery, slashItems, fuse]);

  const frequentCommands = useMemo(() => {
    if (!selectedProject || slashCommands.length === 0) {
      return [];
    }

    const parsedHistory = readCommandHistory(selectedProject.name);

    return slashCommands
      .map((command) => ({
        ...command,
        usageCount: parsedHistory[command.name] || 0,
      }))
      .filter((command) => command.usageCount > 0)
      .sort((commandA, commandB) => commandB.usageCount - commandA.usageCount)
      .slice(0, 5);
  }, [selectedProject, slashCommands]);

  const trackCommandUsage = useCallback(
    (command: SlashCommand) => {
      if (!selectedProject) {
        return;
      }

      const parsedHistory = readCommandHistory(selectedProject.name);
      parsedHistory[command.name] = (parsedHistory[command.name] || 0) + 1;
      saveCommandHistory(selectedProject.name, parsedHistory);
    },
    [selectedProject],
  );

  const selectCommandFromKeyboard = useCallback(
    (command: SlashCommand) => {
      if (isSkillCommand(command)) {
        insertSlashItem(command);
        return;
      }

      const executionResult = onExecuteCommand(command);
      if (isPromiseLike(executionResult)) {
        executionResult.catch(() => {
          // Keep behavior silent; execution errors are handled by caller.
        });
      }
    },
    [insertSlashItem, isSkillCommand, onExecuteCommand],
  );

  const handleCommandSelect = useCallback(
    (command: SlashCommand | null, index: number, isHover: boolean) => {
      if (!command || !selectedProject) {
        return;
      }

      if (isHover) {
        setSelectedCommandIndex(index);
        return;
      }

      if (isSkillCommand(command)) {
        insertSlashItem(command);
        return;
      }

      trackCommandUsage(command);
      const executionResult = onExecuteCommand(command);

      if (isPromiseLike(executionResult)) {
        executionResult.then(() => {
          resetCommandMenuState();
        });
        executionResult.catch(() => {
          // Keep behavior silent; execution errors are handled by caller.
        });
      } else {
        resetCommandMenuState();
      }
    },
    [insertSlashItem, isSkillCommand, selectedProject, trackCommandUsage, onExecuteCommand, resetCommandMenuState],
  );

  const handleToggleCommandMenu = useCallback(() => {
    const isOpening = !showCommandMenu;
    setShowCommandMenu(isOpening);
    setCommandQuery('');
    setSelectedCommandIndex(-1);

    if (isOpening) {
      setFilteredCommands(slashItems);
    }

    textareaRef.current?.focus();
  }, [showCommandMenu, slashItems, textareaRef]);

  const handleCommandInputChange = useCallback(
    (newValue: string, cursorPos: number) => {
      if (!newValue.trim()) {
        resetCommandMenuState();
        return;
      }

      const textBeforeCursor = newValue.slice(0, cursorPos);
      const backticksBefore = (textBeforeCursor.match(/```/g) || []).length;
      const inCodeBlock = backticksBefore % 2 === 1;

      if (inCodeBlock) {
        resetCommandMenuState();
        return;
      }

      const slashPattern = /(^|\s)\/(\S*)$/;
      const match = textBeforeCursor.match(slashPattern);

      if (!match) {
        resetCommandMenuState();
        return;
      }

      const slashPos = (match.index || 0) + match[1].length;
      const query = match[2];

      setSlashPosition(slashPos);
      setShowCommandMenu(true);
      setSelectedCommandIndex(-1);

      clearCommandQueryTimer();
      commandQueryTimerRef.current = window.setTimeout(() => {
        setCommandQuery(query);
      }, COMMAND_QUERY_DEBOUNCE_MS);
    },
    [resetCommandMenuState, clearCommandQueryTimer],
  );

  const handleCommandMenuKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!showCommandMenu) {
        return false;
      }

      if (!filteredCommands.length) {
        if (event.key === 'Escape') {
          event.preventDefault();
          resetCommandMenuState();
          return true;
        }
        return false;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSelectedCommandIndex((previousIndex) =>
          previousIndex < filteredCommands.length - 1 ? previousIndex + 1 : 0,
        );
        return true;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSelectedCommandIndex((previousIndex) =>
          previousIndex > 0 ? previousIndex - 1 : filteredCommands.length - 1,
        );
        return true;
      }

      if (event.key === 'Tab' || event.key === 'Enter') {
        event.preventDefault();
        if (selectedCommandIndex >= 0) {
          selectCommandFromKeyboard(filteredCommands[selectedCommandIndex]);
        } else if (filteredCommands.length > 0) {
          selectCommandFromKeyboard(filteredCommands[0]);
        }
        return true;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        resetCommandMenuState();
        return true;
      }

      return false;
    },
    [showCommandMenu, filteredCommands, resetCommandMenuState, selectCommandFromKeyboard, selectedCommandIndex],
  );

  useEffect(
    () => () => {
      clearCommandQueryTimer();
    },
    [clearCommandQueryTimer],
  );

  return {
    slashCommands,
    skillMentionCandidates,
    slashCommandsCount: slashItems.length,
    filteredCommands,
    frequentCommands,
    commandQuery,
    showCommandMenu,
    selectedCommandIndex,
    resetCommandMenuState,
    handleCommandSelect,
    handleToggleCommandMenu,
    handleCommandInputChange,
    handleCommandMenuKeyDown,
  };
}
