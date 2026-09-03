import { resolveAvailableCliCommand } from './cliResolution.js';

async function loadBundledCodexResolver() {
  try {
    const codexAppServer = await import('../codex-app-server.js');
    return codexAppServer.resolveBundledCodexExecutable;
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') return null;
    throw error;
  }
}

/**
 * Resolve Codex for user-facing CLI operations.
 *
 * Desktop bundles Codex inside the local Kernel, so availability must not
 * depend on importing the user's login-shell PATH successfully. An explicit
 * CODEX_CLI_PATH still wins when valid, followed by the bundled executable,
 * then the ordinary PATH command for development installations.
 */
export async function resolveCodexCliExecutable(options = {}) {
  const resolveBundled = options.resolveBundled || await loadBundledCodexResolver();
  const resolveAvailable = options.resolveAvailable || resolveAvailableCliCommand;
  const envVarName = options.envVarName || 'CODEX_CLI_PATH';
  let bundledCommand = null;

  try {
    bundledCommand = resolveBundled?.({ ignoreEnvironment: true }) || null;
  } catch {
    // Unsupported or intentionally unbundled platforms can still use PATH.
  }

  // The bundled resolver already verifies that this exact executable exists.
  // Avoid launching `codex --help` on every settings/status request. Keep an
  // explicit user override authoritative and probe it through the normal path.
  const explicitCommand = String(process.env[envVarName] || '').trim();
  if (bundledCommand && !explicitCommand) {
    return bundledCommand;
  }

  const defaultCommands = [
    bundledCommand,
    ...(options.defaultCommands || ['codex']),
  ].filter(Boolean);
  const resolverOptions = {
    envVarName,
    defaultCommands,
    platform: options.platform || process.platform,
    appendWindowsSuffixes: true,
  };
  if (options.probe) resolverOptions.probe = options.probe;

  return resolveAvailable(resolverOptions);
}
