/**
 * Utility functions for formatting and cleaning session content on the frontend.
 */

import { medHelpDataFolderContextBlockPattern } from '../../shared/dataFolderPromptContext.js';
import { extractVisibleUserContent } from '../../shared/visibleUserContent.js';

/**
 * Strips internal [Context: ...] prefixes from message text.
 * Handles full prefixes [Context: ...] and common truncated ones like [Context: Tre...
 * @param value - The message text
 * @param returnDefaultOnEmpty - Whether to return 'New Session' if result is empty
 * @returns - Cleaned text or null/default if empty
 */
export const stripInternalContextPrefix = (value: string, returnDefaultOnEmpty = true): string | null => {
  if (typeof value !== 'string') return returnDefaultOnEmpty ? '' : null;

  // Marked prompts use a visibility allowlist. Do not inspect or render any
  // provider/runtime text outside the user-authored boundary.
  const explicitlyVisibleText = extractVisibleUserContent(value);
  if (explicitlyVisibleText !== null) {
    const visibleResult = explicitlyVisibleText.trim();
    return visibleResult || (returnDefaultOnEmpty ? 'New Session' : null);
  }

  let cleaned = value;
  let hasMatch = false;

  // Codex history can contain the full effective prompt. Preserve only the
  // real request; the skill/instruction scaffold is backend-only.
  const internalPromptHeaderPattern = /^\s*#\s+(?:MedHelp Skills(?:\s*\(|\s+Reminder\b)|Project Instructions\s*\((?:AGENTS|CLAUDE)\.md\))/i;
  if (internalPromptHeaderPattern.test(cleaned)) {
    const markerPattern = /(?:^|\n)\s*User request:\s*(?:\n|$)/gi;
    const markers = [...cleaned.matchAll(markerPattern)];
    const lastMarker = markers.at(-1);
    if (!lastMarker || lastMarker.index === undefined) {
      return returnDefaultOnEmpty ? 'New Session' : null;
    }
    cleaned = cleaned.slice(lastMarker.index + lastMarker[0].length);
    hasMatch = true;
  }

  // Automatic project memory is appended after the visible request. Keep it
  // available to the provider, but never render it as part of the user bubble.
  const projectMemorySuffixPattern = /(?:\r?\n)+\s*## What you remember\s*(?:\r?\n)+[\s\S]*?<medhelp_project_memory>[\s\S]*?<\/medhelp_project_memory>\s*$/i;
  if (projectMemorySuffixPattern.test(cleaned)) {
    cleaned = cleaned.replace(projectMemorySuffixPattern, '');
    hasMatch = true;
  }

  const internalCommandTagPattern = /<\/?(?:command-name|command-message|command-args|local-command-stdout)>/i;
  const skillContentPattern = /Base directory for this skill:\s*\S+/i;
  const agentComputeContextBlockPattern = /^\s*<medhelp_compute_context>[\s\S]*?<\/medhelp_compute_context>\s*/i;
  const truncatedAgentComputeContextPattern = /^\s*<medhelp_compute_context>[\s\S]*$/i;
  const codexInternalContextBlockPattern = /^\s*<codex_internal_context\b[^>]*>[\s\S]*?<\/codex_internal_context>\s*/i;
  const truncatedCodexInternalContextPattern = /^\s*<codex_internal_context\b[\s\S]*$/i;
  // Older Claude session files predate the explicit XML wrapper. The legacy
  // compute preamble is always separated from the real prompt by a blank line.
  const legacyAgentComputeContextBlockPattern = /^\s*\[MedHelp Kernel compute resource\][\s\S]*?\r?\n[ \t]*\r?\n[ \t]*/i;
  const analysisPreferencesBlockPattern = /^\s*<analysis_preferences>[\s\S]*?<\/analysis_preferences>\s*/i;
  const truncatedAnalysisPreferencesPattern = /^\s*<analysis_preferences>[\s\S]*$/i;
  const userPreferencesBlockPattern = /^\s*<user_preferences>[\s\S]*?<\/user_preferences>\s*/i;
  const truncatedUserPreferencesPattern = /^\s*<user_preferences>[\s\S]*$/i;
  const userMemoryBlockPattern = /^\s*<user_memory>[\s\S]*?<\/user_memory>\s*/i;
  const truncatedUserMemoryPattern = /^\s*<user_memory>[\s\S]*$/i;
  const executionMemoryBlockPattern = /^\s*<execution_memory>[\s\S]*?<\/execution_memory>\s*/i;
  const truncatedExecutionMemoryPattern = /^\s*<execution_memory>[\s\S]*$/i;
  const projectMemoryBlockPattern = /^\s*<medhelp_project_memory>[\s\S]*?<\/medhelp_project_memory>\s*/i;
  const truncatedProjectMemoryPattern = /^\s*<medhelp_project_memory>[\s\S]*$/i;
  const pathDisplayRuleBlockPattern = /^\s*<path_display_rule>[\s\S]*?<\/path_display_rule>\s*/i;
  const truncatedPathDisplayRulePattern = /^\s*<path_display_rule>[\s\S]*$/i;
  const researchLessonsBlockPattern = /^\s*<research_lessons>[\s\S]*?<\/research_lessons>\s*/i;
  const truncatedResearchLessonsPattern = /^\s*<research_lessons>[\s\S]*$/i;
  const fullPrefixPattern = /^\s*\[Context:[^\]]*\]\s*/i;
  const userRequestLabelPattern = /^\s*User request:\s*/i;
  const leadingInternalBlockPatterns = [
    medHelpDataFolderContextBlockPattern,
    codexInternalContextBlockPattern,
    agentComputeContextBlockPattern,
    legacyAgentComputeContextBlockPattern,
    fullPrefixPattern,
    analysisPreferencesBlockPattern,
    userPreferencesBlockPattern,
    userMemoryBlockPattern,
    executionMemoryBlockPattern,
    projectMemoryBlockPattern,
    pathDisplayRuleBlockPattern,
    researchLessonsBlockPattern,
  ];

  const stripLeadingInternalMarkers = () => {
    let changed = false;
    let shouldContinue = true;

    while (shouldContinue) {
      shouldContinue = false;

      for (const pattern of leadingInternalBlockPatterns) {
        if (pattern.test(cleaned)) {
          cleaned = cleaned.replace(pattern, '');
          changed = true;
          shouldContinue = true;
          break;
        }
      }

      if ((changed || hasMatch) && userRequestLabelPattern.test(cleaned)) {
        cleaned = cleaned.replace(userRequestLabelPattern, '');
        shouldContinue = true;
      }
    }

    return changed;
  };

  if (internalCommandTagPattern.test(cleaned) || skillContentPattern.test(cleaned)) {
    cleaned = cleaned
      .replace(/<command-name>[^<]*<\/command-name>/gi, '')
      .replace(/<command-message>[^<]*<\/command-message>/gi, '')
      .replace(/<command-args>[^<]*<\/command-args>/gi, '')
      .replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/gi, '')
      .replace(/^[❯>]\s*Base directory for this skill:\s*\S+\s*/gim, '')
      .replace(/^Base directory for this skill:\s*\S+\s*/gim, '')
      .trim();
    hasMatch = true;
  }

  if (stripLeadingInternalMarkers()) {
    hasMatch = true;
  }

  // 2. Match common truncated prefixes like "[Context: session-mode=..." or "[Context: Tre..."
  const truncatedPrefixPattern = /^\s*\[Context:[^\]]*$/i;
  if (truncatedPrefixPattern.test(cleaned)) {
    return returnDefaultOnEmpty ? 'New Session' : null;
  }

  if (truncatedAnalysisPreferencesPattern.test(cleaned)) {
    return returnDefaultOnEmpty ? 'New Session' : null;
  }

  if (truncatedAgentComputeContextPattern.test(cleaned)) {
    return returnDefaultOnEmpty ? 'New Session' : null;
  }

  if (truncatedCodexInternalContextPattern.test(cleaned)) {
    return returnDefaultOnEmpty ? 'New Session' : null;
  }

  if (truncatedUserPreferencesPattern.test(cleaned)) {
    return returnDefaultOnEmpty ? 'New Session' : null;
  }

  if (truncatedUserMemoryPattern.test(cleaned)) {
    return returnDefaultOnEmpty ? 'New Session' : null;
  }

  if (truncatedExecutionMemoryPattern.test(cleaned)) {
    return returnDefaultOnEmpty ? 'New Session' : null;
  }

  if (truncatedProjectMemoryPattern.test(cleaned)) {
    return returnDefaultOnEmpty ? 'New Session' : null;
  }

  if (truncatedPathDisplayRulePattern.test(cleaned)) {
    return returnDefaultOnEmpty ? 'New Session' : null;
  }

  if (truncatedResearchLessonsPattern.test(cleaned)) {
    return returnDefaultOnEmpty ? 'New Session' : null;
  }

  let result = cleaned.trim();
  if (!result && hasMatch) {
    const embeddedUserRequestMatch = value.match(/User request:\s*([\s\S]*?)\s*$/i);
    if (embeddedUserRequestMatch?.[1]?.trim()) {
      result = stripInternalContextPrefix(embeddedUserRequestMatch[1].trim(), false) || '';
    }
  }

  if (!hasMatch && result) {
    return result;
  }

  if (!result && hasMatch) {
    if (!returnDefaultOnEmpty) return null;
    
    // Semantic fallbacks
    if (value.includes('session-mode=workspace_qa')) return 'Workspace Q&A';
    if (value.includes('session-mode=research')) return 'Research Session';
    
    return 'New Session';
  }

  return result || (returnDefaultOnEmpty ? 'New Session' : null);
};
