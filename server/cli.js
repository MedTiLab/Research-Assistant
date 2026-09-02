#!/usr/bin/env node
/**
 * MedHelp® CLI
 *
 * Provides command-line utilities for managing MedHelp®
 *
 * Commands:
 *   (no args)     - Start the server (default)
 *   start         - Start the server
 *   local-kernel  - Start the loopback-only local Kernel
 *   status        - Show configuration and data locations
 *   help          - Show help information
 *   version       - Show version information
 *
 * Legacy alias:
 *   vibelab       - Still supported as a compatibility command alias
 */

import fs from 'fs';
import { promises as fsPromises } from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { Writable } from 'stream';
import readline from 'readline/promises';
import crypto from 'crypto';
import { resolveAppDataRoot, resolveAppDatabasePath } from './utils/storagePaths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ANSI color codes for terminal output
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',

    // Foreground colors
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    white: '\x1b[37m',
    gray: '\x1b[90m',
};

// Helper to colorize text
const c = {
    info: (text) => `${colors.cyan}${text}${colors.reset}`,
    ok: (text) => `${colors.green}${text}${colors.reset}`,
    warn: (text) => `${colors.yellow}${text}${colors.reset}`,
    error: (text) => `${colors.yellow}${text}${colors.reset}`,
    tip: (text) => `${colors.blue}${text}${colors.reset}`,
    bright: (text) => `${colors.bright}${text}${colors.reset}`,
    dim: (text) => `${colors.dim}${text}${colors.reset}`,
};

