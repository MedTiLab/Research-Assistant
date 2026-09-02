import fs from 'node:fs';

import { describe, expect, it } from 'vitest';

const settingsSource = fs.readFileSync(new URL('./Settings.jsx', import.meta.url), 'utf8');

describe('Offline settings routing', () => {
  it('routes every Claude MCP settings operation through the local Kernel when paired', () => {
    expect(settingsSource).toContain(
      '`${localKernelHttpBaseUrl}/api/local/mcp${endpoint}`',
    );
    expect(settingsSource).toContain('Authorization: `Bearer ${localKernelSessionToken}`');

    for (const endpoint of [
      "fetchClaudeMcpSettingsApi('/config/read')",
      "fetchClaudeMcpSettingsApi('/cli/list')",
      "fetchClaudeMcpSettingsApi('/cli/add'",
      'fetchClaudeMcpSettingsApi(`/cli/remove/',
      "fetchClaudeMcpSettingsApi('/bundle/install'",
      "fetchClaudeMcpSettingsApi('/cli/add-json'",
    ]) {
      expect(settingsSource).toContain(endpoint);
    }
  });
});
