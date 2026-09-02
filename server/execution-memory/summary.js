import {
  buildExecutionMemoryMarkerKey,
  getExecutionMemoryPaths,
  readJsonIfExists,
  readJsonl,
  readTextIfExists,
  replaceMarkedSection,
  writeText,
} from './files.js';

const EXECUTION_MEMORY_FULL_PROMPT_LIMIT = 1_800;
const EXECUTION_MEMORY_DELTA_PROMPT_LIMIT = 1_200;
const EXECUTION_MEMORY_FIELD_LIMIT = 280;
const executionMemoryInjectionStates = new Map();

function createEmptyMicrotaskState(scopeRef = {}) {
  return {
    version: 1,
    scope: scopeRef.scope || 'session',
    sessionId: scopeRef.sessionId || null,
    runId: scopeRef.runId || null,
    provider: scopeRef.provider || null,
    currentObjective: scopeRef.currentObjective || null,
    currentTaskId: scopeRef.currentTaskId || null,
    currentTaskTitle: scopeRef.currentTaskTitle || null,
    stage: scopeRef.stage || null,
    source: null,
    updatedAt: null,
    items: [],
  };
}

async function readExecutionMemorySnapshot(scopeRef, options = {}) {
  const ledgerLimit = Number.isFinite(options.ledgerLimit) ? Math.max(1, Number(options.ledgerLimit)) : 120;
  const paths = getExecutionMemoryPaths(scopeRef);
  const [microtasks, ledgerEvents, sessionSummary] = await Promise.all([
    readJsonIfExists(paths.microtasksPath, null),
    readJsonl(paths.ledgerPath, ledgerLimit),
    readTextIfExists(paths.sessionSummaryPath, ''),
  ]);
  const resolvedMicrotasks = microtasks || createEmptyMicrotaskState(scopeRef);
  return {
    scope: {
      ...scopeRef,
      scope: scopeRef?.scope || 'session',
      sessionId: resolvedMicrotasks.sessionId || scopeRef?.sessionId || null,
      runId: resolvedMicrotasks.runId || scopeRef?.runId || null,
    },
    paths,
    microtasks: resolvedMicrotasks,
    ledgerEvents,
    sessionSummary,
    derived: buildDerivedExecutionMemory(resolvedMicrotasks, ledgerEvents),
  };
}

async function refreshExecutionMemorySummaries(scopeRef, options = {}) {
  const snapshot = await readExecutionMemorySnapshot(scopeRef, options);
  const sessionSummary = buildSessionSummaryMarkdown(snapshot);
  const workingSummary = buildWorkingSummarySection(snapshot);
  await Promise.all([
    writeText(snapshot.paths.sessionSummaryPath, sessionSummary),
    replaceMarkedSection(
      snapshot.paths.workingSummaryPath,
      buildExecutionMemoryMarkerKey(snapshot.scope),
      workingSummary,
    ),
  ]);
  return {
    ...snapshot,
    sessionSummary,
    workingSummary,
  };
}

function buildDerivedExecutionMemory(microtasks, ledgerEvents = []) {
  const items = Array.isArray(microtasks?.items) ? microtasks.items : [];
  const openItems = items.filter((item) => item.status !== 'completed');
  const completedItems = items.filter((item) => item.status === 'completed');
  const recentArtifacts = dedupeStrings(
    ledgerEvents
      .filter((event) => event?.type === 'artifact_created' && typeof event?.path === 'string')
      .map((event) => event.path),
  ).slice(-8);
  const recentConfirmedFindings = dedupeStrings([
    ...ledgerEvents
      .filter((event) => event?.type === 'finding_recorded' && typeof event?.summary === 'string' && String(event?.confirmation || '').toLowerCase() === 'confirmed')
      .map((event) => event.summary),
    ...ledgerEvents
      .filter((event) => event?.type === 'stat_result' && typeof event?.summary === 'string')
      .map((event) => event.summary),
  ]).slice(-6);
  const recentObservedFindings = dedupeStrings(
    ledgerEvents
      .filter((event) => event?.type === 'finding_recorded' && typeof event?.summary === 'string' && String(event?.confirmation || '').toLowerCase() !== 'confirmed')
      .map((event) => event.summary),
  ).slice(-6);
  const recentNotes = dedupeStrings(
    ledgerEvents
      .filter((event) => event?.type === 'assistant_note' && typeof event?.summary === 'string')
      .map((event) => event.summary),
  ).slice(-4);

  return {
    totalMicrotasks: items.length,
    completedMicrotasks: completedItems.length,
    openMicrotasks: openItems.length,
    openItems,
    completedItems,
    recentArtifacts,
    recentConfirmedFindings,
    recentObservedFindings,
    recentNotes,
  };
}

