import { createRequire } from 'module';
import { pathToFileURL } from 'url';

export const nativePackages = ['better-sqlite3', 'node-pty', 'bcrypt', 'sharp', 'sqlite3'];
const require = createRequire(import.meta.url);

export function inspectNativePackages(load = require) {
  const failures = [];
  for (const packageName of nativePackages) {
    try {
      const loaded = load(packageName);
      // better-sqlite3 loads its native binding lazily on first DB creation.
      if (packageName === 'better-sqlite3') {
        const db = new loaded(':memory:');
        db.close();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const rebuildable = packageName !== 'sharp' && [
        /NODE_MODULE_VERSION/i,
        /compiled against a different Node\.js version/i,
        /module version mismatch/i,
        /invalid ELF header/i,
        /incompatible architecture/i,
        /not a mach-o file/i,
        /Could not locate the bindings file/i,
        /Cannot find module .+\.(node|\/pty)/i,
      ].some((pattern) => pattern.test(message));
      failures.push({ packageName, message, rebuildable });
    }
  }
  return failures;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(inspectNativePackages()));
}
