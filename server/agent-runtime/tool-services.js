import crypto from 'node:crypto';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { createAgentTerminalSessions } from './terminal-sessions.js';
import { createLocalMemoryAdapter } from './local-memory.js';
import { executeWebTool } from './public-web.js';
import { createAgentBrowserSessions } from './browser-sessions.js';
import { createAgentIntegrations } from './integrations.js';
import { createAgentAutomations } from './automations.js';
import { createPiModelMedia } from './model-media.js';
import { resolvePiToolPath } from '../pi-runtime/tool-policy.js';
import { authorizeServiceTool } from './service-tools.js';

export function createAgentToolServices({ terminal = createAgentTerminalSessions(), memory = createLocalMemoryAdapter(), browser = createAgentBrowserSessions(), integrations = createAgentIntegrations(), automations = createAgentAutomations(), modelMedia = createPiModelMedia(), web = executeWebTool } = {}) {
  return {
    integrations, automations,
    async execute(name, input, context) {
      const deadline = AbortSignal.timeout(/^(?:image_|speech_)/.test(name) ? 240_000 : 70_000);
      context = { ...context, projectRoot: await fs.realpath(context.projectRoot), signal: context.signal ? AbortSignal.any([context.signal, deadline]) : deadline };
      authorizeServiceTool(name, input, context.permissionMode);
      let result;
      if (name.startsWith('terminal_')) result = await terminal.execute(name, input, context);
      else if (name === 'memory_retrieve' || name === 'remember') result = await memory.execute(name, input, context);
      else if (name.startsWith('web_')) result = await web(name, input, context);
      else if (name.startsWith('browser_')) result = await browser.execute(name, input, context);
      else if (name.startsWith('automation_')) result = await automations.execute(name, input, context);
      else if (name === 'model_capabilities' || /^(?:image_|speech_)/.test(name)) result = await modelMedia.execute(name, input, context);
      else if (/^(integration_|mcp_|media_)/.test(name)) {
        result = await integrations.execute(name, input, context);
        if (name === 'media_generate' && result.images?.length) {
          const directory = await resolvePiToolPath(context.projectRoot, 'artifacts/agent');
          await fs.mkdir(directory, { recursive: true, mode: 0o700 });
          const artifacts = [];
          for (const image of result.images) {
            const id = crypto.randomUUID();
            const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[image.mimeType];
            if (!extension) continue;
            const file = await resolvePiToolPath(context.projectRoot, path.join(directory, `${id}.${extension}`));
            const data = Buffer.from(image.data, 'base64');
            await fs.writeFile(file, data, { flag: 'wx', mode: 0o600 });
            artifacts.push({ id, path: path.relative(context.projectRoot, file), kind: 'image', mimeType: image.mimeType, size: data.length });
          }
          const { images, ...metadata } = result;
          result = { ...metadata, artifacts };
        }
      }
      else if (name === 'artifact_publish') {
        const file = await resolvePiToolPath(context.projectRoot, input.path);
        const stat = await fs.stat(file);
        if (!stat.isFile()) throw new Error('Artifact must be an existing project file');
        result = { artifact: { id: crypto.randomUUID(), path: path.relative(context.projectRoot, file), title: String(input.title || path.basename(file)).slice(0, 200), kind: 'file', size: stat.size } };
      } else if (name === 'app_publish') {
        const file = await resolvePiToolPath(context.projectRoot, input.path);
        const stat = await fs.stat(file);
        if (!stat.isFile()) throw new Error('App source must be an existing HTML file');
        if (stat.size > 2 * 1024 * 1024) throw new Error('App HTML must not exceed 2 MiB');
        const html = (await fs.readFile(file, 'utf8')).trim();
        if (!/(<!doctype\s+html|<html[\s>]|<body[\s>])/i.test(html)) throw new Error('App source must be a complete HTML document');
        const userId = Number(context.userId);
        if (!Number.isInteger(userId) || userId <= 0) throw new Error('A signed-in user is required to publish an app');
        const appId = String(input.app_id || '').trim() || crypto.randomUUID();
        const appName = String(input.name || '').trim().slice(0, 80);
        if (!appName) throw new Error('App name is required');
        const description = String(input.description || '').trim().slice(0, 500);
        const icon = String(input.icon || '🧪').trim().slice(0, 16);
        const { db } = await import('../database/db.js');
        const existing = db.prepare('SELECT id FROM mini_apps WHERE user_id = ? AND id = ?').get(userId, appId);
        if (input.app_id && !existing) throw new Error('App not found in My Apps');
        if (existing) {
          db.prepare(`UPDATE mini_apps SET name = ?, description = ?, icon = ?, html = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND id = ?`).run(appName, description, icon, html, userId, appId);
        } else {
          db.prepare(`INSERT INTO mini_apps (id, user_id, name, description, icon, html) VALUES (?, ?, ?, ?, ?, ?)`).run(appId, userId, appName, description, icon, html);
        }
        const saved = db.prepare('SELECT id, name, description, icon, created_at, updated_at FROM mini_apps WHERE user_id = ? AND id = ?').get(userId, appId);
        result = { app: { id: saved.id, name: saved.name, description: saved.description, icon: saved.icon, createdAt: saved.created_at, updatedAt: saved.updated_at }, destination: 'My Apps' };
      } else throw new Error('Unsupported runtime service tool');
      return result;
    },
    async shutdown() { automations.stop(); await terminal.shutdown?.(); await browser.shutdown(); await integrations.shutdown(); },
  };
}