function buildSessionSummaryMarkdown(snapshot) {
  const { microtasks, derived, scope } = snapshot;
  const lines = [];
  const scopeLabel = scope.scope === 'run'
    ? `Auto Research Run ${scope.runId || 'unknown'}`
    : `Session ${scope.sessionId || 'unknown'}`;

  lines.push(`# Execution Memory Summary`);
  lines.push('');
  lines.push(`Scope: ${scopeLabel}`);
  if (microtasks.provider) {
    lines.push(`Provider: ${microtasks.provider}`);
  }
  if (microtasks.updatedAt) {
    lines.push(`Updated: ${microtasks.updatedAt}`);
  }
  lines.push('');

  lines.push(`## Objective`);
  lines.push(microtasks.currentObjective || 'No execution objective recorded yet.');
  lines.push('');

  lines.push(`## Current Task`);
  lines.push(microtasks.currentTaskTitle || 'No active task recorded.');
  lines.push('');

  lines.push(`## Open Microtasks`);
  if (derived.openItems.length === 0) {
    lines.push(`- None`);
  } else {
    for (const item of derived.openItems.slice(0, 8)) {
      lines.push(`- [ ] ${item.title}`);
    }
  }
  lines.push('');

  lines.push(`## Completed Microtasks`);
  if (derived.completedItems.length === 0) {
    lines.push(`- None`);
  } else {
    for (const item of derived.completedItems.slice(-8)) {
      lines.push(`- [x] ${item.title}`);
    }
  }
  lines.push('');

  lines.push(`## Confirmed Artifacts`);
  if (derived.recentArtifacts.length === 0) {
    lines.push(`- None`);
  } else {
    for (const artifactPath of derived.recentArtifacts) {
      lines.push(`- ${artifactPath}`);
    }
  }
  lines.push('');

  lines.push(`## Confirmed Findings`);
  if (derived.recentConfirmedFindings.length === 0) {
    lines.push(`- None`);
  } else {
    for (const finding of derived.recentConfirmedFindings) {
      lines.push(`- ${finding}`);
    }
  }
  lines.push('');

  lines.push(`## Observed Findings`);
  if (derived.recentObservedFindings.length === 0) {
    lines.push(`- None`);
  } else {
    for (const finding of derived.recentObservedFindings) {
      lines.push(`- ${finding}`);
    }
  }
  lines.push('');

  if (derived.recentNotes.length > 0) {
    lines.push(`## Recent Notes`);
    for (const note of derived.recentNotes) {
      lines.push(`- ${note}`);
    }
    lines.push('');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

function buildWorkingSummarySection(snapshot) {
  const { microtasks, derived, scope } = snapshot;
  const title = scope.scope === 'run'
    ? `## Auto Research Run ${scope.runId || 'unknown'}`
    : `## Session ${scope.sessionId || 'unknown'}`;
  const lines = [title];

  if (microtasks.updatedAt) {
    lines.push(`Updated: ${microtasks.updatedAt}`);
  }
  lines.push('');
  lines.push(`Objective: ${microtasks.currentObjective || 'No objective recorded yet.'}`);
  lines.push('');

  lines.push(`Current task: ${microtasks.currentTaskTitle || 'No active task recorded.'}`);
  lines.push('');

  lines.push(`Open microtasks:`);
  if (derived.openItems.length === 0) {
    lines.push(`- None`);
  } else {
    for (const item of derived.openItems.slice(0, 8)) {
      lines.push(`- ${item.title}`);
    }
  }
  lines.push('');

  lines.push(`Completed microtasks:`);
  if (derived.completedItems.length === 0) {
    lines.push(`- None`);
  } else {
    for (const item of derived.completedItems.slice(-8)) {
      lines.push(`- ${item.title}`);
    }
  }
  lines.push('');

  lines.push(`Confirmed artifacts:`);
  if (derived.recentArtifacts.length === 0) {
    lines.push(`- None`);
  } else {
    for (const artifactPath of derived.recentArtifacts) {
      lines.push(`- ${artifactPath}`);
    }
  }
  lines.push('');

  lines.push(`Confirmed findings:`);
  if (derived.recentConfirmedFindings.length === 0) {
    lines.push(`- None`);
  } else {
    for (const finding of derived.recentConfirmedFindings) {
      lines.push(`- ${finding}`);
    }
  }
  lines.push('');

  lines.push(`Observed findings:`);
  if (derived.recentObservedFindings.length === 0) {
    lines.push(`- None`);
  } else {
    for (const finding of derived.recentObservedFindings) {
      lines.push(`- ${finding}`);
    }
  }
  lines.push('');

  return `${lines.join('\n').trimEnd()}\n`;
}

function clipExecutionMemoryValue(value, maxLength = EXECUTION_MEMORY_FIELD_LIMIT) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (!normalized || normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function buildPromptState(snapshot) {
  const { microtasks, derived } = snapshot;
  return {
    objective: clipExecutionMemoryValue(microtasks.currentObjective, 360),
    currentTask: clipExecutionMemoryValue(microtasks.currentTaskTitle, 280),
    // Keep a wider comparison window than the rendered prompt. This lets the
    // incremental injector notice changes beyond the first three visible items
    // without increasing the prompt payload.
    openItems: derived.openItems.slice(0, 12).map((item) => clipExecutionMemoryValue(item.title, 220)).filter(Boolean),
    completedItems: derived.completedItems.slice(-12).map((item) => clipExecutionMemoryValue(item.title, 220)).filter(Boolean),
    artifacts: derived.recentArtifacts.slice(-8).map((item) => clipExecutionMemoryValue(item, 240)).filter(Boolean),
    confirmedFindings: derived.recentConfirmedFindings.slice(-8).map((item) => clipExecutionMemoryValue(item, 280)).filter(Boolean),
    lastLedgerEventId: snapshot.ledgerEvents.at(-1)?.id || null,
  };
}

function hasPromptStateContent(state) {
  return Boolean(
    state.objective
    || state.currentTask
    || state.openItems.length
    || state.completedItems.length
    || state.artifacts.length
    || state.confirmedFindings.length
  );
}

function appendPromptList(lines, label, values, limit) {
  const items = Array.isArray(values) ? values.slice(0, limit) : [];
  if (items.length === 0) return;
  lines.push(`${label}:`);
  for (const item of items) lines.push(`- ${item}`);
}

function renderLimitedExecutionMemory(lines, maxChars) {
  const opening = '<execution_memory>';
  const closing = '</execution_memory>';
  const rendered = [opening];
  const reserve = closing.length + 8;
  let truncated = false;
  for (const line of lines) {
    const candidate = [...rendered, line, closing].join('\n');
    if (candidate.length <= maxChars) {
      rendered.push(line);
      continue;
    }
    truncated = true;
    break;
  }
  if (truncated && [...rendered, '- …', closing].join('\n').length <= maxChars) {
    rendered.push('- …');
  }
  rendered.push(closing);
  return rendered.join('\n').slice(0, Math.max(maxChars, reserve));
}

function buildFullExecutionPromptContext(state, maxChars = EXECUTION_MEMORY_FULL_PROMPT_LIMIT) {
  if (!hasPromptStateContent(state)) return '';

  const lines = ['Mode: compact state'];
  if (state.objective) lines.push(`Current objective: ${state.objective}`);
  if (state.currentTask) lines.push(`Current task: ${state.currentTask}`);
  appendPromptList(lines, 'Open microtasks', state.openItems, 3);
  appendPromptList(lines, 'Recently completed microtasks', state.completedItems.slice(-3), 3);
  appendPromptList(lines, 'Recent confirmed artifacts', state.artifacts.slice(-3), 3);
  appendPromptList(lines, 'Confirmed findings', state.confirmedFindings.slice(-3), 3);
  lines.push('Continue from this confirmed state; do not repeat completed work.');
  return renderLimitedExecutionMemory(lines, maxChars);
}

function difference(currentValues, previousValues) {
  const previous = new Set((previousValues || []).map((value) => value.toLowerCase()));
  return (currentValues || []).filter((value) => !previous.has(value.toLowerCase()));
}

function buildDeltaExecutionPromptContext(current, previous, maxChars = EXECUTION_MEMORY_DELTA_PROMPT_LIMIT) {
  const lines = ['Mode: changes since the previous injected state'];
  if (current.objective !== previous.objective && current.objective) {
    lines.push(`Objective changed: ${current.objective}`);
  }
  if (current.currentTask !== previous.currentTask) {
    lines.push(`Current task: ${current.currentTask || 'none'}`);
  }
  appendPromptList(lines, 'New or reopened', difference(current.openItems, previous.openItems), 3);
  appendPromptList(lines, 'Newly completed', difference(current.completedItems, previous.completedItems), 3);
  appendPromptList(lines, 'New artifacts', difference(current.artifacts, previous.artifacts), 3);
  appendPromptList(lines, 'New confirmed findings', difference(current.confirmedFindings, previous.confirmedFindings), 3);
  if (lines.length === 1) return '';
  lines.push('Apply only these changes to the state already present in this thread.');
  return renderLimitedExecutionMemory(lines, maxChars);
}

function buildExecutionPromptContext(snapshot, options = {}) {
  const state = buildPromptState(snapshot);
  return buildFullExecutionPromptContext(
    state,
    Number.isFinite(options.maxChars) ? Math.max(400, Number(options.maxChars)) : EXECUTION_MEMORY_FULL_PROMPT_LIMIT,
  );
}

function buildExecutionMemoryInjectionKey(scopeRef) {
  if (!scopeRef?.projectPath) return null;
  const scopeId = scopeRef.scope === 'run' ? scopeRef.runId : scopeRef.sessionId;
  if (!scopeId) return null;
  return [scopeRef.scope || 'session', scopeRef.provider || 'unknown', scopeRef.projectPath, scopeId].join('\u0000');
}

function prepareExecutionPromptContext(snapshot, options = {}) {
  const state = buildPromptState(snapshot);
  const key = options.incrementalKey || buildExecutionMemoryInjectionKey(snapshot.scope);
  const previous = key ? executionMemoryInjectionStates.get(key) : null;
  const text = previous
    ? buildDeltaExecutionPromptContext(state, previous, options.deltaMaxChars)
    : buildFullExecutionPromptContext(state, options.fullMaxChars);
  return {
    text,
    mode: previous ? (text ? 'delta' : 'unchanged') : (text ? 'full' : 'empty'),
    checkpoint: key ? { key, scope: snapshot.scope, state } : null,
  };
}

function commitExecutionMemoryPromptCheckpoint(checkpoint, options = {}) {
  if (!checkpoint?.key || !checkpoint?.state) return false;
  executionMemoryInjectionStates.set(checkpoint.key, checkpoint.state);
  for (const sessionId of options.sessionIds || []) {
    const normalizedSessionId = String(sessionId || '').trim();
    if (!normalizedSessionId) continue;
    const aliasKey = buildExecutionMemoryInjectionKey({
      ...checkpoint.scope,
      scope: 'session',
      sessionId: normalizedSessionId,
    });
    if (aliasKey) executionMemoryInjectionStates.set(aliasKey, checkpoint.state);
  }
  return true;
}

function resetExecutionMemoryPromptCheckpoints() {
  executionMemoryInjectionStates.clear();
}

function hasMeaningfulExecutionMemory(snapshot) {
  const { microtasks, derived } = snapshot;
  const hasMeaningfulContent = Boolean(
    microtasks.currentObjective
    || microtasks.currentTaskTitle
    || derived.openItems.length
    || derived.completedItems.length
    || derived.recentArtifacts.length
    || derived.recentConfirmedFindings.length
    || derived.recentObservedFindings.length,
  );
  return hasMeaningfulContent;
}

async function buildExecutionMemoryPromptPrefix(scopeRef, command, options = {}) {
  if (!scopeRef?.projectPath) {
    return command;
  }
  const snapshot = await readExecutionMemorySnapshot(scopeRef, {
    ledgerLimit: options.ledgerLimit || 80,
  });
  if (!hasMeaningfulExecutionMemory(snapshot)) return command;
  const prefix = buildExecutionPromptContext(snapshot);
  if (!prefix) {
    return command;
  }
  const body = String(command || '').trim() || options.fallbackCommand || 'Continue from the latest confirmed execution state.';
  return `${prefix}\n\nUser request:\n${body}`;
}

function dedupeStrings(values) {
  const seen = new Set();
  const deduped = [];
  for (const value of values) {
    const normalized = String(value || '').trim();
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(normalized);
  }
  return deduped;
}

export {
  buildExecutionMemoryPromptPrefix,
  buildExecutionMemoryInjectionKey,
  buildExecutionPromptContext,
  buildSessionSummaryMarkdown,
  buildWorkingSummarySection,
  commitExecutionMemoryPromptCheckpoint,
  createEmptyMicrotaskState,
  prepareExecutionPromptContext,
  readExecutionMemorySnapshot,
  resetExecutionMemoryPromptCheckpoints,
  refreshExecutionMemorySummaries,
};