// Load package.json for version info
const packageJsonPath = path.join(__dirname, '../package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const DEFAULT_CLOUD_APP_URL = 'https://app.medtimehelp.com';

// Load environment variables from .env file if it exists
function loadEnvFile() {
    try {
        const envPath = path.join(__dirname, '../.env');
        const envFile = fs.readFileSync(envPath, 'utf8');
        envFile.split('\n').forEach(line => {
            const trimmedLine = line.trim();
            if (trimmedLine && !trimmedLine.startsWith('#')) {
                const [key, ...valueParts] = trimmedLine.split('=');
                if (key && valueParts.length > 0 && !process.env[key]) {
                    process.env[key] = valueParts.join('=').trim();
                }
            }
        });
    } catch (e) {
        // .env file is optional
    }
}

// Get the database path (same logic as db.js)
function getDatabasePath() {
    loadEnvFile();
    return process.env.DATABASE_PATH || resolveAppDatabasePath();
}

// Get the installation directory
function getInstallDir() {
    return path.join(__dirname, '..');
}

function getCloudBaseUrl() {
    return String(process.env.MEDHELP_CLOUD_APP_URL || process.env.MEDHELP_APP_URL || DEFAULT_CLOUD_APP_URL)
        .trim()
        .replace(/\/+$/, '');
}

function getCliAuthStorePath() {
    return path.join(resolveAppDataRoot(), 'cloud-auth.json');
}

async function readCliAuthStore() {
    try {
        return JSON.parse(await fsPromises.readFile(getCliAuthStorePath(), 'utf8'));
    } catch {
        return null;
    }
}

async function writeCliAuthStore(payload) {
    const authPath = getCliAuthStorePath();
    await fsPromises.mkdir(path.dirname(authPath), { recursive: true });
    await fsPromises.writeFile(authPath, `${JSON.stringify({
        savedAt: new Date().toISOString(),
        cloudBaseUrl: getCloudBaseUrl(),
        ...payload,
    }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    try {
        fs.chmodSync(authPath, 0o600);
    } catch {
        // Best effort on platforms that do not support chmod.
    }
    return authPath;
}

async function removeCliAuthStore() {
    await fsPromises.rm(getCliAuthStorePath(), { force: true });
}

function createQuestionInterface({ muted = false } = {}) {
    const mutableOutput = new Writable({
        write(chunk, encoding, callback) {
            if (!mutableOutput.muted) {
                process.stdout.write(chunk, encoding);
            }
            callback();
        },
    });
    mutableOutput.muted = muted;
    return readline.createInterface({
        input: process.stdin,
        output: mutableOutput,
        terminal: true,
    });
}

async function askText(question, fallback = '') {
    if (fallback) {
        return fallback;
    }
    const rl = createQuestionInterface();
    try {
        return (await rl.question(question)).trim();
    } finally {
        rl.close();
    }
}

async function askPassword(question, fallback = '') {
    if (fallback) {
        return fallback;
    }
    process.stdout.write(question);
    const rl = createQuestionInterface({ muted: true });
    try {
        const value = await rl.question('');
        process.stdout.write('\n');
        return value;
    } finally {
        rl.close();
    }
}

// Show status command
function showStatus() {
    console.log(`\n${c.bright('MedHelp® - Status')}\n`);
    console.log(c.dim('═'.repeat(60)));

    // Version info
    console.log(`\n${c.info('[INFO]')} Version: ${c.bright(packageJson.version)}`);

    // Installation location
    const installDir = getInstallDir();
    console.log(`\n${c.info('[INFO]')} Installation Directory:`);
    console.log(`       ${c.dim(installDir)}`);

    // Database location
    const dbPath = getDatabasePath();
    const dbExists = fs.existsSync(dbPath);
    console.log(`\n${c.info('[INFO]')} Database Location:`);
    console.log(`       ${c.dim(dbPath)}`);
    console.log(`       Status: ${dbExists ? c.ok('[OK] Exists') : c.warn('[WARN] Not created yet (will be created on first run)')}`);

    console.log(`\n${c.info('[INFO]')} Data Directory:`);
    console.log(`       ${c.dim(process.env.MEDHELP_DATA_DIR || resolveAppDataRoot())}`);

    const authPath = getCliAuthStorePath();
    console.log(`\n${c.info('[INFO]')} CLI Login:`);
    console.log(`       ${c.dim(authPath)}`);
    console.log(`       Status: ${fs.existsSync(authPath) ? c.ok('[OK] Logged in') : c.warn('[WARN] Not logged in')}`);

    if (dbExists) {
        const stats = fs.statSync(dbPath);
        console.log(`       Size: ${c.dim((stats.size / 1024).toFixed(2) + ' KB')}`);
        console.log(`       Modified: ${c.dim(stats.mtime.toLocaleString())}`);
    }

    // Environment variables
    console.log(`\n${c.info('[INFO]')} Configuration:`);
    console.log(`       PORT: ${c.bright(process.env.PORT || '3001')} ${c.dim(process.env.PORT ? '' : '(default)')}`);
    console.log(`       DATABASE_PATH: ${c.dim(process.env.DATABASE_PATH || '(using default location)')}`);
    console.log(`       CLAUDE_CLI_PATH: ${c.dim(process.env.CLAUDE_CLI_PATH || 'claude (default)')}`);
    console.log(`       CONTEXT_WINDOW: ${c.dim(process.env.CONTEXT_WINDOW || '256000 (fallback)')}`);

    // Claude projects folder
    const claudeProjectsPath = path.join(os.homedir(), '.claude', 'projects');
    const projectsExists = fs.existsSync(claudeProjectsPath);
    console.log(`\n${c.info('[INFO]')} Claude Projects Folder:`);
    console.log(`       ${c.dim(claudeProjectsPath)}`);
    console.log(`       Status: ${projectsExists ? c.ok('[OK] Exists') : c.warn('[WARN] Not found')}`);

    // Config file location
    const envFilePath = path.join(__dirname, '../.env');
    const envExists = fs.existsSync(envFilePath);
    console.log(`\n${c.info('[INFO]')} Configuration File:`);
    console.log(`       ${c.dim(envFilePath)}`);
    console.log(`       Status: ${envExists ? c.ok('[OK] Exists') : c.warn('[WARN] Not found (using defaults)')}`);

    console.log('\n' + c.dim('═'.repeat(60)));
    console.log(`\n${c.tip('[TIP]')} Hints:`);
    console.log(`      ${c.dim('>')} Run ${c.bright('medhelp')} to start and open the web app`);
    console.log(`      ${c.dim('>')} Use ${c.bright('medhelp --port 8080')} to run on a custom port`);
    console.log(`      ${c.dim('>')} Use ${c.bright('medhelp --no-open')} to start without opening a browser`);
    console.log(`      ${c.dim('>')} Use ${c.bright('medhelp --database-path /path/to/db')} for custom database`);
    console.log(`      ${c.dim('>')} Run ${c.bright('medhelp help')} for all options`);
    console.log(`      ${c.dim('>')} Legacy alias ${c.bright('vibelab')} is still supported during transition (Deprecation: V2.0, Q3 2026)`);
    console.log(`      ${c.dim('>')} Access the UI at http://localhost:${process.env.PORT || '3001'}\n`);
}

// Show help
function showHelp() {
    console.log(`
╔═══════════════════════════════════════════════════════════════╗
║              MedHelp® - Command Line Tool               ║
╚═══════════════════════════════════════════════════════════════╝

Usage:
  medhelp [command] [options]

Legacy alias:
  vibelab [command] [options]

Commands:
  login          Log in to MedHelp cloud from this terminal
  logout         Remove the saved terminal login
  start          Start the MedHelp® server (default)
  local-kernel   Start, stop, or inspect the loopback-only local Kernel
  kernel         Alias for local-kernel
  status         Show configuration and data locations
  update         Update to the latest version
  help           Show this help information
  version        Show version information

Options:
  -p, --port <port>           Set server port (default: 3001)
  --database-path <path>      Set custom database location
  --no-open                   Start the server without opening the browser
  -h, --help                  Show this help information
  -v, --version               Show version information

Examples:
  $ medhelp                        # Start and open the web app
  $ medhelp login                  # Log in from terminal
  $ medhelp --port 8080            # Start on port 8080 and open it
  $ medhelp --no-open              # Start without opening a browser
  $ medhelp -p 3000                # Short form for port
  $ medhelp start --port 4000      # Explicit start command
  $ medhelp local-kernel start     # Start the local Kernel for app.medtimehelp.com
  $ medhelp local-kernel status    # Check the local Kernel runtime file
  $ medhelp local-kernel stop      # Stop the background local Kernel
  $ medhelp status                 # Show configuration
  $ vibelab status                 # Legacy alias still works

Environment Variables:
  PORT                Set server port (default: 3001)
  DATABASE_PATH       Set custom database location
  CLAUDE_CLI_PATH     Set custom Claude CLI path
  CONTEXT_WINDOW      Fallback context window for unknown models (default: 256000)

Documentation:
  ${packageJson.homepage || 'https://github.com/MedTiLab/Research-Assistant'}

Report Issues:
  ${packageJson.bugs?.url || 'https://github.com/MedTiLab/Research-Assistant/issues'}
`);
}

// Show version
function showVersion() {
    console.log(`${packageJson.version}`);
}

// Compare semver versions, returns true if v1 > v2
function isNewerVersion(v1, v2) {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
        if (parts1[i] > parts2[i]) return true;
        if (parts1[i] < parts2[i]) return false;
    }
    return false;
}

// Check for updates
async function checkForUpdates(silent = false) {
    try {
        const { execSync } = await import('child_process');
        const packageName = packageJson.name || 'medhelp';
        const latestVersion = execSync(`npm show ${packageName} version`, {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
        const currentVersion = packageJson.version;

        if (isNewerVersion(latestVersion, currentVersion)) {
            console.log(`\n${c.warn('[UPDATE]')} New version available: ${c.bright(latestVersion)} (current: ${currentVersion})`);
            console.log(`         Run ${c.bright(`${packageName} update`)} to update\n`);
            return { hasUpdate: true, latestVersion, currentVersion };
        } else if (!silent) {
            console.log(`${c.ok('[OK]')} You are on the latest version (${currentVersion})`);
        }
        return { hasUpdate: false, latestVersion, currentVersion };
    } catch (e) {
        if (!silent) {
            console.log(`${c.warn('[WARN]')} Could not check for updates`);
        }
        return { hasUpdate: false, error: e.message };
    }
}

// Update the package
async function updatePackage() {
    try {
        const { execSync } = await import('child_process');
        console.log(`${c.info('[INFO]')} Checking for updates...`);

        const { hasUpdate, latestVersion, currentVersion } = await checkForUpdates(true);

        if (!hasUpdate) {
            console.log(`${c.ok('[OK]')} Already on the latest version (${currentVersion})`);
            return;
        }

        console.log(`${c.info('[INFO]')} Updating from ${currentVersion} to ${latestVersion}...`);
        const packageName = packageJson.name || 'medhelp';
        execSync(`npm update -g ${packageName}`, { stdio: 'inherit' });
        console.log(`${c.ok('[OK]')} Update complete! Restart ${packageName} to use the new version.`);
    } catch (e) {
        console.error(`${c.error('[ERROR]')} Update failed: ${e.message}`);
        console.log(`${c.tip('[TIP]')} Try running manually: npm update -g ${packageJson.name || 'medhelp'}`);
    }
}

async function loginCli(options = {}) {
    const cloudBaseUrl = getCloudBaseUrl();
    const username = await askText('MedHelp username: ', process.env.MEDHELP_USERNAME || options.username || '');
    const password = await askPassword('MedHelp password: ', process.env.MEDHELP_PASSWORD || options.password || '');

    if (!username || !password) {
        throw new Error('Username and password are required');
    }

    const existingAuth = await readCliAuthStore();
    const deviceFingerprint = existingAuth?.deviceFingerprint || crypto
        .createHash('sha256')
        .update(`${os.hostname()}:${resolveAppDataRoot()}:medhelp-cli-device`)
        .digest('hex');
    const deviceLabel = `${os.hostname()} · MedHelp CLI`;
    console.log(`${c.info('[INFO]')} Logging in to ${c.bright(cloudBaseUrl)}...`);
    const response = await fetch(`${cloudBaseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            username,
            password,
            deviceFingerprint,
            deviceLabel,
            clientType: 'local-engine',
            clientVersion: packageJson.version || null,
            clientPlatform: process.platform,
        }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.accessToken) {
        throw new Error(payload?.error || `Login failed with HTTP ${response.status}`);
    }

    const authPath = await writeCliAuthStore({
        accessToken: payload.accessToken,
        refreshToken: payload.refreshToken || null,
        tokenType: payload.tokenType || 'Bearer',
        expiresIn: payload.expiresIn || null,
        refreshExpiresIn: payload.refreshExpiresIn || null,
        sessionId: payload.sessionId || null,
        deviceFingerprint,
        user: payload.user || null,
    });

    console.log(`${c.ok('[OK]')} Logged in${payload.user?.username ? ` as ${c.bright(payload.user.username)}` : ''}.`);
    console.log(`${c.info('[INFO]')} Saved terminal login: ${c.dim(authPath)}`);
    console.log(`${c.tip('[TIP]')} Keep the backend running with ${c.bright('medhelp local-kernel start')}`);
}

async function logoutCli() {
    const auth = await readCliAuthStore();
    if (auth?.accessToken) {
        const cloudBaseUrl = auth.cloudBaseUrl || getCloudBaseUrl();
        let accessToken = auth.accessToken;
        let response = await fetch(`${cloudBaseUrl}/api/auth/logout`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}` },
        }).catch(() => null);
        if (response?.status === 401 && auth.refreshToken) {
            const refreshed = await fetch(`${cloudBaseUrl}/api/auth/refresh`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    refreshToken: auth.refreshToken,
                    deviceFingerprint: auth.deviceFingerprint || null,
                }),
            }).catch(() => null);
            if (refreshed?.ok) {
                const payload = await refreshed.json().catch(() => ({}));
                accessToken = payload.accessToken || null;
                if (accessToken) {
                    response = await fetch(`${cloudBaseUrl}/api/auth/logout`, {
                        method: 'POST',
                        headers: { Authorization: `Bearer ${accessToken}` },
                    }).catch(() => null);
                }
            }
        }
    }
    await removeCliAuthStore();
    console.log(`${c.ok('[OK]')} Removed saved terminal login.`);
}

