#!/usr/bin/env node
// Load environment variables before other imports execute
import './load-env.js';
import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const installMode = fs.existsSync(path.join(__dirname, '..', '.git')) ? 'git' : 'npm';
const npmPackageName = process.env.NPM_PACKAGE_NAME || 'medhelp';

// ANSI color codes for terminal output
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    dim: '\x1b[2m',
};

const c = {
    info: (text) => `${colors.cyan}${text}${colors.reset}`,
    ok: (text) => `${colors.green}${text}${colors.reset}`,
    warn: (text) => `${colors.yellow}${text}${colors.reset}`,
    tip: (text) => `${colors.blue}${text}${colors.reset}`,
    bright: (text) => `${colors.bright}${text}${colors.reset}`,
    dim: (text) => `${colors.dim}${text}${colors.reset}`,
};

console.log('Requested PORT from env:', process.env.PORT);

import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import os from 'os';
import http from 'http';
import cors from 'cors';
import { promises as fsPromises } from 'fs';
import { spawn } from 'child_process';
import pty from 'node-pty';
import { ptySessionsMap, listAgentTerminalWork } from './agent-runtime/terminal-sessions.js';
import { listAutomationWork } from './agent-runtime/automations.js';
import agentServicesRoutes from './routes/agent-services.js';
import fetch from 'node-fetch';
import mime from 'mime-types';
import sharp from 'sharp';
import { markVisibleUserContent } from '../shared/visibleUserContent.js';

import {
    getProjects,
    getTrashedProjects,
    getSessions,
    getSessionMessages,
    renameProject,
    findCodexSessionFileById,
    deleteProject,
    restoreProject,
    deleteTrashedProject,
    addProjectManually,
    extractProjectDirectory,
    clearProjectDirectoryCache,
    reindexProjectSessions,
} from './projects.js';
import { getProjectTokenUsageSummary } from './project-token-usage.js';
import {
    abortAgentRuntimeSession,
    abortAllAgentRuntimeSessions,
    codexRuntime,
    piRuntime,
    createAgentRuntimeErrorPayload,
    executeAgentTurn,
    beginAgentRunEngineDrain,
    getAgentRunEngineStatus,
    getActiveAgentRuntimeSessions,
    getAgentRuntimeSessionStatus,
    getRequiredAgentRuntime,
    hasActiveAgentRuntimeSessions,
    runtimeSessionStoreRegistry,
    startAgentRunEngine,
    stopAgentRunEngine,
    shutdownAgentRuntimes,
    steerAgentRuntimeSession,
} from './agent-runtime/index.js';
import { normalizePiPermissionMode } from './pi-runtime/tool-policy.js';
import { syncPiSessionIndex } from './pi-runtime/session-index.js';
import { agentStateTokenUsage, listAgentRuntimeStates, summarizeAgentWork } from './agent-runtime/state-store.js';
import { queryLocalGPU, abortLocalGPUSession, isLocalGPUSessionActive, getLocalGPUSessionStartTime, getActiveLocalGPUSessions } from './local-gpu.js';
import gitRoutes from './routes/git.js';
import authRoutes from './routes/auth.js';
import gatewayRoutes from './routes/gateway.js';
import taskmasterRoutes, { syncTasksWithResearchBrief } from './routes/taskmaster.js';
import mcpUtilsRoutes from './routes/mcp-utils.js';
import commandsRoutes from './routes/commands.js';
import settingsRoutes from './routes/settings.js';
import agentRunsRoutes from './routes/agent-runs.js';
import projectsRoutes, { WORKSPACES_ROOT, getWorkspacesRoot, getUserWorkspacesRoot, getWorkspaceDisplayPath, validateUserWorkspacePath } from './routes/projects.js';
import cliAuthRoutes from './routes/cli-auth.js';
import userRoutes from './routes/user.js';
import environmentSetupRoutes from './routes/environmentSetup.js';
import piModelsRoutes from './routes/pi-models.js';
import { createPiSessionsRouter, createPiSessionProjectResolver } from './routes/pi-sessions.js';
import { createSessionManagementRouter } from './routes/session-management.js';
import { resolveApiSessionTarget } from './utils/apiSessionTarget.js';
import skillsRoutes from './routes/skills.js';
import telemetryRoutes from './routes/telemetry.js';
import computeRoutes from './routes/compute.js';
import newsRoutes from './routes/news.js';
import pubmedDiscoveryRoutes from './routes/pubmed-discovery.js';
import autoResearchRoutes from './routes/auto-research.js';
import referencesRoutes from './routes/references.js';
import medLibraryRoutes from './routes/med-library.js';
import conceptsRoutes from './routes/concepts.js';
import monitorRoutes from './routes/monitor.js';
import sharesRoutes from './routes/shares.js';
import conversationsRoutes from './routes/conversations.js';
import feedbackRoutes from './routes/feedback.js';
import meetingsRoutes from './routes/meetings.js';
import researchTrackingRoutes from './routes/research-tracking.js';
import companionsRoutes from './routes/companions.js';
import miniAppsRoutes from './routes/mini-apps.js';
import localKernelRoutes, {
    getLocalKernelHealthPayload,
    authorizeLocalSessionCapability,
    handleLocalKernelWebSocket,
    localKernelCloudRouter,
    localKernelPublicRouter,
    verifyLocalSessionToken,
} from './routes/localKernel.js';
import { monitorSchedulerService } from './services/monitor-scheduler.js';
import { createMeetingReminderService } from './services/meetingReminders.js';
import { piModelCatalog } from './services/pi-model-catalog.js';
import { configureImChannelRuntime, startConfiguredImChannelRuntimes } from './services/im-channel-runtime.js';
import {
    initializeDatabase,
    authSessionDb,
    sessionDb,
    tagDb,
    auditLogDb,
    getDatabaseLifecycleStatus,
    db,
} from './database/db.js';
import {
    validateApiKey,
    authenticateAccountToken,
    authenticateToken,
    authenticateWebSocket,
    JWT_SECRET,
} from './middleware/auth.js';
import { IS_PLATFORM } from './constants/config.js';
import { enqueueTelemetryEvent } from './telemetry.js';
import { configureTrustedProxy } from './utils/trustedProxy.js';
import { AgentTurnQueueRegistry } from './utils/agentTurnQueue.js';
import {
    createAgentSessionIdentity,
    createAgentSessionKey,
    normalizeRuntimeId,
} from './utils/agentSessionIdentity.js';
import { createClientOperationDeduper } from './utils/clientOperationDeduper.js';
import { buildManagedAgentSessionContext } from './utils/agentSessionEnv.js';
import { getDatabaseApiCredentialForUser } from './utils/databaseApiAgentEnv.js';
import {
    captureCloudUserLongTermMemory,
    getAgentRuntimeEnvState,
    saveCloudUserMemory,
} from './utils/cloudAgentRuntimeEnv.js';
import {
    DEFAULT_BACKEND_PORT,
    DEFAULT_FRONTEND_PORT,
    getFrontendPortSync,
    listenOnAvailablePort,
    parsePortNumber,
    setRuntimePortSync,
} from './utils/runtimePorts.js';
import {
    getLocalKernelAllowedOrigins,
    isLocalKernelMode,
    listenOnLocalKernelPort,
    removeLocalKernelRuntimeFile,
    resolveLocalKernelHost,
    writeLocalKernelRuntimeFile,
} from './utils/localKernelRuntime.js';
import {
    getLocalKernelBrowserFallback,
    resolveServerRuntimeMode,
    shouldServeAppStaticFiles,
} from './utils/localKernelPageGuard.js';
import { completeKernelUpdateIfCurrent } from './utils/kernelUpdater.js';
import { resolveAgentUserId, resolveRequestUserId } from './utils/userScope.js';
import { createLocalApiGate } from './utils/localApiGate.js';
import { resolveAppVersion } from './utils/appVersion.js';
import {
    buildPublicDownloadCatalog,
    resolvePublicDownloadObject,
} from './utils/publicDownloads.js';
import {
    createCosPublicDownloadUrl,
    isCosPublicDownloadConfigured,
} from './utils/cosPublicDownloads.js';
import { assertTrustedJwtSecret, sanitizeAllowedOrigins } from './utils/securityConfig.js';
import { isWebShellOnlyMode } from './utils/webShellMode.js';
import {
    authorize as authorizeEntitlement,
    requireCapability,
} from './utils/entitlements.js';
import { openPathInNativeFileManager } from './utils/nativeFileManager.js';
import { buildCodexTokenUsageFromJsonl } from './utils/sessionTokenUsage.js';
import { getClaudeModelContextWindow } from '../shared/modelConstants.js';
import { markdownToDocxBuffer, markdownToPdfBuffer } from './utils/markdownDocumentExport.js';
import { readExecutionMemorySnapshot } from './execution-memory/summary.js';
import { createExecutionMemoryTracker, wrapWriterWithExecutionMemory } from './execution-memory/tracker.js';
import { syncExecutionMemoryToTasks } from './execution-memory/task-sync.js';
import {
    buildResearchAwarePromptPrefix,
    commitExecutionMemoryPromptCheckpoint,
    prepareResearchAwarePromptPrefix,
    readResearchLessons,
} from './execution-memory/lessons.js';
import { createAgentTurnLatencyTracker } from './utils/agentTurnLatency.js';
import { getConnectedClientUserId, groupOpenClientsByUserId } from './utils/projectRealtime.js';
import { broadcastTaskMasterProjectUpdate, broadcastTaskMasterTasksUpdate } from './utils/taskmaster-websocket.js';
import { resolveProjectChatAttachmentsDir, resolveUserAvatarsDir } from './utils/storagePaths.js';
import {
    WINDOWS_DRIVES_ROOT,
    getFilesystemBrowserDisplayPath,
    getFilesystemBrowserParentPath,
    getWindowsDriveSuggestions,
    isWindowsDriveListPath,
} from './utils/filesystemBrowser.js';
import { isInternalProjectPath, isProtectedProjectPath, normalizeProjectRelativePath } from '../shared/internalProjectFiles.js';
import { extractSessionModeFromMetadata } from './utils/sessionMode.js';
import {
    createAssistantReplyCollector,
    createBurstBuffer as createProjectMemoryBurstBuffer,
    prependProjectMemoryToPrompt,
} from './project-memory/automatic-project-memory.js';
import {
    buildUserMemoryContext,
    captureUserMemoryFacts,
    createUserMemoryBurstBuffer,
    prependUserMemoryToPrompt,
} from './user-memory/automatic-user-memory.js';
import {
    normalizeExtractionConfig,
    requestStructuredJson,
} from './utils/literature-concept-extractor.js';

const REMOVED_AGENT_PROVIDER_ERRORS = {
    claude: 'Claude has been removed from this deployment. Use Pi Agent.',
    codex: 'Codex has been removed from this deployment. Use Pi Agent.',
    local: 'Local GPU provider has been removed from this deployment.',
};

function sendRemovedAgentProviderError(writer, provider, sessionId = null) {
    const error = REMOVED_AGENT_PROVIDER_ERRORS[provider] || 'This provider has been removed from this deployment.';
    writer.send({
        type: 'localgpu-error',
        error,
        errorType: 'PROVIDER_REMOVED',
        isRetryable: false,
        sessionId,
    });
    writer.send({
        type: 'localgpu-complete',
        exitCode: 1,
        sessionId,
    });
}

// File system watchers for provider project/session folders
const PROVIDER_WATCH_PATHS = [];
const WATCHER_IGNORED_PATTERNS = [
    '**/node_modules/**',
    '**/.git/**',
    '**/dist/**',
    '**/build/**',
    '**/*.tmp',
    '**/*.swp',
    '**/.DS_Store'
];
const WATCHER_DEBOUNCE_MS = 1000;
let projectsWatchers = [];
let projectsWatcherDebounceTimer = null;
const connectedClients = new Set();
const enqueueAutomaticProjectMemoryTurn = createProjectMemoryBurstBuffer({
    onError: (error, projectPath) => {
        console.warn('[project-memory] Automatic capture failed:', {
            projectPath,
            error: error instanceof Error ? error.message : String(error),
        });
    },
});
const enqueueAutomaticUserMemoryTurn = createUserMemoryBurstBuffer({
    onError: (error, ownerId) => {
        console.warn('[user-memory] Automatic capture failed:', {
            ownerId,
            error: error instanceof Error ? error.message : String(error),
        });
    },
});
let isGetProjectsRunning = false; // Flag to prevent reentrant calls
let hasPendingProjectsUpdate = false;
let lastWatcherEvent = null;
const lastProjectsUpdateSignatures = new Map();

function terminateAllPtySessions() {
    for (const [sessionKey, session] of ptySessionsMap.entries()) {
        try {
            if (session?.timeoutId) {
                clearTimeout(session.timeoutId);
            }
            if (session?.pty?.kill) {
                session.pty.kill();
            }
        } catch (error) {
            console.error(`[WARN] Failed to terminate PTY session ${sessionKey}:`, error);
        }
    }

    ptySessionsMap.clear();
}

async function abortActiveInteractiveSessions() {
    try {
        await abortAllAgentRuntimeSessions();
    } catch (error) {
        console.error('[WARN] Failed to abort one or more registered agent runtimes during restart:', error);
    }

    try {
        getActiveLocalGPUSessions().forEach((sessionId) => abortLocalGPUSession(sessionId));
    } catch (error) {
        console.error('[WARN] Failed to abort one or more legacy local sessions during restart:', error);
    }
}

function hasActiveInteractiveSessions() {
    return hasActiveAgentRuntimeSessions()
        || getActiveLocalGPUSessions().length > 0
        || ptySessionsMap.size > 0;
}

async function closeAllWebSocketClients(code = 1012, reason = 'Server restarting') {
    const clients = Array.from(wss.clients || []);

    if (clients.length === 0) {
        connectedClients.clear();
        lastProjectsUpdateSignatures.clear();
        return;
    }

    await Promise.allSettled(
        clients.map((client) => new Promise((resolve) => {
            if (!client || client.readyState === WebSocket.CLOSED) {
                resolve();
                return;
            }

            let settled = false;
            const finish = () => {
                if (settled) {
                    return;
                }
                settled = true;
                resolve();
            };

            const forceTimer = setTimeout(() => {
                try {
                    client.terminate();
                } catch {
                    // Ignore termination failures during shutdown.
                }
                finish();
            }, 500);

            client.once('close', () => {
                clearTimeout(forceTimer);
                finish();
            });

            try {
                client.close(code, reason);
            } catch {
                clearTimeout(forceTimer);
                try {
                    client.terminate();
                } catch {
                    // Ignore termination failures during shutdown.
                }
                finish();
            }
        }))
    );

    connectedClients.clear();
    lastProjectsUpdateSignatures.clear();
}

function shouldProcessProjectsWatcherEvent(eventType, filePath, provider) {
    if (eventType === 'addDir' || eventType === 'unlinkDir') {
        return true;
    }

    const normalized = String(filePath || '').toLowerCase();
    if (provider === 'claude' || provider === 'codex') {
        return normalized.endsWith('.jsonl');
    }

    return true;
}

// Broadcast project-loading progress only to the active user's sockets.
function broadcastProgress(progress, userId = null) {
    const message = JSON.stringify({
        type: 'loading_progress',
        ...progress
    });
    connectedClients.forEach(client => {
        if (
            client.readyState === WebSocket.OPEN
            && (userId == null || getConnectedClientUserId(client) === userId)
        ) {
            client.send(message);
        }
    });
}

function broadcastProjectMemoryUpdated(userId, payload) {
    const message = JSON.stringify({
        type: 'project-memory-updated',
        ...payload,
        updatedAt: new Date().toISOString(),
    });
    connectedClients.forEach((client) => {
        if (
            client.readyState === WebSocket.OPEN
            && (userId == null || getConnectedClientUserId(client) === userId)
        ) {
            client.send(message);
        }
    });
}

function broadcastMeetingReminder(userId, reminder) {
    const message = JSON.stringify({
        type: 'meeting-reminder',
        reminder,
        timestamp: new Date().toISOString(),
    });
    let deliveredClients = 0;
    connectedClients.forEach((client) => {
        if (
            client.readyState === WebSocket.OPEN
            && getConnectedClientUserId(client) === userId
        ) {
            client.send(message);
            deliveredClients += 1;
        }
    });
    if (deliveredClients === 0) {
        throw new Error('No connected client for reminder delivery');
    }
}

let meetingReminderService = null;

function createProjectMemoryOneShot({ provider, model, userId }) {
    // The shared structured one-shot utility currently supports Claude, Codex,
    // and local models.
    const extractionProvider = provider === 'codex' ? 'codex' : 'claude';
    const extractionConfig = normalizeExtractionConfig({ provider: extractionProvider, model });
    return (system, user) => requestStructuredJson({
        userId,
        reference: null,
        sourceKey: 'automatic_project_memory',
        extractionConfig,
        overrideMessages: { system, user },
    });
}

function createUserMemoryOneShot({ provider, model, userId }) {
    const extractionProvider = provider === 'codex' ? 'codex' : 'claude';
    const extractionConfig = normalizeExtractionConfig({ provider: extractionProvider, model });
    return (system, user) => requestStructuredJson({
        userId,
        reference: null,
        sourceKey: 'automatic_user_memory',
        extractionConfig,
        overrideMessages: { system, user },
    });
}

async function broadcastProjectsUpdatedForUser(userId = null, metadata = {}) {
    const parsedUserId = Number.parseInt(userId, 10);
    const normalizedUserId = Number.isInteger(parsedUserId) && parsedUserId > 0 ? parsedUserId : null;
    const updatedProjects = await getProjects(
        isLocalKernelMode() ? null : normalizedUserId,
        (progress) => broadcastProgress(progress, normalizedUserId),
        { sessionOwnerKey: normalizedUserId },
    );
    const updateSignature = JSON.stringify(updatedProjects);
    const signatureKey = normalizedUserId == null ? '__anonymous__' : String(normalizedUserId);
    lastProjectsUpdateSignatures.set(signatureKey, updateSignature);

    const updateMessage = JSON.stringify({
        type: 'projects_updated',
        projects: updatedProjects,
        timestamp: new Date().toISOString(),
        changeType: metadata.changeType || 'manual',
        changedFile: metadata.projectPath || metadata.projectName || '',
        watchProvider: metadata.watchProvider || 'im',
    });

    connectedClients.forEach((client) => {
        if (
            client.readyState === WebSocket.OPEN
            && (normalizedUserId == null || getConnectedClientUserId(client) === normalizedUserId)
        ) {
            client.send(updateMessage);
        }
    });
}

configureImChannelRuntime({
    broadcastProjectsUpdated: broadcastProjectsUpdatedForUser,
});

// Setup file system watchers for provider project/session folders
async function setupProjectsWatcher() {
    const chokidar = (await import('chokidar')).default;

    if (projectsWatcherDebounceTimer) {
        clearTimeout(projectsWatcherDebounceTimer);
        projectsWatcherDebounceTimer = null;
    }

    await Promise.all(
        projectsWatchers.map(async (watcher) => {
            try {
                await watcher.close();
            } catch (error) {
                console.error('[WARN] Failed to close watcher:', error);
            }
        })
    );
    projectsWatchers = [];

    const debouncedUpdate = (eventType, filePath, provider, rootPath) => {
        if (!shouldProcessProjectsWatcherEvent(eventType, filePath, provider)) {
            return;
        }

        lastWatcherEvent = { eventType, filePath, provider, rootPath };

        if (projectsWatcherDebounceTimer) {
            clearTimeout(projectsWatcherDebounceTimer);
        }

        projectsWatcherDebounceTimer = setTimeout(async () => {
            // Prevent reentrant calls
            if (isGetProjectsRunning) {
                hasPendingProjectsUpdate = true;
                return;
            }

            try {
                isGetProjectsRunning = true;
                hasPendingProjectsUpdate = false;

                // Clear project directory cache when files change
                clearProjectDirectoryCache();

                const clientsByUserId = groupOpenClientsByUserId(connectedClients);
                const activeSignatureKeys = new Set();

                for (const [userId, userClients] of clientsByUserId.entries()) {
                    const signatureKey = userId == null ? '__anonymous__' : String(userId);
                    activeSignatureKeys.add(signatureKey);

                    const updatedProjects = await getProjects(isLocalKernelMode() ? null : userId, null, { sessionOwnerKey: userId });
                    const updateSignature = JSON.stringify(updatedProjects);

                    // Skip broadcasting identical snapshots for the same authenticated user.
                    if (updateSignature === lastProjectsUpdateSignatures.get(signatureKey)) {
                        continue;
                    }
                    lastProjectsUpdateSignatures.set(signatureKey, updateSignature);

                    const updateMessage = JSON.stringify({
                        type: 'projects_updated',
                        projects: updatedProjects,
                        timestamp: new Date().toISOString(),
                        changeType: eventType,
                        changedFile: path.relative(rootPath, filePath),
                        watchProvider: provider
                    });

                    userClients.forEach((client) => {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(updateMessage);
                        }
                    });
                }

                for (const signatureKey of Array.from(lastProjectsUpdateSignatures.keys())) {
                    if (!activeSignatureKeys.has(signatureKey)) {
                        lastProjectsUpdateSignatures.delete(signatureKey);
                    }
                }

            } catch (error) {
                console.error('[ERROR] Error handling project changes:', error);
            } finally {
                isGetProjectsRunning = false;
                if (hasPendingProjectsUpdate && lastWatcherEvent) {
                    hasPendingProjectsUpdate = false;
                    const { eventType, filePath, provider, rootPath } = lastWatcherEvent;
                    debouncedUpdate(eventType, filePath, provider, rootPath);
                }
            }
        }, WATCHER_DEBOUNCE_MS);
    };

    for (const { provider, rootPath } of PROVIDER_WATCH_PATHS) {
        try {
            // chokidar v4 emits ENOENT via the "error" event for missing roots and will not auto-recover.
            // Ensure provider folders exist before creating the watcher so watching stays active.
            await fsPromises.mkdir(rootPath, { recursive: true });

            // Initialize chokidar watcher with optimized settings
            const watcher = chokidar.watch(rootPath, {
                ignored: WATCHER_IGNORED_PATTERNS,
                persistent: true,
                ignoreInitial: true, // Don't fire events for existing files on startup
                followSymlinks: false,
                depth: 10, // Reasonable depth limit
                awaitWriteFinish: {
                    stabilityThreshold: 100, // Wait 100ms for file to stabilize
                    pollInterval: 50
                }
            });

            // Set up event listeners
            watcher
                .on('add', (filePath) => debouncedUpdate('add', filePath, provider, rootPath))
                .on('change', (filePath) => debouncedUpdate('change', filePath, provider, rootPath))
                .on('unlink', (filePath) => debouncedUpdate('unlink', filePath, provider, rootPath))
                .on('addDir', (dirPath) => debouncedUpdate('addDir', dirPath, provider, rootPath))
                .on('unlinkDir', (dirPath) => debouncedUpdate('unlinkDir', dirPath, provider, rootPath))
                .on('error', (error) => {
                    console.error(`[ERROR] ${provider} watcher error:`, error);
                })
                .on('ready', () => {
                });

            projectsWatchers.push(watcher);
        } catch (error) {
            console.error(`[ERROR] Failed to setup ${provider} watcher for ${rootPath}:`, error);
        }
    }

    if (projectsWatchers.length === 0) {
        console.error('[ERROR] Failed to setup any provider watchers');
    }
}


const app = express();
configureTrustedProxy(app);
const server = http.createServer(app);

