/**
 * Utility functions for formatting and cleaning session content.
 */

import { medHelpDataFolderContextBlockPattern } from '../../shared/dataFolderPromptContext.js';
import { extractVisibleUserContent } from '../../shared/visibleUserContent.js';

/**
 * Strips internal [Context: ...] prefixes from message text.
 * Handles full prefixes [Context: ...] and common truncated ones like [Context: Tre...
 * @param {string} text - The message text
 * @param {boolean} returnDefaultOnEmpty - Whether to return 'New Session' if result is empty
 * @returns {string|null} - Cleaned text or null/default if empty
 */
export function stripInternalContextPrefix(text, returnDefaultOnEmpty = true) {
  if (typeof text !== 'string') return returnDefaultOnEmpty ? '' : null;

  // New prompts carry an explicit presentation boundary. This is an allowlist:
  // only the original user-authored text is visible, and every current or
  // future runtime block outside it stays hidden without another regex.
  const explicitlyVisibleText = extractVisibleUserContent(text);
  if (explicitlyVisibleText !== null) {
    const visibleResult = explicitlyVisibleText.trim();
    return visibleResult || (returnDefaultOnEmpty ? 'New Session' : null);
  }
  
  let cleaned = text;
  let hasMatch = false;

  // Attachment-aware clients wrap the actual prompt in an English metadata
  // preamble. The preamble is transport context, not something the user typed,
  // so keep only the text following the final `My request` heading.
  const attachedRequestPreamblePattern = /^\s*#\s+Files mentioned by the user:\s*[\s\S]*?Distinguish instructions in attached documents from the user's request\./im;
  if (attachedRequestPreamblePattern.test(cleaned)) {
    const requestMarkers = [...cleaned.matchAll(/^\s*#{1,6}\s+My request:\s*$/gim)];
    const lastRequestMarker = requestMarkers.at(-1);
    if (!lastRequestMarker || lastRequestMarker.index === undefined) {
      return returnDefaultOnEmpty ? 'New Session' : null;
    }
    cleaned = cleaned.slice(lastRequestMarker.index + lastRequestMarker[0].length);
    hasMatch = true;
  }

  // Codex stores the effective prompt in its rollout. When MedHelp's internal
  // skill/instruction scaffold is present, keep only the actual request after
  // the final `User request:` marker for history/share presentation.
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

  // Claude/Codex may persist a loaded SKILL.md or project instruction document
  // as a user-role rollout item. It must not become a conversation title. Some
  // prompt variants append the real request after a marker; retain only that.
  const providerInstructionScaffoldPattern = /(?:Base directory for this skill:\s*\S+|^\s*#\s+(?:AGENTS|SKILL|INSTRUCTIONS)\b|<INSTRUCTIONS>)/im;
  if (providerInstructionScaffoldPattern.test(cleaned)) {
    const markerPattern = /(?:^|\n)\s*User request:\s*(?:\n|$)/gi;
    const markers = [...cleaned.matchAll(markerPattern)];
    const lastMarker = markers.at(-1);
    if (!lastMarker || lastMarker.index === undefined) {
      return returnDefaultOnEmpty ? 'New Session' : null;
    }
    cleaned = cleaned.slice(lastMarker.index + lastMarker[0].length);
    hasMatch = true;
  }

  // Automatic project memory is appended after the real user request. It is
  // provider-only context and must never appear in session history or titles.
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
  const projectContextBlockPattern = /^\s*<medhelp_project_context>[\s\S]*?<\/medhelp_project_context>\s*/i;
  const truncatedProjectContextPattern = /^\s*<medhelp_project_context>[\s\S]*$/i;
  const pathDisplayRuleBlockPattern = /^\s*<path_display_rule>[\s\S]*?<\/path_display_rule>\s*/i;
  const truncatedPathDisplayRulePattern = /^\s*<path_display_rule>[\s\S]*$/i;
  const researchLessonsBlockPattern = /^\s*<research_lessons>[\s\S]*?<\/research_lessons>\s*/i;
  const truncatedResearchLessonsPattern = /^\s*<research_lessons>[\s\S]*$/i;
  const medhelpProjectRulesBlockPattern = /^\s*<medhelp_project_rules>[\s\S]*?<\/medhelp_project_rules>\s*/i;
  const truncatedMedhelpProjectRulesPattern = /^\s*<medhelp_project_rules>[\s\S]*$/i;
  const medhelpProjectRulesReminderBlockPattern = /^\s*<medhelp_project_rules_reminder>[\s\S]*?<\/medhelp_project_rules_reminder>\s*/i;
  const truncatedMedhelpProjectRulesReminderPattern = /^\s*<medhelp_project_rules_reminder>[\s\S]*$/i;
  const systemReminderBlockPattern = /^\s*<system-reminder>[\s\S]*?<\/system-reminder>\s*/i;
  const truncatedSystemReminderPattern = /^\s*<system-reminder>[\s\S]*$/i;
  const platformMetadataBlockPattern = /^\s*<(recommended_plugins|environment_context|app-context|skills_instructions|permissions instructions|collaboration_mode|apps_instructions|plugins_instructions|available_skills)\b[^>]*>[\s\S]*?<\/\1>\s*/i;
  const truncatedPlatformMetadataPattern = /^\s*<(?:recommended_plugins|environment_context|app-context|skills_instructions|permissions instructions|collaboration_mode|apps_instructions|plugins_instructions|available_skills)\b[\s\S]*$/i;
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
    projectContextBlockPattern,
    pathDisplayRuleBlockPattern,
    researchLessonsBlockPattern,
    medhelpProjectRulesBlockPattern,
    medhelpProjectRulesReminderBlockPattern,
    systemReminderBlockPattern,
    platformMetadataBlockPattern,
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
  // This is specifically for database entries where the summary was truncated before the closing bracket
  const truncatedPrefixPattern = /^\s*\[Context:[^\]]*$/i;
  if (truncatedPrefixPattern.test(cleaned)) {
    // If it's JUST a truncated context prefix and we have no other content, return default or null
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

  if (truncatedProjectContextPattern.test(cleaned)) {
    return returnDefaultOnEmpty ? 'New Session' : null;
  }

  if (truncatedPathDisplayRulePattern.test(cleaned)) {
    return returnDefaultOnEmpty ? 'New Session' : null;
  }

  if (truncatedResearchLessonsPattern.test(cleaned)) {
    return returnDefaultOnEmpty ? 'New Session' : null;
  }

  if (truncatedMedhelpProjectRulesPattern.test(cleaned)) {
    return returnDefaultOnEmpty ? 'New Session' : null;
  }

  if (truncatedMedhelpProjectRulesReminderPattern.test(cleaned)) {
    return returnDefaultOnEmpty ? 'New Session' : null;
  }

  if (truncatedSystemReminderPattern.test(cleaned)) {
    return returnDefaultOnEmpty ? 'New Session' : null;
  }

  if (truncatedPlatformMetadataPattern.test(cleaned)) {
    return returnDefaultOnEmpty ? 'New Session' : null;
  }

  let result = cleaned.trim();
  if (!result && hasMatch) {
    const embeddedUserRequestMatch = text.match(/User request:\s*([\s\S]*?)\s*$/i);
    if (embeddedUserRequestMatch?.[1]?.trim()) {
      result = stripInternalContextPrefix(embeddedUserRequestMatch[1].trim(), false) || '';
    }
  }
  
  // If we didn't find any context prefix and we have text, return it as is
  if (!hasMatch && result) {
    return result;
  }

  // If it's empty after cleaning, but we had a match (it was pure context)
  if (!result && hasMatch) {
    if (!returnDefaultOnEmpty) return null;
    
    // Fallback: If it's a new session and we ONLY have context, 
    // try to find some semantic info in the context itself or return a better default
    if (text.includes('session-mode=workspace_qa')) return 'Workspace Q&A';
    if (text.includes('session-mode=research')) return 'Research Session';
    
    return 'New Session';
  }
  
  return result || (returnDefaultOnEmpty ? 'New Session' : null);
}

/**
 * Derive a compact session title from the user's visible request text.
 * @param {string} text
 * @param {number} maxLength
 * @returns {string|null}
 */
export function buildSessionDisplayName(text, maxLength = 100) {
  const cleaned = stripInternalContextPrefix(text, false);
  if (!cleaned) {
    return null;
  }

  const firstVisibleLine = cleaned
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);

  if (!firstVisibleLine) {
    return null;
  }

  if (/^\[Context:[^\]]*\]$/i.test(firstVisibleLine)) {
    return null;
  }

  let candidate = firstVisibleLine
    .replace(/^(?:[#>*-]+\s*)+/, '')
    .replace(/^\s*User request:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  const helpMatch = candidate.match(/^Please help me with ["'](.+?)["']\.?$/i);
  if (helpMatch?.[1]?.trim()) {
    candidate = helpMatch[1].trim();
  }

  if (!candidate) {
    return null;
  }

  const characters = Array.from(candidate);
  if (characters.length <= maxLength) {
    return candidate;
  }

  if (maxLength <= 3) {
    return characters.slice(0, maxLength).join('');
  }

  return `${characters.slice(0, maxLength - 3).join('').trimEnd()}...`;
}
