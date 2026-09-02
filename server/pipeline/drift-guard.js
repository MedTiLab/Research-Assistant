import path from 'path';
import { promises as fs } from 'fs';

import { extractTasksFromData } from './state.js';
import { hashJson, hashTasksDefinition, sha256 } from './hash-utils.js';
import { getByPath, RESEARCH_SPEC_RELATIVE_PATH } from './research-spec.js';
import { getTaskRunDirectory } from './task-envelope.js';

const PROTECTED_FILES = [
  { relativePath: RESEARCH_SPEC_RELATIVE_PATH, mode: 'strict' },
  { relativePath: '.pipeline/docs/research_brief.json', mode: 'strict-json' },
  { relativePath: '.pipeline/tasks/tasks.json', mode: 'task-state' },
  { relativePath: 'instance.json', mode: 'strict' },
  { relativePath: '.pipeline/config.json', mode: 'strict' },
  { relativePath: 'pipeline_config.json', mode: 'strict' },
];

async function readFileSnapshot(projectPath, descriptor) {
  const filePath = path.join(projectPath, descriptor.relativePath);
  try {
    const buffer = await fs.readFile(filePath);
    let definitionHash = null;
    let parseError = null;
    let tasks = null;
    if (descriptor.mode === 'task-state') {
      try {
        const payload = JSON.parse(buffer.toString('utf8'));
        tasks = extractTasksFromData(payload).tasks;
        definitionHash = hashTasksDefinition(tasks);
      } catch (error) {
        parseError = error.message;
      }
    } else if (descriptor.mode === 'strict-json') {
      try {
        JSON.parse(buffer.toString('utf8'));
      } catch (error) {
        parseError = error.message;
      }
    }
    return {
      ...descriptor,
      exists: true,
      hash: sha256(buffer),
      definitionHash,
      parseError,
      tasks,
      contentBase64: buffer.toString('base64'),
    };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        ...descriptor,
        exists: false,
        hash: null,
        definitionHash: null,
        contentBase64: null,
      };
    }
    throw error;
  }
}

async function readBrief(projectPath) {
  try {
    return JSON.parse(await fs.readFile(
      path.join(projectPath, '.pipeline', 'docs', 'research_brief.json'),
      'utf8',
    ));
  } catch (error) {
    if (error?.code === 'ENOENT') return { value: null, parseError: null };
    return { value: null, parseError: error.message };
  }
}

async function captureProtectedFileSnapshot({ projectPath, researchSpec = {}, currentTaskId = null } = {}) {
  const [files, brief] = await Promise.all([
    Promise.all(PROTECTED_FILES.map((descriptor) => readFileSnapshot(projectPath, descriptor))),
    readBrief(projectPath),
  ]);
  const lockedBriefPaths = Array.isArray(researchSpec.lockedBriefPaths)
    ? researchSpec.lockedBriefPaths
    : [];
  const briefValue = brief?.value === undefined ? brief : brief.value;
  const lockedBriefValues = Object.fromEntries(lockedBriefPaths.map((briefPath) => [
    briefPath,
    getByPath(briefValue, briefPath),
  ]));

  return {
    capturedAt: new Date().toISOString(),
    projectPath,
    specHash: researchSpec.specHash || null,
    currentTaskId: currentTaskId == null ? null : String(currentTaskId),
    files,
    lockedBriefPaths,
    lockedBriefValues,
    lockedBriefHash: hashJson(lockedBriefValues),
  };
}

async function verifyProtectedFileSnapshot(snapshot) {
  const currentFiles = await Promise.all(snapshot.files.map((descriptor) => (
    readFileSnapshot(snapshot.projectPath, descriptor)
  )));
  const protectedFileChanges = [];
  const checks = [];

  snapshot.files.forEach((before, index) => {
    const after = currentFiles[index];
    if (before.hash === after.hash) {
      checks.push({ code: 'PROTECTED_FILE_UNCHANGED', status: 'pass', path: before.relativePath });
      return;
    }

    protectedFileChanges.push({
      path: before.relativePath,
      mode: before.mode,
      beforeHash: before.hash,
      afterHash: after.hash,
      beforeExists: before.exists,
      afterExists: after.exists,
      parseError: after.parseError || null,
    });
    checks.push({ code: 'PROTECTED_FILE_CHANGED', status: 'fail', path: before.relativePath });
  });

  const briefResult = await readBrief(snapshot.projectPath);
  const brief = briefResult?.value === undefined ? briefResult : briefResult.value;
  const drift = snapshot.lockedBriefPaths.flatMap((briefPath) => {
    const before = snapshot.lockedBriefValues[briefPath];
    const after = getByPath(brief, briefPath);
    return hashJson(before) === hashJson(after)
      ? []
      : [{ field: briefPath, before, after }];
  });
  if (briefResult?.parseError) {
    drift.push({ field: '$parse', before: 'valid JSON', after: briefResult.parseError });
  }

  checks.push({
    code: 'NO_LOCKED_FIELD_DRIFT',
    status: drift.length === 0 ? 'pass' : 'fail',
    detail: drift.length === 0
      ? 'Locked research brief fields are unchanged.'
      : `${drift.length} locked research brief field(s) changed.`,
  });

  return {
    pass: protectedFileChanges.length === 0 && drift.length === 0,
    checkedAt: new Date().toISOString(),
    specHash: snapshot.specHash,
    checks,
    protectedFileChanges,
    drift,
    currentFiles,
  };
}