async function showCliLoginStatus() {
    const auth = await readCliAuthStore();
    console.log(`\n${c.bright('MedHelp® - CLI Login')}\n`);
    console.log(c.dim('═'.repeat(60)));
    console.log(`\n${c.info('[INFO]')} Cloud: ${c.bright(auth?.cloudBaseUrl || getCloudBaseUrl())}`);
    console.log(`${c.info('[INFO]')} Auth file: ${c.dim(getCliAuthStorePath())}`);
    if (auth?.accessToken) {
        console.log(`${c.info('[INFO]')} Status: ${c.ok('[OK] Logged in')}`);
        if (auth.user?.username) {
            console.log(`${c.info('[INFO]')} User: ${c.bright(auth.user.username)}`);
        }
    } else {
        console.log(`${c.info('[INFO]')} Status: ${c.warn('[WARN] Not logged in')}`);
        console.log(`${c.tip('[TIP]')} Run ${c.bright('medhelp login')} to log in from terminal.`);
    }
    console.log('');
}

function shouldOpenBrowser(options = {}) {
    if (options.open === false) return false;
    if (process.env.MEDHELP_NO_OPEN === '1' || process.env.MEDHELP_NO_OPEN === 'true') return false;
    return true;
}

async function ensureNativeModules() {
    const scriptPath = path.join(__dirname, '../scripts/ensure-native-modules.js');
    if (!fs.existsSync(scriptPath)) {
        return;
    }

    const child = spawn(process.execPath, [scriptPath], {
        cwd: getInstallDir(),
        env: process.env,
        stdio: 'inherit',
    });

    await new Promise((resolve, reject) => {
        child.on('error', reject);
        child.on('exit', (code, signal) => {
            if (code === 0) {
                resolve();
                return;
            }
            reject(new Error(`native module check failed${signal ? ` (${signal})` : ` (exit ${code ?? 1})`}`));
        });
    });
}