const PTY_SESSION_TIMEOUT = 30 * 60 * 1000;
const SHELL_URL_PARSE_BUFFER_LIMIT = 32768;
const PTY_REPLAY_BUFFER_MAX_CHUNKS = 2000;
const PTY_REPLAY_BUFFER_MAX_BYTES = 1.5 * 1024 * 1024;
const ANSI_ESCAPE_SEQUENCE_REGEX = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g;
const TRAILING_URL_PUNCTUATION_REGEX = /[)\]}>.,;:!?]+$/;
const REPLAY_TERMINAL_QUERY_REGEXES = [
    /\x1B\[[>?0-9;]*c/g,
    /\x1B\[[0-9;?]*n/g,
    /\x1B\[\?[0-9;]*\$p/g,
];
const SHELL_EMBEDDED_ENV_KEYS_TO_REMOVE = [
    'TERM_PROGRAM',
    'TERM_PROGRAM_VERSION',
    'ITERM_SESSION_ID',
    'LC_TERMINAL',
    'LC_TERMINAL_VERSION',
    'WT_SESSION',
];

function stripAnsiSequences(value = '') {
    return value.replace(ANSI_ESCAPE_SEQUENCE_REGEX, '');
}

function stripReplayTerminalQueries(value = '') {
    return REPLAY_TERMINAL_QUERY_REGEXES.reduce(
        (currentValue, regex) => currentValue.replace(regex, ''),
        value,
    );
}

function getTerminalChunkByteLength(value = '') {
    return Buffer.byteLength(String(value || ''), 'utf8');
}

function ensurePtyReplayBuffer(session) {
    if (!session) return;

    if (!Array.isArray(session.buffer)) {
        session.buffer = [];
    }

    if (!Number.isFinite(session.bufferBytes)) {
        session.bufferBytes = session.buffer.reduce(
            (total, chunk) => total + getTerminalChunkByteLength(chunk),
            0,
        );
    }
}

function appendPtyReplayBuffer(session, chunk) {
    if (!session || typeof chunk !== 'string') return;

    ensurePtyReplayBuffer(session);
    session.buffer.push(chunk);
    session.bufferBytes += getTerminalChunkByteLength(chunk);

    while (
        session.buffer.length > PTY_REPLAY_BUFFER_MAX_CHUNKS ||
        session.bufferBytes > PTY_REPLAY_BUFFER_MAX_BYTES
    ) {
        const removed = session.buffer.shift();
        session.bufferBytes -= getTerminalChunkByteLength(removed);
    }

    if (session.bufferBytes < 0) {
        session.bufferBytes = 0;
    }
}

function clearPtyReplayBuffer(session) {
    if (!session) return;
    session.buffer = [];
    session.bufferBytes = 0;
}

function disposePtySession(sessionKey) {
    if (!sessionKey) return false;

    const session = ptySessionsMap.get(sessionKey);
    if (!session) return false;

    if (session.timeoutId) {
        clearTimeout(session.timeoutId);
        session.timeoutId = null;
    }

    try {
        if (session.pty && session.pty.kill) {
            session.pty.kill();
        }
    } catch (error) {
        console.error(`[WARN] Failed to kill PTY session ${sessionKey}:`, error);
    }

    ptySessionsMap.delete(sessionKey);
    return true;
}

function buildEmbeddedShellEnv(baseEnv = process.env) {
    const env = {
        ...baseEnv,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        FORCE_COLOR: '3'
    };

    SHELL_EMBEDDED_ENV_KEYS_TO_REMOVE.forEach((key) => {
        delete env[key];
    });

    Object.keys(env).forEach((key) => {
        if (
            key.startsWith('VSCODE_') ||
            key.startsWith('FIG_') ||
            key.startsWith('QTERM_')
        ) {
            delete env[key];
        }
    });

    return env;
}

function buildCommandModeShellLaunch(shellCommand) {
    if (os.platform() === 'win32') {
        return {
            shell: 'powershell.exe',
            args: ['-Command', shellCommand],
        };
    }

    const loginShell = process.env.SHELL || '/bin/bash';
    const shellName = path.basename(loginShell).toLowerCase();

    if (shellName.includes('zsh') || shellName.includes('bash')) {
        return {
            shell: loginShell,
            args: ['-lc', shellCommand],
        };
    }

    if (shellName.includes('fish')) {
        return {
            shell: loginShell,
            args: ['-lic', shellCommand],
        };
    }

    return {
        shell: loginShell,
        args: ['-c', shellCommand],
    };
}

function normalizeDetectedUrl(url) {
    if (!url || typeof url !== 'string') return null;

    const cleaned = url.trim().replace(TRAILING_URL_PUNCTUATION_REGEX, '');
    if (!cleaned) return null;

    try {
        const parsed = new URL(cleaned);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return null;
        }
        return parsed.toString();
    } catch {
        return null;
    }
}

function extractUrlsFromText(value = '') {
    const directMatches = value.match(/https?:\/\/[^\s<>"'`\\\x1b\x07]+/gi) || [];

    // Handle wrapped terminal URLs split across lines by terminal width.
    const wrappedMatches = [];
    const continuationRegex = /^[A-Za-z0-9\-._~:/?#\[\]@!$&'()*+,;=%]+$/;
    const lines = value.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        const startMatch = line.match(/https?:\/\/[^\s<>"'`\\\x1b\x07]+/i);
        if (!startMatch) continue;

        let combined = startMatch[0];
        let j = i + 1;
        while (j < lines.length) {
            const continuation = lines[j].trim();
            if (!continuation) break;
            if (!continuationRegex.test(continuation)) break;
            combined += continuation;
            j++;
        }

        wrappedMatches.push(combined.replace(/\r?\n\s*/g, ''));
    }

    return Array.from(new Set([...directMatches, ...wrappedMatches]));
}

function shouldAutoOpenUrlFromOutput(value = '') {
    const normalized = value.toLowerCase();
    return (
        normalized.includes('browser didn\'t open') ||
        normalized.includes('open this url') ||
        normalized.includes('continue in your browser') ||
        normalized.includes('press enter to open') ||
        normalized.includes('open_url:') ||
        normalized.includes('paste code here')
    );
}

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildContentSecurityPolicy() {
    const isProduction = process.env.NODE_ENV === 'production' || process.env.MEDHELP_ENV === 'production';
    const connectSrc = ["'self'", 'ws:', 'wss:'];
    const scriptSrc = ["'self'"];
    const allowLocalKernelConnect = isWebShellOnlyMode()
        || isLocalKernelMode()
        || process.env.MEDHELP_ALLOW_LOCAL_KERNEL_CONNECT === '1';

    if (!isProduction || allowLocalKernelConnect) {
        connectSrc.push('http://localhost:*', 'http://127.0.0.1:*', 'ws://localhost:*', 'ws://127.0.0.1:*');
    }

    if (!isProduction) {
        scriptSrc.push("'unsafe-eval'");
    }

    return [
        "default-src 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        "frame-ancestors 'none'",
        `script-src ${scriptSrc.join(' ')}`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https://api.qrserver.com",
        "font-src 'self' data:",
        "media-src 'self' data: blob:",
        "frame-src 'self' blob: data: http: https:",
        "worker-src 'self' blob:",
        `connect-src ${connectSrc.join(' ')}`,
        "form-action 'self'",
    ].join('; ');
}

function contentSecurityPolicyMiddleware(req, res, next) {
    res.setHeader('Content-Security-Policy', buildContentSecurityPolicy());
    next();
}

function quoteForPosixShell(value) {
    return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function quoteForPowerShell(value) {
    return `'${String(value).replace(/'/g, "''")}'`;
}

function quoteForShell(value) {
    return os.platform() === 'win32'
        ? quoteForPowerShell(value)
        : quoteForPosixShell(value);
}

async function resolveShellProjectPath(requestedPath, userId) {
    if (!requestedPath || typeof requestedPath !== 'string' || !requestedPath.trim()) {
        throw new Error('Shell project path is required');
    }

    const validation = await validateUserWorkspacePath(requestedPath.trim(), userId);
    if (!validation.valid) {
        throw new Error(validation.error || 'Shell project path must stay inside your workspace');
    }

    const resolvedPath = validation.resolvedPath || path.resolve(requestedPath.trim());
    const stats = await fsPromises.stat(resolvedPath);
    if (!stats.isDirectory()) {
        throw new Error('Shell project path must be an existing directory');
    }

    return resolvedPath;
}

const configuredAllowedOrigins = sanitizeAllowedOrigins(
    [
        process.env.CORS_ALLOWED_ORIGINS,
        process.env.ALLOWED_ORIGINS,
        process.env.PUBLIC_APP_URL,
        process.env.APP_URL,
        process.env.MEDHELP_ALLOWED_WEB_ORIGINS,
        ...(isLocalKernelMode() ? getLocalKernelAllowedOrigins() : []),
    ]
        .filter(Boolean)
        .flatMap((value) => String(value).split(','))
        .map((value) => value.trim())
        .filter(Boolean),
    { allowWildcard: process.env.NODE_ENV !== 'production' },
);

function normalizeOrigin(origin) {
    if (!origin || origin === 'null') {
        return null;
    }
    try {
        return new URL(origin).origin;
    } catch (_) {
        return null;
    }
}

function getRequestHosts(req) {
    return [
        req?.headers?.host,
        req?.headers?.['x-forwarded-host'],
    ]
        .filter(Boolean)
        .flatMap((value) => String(value).split(','))
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean);
}

function isLocalDevelopmentOrigin(origin) {
    const normalized = normalizeOrigin(origin);
    if (!normalized) {
        return false;
    }
    try {
        const { hostname } = new URL(normalized);
        return ['localhost', '127.0.0.1', '::1'].includes(hostname);
    } catch (_) {
        return false;
    }
}

function isAllowedRequestOrigin(origin, req = null) {
    if (!origin) {
        return true;
    }

    const normalized = normalizeOrigin(origin);
    if (!normalized) {
        return false;
    }

    if (configuredAllowedOrigins.includes('*')) {
        return true;
    }

    const allowedOrigins = configuredAllowedOrigins
        .map(normalizeOrigin)
        .filter(Boolean);
    if (allowedOrigins.includes(normalized)) {
        return true;
    }

    const requestHosts = getRequestHosts(req);
    try {
        const originHost = new URL(normalized).host.toLowerCase();
        if (requestHosts.includes(originHost)) {
            return true;
        }
    } catch (_) {
        return false;
    }

    return isLocalDevelopmentOrigin(normalized);
}

function enforceAllowedOrigin(req, res, next) {
    const origin = req.headers.origin;
    if (!isAllowedRequestOrigin(origin, req)) {
        return res.status(403).json({ error: 'Origin not allowed' });
    }
    return next();
}

function privateNetworkAccessMiddleware(req, res, next) {
    const origin = req.headers.origin;
    if (
        isLocalKernelMode()
        && origin
        && isAllowedRequestOrigin(origin, req)
    ) {
        const kernelId = getLocalKernelHealthPayload().kernelId || '000000000000';
        const pnaId = String(kernelId)
            .replace(/[^a-f0-9]/gi, '')
            .padEnd(12, '0')
            .slice(0, 12)
            .match(/.{1,2}/g)
            .join(':');
        res.setHeader('Access-Control-Allow-Private-Network', 'true');
        res.setHeader('Private-Network-Access-ID', pnaId);
        res.setHeader('Private-Network-Access-Name', 'medhelp-kernel');
        res.vary('Origin');
        res.vary('Access-Control-Request-Private-Network');
    }
    return next();
}

const corsOptionsDelegate = (req, callback) => {
    const origin = req.headers.origin;
    callback(null, {
        origin: isAllowedRequestOrigin(origin, req),
        credentials: true,
    });
};

// Single WebSocket server that handles both paths
const wss = new WebSocketServer({
    server,
    verifyClient: (info) => {
        const origin = info.origin || info.req.headers.origin;
        const requestUrl = new URL(info.req.url || '/', 'http://localhost');
        const pathname = requestUrl.pathname;
        if (!isAllowedRequestOrigin(origin, info.req)) {
            console.log('[WARN] WebSocket origin rejected:', origin || '(none)');
            return false;
        }

        const authHeader = info.req.headers.authorization || '';
        const tokenFromHeader = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
        const token = tokenFromHeader || requestUrl.searchParams.get('token');

        if (isLocalKernelMode() && ['/ws/local', '/ws', '/shell', '/compute-shell'].includes(pathname)) {
            const session = verifyLocalSessionToken(token, origin || null);
            if (!session) {
                console.log('[WARN] Local Kernel WebSocket authentication failed');
                return false;
            }
            info.req.localKernelSession = session;
            info.req.user = {
                id: null,
                userId: null,
                cloudUserId: session.userId || null,
                username: 'local-kernel-user',
            };
            return true;
        }

        if (isLocalKernelMode()) {
            console.log('[WARN] Local Kernel rejected legacy WebSocket path:', pathname);
            return false;
        }

        if (isWebShellOnlyMode() && ['/ws', '/shell', '/compute-shell'].includes(pathname)) {
            console.log('[WARN] Web shell mode rejected legacy WebSocket path:', pathname);
            return false;
        }

        const user = authenticateWebSocket(token, wss);
        if (!user) {
            console.log('[WARN] WebSocket authentication failed');
            return false;
        }
        info.req.user = user;
        return true;
    }
});

// Make WebSocket server available to routes
app.locals.wss = wss;

app.use(enforceAllowedOrigin);
app.use(privateNetworkAccessMiddleware);
app.use(cors(corsOptionsDelegate));
app.use(contentSecurityPolicyMiddleware);
app.use(express.json({
  limit: '50mb',
  type: (req) => {
    // Skip multipart/form-data requests (for file uploads like images)
    const contentType = req.headers['content-type'] || '';
    if (contentType.includes('multipart/form-data')) {
      return false;
    }
    return contentType.includes('json');
  }
}));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Public health check endpoint (no authentication required)
app.get('/health', (req, res) => {
  const agentRuns = getAgentRunEngineStatus();
  if (isLocalKernelMode()) {
    return res.json({
      ...getLocalKernelHealthPayload(),
      agentBusy: hasActiveInteractiveSessions(),
      agentRuns,
      database: getDatabaseLifecycleStatus(),
    });
  }
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    installMode,
    agentBusy: hasActiveInteractiveSessions(),
    agentRuns,
    database: getDatabaseLifecycleStatus(),
  });
});

// Local Kernel loopback API. This is mounted before API key validation because
// the browser-to-local session uses its own short-lived local token.
app.use('/api/local', localKernelRoutes);

// Public desktop release manifest. The desktop Kernel checks this before the
// user has a cloud session, so it must stay outside authenticateToken.
app.use('/api/local-kernel', localKernelPublicRouter);

// Public installer downloads are restricted to files in the fixed release
// catalog. Private COS URLs are signed only after an allowlist match.
app.get('/api/public-downloads/object/*', async (req, res) => {
  const downloadCatalogRoot = process.env.MEDHELP_DOWNLOAD_CATALOG_DIR
    || path.join(__dirname, '../public');
  const artifact = resolvePublicDownloadObject(
    downloadCatalogRoot,
    String(req.params[0] || ''),
  );
  if (!artifact) {
    return res.status(404).send('Download not found');
  }

  res.setHeader('Cache-Control', 'no-store');
  if (!isCosPublicDownloadConfigured()) {
    return res.status(503).send('Download is temporarily unavailable');
  }

  try {
    const signedUrl = await createCosPublicDownloadUrl(artifact.objectKey);
    return res.redirect(302, signedUrl);
  } catch (error) {
    console.error('[WARN] Failed to sign COS download URL:', error?.message || error);
    return res.status(503).send('Download is temporarily unavailable');
  }
});

// Public installer catalog. It exposes metadata for a fixed release directory
// only and points downloads at the allowlisted COS signing route above.
app.get('/api/public-downloads', (_req, res) => {
  try {
    const downloadCatalogRoot = process.env.MEDHELP_DOWNLOAD_CATALOG_DIR
      || path.join(__dirname, '../public');
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.json(buildPublicDownloadCatalog(downloadCatalogRoot));
  } catch (error) {
    console.error('[WARN] Failed to build public download catalog:', error);
    res.status(500).json({ error: 'Failed to load downloads' });
  }
});

if (isLocalKernelMode()) {
  app.use(createLocalApiGate());
}

// Optional API key validation (if configured)
app.use('/api', validateApiKey);

// Authentication routes (public)
app.use('/api/auth', authRoutes);

// Remote extraction and provider gateway skeleton (protected)
app.use('/api/gateway', authenticateToken, gatewayRoutes);

// Cloud-side Local Kernel launch/device/audit skeleton (protected)
app.use('/api/local-kernel', authenticateAccountToken, localKernelCloudRouter);

// Conversation share routes. GET /api/shares/:token is public; write routes
// perform their own auth checks inside the router.
app.use('/api/shares', sharesRoutes);

// Privacy-filtered account conversation archive (cloud-owned, authenticated).
app.use('/api/conversations', authenticateToken, requireCapability('conversations.archive'), conversationsRoutes);

// User feedback API Routes (protected)
app.use('/api/feedback', authenticateToken, feedbackRoutes);

// Research Secretary meeting-loop API (protected)
app.use('/api/research', authenticateToken, meetingsRoutes);
app.use('/api/research', authenticateToken, researchTrackingRoutes);

// Desktop companions and single-file mini apps (protected, account-scoped).
app.use('/api/companions', authenticateToken, companionsRoutes);
app.use('/api/mini-apps', authenticateToken, miniAppsRoutes);

// Projects API Routes (protected)
app.use('/api/projects', authenticateToken, projectsRoutes);

// Git API Routes (protected)
app.use('/api/git', authenticateToken, gitRoutes);

// MCP API Routes (protected)
// TaskMaster API Routes (protected)
app.use('/api/taskmaster', authenticateToken, requireCapability('research.tasks'), taskmasterRoutes);

// MCP utilities
app.use('/api/mcp-utils', authenticateToken, mcpUtilsRoutes);

// Commands API Routes (protected)
app.use('/api/commands', authenticateToken, commandsRoutes);

// Settings API Routes (protected)
app.use('/api/settings', authenticateToken, settingsRoutes);

// CLI Authentication API Routes (protected)
app.use('/api/cli', authenticateToken, cliAuthRoutes);

// User API Routes (protected)
app.use('/api/user', authenticateAccountToken, userRoutes);

// Device-local first-run environment configuration (CC Switch, runtimes, and paths).
app.use('/api/environment-setup', authenticateToken, environmentSetupRoutes);

// Codex API Routes (protected)
app.use('/api/pi', authenticateToken, piModelsRoutes);
app.use('/api/pi', authenticateToken, createPiSessionsRouter({
    resolveProject: createPiSessionProjectResolver({
      getProject: async (projectName) => {
        const { projectDb } = await import('./database/db.js');
        return projectDb.getProjectById(projectName);
      },
      resolveDirectory: extractProjectDirectory,
      validatePath: validateUserWorkspacePath,
    }),
}));
// Skills API Routes (protected)
app.use('/api/skills', authenticateToken, skillsRoutes);

// Telemetry API Routes (protected)
app.use('/api/telemetry', authenticateToken, telemetryRoutes);

// Compute API Routes (protected)
app.use('/api/compute', authenticateToken, requireCapability('compute.resources'), computeRoutes);

// News API Routes (protected)
app.use('/api/news', authenticateToken, requireCapability('literature.monitor'), newsRoutes);

// PubMed variable discovery API Routes (protected)
app.use('/api/pubmed-discovery', authenticateToken, requireCapability('variables.discovery'), pubmedDiscoveryRoutes);

// Auto Research API Routes (protected)
app.use('/api/auto-research', authenticateToken, requireCapability('research.pipeline'), autoResearchRoutes);

// References (literature library) API Routes (protected)
app.use('/api/references', authenticateToken, referencesRoutes);

// Medical library overview API Routes (protected)
app.use('/api/med-library', authenticateToken, medLibraryRoutes);

// Structured concepts API Routes (protected)
app.use('/api/concepts', authenticateToken, requireCapability('variables.catalog'), conceptsRoutes);

// Monitor candidates and review API Routes (protected)
app.use('/api/monitor', authenticateToken, requireCapability('variables.discovery'), monitorRoutes);

const expandWorkspacePath = async (inputPath) => {
    if (!inputPath) return inputPath;
    if (inputPath === '~') {
        return os.homedir();
    }
    if (inputPath.startsWith('~/') || inputPath.startsWith('~\\')) {
        return path.join(os.homedir(), inputPath.slice(2));
    }
    return inputPath;
};

// Browse filesystem endpoint for project suggestions - uses existing getFileTree
app.get('/api/browse-filesystem', authenticateToken, async (req, res) => {
    try {
        const { path: dirPath, showHidden: showHiddenQuery, purpose } = req.query;
        const showHidden = showHiddenQuery === 'true';
        const isDataFolderBrowse = purpose === 'dataFolder';
        const isLocalFolderBrowse = purpose === 'connectFolder' && !IS_PLATFORM;
        const isUnrestrictedBrowse = isDataFolderBrowse || isLocalFolderBrowse;

        console.log('[API] Browse filesystem request for path:', dirPath, 'showHidden:', showHidden);
        if (isWindowsDriveListPath(dirPath)) {
            const suggestions = await getWindowsDriveSuggestions();
            return res.json({
                path: WINDOWS_DRIVES_ROOT,
                displayPath: getFilesystemBrowserDisplayPath(WINDOWS_DRIVES_ROOT),
                parentPath: null,
                isVirtualRoot: true,
                drivesRootPath: WINDOWS_DRIVES_ROOT,
                suggestions,
            });
        }

        const userRoot = await getUserWorkspacesRoot(req.user?.id);
        // Default to the current user's project root.
        let targetPath = dirPath ? await expandWorkspacePath(dirPath) : userRoot;

        // Resolve and normalize the path
        targetPath = path.resolve(targetPath);

        // Security check - ensure path is valid
        const isFilesystemRootBrowse = isUnrestrictedBrowse
            && process.platform !== 'win32'
            && targetPath === path.parse(targetPath).root;
        let resolvedPath = targetPath;
        if (!isFilesystemRootBrowse) {
            const validation = await validateUserWorkspacePath(targetPath, req.user?.id, {
                allowUserHome: true,
                allowWindowsDrives: true,
                allowDriveRoot: true,
                allowConfiguredDataFolders: true,
                allowAnySafePath: isUnrestrictedBrowse,
            });
            if (!validation.valid) {
                return res.status(403).json({ error: validation.error });
            }
            resolvedPath = validation.resolvedPath || targetPath;
        }

        // Security check - ensure path is accessible
        try {
            await fs.promises.access(resolvedPath);
            const stats = await fs.promises.stat(resolvedPath);

            if (!stats.isDirectory()) {
                return res.status(400).json({ error: 'Path is not a directory' });
            }
        } catch (err) {
            return res.status(404).json({ error: 'Directory not accessible' });
        }

        // Use existing getFileTree function with shallow depth (only direct children)
        // For browsing, we use a more permissive version that doesn't skip node_modules etc.
        const fileTree = await getFileTree(resolvedPath, 1, 0, showHidden, true); // maxDepth=1, showHidden, isBrowsing=true

        // Filter only directories and format for suggestions
        const directories = fileTree
            .filter(item => item.type === 'directory')
            .map(item => ({
                path: item.path,
                displayPath: getWorkspaceDisplayPath(item.path),
                name: item.name,
                type: 'directory'
            }))
            .sort((a, b) => {
                const aHidden = a.name.startsWith('.');
                const bHidden = b.name.startsWith('.');
                if (aHidden && !bHidden) return 1;
                if (!aHidden && bHidden) return -1;
                return a.name.localeCompare(b.name);
            });

        // Add common directories if browsing home directory
        const suggestions = [];
        let resolvedHomeDir = userRoot;
        try {
            resolvedHomeDir = await fs.promises.realpath(userRoot);
        } catch (error) {
            // Use user root as-is if realpath fails
        }

        if (resolvedPath === resolvedHomeDir) {
            suggestions.push(...directories);
        } else {
            suggestions.push(...directories);
        }

        res.json({
            path: resolvedPath,
            displayPath: getWorkspaceDisplayPath(resolvedPath),
            parentPath: getFilesystemBrowserParentPath(resolvedPath, { boundaryPath: isUnrestrictedBrowse ? null : userRoot }),
            drivesRootPath: process.platform === 'win32' ? WINDOWS_DRIVES_ROOT : null,
            suggestions: suggestions
        });

    } catch (error) {
        console.error('Error browsing filesystem:', error);
        res.status(500).json({ error: 'Failed to browse filesystem' });
    }
});

app.post('/api/create-folder', authenticateToken, async (req, res) => {
    try {
        const { path: folderPath } = req.body;
        const isDataFolderBrowse = req.query.purpose === 'dataFolder';
        const isLocalFolderBrowse = req.query.purpose === 'connectFolder' && !IS_PLATFORM;
        if (!folderPath) {
            return res.status(400).json({ error: 'Path is required' });
        }
        const expandedPath = await expandWorkspacePath(folderPath);
        const resolvedInput = path.resolve(expandedPath);
        const validation = await validateUserWorkspacePath(resolvedInput, req.user?.id, {
            allowConfiguredDataFolders: true,
            allowAnySafePath: isDataFolderBrowse || isLocalFolderBrowse,
        });
        if (!validation.valid) {
            return res.status(403).json({ error: validation.error });
        }
        const targetPath = validation.resolvedPath || resolvedInput;
        const parentDir = path.dirname(targetPath);
        try {
            await fs.promises.access(parentDir);
        } catch (err) {
            return res.status(404).json({ error: 'Parent directory does not exist' });
        }
        try {
            await fs.promises.access(targetPath);
            return res.status(409).json({ error: 'Folder already exists' });
        } catch (err) {
            // Folder doesn't exist, which is what we want
        }
        try {
            await fs.promises.mkdir(targetPath, { recursive: false });
            res.json({ success: true, path: targetPath });
        } catch (mkdirError) {
            if (mkdirError.code === 'EEXIST') {
                return res.status(409).json({ error: 'Folder already exists' });
            }
            throw mkdirError;
        }
    } catch (error) {
        console.error('Error creating folder:', error);
        res.status(500).json({ error: 'Failed to create folder' });
    }
});

function setServiceWorkerHeaders(res) {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Service-Worker-Allowed', '/');
}

// Serve public files (like api-docs.html)
app.use('/user-avatars', express.static(resolveUserAvatarsDir(), {
  maxAge: '30d',
  immutable: true
}));

if (shouldServeAppStaticFiles()) {
  app.get('/i', (_req, res) => {
    res.redirect(302, '/download');
  });

  app.use(express.static(path.join(__dirname, '../public'), {
    setHeaders: (res, filePath) => {
      if (path.basename(filePath) === 'sw.js') {
        setServiceWorkerHeaders(res);
      }
    }
  }));

  // Static files served after API routes
  // Add cache control: HTML files should not be cached, but assets can be cached
  app.use(express.static(path.join(__dirname, '../dist'), {
    setHeaders: (res, filePath) => {
      if (path.basename(filePath) === 'sw.js') {
        // The service worker controls app-shell caching, so the script itself must
        // be revalidated on every load to let stale-cache fixes reach browsers.
        setServiceWorkerHeaders(res);
      } else if (filePath.endsWith('.html')) {
        // Prevent HTML caching to avoid service worker issues after builds
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      } else if (filePath.match(/\.(js|css|woff2?|ttf|eot|svg|png|jpg|jpeg|gif|ico)$/)) {
        // Cache static assets for 1 year (they have hashed names)
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    }
  }));
}

// API Routes (protected)
// /api/config endpoint removed - no longer needed
// Frontend now uses window.location for WebSocket URLs

// System update endpoint
app.post('/api/system/update', authenticateToken, async (req, res) => {
    try {
        // Get the project root directory (parent of server directory)
        const projectRoot = path.join(__dirname, '..');

        console.log('Starting system update from directory:', projectRoot);

        // Run the update command based on installation mode
        const updateCommand = installMode === 'git'
            ? 'git checkout main && git pull && npm install'
            : `npm install -g ${npmPackageName}@latest`;

        const child = spawn('sh', ['-c', updateCommand], {
            cwd: installMode === 'git' ? projectRoot : os.homedir(),
            env: process.env
        });

        let output = '';
        let errorOutput = '';

        child.stdout.on('data', (data) => {
            const text = data.toString();
            output += text;
            console.log('Update output:', text);
        });

        child.stderr.on('data', (data) => {
            const text = data.toString();
            errorOutput += text;
            console.error('Update error:', text);
        });

        child.on('close', (code) => {
            if (code === 0) {
                res.json({
                    success: true,
                    output: output || 'Update completed successfully',
                    message: 'Update completed. Please restart the server to apply changes.'
                });
            } else {
                res.status(500).json({
                    success: false,
                    error: 'Update command failed',
                    output: output,
                    errorOutput: errorOutput
                });
            }
        });

        child.on('error', (error) => {
            console.error('Update process error:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        });

    } catch (error) {
        console.error('System update error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.post('/api/system/restart', authenticateToken, async (req, res) => {
    if (serverRestartPromise) {
        return res.status(202).json({
            success: true,
            restarting: true,
            alreadyRestarting: true,
        });
    }

    res.status(202).json({
        success: true,
        restarting: true,
    });

    setTimeout(() => {
        restartServer().catch((error) => {
            console.error('[ERROR] Failed to restart backend:', error);
        });
    }, 150);
});

app.get('/api/projects', authenticateToken, async (req, res) => {
    try {
        const userId = req.user?.id;
        const projects = await getProjects(userId, (progress) => broadcastProgress(progress, userId), {
            sessionOwnerKey: resolveRequestUserId(req),
        });
        res.json(projects);
    } catch (error) {
        res.status(sessionPersistenceErrorStatus(error)).json({ error: error.message });
    }
});

app.get('/api/projects/trash', authenticateToken, async (req, res) => {
    try {
        const userId = req.user?.id;
        const projects = await getTrashedProjects(userId);
        res.json(projects);
    } catch (error) {
        res.status(sessionPersistenceErrorStatus(error)).json({ error: error.message });
    }
});

app.post('/api/projects/token-usage-summary', authenticateToken, async (req, res) => {
    try {
        const projectRefs = req.body?.projects;
        if (!Array.isArray(projectRefs)) {
            return res.status(400).json({ error: 'projects array is required' });
        }

        const summary = await getProjectTokenUsageSummary(projectRefs);
        res.json(summary);
    } catch (error) {
        console.error('Error building project token usage summary:', error);
        res.status(500).json({ error: 'Failed to build project token usage summary' });
    }
});

function resolvePersistedRuntimeId(runtimeIdOrProvider) {
    return 'pi';
}

function createApiSessionIdentity(req, projectKey, sessionId, runtimeIdOrProvider, indexedSession = null) {
    return createAgentSessionIdentity({
        ownerKey: indexedSession?.ownerKey || String(resolveRequestUserId(req)),
        projectKey,
        runtimeId: indexedSession?.runtimeId || resolvePersistedRuntimeId(runtimeIdOrProvider),
        sessionId,
    });
}

function sessionPersistenceErrorStatus(error, fallback = 500) {
    if (error?.status) return error.status;
    if (error?.code === 'AGENT_SESSION_IDENTITY_CONFLICT') return 409;
    if (error?.code === 'RUNTIME_SESSION_STORE_NOT_FOUND') return 400;
    if (error?.code === 'RUNTIME_SESSION_STORE_IDENTITY_MISMATCH') return 409;
    return fallback;
}

// Register the literal trash path before :projectName can consume it.
app.use('/api/projects', authenticateToken, createSessionManagementRouter({
    registry: runtimeSessionStoreRegistry,
    getSessionStatus: getAgentRuntimeSessionStatus,
}));

app.get('/api/projects/:projectName/sessions', authenticateToken, async (req, res) => {
    try {
        const userId = req.user?.id;
        const { limit = 5, offset = 0 } = req.query;
        const result = await getSessions(req.params.projectName, parseInt(limit), parseInt(offset), userId);
        res.json(result);
    } catch (error) {
        res.status(sessionPersistenceErrorStatus(error)).json({ error: error.message });
    }
});

// OAuth callback is bound to a short-lived random state, never a supplied owner/session id.
app.get('/api/agent-services/oauth/callback', async (req, res) => {
    try {
        const state = String(req.query.state || '');
        const code = String(req.query.code || '');
        await piRuntime.native.toolServices.integrations.completeOAuth({ state, code });
        res.setHeader('Content-Security-Policy', "default-src 'none'");
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.type('text').send('Authorization complete. You can return to MedHelp.');
    } catch (error) { res.status(400).type('text').send('Authorization failed or expired. Start authorization again in MedHelp.'); }
});
app.use('/api/agent-services', authenticateToken, agentServicesRoutes);
app.use('/api/agent-runs', authenticateToken, agentRunsRoutes);

app.get('/api/agent-work', authenticateToken, async (req, res) => {
    try {
        const ownerKey = String(req.user?.id);
        const requested = Array.isArray(req.query.projectKey)
            ? req.query.projectKey
            : [req.query.projectKey].filter(Boolean);
        const projectKeys = [...new Set(requested
            .map((value) => String(value || '').trim())
            .filter(Boolean))]
            .slice(0, 50);
        const stateGroups = await Promise.all(projectKeys.map((projectKey) => (
            listAgentRuntimeStates({ ownerKey, projectKey, runtimeId: 'pi' })
        )));
        const states = await Promise.all(stateGroups.flat().map((state) => state.runs.some((run) => run.status === 'running') || state.tasks.some((task) => task.background && task.status === 'running')
            ? piRuntime.native.sessionState(state.identity) : state));
        const summary = summarizeAgentWork(states, { recentLimit: 20 });
        const automationGroups = await Promise.all(projectKeys.map((projectKey) => listAutomationWork({ ownerKey, projectKey })));
        for (const item of automationGroups.flat()) {
            const group = item.status === 'running' ? 'active' : item.status === 'failed' ? 'needsAttention' : item.status === 'scheduled' ? 'scheduled' : 'recent';
            summary[group].unshift(item);
        }
        const terminalGroups = await Promise.all(projectKeys.map((projectKey) => listAgentTerminalWork({ ownerKey, projectKey })));
        for (const item of terminalGroups.flat()) {
            const group = item.status === 'running' ? 'active' : item.status === 'interrupted' ? 'needsAttention' : 'recent';
            summary[group].unshift(item);
        }
        // The work index is metadata only; full traces/results are fetched when
        // a task is opened, rather than retransmitted with every sidebar poll.
        res.json(Object.fromEntries(['needsAttention', 'active', 'scheduled', 'recent'].map((key) => [key, summary[key].map((item) => ({
            id: item.id, title: item.title, description: item.title ? undefined : item.description,
            status: item.status, sessionId: item.sessionId, runtimeId: item.runtimeId, projectKey: item.projectKey,
            kind: item.kind, background: item.background, childSessionId: item.childSessionId,
            updatedAt: item.updatedAt, schedule: item.schedule, toolName: item.toolName, terminal: item.terminal,
        }))])));
    } catch (error) {
        console.error('Error loading agent work:', error);
        res.status(500).json({ error: error.message || 'Failed to load agent work.' });
    }
});

app.post('/api/projects/:projectName/sessions/reindex', authenticateToken, async (req, res) => {
    try {
        const userId = req.user?.id;
        const requestedProviders = Array.isArray(req.body?.providers) ? req.body.providers : ['codex'];
        const result = await reindexProjectSessions(req.params.projectName, {
            providers: requestedProviders,
            userId,
        });
        res.json({ success: true, ...result });
    } catch (error) {
        console.error(`Error reindexing sessions for project ${req.params.projectName}:`, error);
        res.status(500).json({ error: error.message });
    }
});

// Get messages for a specific session
app.get('/api/projects/:projectName/sessions/:sessionId/messages', authenticateToken, async (req, res) => {
    try {
        const { projectName, sessionId } = req.params;
        const { limit, offset, provider } = req.query;

        // Parse limit and offset if provided
        const parsedLimit = limit ? parseInt(limit, 10) : null;
        const parsedOffset = offset ? parseInt(offset, 10) : 0;

        const { identity, options } = resolveApiSessionTarget(req, projectName, sessionId, provider);
        const result = await runtimeSessionStoreRegistry.require(identity.runtimeId).read(identity, {
            limit: parsedLimit,
            offset: parsedOffset,
            ...options,
        });

        // Handle both old and new response formats
        if (Array.isArray(result)) {
            // Backward compatibility: no pagination parameters were provided
            res.json({ messages: result });
        } else {
            // New format with pagination info
            res.json(result);
        }
    } catch (error) {
        res.status(sessionPersistenceErrorStatus(error)).json({ error: error.message });
    }
});

app.get('/api/projects/:projectName/tags', authenticateToken, async (req, res) => {
    try {
        const { projectName } = req.params;
        // Lazy initialization: idempotent, uses INSERT OR IGNORE internally.
        tagDb.ensureDefaultStageTags(projectName);
        const { tagType } = req.query;
        const tags = tagDb.listProjectTags(projectName, tagType || null);
        res.json({ tags });
    } catch (error) {
        res.status(sessionPersistenceErrorStatus(error)).json({ error: error.message });
    }
});

app.get('/api/projects/:projectName/sessions/:sessionId/tags', authenticateToken, async (req, res) => {
    try {
        const { projectName, sessionId } = req.params;
        const runtimeSelector = req.query.runtimeId || req.query.provider || null;
        const sessionLookup = {
            projectName,
            ownerKey: String(req.user.id),
            ...(runtimeSelector ? { runtimeId: runtimeSelector } : {}),
        };
        // Lazy initialization: idempotent, uses INSERT OR IGNORE internally.
        tagDb.ensureDefaultStageTags(projectName);
        const session = sessionDb.getSessionById(sessionId, sessionLookup);
        if (!session || session.project_name !== projectName) {
            return res.status(404).json({ error: 'Session not found' });
        }

        const tags = tagDb.listTagsForSession(sessionId, sessionLookup);
        res.json({ tags });
    } catch (error) {
        res.status(sessionPersistenceErrorStatus(error)).json({ error: error.message });
    }
});

app.put('/api/projects/:projectName/sessions/:sessionId/tags', authenticateToken, async (req, res) => {
    try {
        const { projectName, sessionId } = req.params;
        const { tagIds, runtimeId, provider } = req.body || {};
        const runtimeSelector = runtimeId || provider || req.query.runtimeId || req.query.provider || null;
        const sessionLookup = {
            projectName,
            ownerKey: String(req.user.id),
            ...(runtimeSelector ? { runtimeId: runtimeSelector } : {}),
        };

        if (!Array.isArray(tagIds)) {
            return res.status(400).json({ error: 'tagIds array is required' });
        }

        // Lazy initialization: idempotent, uses INSERT OR IGNORE internally.
        tagDb.ensureDefaultStageTags(projectName);
        const session = sessionDb.getSessionById(sessionId, sessionLookup);
        if (!session || session.project_name !== projectName) {
            return res.status(404).json({ error: 'Session not found' });
        }

        const tags = tagDb.replaceSessionTags(sessionId, projectName, tagIds, {
            ...sessionLookup,
            linkedBy: req.user?.username || 'user',
            source: 'manual',
        });
        res.json({ success: true, tags });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/projects/:projectName/sessions/:sessionId/context-review', authenticateToken, async (req, res) => {
    try {
        const { projectName, sessionId } = req.params;
        const runtimeSelector = req.query.runtimeId || req.query.provider || null;
        const sessionLookup = {
            projectName,
            ownerKey: String(req.user.id),
            ...(runtimeSelector ? { runtimeId: runtimeSelector } : {}),
        };
        const session = sessionDb.getSessionById(sessionId, sessionLookup);

        if (!session || session.project_name !== projectName) {
            return res.status(404).json({ error: 'Session not found' });
        }

        res.json({
            sessionId,
            projectName,
            reviews: sessionDb.getSessionContextReview(sessionId, sessionLookup),
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/projects/:projectName/sessions/:sessionId/context-review', authenticateToken, async (req, res) => {
    try {
        const { projectName, sessionId } = req.params;
        const { reviews, runtimeId, provider } = req.body || {};
        const runtimeSelector = runtimeId || provider || req.query.runtimeId || req.query.provider || null;
        const sessionLookup = {
            projectName,
            ownerKey: String(req.user.id),
            ...(runtimeSelector ? { runtimeId: runtimeSelector } : {}),
        };
        const session = sessionDb.getSessionById(sessionId, sessionLookup);

        if (!session || session.project_name !== projectName) {
            return res.status(404).json({ error: 'Session not found' });
        }

        res.json({
            sessionId,
            projectName,
            reviews: sessionDb.updateSessionContextReview(sessionId, reviews, sessionLookup),
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/projects/:projectName/sessions/:sessionId/execution-memory', authenticateToken, async (req, res) => {
    try {
        const { projectName, sessionId } = req.params;
        const runtimeSelector = req.query.runtimeId || req.query.provider || null;
        const session = sessionDb.getSessionById(sessionId, {
            projectName,
            ownerKey: String(req.user.id),
            ...(runtimeSelector ? { runtimeId: runtimeSelector } : {}),
        });

        if (!session || session.project_name !== projectName) {
            return res.status(404).json({ error: 'Session not found' });
        }

        const projectPath = await extractProjectDirectory(projectName);
        const snapshot = await readExecutionMemorySnapshot({
            scope: 'session',
            projectPath,
            sessionId,
            provider: session.provider || null,
        }, { ledgerLimit: 80 });

        res.json({
            sessionId,
            projectName,
            microtasks: snapshot.microtasks,
            derived: snapshot.derived,
            recentEvents: snapshot.ledgerEvents,
            sessionSummary: snapshot.sessionSummary,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/projects/:projectName/research-lessons', authenticateToken, async (req, res) => {
    try {
        const { projectName } = req.params;
        const projectPath = await extractProjectDirectory(projectName);
        const state = await readResearchLessons(projectPath);

        res.json({
            projectName,
            updatedAt: state.updatedAt,
            lessons: state.items,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Rename project endpoint
app.put('/api/projects/:projectName/rename', authenticateToken, async (req, res) => {
    try {
        const userId = req.user?.id;
        const { displayName } = req.body;
        await renameProject(req.params.projectName, displayName, userId);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Consultation sessions are ephemeral. This endpoint deliberately refuses to
// delete anything unless the indexed metadata marks it as a consultation.
app.delete('/api/projects/:projectName/consultations/:sessionId', authenticateToken, async (req, res) => {
    try {
        const { projectName, sessionId } = req.params;
        const requestedProvider = String(req.query.provider || req.query.runtimeId || '').trim().toLowerCase();
        const indexedSession = sessionDb.getSessionById(sessionId, {
            projectName,
            ownerKey: String(req.user.id),
            ...(requestedProvider ? { runtimeId: requestedProvider } : {}),
        });
        const indexedProjectName = indexedSession?.project_name || indexedSession?.projectName;
        const provider = String(requestedProvider || indexedSession?.provider || '').trim().toLowerCase();

        if (
            !indexedSession
            || indexedProjectName !== projectName
            || indexedSession.provider !== provider
            || extractSessionModeFromMetadata(indexedSession.metadata) !== 'consultation'
        ) {
            return res.status(404).json({ error: 'Consultation session not found' });
        }

        if (!['claude', 'codex'].includes(provider)) {
            return res.status(400).json({ error: `Unsupported consultation provider: ${provider}` });
        }

        const identity = createAgentSessionIdentity({
            ownerKey: String(req.user.id),
            projectKey: projectName,
            runtimeId: indexedSession.runtimeId || provider,
            sessionId,
        });
        await abortAgentRuntimeSession(identity);
        await runtimeSessionStoreRegistry.require(identity.runtimeId).delete(identity, { provider });

        reconnectableChatSessions.delete(createAgentSessionKey(identity));
        console.log(`[API] Ephemeral consultation ${sessionId} deleted (${provider})`);
        return res.json({ success: true });
    } catch (error) {
        console.error(`[API] Failed to delete consultation ${req.params.sessionId}:`, error);
        return res.status(500).json({ error: error.message });
    }
});

// Delete project endpoint (force=true to delete with sessions)
app.delete('/api/projects/:projectName', authenticateToken, async (req, res) => {
    try {
        const userId = req.user?.id;
        const { projectName } = req.params;
        const force = req.query.force === 'true';
        await deleteProject(projectName, force, userId);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/projects/trash/:projectName/restore', authenticateToken, async (req, res) => {
    try {
        const userId = req.user?.id;
        await restoreProject(req.params.projectName, userId);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/projects/trash/:projectName', authenticateToken, async (req, res) => {
    try {
        const userId = req.user?.id;
        const mode = req.query.mode === 'physical' ? 'physical' : 'logical';
        await deleteTrashedProject(req.params.projectName, mode, userId);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create project endpoint
async function handleCreateProject(req, res) {
    try {
        const { path: projectPath, displayName = null } = req.body;

        if (!projectPath || !projectPath.trim()) {
            return res.status(400).json({ error: 'Project path is required' });
        }

        const projectUserId = req.localKernelSession ? null : req.user?.id;
        const validation = await validateUserWorkspacePath(
            projectPath.trim(),
            projectUserId,
            req.localKernelSession
                ? { allowUserHome: true, allowWindowsDrives: true }
                : {},
        );
        if (!validation.valid) {
            return res.status(400).json({ error: validation.error });
        }

        const project = await addProjectManually(validation.resolvedPath, displayName, projectUserId);
        res.json({ success: true, project });
    } catch (error) {
        console.error('Error creating project:', error);
        res.status(500).json({ error: error.message });
    }
}

app.post('/api/projects/create', authenticateToken, handleCreateProject);
app.post('/api/projects', authenticateToken, handleCreateProject);

app.param('projectName', async (req, res, next, projectName) => {
    try {
        if (!req.path.startsWith('/api/projects/')) {
            return next();
        }

        const { projectDb } = await import('./database/db.js');
        const projectRecord = projectDb.getProjectById(projectName);
        const userId = req.user?.id;

        if (!projectRecord || (userId && projectRecord.user_id != null && Number(projectRecord.user_id) !== Number(userId))) {
            return res.status(404).json({ error: 'Project not found' });
        }

        req.projectRecord = projectRecord;
        return next();
    } catch (error) {
        return next(error);
    }
});

// Read file content endpoint
app.get('/api/projects/:projectName/file', authenticateToken, async (req, res) => {
    try {
        const { projectName } = req.params;
        const filePath = normalizeProjectFileRequestPath(req.query.filePath);


        // Security: ensure the requested path is inside the project root
        if (!filePath) {
            return res.status(400).json({ error: 'Invalid file path' });
        }

        const projectRoot = await extractProjectDirectory(projectName).catch(() => null);
        if (!projectRoot) {
            return res.status(404).json({ error: 'Project not found' });
        }

        // Handle both absolute and relative paths with pipeline file fallback + bare name search
        const result = await resolveProjectFilePath(projectRoot, filePath, {
            includeInternal: includeInternalProjectFiles(req),
        });
        if (result.candidates) {
            return res.json({ ambiguous: true, candidates: result.candidates });
        }
        const resolved = result.resolved;
        await assertReadableProjectPath(projectRoot, resolved, {
            includeInternal: includeInternalProjectFiles(req),
        });

        const rawMaxPreview = req.query.maxPreviewBytes;
        let maxPreviewBytes = null;
        if (rawMaxPreview !== undefined && rawMaxPreview !== null && String(rawMaxPreview).trim() !== '') {
            const parsed = Number.parseInt(String(rawMaxPreview), 10);
            if (Number.isFinite(parsed) && parsed > 0) {
                maxPreviewBytes = Math.min(parsed, 2 * 1024 * 1024);
            }
        }

        const stats = await fsPromises.stat(resolved);
        let content;
        let truncated = false;
        if (maxPreviewBytes && stats.size > maxPreviewBytes) {
            const handle = await fsPromises.open(resolved, 'r');
            try {
                const buf = Buffer.allocUnsafe(maxPreviewBytes);
                const { bytesRead } = await handle.read(buf, 0, maxPreviewBytes, 0);
                content = buf.subarray(0, bytesRead).toString('utf8');
                truncated = true;
            } finally {
                await handle.close();
            }
        } else {
            content = await fsPromises.readFile(resolved, 'utf8');
        }

        res.json({
            content,
            path: resolved,
            truncated,
            totalBytes: stats.size,
            previewBytes: truncated ? maxPreviewBytes : stats.size,
        });
    } catch (error) {
        if (error.code === 'ENOENT') {
            // File not found is a normal condition (e.g. optional config files) — no noisy log
            res.status(404).json({ error: 'File not found' });
        } else if (error.statusCode) {
            res.status(error.statusCode).json({ error: error.message });
        } else if (error.code === 'EACCES') {
            console.error('Permission denied reading project file');
            res.status(403).json({ error: 'Permission denied' });
        } else {
            console.error('Error reading file:', error);
            res.status(500).json({ error: error.message });
        }
    }
});

// Serve binary file content endpoint (for images, etc.)
app.get('/api/projects/:projectName/files/content', authenticateToken, async (req, res) => {
    try {
        const { projectName } = req.params;
        const filePath = normalizeProjectFileRequestPath(req.query.path);


        // Security: ensure the requested path is inside the project root
        if (!filePath) {
            return res.status(400).json({ error: 'Invalid file path' });
        }

        const projectRoot = await extractProjectDirectory(projectName).catch(() => null);
        if (!projectRoot) {
            return res.status(404).json({ error: 'Project not found' });
        }

        const result = await resolveProjectFilePath(projectRoot, filePath, {
            includeInternal: includeInternalProjectFiles(req),
        });
        if (result.candidates) {
            return res.status(400).json({ error: 'Ambiguous filename', candidates: result.candidates });
        }
        const resolved = result.resolved;
        await assertReadableProjectPath(projectRoot, resolved, {
            includeInternal: includeInternalProjectFiles(req),
        });

        const exportFormat = String(req.query.format || '').trim().toLowerCase();
        if (exportFormat && !['docx', 'pdf', 'preview'].includes(exportFormat)) {
            return res.status(400).json({ error: 'Unsupported export format' });
        }

        if (exportFormat === 'preview') {
            const extension = path.extname(resolved).toLowerCase();
            if (!['.tif', '.tiff'].includes(extension)) {
                return res.status(400).json({ error: 'Image preview conversion is only available for TIFF files' });
            }

            const stats = await fsPromises.stat(resolved);
            if (stats.size > 512 * 1024 * 1024) {
                return res.status(413).json({ error: 'TIFF file is too large to preview (maximum 512 MB)' });
            }

            const previewBuffer = await sharp(resolved, {
                pages: 1,
                limitInputPixels: 268402689,
            })
                .rotate()
                .resize({
                    width: 4096,
                    height: 4096,
                    fit: 'inside',
                    withoutEnlargement: true,
                })
                .png({ compressionLevel: 6 })
                .toBuffer();

            res.setHeader('Content-Type', 'image/png');
            res.setHeader('Cache-Control', 'private, max-age=300');
            return res.send(previewBuffer);
        }

        if (exportFormat) {
            const extension = path.extname(resolved).toLowerCase();
            if (!['.md', '.mdx', '.markdown'].includes(extension)) {
                return res.status(400).json({ error: 'DOCX and PDF export is only available for Markdown files' });
            }

            const stats = await fsPromises.stat(resolved);
            if (stats.size > 5 * 1024 * 1024) {
                return res.status(413).json({ error: 'Markdown file is too large to export (maximum 5 MB)' });
            }

            const markdown = await fsPromises.readFile(resolved, 'utf8');
            const baseName = path.basename(resolved, extension);
            const outputName = `${baseName}.${exportFormat}`;
            const asciiName = outputName.replace(/[^\x20-\x7E]+/g, '_').replace(/["\\]/g, '_') || `document.${exportFormat}`;
            const buffer = exportFormat === 'docx'
                ? await markdownToDocxBuffer(markdown, { title: baseName })
                : await markdownToPdfBuffer(markdown, { title: baseName });

            res.setHeader('Content-Type', exportFormat === 'docx'
                ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                : 'application/pdf');
            const encodedName = encodeURIComponent(outputName).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
            res.setHeader('Content-Disposition', `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`);
            res.setHeader('Cache-Control', 'no-store');
            return res.send(buffer);
        }

        // Check if file exists
        try {
            await fsPromises.access(resolved);
        } catch (error) {
            return res.status(404).json({ error: 'File not found' });
        }

        // Get file extension and set appropriate content type
        const mimeType = mime.lookup(resolved) || 'application/octet-stream';
        res.setHeader('Content-Type', mimeType);

        // Stream the file
        const fileStream = fs.createReadStream(resolved);
        fileStream.pipe(res);

        fileStream.on('error', (error) => {
            console.error('Error streaming file:', error);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Error reading file' });
            }
        });

    } catch (error) {
        console.error('Error serving binary file:', error);
        if (!res.headersSent) {
            res.status(error.statusCode || 500).json({ error: error.message });
        }
    }
});

// Reveal a project file or folder in the native file manager on the host running this server.
app.post(
    '/api/projects/:projectName/file/reveal',
    authenticateToken,
    requireCapability('workspace.file.reveal'),
    async (req, res) => {
        try {
            const { projectName } = req.params;
            const { filePath = '' } = req.body || {};

            if (typeof filePath !== 'string') {
                return res.status(400).json({ error: 'Invalid file path' });
            }

            const projectRoot = await extractProjectDirectory(projectName).catch(() => null);
            if (!projectRoot) {
                return res.status(404).json({ error: 'Project not found' });
            }

            const requestedPath = normalizeProjectFileRequestPath(filePath);
            let resolved = path.resolve(projectRoot);

            if (requestedPath) {
                const result = await resolveProjectFilePath(projectRoot, requestedPath);
                if (result.candidates) {
                    return res.status(400).json({ error: 'Ambiguous filename', candidates: result.candidates });
                }
                resolved = result.resolved;
            }

            await assertReadableProjectPath(projectRoot, resolved);
            const stats = await fsPromises.stat(resolved);
            const openTarget = await openPathInNativeFileManager(resolved, stats);

            res.json({
                success: true,
                path: resolved,
                openedPath: openTarget,
                platform: process.platform,
            });
        } catch (error) {
            console.error('Error opening file manager:', error);
            if (error.code === 'ENOENT') {
                res.status(404).json({ error: 'File or directory not found' });
            } else if (error.statusCode) {
                res.status(error.statusCode).json({ error: error.message });
            } else if (error.code === 'EACCES' || error.code === 'EPERM') {
                res.status(403).json({ error: 'Permission denied' });
            } else {
                res.status(500).json({ error: error.message || 'Failed to open file manager' });
            }
        }
    },
);

// Save file content endpoint
app.put('/api/projects/:projectName/file', authenticateToken, async (req, res) => {
    try {
        const { projectName } = req.params;
        const { filePath, content } = req.body;


        // Security: ensure the requested path is inside the project root
        if (!filePath) {
            return res.status(400).json({ error: 'Invalid file path' });
        }

        if (content === undefined) {
            return res.status(400).json({ error: 'Content is required' });
        }

        const projectRoot = await extractProjectDirectory(projectName).catch(() => null);
        if (!projectRoot) {
            return res.status(404).json({ error: 'Project not found' });
        }

        // Handle both absolute and relative paths with pipeline file fallback + bare name search
        const result = await resolveProjectFilePath(projectRoot, filePath);
        if (result.candidates) {
            return res.status(400).json({ error: 'Ambiguous filename', candidates: result.candidates });
        }
        const resolved = result.resolved;
        await assertWritableProjectPath(projectRoot, resolved);

        // Write the new content
        await fsPromises.writeFile(resolved, content, 'utf8');

        res.json({
            success: true,
            path: resolved,
            message: 'File saved successfully'
        });
    } catch (error) {
        console.error('Error saving file:', error);
        if (error.code === 'ENOENT') {
            res.status(404).json({ error: 'File or directory not found' });
        } else if (error.statusCode) {
            res.status(error.statusCode).json({ error: error.message });
        } else if (error.code === 'EACCES') {
            res.status(403).json({ error: 'Permission denied' });
        } else {
            res.status(500).json({ error: error.message });
        }
    }
});

// Create an empty file within the project filesystem without overwriting an existing item.
app.post('/api/projects/:projectName/file/create', authenticateToken, async (req, res) => {
    try {
        const { projectName } = req.params;
        const { parentDir = '', name } = req.body || {};
        const fileName = normalizeProjectEntryName(name);

        if (!fileName) {
            return res.status(400).json({ error: 'Invalid file name' });
        }
        if (typeof parentDir !== 'string') {
            return res.status(400).json({ error: 'Invalid parent directory' });
        }

        const projectRoot = await extractProjectDirectory(projectName).catch(() => null);
        if (!projectRoot) {
            return res.status(404).json({ error: 'Project not found' });
        }

        const resolvedProjectRoot = path.resolve(projectRoot);
        const resolvedParentDir = resolveProjectChildPath(projectRoot, parentDir);
        await assertReadableProjectPath(projectRoot, resolvedParentDir);
        const parentStats = await fsPromises.stat(resolvedParentDir);
        if (!parentStats.isDirectory()) {
            return res.status(400).json({ error: 'Parent path must be a directory' });
        }

        const targetPath = path.join(resolvedParentDir, fileName);
        await assertWritableProjectPath(projectRoot, targetPath);

        const fileHandle = await fsPromises.open(targetPath, 'wx');
        await fileHandle.close();

        res.json({
            success: true,
            name: fileName,
            absolutePath: targetPath,
            relativePath: path.relative(resolvedProjectRoot, targetPath).split(path.sep).join('/'),
        });
    } catch (error) {
        console.error('Error creating project file:', error);
        if (error.code === 'EEXIST') {
            res.status(409).json({ error: 'A file or folder with that name already exists' });
        } else if (error.code === 'ENOENT') {
            res.status(404).json({ error: 'Parent directory not found' });
        } else if (error.statusCode) {
            res.status(error.statusCode).json({ error: error.message });
        } else if (error.code === 'EACCES' || error.code === 'EPERM') {
            res.status(403).json({ error: 'Permission denied' });
        } else {
            res.status(500).json({ error: error.message || 'Failed to create file' });
        }
    }
});

// Rename a file or directory in place.
app.post('/api/projects/:projectName/file/rename', authenticateToken, async (req, res) => {
    try {
        const { projectName } = req.params;
        const { sourcePath, newName } = req.body || {};
        const normalizedNewName = normalizeProjectEntryName(newName);

        if (!sourcePath || typeof sourcePath !== 'string') {
            return res.status(400).json({ error: 'Invalid source path' });
        }
        if (!normalizedNewName) {
            return res.status(400).json({ error: 'Invalid new name' });
        }

        const projectRoot = await extractProjectDirectory(projectName).catch(() => null);
        if (!projectRoot) {
            return res.status(404).json({ error: 'Project not found' });
        }

        const resolvedProjectRoot = path.resolve(projectRoot);
        const sourceResult = await resolveProjectFilePath(projectRoot, sourcePath);
        if (sourceResult.candidates) {
            return res.status(400).json({ error: 'Ambiguous source path', candidates: sourceResult.candidates });
        }

        const resolvedSourcePath = sourceResult.resolved;
        await assertReadableProjectPath(projectRoot, resolvedSourcePath);
        if (resolvedSourcePath === resolvedProjectRoot) {
            return res.status(400).json({ error: 'Project root cannot be renamed' });
        }

        const sourceStats = await fsPromises.stat(resolvedSourcePath);
        if (!sourceStats.isFile() && !sourceStats.isDirectory()) {
            return res.status(400).json({ error: 'Only files and folders can be renamed' });
        }

        const targetPath = path.join(path.dirname(resolvedSourcePath), normalizedNewName);
        if (targetPath === resolvedSourcePath) {
            return res.status(400).json({ error: 'The new name is unchanged' });
        }
        await assertWritableProjectPath(projectRoot, targetPath);
        if (await projectPathExists(targetPath)) {
            return res.status(409).json({ error: 'A file or folder with that name already exists' });
        }

        await fsPromises.rename(resolvedSourcePath, targetPath);

        res.json({
            success: true,
            name: normalizedNewName,
            absolutePath: targetPath,
            relativePath: path.relative(resolvedProjectRoot, targetPath).split(path.sep).join('/'),
        });
    } catch (error) {
        console.error('Error renaming project file or folder:', error);
        if (error.code === 'ENOENT') {
            res.status(404).json({ error: 'File or directory not found' });
        } else if (error.statusCode) {
            res.status(error.statusCode).json({ error: error.message });
        } else if (error.code === 'EACCES' || error.code === 'EPERM') {
            res.status(403).json({ error: 'Permission denied' });
        } else {
            res.status(500).json({ error: error.message || 'Failed to rename item' });
        }
    }
});

// Copy a file or directory into another project directory, choosing a unique name on conflict.
app.post('/api/projects/:projectName/file/copy', authenticateToken, async (req, res) => {
    try {
        const { projectName } = req.params;
        const { sourcePath, destinationDir = '' } = req.body || {};

        if (!sourcePath || typeof sourcePath !== 'string') {
            return res.status(400).json({ error: 'Invalid source path' });
        }
        if (typeof destinationDir !== 'string') {
            return res.status(400).json({ error: 'Invalid destination directory' });
        }

        const projectRoot = await extractProjectDirectory(projectName).catch(() => null);
        if (!projectRoot) {
            return res.status(404).json({ error: 'Project not found' });
        }

        const resolvedProjectRoot = path.resolve(projectRoot);
        const sourceResult = await resolveProjectFilePath(projectRoot, sourcePath);
        if (sourceResult.candidates) {
            return res.status(400).json({ error: 'Ambiguous source path', candidates: sourceResult.candidates });
        }

        const resolvedSourcePath = sourceResult.resolved;
        await assertReadableProjectPath(projectRoot, resolvedSourcePath);
        if (resolvedSourcePath === resolvedProjectRoot) {
            return res.status(400).json({ error: 'Project root cannot be copied' });
        }

        const sourceStats = await fsPromises.stat(resolvedSourcePath);
        const isDirectory = sourceStats.isDirectory();
        if (!sourceStats.isFile() && !isDirectory) {
            return res.status(400).json({ error: 'Only files and folders can be copied' });
        }

        const resolvedDestinationDir = resolveProjectChildPath(projectRoot, destinationDir);
        await assertReadableProjectPath(projectRoot, resolvedDestinationDir);
        const destinationStats = await fsPromises.stat(resolvedDestinationDir);
        if (!destinationStats.isDirectory()) {
            return res.status(400).json({ error: 'Destination must be a directory' });
        }
        const realSourcePath = await fsPromises.realpath(resolvedSourcePath);
        const realDestinationDir = await fsPromises.realpath(resolvedDestinationDir);
        if (isDirectory && isPathInsideOrEqual(realSourcePath, realDestinationDir)) {
            return res.status(400).json({ error: 'Folder cannot be copied into itself or one of its subfolders' });
        }

        const targetPath = await findAvailableProjectCopyPath(resolvedDestinationDir, path.basename(resolvedSourcePath), isDirectory);
        await assertWritableProjectPath(projectRoot, targetPath);
        await fsPromises.cp(resolvedSourcePath, targetPath, {
            recursive: isDirectory,
            errorOnExist: true,
            force: false,
        });

        res.json({
            success: true,
            name: path.basename(targetPath),
            absolutePath: targetPath,
            relativePath: path.relative(resolvedProjectRoot, targetPath).split(path.sep).join('/'),
        });
    } catch (error) {
        console.error('Error copying project file or folder:', error);
        if (error.code === 'ENOENT') {
            res.status(404).json({ error: 'Source file or destination folder not found' });
        } else if (error.statusCode) {
            res.status(error.statusCode).json({ error: error.message });
        } else if (error.code === 'EACCES' || error.code === 'EPERM') {
            res.status(403).json({ error: 'Permission denied' });
        } else {
            res.status(500).json({ error: error.message || 'Failed to copy item' });
        }
    }
});

// Move a file or directory to another directory within the same project
app.post('/api/projects/:projectName/file/move', authenticateToken, async (req, res) => {
    try {
        const { projectName } = req.params;
        const { sourcePath, destinationDir } = req.body || {};

        if (!sourcePath || typeof sourcePath !== 'string') {
            return res.status(400).json({ error: 'Invalid source path' });
        }

        if (typeof destinationDir !== 'string') {
            return res.status(400).json({ error: 'Invalid destination directory' });
        }

        const projectRoot = await extractProjectDirectory(projectName).catch(() => null);
        if (!projectRoot) {
            return res.status(404).json({ error: 'Project not found' });
        }

        const resolvedProjectRoot = path.resolve(projectRoot);
        const normalizedRoot = `${resolvedProjectRoot}${path.sep}`;
        const sourceResult = await resolveProjectFilePath(projectRoot, sourcePath);

        if (sourceResult.candidates) {
            return res.status(400).json({ error: 'Ambiguous source path', candidates: sourceResult.candidates });
        }

        const resolvedSourcePath = sourceResult.resolved;
        await assertReadableProjectPath(projectRoot, resolvedSourcePath);

        const sourceStats = await fsPromises.stat(resolvedSourcePath);
        const isDirectoryMove = sourceStats.isDirectory();
        const isFileMove = sourceStats.isFile();
        if (!isFileMove && !isDirectoryMove) {
            return res.status(400).json({ error: 'Only files and folders can be moved from this panel' });
        }
        if (resolvedSourcePath === resolvedProjectRoot) {
            return res.status(400).json({ error: 'Project root cannot be moved' });
        }

        const trimmedDestinationDir = destinationDir.trim();
        const resolvedDestinationDir = path.isAbsolute(trimmedDestinationDir)
            ? path.resolve(trimmedDestinationDir)
            : path.resolve(projectRoot, trimmedDestinationDir);

        if (
            resolvedDestinationDir !== resolvedProjectRoot &&
            !resolvedDestinationDir.startsWith(normalizedRoot)
        ) {
            return res.status(403).json({ error: 'Destination must be under project root' });
        }
        await assertReadableProjectPath(projectRoot, resolvedDestinationDir);

        const destinationStats = await fsPromises.stat(resolvedDestinationDir);
        if (!destinationStats.isDirectory()) {
            return res.status(400).json({ error: 'Destination must be a directory' });
        }

        if (
            isDirectoryMove &&
            (resolvedDestinationDir === resolvedSourcePath ||
                resolvedDestinationDir.startsWith(`${resolvedSourcePath}${path.sep}`))
        ) {
            return res.status(400).json({ error: 'Folder cannot be moved into itself or one of its subfolders' });
        }

        const targetPath = path.join(resolvedDestinationDir, path.basename(resolvedSourcePath));
        if (targetPath === resolvedSourcePath) {
            return res.status(400).json({ error: 'Item is already in that folder' });
        }
        await assertWritableProjectPath(projectRoot, targetPath);

        try {
            await fsPromises.access(targetPath);
            return res.status(409).json({ error: 'An item with the same name already exists in that folder' });
        } catch {
            // Target does not exist, so the move can continue.
        }

        await fsPromises.rename(resolvedSourcePath, targetPath);

        const relativePath = path.relative(resolvedProjectRoot, targetPath).split(path.sep).join('/');
        const relativeDestinationDir = path.relative(resolvedProjectRoot, resolvedDestinationDir).split(path.sep).join('/') || '.';

        res.json({
            success: true,
            name: path.basename(targetPath),
            absolutePath: targetPath,
            relativePath,
            destinationDir: relativeDestinationDir,
        });
    } catch (error) {
        console.error('Error moving file or folder:', error);
        if (error.code === 'ENOENT') {
            res.status(404).json({ error: 'Source file or destination folder not found' });
        } else if (error.statusCode) {
            res.status(error.statusCode).json({ error: error.message });
        } else if (error.code === 'EACCES' || error.code === 'EPERM') {
            res.status(403).json({ error: 'Permission denied' });
        } else {
            res.status(500).json({ error: error.message });
        }
    }
});

// Create a directory within the project filesystem
app.post('/api/projects/:projectName/folder', authenticateToken, async (req, res) => {
    try {
        const { projectName } = req.params;
        const { parentDir = '', name } = req.body || {};

        if (typeof name !== 'string' || !name.trim()) {
            return res.status(400).json({ error: 'Folder name is required' });
        }

        if (typeof parentDir !== 'string') {
            return res.status(400).json({ error: 'Invalid parent directory' });
        }

        const folderName = name.trim();
        if (
            folderName === '.' ||
            folderName === '..' ||
            folderName.startsWith('.') ||
            folderName.includes('/') ||
            folderName.includes('\\') ||
            folderName.includes('\0')
        ) {
            return res.status(400).json({ error: 'Invalid folder name' });
        }

        const projectRoot = await extractProjectDirectory(projectName).catch(() => null);
        if (!projectRoot) {
            return res.status(404).json({ error: 'Project not found' });
        }

        const resolvedProjectRoot = path.resolve(projectRoot);
        const normalizedRoot = `${resolvedProjectRoot}${path.sep}`;
        const trimmedParentDir = parentDir.trim();
        const resolvedParentDir = trimmedParentDir
            ? (path.isAbsolute(trimmedParentDir)
                ? path.resolve(trimmedParentDir)
                : path.resolve(projectRoot, trimmedParentDir))
            : resolvedProjectRoot;

        if (
            resolvedParentDir !== resolvedProjectRoot &&
            !resolvedParentDir.startsWith(normalizedRoot)
        ) {
            return res.status(403).json({ error: 'Parent directory must be under project root' });
        }
        assertPublicProjectPath(projectRoot, resolvedParentDir);

        const parentStats = await fsPromises.stat(resolvedParentDir);
        if (!parentStats.isDirectory()) {
            return res.status(400).json({ error: 'Parent path must be a directory' });
        }

        const targetPath = path.join(resolvedParentDir, folderName);
        if (!targetPath.startsWith(normalizedRoot)) {
            return res.status(403).json({ error: 'Target directory must be under project root' });
        }
        assertPublicProjectPath(projectRoot, targetPath);

        try {
            await fsPromises.access(targetPath);
            return res.status(409).json({ error: 'Folder already exists' });
        } catch {
            // Target does not exist, so creation can continue.
        }

        await fsPromises.mkdir(targetPath, { recursive: false });

        const relativePath = path.relative(resolvedProjectRoot, targetPath).split(path.sep).join('/');
        const relativeParentDir = path.relative(resolvedProjectRoot, resolvedParentDir).split(path.sep).join('/') || '.';

        res.json({
            success: true,
            name: folderName,
            absolutePath: targetPath,
            relativePath,
            parentDir: relativeParentDir,
        });
    } catch (error) {
        console.error('Error creating project folder:', error);
        if (error.code === 'ENOENT') {
            res.status(404).json({ error: 'Parent directory not found' });
        } else if (error.statusCode) {
            res.status(error.statusCode).json({ error: error.message });
        } else if (error.code === 'EACCES' || error.code === 'EPERM') {
            res.status(403).json({ error: 'Permission denied' });
        } else {
            res.status(500).json({ error: error.message || 'Failed to create folder' });
        }
    }
});

// Delete a file or directory from the project filesystem
app.delete('/api/projects/:projectName/file', authenticateToken, async (req, res) => {
    try {
        const projectName = req.params.projectName;
        const { filePath } = req.body || {};

        if (!filePath || typeof filePath !== 'string') {
            return res.status(400).json({ error: 'Invalid file path' });
        }

        const projectRoot = await extractProjectDirectory(projectName).catch(() => null);
        if (!projectRoot) {
            return res.status(404).json({ error: 'Project not found' });
        }

        const resolved = path.isAbsolute(filePath)
            ? path.resolve(filePath)
            : path.resolve(projectRoot, filePath);
        const normalizedRoot = path.resolve(projectRoot) + path.sep;
        if (!resolved.startsWith(normalizedRoot)) {
            return res.status(403).json({ error: 'Path must be under project root' });
        }
        assertPublicProjectPath(projectRoot, resolved);

        await fsPromises.rm(resolved, { recursive: true });

        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting file:', error);
        if (error.code === 'ENOENT') {
            res.status(404).json({ error: 'File or directory not found' });
        } else if (error.statusCode) {
            res.status(error.statusCode).json({ error: error.message });
        } else if (error.code === 'EACCES') {
            res.status(403).json({ error: 'Permission denied' });
        } else {
            res.status(500).json({ error: error.message });
        }
    }
});

// Upload files to project filesystem
app.post('/api/projects/:projectName/upload-files', authenticateToken, async (req, res) => {
    try {
        const multer = (await import('multer')).default;
        const CHAT_ATTACHMENT_STORAGE_SCOPE = 'project-chat-attachments';
        const MAX_UPLOAD_FILE_COUNT = 200;
        const projectName = req.params.projectName;
        const projectRoot = await extractProjectDirectory(projectName).catch(() => null);
        if (!projectRoot) {
            return res.status(404).json({ error: 'Project not found' });
        }

        const createUploadError = (message, statusCode = 400) => {
            const error = new Error(message);
            error.statusCode = statusCode;
            return error;
        };

        const getUploadDestination = (request) => {
            const storageScope = typeof request.body?.storageScope === 'string' ? request.body.storageScope : '';
            const targetDir = (request.body && request.body.targetDir) || '';
            const baseDir = storageScope === CHAT_ATTACHMENT_STORAGE_SCOPE
                ? resolveProjectChatAttachmentsDir(projectRoot)
                : projectRoot;
            const resolved = path.resolve(baseDir, targetDir);
            const normalizedBase = path.resolve(baseDir) + path.sep;

            if (!resolved.startsWith(normalizedBase) && resolved !== path.resolve(baseDir)) {
                const message = storageScope === CHAT_ATTACHMENT_STORAGE_SCOPE
                    ? 'Path must be under project attachment storage'
                    : 'Path must be under project root';
                throw createUploadError(message, 403);
            }
            if (storageScope !== CHAT_ATTACHMENT_STORAGE_SCOPE) {
                assertPublicProjectPath(projectRoot, resolved);
            }

            return resolved;
        };

        const getSafeUploadRelativePath = (originalName) => {
            const rawPath = String(originalName || '').replace(/\\/g, '/');
            const segments = rawPath.split('/').filter(Boolean);

            if (segments.length === 0) {
                throw createUploadError('Invalid upload path');
            }

            const safeSegments = segments.map((segment) => {
                const cleanSegment = segment.replace(/\0/g, '').trim();

                if (!cleanSegment || cleanSegment === '.' || cleanSegment === '..') {
                    throw createUploadError('Invalid upload path');
                }

                return cleanSegment.replace(/\.\./g, '_').replace(/[/\\]/g, '_');
            });

            const relativePath = path.join(...safeSegments);
            const normalizedPath = path.normalize(relativePath);

            if (path.isAbsolute(normalizedPath) || normalizedPath.startsWith(`..${path.sep}`) || normalizedPath === '..') {
                throw createUploadError('Invalid upload path');
            }

            return normalizedPath;
        };

        const normalizeUploadFieldArray = (value) => {
            if (Array.isArray(value)) return value;
            if (typeof value === 'string') return [value];
            return [];
        };

        const getUploadDirectoryFields = (request) => Array.from(new Set(
            normalizeUploadFieldArray(request.body?.directories)
                .map((directoryPath) => String(directoryPath || '').trim())
                .filter(Boolean)
        ));

        const getUploadRelativePathFields = (request) => normalizeUploadFieldArray(
            request.body?.relativePaths ?? request.body?.relativePath
        );

        const isVisibleProjectUploadPath = (targetPath) => {
            const relativePath = getProjectRelativePath(projectRoot, targetPath);
            return !isInternalProjectPath(relativePath);
        };

        const moveUploadedTempFile = async (sourcePath, targetPath) => {
            try {
                await fsPromises.rename(sourcePath, targetPath);
            } catch (error) {
                if (error.code !== 'EXDEV') {
                    throw error;
                }

                await fsPromises.copyFile(sourcePath, targetPath);
                await fsPromises.unlink(sourcePath);
            }
        };

        const storage = multer.diskStorage({
            destination: async (req, file, cb) => {
                try {
                    if (!req.uploadTempDir) {
                        const userId = req.user?.id ? String(req.user.id) : 'anonymous';
                        const uploadId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
                        req.uploadTempDir = path.join(os.tmpdir(), 'medhelp-project-uploads', userId, uploadId);
                    }
                    await fsPromises.mkdir(req.uploadTempDir, { recursive: true });
                    cb(null, req.uploadTempDir);
                } catch (error) {
                    cb(error);
                }
            },
            filename: async (req, file, cb) => {
                try {
                    req.uploadTempFileIndex = (req.uploadTempFileIndex || 0) + 1;
                    const extension = path.extname(String(file.originalname || '')).replace(/[^a-zA-Z0-9.]/g, '');
                    cb(null, `${req.uploadTempFileIndex}-${Date.now()}${extension}`);
                } catch (error) {
                    cb(error);
                }
            }
        });

        const upload = multer({
            preservePath: true,
            storage,
            limits: {
                fileSize: 50 * 1024 * 1024, // 50MB
                files: MAX_UPLOAD_FILE_COUNT
            }
        });

        upload.array('files', MAX_UPLOAD_FILE_COUNT)(req, res, async (err) => {
            if (err) {
                const status = Number.isInteger(err.statusCode) ? err.statusCode : 400;
                return res.status(status).json({ error: err.message });
            }

            try {
                const storageScope = String(req.body?.storageScope || '');
                const isChatAttachmentUpload = storageScope === CHAT_ATTACHMENT_STORAGE_SCOPE;
                const destinationDir = getUploadDestination(req);
                const normalizedDestination = `${path.resolve(destinationDir)}${path.sep}`;
                const createdDirectories = [];
                const uploadedFiles = [];
                const skippedInternalUploadPaths = [];
                const relativePathFields = getUploadRelativePathFields(req);

                await fsPromises.mkdir(destinationDir, { recursive: true });

                for (const directoryPath of getUploadDirectoryFields(req)) {
                    const safeRelativePath = getSafeUploadRelativePath(directoryPath);
                    const finalDir = path.resolve(destinationDir, safeRelativePath);

                    if (!finalDir.startsWith(normalizedDestination)) {
                        throw createUploadError('Invalid upload path');
                    }
                    if (!isChatAttachmentUpload) {
                        if (!isVisibleProjectUploadPath(finalDir)) {
                            skippedInternalUploadPaths.push(directoryPath);
                            continue;
                        }
                        assertPublicProjectPath(projectRoot, finalDir);
                    }

                    await fsPromises.mkdir(finalDir, { recursive: true });
                    createdDirectories.push({
                        name: path.basename(finalDir),
                        path: finalDir,
                        relativePath: path.relative(projectRoot, finalDir).split(path.sep).join('/')
                    });
                }

                for (const [index, file] of (req.files || []).entries()) {
                    const requestedRelativePath = relativePathFields[index] || file.originalname || file.filename;
                    const safeRelativePath = getSafeUploadRelativePath(requestedRelativePath);
                    const finalPath = path.resolve(destinationDir, safeRelativePath);

                    if (!finalPath.startsWith(normalizedDestination)) {
                        throw createUploadError('Invalid upload path');
                    }
                    if (!isChatAttachmentUpload) {
                        if (!isVisibleProjectUploadPath(finalPath)) {
                            skippedInternalUploadPaths.push(requestedRelativePath);
                            await fsPromises.rm(file.path, { force: true });
                            continue;
                        }
                        assertPublicProjectPath(projectRoot, finalPath);
                    }

                    await fsPromises.mkdir(path.dirname(finalPath), { recursive: true });
                    await moveUploadedTempFile(file.path, finalPath);

                    uploadedFiles.push({
                        name: path.basename(finalPath),
                        size: file.size,
                        path: finalPath,
                        relativePath: path.relative(projectRoot, finalPath).split(path.sep).join('/')
                    });
                }

                if (uploadedFiles.length === 0 && createdDirectories.length === 0) {
                    return res.status(400).json({
                        error: skippedInternalUploadPaths.length > 0
                            ? 'No visible files or folders provided'
                            : 'No files or folders provided'
                    });
                }

                res.json({
                    files: uploadedFiles,
                    directories: createdDirectories,
                    skippedInternalPaths: skippedInternalUploadPaths
                });
            } catch (uploadError) {
                const status = Number.isInteger(uploadError.statusCode) ? uploadError.statusCode : 400;
                return res.status(status).json({ error: uploadError.message });
            } finally {
                if (req.uploadTempDir) {
                    await fsPromises.rm(req.uploadTempDir, { recursive: true, force: true }).catch(() => {});
                }
            }
        });
    } catch (error) {
        console.error('Error in file upload endpoint:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Global skills endpoints (GET /api/skills, GET /api/skills/file) are handled
// by the skillsRoutes router mounted above at /api/skills.

app.get('/api/projects/:projectName/files', authenticateToken, async (req, res) => {
    try {

        // Using fsPromises from import

        // Use extractProjectDirectory to get the actual project path
        let actualPath;
        try {
            actualPath = await extractProjectDirectory(req.params.projectName);
        } catch (error) {
            console.error('Error extracting project directory:', error);
            // Fallback to simple dash replacement
            actualPath = req.params.projectName.replace(/-/g, '/');
        }

        const projectRoot = path.resolve(actualPath);
        const { path: requestedPath, maxDepth: maxDepthQuery, showHidden: showHiddenQuery } = req.query;
        const includeInternal = includeInternalProjectFiles(req);

        let targetPath = projectRoot;
        if (typeof requestedPath === 'string' && requestedPath.trim()) {
            targetPath = path.isAbsolute(requestedPath)
                ? path.resolve(requestedPath)
                : path.resolve(projectRoot, requestedPath);

            const normalizedRoot = projectRoot + path.sep;
            if (targetPath !== projectRoot && !targetPath.startsWith(normalizedRoot)) {
                return res.status(403).json({ error: 'Path must be under project root' });
            }
        }
        assertPublicProjectPath(projectRoot, targetPath, { includeInternal });

        // Check if path exists
        try {
            await fsPromises.access(targetPath);
        } catch (e) {
            return res.status(404).json({ error: `Project path not found: ${targetPath}` });
        }

        let maxDepth = 10;
        if (maxDepthQuery !== undefined) {
            const parsedDepth = Number.parseInt(String(maxDepthQuery), 10);
            if (!Number.isNaN(parsedDepth)) {
                maxDepth = Math.min(10, Math.max(0, parsedDepth));
            }
        }

        const showHidden = showHiddenQuery === undefined
            ? true
            : ['1', 'true', 'yes', 'on'].includes(String(showHiddenQuery).toLowerCase());

        const stats = await fsPromises.stat(targetPath);
        if (!stats.isDirectory()) {
            return res.status(400).json({ error: 'Path must be a directory' });
        }

        const files = await getFileTree(targetPath, maxDepth, 0, showHidden, false, {
            projectRoot,
            includeInternal,
        });
        res.json(files);
    } catch (error) {
        console.error('[ERROR] File tree error:', error.message);
        res.status(error.statusCode || 500).json({ error: error.message });
    }
});

// WebSocket connection handler that routes based on URL path
wss.on('connection', (ws, request) => {
    const url = request.url;
    console.log('[INFO] Client connected to:', url);

    // Parse URL to get pathname without query parameters
    const urlObj = new URL(url, 'http://localhost');
    const pathname = urlObj.pathname;
    if (request.localKernelSession) {
        const sessionToken = request.localKernelSession.token;
        const sessionOrigin = request.headers?.origin || null;
        const onlineAuthTimer = setInterval(() => {
            if (!verifyLocalSessionToken(sessionToken, sessionOrigin)) {
                ws.close(1008, 'online-authorization-required');
            }
        }, 30_000);
        onlineAuthTimer.unref?.();
        ws.once('close', () => clearInterval(onlineAuthTimer));
    }
    ws.authSessionId = request?.user?.sessionId || null;
    if (ws.authSessionId) {
        authSessionDb.touch(ws.authSessionId, {
            ipAddress: request.socket?.remoteAddress || null,
            userAgent: request.headers?.['user-agent'] || null,
        });
    }

    if (pathname === '/ws/local') {
        handleLocalKernelWebSocket(ws, request);
    } else if (pathname === '/shell') {
        handleShellConnection(ws, request);
    } else if (pathname === '/ws') {
        handleChatConnection(ws, request);
    } else if (pathname === '/compute-shell') {
        const nodeId = urlObj.searchParams.get('nodeId') || null;
        handleComputeShellConnection(ws, nodeId);
    } else {
        console.log('[WARN] Unknown WebSocket path:', pathname);
        ws.close();
    }
});

const CHAT_RECONNECT_GRACE_MS = Math.max(
  5_000,
  Number.parseInt(process.env.MEDHELP_CHAT_RECONNECT_GRACE_MS || '30000', 10) || 30_000,
);
const CHAT_RECONNECT_BUFFER_MAX_MESSAGES = 2_000;
const CHAT_RECONNECT_BUFFER_MAX_BYTES = 4 * 1024 * 1024;
const reconnectableChatSessions = new Map();
const interactiveAgentTurnQueues = new AgentTurnQueueRegistry();
const clientOperationDeduper = createClientOperationDeduper();

function findReconnectableChatSession(identity) {
  const ownerKey = typeof identity?.ownerKey === 'string' ? identity.ownerKey.trim() : '';
  const projectKey = typeof identity?.projectKey === 'string' ? identity.projectKey.trim() : '';
  const runtimeId = normalizeRuntimeId(identity?.runtimeId ?? identity?.provider);
  const sessionId = typeof identity?.sessionId === 'string' ? identity.sessionId.trim() : '';
  if (!ownerKey || !runtimeId || !sessionId) return null;

  if (projectKey) {
    const sessionKey = createAgentSessionKey({ ownerKey, projectKey, runtimeId, sessionId });
    const entry = reconnectableChatSessions.get(sessionKey);
    return entry ? { sessionKey, entry } : null;
  }

  // Older clients did not send projectKey on status/abort. Preserve that
  // compatibility only when the composite identity is uniquely resolvable.
  const matches = [];
  for (const [sessionKey, entry] of reconnectableChatSessions.entries()) {
    if (
      entry.identity.ownerKey === ownerKey
      && entry.identity.runtimeId === runtimeId
      && entry.identity.sessionId === sessionId
    ) {
      matches.push({ sessionKey, entry });
    }
  }
  return matches.length === 1 ? matches[0] : null;
}

function resolveOwnedInteractiveSessionIdentity(identity) {
  const runtimeId = normalizeRuntimeId(identity?.runtimeId ?? identity?.provider);
  const sessionId = typeof identity?.sessionId === 'string' ? identity.sessionId.trim() : '';
  const scopedMatches = [...reconnectableChatSessions.values()].filter((entry) => (
    entry.identity.runtimeId === runtimeId
    && entry.identity.sessionId === sessionId
  ));
  if (scopedMatches.length === 0) return identity;

  const ownedMatch = findReconnectableChatSession(identity);
  if (ownedMatch) return ownedMatch.entry.identity;

  const error = new Error('The agent session identity does not match the active owner, project, and runtime.');
  error.code = 'AGENT_SESSION_IDENTITY_MISMATCH';
  error.runtimeId = runtimeId;
  throw error;
}

function isInteractiveSessionActive(identity) {
  if (identity.runtimeId === 'local') {
    return isLocalGPUSessionActive(identity.sessionId);
  }
  try {
    return getAgentRuntimeSessionStatus(identity).isActive;
  } catch {
    return false;
  }
}

function abortInteractiveSession(identity) {
  if (identity.runtimeId === 'local') {
    return Promise.resolve(abortLocalGPUSession(identity.sessionId));
  }
  return abortAgentRuntimeSession(identity);
}

function registerReconnectableChatSession(identity, writer) {
  const normalizedIdentity = createAgentSessionIdentity(identity);
  const sessionKey = createAgentSessionKey(normalizedIdentity);
  const previous = reconnectableChatSessions.get(sessionKey);
  if (previous?.timer) {
    clearTimeout(previous.timer);
  }
  const entry = {
    writer,
    identity: normalizedIdentity,
    settled: false,
    timer: null,
  };
  reconnectableChatSessions.set(sessionKey, entry);

  if (!writer.hasOpenSocket()) {
    scheduleReconnectableSessionCleanup(sessionKey, entry);
  }
  return sessionKey;
}

function scheduleReconnectableSessionCleanup(sessionKey, entry) {
  if (entry.timer) {
    clearTimeout(entry.timer);
  }
  entry.timer = setTimeout(() => {
    const current = reconnectableChatSessions.get(sessionKey);
    if (current !== entry || entry.writer.hasOpenSocket()) {
      return;
    }
    if (!entry.settled && isInteractiveSessionActive(entry.identity)) {
      console.warn('[WARN] Chat session did not reconnect within grace period; aborting', {
        runtimeId: entry.identity.runtimeId,
        projectKey: entry.identity.projectKey,
        sessionId: entry.identity.sessionId,
        graceMs: CHAT_RECONNECT_GRACE_MS,
      });
      abortInteractiveSession(entry.identity).catch(() => {});
    }
    reconnectableChatSessions.delete(sessionKey);
  }, CHAT_RECONNECT_GRACE_MS);
}

function detachReconnectableChatSession(sessionKey, socket) {
  const entry = reconnectableChatSessions.get(sessionKey);
  if (!entry) return;
  if (entry.writer.isAttachedTo(socket)) entry.writer.detach(socket);
  if (entry.writer.hasOpenSocket()) return;
  scheduleReconnectableSessionCleanup(sessionKey, entry);
}

function reattachReconnectableChatSession(identity, socket) {
  const match = findReconnectableChatSession(identity);
  if (!match) {
    return false;
  }
  const { entry } = match;
  entry.writer.attach(socket);
  console.log('[INFO] Reattached chat stream', {
    runtimeId: entry.identity.runtimeId,
    projectKey: entry.identity.projectKey,
    sessionId: entry.identity.sessionId,
  });
  const attachedSessionKeys = [];
  for (const [candidateSessionKey, candidate] of reconnectableChatSessions.entries()) {
    if (candidate.writer !== entry.writer) continue;
    if (candidate.timer) {
      clearTimeout(candidate.timer);
      candidate.timer = null;
    }
    if (candidate.settled) {
      reconnectableChatSessions.delete(candidateSessionKey);
    } else {
      attachedSessionKeys.push(candidateSessionKey);
    }
  }
  return attachedSessionKeys;
}

function settleReconnectableChatSessions(writer) {
  for (const [sessionKey, entry] of reconnectableChatSessions.entries()) {
    if (entry.writer !== writer) {
      continue;
    }
    entry.settled = true;
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    if (writer.hasOpenSocket()) {
      reconnectableChatSessions.delete(sessionKey);
    } else {
      scheduleReconnectableSessionCleanup(sessionKey, entry);
    }
  }
}

function getPublicActiveSessions(ownerKey) {
  const activeByRuntime = {
    ...getActiveAgentRuntimeSessions(),
    local: getActiveLocalGPUSessions(),
  };

  return Object.fromEntries(Object.entries(activeByRuntime).map(([runtimeId, sessionIds]) => [
    runtimeId,
    sessionIds.flatMap((sessionId) => {
      const matches = [];
      for (const [sessionKey, entry] of reconnectableChatSessions.entries()) {
        if (
          entry.identity.ownerKey === ownerKey
          && entry.identity.runtimeId === runtimeId
          && entry.identity.sessionId === sessionId
        ) {
          matches.push({
            id: sessionId,
            sessionId,
            sessionKey,
            runtimeId,
            provider: runtimeId,
            projectKey: entry.identity.projectKey,
            startTime: runtimeId === 'local'
              ? getLocalGPUSessionStartTime(sessionId)
                            : getAgentRuntimeSessionStatus(entry.identity).startTime,
          });
        }
      }
      return matches.length > 0 ? matches : [{
        id: sessionId,
        sessionId,
        runtimeId,
        provider: runtimeId,
        projectKey: null,
        startTime: runtimeId === 'local'
          ? getLocalGPUSessionStartTime(sessionId)
          : getAgentRuntimeSessionStatus(runtimeId, sessionId).startTime,
      }];
    }),
  ]));
}

/**
 * WebSocket Writer - Wrapper for WebSocket to match SSEStreamWriter interface
 */
class WebSocketWriter {
  constructor(ws, telemetryContext = null) {
    this.ws = ws;
    this.sessionId = null;
    this.isWebSocketWriter = true;  // Marker for transport detection
    this.telemetryContext = telemetryContext;
    this.projectPath = null;
    this.pendingPayloads = [];
    this.pendingPayloadBytes = 0;
  }

  send(data) {
    const payload = JSON.stringify(data);
    if (this.ws?.readyState === 1) { // WebSocket.OPEN
      try {
        this.ws.send(payload);
      } catch {
        this.bufferPayload(payload);
      }
      trackAgentResponseTelemetry(data, this.telemetryContext);
      return;
    }
    this.bufferPayload(payload);
    trackAgentResponseTelemetry(data, this.telemetryContext);
  }

  bufferPayload(payload) {
    const bytes = Buffer.byteLength(payload);
    this.pendingPayloads.push(payload);
    this.pendingPayloadBytes += bytes;
    while (
      this.pendingPayloads.length > CHAT_RECONNECT_BUFFER_MAX_MESSAGES
      || this.pendingPayloadBytes > CHAT_RECONNECT_BUFFER_MAX_BYTES
    ) {
      const removed = this.pendingPayloads.shift();
      this.pendingPayloadBytes -= removed ? Buffer.byteLength(removed) : 0;
    }
  }

  attach(ws) {
    this.ws = ws;
    if (ws.readyState !== 1 || this.pendingPayloads.length === 0) {
      return;
    }
    const pending = this.pendingPayloads;
    this.pendingPayloads = [];
    this.pendingPayloadBytes = 0;
    for (let index = 0; index < pending.length; index += 1) {
      try {
        ws.send(pending[index]);
      } catch {
        const unsent = pending.slice(index);
        this.pendingPayloads.unshift(...unsent);
        this.pendingPayloadBytes += unsent.reduce((total, payload) => total + Buffer.byteLength(payload), 0);
        break;
      }
    }
  }

  detach(ws) {
    if (this.ws === ws) {
      this.ws = null;
    }
  }

  hasOpenSocket() {
    return this.ws?.readyState === 1;
  }

  isAttachedTo(ws) {
    return this.ws === ws;
  }

  setSessionId(sessionId) {
    this.sessionId = sessionId;
  }

  setProjectPath(projectPath) {
    this.projectPath = projectPath;
  }

  getSessionId() {
    return this.sessionId;
  }

  getProjectPath() {
    return this.projectPath;
  }
}

function createScopedChatWriter(baseWriter, { ownerKey, projectKey, runtimeId, onSessionKey }) {
  const normalizedRuntimeId = normalizeRuntimeId(runtimeId);
  const normalizedProjectKey = typeof projectKey === 'string' ? projectKey.trim() : '';
  createAgentSessionIdentity({
    ownerKey,
    projectKey: normalizedProjectKey,
    runtimeId: normalizedRuntimeId,
    sessionId: '__scope-validation__',
  });

  let scopedSessionId = null;
  let scopedProjectPath = null;
  let scopedWriter;
  scopedWriter = new Proxy(baseWriter, {
    get(target, property, receiver) {
      if (property === 'send') {
        return (data) => {
          const payload = data && typeof data === 'object' && !Array.isArray(data)
            ? {
                ...data,
                runtimeId: data.runtimeId || normalizedRuntimeId,
                provider: data.provider || normalizedRuntimeId,
                projectKey: data.projectKey || normalizedProjectKey,
                ...(scopedSessionId && !data.sessionId ? { sessionId: scopedSessionId } : {}),
              }
            : data;
          return target.send.call(target, payload);
        };
      }
      if (property === 'setSessionId') {
        return (sessionId) => {
          const normalizedSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
          if (!normalizedSessionId) return;
          scopedSessionId = normalizedSessionId;
          const identity = createAgentSessionIdentity({
            ownerKey,
            projectKey: normalizedProjectKey,
            runtimeId: normalizedRuntimeId,
            sessionId: normalizedSessionId,
          });
          const sessionKey = registerReconnectableChatSession(identity, scopedWriter);
          onSessionKey?.(sessionKey, identity);
        };
      }
      if (property === 'getSessionId') {
        return () => scopedSessionId;
      }
      if (property === 'setProjectPath') {
        return (projectPath) => {
          scopedProjectPath = projectPath;
        };
      }
      if (property === 'getProjectPath') {
        return () => scopedProjectPath;
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
    set(target, property, value, receiver) {
      return Reflect.set(target, property, value, receiver);
    },
  });
  return scopedWriter;
}

function createSessionExecutionMemoryBridge({ provider, projectPath, sessionId, currentObjective, taskContext, onPipelineStateChanged }) {
    const tracker = createExecutionMemoryTracker({
        scope: 'session',
        projectPath,
        provider,
        sessionId,
        currentObjective,
        currentTaskId: taskContext?.id != null ? String(taskContext.id) : undefined,
        currentTaskTitle: taskContext?.title || undefined,
        stage: taskContext?.stage || undefined,
        onPipelineStateChanged,
    });

    return {
        tracker,
        wrap(baseWriter) {
            return wrapWriterWithExecutionMemory(baseWriter, tracker);
        },
    };
}

const CONSULTATION_CLAUDE_TOOL_SETTINGS = Object.freeze({
    allowedTools: ['Read', 'Glob', 'Grep'],
    disallowedTools: [
        'Bash',
        'Edit',
        'Write',
        'NotebookEdit',
        'Task',
        'TodoWrite',
        'WebFetch',
        'WebSearch',
        'exit_plan_mode',
    ],
    skipPermissions: false,
});

function isConsultationSession(options = {}) {
    return options?.sessionMode === 'consultation';
}

function enforceConsultationPrompt(command, options = {}) {
    if (!isConsultationSession(options)) {
        return command;
    }

    return [
        '[System constraint: consultation mode]',
        'This is an explanation-only side conversation. Do not create, edit, move, or delete files. Do not run shell commands, update tasks, change project state, or start a research workflow. Use only read-only inspection when it is genuinely required to explain the supplied text. Answer directly and clearly.',
        String(command || ''),
    ].join('\n\n');
}

function enforceConsultationOptions(provider, options = {}) {
    if (!isConsultationSession(options)) {
        return options;
    }

    if (provider === 'claude') {
        return {
            ...options,
            permissionMode: 'plan',
            toolsSettings: CONSULTATION_CLAUDE_TOOL_SETTINGS,
        };
    }
    if (provider === 'codex') {
        return {
            ...options,
            permissionMode: 'readOnly',
        };
    }
    return options;
}

function isResearchBriefControlPath(filePath) {
    const normalized = String(filePath || '').trim().replace(/\\/g, '/').toLowerCase();
    return normalized === '.pipeline/docs/research_brief.json';
}

function createExecutionMemorySyncBroadcaster(wss, projectName, projectPath) {
    if (!wss || !projectName) {
        return null;
    }

    return async (syncResult) => {
        let taskPlanSync = null;
        if (projectPath && syncResult?.type === 'pipeline_control_file_touched' && isResearchBriefControlPath(syncResult?.path)) {
            try {
                taskPlanSync = await syncTasksWithResearchBrief(projectPath, { mode: 'merge' });
            } catch (error) {
                console.warn('[ExecutionMemory] Failed to reconcile tasks after research brief update:', error?.message || error);
            }
        }
        broadcastTaskMasterProjectUpdate(wss, projectName, {
            status: 'execution-memory-synced',
            stage: syncResult?.stage || null,
            taskPlanSync: taskPlanSync?.synced ? taskPlanSync.reason || 'merge' : null,
        });
        broadcastTaskMasterTasksUpdate(wss, projectName);
    };
}

async function finalizeInteractiveTaskRun({
    executionMemoryBridge,
    projectPath,
    projectName,
    provider,
    sessionId,
    taskContext,
    wss,
}) {
    if (!executionMemoryBridge?.tracker || !projectPath || !taskContext?.id) {
        return;
    }

    try {
        const tracker = executionMemoryBridge.tracker;
        await tracker.refreshSummaries();
        const scopeRef = tracker.getScopeRef ? tracker.getScopeRef() : {
            scope: 'session',
            projectPath,
            provider,
            sessionId: sessionId || null,
            currentTaskId: String(taskContext.id),
            currentTaskTitle: taskContext.title || null,
            stage: taskContext.stage || null,
        };
        const snapshot = await readExecutionMemorySnapshot(scopeRef, { ledgerLimit: 400 });
        await syncExecutionMemoryToTasks(scopeRef, { snapshot });
    } catch (error) {
        console.warn('[ExecutionMemory] Final interactive task reconciliation failed:', error?.message || error);
    } finally {
        if (wss && projectName) {
            broadcastTaskMasterTasksUpdate(wss, projectName);
        }
    }
}

function enqueueConversationTelemetry(event, context = {}) {
    if (context.telemetryEnabled === false) {
        return;
    }
    enqueueTelemetryEvent({
        source: 'chat-websocket',
        ...context,
        ...event,
        receivedAt: new Date().toISOString(),
    });
}

function hasAgentResponseContent(payload) {
    if (!payload || typeof payload !== 'object') {
        return false;
    }

    if (payload.type === 'claude-response') {
        const data = payload.data;
        if (!data || typeof data !== 'object') {
            return false;
        }

        if (typeof data.content === 'string' && data.content.trim()) {
            return true;
        }

        if (Array.isArray(data.content)) {
            return data.content.some((part) => part?.type === 'text' && typeof part?.text === 'string' && part.text.trim());
        }

        return false;
    }

    if (payload.type === 'codex-response') {
        const codexData = payload.data;
        if (!codexData || typeof codexData !== 'object') {
            return false;
        }
        if (codexData.type === 'item' && codexData.itemType === 'agent_message') {
            const content = codexData.message?.content;
            return typeof content === 'string' && Boolean(content.trim());
        }
    }

    return false;
}

function trackAgentResponseTelemetry(payload, context = {}) {
    if (context.telemetryEnabled === false) {
        return;
    }
    if (context.provider === 'claude' && payload?.type === 'claude-response') {
        const streamData = payload.data;
        const sessionKey = `${context.provider}:${payload.sessionId || 'pending'}`;

        if (streamData?.type === 'content_block_delta' && typeof streamData?.delta?.text === 'string') {
            trackAgentResponseTelemetry.streamBuffers.set(sessionKey, true);
            return;
        }

        if (streamData?.type === 'content_block_stop') {
            const hasContent = trackAgentResponseTelemetry.streamBuffers.get(sessionKey);
            if (hasContent) {
                enqueueConversationTelemetry(
                    {
                        name: 'agent_dialogue_meta',
                        direction: 'agent_to_user',
                        provider: context.provider || 'unknown',
                        sessionId: payload.sessionId || context.sessionId || null,
                        transportType: payload.type || 'unknown',
                    },
                    context,
                );
            }
            trackAgentResponseTelemetry.streamBuffers.delete(sessionKey);
            return;
        }
    }

    if (!hasAgentResponseContent(payload)) {
        return;
    }

    enqueueConversationTelemetry(
        {
            name: 'agent_dialogue_meta',
            direction: 'agent_to_user',
            provider: context.provider || 'unknown',
            sessionId: payload.sessionId || context.sessionId || null,
            transportType: payload.type || 'unknown',
        },
        context,
    );
}
trackAgentResponseTelemetry.streamBuffers = new Map();

// Handle chat WebSocket connections
function handleChatConnection(ws, request) {
    console.log('[INFO] Chat WebSocket connected');

    const user = request?.user || {};
    const userId = user.userId || user.id || null;
    const localKernelSession = request?.localKernelSession || null;
    const cloudUserId = user.cloudUserId || localKernelSession?.userId || null;
    const agentUserId = resolveAgentUserId(user, localKernelSession);
    const chatOwnerKey = String(cloudUserId ?? userId ?? agentUserId ?? 'local');
    ws.authUserId = cloudUserId ?? userId;

    // Add to connected clients for project updates
    connectedClients.add(ws);

    const telemetryContext = {
        userId: userId,
        username: user.username || null,
        clientType: 'websocket',
        telemetryEnabled: true,
    };

    const buildAgentSessionContext = () => buildManagedAgentSessionContext({
        userId,
        localKernelSession,
    });
    const canUseAutomaticProjectMemory = async () => {
        try {
            const access = localKernelSession
                ? await authorizeLocalSessionCapability(localKernelSession, 'memory.project_summary')
                : authorizeEntitlement(userId, 'memory.project_summary');
            return access?.allowed === true;
        } catch (error) {
            console.warn('[project-memory] Failed to resolve memory entitlement:', error.message);
            return false;
        }
    };
    const canUseLongTermUserMemory = async () => {
        try {
            const access = localKernelSession
                ? await authorizeLocalSessionCapability(localKernelSession, 'memory.persistent')
                : authorizeEntitlement(userId, 'memory.persistent');
            return access?.allowed === true;
        } catch (error) {
            console.warn('[user-memory] Failed to resolve memory entitlement:', error.message);
            return false;
        }
    };
    console.log('[database-api] WebSocket agent credential state:', localKernelSession
        ? {
            mode: 'local-kernel',
            cloudUserId: cloudUserId == null ? null : String(cloudUserId),
            credentialSource: 'cloud-account-per-agent-turn',
        }
        : {
            mode: 'cloud-agent',
            userId: userId == null ? null : String(userId),
            tokenConfigured: getDatabaseApiCredentialForUser(userId).tokenConfigured,
            baseUrl: getDatabaseApiCredentialForUser(userId).baseUrl,
        });

    // Wrap WebSocket with writer for consistent interface with SSEStreamWriter
    const writer = new WebSocketWriter(ws, telemetryContext);
    // Every tracked alias is a full owner/project/runtime/session key. A
    // temporary id can therefore be promoted without touching another turn.
    const wsSessionKeys = new Set();
    const createTurnWriter = (runtimeId, projectKey) => createScopedChatWriter(writer, {
        ownerKey: chatOwnerKey,
        projectKey,
        runtimeId,
        onSessionKey: (sessionKey) => wsSessionKeys.add(sessionKey),
    });

    const dispatchQueuedAgentTurn = (payload) => {
        setImmediate(() => {
            ws.emit('message', Buffer.from(JSON.stringify(payload)));
        });
    };

    ws.on('message', async (message) => {
        let messageTurnQueueState = null;
        let messageTurnResolvedSessionId = null;
        try {
            const messageReceivedAtMs = Date.now();
            const data = JSON.parse(message);
            console.log(`[DEBUG] Received WebSocket message: ${data.type}`);

            const operationDecision = clientOperationDeduper.accept(chatOwnerKey, data);
            if (!operationDecision.accepted) {
                console.warn('[WARN] Ignoring duplicate WebSocket client operation', {
                    type: data.type,
                    clientOperationId: operationDecision.operationId,
                    ownerKey: chatOwnerKey,
                });
                writer.send({
                    type: 'client-operation-duplicate',
                    operationType: data.type,
                    clientOperationId: operationDecision.operationId,
                });
                return;
            }

            const commandRuntimeId = data.type === 'agent-command'
                ? normalizeRuntimeId(data.runtimeId ?? data.provider)
                : data.type === 'claude-command'
                ? 'claude'
                : data.type === 'codex-command'
                    ? 'codex'
                    : null;
            if (commandRuntimeId && commandRuntimeId !== 'pi') {
                sendRemovedAgentProviderError(
                    writer,
                    commandRuntimeId,
                    data.options?.sessionId || data.sessionId || null,
                );
                return;
            }
            const queuedProvider = commandRuntimeId;
            if (queuedProvider) {
                const existingQueueState = interactiveAgentTurnQueues.findFromPayload(
                    chatOwnerKey,
                    queuedProvider,
                    data,
                );
                if (existingQueueState?.running && data.queueReplay !== true) {
                    writer.send({
                        type: `${queuedProvider}-error`,
                        error: 'This session is already processing. Add the message to the queue instead.',
                        errorType: 'CONCURRENT_SESSION',
                        isRetryable: true,
                        sessionId: data.options?.sessionId || data.sessionId || null,
                    });
                    return;
                }
                messageTurnQueueState = interactiveAgentTurnQueues.begin({
                    ownerKey: chatOwnerKey,
                    runtimeId: queuedProvider,
                    projectKey: data.projectKey || data.options?.projectKey || data.options?.projectName,
                    payload: data,
                    writer,
                    dispatch: dispatchQueuedAgentTurn,
                });
            }
            
            if (data.type === 'telemetry-settings') {
                const enabled = data.enabled !== false;
                writer.telemetryContext = {
                    ...(writer.telemetryContext || telemetryContext),
                    telemetryEnabled: enabled,
                };
            } else if (data.type === 'agent-turn-steer') {
                const steerProvider = data.provider;
                const steerSessionId = typeof data.sessionId === 'string' ? data.sessionId.trim() : '';
                const rawSteerCommand = typeof data.item?.command === 'string' ? data.item.command.trim() : '';
                const steerCommand = markVisibleUserContent(rawSteerCommand, data.item?.content);
                if (!steerProvider || !steerSessionId || !steerCommand) {
                    writer.send({
                        type: 'agent-turn-steer-error',
                        provider: steerProvider,
                        sessionId: steerSessionId || null,
                        item: data.item || null,
                        error: 'Invalid immediate-push message.',
                    });
                } else {
                    try {
                        const steerIdentity = resolveOwnedInteractiveSessionIdentity({
                            ownerKey: chatOwnerKey,
                            projectKey: data.projectKey || data.options?.projectKey || null,
                            runtimeId: steerProvider,
                            sessionId: steerSessionId,
                        });
                        const result = await steerAgentRuntimeSession(steerIdentity, steerCommand);
                        if (!result?.success) {
                            throw new Error(result?.error || 'The active agent turn is no longer available.');
                        }
                        writer.send({
                            type: 'agent-turn-steered',
                            provider: steerProvider,
                            sessionId: result.sessionId || steerSessionId,
                            pending: result.pending === true,
                            item: {
                                id: data.item?.id,
                                content: data.item?.content,
                                attachments: Array.isArray(data.item?.attachments) ? data.item.attachments : [],
                                createdAt: Number.isFinite(data.item?.createdAt) ? data.item.createdAt : Date.now(),
                            },
                        });
                    } catch (error) {
                        writer.send({
                            type: 'agent-turn-steer-error',
                            provider: steerProvider,
                            sessionId: steerSessionId,
                            item: data.item || null,
                            error: error instanceof Error ? error.message : 'Failed to push the message to the active turn.',
                        });
                    }
                }
            } else if (data.type === 'agent-turn-enqueue') {
                interactiveAgentTurnQueues.enqueue({
                    ownerKey: chatOwnerKey,
                    runtimeId: data.runtimeId || data.provider,
                    projectKey: data.projectKey,
                    sessionId: data.sessionId,
                    item: data.item,
                    writer,
                    dispatch: dispatchQueuedAgentTurn,
                });
            } else if (data.type === 'agent-turn-update') {
                interactiveAgentTurnQueues.update({
                    ownerKey: chatOwnerKey,
                    runtimeId: data.runtimeId || data.provider,
                    projectKey: data.projectKey,
                    sessionId: data.sessionId,
                    itemId: data.itemId,
                    content: data.content,
                });
            } else if (data.type === 'agent-turn-remove') {
                interactiveAgentTurnQueues.remove({
                    ownerKey: chatOwnerKey,
                    runtimeId: data.runtimeId || data.provider,
                    projectKey: data.projectKey,
                    sessionId: data.sessionId,
                    itemId: data.itemId,
                });
            } else if (data.type === 'agent-turn-reorder') {
                interactiveAgentTurnQueues.reorder({
                    ownerKey: chatOwnerKey,
                    runtimeId: data.runtimeId || data.provider,
                    projectKey: data.projectKey,
                    sessionId: data.sessionId,
                    itemIds: data.itemIds,
                });
            } else if (data.type === 'agent-turn-clear') {
                interactiveAgentTurnQueues.clear({
                    ownerKey: chatOwnerKey,
                    runtimeId: data.runtimeId || data.provider,
                    projectKey: data.projectKey,
                    sessionId: data.sessionId,
                });
            } else if (data.type === 'agent-turn-queue-status') {
                interactiveAgentTurnQueues.snapshot({
                    ownerKey: chatOwnerKey,
                    runtimeId: data.runtimeId || data.provider,
                    projectKey: data.projectKey,
                    sessionId: data.sessionId,
                    writer,
                });
            } else if (data.type === 'claude-command' || (data.type === 'agent-command' && commandRuntimeId === 'claude')) {
                const sessionId = data.options?.sessionId || data.sessionId;
                const clientSessionId = data.options?.clientSessionId || data.clientSessionId || null;
                const latencyTracker = createAgentTurnLatencyTracker({
                    provider: 'claude',
                    commandType: data.type,
                    writer,
                    sessionId,
                    clientSessionId,
                    receivedAtMs: messageReceivedAtMs,
                });
                latencyTracker.mark('message_received', { timestampMs: messageReceivedAtMs });
                const claudeAccess = localKernelSession
                    ? await authorizeLocalSessionCapability(localKernelSession, 'agent.claude')
                    : authorizeEntitlement(userId, 'agent.claude');
                if (!claudeAccess.allowed) {
                    writer.send({
                        type: 'claude-error',
                        error: claudeAccess.code === 'CAPABILITY_DENIED'
                            ? 'Claude is available on the Pro plan. Free accounts can use Pi Agent.'
                            : claudeAccess.reason,
                        errorType: 'plan_restricted',
                        code: claudeAccess.code,
                        requiredPlan: 'pro',
                        currentPlan: claudeAccess.plan || 'free',
                        isRetryable: false,
                        sessionId: sessionId || clientSessionId || null,
                    });
                    interactiveAgentTurnQueues.complete(
                        messageTurnQueueState,
                        sessionId || clientSessionId || null,
                    );
                    return;
                }
                console.log('[DEBUG] User message:', data.command || '[Continue/Resume]');
                console.log('📁 Project:', data.options?.projectPath || 'Unknown');
                console.log('🔄 Session:', data.options?.sessionId ? 'Resume' : 'New');
                const commandTelemetryEnabled = data.options?.telemetryEnabled !== false;
                enqueueConversationTelemetry(
                    {
                        name: 'agent_dialogue_meta',
                        direction: 'user_to_agent',
                        provider: 'claude',
                        sessionId: data.options?.sessionId || data.sessionId || null,
                        projectPath: data.options?.projectPath || data.options?.cwd || null,
                        transportType: data.type,
                    },
                    { ...telemetryContext, telemetryEnabled: commandTelemetryEnabled },
                );
                writer.telemetryContext = { ...telemetryContext, provider: 'claude', telemetryEnabled: commandTelemetryEnabled };

                // Use Claude Agents SDK
                const projectPath = data.options?.projectPath || data.options?.cwd || null;
                const projectName = data.options?.projectName || null;
                const projectKey = data.projectKey || data.options?.projectKey || projectName || projectPath;
                const turnWriter = createTurnWriter('claude', projectKey);
                const automaticProjectMemoryEnabled = Boolean(projectPath) && await canUseAutomaticProjectMemory();
                const { env: runtimeEnv, userPreferenceContext, userMemoryContext } = await buildAgentSessionContext();
                const userMemoryAccessEnabled = await canUseLongTermUserMemory();
                const activeUserMemoryContext = userMemoryAccessEnabled
                    ? userMemoryContext
                    : { enabled: false, autoCaptureEnabled: false, memories: [] };
                const effectiveUserMemory = buildUserMemoryContext(agentUserId, { memoryContext: activeUserMemoryContext });
                const automaticUserMemoryEnabled = effectiveUserMemory.autoCaptureEnabled;
                const executionMemorySessionId = sessionId || (
                    clientSessionId && String(clientSessionId).startsWith('new-session-')
                        ? clientSessionId
                        : null
                );
                const executionMemoryBridge = createSessionExecutionMemoryBridge({
                    provider: 'claude',
                    projectPath,
                    sessionId: executionMemorySessionId,
                    currentObjective: data.command || null,
                    taskContext: data.options?.taskContext || null,
                    onPipelineStateChanged: createExecutionMemorySyncBroadcaster(wss, projectName, projectPath),
                });
                const executionMemoryWriter = executionMemoryBridge.wrap(turnWriter);
                const projectMemoryTurn = automaticProjectMemoryEnabled || automaticUserMemoryEnabled
                    ? createAssistantReplyCollector(executionMemoryWriter)
                    : null;
                const runtimeWriter = projectMemoryTurn?.writer || executionMemoryWriter;
                runtimeWriter.setProjectPath(projectPath);
                if (!sessionId && clientSessionId && String(clientSessionId).startsWith('new-session-')) {
                    // Allow frontend to receive/route early streaming output before Claude provides a real session_id.
                    // This does NOT represent a resumable provider session.
                    runtimeWriter.setSessionId(clientSessionId);
                }
                if (sessionId) {
                    runtimeWriter.setSessionId(sessionId);
                }

                const markedUserCommand = markVisibleUserContent(data.command, data.visibleUserContent);
                const userMemoryAwareCommand = prependUserMemoryToPrompt(markedUserCommand, agentUserId, {
                    memoryContext: activeUserMemoryContext,
                    fallbackCommand: 'Continue from the latest confirmed execution state.',
                });
                const memoryAwareCommand = automaticProjectMemoryEnabled
                    ? await prependProjectMemoryToPrompt(userMemoryAwareCommand, projectPath, {
                        fallbackCommand: 'Continue from the latest confirmed execution state.',
                    })
                    : userMemoryAwareCommand;
                const preparedPrompt = await prepareResearchAwarePromptPrefix(
                    {
                        scope: 'session',
                        projectPath,
                        provider: 'claude',
                        sessionId: executionMemorySessionId,
                        stage: data.options?.taskContext?.stage || null,
                    },
                    memoryAwareCommand,
                    {
                        fallbackCommand: 'Continue from the latest confirmed execution state.',
                        taskContext: data.options?.taskContext || null,
                        incrementalExecutionMemory: true,
                    },
                );

                const onLifecycleEvent = (event = {}) => {
                    if (event.sessionId) {
                        messageTurnResolvedSessionId = event.sessionId;
                        interactiveAgentTurnQueues.resolveSession(messageTurnQueueState, event.sessionId);
                    }
                    latencyTracker.setSessionId(event.sessionId);
                    latencyTracker.mark(event.phase, event.phase === 'preprocessing_completed'
                        ? {
                            ...event,
                            memoryMode: preparedPrompt.executionMemory.mode,
                            memoryChars: preparedPrompt.executionMemory.text.length,
                        }
                        : event);
                    if (event.phase === 'turn_started') {
                        commitExecutionMemoryPromptCheckpoint(preparedPrompt.executionMemory.checkpoint, {
                            sessionIds: [executionMemorySessionId, event.sessionId],
                        });
                    }
                };
                console.log('[database-api] Claude runtime env state:', getAgentRuntimeEnvState(runtimeEnv));
                executeAgentTurn({
                    identity: {
                        ownerKey: chatOwnerKey,
                        projectKey,
                        runtimeId: 'claude',
                        sessionId: sessionId || clientSessionId || undefined,
                    },
                    runtimeId: 'claude',
                    command: data.command || '',
                    options: {
                        ...enforceConsultationOptions('claude', data.options),
                        clientSessionId,
                        env: runtimeEnv,
                        userId: agentUserId,
                        authSessionId: ws.authSessionId || null,
                        userPreferenceContext,
                        onLifecycleEvent,
                    },
                    modelSelection: {
                        modelProviderId: data.options?.modelProviderId || 'anthropic',
                        modelId: data.options?.model || null,
                        catalogRevision: data.options?.catalogRevision ?? null,
                    },
                    clientOperationId: data.clientOperationId || data.options?.clientOperationId || null,
                }, runtimeWriter, {
                    prepare: () => ({ command: preparedPrompt.prompt }),
                    completeQueue: ({ identity: resolvedIdentity }) => {
                        interactiveAgentTurnQueues.complete(
                            messageTurnQueueState,
                            messageTurnResolvedSessionId
                                || resolvedIdentity.sessionId
                                || runtimeWriter.getSessionId?.(),
                        );
                    },
                    settleReconnect: () => {
                        settleReconnectableChatSessions(turnWriter);
                    },
                    finalize: async ({ outcome, identity: resolvedIdentity }) => {
                        latencyTracker.mark('completed', { outcome });
                        await finalizeInteractiveTaskRun({
                            executionMemoryBridge,
                            projectPath,
                            projectName,
                            provider: 'claude',
                            sessionId: executionMemorySessionId,
                            taskContext: data.options?.taskContext || null,
                            wss,
                        });
                        const reply = projectMemoryTurn?.getReply() || '';
                        const conversationId = messageTurnResolvedSessionId
                            || resolvedIdentity.sessionId
                            || runtimeWriter.getSessionId?.();
                        if (automaticProjectMemoryEnabled && outcome === 'completed' && !projectMemoryTurn?.hasFailed() && reply) {
                            void enqueueAutomaticProjectMemoryTurn({
                                projectPath,
                                conversationId,
                                actorId: userId,
                                input: data.command,
                                reply,
                                oneShot: createProjectMemoryOneShot({
                                    provider: 'claude',
                                    model: data.options?.model,
                                    userId,
                                }),
                                onUpdated: (result) => broadcastProjectMemoryUpdated(userId, {
                                    projectName,
                                    projectPath,
                                    added: result.added,
                                }),
                            });
                        }
                        if (automaticUserMemoryEnabled && outcome === 'completed' && !projectMemoryTurn?.hasFailed() && reply) {
                            void enqueueAutomaticUserMemoryTurn({
                                ownerId: chatOwnerKey,
                                conversationId,
                                input: data.command,
                                reply,
                                oneShot: createUserMemoryOneShot({
                                    provider: 'claude',
                                    model: data.options?.model,
                                    userId,
                                }),
                                capture: (facts, options) => localKernelSession
                                    ? captureCloudUserLongTermMemory(localKernelSession, facts, options)
                                    : Promise.resolve(captureUserMemoryFacts(agentUserId, facts, options)),
                            });
                        }
                    },
                })
                    .catch(error => {
                        console.error('[ERROR] Claude query error:', error);
                        if (String(error?.code || '').startsWith('AGENT_')) {
                            interactiveAgentTurnQueues.complete(
                                messageTurnQueueState,
                                messageTurnResolvedSessionId || sessionId || clientSessionId || null,
                            );
                            runtimeWriter.send({
                                type: 'claude-error',
                                code: error.code,
                                error: error.message,
                                errorType: error.code === 'AGENT_TURN_ALREADY_ACTIVE'
                                    ? 'CONCURRENT_SESSION'
                                    : 'AGENT_RUNTIME_ERROR',
                                isRetryable: error.code === 'AGENT_TURN_ALREADY_ACTIVE',
                                sessionId: sessionId || clientSessionId || null,
                            });
                        }
                    });
            } else if (data.type === 'codex-command' || (data.type === 'agent-command' && commandRuntimeId === 'codex')) {
                const sessionId = data.options?.sessionId || data.sessionId;
                const clientSessionId = data.options?.clientSessionId || data.clientSessionId || null;
                const latencyTracker = createAgentTurnLatencyTracker({
                    provider: 'codex',
                    commandType: data.type,
                    writer,
                    sessionId,
                    clientSessionId,
                    receivedAtMs: messageReceivedAtMs,
                });
                latencyTracker.mark('message_received', { timestampMs: messageReceivedAtMs });
                const codexAccess = localKernelSession
                    ? await authorizeLocalSessionCapability(localKernelSession, 'agent.codex')
                    : authorizeEntitlement(userId, 'agent.codex');
                if (!codexAccess.allowed) {
                    writer.send({
                        type: 'codex-error',
                        error: codexAccess.code === 'CAPABILITY_DENIED'
                            ? 'Codex is available on the Pro plan. Upgrade your account to use it.'
                            : codexAccess.reason,
                        errorType: 'plan_restricted',
                        code: codexAccess.code,
                        requiredPlan: 'pro',
                        currentPlan: codexAccess.plan || 'free',
                        isRetryable: false,
                        sessionId: data.options?.sessionId || data.sessionId || null,
                    });
                    interactiveAgentTurnQueues.complete(
                        messageTurnQueueState,
                        data.options?.sessionId || data.sessionId || null,
                    );
                    return;
                }
                console.log('[DEBUG] Codex message:', data.command || '[Continue/Resume]');
                console.log('📁 Project:', data.options?.projectPath || data.options?.cwd || 'Unknown');
                console.log('🔄 Session:', data.options?.sessionId ? 'Resume' : 'New');
                console.log('🤖 Model:', data.options?.model || 'default');
                const commandTelemetryEnabled = data.options?.telemetryEnabled !== false;

                enqueueConversationTelemetry(
                    {
                        name: 'agent_dialogue_meta',
                        direction: 'user_to_agent',
                        provider: 'codex',
                        sessionId: sessionId || null,
                        projectPath: data.options?.projectPath || data.options?.cwd || null,
                        transportType: data.type,
                    },
                    { ...telemetryContext, telemetryEnabled: commandTelemetryEnabled },
                );
                writer.telemetryContext = { ...telemetryContext, provider: 'codex', telemetryEnabled: commandTelemetryEnabled };
                const projectPath = data.options?.projectPath || data.options?.cwd || null;
                const projectName = data.options?.projectName || null;
                const projectKey = data.projectKey || data.options?.projectKey || projectName || projectPath;
                const turnWriter = createTurnWriter('codex', projectKey);
                const automaticProjectMemoryEnabled = Boolean(projectPath) && await canUseAutomaticProjectMemory();
                const { env: runtimeEnv, userPreferenceContext, userMemoryContext } = await buildAgentSessionContext();
                const userMemoryAccessEnabled = await canUseLongTermUserMemory();
                const activeUserMemoryContext = userMemoryAccessEnabled
                    ? userMemoryContext
                    : { enabled: false, autoCaptureEnabled: false, memories: [] };
                const effectiveUserMemory = buildUserMemoryContext(agentUserId, { memoryContext: activeUserMemoryContext });
                const automaticUserMemoryEnabled = effectiveUserMemory.autoCaptureEnabled;
                const executionMemorySessionId = sessionId || (
                    clientSessionId && String(clientSessionId).startsWith('new-session-')
                        ? clientSessionId
                        : null
                );
                const executionMemoryBridge = createSessionExecutionMemoryBridge({
                    provider: 'codex',
                    projectPath,
                    sessionId: executionMemorySessionId,
                    currentObjective: data.command || null,
                    taskContext: data.options?.taskContext || null,
                    onPipelineStateChanged: createExecutionMemorySyncBroadcaster(wss, projectName, projectPath),
                });
                const executionMemoryWriter = executionMemoryBridge.wrap(turnWriter);
                const projectMemoryTurn = automaticProjectMemoryEnabled || automaticUserMemoryEnabled
                    ? createAssistantReplyCollector(executionMemoryWriter)
                    : null;
                const runtimeWriter = projectMemoryTurn?.writer || executionMemoryWriter;
                runtimeWriter.setProjectPath(projectPath);
                if (sessionId) {
                    runtimeWriter.setSessionId(sessionId);
                }
                if (!sessionId && clientSessionId && String(clientSessionId).startsWith('new-session-')) {
                    runtimeWriter.setSessionId(clientSessionId);
                }
                const markedUserCommand = markVisibleUserContent(data.command, data.visibleUserContent);
                const consultationCommand = enforceConsultationPrompt(markedUserCommand, data.options);
                const userMemoryAwareCommand = prependUserMemoryToPrompt(consultationCommand, agentUserId, {
                    memoryContext: activeUserMemoryContext,
                    fallbackCommand: 'Continue from the latest confirmed project state.',
                });
                const memoryAwareCommand = automaticProjectMemoryEnabled
                    ? await prependProjectMemoryToPrompt(userMemoryAwareCommand, projectPath, {
                        fallbackCommand: 'Continue from the latest confirmed project state.',
                    })
                    : userMemoryAwareCommand;
                const preparedPrompt = await prepareResearchAwarePromptPrefix(
                    {
                        scope: 'session',
                        projectPath,
                        provider: 'codex',
                        sessionId: executionMemorySessionId,
                        stage: data.options?.taskContext?.stage || null,
                    },
                    memoryAwareCommand,
                    {
                        fallbackCommand: 'Continue from the latest confirmed project state.',
                        taskContext: data.options?.taskContext || null,
                        incrementalExecutionMemory: true,
                    },
                );
                const onLifecycleEvent = (event = {}) => {
                    if (event.sessionId) {
                        messageTurnResolvedSessionId = event.sessionId;
                        interactiveAgentTurnQueues.resolveSession(messageTurnQueueState, event.sessionId);
                    }
                    latencyTracker.setSessionId(event.sessionId);
                    latencyTracker.mark(event.phase, event.phase === 'preprocessing_completed'
                        ? {
                            ...event,
                            memoryMode: preparedPrompt.executionMemory.mode,
                            memoryChars: preparedPrompt.executionMemory.text.length,
                        }
                        : event);
                    if (event.phase === 'turn_started') {
                        commitExecutionMemoryPromptCheckpoint(preparedPrompt.executionMemory.checkpoint, {
                            sessionIds: [executionMemorySessionId, event.sessionId],
                        });
                    }
                };
                console.log('[database-api] Codex runtime env state:', getAgentRuntimeEnvState(runtimeEnv));
                executeAgentTurn({
                    identity: {
                        ownerKey: chatOwnerKey,
                        projectKey,
                        runtimeId: 'codex',
                        sessionId: sessionId || clientSessionId || undefined,
                    },
                    runtimeId: 'codex',
                    command: data.command || '',
                    options: {
                        ...enforceConsultationOptions('codex', data.options),
                        clientSessionId,
                        env: runtimeEnv,
                        userId: agentUserId,
                        authSessionId: ws.authSessionId || null,
                        userPreferenceContext,
                        onLifecycleEvent,
                    },
                    modelSelection: {
                        modelProviderId: data.options?.modelProviderId || 'openai',
                        modelId: data.options?.model || null,
                        catalogRevision: data.options?.catalogRevision ?? null,
                    },
                    clientOperationId: data.clientOperationId || data.options?.clientOperationId || null,
                }, runtimeWriter, {
                    prepare: () => ({ command: preparedPrompt.prompt }),
                    completeQueue: ({ identity: resolvedIdentity }) => {
                        interactiveAgentTurnQueues.complete(
                            messageTurnQueueState,
                            messageTurnResolvedSessionId
                                || resolvedIdentity.sessionId
                                || runtimeWriter.getSessionId?.(),
                        );
                    },
                    settleReconnect: () => {
                        settleReconnectableChatSessions(turnWriter);
                    },
                    finalize: async ({ outcome, identity: resolvedIdentity }) => {
                        latencyTracker.mark('completed', { outcome });
                        await finalizeInteractiveTaskRun({
                            executionMemoryBridge,
                            projectPath,
                            projectName,
                            provider: 'codex',
                            sessionId: executionMemorySessionId,
                            taskContext: data.options?.taskContext || null,
                            wss,
                        });
                        const reply = projectMemoryTurn?.getReply() || '';
                        const conversationId = messageTurnResolvedSessionId
                            || resolvedIdentity.sessionId
                            || runtimeWriter.getSessionId?.();
                        if (automaticProjectMemoryEnabled && outcome === 'completed' && !projectMemoryTurn?.hasFailed() && reply) {
                            void enqueueAutomaticProjectMemoryTurn({
                                projectPath,
                                conversationId,
                                actorId: userId,
                                input: data.command,
                                reply,
                                oneShot: createProjectMemoryOneShot({
                                    provider: 'codex',
                                    model: data.options?.model,
                                    userId,
                                }),
                                onUpdated: (result) => broadcastProjectMemoryUpdated(userId, {
                                    projectName,
                                    projectPath,
                                    added: result.added,
                                }),
                            });
                        }
                        if (automaticUserMemoryEnabled && outcome === 'completed' && !projectMemoryTurn?.hasFailed() && reply) {
                            void enqueueAutomaticUserMemoryTurn({
                                ownerId: chatOwnerKey,
                                conversationId,
                                input: data.command,
                                reply,
                                oneShot: createUserMemoryOneShot({
                                    provider: 'codex',
                                    model: data.options?.model,
                                    userId,
                                }),
                                capture: (facts, options) => localKernelSession
                                    ? captureCloudUserLongTermMemory(localKernelSession, facts, options)
                                    : Promise.resolve(captureUserMemoryFacts(agentUserId, facts, options)),
                            });
                        }
                    },
                })
                    .catch(error => {
                        console.error('[ERROR] Codex query error:', error);
                        if (String(error?.code || '').startsWith('AGENT_')) {
                            interactiveAgentTurnQueues.complete(
                                messageTurnQueueState,
                                messageTurnResolvedSessionId || sessionId || clientSessionId || null,
                            );
                            runtimeWriter.send({
                                type: 'codex-error',
                                code: error.code,
                                error: error.message,
                                errorType: error.code === 'AGENT_TURN_ALREADY_ACTIVE'
                                    ? 'CONCURRENT_SESSION'
                                    : 'AGENT_RUNTIME_ERROR',
                                isRetryable: error.code === 'AGENT_TURN_ALREADY_ACTIVE',
                                sessionId: sessionId || clientSessionId || null,
                            });
                        }
                    });
            } else if (data.type === 'agent-command' && commandRuntimeId === 'pi') {
                const sessionId = data.options?.sessionId || data.sessionId;
                const clientSessionId = data.options?.clientSessionId || data.clientSessionId || null;
                const piAccess = localKernelSession
                    ? await authorizeLocalSessionCapability(localKernelSession, 'agent.pi')
                    : authorizeEntitlement(userId, 'agent.pi');
                if (!piAccess.allowed) {
                    writer.send({
                        type: 'pi-error',
                        error: piAccess.reason,
                        errorType: 'plan_restricted',
                        code: piAccess.code,
                        currentPlan: piAccess.plan || 'free',
                        isRetryable: false,
                        sessionId: sessionId || clientSessionId || null,
                    });
                    interactiveAgentTurnQueues.complete(
                        messageTurnQueueState,
                        sessionId || clientSessionId || null,
                    );
                    return;
                }
                const projectPath = data.options?.projectPath || data.options?.cwd || null;
                const projectName = data.options?.projectName || null;
                const projectKey = data.projectKey || data.options?.projectKey || projectName || projectPath;
                const turnWriter = createTurnWriter('pi', projectKey);
                const { env: runtimeEnv, userPreferenceContext, userMemoryContext } = await buildAgentSessionContext();
                const userMemoryAccessEnabled = await canUseLongTermUserMemory();
                const activeUserMemoryContext = userMemoryAccessEnabled
                    ? userMemoryContext
                    : { enabled: false, autoCaptureEnabled: false, memories: [] };
                const effectiveUserMemory = buildUserMemoryContext(agentUserId, { memoryContext: activeUserMemoryContext });
                const automaticUserMemoryEnabled = effectiveUserMemory.autoCaptureEnabled;
                const executionMemorySessionId = sessionId || (
                    clientSessionId && String(clientSessionId).startsWith('new-session-')
                        ? clientSessionId
                        : null
                );
                const executionMemoryBridge = createSessionExecutionMemoryBridge({
                    provider: 'pi',
                    projectPath,
                    sessionId: executionMemorySessionId,
                    currentObjective: data.command || null,
                    taskContext: data.options?.taskContext || null,
                    onPipelineStateChanged: createExecutionMemorySyncBroadcaster(wss, projectName, projectPath),
                });
                const executionMemoryWriter = executionMemoryBridge.wrap(turnWriter);
                const userMemoryTurn = automaticUserMemoryEnabled
                    ? createAssistantReplyCollector(executionMemoryWriter)
                    : null;
                const runtimeWriter = userMemoryTurn?.writer || executionMemoryWriter;
                runtimeWriter.setProjectPath(projectPath);
                if (sessionId) runtimeWriter.setSessionId(sessionId);
                if (!sessionId && clientSessionId && String(clientSessionId).startsWith('new-session-')) {
                    runtimeWriter.setSessionId(clientSessionId);
                }

                const markedUserCommand = markVisibleUserContent(data.command, data.visibleUserContent);
                const memoryAwareCommand = prependUserMemoryToPrompt(markedUserCommand, agentUserId, {
                    memoryContext: activeUserMemoryContext,
                    fallbackCommand: 'Continue from the latest confirmed project state.',
                });
                const preparedPrompt = await prepareResearchAwarePromptPrefix(
                    {
                        scope: 'session',
                        projectPath,
                        provider: 'pi',
                        sessionId: executionMemorySessionId,
                        stage: data.options?.taskContext?.stage || null,
                    },
                    memoryAwareCommand,
                    {
                        fallbackCommand: 'Continue from the latest confirmed project state.',
                        taskContext: data.options?.taskContext || null,
                        incrementalExecutionMemory: true,
                    },
                );

                const requestedModelSelection = {
                    modelProviderId: data.options?.modelProviderId || process.env.MEDHELP_PI_PROVIDER || null,
                    modelId: data.options?.model || process.env.MEDHELP_PI_MODEL || null,
                    modelApi: data.options?.modelApi || process.env.MEDHELP_PI_MODEL_API || null,
                    catalogRevision: Number.isInteger(data.options?.catalogRevision)
                        ? data.options.catalogRevision
                        : null,
                };
                let piProviderConfig = null;
                if (requestedModelSelection.modelProviderId === 'managed-free') {
                    try {
                        piProviderConfig = await piModelCatalog.resolveProviderConfig({
                            modelId: requestedModelSelection.modelId,
                            catalogRevision: requestedModelSelection.catalogRevision,
                            // A renderer may hold an older revision between refreshes.
                            // Resolve it to the current catalog before the immutable turn
                            // snapshot is created; active turns never consult the catalog again.
                            allowStale: true,
                        });
                        requestedModelSelection.modelId = piProviderConfig.modelId;
                        requestedModelSelection.modelApi = piProviderConfig.modelApi;
                        requestedModelSelection.catalogRevision = piProviderConfig.catalogRevision;
                    } catch (error) {
                        interactiveAgentTurnQueues.complete(
                            messageTurnQueueState,
                            sessionId || clientSessionId || null,
                        );
                        runtimeWriter.send({
                            type: 'pi-error',
                            code: error?.code || 'PI_MANAGED_FREE_UNAVAILABLE',
                            error: error?.message || 'Managed-free provider is unavailable.',
                            errorType: 'AGENT_RUNTIME_ERROR',
                            isRetryable: ['PI_MANAGED_FREE_RATE_LIMITED', 'PI_MANAGED_FREE_REFRESH_TIMEOUT'].includes(error?.code),
                            sessionId: sessionId || clientSessionId || null,
                        });
                        return;
                    }
                }

                const onLifecycleEvent = (event = {}) => {
                    if (event.sessionId) {
                        messageTurnResolvedSessionId = event.sessionId;
                        interactiveAgentTurnQueues.resolveSession(messageTurnQueueState, event.sessionId);
                    }
                    if (event.phase === 'turn_started') {
                        commitExecutionMemoryPromptCheckpoint(preparedPrompt.executionMemory.checkpoint, {
                            sessionIds: [executionMemorySessionId, event.sessionId],
                        });
                    }
                };
                const permissionMode = normalizePiPermissionMode(data.options?.permissionMode);
                console.log('[database-api] Pi runtime env state:', getAgentRuntimeEnvState(runtimeEnv));

                executeAgentTurn({
                    identity: {
                        ownerKey: chatOwnerKey,
                        projectKey,
                        runtimeId: 'pi',
                        sessionId: sessionId || clientSessionId || undefined,
                    },
                    runtimeId: 'pi',
                    command: data.command || '',
                    options: {
                        ...data.options,
                        clientSessionId,
                        env: runtimeEnv,
                        userId: agentUserId,
                        authSessionId: ws.authSessionId || null,
                        userPreferenceContext,
                        userMemoryContext: activeUserMemoryContext,
                        permissionMode,
                        piProviderConfig,
                        authorizeMemory: async (scope) => {
                            const capability = scope === 'project' ? 'memory.project_summary' : 'memory.persistent';
                            const access = localKernelSession
                                ? await authorizeLocalSessionCapability(localKernelSession, capability)
                                : authorizeEntitlement(userId, capability);
                            return access?.allowed === true;
                        },
                        saveUserMemory: localKernelSession ? (content) => saveCloudUserMemory(localKernelSession, content) : undefined,
                        onLifecycleEvent,
                    },
                    modelSelection: requestedModelSelection,
                    clientOperationId: data.clientOperationId || data.options?.clientOperationId || null,
                }, runtimeWriter, {
                    prepare: () => ({ command: preparedPrompt.prompt }),
                    persistSession: async (identity) => {
                        sessionDb.upsertSessionFromSource(
                            identity.sessionId,
                            identity.projectKey,
                            'pi',
                            {
                                ownerKey: identity.ownerKey,
                                runtimeId: 'pi',
                                lastActivity: new Date().toISOString(),
                                modelSelection: {
                                    modelProviderId: requestedModelSelection.modelProviderId,
                                    modelId: requestedModelSelection.modelId,
                                    catalogRevision: requestedModelSelection.catalogRevision,
                                },
                            },
                        );
                    },
                    completeQueue: ({ identity: resolvedIdentity }) => {
                        interactiveAgentTurnQueues.complete(
                            messageTurnQueueState,
                            messageTurnResolvedSessionId
                                || resolvedIdentity.sessionId
                                || runtimeWriter.getSessionId?.(),
                        );
                    },
                    settleReconnect: () => settleReconnectableChatSessions(turnWriter),
                    finalize: async ({ outcome, identity: resolvedIdentity, error }) => {
                        await finalizeInteractiveTaskRun({
                            executionMemoryBridge,
                            projectPath,
                            projectName,
                            provider: 'pi',
                            sessionId: executionMemorySessionId,
                            taskContext: data.options?.taskContext || null,
                            wss,
                        });
                        try {
                            await syncPiSessionIndex(resolvedIdentity, {
                                sessionDb,
                                modelSelection: {
                                    modelProviderId: requestedModelSelection.modelProviderId,
                                    modelId: requestedModelSelection.modelId,
                                    catalogRevision: requestedModelSelection.catalogRevision,
                                },
                            });
                        } catch (indexError) {
                            console.warn('[Pi] Failed to synchronize session title/count:', indexError?.message);
                        }
                        if (outcome === 'completed') {
                            runtimeWriter.send({
                                type: 'pi-complete',
                                sessionId: resolvedIdentity.sessionId,
                            });
                        } else {
                            runtimeWriter.send({
                                type: 'pi-error',
                                code: error?.code || 'PI_RUNTIME_ERROR',
                                error: error?.message || 'Pi Runtime failed.',
                                errorType: 'AGENT_RUNTIME_ERROR',
                                isRetryable: error?.code === 'AGENT_TURN_ALREADY_ACTIVE',
                                sessionId: resolvedIdentity.sessionId,
                            });
                        }
                        try {
                            await broadcastProjectsUpdatedForUser(agentUserId, {
                                changeType: 'pi-session-sync',
                                projectName: resolvedIdentity.projectKey,
                                watchProvider: 'pi',
                            });
                        } catch (broadcastError) {
                            console.warn('[Pi] Failed to refresh the project session list:', broadcastError?.message);
                        }
                        const reply = userMemoryTurn?.getReply() || '';
                        if (automaticUserMemoryEnabled && outcome === 'completed' && !userMemoryTurn?.hasFailed() && reply) {
                            void enqueueAutomaticUserMemoryTurn({
                                ownerId: chatOwnerKey,
                                conversationId: messageTurnResolvedSessionId || resolvedIdentity.sessionId,
                                input: data.command,
                                reply,
                                oneShot: createUserMemoryOneShot({
                                    provider: 'pi',
                                    model: requestedModelSelection.modelId,
                                    userId,
                                }),
                                capture: (facts, options) => localKernelSession
                                    ? captureCloudUserLongTermMemory(localKernelSession, facts, options)
                                    : Promise.resolve(captureUserMemoryFacts(agentUserId, facts, options)),
                            });
                        }
                    },
                }).catch(error => {
                    console.error('[ERROR] Pi query error:', error);
                });
            } else if (data.type === 'agent-command') {
                const error = new Error(`Runtime "${commandRuntimeId || data.runtimeId || data.provider || 'unknown'}" does not have an interactive command adapter.`);
                error.code = commandRuntimeId ? 'AGENT_RUNTIME_CAPABILITY_UNSUPPORTED' : 'AGENT_RUNTIME_NOT_FOUND';
                error.runtimeId = commandRuntimeId;
                throw error;
            } else if (data.type === 'local-command') {
                sendRemovedAgentProviderError(writer, 'local', data.options?.sessionId || data.sessionId || null);
            } else if (data.type === 'abort-session') {
                console.log('[DEBUG] Abort session request:', data.sessionId);
                const runtimeId = normalizeRuntimeId(data.runtimeId ?? data.provider);
                const projectKey = data.projectKey || null;
                let success = false;
                try {
                    const identity = resolveOwnedInteractiveSessionIdentity({
                        ownerKey: chatOwnerKey,
                        projectKey,
                        runtimeId,
                        sessionId: data.sessionId,
                    });
                    success = await abortInteractiveSession(identity);
                } catch (error) {
                    writer.send({
                        ...createAgentRuntimeErrorPayload(error, runtimeId),
                        projectKey,
                        sessionId: data.sessionId,
                    });
                    return;
                }

                writer.send({
                    type: 'session-aborted',
                    sessionId: data.sessionId,
                    runtimeId,
                    provider: runtimeId,
                    projectKey,
                    success
                });
            } else if (data.type === 'agent-permission-response') {
                const runtimeId = normalizeRuntimeId(data.runtimeId ?? data.provider);
                if (runtimeId === 'pi' && data.requestId) {
                    piRuntime.native.resolveToolApproval(data.requestId, {
                        allow: Boolean(data.allow),
                        updatedInput: data.updatedInput,
                        message: data.message,
                        rememberEntry: data.rememberEntry,
                    }, {
                        ownerKey: chatOwnerKey,
                    });
                }
            } else if (data.type === 'check-session-status') {
                // Check if a specific session is currently processing
                const runtimeId = normalizeRuntimeId(data.runtimeId ?? data.provider);
                const projectKey = data.projectKey || null;
                const sessionId = data.sessionId;
                let isActive = false;
                let startTime = null;
                try {
                    const identity = resolveOwnedInteractiveSessionIdentity({
                        ownerKey: chatOwnerKey,
                        projectKey,
                        runtimeId,
                        sessionId,
                    });
                    if (runtimeId === 'local') {
                        isActive = isLocalGPUSessionActive(sessionId);
                        startTime = getLocalGPUSessionStartTime(sessionId);
                    } else {
                        const status = getAgentRuntimeSessionStatus(identity);
                        isActive = status.isActive;
                        startTime = status.startTime;
                    }
                } catch (error) {
                    writer.send({
                        ...createAgentRuntimeErrorPayload(error, runtimeId),
                        projectKey,
                        sessionId,
                    });
                    return;
                }

                const reattachedSessionKeys = isActive
                    ? reattachReconnectableChatSession({
                        ownerKey: chatOwnerKey,
                        projectKey,
                        runtimeId,
                        sessionId,
                    }, ws)
                    : null;
                if (reattachedSessionKeys) {
                    reattachedSessionKeys.forEach((sessionKey) => wsSessionKeys.add(sessionKey));
                }

                writer.send({
                    type: 'session-status',
                    sessionId,
                    runtimeId,
                    provider: runtimeId,
                    projectKey,
                    isProcessing: isActive,
                    startTime
                });
                if (runtimeId !== 'local') {
                    const runtime = getRequiredAgentRuntime(runtimeId);
                    if (runtime.capabilities.turnQueue !== true) return;
                    interactiveAgentTurnQueues.snapshot({
                        ownerKey: chatOwnerKey,
                        runtimeId,
                        projectKey,
                        sessionId,
                        writer,
                    });
                }
            } else if (data.type === 'get-active-sessions') {
                writer.send({
                    type: 'active-sessions',
                    sessions: getPublicActiveSessions(chatOwnerKey)
                });
            }
        } catch (error) {
            console.error('[ERROR] Chat WebSocket error:', error.message);
            interactiveAgentTurnQueues.complete(
                messageTurnQueueState,
                messageTurnResolvedSessionId,
            );
            writer.send(String(error?.code || '').startsWith('AGENT_RUNTIME_')
                ? createAgentRuntimeErrorPayload(error, error.runtimeId)
                : {
                    type: 'error',
                    error: error.message
                });
        }
    });

    ws.on('close', (code, reasonBuffer) => {
        const reason = Buffer.isBuffer(reasonBuffer) ? reasonBuffer.toString('utf8') : String(reasonBuffer || '');
        console.log(`🔌 Chat client disconnected (code=${code}, reason=${reason || 'none'})`);
        // Remove from connected clients
        connectedClients.delete(ws);
        if (connectedClients.size === 0) {
            lastProjectsUpdateSignatures.clear();
        }
        // Keep active work alive briefly so a replacement socket can reattach and
        // receive buffered output. Truly abandoned sessions are still aborted after
        // the grace period to avoid leaking orphaned agent processes.
        for (const sessionKey of wsSessionKeys) {
            try {
                detachReconnectableChatSession(sessionKey, ws);
            } catch {
                // ignore
            }
        }
    });
}

// Handle shell WebSocket connections
function handleShellConnection(ws, request) {
    console.log('🐚 Shell client connected');
    let shellProcess = null;
    let ptySessionKey = null;
    let urlDetectionBuffer = '';
    let keepPtySessionOnClose = true;
    const announcedAuthUrls = new Set();

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            console.log('📨 Shell message received:', data.type);

            if (data.type === 'init') {
                const projectPath = await resolveShellProjectPath(data.projectPath, request?.user?.userId);
                const sessionId = data.sessionId;
                const hasSession = data.hasSession;
                const provider = ['claude', 'codex', 'plain-shell'].includes(data.provider)
                    ? data.provider
                    : 'claude';
                const initialCommand = data.initialCommand;
                const isPlainShell = data.isPlainShell || (!!initialCommand && !hasSession) || provider === 'plain-shell';
                if (isPlainShell) {
                    keepPtySessionOnClose = false;
                    ws.send(JSON.stringify({
                        type: 'output',
                        data: '\r\n\x1b[33mBare terminal access is disabled. Please use Chat or an Agent session instead.\x1b[0m\r\n'
                    }));
                    ws.close(1008, 'plain-shell-disabled');
                    return;
                }
                const shellProjectPath = quoteForShell(projectPath);
                const shellSessionId = sessionId ? quoteForShell(sessionId) : '';
                urlDetectionBuffer = '';
                announcedAuthUrls.clear();

                // Login commands should never reuse cached sessions
                const isLoginCommand = initialCommand && (
                    initialCommand.includes('setup-token') ||
                    initialCommand.includes('/login') ||
                    initialCommand.includes('auth login')
                );
                // Include command hash in session key so different commands get separate sessions
                const commandSuffix = isPlainShell && initialCommand
                    ? `_cmd_${Buffer.from(initialCommand).toString('base64').slice(0, 16)}`
                    : '';
                const providerSuffix = isPlainShell ? '_provider_plain-shell' : `_provider_${provider}`;
                ptySessionKey = `${projectPath}_${sessionId || 'default'}${providerSuffix}${commandSuffix}`;

                // Kill any existing login session before starting fresh
                if (isLoginCommand) {
                    const oldSession = ptySessionsMap.get(ptySessionKey);
                    if (oldSession) {
                        console.log('🧹 Cleaning up existing login session:', ptySessionKey);
                        if (oldSession.timeoutId) clearTimeout(oldSession.timeoutId);
                        if (oldSession.pty && oldSession.pty.kill) oldSession.pty.kill();
                        ptySessionsMap.delete(ptySessionKey);
                    }
                }

                const existingSession = isLoginCommand ? null : ptySessionsMap.get(ptySessionKey);
                if (existingSession) {
                    console.log('♻️  Reconnecting to existing PTY session:', ptySessionKey);
                    shellProcess = existingSession.pty;
                    keepPtySessionOnClose = true;

                    clearTimeout(existingSession.timeoutId);
                    existingSession.timeoutId = null;
                    ensurePtyReplayBuffer(existingSession);

                    ws.send(JSON.stringify({
                        type: 'output',
                        data: `\x1b[36m[Reconnected to existing session]\x1b[0m\r\n`
                    }));

                    if (existingSession.buffer && existingSession.buffer.length > 0) {
                        console.log(`📜 Sending ${existingSession.buffer.length} buffered messages`);
                        existingSession.buffer.forEach(bufferedData => {
                            const replayData = stripReplayTerminalQueries(bufferedData);
                            if (!replayData) {
                                return;
                            }
                            ws.send(JSON.stringify({
                                type: 'output',
                                data: replayData
                            }));
                        });
                    }

                    existingSession.ws = ws;

                    return;
                }

                console.log('[INFO] Starting shell in:', projectPath);
                console.log('📋 Session info:', hasSession ? `Resume session ${sessionId}` : (isPlainShell ? 'Plain shell mode' : 'New session'));
                console.log('🤖 Provider:', isPlainShell ? 'plain-shell' : provider);
                if (initialCommand) {
                    console.log('⚡ Initial command:', initialCommand);
                }

                // First send a welcome message
                let welcomeMsg;
                if (isPlainShell) {
                    welcomeMsg = `\x1b[36mStarting terminal in: ${projectPath}\x1b[0m\r\n`;
                } else {
                    const providerName = provider === 'codex' ? 'Codex' : 'Claude';
                    welcomeMsg = hasSession ?
                        `\x1b[36mResuming ${providerName} session ${sessionId} in: ${projectPath}\x1b[0m\r\n` :
                        `\x1b[36mStarting new ${providerName} session in: ${projectPath}\x1b[0m\r\n`;
                }
                ws.send(JSON.stringify({
                    type: 'output',
                    data: welcomeMsg
                }));

                try {
                    // Prepare the shell command adapted to the platform and provider
	                    let shellCommand;
	                    if (isPlainShell) {
	                        // Plain shell mode - run the initial command or launch interactive shell
	                        const shellInitialCommand = initialCommand;
	                        if (shellInitialCommand) {
	                            // Has a command to run - wrap it in bash -c / powershell
	                            if (os.platform() === 'win32') {
	                                shellCommand = `Set-Location -LiteralPath ${shellProjectPath}; ${shellInitialCommand}`;
	                            } else {
	                                shellCommand = `cd ${shellProjectPath} && ${shellInitialCommand}`;
	                            }
	                        } else {
	                            // No command - launch interactive shell directly (handled in spawn below)
	                            shellCommand = null;
                        }
	                    } else if (provider === 'codex') {
	                        const resumableCodexSessionId =
	                            hasSession && sessionId && !codexRuntime.native.isPlaceholderSessionId(sessionId)
	                                ? sessionId
	                                : null;
	                        const shellCodexSessionId = resumableCodexSessionId ? quoteForShell(resumableCodexSessionId) : '';
	                        // Use codex command
	                        if (os.platform() === 'win32') {
	                            if (resumableCodexSessionId) {
	                                shellCommand = `Set-Location -LiteralPath ${shellProjectPath}; codex resume ${shellCodexSessionId}; if ($LASTEXITCODE -ne 0) { codex }`;
	                            } else {
	                                shellCommand = `Set-Location -LiteralPath ${shellProjectPath}; codex`;
	                            }
	                        } else {
	                            if (resumableCodexSessionId) {
	                                shellCommand = `cd ${shellProjectPath} && codex resume ${shellCodexSessionId} || codex`;
	                            } else {
	                                shellCommand = `cd ${shellProjectPath} && codex`;
	                            }
	                        }
	                    } else {
	                        // Use claude command (default) or initialCommand if provided

	                        const command = initialCommand || 'claude';
	                        if (os.platform() === 'win32') {
	                            if (hasSession && sessionId) {
	                                // Try to resume session, but with fallback to new session if it fails
	                                shellCommand = `Set-Location -LiteralPath ${shellProjectPath}; claude --resume ${shellSessionId}; if ($LASTEXITCODE -ne 0) { claude }`;
	                            } else {
	                                shellCommand = `Set-Location -LiteralPath ${shellProjectPath}; ${command}`;
	                            }
	                        } else {
	                            if (hasSession && sessionId) {
	                                shellCommand = `cd ${shellProjectPath} && claude --resume ${shellSessionId} || claude`;
	                            } else {
	                                shellCommand = `cd ${shellProjectPath} && ${command}`;
	                            }
	                        }
	                    }

                    console.log('🔧 Executing shell command:', shellCommand);

                    // Determine shell, args, and cwd based on command mode
                    let spawnShell, spawnArgs, spawnCwd;
                    if (shellCommand === null) {
                        // Interactive shell mode - launch user's default shell directly
                        if (os.platform() === 'win32') {
                            spawnShell = 'powershell.exe';
                            spawnArgs = [];
                        } else {
                            spawnShell = process.env.SHELL || '/bin/bash';
                            spawnArgs = ['--login'];
                        }
                        spawnCwd = projectPath;
                    } else {
                        // Command mode - run via the user's shell so provider/config env matches a normal terminal more closely
                        const launch = buildCommandModeShellLaunch(shellCommand);
                        spawnShell = launch.shell;
                        spawnArgs = launch.args;
                        spawnCwd = os.homedir();
                    }

                    // Use terminal dimensions from client if provided, otherwise use defaults
                    const termCols = data.cols || 80;
                    const termRows = data.rows || 24;
                    console.log('📐 Using terminal dimensions:', termCols, 'x', termRows);

                    shellProcess = pty.spawn(spawnShell, spawnArgs, {
                        name: 'xterm-256color',
                        cols: termCols,
                        rows: termRows,
                        cwd: spawnCwd,
                        env: buildEmbeddedShellEnv(process.env)
                    });

                    console.log('🟢 Shell process started with PTY, PID:', shellProcess.pid);

                    ptySessionsMap.set(ptySessionKey, {
                        pty: shellProcess,
                        ws: ws,
                        buffer: [],
                        bufferBytes: 0,
                        timeoutId: null,
                        projectPath,
                        sessionId
                    });

                    // Handle data output
                    shellProcess.onData((data) => {
                        const session = ptySessionsMap.get(ptySessionKey);
                        if (!session) return;

                        appendPtyReplayBuffer(session, data);

                        if (session.ws && session.ws.readyState === WebSocket.OPEN) {
                            let outputData = data;

                            const cleanChunk = stripAnsiSequences(data);
                            urlDetectionBuffer = `${urlDetectionBuffer}${cleanChunk}`.slice(-SHELL_URL_PARSE_BUFFER_LIMIT);

                            outputData = outputData.replace(
                                /OPEN_URL:\s*(https?:\/\/[^\s\x1b\x07]+)/g,
                                '[INFO] Opening in browser: $1'
                            );

                            const emitAuthUrl = (detectedUrl, autoOpen = false) => {
                                const normalizedUrl = normalizeDetectedUrl(detectedUrl);
                                if (!normalizedUrl) return;

                                const isNewUrl = !announcedAuthUrls.has(normalizedUrl);
                                if (isNewUrl) {
                                    announcedAuthUrls.add(normalizedUrl);
                                    session.ws.send(JSON.stringify({
                                        type: 'auth_url',
                                        url: normalizedUrl,
                                        autoOpen
                                    }));
                                }

                            };

                            const normalizedDetectedUrls = extractUrlsFromText(urlDetectionBuffer)
                                .map((url) => normalizeDetectedUrl(url))
                                .filter(Boolean);

                            // Prefer the most complete URL if shorter prefix variants are also present.
                            const dedupedDetectedUrls = Array.from(new Set(normalizedDetectedUrls)).filter((url, _, urls) =>
                                !urls.some((otherUrl) => otherUrl !== url && otherUrl.startsWith(url))
                            );

                            dedupedDetectedUrls.forEach((url) => emitAuthUrl(url, false));

                            if (shouldAutoOpenUrlFromOutput(cleanChunk) && dedupedDetectedUrls.length > 0) {
                                const bestUrl = dedupedDetectedUrls.reduce((longest, current) =>
                                    current.length > longest.length ? current : longest
                                );
                                emitAuthUrl(bestUrl, true);
                            }

                            // Send regular output
                            session.ws.send(JSON.stringify({
                                type: 'output',
                                data: outputData
                            }));
                        }
                    });

                    // Handle process exit
                    shellProcess.onExit((exitCode) => {
                        console.log('🔚 Shell process exited with code:', exitCode.exitCode, 'signal:', exitCode.signal);
                        const session = ptySessionsMap.get(ptySessionKey);
                        if (session && session.ws && session.ws.readyState === WebSocket.OPEN) {
                            session.ws.send(JSON.stringify({
                                type: 'output',
                                data: `\r\n\x1b[33mProcess exited with code ${exitCode.exitCode}${exitCode.signal ? ` (${exitCode.signal})` : ''}\x1b[0m\r\n`
                            }));
                        }
                        if (session && session.timeoutId) {
                            clearTimeout(session.timeoutId);
                        }
                        ptySessionsMap.delete(ptySessionKey);
                        shellProcess = null;
                    });

                } catch (spawnError) {
                    console.error('[ERROR] Error spawning process:', spawnError);
                    ws.send(JSON.stringify({
                        type: 'output',
                        data: `\r\n\x1b[31mError: ${spawnError.message}\x1b[0m\r\n`
                    }));
                }

            } else if (data.type === 'input') {
                // Send input to shell process
                if (shellProcess && shellProcess.write) {
                    try {
                        shellProcess.write(data.data);
                    } catch (error) {
                        console.error('Error writing to shell:', error);
                    }
                } else {
                    console.warn('No active shell process to send input to');
                }
            } else if (data.type === 'resize') {
                // Handle terminal resize
                if (shellProcess && shellProcess.resize) {
                    console.log('Terminal resize requested:', data.cols, 'x', data.rows);
                    shellProcess.resize(data.cols, data.rows);
                }
            } else if (data.type === 'clear_buffer') {
                const session = ptySessionKey ? ptySessionsMap.get(ptySessionKey) : null;
                clearPtyReplayBuffer(session);
            } else if (data.type === 'restart') {
                keepPtySessionOnClose = false;
                disposePtySession(ptySessionKey);
                shellProcess = null;

                if (ws.readyState === WebSocket.OPEN) {
                    ws.close(1000, 'restart');
                }
            }
        } catch (error) {
            console.error('[ERROR] Shell WebSocket error:', error.message);
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'output',
                    data: `\r\n\x1b[31mError: ${error.message}\x1b[0m\r\n`
                }));
            }
        }
    });

    ws.on('close', () => {
        console.log('🔌 Shell client disconnected');

        if (keepPtySessionOnClose && ptySessionKey) {
            const session = ptySessionsMap.get(ptySessionKey);
            if (session) {
                console.log('⏳ PTY session kept alive, will timeout in 30 minutes:', ptySessionKey);
                session.ws = null;

                session.timeoutId = setTimeout(() => {
                    console.log('⏰ PTY session timeout, killing process:', ptySessionKey);
                    if (session.pty && session.pty.kill) {
                        session.pty.kill();
                    }
                    ptySessionsMap.delete(ptySessionKey);
                }, PTY_SESSION_TIMEOUT);
            }
        }
    });

    ws.on('error', (error) => {
        console.error('[ERROR] Shell WebSocket error:', error);
    });
}

function handleComputeShellConnection(ws, urlNodeId) {
    console.log('🖥️  Compute shell client connected');
    let shellProcess = null;
    let ptySessionKey = null;
    let keepPtySessionOnClose = true;

    const getComputeNodeConfig = async (nodeId) => {
        const { loadNodeConfig, getActiveNode } = await import('./compute-node.js');
        const effectiveNodeId = nodeId || urlNodeId;
        if (effectiveNodeId) {
            return await loadNodeConfig(effectiveNodeId);
        }
        return await getActiveNode();
    };

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            console.log('📨 Compute shell message received:', data.type);

            if (data.type === 'init') {
                const requestedNodeId = data.nodeId;
                let config;
                try {
                    config = await getComputeNodeConfig(requestedNodeId);
                } catch (e) {
                    ws.send(JSON.stringify({
                        type: 'output',
                        data: '\x1b[31mCompute node not configured. Please save configuration first.\x1b[0m\r\n'
                    }));
                    return;
                }

                if (!config || !config.host || !config.user) {
                    ws.send(JSON.stringify({
                        type: 'output',
                        data: '\x1b[31mCompute node configuration incomplete (missing host/user).\x1b[0m\r\n'
                    }));
                    return;
                }

                const termCols = data.cols || 80;
                const termRows = data.rows || 24;

                ptySessionKey = `compute_${config.id || 'default'}_${config.host}_${config.user}`;

                const existingSession = ptySessionsMap.get(ptySessionKey);
                if (existingSession) {
                    console.log('♻️  Reconnecting to existing compute PTY session:', ptySessionKey);
                    shellProcess = existingSession.pty;
                    clearTimeout(existingSession.timeoutId);
                    existingSession.timeoutId = null;
                    ensurePtyReplayBuffer(existingSession);

                    ws.send(JSON.stringify({
                        type: 'output',
                        data: '\x1b[36m[Reconnected to compute node]\x1b[0m\r\n'
                    }));

                    if (existingSession.buffer && existingSession.buffer.length > 0) {
                        existingSession.buffer.forEach(bufferedData => {
                            ws.send(JSON.stringify({ type: 'output', data: bufferedData }));
                        });
                    }

                    existingSession.ws = ws;
                    return;
                }

                const spawnCmd = 'ssh';
                const sshArgs = ['-o', 'StrictHostKeyChecking=no', '-tt'];

                const sshPort = config.port || 22;
                if (sshPort !== 22) {
                    sshArgs.push('-p', String(sshPort));
                }

                if (config.keyPath) {
                    sshArgs.push('-i', config.keyPath);
                }

                sshArgs.push(`${config.user}@${config.host}`);

                if (config.workDir && config.workDir !== '~') {
                    sshArgs.push(`cd ${config.workDir} && exec $SHELL -l`);
                }

                const usePasswordAuth = config.password && !config.keyPath;

                ws.send(JSON.stringify({
                    type: 'output',
                    data: `\x1b[36mConnecting to ${config.user}@${config.host}${config.workDir && config.workDir !== '~' ? ` (workDir: ${config.workDir})` : ''}...\x1b[0m\r\n`
                }));

                try {
                    shellProcess = pty.spawn(spawnCmd, sshArgs, {
                        name: 'xterm-256color',
                        cols: termCols,
                        rows: termRows,
                        cwd: os.homedir(),
                        env: {
                            ...process.env,
                            TERM: 'xterm-256color',
                            COLORTERM: 'truecolor',
                            FORCE_COLOR: '3'
                        }
                    });

                    console.log('🟢 Compute shell process started, PID:', shellProcess.pid);

                    let passwordAutoFilled = false;
                    let earlyOutput = '';

                    ptySessionsMap.set(ptySessionKey, {
                        pty: shellProcess,
                        ws: ws,
                        buffer: [],
                        bufferBytes: 0,
                        timeoutId: null,
                        host: config.host
                    });

                    shellProcess.onData((outputData) => {
                        const session = ptySessionsMap.get(ptySessionKey);
                        if (!session) return;

                        if (usePasswordAuth && !passwordAutoFilled) {
                            earlyOutput += outputData;
                            const cleanText = earlyOutput.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
                            if (/[Pp]assword[:\s]*$/.test(cleanText)) {
                                passwordAutoFilled = true;
                                shellProcess.write(config.password + '\n');
                                return;
                            }
                        }

                        appendPtyReplayBuffer(session, outputData);

                        if (session.ws && session.ws.readyState === WebSocket.OPEN) {
                            session.ws.send(JSON.stringify({
                                type: 'output',
                                data: outputData
                            }));
                        }
                    });

                    shellProcess.onExit((exitCode) => {
                        console.log('🔚 Compute shell exited with code:', exitCode.exitCode);
                        const session = ptySessionsMap.get(ptySessionKey);
                        if (session && session.ws && session.ws.readyState === WebSocket.OPEN) {
                            session.ws.send(JSON.stringify({
                                type: 'output',
                                data: `\r\n\x1b[33mSSH session ended (code ${exitCode.exitCode})\x1b[0m\r\n`
                            }));
                        }
                        if (session && session.timeoutId) {
                            clearTimeout(session.timeoutId);
                        }
                        ptySessionsMap.delete(ptySessionKey);
                        shellProcess = null;
                    });

                } catch (spawnError) {
                    console.error('[ERROR] Error spawning SSH process:', spawnError);
                    ws.send(JSON.stringify({
                        type: 'output',
                        data: `\r\n\x1b[31mError: ${spawnError.message}\x1b[0m\r\n`
                    }));
                }

            } else if (data.type === 'input') {
                if (shellProcess && shellProcess.write) {
                    try {
                        shellProcess.write(data.data);
                    } catch (error) {
                        console.error('Error writing to compute shell:', error);
                    }
                }
            } else if (data.type === 'resize') {
                if (shellProcess && shellProcess.resize) {
                    shellProcess.resize(data.cols, data.rows);
                }
            } else if (data.type === 'clear_buffer') {
                const session = ptySessionKey ? ptySessionsMap.get(ptySessionKey) : null;
                clearPtyReplayBuffer(session);
            } else if (data.type === 'restart') {
                keepPtySessionOnClose = false;
                disposePtySession(ptySessionKey);
                shellProcess = null;

                if (ws.readyState === WebSocket.OPEN) {
                    ws.close(1000, 'restart');
                }
            }
        } catch (error) {
            console.error('[ERROR] Compute shell WebSocket error:', error.message);
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'output',
                    data: `\r\n\x1b[31mError: ${error.message}\x1b[0m\r\n`
                }));
            }
        }
    });

    ws.on('close', () => {
        console.log('🔌 Compute shell client disconnected');
        if (keepPtySessionOnClose && ptySessionKey) {
            const session = ptySessionsMap.get(ptySessionKey);
            if (session) {
                console.log('⏳ Compute PTY session kept alive for 30 minutes:', ptySessionKey);
                session.ws = null;
                session.timeoutId = setTimeout(() => {
                    console.log('⏰ Compute PTY session timeout, killing:', ptySessionKey);
                    if (session.pty && session.pty.kill) {
                        session.pty.kill();
                    }
                    ptySessionsMap.delete(ptySessionKey);
                }, PTY_SESSION_TIMEOUT);
            }
        }
    });

    ws.on('error', (error) => {
        console.error('[ERROR] Compute shell WebSocket error:', error);
    });
}

// Audio transcription endpoint
app.post('/api/transcribe', authenticateToken, async (req, res) => {
    try {
        const multer = (await import('multer')).default;
        const upload = multer({ storage: multer.memoryStorage() });

        // Handle multipart form data
        upload.single('audio')(req, res, async (err) => {
            if (err) {
                return res.status(400).json({ error: 'Failed to process audio file' });
            }

            if (!req.file) {
                return res.status(400).json({ error: 'No audio file provided' });
            }

            const apiKey = process.env.OPENAI_API_KEY;
            if (!apiKey) {
                return res.status(500).json({ error: 'OpenAI API key not configured. Please set OPENAI_API_KEY in server environment.' });
            }

            try {
                // Create form data for OpenAI
                const FormData = (await import('form-data')).default;
                const formData = new FormData();
                formData.append('file', req.file.buffer, {
                    filename: req.file.originalname,
                    contentType: req.file.mimetype
                });
                formData.append('model', 'whisper-1');
                formData.append('response_format', 'json');
                formData.append('language', 'en');

                // Make request to OpenAI
                const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        ...formData.getHeaders()
                    },
                    body: formData
                });

                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    throw new Error(errorData.error?.message || `Whisper API error: ${response.status}`);
                }

                const data = await response.json();
                let transcribedText = data.text || '';

                // Check if enhancement mode is enabled
                const mode = req.body.mode || 'default';

                // If no transcribed text, return empty
                if (!transcribedText) {
                    return res.json({ text: '' });
                }

                // If default mode, return transcribed text without enhancement
                if (mode === 'default') {
                    return res.json({ text: transcribedText });
                }

                // Handle different enhancement modes
                try {
                    const OpenAI = (await import('openai')).default;
                    const openai = new OpenAI({ apiKey });

                    let prompt, systemMessage, temperature = 0.7, maxTokens = 800;

                    switch (mode) {
                        case 'prompt':
                            systemMessage = 'You are an expert prompt engineer who creates clear, detailed, and effective prompts.';
                            prompt = `You are an expert prompt engineer. Transform the following rough instruction into a clear, detailed, and context-aware AI prompt.

Your enhanced prompt should:
1. Be specific and unambiguous
2. Include relevant context and constraints
3. Specify the desired output format
4. Use clear, actionable language
5. Include examples where helpful
6. Consider edge cases and potential ambiguities

Transform this rough instruction into a well-crafted prompt:
"${transcribedText}"

Enhanced prompt:`;
                            break;

                        case 'vibe':
                        case 'instructions':
                        case 'architect':
                            systemMessage = 'You are a helpful assistant that formats ideas into clear, actionable instructions for AI agents.';
                            temperature = 0.5; // Lower temperature for more controlled output
                            prompt = `Transform the following idea into clear, well-structured instructions that an AI agent can easily understand and execute.

IMPORTANT RULES:
- Format as clear, step-by-step instructions
- Add reasonable implementation details based on common patterns
- Only include details directly related to what was asked
- Do NOT add features or functionality not mentioned
- Keep the original intent and scope intact
- Use clear, actionable language an agent can follow

Transform this idea into agent-friendly instructions:
"${transcribedText}"

Agent instructions:`;
                            break;

                        default:
                            // No enhancement needed
                            break;
                    }

                    // Only make GPT call if we have a prompt
                    if (prompt) {
                        const completion = await openai.chat.completions.create({
                            model: 'gpt-4o-mini',
                            messages: [
                                { role: 'system', content: systemMessage },
                                { role: 'user', content: prompt }
                            ],
                            temperature: temperature,
                            max_tokens: maxTokens
                        });

                        transcribedText = completion.choices[0].message.content || transcribedText;
                    }

                } catch (gptError) {
                    console.error('GPT processing error:', gptError);
                    // Fall back to original transcription if GPT fails
                }

                res.json({ text: transcribedText });

            } catch (error) {
                console.error('Transcription error:', error);
                res.status(500).json({ error: error.message });
            }
        });
    } catch (error) {
        console.error('Endpoint error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Image upload endpoint
app.post('/api/projects/:projectName/upload-images', authenticateToken, async (req, res) => {
    try {
        const multer = (await import('multer')).default;
        const path = (await import('path')).default;
        const fs = (await import('fs')).promises;
        const os = (await import('os')).default;

        // Configure multer for image uploads
        const storage = multer.diskStorage({
            destination: async (req, file, cb) => {
                const uploadDir = path.join(os.tmpdir(), 'claude-ui-uploads', String(req.user.id));
                await fs.mkdir(uploadDir, { recursive: true });
                cb(null, uploadDir);
            },
            filename: (req, file, cb) => {
                const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
                const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
                cb(null, uniqueSuffix + '-' + sanitizedName);
            }
        });

        const upload = multer({
            storage,
            limits: {
                fileSize: 10 * 1024 * 1024, // 10MB
                files: 5
            }
        });

        // Handle multipart form data
        upload.array('images', 5)(req, res, async (err) => {
            if (err) {
                return res.status(400).json({ error: err.message });
            }

            if (!req.files || req.files.length === 0) {
                return res.status(400).json({ error: 'No files provided' });
            }

            try {
                // Process uploaded images
                const processedImages = await Promise.all(
                    req.files.map(async (file) => {
                        // Read file and convert to base64
                        const buffer = await fs.readFile(file.path);
                        const base64 = buffer.toString('base64');
                        const mimeType = file.mimetype;

                        // Clean up temp file immediately
                        await fs.unlink(file.path);

                        return {
                            name: file.originalname,
                            data: `data:${mimeType};base64,${base64}`,
                            size: file.size,
                            mimeType: mimeType
                        };
                    })
                );

                res.json({ images: processedImages });
            } catch (error) {
                console.error('Error processing images:', error);
                // Clean up any remaining files
                await Promise.all(req.files.map(f => fs.unlink(f.path).catch(() => { })));
                res.status(500).json({ error: 'Failed to process images' });
            }
        });
    } catch (error) {
        console.error('Error in image upload endpoint:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get token usage for a specific session
app.get('/api/projects/:projectName/sessions/:sessionId/token-usage', authenticateToken, async (req, res) => {
  try {
    const { projectName, sessionId } = req.params;
    const { provider = 'claude' } = req.query;
    if (provider === 'pi') {
      const identity = createAgentSessionIdentity({ ownerKey: String(req.user.id), projectKey: projectName, runtimeId: 'pi', sessionId });
      return res.json(agentStateTokenUsage(await piRuntime.native.sessionState(identity)));
    }
    const homeDir = os.homedir();

    // Allow only safe characters in sessionId
    const safeSessionId = String(sessionId).replace(/[^a-zA-Z0-9._-]/g, '');
    if (!safeSessionId) {
      return res.status(400).json({ error: 'Invalid sessionId' });
    }

    // Handle Codex sessions
    if (provider === 'codex') {
      const sessionFilePath = await findCodexSessionFileById(safeSessionId);

      if (!sessionFilePath) {
        return res.status(404).json({ error: 'Codex session file not found', sessionId: safeSessionId });
      }

      // Read and parse the Codex JSONL file
      let fileContent;
      try {
        fileContent = await fsPromises.readFile(sessionFilePath, 'utf8');
      } catch (error) {
        if (error.code === 'ENOENT') {
          return res.status(404).json({ error: 'Session file not found', path: sessionFilePath });
        }
        throw error;
      }
      return res.json(buildCodexTokenUsageFromJsonl(fileContent));
    }

    // Handle Claude sessions (default)
    // Extract actual project path
    let projectPath;
    try {
      projectPath = await extractProjectDirectory(projectName);
    } catch (error) {
      console.error('Error extracting project directory:', error);
      return res.status(500).json({ error: 'Failed to determine project path' });
    }

    // Construct the JSONL file path
    // Claude stores session files in ~/.claude/projects/[encoded-project-path]/[session-id].jsonl
    // The encoding replaces /, spaces, ~, and _ with -
    const encodedPath = projectPath.replace(/[\\/:\s~_]/g, '-');
    const projectDir = path.join(homeDir, '.claude', 'projects', encodedPath);

    const jsonlPath = path.join(projectDir, `${safeSessionId}.jsonl`);

    // Constrain to projectDir
    const rel = path.relative(path.resolve(projectDir), path.resolve(jsonlPath));
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return res.status(400).json({ error: 'Invalid path' });
    }

    // Read and parse the JSONL file
    let fileContent;
    try {
      fileContent = await fsPromises.readFile(jsonlPath, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') {
        return res.status(404).json({ error: 'Session file not found', path: jsonlPath });
      }
      throw error; // Re-throw other errors to be caught by outer try-catch
    }
    const lines = fileContent.trim().split('\n');

    let inputTokens = 0;
    let cacheCreationTokens = 0;
    let cacheReadTokens = 0;
    let modelName = null;

    // Find the latest assistant message with usage data (scan from end)
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i]);

        // Only count assistant messages which have usage data
        if (entry.type === 'assistant' && entry.message?.usage) {
          const usage = entry.message.usage;

          // Use token counts from latest assistant message only
          inputTokens = usage.input_tokens || 0;
          cacheCreationTokens = usage.cache_creation_input_tokens || 0;
          cacheReadTokens = usage.cache_read_input_tokens || 0;
          modelName = entry.message.model || null;

          break; // Stop after finding the latest assistant message
        }
      } catch (parseError) {
        // Skip lines that can't be parsed
        continue;
      }
    }

    // Prefer the model resolved by Claude. CONTEXT_WINDOW is retained only as
    // a fallback for custom/older records that do not identify their model.
    const parsedContextWindow = parseInt(process.env.CONTEXT_WINDOW, 10);
    let contextWindow;
    if (modelName) {
      contextWindow = getClaudeModelContextWindow(modelName);
    } else if (Number.isFinite(parsedContextWindow)) {
      contextWindow = parsedContextWindow;
    } else {
      contextWindow = 256000;
    }

    // Calculate total context usage (excluding output_tokens, as per ccusage)
    const totalUsed = inputTokens + cacheCreationTokens + cacheReadTokens;

    res.json({
      used: totalUsed,
      total: contextWindow,
      model: modelName,
      breakdown: {
        input: inputTokens,
        cacheCreation: cacheCreationTokens,
        cacheRead: cacheReadTokens
      }
    });
  } catch (error) {
    console.error('Error reading session token usage:', error);
    res.status(500).json({ error: 'Failed to read session token usage' });
  }
});

// Serve React app for all other routes (excluding static files)
app.get('*', (req, res) => {
  const localKernelFallback = getLocalKernelBrowserFallback(req.path);
  if (localKernelFallback) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    if (localKernelFallback.status === 204) {
      return res.status(204).end();
    }
    return res.status(localKernelFallback.status).type('text/plain').send(localKernelFallback.body);
  }

  // Skip requests for static assets (files with extensions)
  if (path.extname(req.path)) {
    return res.status(404).send('Not found');
  }

  // Only serve index.html for HTML routes, not for static assets
  // Static assets should already be handled by express.static middleware above
  const indexPath = path.join(__dirname, '../dist/index.html');

  // Check if dist/index.html exists (production build available)
  if (fs.existsSync(indexPath)) {
    // Set no-cache headers for HTML to prevent service worker issues
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(indexPath);
  } else {
    // In development, redirect to Vite dev server only if dist doesn't exist
    res.redirect(`http://${DISPLAY_HOST}:${getFrontendPortSync(REQUESTED_VITE_PORT)}`);
  }
});

// Helper function to convert permissions to rwx format
function permToRwx(perm) {
    const r = perm & 4 ? 'r' : '-';
    const w = perm & 2 ? 'w' : '-';
    const x = perm & 1 ? 'x' : '-';
    return r + w + x;
}

function isPathInsideOrEqual(parentPath, childPath) {
    const parent = path.resolve(parentPath);
    const child = path.resolve(childPath);
    return child === parent || child.startsWith(parent + path.sep);
}

function getProjectRelativePath(projectRoot, targetPath) {
    const relativePath = path.relative(path.resolve(projectRoot), path.resolve(targetPath));
    return normalizeProjectRelativePath(relativePath);
}

function normalizeProjectEntryName(value) {
    if (typeof value !== 'string') {
        return null;
    }

    const name = value.trim();
    const windowsReservedName = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
    if (
        !name ||
        name === '.' ||
        name === '..' ||
        name.startsWith('.') ||
        name.length > 255 ||
        name.endsWith('.') ||
        /[<>:"/\\|?*\u0000-\u001f]/.test(name) ||
        windowsReservedName.test(name)
    ) {
        return null;
    }

    return name;
}

function resolveProjectChildPath(projectRoot, childPath = '') {
    const normalizedChildPath = String(childPath || '').trim();
    return normalizedChildPath
        ? (path.isAbsolute(normalizedChildPath)
            ? path.resolve(normalizedChildPath)
            : path.resolve(projectRoot, normalizedChildPath))
        : path.resolve(projectRoot);
}

async function projectPathExists(targetPath) {
    try {
        await fsPromises.access(targetPath);
        return true;
    } catch (error) {
        if (error.code === 'ENOENT') {
            return false;
        }
        throw error;
    }
}

async function findAvailableProjectCopyPath(destinationDir, sourceName, isDirectory) {
    const parsedName = path.parse(sourceName);

    for (let copyIndex = 0; copyIndex < 1000; copyIndex += 1) {
        let candidateName = sourceName;
        if (copyIndex > 0) {
            const suffix = copyIndex === 1 ? ' copy' : ` copy ${copyIndex}`;
            candidateName = isDirectory
                ? `${sourceName}${suffix}`
                : `${parsedName.name}${suffix}${parsedName.ext}`;
        }

        const candidatePath = path.join(destinationDir, candidateName);
        if (!await projectPathExists(candidatePath)) {
            return candidatePath;
        }
    }

    const error = new Error('Unable to choose a unique name for the copied item');
    error.statusCode = 409;
    throw error;
}

function includeInternalProjectFiles(req) {
    return ['1', 'true', 'yes', 'on'].includes(String(req.query.includeInternal || '').toLowerCase());
}

function assertPublicProjectPath(projectRoot, targetPath, { includeInternal = false } = {}) {
    if (!isPathInsideOrEqual(projectRoot, targetPath)) {
        const error = new Error('Path must be under project root');
        error.statusCode = 403;
        throw error;
    }

    const relativePath = getProjectRelativePath(projectRoot, targetPath);
    if (isProtectedProjectPath(relativePath)) {
        const error = new Error('Protected project files are not available from the file browser');
        error.statusCode = 404;
        throw error;
    }

    if (!includeInternal && isInternalProjectPath(relativePath)) {
        const error = new Error('Internal project files are not available from the file browser');
        error.statusCode = 404;
        throw error;
    }
}

async function assertReadableProjectPath(projectRoot, targetPath, { includeInternal = false } = {}) {
    assertPublicProjectPath(projectRoot, targetPath, { includeInternal });

    const realProjectRoot = await fsPromises.realpath(projectRoot);
    const realTargetPath = await fsPromises.realpath(targetPath);
    if (!isPathInsideOrEqual(realProjectRoot, realTargetPath)) {
        const error = new Error('Resolved path must stay under project root');
        error.statusCode = 403;
        throw error;
    }
}

async function assertWritableProjectPath(projectRoot, targetPath, { includeInternal = false } = {}) {
    assertPublicProjectPath(projectRoot, targetPath, { includeInternal });

    const realProjectRoot = await fsPromises.realpath(projectRoot);
    try {
        const realTargetPath = await fsPromises.realpath(targetPath);
        if (!isPathInsideOrEqual(realProjectRoot, realTargetPath)) {
            const error = new Error('Resolved path must stay under project root');
            error.statusCode = 403;
            throw error;
        }
        return;
    } catch (error) {
        if (error.code !== 'ENOENT') {
            throw error;
        }
    }

    const realParentPath = await fsPromises.realpath(path.dirname(targetPath));
    if (!isPathInsideOrEqual(realProjectRoot, realParentPath)) {
        const error = new Error('Parent directory must stay under project root');
        error.statusCode = 403;
        throw error;
    }
}

async function findAllFilesInProject(projectRoot, fileName, maxDepth = 10) {
    const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build']);
    const results = [];
    const queue = [[projectRoot, 0]];

    while (queue.length > 0) {
        const [dirPath, depth] = queue.shift();
        let entries;
        try {
            entries = await fsPromises.readdir(dirPath, { withFileTypes: true });
        } catch { continue; }

        for (const entry of entries) {
            const entryPath = path.join(dirPath, entry.name);
            if (entry.isSymbolicLink()) {
                continue;
            }

            let isDir = entry.isDirectory();

            if (entry.name === fileName && !isDir) {
                results.push(entryPath);
                if (results.length >= 20) return results;
            }
            if (isDir && !SKIP_DIRS.has(entry.name)
                && depth < maxDepth) {
                queue.push([entryPath, depth + 1]);
            }
        }
    }
    return results;
}

async function resolveProjectFilePath(projectRoot, inputPath, { includeInternal = false } = {}) {
    inputPath = normalizeProjectFileRequestPath(inputPath);
    if (!inputPath || typeof inputPath !== 'string') return { resolved: path.resolve(projectRoot, '') };
    if (path.isAbsolute(inputPath)) return { resolved: path.resolve(inputPath) };

    const direct = path.resolve(projectRoot, inputPath);
    const isSimpleName = !inputPath.includes('/') && !inputPath.includes('\\');

    // For paths with separators (e.g. "src/main.tsx"), check direct first, then search
    if (!isSimpleName) {
        try {
            await fsPromises.access(direct);
            return { resolved: direct };
        } catch { /* not found at direct path */ }

        // Search for the filename, then filter matches ending with the partial path
        const fileName = path.basename(inputPath);
        const normalizedInput = inputPath.split(path.sep).join('/');
        const matches = await findAllFilesInProject(projectRoot, fileName);
        const filtered = matches.filter(m => {
            const rel = path.relative(projectRoot, m).split(path.sep).join('/');
            if (isProtectedProjectPath(rel)) return false;
            if (!includeInternal && isInternalProjectPath(rel)) return false;
            return rel === normalizedInput || rel.endsWith('/' + normalizedInput);
        });

        if (filtered.length === 1) {
            return { resolved: filtered[0] };
        }
        if (filtered.length > 1) {
            return {
                resolved: null,
                candidates: filtered.map(m => path.relative(projectRoot, m))
            };
        }

        return { resolved: direct };
    }

    // 1. Hardcoded pipeline fallbacks
    const fallbackMap = {
        'research_brief.json': '.pipeline/docs/research_brief.json',
        'tasks.json': '.pipeline/tasks/tasks.json',
        'pipeline_config.json': '.pipeline/config.json'
    };
    const mapped = fallbackMap[inputPath];
    if (mapped && includeInternal) return { resolved: path.resolve(projectRoot, mapped) };

    // 2. If the file exists at project root, use it
    try {
        await fsPromises.access(direct);
        return { resolved: direct };
    } catch { /* not at root */ }

    // 3. Search project tree
    const matches = (await findAllFilesInProject(projectRoot, inputPath))
        .filter((matchPath) => {
            const relativePath = path.relative(projectRoot, matchPath);
            if (isProtectedProjectPath(relativePath)) return false;
            return includeInternal || !isInternalProjectPath(relativePath);
        });
    if (matches.length === 1) {
        return { resolved: matches[0] };
    }
    if (matches.length > 1) {
        return {
            resolved: null,
            candidates: matches.map(m => path.relative(projectRoot, m))
        };
    }

    // 4. No match — fall back to direct path (will 404)
    return { resolved: direct };
}

function normalizeProjectFileRequestPath(inputPath) {
    if (!inputPath || typeof inputPath !== 'string') return '';
    let value = String(inputPath).trim().replace(/^<(.+)>$/, '$1').trim();
    if (!value) return '';

    if (/^file:\/\//i.test(value)) {
        try {
            const fileUrl = new URL(value);
            value = decodeURIComponent(fileUrl.pathname);
            if (/^\/[A-Za-z]:[\\/]/.test(value)) {
                value = value.slice(1);
            }
        } catch {
            value = value.replace(/^file:\/\//i, '');
        }
    } else {
        try {
            value = decodeURI(value);
        } catch {
            // Keep the original value if it is not valid URI-encoded text.
        }
    }

    value = value.replace(/[?#].*$/, '').trim();
    const lineMatch = value.match(/^(.*\.[A-Za-z0-9][A-Za-z0-9_-]{0,15})(?::\d+(?::\d+)?)$/);
    return (lineMatch?.[1] || value).trim();
}

async function getFileTree(dirPath, maxDepth = 3, currentDepth = 0, showHidden = true, isBrowsing = false, options = {}) {
    // Using fsPromises from import
    const items = [];
    const projectRoot = path.resolve(options.projectRoot || dirPath);
    const includeInternal = Boolean(options.includeInternal);

    try {
        const entries = await fsPromises.readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
            // Debug: log all entries including hidden files
            if (!showHidden && entry.name.startsWith('.')) continue;

            const itemPath = path.join(dirPath, entry.name);
            const relativePath = getProjectRelativePath(projectRoot, itemPath);
            if (isProtectedProjectPath(relativePath)) continue;
            if (!includeInternal && isInternalProjectPath(relativePath)) continue;

            if (entry.isSymbolicLink()) continue;

            // Skip heavy build directories and VCS directories unless we are browsing
            if (!isBrowsing && (
                entry.name === 'node_modules' ||
                entry.name === 'dist' ||
                entry.name === 'build' ||
                entry.name === '.git' ||
                entry.name === '.svn' ||
                entry.name === '.hg'
            )) continue;

            let isDirectory = entry.isDirectory();

            const item = {
                name: entry.name,
                path: itemPath,
                type: isDirectory ? 'directory' : 'file'
            };

            // Get file stats for additional metadata
            try {
                const stats = await fsPromises.stat(itemPath);
                item.size = stats.size;
                item.modified = stats.mtime.toISOString();

                // Convert permissions to rwx format
                const mode = stats.mode;
                const ownerPerm = (mode >> 6) & 7;
                const groupPerm = (mode >> 3) & 7;
                const otherPerm = mode & 7;
                item.permissions = ((mode >> 6) & 7).toString() + ((mode >> 3) & 7).toString() + (mode & 7).toString();
                item.permissionsRwx = permToRwx(ownerPerm) + permToRwx(groupPerm) + permToRwx(otherPerm);
            } catch (statError) {
                // If stat fails, provide default values
                item.size = 0;
                item.modified = null;
                item.permissions = '000';
                item.permissionsRwx = '---------';
            }

            if (isDirectory && currentDepth < maxDepth) {
                // Recursively get subdirectories but limit depth
                try {
                    // Check if we can access the directory before trying to read it
                    await fsPromises.access(item.path, fs.constants.R_OK);
                    item.children = await getFileTree(item.path, maxDepth, currentDepth + 1, showHidden, isBrowsing, {
                        projectRoot,
                        includeInternal,
                    });
                } catch (e) {
                    // Silently skip directories we can't access (permission denied, etc.)
                    item.children = [];
                }
            }

            items.push(item);
        }
    } catch (error) {
        // Only log non-permission errors to avoid spam
        if (error.code !== 'EACCES' && error.code !== 'EPERM') {
            console.error('Error reading directory:', error);
        }
    }

    return items.sort((a, b) => {
        if (a.type !== b.type) {
            return a.type === 'directory' ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
    });
}

const LOCAL_KERNEL_MODE = isLocalKernelMode();
const REQUESTED_PORT = LOCAL_KERNEL_MODE
    ? 0
    : parsePortNumber(process.env.PORT, DEFAULT_BACKEND_PORT);
const REQUESTED_VITE_PORT = parsePortNumber(process.env.VITE_PORT, DEFAULT_FRONTEND_PORT);
const HOST = LOCAL_KERNEL_MODE
    ? resolveLocalKernelHost()
    : (process.env.HOST || '0.0.0.0');
// Show localhost when binding to all interfaces; 0.0.0.0 is not directly connectable.
const DISPLAY_HOST = HOST === '0.0.0.0' ? 'localhost' : HOST;
const isDirectExecution = process.argv[1] && path.resolve(process.argv[1]) === __filename;
const shouldAutoStartServer = isDirectExecution || process.env.MEDHELP_KERNEL_ENTRYPOINT === '1';
let serverStartPromise = null;
let serverStopPromise = null;
let serverRestartPromise = null;

// Initialize database and start server
export async function startServer() {
    assertTrustedJwtSecret({
        jwtSecret: JWT_SECRET,
        nodeEnv: process.env.NODE_ENV,
        isLocalKernel: isLocalKernelMode(),
        isDesktop: process.env.MEDHELP_DESKTOP === '1',
    });

    if (serverStartPromise) {
        return serverStartPromise;
    }

    serverStartPromise = (async () => {
        try {
            // Initialize authentication database
            await initializeDatabase();
            startAgentRunEngine();
            monitorSchedulerService.start();
            meetingReminderService ??= createMeetingReminderService({
                database: db,
                notify: async (reminder) => broadcastMeetingReminder(reminder.userId, reminder),
            });
            meetingReminderService.start();
            piRuntime.native.startAutomations();
            startConfiguredImChannelRuntimes().catch((error) => {
                console.warn('[IM] Failed to start configured IM channel runtimes:', error.message);
            });

            // A secure local Kernel intentionally has no dist/ directory. It
            // is a headless runtime, never a development server or Vite proxy.
            const distIndexPath = path.join(__dirname, '../dist/index.html');
            const runtimeMode = resolveServerRuntimeMode({
                hasBundledApp: fs.existsSync(distIndexPath),
            });
            const isProduction = !runtimeMode.proxyToVite;

            console.log(`${c.info('[INFO]')} Running in ${c.bright(runtimeMode.label)} mode`);

            if (runtimeMode.proxyToVite) {
                console.log(`${c.warn('[WARN]')} Note: Requests will be proxied to Vite dev server at ${c.dim('http://' + DISPLAY_HOST + ':' + getFrontendPortSync(REQUESTED_VITE_PORT))}`);
            }

            const activePort = LOCAL_KERNEL_MODE
                ? await listenOnLocalKernelPort(server, { host: HOST })
                : await listenOnAvailablePort(server, {
                    startPort: REQUESTED_PORT,
                    host: HOST,
                });
            setRuntimePortSync('backend', activePort);
            auditLogDb.create({
                category: 'system',
                event: 'server_started',
                message: `服务已启动，监听端口 ${activePort}`,
                metadata: { runtimeMode: runtimeMode.label },
            });
            globalThis.__MEDHELP_LOCAL_KERNEL_ADDRESS__ = {
                host: HOST,
                port: activePort,
            };

            let localKernelRuntimeFile = null;
            if (LOCAL_KERNEL_MODE) {
                const localKernelControlToken = crypto.randomBytes(32).toString('base64url');
                localKernelRuntimeFile = await writeLocalKernelRuntimeFile({
                    version: resolveAppVersion(),
                    host: HOST,
                    port: activePort,
                    httpUrl: `http://${HOST === '::1' ? '[::1]' : HOST}:${activePort}`,
                    wsUrl: `ws://${HOST === '::1' ? '[::1]' : HOST}:${activePort}/ws/local`,
                    controlToken: localKernelControlToken,
                });
                await completeKernelUpdateIfCurrent();
                globalThis.__MEDHELP_LOCAL_KERNEL_CONTROL_TOKEN__ = localKernelControlToken;
                globalThis.__MEDHELP_REQUEST_LOCAL_KERNEL_SHUTDOWN__ = async () => {
                    try {
                        await stopServer();
                    } finally {
                        setTimeout(() => process.exit(0), 25);
                    }
                };
            }

            const appInstallPath = path.join(__dirname, '..');
            const vitePort = getFrontendPortSync(REQUESTED_VITE_PORT);

            if (!LOCAL_KERNEL_MODE && activePort !== REQUESTED_PORT) {
                console.log(`${c.warn('[WARN]')} Port ${REQUESTED_PORT} is busy, switched backend to ${activePort}`);
            }

            console.log('');
            console.log(c.dim('═'.repeat(63)));
            console.log(`  ${c.bright('medhelp Server - Ready')}`);
            console.log(c.dim('═'.repeat(63)));
            console.log('');

            if (LOCAL_KERNEL_MODE) {
                console.log(`${c.info('[INFO]')} Local Kernel URL: ${c.bright('http://' + DISPLAY_HOST + ':' + activePort)}`);
                console.log(`${c.info('[INFO]')} Runtime file:     ${c.dim(localKernelRuntimeFile)}`);
            } else if (isProduction) {
                console.log(`${c.info('[INFO]')} Server URL:  ${c.bright('http://' + DISPLAY_HOST + ':' + activePort)}`);
            } else {
                console.log(`${c.info('[INFO]')} Backend URL: ${c.dim('http://' + DISPLAY_HOST + ':' + activePort)}`);
                console.log(`${c.ok('[OK]')}   Frontend URL: ${c.bright('http://' + DISPLAY_HOST + ':' + vitePort)} (Use this for development)`);
            }

            console.log(`${c.info('[INFO]')} Installed at: ${c.dim(appInstallPath)}`);
            console.log(`${c.tip('[TIP]')}  Run "medhelp status" for full configuration details`);
            console.log('');

            // Ensure the workspaces root directory exists
            const startupWorkspaceRoot = await getWorkspacesRoot();
            await fsPromises.mkdir(startupWorkspaceRoot, { recursive: true });

            // Start watching the projects folder for changes
            await setupProjectsWatcher();

            return {
                server,
                activePort,
                host: DISPLAY_HOST,
                isProduction,
            };
        } catch (error) {
            serverStartPromise = null;
            console.error('[ERROR] Failed to start server:', error);
            if (shouldAutoStartServer) {
                process.exit(1);
            }
            throw error;
        }
    })();

    return serverStartPromise;
}

export async function stopServer() {
    if (!serverStartPromise) {
        return;
    }

    if (serverStopPromise) {
        return serverStopPromise;
    }

    serverStopPromise = (async () => {
        if (LOCAL_KERNEL_MODE) {
            delete globalThis.__MEDHELP_REQUEST_LOCAL_KERNEL_SHUTDOWN__;
            delete globalThis.__MEDHELP_LOCAL_KERNEL_CONTROL_TOKEN__;
            await removeLocalKernelRuntimeFile(process.pid).catch((error) => {
                console.warn('[WARN] Failed to remove Local Kernel runtime file:', error.message);
            });
        }
        if (projectsWatcherDebounceTimer) {
            clearTimeout(projectsWatcherDebounceTimer);
            projectsWatcherDebounceTimer = null;
        }

        await Promise.all(
            projectsWatchers.map(async (watcher) => {
                try {
                    await watcher.close();
                } catch (error) {
                    console.error('[WARN] Failed to close watcher during shutdown:', error);
                }
            })
        );
        projectsWatchers = [];

        monitorSchedulerService.stop();
        meetingReminderService?.stop();
        terminateAllPtySessions();
        beginAgentRunEngineDrain();
        await abortActiveInteractiveSessions();
        await shutdownAgentRuntimes();
        await stopAgentRunEngine({ drainMs: 5_000 });
        await closeAllWebSocketClients();

        if (server.listening) {
            await new Promise((resolve, reject) => {
                server.close((error) => {
                    if (error) {
                        reject(error);
                        return;
                    }
                    resolve();
                });
            });
        }

        if (typeof server.closeIdleConnections === 'function') {
            server.closeIdleConnections();
        }
        if (typeof server.closeAllConnections === 'function') {
            server.closeAllConnections();
        }

        serverStartPromise = null;
        serverStopPromise = null;
    })();

    return serverStopPromise;
}

export async function restartServer() {
    if (serverRestartPromise) {
        return serverRestartPromise;
    }

    serverRestartPromise = (async () => {
        try {
            await stopServer();
            await wait(150);
            return await startServer();
        } finally {
            serverRestartPromise = null;
        }
    })();

    return serverRestartPromise;
}

if (shouldAutoStartServer) {
    startServer();
}
