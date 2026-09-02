import { resolveBundledCodexExecutable } from '../codex-app-server.js';
import { resolveAvailableCliCommand } from './cliResolution.js';

/**
 * Resolve Codex for user-facing CLI operations.
 *
 * Desktop bundles Codex inside the local Kernel, so availability must not
 * depend on importing the user's login-shell PATH successfully. An explicit
 * CODEX_CLI_PATH still wins when valid, followed by the bundled executable,
 * then the ordinary PATH command for development installations.
 */
export async function resolveCodexCliExecutable(options = {}) {
  const resolveBundled = options.resolveBundled || resolveBundledCodexExecutable;
  const resolveAvailable = options.resolveAvailable || resolveAvailableCliCommand;
  const envVarName = options.envVarName || 'CODEX_CLI_PATH';
  let bundledCommand = null;

  try {
    bundledCommand = resolveBundled({ ignoreEnvironment: true });
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