function setOrDeleteByPath(target, dottedPath, value) {
  const keys = String(dottedPath || '').split('.').filter(Boolean);
  if (keys.length === 0) return;
  let cursor = target;
  keys.slice(0, -1).forEach((key) => {
    if (!cursor[key] || typeof cursor[key] !== 'object' || Array.isArray(cursor[key])) {
      cursor[key] = {};
    }
    cursor = cursor[key];
  });
  const finalKey = keys[keys.length - 1];
  if (value === undefined) {
    delete cursor[finalKey];
  } else {
    cursor[finalKey] = value;
  }
}

async function restoreProtectedFileSnapshot(snapshot, integrityResult = null) {
  const result = integrityResult || await verifyProtectedFileSnapshot(snapshot);
  const changedPaths = new Set(result.protectedFileChanges.map((change) => change.path));

  await Promise.all(snapshot.files.map(async (file) => {
    if (!changedPaths.has(file.relativePath)) return;
    const filePath = path.join(snapshot.projectPath, file.relativePath);
    if (!file.exists) {
      await fs.rm(filePath, { force: true });
      return;
    }
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, Buffer.from(file.contentBase64, 'base64'));
  }));

  if (result.drift.length > 0) {
    const briefPath = path.join(snapshot.projectPath, '.pipeline', 'docs', 'research_brief.json');
    const briefResult = await readBrief(snapshot.projectPath);
    const brief = (briefResult?.value === undefined ? briefResult : briefResult.value) || {};
    snapshot.lockedBriefPaths.forEach((briefField) => {
      setOrDeleteByPath(brief, briefField, snapshot.lockedBriefValues[briefField]);
    });
    await fs.mkdir(path.dirname(briefPath), { recursive: true });
    await fs.writeFile(briefPath, `${JSON.stringify(brief, null, 2)}\n`, 'utf8');
  }

  return result;
}

async function writeDriftReport(projectPath, runId, taskId, integrityResult) {
  const reportPath = path.join(getTaskRunDirectory(projectPath, runId, taskId), 'drift-report.json');
  const report = {
    runId: String(runId || ''),
    taskId: String(taskId || ''),
    status: integrityResult.pass ? 'clear' : 'blocked',
    checkedAt: integrityResult.checkedAt || new Date().toISOString(),
    specHash: integrityResult.specHash || null,
    protectedFileChanges: integrityResult.protectedFileChanges || [],
    drift: integrityResult.drift || [],
    checks: integrityResult.checks || [],
  };
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return reportPath;
}

async function writeProtectedFileSnapshot(projectPath, runId, taskId, snapshot) {
  const filePath = path.join(getTaskRunDirectory(projectPath, runId, taskId), 'protected-snapshot.json');
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  return filePath;
}

async function readProtectedFileSnapshot(projectPath, runId, taskId) {
  try {
    return JSON.parse(await fs.readFile(
      path.join(getTaskRunDirectory(projectPath, runId, taskId), 'protected-snapshot.json'),
      'utf8',
    ));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeIntegrityResult(projectPath, runId, taskId, integrityResult) {
  const filePath = path.join(getTaskRunDirectory(projectPath, runId, taskId), 'integrity-result.json');
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(integrityResult, null, 2)}\n`, 'utf8');
  return filePath;
}

async function readIntegrityResult(projectPath, runId, taskId) {
  try {
    return JSON.parse(await fs.readFile(
      path.join(getTaskRunDirectory(projectPath, runId, taskId), 'integrity-result.json'),
      'utf8',
    ));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

export {
  PROTECTED_FILES,
  captureProtectedFileSnapshot,
  readIntegrityResult,
  readProtectedFileSnapshot,
  restoreProtectedFileSnapshot,
  verifyProtectedFileSnapshot,
  writeDriftReport,
  writeIntegrityResult,
  writeProtectedFileSnapshot,
};