function getDashboardUrl(startResult = {}) {
    if (process.env.MEDHELP_APP_URL) {
        return process.env.MEDHELP_APP_URL;
    }

    const host = startResult.host && startResult.host !== '0.0.0.0'
        ? startResult.host
        : 'localhost';
    const port = startResult.activePort || process.env.PORT || '3001';
    return `http://${host}:${port}/`;
}

async function findRunningDashboard(startPort = 3001, maxAttempts = 20) {
    for (let offset = 0; offset < maxAttempts; offset += 1) {
        const port = Number(startPort) + offset;
        if (!Number.isInteger(port) || port <= 0) continue;

        try {
            const response = await fetch(`http://127.0.0.1:${port}/health`, {
                signal: AbortSignal.timeout(350),
            });
            if (!response.ok) continue;

            const data = await response.json().catch(() => ({}));
            if (data && data.status === 'ok') {
                return { port, url: `http://localhost:${port}/`, health: data };
            }
        } catch {
            // No MedHelp server on this port.
        }
    }
    return null;
}

function openBrowser(url) {
    const command = process.platform === 'darwin'
        ? 'open'
        : process.platform === 'win32'
            ? 'cmd'
            : 'xdg-open';
    const args = process.platform === 'win32'
        ? ['/c', 'start', '', url]
        : [url];

    try {
        const child = spawn(command, args, {
            detached: true,
            stdio: 'ignore',
        });
        child.unref();
        console.log(`${c.ok('[OK]')} Opened MedHelp in your browser: ${c.bright(url)}`);
    } catch (error) {
        console.log(`${c.warn('[WARN]')} Could not open the browser automatically: ${error.message}`);
        console.log(`${c.tip('[TIP]')} Open this URL manually: ${c.bright(url)}`);
    }
}

