import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(__filename), '../..');

let stopping = false;

async function shutdown(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  try {
    const serverModule = await import('../../server/index.js');
    await serverModule.stopServer();
  } catch (error) {
    process.stderr.write(`[legacy-runtime] Graceful shutdown failed: ${error?.stack || error}\n`);
    exitCode = 1;
  } finally {
    process.exit(exitCode);
  }
}

process.on('SIGTERM', () => void shutdown(0));
process.on('SIGINT', () => void shutdown(0));
process.on('message', (message) => {
  if (message?.type === 'medhelp-runtime-shutdown') {
    void shutdown(0);
  }
});
process.on('uncaughtException', (error) => {
  process.stderr.write(`[legacy-runtime] uncaughtException: ${error?.stack || error}\n`);
  void shutdown(1);
});
process.on('unhandledRejection', (reason) => {
  process.stderr.write(`[legacy-runtime] unhandledRejection: ${reason?.stack || reason}\n`);
  void shutdown(1);
});

try {
  process.chdir(projectRoot);
  const serverModule = await import('../../server/index.js');
  const { activePort } = await serverModule.startServer();
  process.send?.({
    type: 'medhelp-runtime-ready',
    pid: process.pid,
    baseUrl: `http://127.0.0.1:${activePort}`,
  });
} catch (error) {
  process.stderr.write(`[legacy-runtime] Startup failed: ${error?.stack || error}\n`);
  process.exit(1);
}
