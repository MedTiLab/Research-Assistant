#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod/v4';

import { createAgentComputeToolHandlers } from '../agent-compute-mcp.js';
import {
  terminateActiveComputeProcesses,
  terminateActiveComputeProcessesSync,
} from '../compute-node.js';

export function createAgentComputeMcpServer(options = {}) {
  const handlers = createAgentComputeToolHandlers(options);
  const server = new McpServer({
    name: 'medhelp-compute',
    version: '1.0.0',
  });

  server.registerTool('list', {
    title: 'List MedHelp compute resources',
    description: 'List all configured MedHelp compute resources and the resource currently selected in the UI. Use the returned node ids to route CPU and GPU work explicitly within the same conversation.',
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, () => handlers.list());

  server.registerTool('status', {
    title: 'Check MedHelp compute resource',
    description: 'Verify a MedHelp remote compute resource and return sanitized host, user, CPU, and working-directory information. Omit nodeId to use the resource currently selected in the UI. Credentials never enter the model context.',
    inputSchema: {
      nodeId: z.string().min(1).optional().describe('Configured compute node id; omit to use the current UI selection'),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, (input, extra) => handlers.status(input, { signal: extra.signal }));

  server.registerTool('run', {
    title: 'Run on MedHelp compute resource',
    description: 'Run a shell command on the selected remote compute resource through the local MedHelp Kernel. Set syncBeforeRun only when local project files changed and this command needs them; do not enable it repeatedly when local files are unchanged.',
    inputSchema: {
      nodeId: z.string().min(1).optional().describe('Configured compute node id; omit to use the current UI selection'),
      command: z.string().min(1).max(100_000).describe('Shell command to execute remotely'),
      syncBeforeRun: z.boolean().optional().default(false).describe('Incrementally upload local changes before running; use only when local project files changed'),
    },
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, (input, extra) => handlers.run(input, { signal: extra.signal }));

  server.registerTool('sync', {
    title: 'Synchronize MedHelp compute project',
    description: 'Incrementally synchronize changed project files with the selected remote compute resource. Unchanged files, including large files, are skipped.',
    inputSchema: {
      nodeId: z.string().min(1).optional().describe('Configured compute node id; omit to use the current UI selection'),
      direction: z.enum(['up', 'down']).default('up').describe('up uploads the project; down downloads result paths'),
      files: z.array(z.string()).max(32).optional().default([]).describe('Relative result paths for download; omitted paths use Kernel defaults'),
    },
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, (input, extra) => handlers.sync(input, { signal: extra.signal }));

  return server;
}

export async function main() {
  const server = createAgentComputeMcpServer();
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await terminateActiveComputeProcesses();
    await server.close().catch(() => {});
    process.exit(0);
  };
  process.once('SIGINT', () => { void shutdown(); });
  process.once('SIGTERM', () => { void shutdown(); });
  process.once('exit', () => {
    // Cover forced parent shutdowns where the async signal handler cannot finish.
    terminateActiveComputeProcessesSync();
  });
  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  console.error(`[medhelp-compute] ${error.message}`);
  process.exitCode = 1;
});