// Start the server
async function startServer(options = {}) {
    // Check for updates silently on startup
    checkForUpdates(true);
    await ensureNativeModules();

    const requestedPort = Number.parseInt(process.env.PORT || '3001', 10) || 3001;
    const runningDashboard = await findRunningDashboard(requestedPort);
    if (runningDashboard) {
        console.log(`${c.ok('[OK]')} MedHelp is already running: ${c.bright(runningDashboard.url)}`);
        if (shouldOpenBrowser(options)) {
            openBrowser(runningDashboard.url);
        } else {
            console.log(`${c.info('[INFO]')} Web app: ${c.bright(runningDashboard.url)}`);
        }
        return;
    }

    const serverModule = await import('./index.js');
    const result = await serverModule.startServer();
    const url = getDashboardUrl(result);

    if (shouldOpenBrowser(options)) {
        openBrowser(url);
    } else {
        console.log(`${c.info('[INFO]')} Web app: ${c.bright(url)}`);
    }
}

async function startLocalKernel(options = {}) {
    checkForUpdates(true);
    await ensureNativeModules();

    process.env.MEDHELP_LOCAL_KERNEL = '1';
    process.env.MEDHELP_LOCAL_HOST = process.env.MEDHELP_LOCAL_HOST || '127.0.0.1';
    process.env.MEDHELP_LOCAL_PORT = options.port || process.env.MEDHELP_LOCAL_PORT || '5055';

    const serverModule = await import('./index.js');
    const result = await serverModule.startServer();
    const auth = await readCliAuthStore();
    console.log(`${c.ok('[OK]')} MedHelp Local Engine is running. Leave this terminal open while using MedHelp.`);
    if (auth?.accessToken) {
        console.log(`${c.info('[INFO]')} Terminal login: ${c.ok('[OK]')} ${auth.user?.username || 'saved'}`);
    } else {
        console.log(`${c.info('[INFO]')} Terminal login: ${c.warn('[WARN] Not logged in')} (${c.bright('medhelp login')})`);
    }
    console.log(`${c.info('[INFO]')} Frontend is not opened in CLI mode. The web page will detect the Local Engine automatically if you open it separately.`);
    return result;
}

