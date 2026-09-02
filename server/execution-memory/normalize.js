import {
  normalizeRuntimeObservations,
  normalizeTodoItems,
  normalizeTodoStatus,
} from '../agent-runtime/observations/index.js';

const ACTIONABLE_TOOL_NAMES = new Set([
  'bash',
  'edit',
  'multiedit',
  'write',
  'writefile',
  'replace',
  'notebookedit',
  'command_execution',
  'mcp_tool_call',
  'websearch',
  'webfetch',
]);
const FILE_PATH_KEYS = ['file_path', 'path', 'target_file', 'targetPath', 'output_path'];
const STAT_LINE_PATTERN = /\b(?:p\s*[<=>]\s*0?\.\d+|hr\b|hazard ratio|or\b|odds ratio|rr\b|risk ratio|auc\b|auroc\b|f1\b|accuracy\b|sensitivity\b|specificity\b|ci\b|confidence interval|%\b)/i;

function normalizeExecutionSignals(payload, options = {}) {
  return normalizeRuntimeObservations(payload, options).map((observation) => {
    const {
      message,
      provider,
      ...signal
    } = observation;

    if (observation.type === 'session_created') {
      signal.provider = provider;
    }
    if (observation.type === 'assistant_text') {
      signal.findings = extractStatFindings(observation.text);
    }

    return signal;
  });
}

function extractArtifactPathsFromToolInput(toolName, toolInput) {
  const normalizedToolName = String(toolName || '').trim().toLowerCase();
  if (!ACTIONABLE_TOOL_NAMES.has(normalizedToolName)) {
    return [];
  }
  const paths = new Set();

  for (const key of FILE_PATH_KEYS) {
    const value = toolInput?.[key];
    if (typeof value === 'string' && value.trim()) {
      paths.add(value.trim());
    }
  }

  const filePath = typeof toolInput?.filePath === 'string' ? toolInput.filePath.trim() : null;
  if (filePath) {
    paths.add(filePath);
  }

  if (Array.isArray(toolInput?.files)) {
    for (const entry of toolInput.files) {
      if (typeof entry === 'string' && entry.trim()) {
        paths.add(entry.trim());
      }
    }
  }

  return Array.from(paths);
}

function buildImplicitMicrotaskTitle(toolName, toolInput = {}) {
  const normalizedToolName = String(toolName || '').trim();
  if (!normalizedToolName) {
    return null;
  }
  if (/bash/i.test(normalizedToolName)) {
    const command = compactWhitespace(toolInput?.command || toolInput?.cmd || '');
    return command ? `Run ${command}` : 'Run shell command';
  }
  const fileTarget = extractArtifactPathsFromToolInput(toolName, toolInput)[0] || null;
  if (fileTarget) {
    return `${normalizedToolName} ${fileTarget}`;
  }
  if (/websearch/i.test(normalizedToolName)) {
    const query = compactWhitespace(toolInput?.query || '');
    return query ? `Search ${query}` : 'Run web search';
  }
  return normalizedToolName;
}

function extractStatFindings(text) {
  if (!text || typeof text !== 'string') {
    return [];
  }
  const findings = [];
  const seen = new Set();
  const candidates = text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.?!])\s+/))
    .map((entry) => compactWhitespace(entry))
    .filter(Boolean);

  for (const candidate of candidates) {
    if (candidate.length < 20 || candidate.length > 320) {
      continue;
    }
    if (!STAT_LINE_PATTERN.test(candidate)) {
      continue;
    }
    const key = candidate.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    findings.push(candidate);
  }

  return findings;
}

function compactWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export {
  buildImplicitMicrotaskTitle,
  extractArtifactPathsFromToolInput,
  extractStatFindings,
  normalizeExecutionSignals,
  normalizeTodoItems,
  normalizeTodoStatus,
};
