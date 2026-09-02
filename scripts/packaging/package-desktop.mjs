#!/usr/bin/env node

if (process.platform === 'darwin') {
  await import('./macos/package-online-desktop.mjs');
} else if (process.platform === 'win32') {
  await import('./windows/package-online-desktop.mjs');
} else {
  throw new Error(`MedHelp Desktop packaging supports macOS and Windows, not ${process.platform}.`);
}