async function showLocalKernelStatus() {
    const { resolveLocalKernelRuntimeFile } = await import('./utils/localKernelRuntime.js');
    const runtimeFile = resolveLocalKernelRuntimeFile();

    console.log(`\n${c.bright('MedHelp® - Local Engine')}\n`);
    console.log(c.dim('═'.repeat(60)));
    console.log(`\n${c.info('[INFO]')} Runtime file:`);
    console.log(`       ${c.dim(runtimeFile)}`);

    if (!fs.existsSync(runtimeFile)) {
        console.log(`       Status: ${c.warn('[WARN] Not running')}`);
        console.log(`\n${c.tip('[TIP]')} Start it with ${c.bright('medhelp local-kernel start')}\n`);
        return;
    }

    let runtime = null;
    try {
        runtime = JSON.parse(fs.readFileSync(runtimeFile, 'utf8'));
    } catch (error) {
        console.log(`       Status: ${c.warn('[WARN] Runtime file is unreadable')}`);
        console.log(`       Error: ${c.dim(error.message)}`);
        return;
    }

    const healthUrl = runtime?.httpUrl ? `${runtime.httpUrl}/health` : null;
    if (!healthUrl) {
        console.log(`       Status: ${c.warn('[WARN] Runtime file has no health URL')}`);
        return;
    }

    try {
        const response = await fetch(healthUrl, { signal: AbortSignal.timeout(750) });
        const health = await response.json().catch(() => ({}));
        if (response.ok && health?.ok) {
            console.log(`       Status: ${c.ok('[OK] Running')}`);
            console.log(`       Product: ${c.dim('MedHelp Local Engine')}`);
            console.log(`       Version: ${c.dim(health.version || runtime.version || packageJson.version)}`);
            return;
        }
        console.log(`       Status: ${c.warn('[WARN] No healthy Local Engine response')}`);
    } catch {
        console.log(`       Status: ${c.warn('[WARN] Runtime file exists, but Local Engine did not respond')}`);
    }
}

