#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod/v4';

const server = new McpServer({ name: 'medhelp-pi-test', version: '1.0.0' });

server.registerTool('echo', {
  title: 'Echo fixture',
  description: 'Echo a value through the trusted MCP integration fixture.',
  inputSchema: {
    value: z.string().min(1).max(100),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
}, ({ value }) => ({ content: [{ type: 'text', text: `MCP echo: ${value}` }] }));

await server.connect(new StdioServerTransport());
