import { describe, expect, it, vi } from 'vitest';
import { installWorkspaceDirectoryPicker } from './workspaceDirectory.mjs';
function setup() {
  const handlers = new Map();
  const dialog = { showOpenDialog: vi.fn().mockResolvedValue({ canceled: false, filePaths: ['/Volumes/Research'] }) };
  const assertTrustedRenderer = vi.fn();
  const window = {};
  installWorkspaceDirectoryPicker({ ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, dialog,
    app: { getPath: name => name === 'home' ? '/Users/test' : '/Users/test/Documents' },
    getWindow: () => window, assertTrustedRenderer });
  return { choose: handlers.get('desktop:select-directory'), dialog, assertTrustedRenderer, window };
}
describe('workspace directory picker', () => {
  it('opens a native directory picker and returns an external folder', async () => {
    const { choose, dialog, window, assertTrustedRenderer } = setup(); const event = {};
    expect(await choose(event, '~/Documents/medhelp-ukb')).toEqual({ canceled: false, path: '/Volumes/Research' });
    expect(assertTrustedRenderer).toHaveBeenCalledWith(event);
    expect(dialog.showOpenDialog).toHaveBeenCalledWith(window, expect.objectContaining({ defaultPath: '/Users/test/Documents/medhelp-ukb', properties: ['openDirectory', 'createDirectory'] }));
  });
  it('does not change the selection when the native dialog is canceled', async () => {
    const { choose, dialog } = setup(); dialog.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    expect(await choose({}, '')).toEqual({ canceled: true, path: null });
  });
  it('rejects an untrusted renderer before opening a dialog', async () => {
    const { choose, dialog, assertTrustedRenderer } = setup();assertTrustedRenderer.mockImplementation(() => { throw Error('Untrusted'); });
    await expect(choose({}, '~')).rejects.toThrow('Untrusted');expect(dialog.showOpenDialog).not.toHaveBeenCalled();
  });
});