async function stopLocalKernel() {
    const { isLoopbackHost, resolveLocalKernelRuntimeFile } = await import('./utils/localKernelRuntime.js');
    const runtimeFile = resolveLocalKernelRuntimeFile();

    if (!fs.existsSync(runtimeFile)) {
        console.log(`${c.warn('[WARN]')} MedHelp Local Engine is not running.`);
        return;
    }

    let runtime;
    try {
        runtime = JSON.parse(await fsPromises.readFile(runtimeFile, 'utf8'));
    } catch (error) {
        throw new Error(`Local Engine runtime file is unreadable: ${error.message}`);
    }

    let endpoint;
    try {
        endpoint = new URL(runtime?.httpUrl || '');
    } catch {
        throw new Error('Local Engine runtime file has an invalid endpoint');
    }
    if (
        runtime?.product !== 'MedHelp Kernel'
        || !Number.isInteger(Number(runtime?.pid))
        || !isLoopbackHost(endpoint.hostname)
        || !runtime?.controlToken
    ) {
        throw new Error('Local Engine runtime file is invalid or belongs to an older version');
    }

    let response;
    try {
        response = await fetch(`${endpoint.origin}/api/local/control/shutdown`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-MedHelp-Control-Token': runtime.controlToken,
            },
            body: JSON.stringify({}),
            signal: AbortSignal.timeout(3000),
        });
    } catch {
        await fsPromises.rm(runtimeFile, { force: true });
        console.log(`${c.warn('[WARN]')} Local Engine was not responding; removed its stale runtime file.`);
        return;
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.shuttingDown) {
        throw new Error(payload?.error || `Local Engine refused to stop (HTTP ${response.status})`);
    }

    for (let attempt = 0; attempt < 20; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 150));
        try {
            const health = await fetch(`${endpoint.origin}/health`, { signal: AbortSignal.timeout(250) });
            if (health.ok) continue;
        } catch {
            break;
        }
    }
    console.log(`${c.ok('[OK]')} Local Engine stopped.`);
}

// Parse CLI arguments
function parseArgs(args) {
    const parsed = { command: 'start', subcommand: null, options: {} };
    const positionals = [];

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        if (arg === '--port' || arg === '-p') {
            parsed.options.port = args[++i];
        } else if (arg.startsWith('--port=')) {
            parsed.options.port = arg.split('=')[1];
        } else if (arg === '--database-path') {
            parsed.options.databasePath = args[++i];
        } else if (arg.startsWith('--database-path=')) {
            parsed.options.databasePath = arg.split('=')[1];
        } else if (arg === '--no-open' || arg === '--no-browser') {
            parsed.options.open = false;
        } else if (arg === '--open') {
            parsed.options.open = true;
        } else if (arg === '--username') {
            parsed.options.username = args[++i];
        } else if (arg.startsWith('--username=')) {
            parsed.options.username = arg.split('=').slice(1).join('=');
        } else if (arg === '--password') {
            parsed.options.password = args[++i];
        } else if (arg.startsWith('--password=')) {
            parsed.options.password = arg.split('=').slice(1).join('=');
        } else if (arg === '--help' || arg === '-h') {
            parsed.command = 'help';
        } else if (arg === '--version' || arg === '-v') {
            parsed.command = 'version';
        } else if (!arg.startsWith('-')) {
            positionals.push(arg);
        }
    }

    if (positionals.length > 0) {
        parsed.command = positionals[0];
        parsed.subcommand = positionals[1] || null;
    }

    return parsed;
}

// Main CLI handler
async function main() {
    const args = process.argv.slice(2);
    const { command, subcommand, options } = parseArgs(args);

    // Apply CLI options to environment variables
    if (options.port) {
        process.env.PORT = options.port;
    }
    if (options.databasePath) {
        process.env.DATABASE_PATH = options.databasePath;
    }

    switch (command) {
        case 'login':
            if (subcommand === 'status') {
                await showCliLoginStatus();
            } else {
                await loginCli(options);
            }
            break;
        case 'logout':
            await logoutCli();
            break;
        case 'start':
            await startServer(options);
            break;
        case 'local-kernel':
        case 'local-core':
        case 'kernel':
            if (subcommand === 'status') {
                await showLocalKernelStatus();
            } else if (subcommand === 'stop') {
                await stopLocalKernel();
            } else if (!subcommand || subcommand === 'start') {
                await startLocalKernel(options);
            } else {
                throw new Error(`Unknown local-kernel command: ${subcommand}`);
            }
            break;
        case 'status':
        case 'info':
            showStatus();
            break;
        case 'help':
        case '-h':
        case '--help':
            showHelp();
            break;
        case 'version':
        case '-v':
        case '--version':
            showVersion();
            break;
        case 'update':
            await updatePackage();
            break;
        default:
            console.error(`\n❌ Unknown command: ${command}`);
            console.log('   Run "medhelp help" for usage information.\n');
            process.exit(1);
    }
}

// Run the CLI
main().catch(error => {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
});
