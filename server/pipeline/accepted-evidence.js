import path from 'path';
import { promises as fs } from 'fs';

import { hashFile, hashTaskDefinition, resolveProjectRelativePath } from './hash-utils.js';
import { getTransitiveDependencyIds } from './task-graph.js';
import { getTaskRunDirectory } from './task-envelope.js';

function normalizeArtifactPath(value) {
  return String(value || '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
}

function evidenceArtifacts(manifest = {}) {
  const entries = [
    ...(Array.isArray(manifest?.artifacts) ? manifest.artifacts : []),
    ...(Array.isArray(manifest?.createdArtifacts) ? manifest.createdArtifacts : []),
  ];
  const byPath = new Map();
  entries.forEach((entry) => {
    const normalized = typeof entry === 'string'
      ? { relativePath: normalizeArtifactPath(entry) }
      : { ...entry, relativePath: normalizeArtifactPath(entry?.relativePath || entry?.path) };
    if (normalized.relativePath && !byPath.has(normalized.relativePath)) {
      byPath.set(normalized.relativePath, normalized);
    }
  });
  return byPath;
}

async function validateAcceptedArtifact(projectPath, relativePath, manifestEntry) {
  const targetPath = resolveProjectRelativePath(projectPath, relativePath);
  if (!targetPath || !manifestEntry?.sha256) return null;
  try {
    const stats = await fs.stat(targetPath);
    if (!stats.isFile() || stats.size <= 0 || await hashFile(targetPath) !== manifestEntry.sha256) return null;
    return {
      relativePath,
      sha256: manifestEntry.sha256,
      size: stats.size,
      modifiedAt: stats.mtime.toISOString(),
    };
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function validateCandidate(projectPath, runId, task, specHash) {
  const taskDir = getTaskRunDirectory(projectPath, runId, task.id);
  const [verification, manifest] = await Promise.all([
    readJson(path.join(taskDir, 'verification.json')),
    readJson(path.join(taskDir, 'evidence-manifest.json')),
  ]);
  const taskHash = hashTaskDefinition(task);
  if (!verification || !manifest
    || verification.verdict !== 'pass'
    || verification.status === 'invalidated'
    || manifest.status === 'invalidated'
    || String(verification.taskId || '') !== String(task.id)
    || String(manifest.taskId || '') !== String(task.id)
    || verification.specHash !== specHash
    || manifest.specHash !== specHash
    || verification.taskHash !== taskHash
    || manifest.taskHash !== taskHash) return null;

  const acceptedPaths = [...new Set((verification.acceptedArtifacts || [])
    .map((entry) => normalizeArtifactPath(typeof entry === 'string' ? entry : entry?.relativePath || entry?.path))
    .filter(Boolean))];
  if (acceptedPaths.length === 0 && task.noArtifactExpected !== true) return null;
  const artifactByPath = evidenceArtifacts(manifest);
  const acceptedArtifacts = await Promise.all(acceptedPaths.map((relativePath) => (
    validateAcceptedArtifact(projectPath, relativePath, artifactByPath.get(relativePath))
  )));
  if (acceptedArtifacts.some((artifact) => !artifact)) return null;

  return {
    runId: String(runId),
    taskId: String(task.id),
    taskHash,
    specHash,
    verifiedAt: verification.verifiedAt || null,
    summary: verification.summary || '',
    acceptedArtifacts,
  };
}

async function listRunIds(projectPath, preferredRunId = null) {
  const runsDir = path.join(projectPath, '.pipeline', 'runs');
  try {
    const entries = await fs.readdir(runsDir, { withFileTypes: true });
    const ids = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    return [...new Set([preferredRunId == null ? null : String(preferredRunId), ...ids].filter(Boolean))];
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

async function loadAcceptedDependencyEvidence(projectPath, {
  runId = null,
  currentTask = null,
  tasks = [],
  specHash = null,
} = {}) {
  if (!currentTask || !specHash) return [];
  const byId = new Map((Array.isArray(tasks) ? tasks : []).map((task) => [String(task.id), task]));
  const dependencyIds = getTransitiveDependencyIds(currentTask, tasks);
  const runIds = await listRunIds(projectPath, runId);
  const accepted = [];

  for (const dependencyId of dependencyIds) {
    const dependencyTask = byId.get(String(dependencyId));
    if (!dependencyTask || dependencyTask.status !== 'done') continue;
    const candidates = (await Promise.all(runIds.map((candidateRunId) => (
      validateCandidate(projectPath, candidateRunId, dependencyTask, specHash)
    )))).filter(Boolean).sort((left, right) => (
      String(right.verifiedAt || '').localeCompare(String(left.verifiedAt || ''))
    ));
    if (candidates[0]) accepted.push(candidates[0]);
  }
  return accepted;
}

function findMissingAcceptedDependencies(currentTask, tasks = [], acceptedEvidence = []) {
  const acceptedIds = new Set((acceptedEvidence || []).map((entry) => String(entry.taskId)));
  return getTransitiveDependencyIds(currentTask, tasks).filter((taskId) => !acceptedIds.has(String(taskId)));
}

export {
  findMissingAcceptedDependencies,
  loadAcceptedDependencyEvidence,
};
