import crypto from 'node:crypto';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { resolveAppDataRoot } from '../utils/storagePaths.js';
import { mutateServiceState, readServiceState, serviceStatePath } from './durable-store.js';

function normalizeModelSelection(value, { allowIncomplete = false } = {}) {
  if (value == null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid automation model selection');
  const modelId = String(value.modelId || '').trim();
  const modelProviderId = String(value.modelProviderId || '').trim();
  const modelApi = String(value.modelApi || '').trim();
  if (!modelId || !modelProviderId || !modelApi || modelId.length > 300 || modelProviderId.length > 80 || modelApi.length > 80) {
    if (allowIncomplete) return null;
    throw new Error('Automation model selection requires a valid model, provider and protocol');
  }
  return { modelId, modelProviderId, modelApi };
}

function parseFutureTime(value, now) {
  const at = Date.parse(value);
  if (!/T.*(?:Z|[+-]\d\d:\d\d)$/.test(value || '') || !Number.isFinite(at) || at <= now) {
    throw new Error('at must be a future ISO timestamp with timezone');
  }
  return at;
}

function normalizeInterval(value) {
  if (value == null || value === '') return null;
  if (!Number.isInteger(value) || value < 5 || value > 525600) throw new Error('Repeat interval must be 5–525600 minutes');
  return value;
}

export function createAgentAutomations({ run, now = Date.now, storageOptions = {} } = {}) {
  let timer = null;
  let ticking = false;
  let stopped = false;
  const active = new Map();
  const fileFor = (context) => serviceStatePath(context.identity, 'automations', context.storageOptions || storageOptions);
  const publicRow = ({ projectRoot, userId, ...row }) => ({
    ...row,
    model: row.model ? normalizeModelSelection(row.model, { allowIncomplete: true }) : null,
  });
  const service = {
    async execute(name, input, context) {
      const file = fileFor(context);
      if (name === 'automation_list') return (await readServiceState(file)).map(publicRow);
      if (name === 'automation_create') {
        const at = parseFutureTime(input.at, now());
        if (!input.title?.trim() || !input.prompt?.trim() || input.prompt.length > 16_000) throw new Error('A title and prompt (up to 16,000 characters) are required');
        const interval = normalizeInterval(input.interval_minutes);
        const model = input.model != null
          ? normalizeModelSelection(input.model)
          : normalizeModelSelection(context.model, { allowIncomplete: true });
        const record = { id: crypto.randomUUID(), title: input.title.slice(0, 200), prompt: input.prompt, identity: context.identity, userId: context.userId, projectRoot: context.projectRoot, model, status: 'active', intervalMinutes: interval, nextRunAt: new Date(at).toISOString(), createdAt: new Date(now()).toISOString() };
        await mutateServiceState(file, (rows) => {
          if (rows.filter((row) => row.status === 'active').length >= 20) throw new Error('At most 20 active automations per project');
          return [...rows, record].slice(-200);
        });
        return publicRow(record);
      }
      if (name === 'automation_delete') {
        let removed = false;
        await mutateServiceState(file, (rows) => {
          const record = rows.find((row) => row.id === input.automation_id);
          if (!record) throw new Error('Automation not found in this project');
          if (!['cancelled', 'completed'].includes(record.status)) throw new Error('Cancel or complete the automation before deleting it');
          removed = true;
          return rows.filter((row) => row.id !== input.automation_id);
        });
        active.get(input.automation_id)?.abort();
        return { success: removed };
      }
      if (name === 'automation_run') {
        let updated;
        await mutateServiceState(file, (rows) => {
          const record = rows.find((row) => row.id === input.automation_id);
          if (!record) throw new Error('Automation not found in this project');
          if (record.status === 'cancelled') throw new Error('Restore the automation before running it');
          record.status = 'active';
          record.nextRunAt = new Date(now()).toISOString();
          record.updatedAt = new Date(now()).toISOString();
          updated = record;
          return rows;
        });
        await service.tick();
        return publicRow(updated);
      }
      let updated;
      await mutateServiceState(file, (rows) => {
        const record = rows.find((row) => row.id === input.automation_id);
        if (!record) throw new Error('Automation not found in this project');
        if (input.title != null) {
          const title = String(input.title).trim();
          if (!title) throw new Error('Automation title is required');
          record.title = title.slice(0, 200);
        }
        if (input.prompt != null) {
          const prompt = String(input.prompt).trim();
          if (!prompt || prompt.length > 16_000) throw new Error('A prompt of up to 16,000 characters is required');
          record.prompt = prompt;
        }
        if (Object.hasOwn(input, 'model')) record.model = normalizeModelSelection(input.model);
        if (Object.hasOwn(input, 'interval_minutes')) record.intervalMinutes = normalizeInterval(input.interval_minutes);
        if (input.at != null) {
          record.nextRunAt = new Date(parseFutureTime(input.at, now())).toISOString();
          if (record.status === 'completed') record.status = 'active';
        }
        if (input.status != null) {
          if (!['active', 'paused', 'cancelled'].includes(input.status)) throw new Error('Invalid automation status');
          if (input.status === 'active' && record.status !== 'active' && rows.filter((row) => row.status === 'active').length >= 20) throw new Error('At most 20 active automations per project');
          record.status = input.status;
        }
        if (record.status === 'active' && (!Number.isFinite(Date.parse(record.nextRunAt)) || Date.parse(record.nextRunAt) <= now())) record.nextRunAt = new Date(now() + (record.intervalMinutes || 1) * 60_000).toISOString();
        record.updatedAt = new Date(now()).toISOString();
        updated = record;
        return rows;
      });
      if (input.status && input.status !== 'active') active.get(input.automation_id)?.abort();
      return publicRow(updated);
    },
    async tick() {
      if (ticking || stopped || !run) return;
      ticking = true;
      try {
        const root = path.join(resolveAppDataRoot(storageOptions), 'agent-services');
        const owners = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
        for (const owner of owners.filter((entry) => entry.isDirectory() && /^[a-f0-9]{32}$/.test(entry.name))) {
          const ownerRoot = path.join(root, owner.name);
          const projects = await fs.readdir(ownerRoot, { withFileTypes: true }).catch(() => []);
          for (const project of projects.filter((entry) => entry.isDirectory() && /^[a-f0-9]{32}$/.test(entry.name))) {
            const file = path.join(ownerRoot, project.name, 'automations.json');
            const claimed = [];
            await mutateServiceState(file, (rows) => {
              for (const record of rows) {
                if (record.lastStatus === 'running' && !active.has(record.id)) record.lastStatus = 'interrupted';
                if (record.status !== 'active' || Date.parse(record.nextRunAt) > now() || active.has(record.id) || active.size + claimed.length >= 2) continue;
                // Persist the claim before dispatch. No catch-up loop or automatic replay after a crash.
                record.lastRunAt = new Date(now()).toISOString();
                record.lastStatus = 'running';
                record.lastSessionId = crypto.randomUUID();
                record.nextRunAt = record.intervalMinutes ? new Date(now() + record.intervalMinutes * 60_000).toISOString() : null;
                if (!record.intervalMinutes) record.status = 'completed';
                claimed.push(structuredClone(record));
              }
              return rows;
            });
            for (const record of claimed) {
              const controller = new AbortController();
              active.set(record.id, controller);
              const timeout = setTimeout(() => controller.abort(), 30 * 60_000);
              timeout.unref?.();
              Promise.resolve().then(() => run(record, controller.signal)).then(
                () => ({ status: 'completed' }),
                (error) => ({ status: controller.signal.aborted ? 'cancelled' : 'failed', error: String(error.message || error).slice(0, 500) }),
              ).then(async (outcome) => {
                await mutateServiceState(file, (rows) => {
                  const current = rows.find((row) => row.id === record.id);
                  if (current) Object.assign(current, { lastStatus: outcome.status, lastError: outcome.error || null, updatedAt: new Date(now()).toISOString() });
                  return rows;
                });
              }).catch((error) => console.error('[ERROR] Automation outcome persistence:', error.message)).finally(() => { clearTimeout(timeout); active.delete(record.id); });
            }
          }
        }
      } finally { ticking = false; }
    },
    start() { if (timer) return; stopped = false; timer = setInterval(() => service.tick().catch((error) => console.error('[ERROR] Agent scheduler:', error.message)), 15_000); timer.unref?.(); },
    stop() { stopped = true; clearInterval(timer); timer = null; for (const controller of active.values()) controller.abort(); },
  };
  return service;
}

export async function listAutomationWork(identity, options = {}) {
  const rows = await readServiceState(serviceStatePath(identity, 'automations', options));
  return rows.map((row) => ({ id: row.id, title: row.title, description: row.lastError || row.prompt, sessionId: row.lastSessionId || row.identity.sessionId, runtimeId: 'pi', projectKey: identity.projectKey, status: row.lastStatus === 'running' ? 'running' : row.lastStatus === 'failed' ? 'failed' : row.status === 'active' ? 'scheduled' : row.status, schedule: row.nextRunAt, updatedAt: row.updatedAt || row.createdAt, automation: true }));
}
