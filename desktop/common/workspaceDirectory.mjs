import path from 'node:path';

export function installWorkspaceDirectoryPicker({ ipcMain, dialog, app, getWindow, assertTrustedRenderer }) {
  ipcMain.handle('desktop:select-directory', async (event, requestedPath) => {
    assertTrustedRenderer(event);
    const home = app.getPath('home');
    const input = typeof requestedPath === 'string' ? requestedPath.trim() : '';
    const defaultPath = input === '~' ? home : input.startsWith('~/')
      ? path.join(home, input.slice(2)) : input || app.getPath('documents');
    const options = {
      title: '选择工作区文件夹',
      buttonLabel: '选择文件夹',
      defaultPath,
      properties: ['openDirectory', 'createDirectory'],
    };
    const window = getWindow();
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
    return { canceled: result.canceled, path: result.canceled ? null : result.filePaths[0] || null };
  });
}
