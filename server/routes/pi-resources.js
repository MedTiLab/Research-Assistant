import express from 'express';
import { resolveTrustedPiMcpServers } from '../pi-runtime/mcp-projection.js';
import {
  PI_BUILTIN_MCP_PLUGINS,
  isPiMcpAllowed,
  readPiMcpAccess,
  setPiMcpAccess,
} from '../pi-runtime/mcp-access.js';
import { resolveRequestUserId } from '../utils/userScope.js';

// Inspect the same allowlisted resources as the runtime without launching a host,
// MCP process, loading third-party code, or returning secret process parameters.
export function createPiResourcesRouter({ resolveMcp = resolveTrustedPiMcpServers, storageOptions = {} } = {}) {
  const router = express.Router();
  router.get('/resources', async (req, res) => {
    try {
      const userId = resolveRequestUserId(req);
      if (userId == null) return res.status(401).json({ error: 'User context is required' });
      const [mcp, access] = await Promise.all([
        resolveMcp(storageOptions),
        readPiMcpAccess({ userId, storageOptions }),
      ]);
      const bundles = mcp.servers.map(({ name, version }) => ({
        name,
        version,
        allowed: isPiMcpAllowed(access, name),
      }));
      res.json({
        success: true,
        mcpEnabled: process.env.MEDHELP_PI_MCP_ENABLED !== '0',
        bundles,
        mcpPlugins: [
          ...PI_BUILTIN_MCP_PLUGINS.map((plugin) => ({
            ...plugin,
            allowed: isPiMcpAllowed(access, plugin.id),
          })),
          ...bundles.map(({ name, version, allowed }) => ({ id: name, version, allowed, kind: 'bundle' })),
        ],
        nativeExtensions: { supported: false, packagesLoaded: false, globalConfigLoaded: false },
        diagnostics: { mcp: mcp.diagnostics },
      });
    } catch (error) {
      console.error('[ERROR] Pi resources:', error.message);
      res.status(500).json({ error: 'Unable to inspect Pi resources' });
    }
  });
  router.put('/resources/mcp-access/:id', async (req, res) => {
    try {
      const userId = resolveRequestUserId(req);
      if (userId == null) return res.status(401).json({ error: 'User context is required' });
      const mcp = await resolveMcp(storageOptions);
      const availableIds = new Set([
        ...PI_BUILTIN_MCP_PLUGINS.map((plugin) => plugin.id),
        ...mcp.servers.map((entry) => entry.name),
      ]);
      if (!availableIds.has(req.params.id)) return res.status(404).json({ error: 'MCP plugin is not available' });
      const result = await setPiMcpAccess(req.params.id, req.body?.allowed, { userId, storageOptions });
      res.json({ success: true, ...result });
    } catch (error) {
      console.error('[ERROR] Pi MCP access:', error.message);
      res.status(400).json({ error: error.message });
    }
  });
  return router;
}
