import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getRuntimeSessionFilePath } from '../utils/storagePaths.js';

const messageText = (content) => typeof content === 'string' ? content
  : (Array.isArray(content) ? content.filter((part) => part.type === 'text').map((part) => part.text || '').join('\n') : '');

export async function readAutomationResult(identity, options = {}) {
  const file = getRuntimeSessionFilePath(identity, options);
  if (!options.live) {
    const saved = await fs.readFile(`${file}.automation-result.json`, 'utf8').catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (saved) return { ...JSON.parse(saved), sessionExists: await fs.access(file).then(() => true, () => false) };
  }
  const raw = await fs.readFile(file, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (raw == null) return { markdown: '', warnings: [], sessionExists: false, messageCount: 0 };
  let markdown = '';
  let messageCount = 0;
  const warnings = [];
  const lines = raw.split('\n');
  for (let index = 0; index < lines.length; index++) {
    if (!lines[index].trim()) continue;
    let record;
    try { record = JSON.parse(lines[index]); }
    catch (error) {
      // A running host may not have finished writing its last JSONL record.
      if (index === lines.length - 1 && !raw.endsWith('\n')) break;
      throw error;
    }
    const message = record.message || (['assistant', 'user'].includes(record.type) ? { role: record.type, content: record.content } : null);
    if (['assistant', 'user'].includes(message?.role)) messageCount++;
    if (message?.role === 'assistant') {
      const text = messageText(message.content);
      const isToolStep = message.stopReason === 'toolUse' || (Array.isArray(message.content) && message.content.some((part) => part.type === 'toolCall'));
      if (text.trim() && !isToolStep) markdown = text;
    }
    if (message?.role === 'toolResult' && message.isError) {
      warnings.push({ tool: message.toolName || 'tool', message: messageText(message.content).slice(0, 1000) });
    }
  }
  return { markdown, warnings: warnings.slice(-20), sessionExists: true, messageCount };
}

export async function saveAutomationResult(identity, result, options = {}) {
  const file = `${getRuntimeSessionFilePath(identity, options)}.automation-result.json`;
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  // Preserve the original run report when the user continues its conversation.
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, JSON.stringify(result), { mode: 0o600, flag: 'wx' });
    await fs.link(temp, file).catch((error) => { if (error.code !== 'EEXIST') throw error; });
  } finally { await fs.rm(temp, { force: true }); }
}

export async function indexAutomationSession(record, run, options = {}) {
  const { sessionDb } = await import('../database/db.js');
  const identity = { ...record.identity, sessionId: run.sessionId };
  const existing = sessionDb.getSessionByIdentity(identity);
  const result = await readAutomationResult(identity, { ...options, live: true });
  if (!result.sessionExists && run.status !== 'running') return;
  if (result.sessionExists && run.status !== 'running') await saveAutomationResult(identity, result, options);
  sessionDb.upsertSessionFromSource(run.sessionId, identity.projectKey, 'pi', {
    ownerKey: identity.ownerKey, runtimeId: 'pi',
    displayName: existing?.metadata?.displayNameSource === 'manual' ? existing.display_name
      : `[自动化] ${record.title} · ${run.startedAt ? new Date(run.startedAt).toLocaleString('zh-CN', { hour12: false }) : ''}`,
    messageCount: result.messageCount,
    lastActivity: run.finishedAt || run.startedAt,
    modelSelection: record.model || undefined,
    metadata: { ...(existing?.metadata || {}), displayNameSource: existing?.metadata?.displayNameSource === 'manual' ? 'manual' : 'automation', automationId: record.id, automationRunStatus: run.status },
  });
}
