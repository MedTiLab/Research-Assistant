import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import { X, Plus, Settings as SettingsIcon, Shield, AlertTriangle, Moon, Sun, Server, Edit3, Trash2, Globe, Terminal, Zap, FolderOpen, LogIn, Key, Check, RefreshCcw, Cpu, Brain, Bot, MessageSquare, Loader2, Eye, EyeOff, HardDrive, PackageOpen, Upload, Volume2, Type, Menu } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { useTranslation } from 'react-i18next';
import LoginModal from './LoginModal';
import { authenticatedFetch, api } from '../utils/api';
import { writeCliAvailability } from '../utils/cliAvailability';
import { fetchWithLocalNetworkAccess } from '../utils/localNetworkAccess';
import { SHELL_RESTART_EVENT } from '../constants/events';
import { useUiPreferences } from '../hooks/useUiPreferences';
import { useOptionalLocalKernel } from '../state/localKernelStore';
import { playTaskCompletionSound } from '../utils/taskCompletionSound';

// New settings components
import {
  AGENT_CATEGORY_LABEL_KEYS,
  AGENT_SETTINGS,
  getAgentSettings,
} from './settings/agentSettingsConfig';
import ConnectorsContent from './settings/ConnectorsContent';
import UnifiedMemorySettingsContent from './settings/UnifiedMemorySettingsContent';
import PermissionsContent from './settings/PermissionsContent';
import AgentServicesSettings from './settings/AgentServicesSettings';
import ComputeSettingsContent from './settings/ComputeSettingsContent';
import TrashSettingsContent from './settings/TrashSettingsContent';
import UserAccountContent from './settings/UserAccountContent';
import ImChannelsContent from './settings/ImChannelsContent';
import TokenUsageSettingsContent from './settings/TokenUsageSettingsContent';
import PiProviderSettingsContent from './settings/PiProviderSettingsContent';
import PiMcpSettings from './settings/PiMcpSettings';
import LanguageSelector from './LanguageSelector';

const VALID_SETTINGS_TABS = new Set(['user', 'im', 'trash', 'compute', 'dataPaths', 'agents', 'mcp', 'memory', 'email', 'appearance', 'git', 'tokens', 'api']);
const SETTINGS_NAV_WIDTH_KEY = 'med-help-settings-nav-width';
const SETTINGS_NAV_MIN = 220;
const SETTINGS_NAV_MAX = 440;
const SETTINGS_NAV_DEFAULT = 288;

function readSettingsNavWidth() {
  if (typeof window === 'undefined') {
    return SETTINGS_NAV_DEFAULT;
  }
  const parsed = Number.parseInt(window.localStorage.getItem(SETTINGS_NAV_WIDTH_KEY) || '', 10);
  if (!Number.isFinite(parsed)) {
    return SETTINGS_NAV_DEFAULT;
  }
  return Math.min(SETTINGS_NAV_MAX, Math.max(SETTINGS_NAV_MIN, parsed));
}
const normalizeSettingsTab = (tab) => {
  if (tab === 'models') return 'agents';
  if (tab === 'plugins' || tab === 'mcpServers') return 'mcp';
  if (tab === 'git' || tab === 'email') return 'api';
  if (tab === 'paths' || tab === 'path' || tab === 'data' || tab === 'dataPaths') return 'dataPaths';
  if (tab === 'personalization') return 'user';
  if (tab === 'preferences') return 'memory';
  return tab;
};
const APP_RESTART_TIMEOUT_MS = 30_000;
const APP_RESTART_POLL_INTERVAL_MS = 750;
const DEFAULT_CODEX_PERMISSION_MODE = 'bypassPermissions';
const normalizeCodexPermissionMode = (mode) =>
  ['default', 'acceptEdits', 'bypassPermissions'].includes(mode)
    ? (mode === 'bypassPermissions' ? mode : DEFAULT_CODEX_PERMISSION_MODE)
    : DEFAULT_CODEX_PERMISSION_MODE;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function SettingsToggle({ checked, onChange, ariaLabel }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className="relative inline-flex h-8 w-14 flex-shrink-0 items-center rounded-full bg-gray-200 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 dark:bg-gray-700 dark:focus:ring-offset-gray-900"
    >
      <span
        className={`inline-block h-6 w-6 transform rounded-full bg-white shadow-lg transition-transform duration-200 ${
          checked ? 'translate-x-7' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

function SegmentedValueSelector({ label, value, options, onChange, suffix }) {
  return (
    <div
      className="grid w-max min-w-full overflow-hidden rounded-lg border border-border bg-background"
      role="group"
      aria-label={label}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(3.5rem, 1fr))` }}
    >
      {options.map((option) => {
        const isActive = Number(value) === Number(option);
        return (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            aria-pressed={isActive}
            className={`border-l border-border px-3 py-2 text-sm font-semibold tabular-nums transition-colors first:border-l-0 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${
              isActive
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground'
            }`}
          >
            {option}{suffix}
          </button>
        );
      })}
    </div>
  );
}

function FontSettingsPanel({
  t,
  uiFontScale,
  setUiFontScale,
  chatFontScale,
  setChatFontScale,
  fontScaleOptions,
  codeEditorFontSize,
  setCodeEditorFontSize,
  codeEditorPreviewFontSize,
  setCodeEditorPreviewFontSize,
}) {
  const rows = [
    {
      key: 'interface',
      label: t('appearanceSettings.fontScale.interface.label'),
      description: t('appearanceSettings.fontScale.interface.description'),
      value: uiFontScale,
      options: fontScaleOptions,
      suffix: '%',
      onChange: setUiFontScale,
    },
    {
      key: 'chat',
      label: t('appearanceSettings.fontScale.chat.label'),
      description: t('appearanceSettings.fontScale.chat.description'),
      value: chatFontScale,
      options: fontScaleOptions,
      suffix: '%',
      onChange: setChatFontScale,
    },
    {
      key: 'editor',
      label: t('appearanceSettings.codeEditor.fontSize.label'),
      description: t('appearanceSettings.codeEditor.fontSize.description'),
      value: codeEditorFontSize,
      options: [10, 11, 12, 13, 14, 15, 16, 18, 20],
      suffix: 'px',
      onChange: (option) => setCodeEditorFontSize(String(option)),
    },
    {
      key: 'preview',
      label: t('appearanceSettings.codeEditor.previewFontSize.label'),
      description: t('appearanceSettings.codeEditor.previewFontSize.description'),
      value: codeEditorPreviewFontSize,
      options: [14, 15, 16, 17, 18, 20, 22],
      suffix: 'px',
      onChange: (option) => setCodeEditorPreviewFontSize(String(option)),
    },
  ];

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/50">
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-center gap-2 font-medium text-foreground">
          <Type className="h-4 w-4 text-muted-foreground" />
          {t('appearanceSettings.fontScale.title')}
        </div>
        <div className="mt-1 text-sm text-muted-foreground">
          {t('appearanceSettings.fontScale.description')}
        </div>
      </div>

      <div className="divide-y divide-border px-4">
        {rows.map((row) => (
          <div
            key={row.key}
            className="grid gap-3 py-4 xl:grid-cols-[minmax(9rem,12rem)_minmax(0,1fr)] xl:items-center xl:gap-4"
          >
            <div className="shrink-0">
              <div className="font-medium text-foreground">{row.label}</div>
              <div className="text-sm text-muted-foreground">{row.description}</div>
            </div>
            <div className="overflow-x-auto pb-1 xl:pb-0">
              <SegmentedValueSelector
                label={row.label}
                value={row.value}
                options={row.options}
                suffix={row.suffix}
                onChange={row.onChange}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

async function waitForBackendReady(timeoutMs = APP_RESTART_TIMEOUT_MS) {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await api.auth.status();
      if (response.ok) {
        return;
      }
    } catch {
      // Ignore transient failures while the backend is restarting.
    }

    await wait(APP_RESTART_POLL_INTERVAL_MS);
  }

  throw new Error('Timed out waiting for backend restart');
}

function Settings({ isOpen, onClose, projects = [], initialTab = 'user', onMenuClick }) {
  const {
    isDarkMode,
    toggleDarkMode,
    accent,
    setAccent,
    accentThemes,
    uiFontScale,
    setUiFontScale,
    chatFontScale,
    setChatFontScale,
    fontScaleOptions,
  } = useTheme();
  const { t } = useTranslation('settings');
  const { preferences, setPreference } = useUiPreferences();
  const localKernel = useOptionalLocalKernel();
  const localKernelHttpBaseUrl = localKernel?.state === 'connected' ? localKernel.endpoint?.httpBaseUrl : null;
  const localKernelSessionToken = localKernel?.state === 'connected' ? localKernel.sessionToken : null;
  const desktopAppVersion = window.medhelpDesktop?.version?.trim() || null;
  const navRef = useRef(null);
  const isResizingNav = useRef(false);
  const [navWidth, setNavWidth] = useState(readSettingsNavWidth);
  const [isNavResizing, setIsNavResizing] = useState(false);
  const [allowedTools, setAllowedTools] = useState([]);
  const [disallowedTools, setDisallowedTools] = useState([]);
  const [newAllowedTool, setNewAllowedTool] = useState('');
  const [newDisallowedTool, setNewDisallowedTool] = useState('');
  const [skipPermissions, setSkipPermissions] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);
  const [projectSortOrder, setProjectSortOrder] = useState('date');

  const [mcpServers, setMcpServers] = useState([]);
  const [showMcpForm, setShowMcpForm] = useState(false);
  const [editingMcpServer, setEditingMcpServer] = useState(null);
  const [mcpFormData, setMcpFormData] = useState({
    name: '',
    type: 'stdio',
    scope: 'user',
    projectPath: '', // For local scope
    config: {
      command: '',
      args: [],
      env: {},
      url: '',
      headers: {},
      timeout: 30000
    },
    jsonInput: '', // For JSON import
    importMode: 'form' // 'form', 'json', or 'bundle'
  });
  const [mcpBundleFile, setMcpBundleFile] = useState(null);
  const [mcpLoading, setMcpLoading] = useState(false);
  const [mcpTestResults, setMcpTestResults] = useState({});
  const [mcpServerTools, setMcpServerTools] = useState({});
  const [mcpToolsLoading, setMcpToolsLoading] = useState({});
  const [activeTab, setActiveTab] = useState(() => {
    const normalized = normalizeSettingsTab(initialTab);
    return VALID_SETTINGS_TABS.has(normalized) ? normalized : 'user';
  });
  const [jsonValidationError, setJsonValidationError] = useState('');
  const [selectedAgent, setSelectedAgent] = useState(AGENT_SETTINGS[0].id);
  const [selectedCategory, setSelectedCategory] = useState(AGENT_SETTINGS[0].categories[0]);

  // Code Editor settings
  const [codeEditorTheme, setCodeEditorTheme] = useState(() =>
    localStorage.getItem('codeEditorTheme') || 'dark'
  );
  const [codeEditorWordWrap, setCodeEditorWordWrap] = useState(() =>
    localStorage.getItem('codeEditorWordWrap') === 'true'
  );
  const [codeEditorShowMinimap, setCodeEditorShowMinimap] = useState(() =>
    localStorage.getItem('codeEditorShowMinimap') !== 'false' // Default true
  );
  const [codeEditorLineNumbers, setCodeEditorLineNumbers] = useState(() =>
    localStorage.getItem('codeEditorLineNumbers') !== 'false' // Default true
  );
  const [codeEditorFontSize, setCodeEditorFontSize] = useState(() =>
    localStorage.getItem('codeEditorFontSize') || '14'
  );
  const [codeEditorPreviewFontSize, setCodeEditorPreviewFontSize] = useState(() =>
    localStorage.getItem('codeEditorPreviewFontSize') || '16'
  );
  const [isRestarting, setIsRestarting] = useState(false);

  // Workspace root settings
  const [workspaceRoot, setWorkspaceRoot] = useState('');
  const [workspaceRootDefault, setWorkspaceRootDefault] = useState('');
  const [workspaceRootDraft, setWorkspaceRootDraft] = useState('');
  const [workspaceRootSaved, setWorkspaceRootSaved] = useState(false);
  const [workspaceRootError, setWorkspaceRootError] = useState('');
  const [workspaceRootSaving, setWorkspaceRootSaving] = useState(false);
  const [workspaceBrowserOpen, setWorkspaceBrowserOpen] = useState(false);
  const [workspaceBrowserCurrentPath, setWorkspaceBrowserCurrentPath] = useState('');
  const [workspaceBrowserCurrentDisplayPath, setWorkspaceBrowserCurrentDisplayPath] = useState('');
  const [workspaceBrowserParentPath, setWorkspaceBrowserParentPath] = useState('');
  const [workspaceBrowserIsVirtualRoot, setWorkspaceBrowserIsVirtualRoot] = useState(false);
  const [workspaceBrowserDrivesRootPath, setWorkspaceBrowserDrivesRootPath] = useState('');
  const [workspaceBrowserFolders, setWorkspaceBrowserFolders] = useState([]);
  const [workspaceBrowserLoading, setWorkspaceBrowserLoading] = useState(false);
  const [workspaceBrowserError, setWorkspaceBrowserError] = useState('');
  const [workspaceBrowserShowHidden, setWorkspaceBrowserShowHidden] = useState(false);
  const [workspaceBrowserShowNewFolder, setWorkspaceBrowserShowNewFolder] = useState(false);
  const [workspaceBrowserNewFolderName, setWorkspaceBrowserNewFolderName] = useState('');
  const [workspaceBrowserCreatingFolder, setWorkspaceBrowserCreatingFolder] = useState(false);
  const [dataPathLoading, setDataPathLoading] = useState(false);
  const [dataPathSaving, setDataPathSaving] = useState(false);
  const [dataPathError, setDataPathError] = useState('');
  const [dataPathSaved, setDataPathSaved] = useState(false);
  const workspaceRootUsesLocalKernel = Boolean(localKernelHttpBaseUrl && localKernelSessionToken);
  const workspaceRootWaitingForLocalKernel = Boolean(localKernel?.isRequired && !workspaceRootUsesLocalKernel);

  const getHomePrefixFromPath = (value) => {
    const match = String(value || '').replace(/\\/g, '/').match(/^\/(Users|home)\/[^/]+/);
    return match?.[0] || '';
  };

  const displayWorkspacePath = (value, displayValue = '') => {
    if (displayValue) {
      return displayValue;
    }

    const normalized = String(value || '').replace(/\\/g, '/');
    return normalized.replace(/^\/(Users|home)\/[^/]+/, '~') || '~';
  };

  const resolveDisplayedWorkspacePath = (value) => {
    const rawValue = String(value || '').trim();
    if (!rawValue.startsWith('~')) {
      return rawValue;
    }

    const homePrefix = getHomePrefixFromPath(workspaceRoot || workspaceRootDefault);
    return homePrefix ? `${homePrefix}${rawValue.slice(1)}` : rawValue;
  };

  const fetchWorkspaceRootSetting = () => {
    if (workspaceRootUsesLocalKernel) {
      return fetchWithLocalNetworkAccess(`${localKernelHttpBaseUrl}/api/local/projects/workspace-root`, {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${localKernelSessionToken}` },
      });
    }
    return api.getWorkspaceRoot();
  };

  const updateWorkspaceRootSetting = (nextPath) => {
    if (workspaceRootUsesLocalKernel) {
      return fetchWithLocalNetworkAccess(`${localKernelHttpBaseUrl}/api/local/projects/workspace-root`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${localKernelSessionToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ path: nextPath || null }),
      });
    }
    return api.setWorkspaceRoot(nextPath || null);
  };

  const applyWorkspaceRootPayload = (data = {}) => {
    const nextPath = data.path || '';
    const nextDefaultPath = data.defaultPath || workspaceRootDefault || '';
    const nextDisplay = data.displayPath
      || data.displayRoot
      || displayWorkspacePath(nextPath || nextDefaultPath);

    setWorkspaceRoot(nextPath);
    setWorkspaceRootDefault(nextDefaultPath);
    setWorkspaceRootDraft(nextDisplay);
  };
  
  // Codex-specific states
  const [codexMcpServers, setCodexMcpServers] = useState([]);
  const [codexPermissionMode, setCodexPermissionMode] = useState(DEFAULT_CODEX_PERMISSION_MODE);
  const [showCodexMcpForm, setShowCodexMcpForm] = useState(false);

  const [codexMcpFormData, setCodexMcpFormData] = useState({
    name: '',
    type: 'stdio',
    config: {
      command: '',
      args: [],
      env: {}
    }
  });
  const [editingCodexMcpServer, setEditingCodexMcpServer] = useState(null);
  const [codexMcpLoading, setCodexMcpLoading] = useState(false);

  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loginProvider, setLoginProvider] = useState('');
  const [selectedProject, setSelectedProject] = useState(null);

  const [claudeAuthStatus, setClaudeAuthStatus] = useState({
    authenticated: false,
    email: null,
    cliAvailable: true,
    cliCommand: 'claude',
    installHint: null,
    loading: true,
    error: null
  });
  const [piAuthStatus, setPiAuthStatus] = useState({
    authenticated: false,
    configured: false,
    email: null,
    cliAvailable: true,
    cliCommand: 'pi',
    installHint: null,
    loading: true,
    error: null
  });
  const [codexAuthStatus, setCodexAuthStatus] = useState({
    authenticated: false,
    email: null,
    cliAvailable: true,
    cliCommand: 'codex',
    installHint: null,
    loading: true,
    error: null
  });
  const handleRestartApp = async () => {
    if (isRestarting) {
      return;
    }

    setIsRestarting(true);

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event(SHELL_RESTART_EVENT));
    }

    try {
      if (window.medhelpDesktop?.restartApp) {
        await window.medhelpDesktop.restartApp();
        return;
      }

      const response = await api.system.restart();
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || 'Failed to restart backend');
      }

      await waitForBackendReady();
      window.location.reload();
    } catch (error) {
      console.error('Failed to restart app from settings:', error);
      setIsRestarting(false);
      window.alert(t('appearanceSettings.appRestart.failed'));
    }
  };

  const buildDefaultAuthState = (overrides = {}) => ({
    authenticated: false,
    email: null,
    cliAvailable: true,
    cliCommand: null,
    installHint: null,
    directApi: null,
    loading: false,
    error: null,
    ...overrides
  });

  // Common tool patterns for Claude
  const commonTools = [
    'Bash(git log:*)',
    'Bash(git diff:*)',
    'Bash(git status:*)',
    'Write',
    'Read',
    'Edit',
    'Glob',
    'Grep',
    'MultiEdit',
    'Task',
    'TodoWrite',
    'TodoRead',
    'WebFetch',
    'WebSearch'
  ];
  
  const fetchCodexMcpServers = async () => {
    try {
      const configResponse = await authenticatedFetch('/api/codex/mcp/config/read');

      if (configResponse.ok) {
        const configData = await configResponse.json();
        if (configData.success && configData.servers) {
          setCodexMcpServers(configData.servers);
          return;
        }
      }

      const cliResponse = await authenticatedFetch('/api/codex/mcp/cli/list');

      if (cliResponse.ok) {
        const cliData = await cliResponse.json();
        if (cliData.success && cliData.servers) {
          const servers = cliData.servers.map(server => ({
            id: server.name,
            name: server.name,
            type: server.type || 'stdio',
            scope: 'user',
            config: {
              command: server.command || '',
              args: server.args || [],
              env: server.env || {}
            }
          }));
          setCodexMcpServers(servers);
        }
      }
    } catch (error) {
      console.error('Error fetching Codex MCP servers:', error);
    }
  };

  const fetchClaudeMcpSettingsApi = (endpoint, options = {}) => {
    if (localKernelHttpBaseUrl && localKernelSessionToken) {
      const headers = {
        Authorization: `Bearer ${localKernelSessionToken}`,
        ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...(options.headers || {}),
      };
      return fetchWithLocalNetworkAccess(`${localKernelHttpBaseUrl}/api/local/mcp${endpoint}`, {
        ...options,
        headers,
      });
    }
    return authenticatedFetch(`/api/mcp${endpoint}`, options);
  };

  // MCP API functions
  const fetchMcpServers = async () => {
    try {
      // Try to read directly from config files for complete details
      const configResponse = await fetchClaudeMcpSettingsApi('/config/read');

      if (configResponse.ok) {
        const configData = await configResponse.json();
        if (configData.success && configData.servers) {
          setMcpServers(configData.servers);
          return;
        }
      }

      // Fallback to Claude CLI
      const cliResponse = await fetchClaudeMcpSettingsApi('/cli/list');

      if (cliResponse.ok) {
        const cliData = await cliResponse.json();
        if (cliData.success && cliData.servers) {
          // Convert CLI format to our format
          const servers = cliData.servers.map(server => ({
            id: server.name,
            name: server.name,
            type: server.type,
            scope: 'user',
            config: {
              command: server.command || '',
              args: server.args || [],
              env: server.env || {},
              url: server.url || '',
              headers: server.headers || {},
              timeout: 30000
            },
            created: new Date().toISOString(),
            updated: new Date().toISOString()
          }));
          setMcpServers(servers);
          return;
        }
      }

      // Final fallback to direct config reading
      const response = await fetchClaudeMcpSettingsApi('/servers?scope=user');

      if (response.ok) {
        const data = await response.json();
        setMcpServers(data.servers || []);
      } else {
        console.error('Failed to fetch MCP servers');
      }
    } catch (error) {
      console.error('Error fetching MCP servers:', error);
    }
  };

  const saveMcpServer = async (serverData) => {
    try {
      if (editingMcpServer) {
        // For editing, remove old server and add new one
        await deleteMcpServer(editingMcpServer.id, 'user');
      }

      // Use Claude CLI to add the server
      const response = await fetchClaudeMcpSettingsApi('/cli/add', {
        method: 'POST',
        body: JSON.stringify({
          name: serverData.name,
          type: serverData.type,
          scope: serverData.scope,
          projectPath: serverData.projectPath,
          command: serverData.config?.command,
          args: serverData.config?.args || [],
          url: serverData.config?.url,
          headers: serverData.config?.headers || {},
          env: serverData.config?.env || {}
        })
      });

      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          await fetchMcpServers(); // Refresh the list
          return true;
        } else {
          throw new Error(result.error || 'Failed to save server via Claude CLI');
        }
      } else {
        const error = await response.json();
        throw new Error(error.error || 'Failed to save server');
      }
    } catch (error) {
      console.error('Error saving MCP server:', error);
      throw error;
    }
  };

  const deleteMcpServer = async (serverId, scope = 'user') => {
    try {
      // Use Claude CLI to remove the server with proper scope
      const response = await fetchClaudeMcpSettingsApi(`/cli/remove/${serverId}?scope=${scope}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          await fetchMcpServers(); // Refresh the list
          return true;
        } else {
          throw new Error(result.error || 'Failed to delete server via Claude CLI');
        }
      } else {
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete server');
      }
    } catch (error) {
      console.error('Error deleting MCP server:', error);
      throw error;
    }
  };

  const testMcpServer = async (serverId, scope = 'user') => {
    try {
      const response = await fetchClaudeMcpSettingsApi(`/servers/${serverId}/test?scope=${scope}`, {
        method: 'POST'
      });

      if (response.ok) {
        const data = await response.json();
        return data.testResult;
      } else {
        const error = await response.json();
        throw new Error(error.error || 'Failed to test server');
      }
    } catch (error) {
      console.error('Error testing MCP server:', error);
      throw error;
    }
  };


  const discoverMcpTools = async (serverId, scope = 'user') => {
    try {
      const response = await fetchClaudeMcpSettingsApi(`/servers/${serverId}/tools?scope=${scope}`, {
        method: 'POST'
      });

      if (response.ok) {
        const data = await response.json();
        return data.toolsResult;
      } else {
        const error = await response.json();
        throw new Error(error.error || 'Failed to discover tools');
      }
    } catch (error) {
      console.error('Error discovering MCP tools:', error);
      throw error;
    }
  };

  const saveCodexMcpServer = async (serverData) => {
    try {
      if (editingCodexMcpServer) {
        await deleteCodexMcpServer(editingCodexMcpServer.id);
      }

      const response = await authenticatedFetch('/api/codex/mcp/cli/add', {
        method: 'POST',
        body: JSON.stringify({
          name: serverData.name,
          command: serverData.config?.command,
          args: serverData.config?.args || [],
          env: serverData.config?.env || {}
        })
      });

      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          await fetchCodexMcpServers();
          return true;
        } else {
          throw new Error(result.error || 'Failed to save Codex MCP server');
        }
      } else {
        const error = await response.json();
        throw new Error(error.error || 'Failed to save server');
      }
    } catch (error) {
      console.error('Error saving Codex MCP server:', error);
      throw error;
    }
  };

  const deleteCodexMcpServer = async (serverId) => {
    try {
      const response = await authenticatedFetch(`/api/codex/mcp/cli/remove/${serverId}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          await fetchCodexMcpServers();
          return true;
        } else {
          throw new Error(result.error || 'Failed to delete Codex MCP server');
        }
      } else {
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete server');
      }
    } catch (error) {
      console.error('Error deleting Codex MCP server:', error);
      throw error;
    }
  };

  const resetCodexMcpForm = () => {
    setCodexMcpFormData({
      name: '',
      type: 'stdio',
      config: {
        command: '',
        args: [],
        env: {}
      }
    });
    setEditingCodexMcpServer(null);
    setShowCodexMcpForm(false);
  };

  const openCodexMcpForm = (server = null) => {
    if (server) {
      setEditingCodexMcpServer(server);
      setCodexMcpFormData({
        name: server.name,
        type: server.type || 'stdio',
        config: {
          command: server.config?.command || '',
          args: server.config?.args || [],
          env: server.config?.env || {}
        }
      });
    } else {
      resetCodexMcpForm();
    }
    setShowCodexMcpForm(true);
  };

  const handleCodexMcpSubmit = async (e) => {
    e.preventDefault();
    setCodexMcpLoading(true);

    try {
      if (editingCodexMcpServer) {
        // Delete old server first, then add new one
        await deleteCodexMcpServer(editingCodexMcpServer.name);
      }
      await saveCodexMcpServer(codexMcpFormData);
      resetCodexMcpForm();
      setSaveStatus('success');
    } catch (error) {
      alert(`Error: ${error.message}`);
      setSaveStatus('error');
    } finally {
      setCodexMcpLoading(false);
    }
  };

  const handleCodexMcpDelete = async (serverName) => {
    if (confirm('Are you sure you want to delete this MCP server?')) {
      try {
        await deleteCodexMcpServer(serverName);
        setSaveStatus('success');
      } catch (error) {
        alert(`Error: ${error.message}`);
        setSaveStatus('error');
      }
    }
  };

  const fetchCliStatus = async (provider) => {
    if (localKernelHttpBaseUrl && localKernelSessionToken) {
      return fetchWithLocalNetworkAccess(`${localKernelHttpBaseUrl}/api/local/cli/${provider}/status`, {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${localKernelSessionToken}` },
      });
    }
    return authenticatedFetch(`/api/cli/${provider}/status`);
  };

  const fetchPiApi = useCallback((path, options = {}) => {
    if (localKernelHttpBaseUrl && localKernelSessionToken) {
      return fetchWithLocalNetworkAccess(`${localKernelHttpBaseUrl}/api/local/pi${path}`, {
        ...options,
        headers: {
          ...(options.headers || {}),
          Authorization: `Bearer ${localKernelSessionToken}`,
        },
      });
    }
    return authenticatedFetch(`/api/pi${path}`, options);
  }, [localKernelHttpBaseUrl, localKernelSessionToken]);

  useEffect(() => {
    if (isOpen) {
      loadSettings();
      checkPiAuthStatus();
      const normalized = normalizeSettingsTab(initialTab);
      setActiveTab(VALID_SETTINGS_TABS.has(normalized) ? normalized : 'user');
      if (initialTab === 'models') {
        setSelectedAgent('pi');
        setSelectedCategory('models');
      }
    }
  }, [isOpen, initialTab, localKernel?.isRequired, localKernelHttpBaseUrl, localKernelSessionToken]);

  useEffect(() => {
    if (activeTab !== 'agents') return;
    const agent = getAgentSettings(selectedAgent);
    if (selectedCategory === 'memory' || !agent.categories.includes(selectedCategory)) {
      setSelectedCategory(agent.categories[0]);
    }
  }, [activeTab, selectedAgent, selectedCategory]);

  // Persist code editor settings to localStorage
  useEffect(() => {
    localStorage.setItem('codeEditorTheme', codeEditorTheme);
    window.dispatchEvent(new Event('codeEditorSettingsChanged'));
  }, [codeEditorTheme]);

  useEffect(() => {
    localStorage.setItem('codeEditorWordWrap', codeEditorWordWrap.toString());
    window.dispatchEvent(new Event('codeEditorSettingsChanged'));
  }, [codeEditorWordWrap]);

  useEffect(() => {
    localStorage.setItem('codeEditorShowMinimap', codeEditorShowMinimap.toString());
    window.dispatchEvent(new Event('codeEditorSettingsChanged'));
  }, [codeEditorShowMinimap]);

  useEffect(() => {
    localStorage.setItem('codeEditorLineNumbers', codeEditorLineNumbers.toString());
    window.dispatchEvent(new Event('codeEditorSettingsChanged'));
  }, [codeEditorLineNumbers]);

  useEffect(() => {
    localStorage.setItem('codeEditorFontSize', codeEditorFontSize);
    window.dispatchEvent(new Event('codeEditorSettingsChanged'));
  }, [codeEditorFontSize]);

  useEffect(() => {
    localStorage.setItem('codeEditorPreviewFontSize', codeEditorPreviewFontSize);
    window.dispatchEvent(new Event('codeEditorSettingsChanged'));
  }, [codeEditorPreviewFontSize]);

  const loadSettings = async () => {
    try {
      
      // Load Claude settings from localStorage
      const savedSettings = localStorage.getItem('claude-settings');
      
      if (savedSettings) {
        const settings = JSON.parse(savedSettings);
        setAllowedTools(settings.allowedTools || []);
        setDisallowedTools(settings.disallowedTools || []);
        setSkipPermissions(settings.skipPermissions || false);
        setProjectSortOrder(settings.projectSortOrder || 'date');
      } else {
        // Set defaults
        setAllowedTools([]);
        setDisallowedTools([]);
        setSkipPermissions(false);
        setProjectSortOrder('name');
      }
      
      // Load Codex settings from localStorage
      const savedCodexSettings = localStorage.getItem('codex-settings');

      if (savedCodexSettings) {
        const codexSettings = JSON.parse(savedCodexSettings);
        setCodexPermissionMode(normalizeCodexPermissionMode(codexSettings.permissionMode));
      } else {
        setCodexPermissionMode(DEFAULT_CODEX_PERMISSION_MODE);
      }

      await loadDataPathSettings({ silent: true });

      // Load MCP servers from API
      await fetchMcpServers();

      // Load Codex MCP servers
      await fetchCodexMcpServers();

    } catch (error) {
      console.error('Error loading tool settings:', error);
      setAllowedTools([]);
      setDisallowedTools([]);
      setSkipPermissions(false);
      setProjectSortOrder('name');
    }
  };

  const loadDataPathSettings = async ({ silent = false } = {}) => {
    if (workspaceRootWaitingForLocalKernel) {
      return;
    }

    if (!silent) {
      setDataPathLoading(true);
      setDataPathError('');
      setDataPathSaved(false);
    }

    try {
      const response = await fetchWorkspaceRootSetting();
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || t('dataPathSettings.errors.loadFailed'));
      }
      applyWorkspaceRootPayload(data);
    } catch (error) {
      console.error('Error loading data path settings:', error);
      if (!silent) {
        setDataPathError(error.message || t('dataPathSettings.errors.loadFailed'));
      }
    } finally {
      if (!silent) {
        setDataPathLoading(false);
      }
    }
  };

  const checkClaudeAuthStatus = async () => {
    try {
      const response = await fetchCliStatus('claude');

      if (response.ok) {
        const data = await response.json();
        setClaudeAuthStatus({
          authenticated: data.authenticated,
          email: data.email,
          cliAvailable: data.cliAvailable !== false,
          cliCommand: data.cliCommand || 'claude',
          installHint: data.installHint || null,
          loading: false,
          error: data.error || null
        });
        writeCliAvailability('claude', {
          cliAvailable: data.cliAvailable !== false,
          cliCommand: data.cliCommand || 'claude',
          installHint: data.installHint || null,
        });
      } else {
        setClaudeAuthStatus(buildDefaultAuthState({
          cliCommand: 'claude',
          error: 'Failed to check authentication status'
        }));
      }
    } catch (error) {
      console.error('Error checking Claude auth status:', error);
      setClaudeAuthStatus(buildDefaultAuthState({
        cliCommand: 'claude',
        error: error.message
      }));
    }
  };

  const checkPiAuthStatus = async () => {
    try {
      const response = await fetchCliStatus('pi');
      if (response.ok) {
        const data = await response.json();
        setPiAuthStatus({
          ...data,
          authenticated: Boolean(data.authenticated),
          configured: Boolean(data.configured),
          email: data.email || null,
          cliAvailable: data.cliAvailable !== false,
          cliCommand: data.cliCommand || 'pi',
          installHint: data.installHint || null,
          loading: false,
          error: data.error || null,
        });
      } else {
        setPiAuthStatus(buildDefaultAuthState({
          cliCommand: 'pi',
          error: 'Failed to check medhelpOS runtime status',
        }));
      }
    } catch (error) {
      console.error('Error checking medhelpOS runtime status:', error);
      setPiAuthStatus(buildDefaultAuthState({ cliCommand: 'pi', error: error.message }));
    }
  };

  useEffect(() => {
    if (!isOpen) return undefined;

    const refreshPiStatus = () => {
      void checkPiAuthStatus();
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refreshPiStatus();
    };

    window.addEventListener('focus', refreshPiStatus);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    window.addEventListener('pi-provider-config-changed', refreshPiStatus);

    return () => {
      window.removeEventListener('focus', refreshPiStatus);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      window.removeEventListener('pi-provider-config-changed', refreshPiStatus);
    };
  }, [isOpen, localKernel?.isRequired, localKernelHttpBaseUrl, localKernelSessionToken]);

  const checkCodexAuthStatus = async () => {
    try {
      const response = await fetchCliStatus('codex');

      if (response.ok) {
        const data = await response.json();
        setCodexAuthStatus({
          authenticated: data.authenticated,
          email: data.email,
          cliAvailable: data.cliAvailable !== false,
          cliCommand: data.cliCommand || 'codex',
          installHint: data.installHint || null,
          loading: false,
          error: data.error || null
        });
        writeCliAvailability('codex', {
          cliAvailable: data.cliAvailable !== false,
          cliCommand: data.cliCommand || 'codex',
          installHint: data.installHint || null,
        });
      } else {
        setCodexAuthStatus(buildDefaultAuthState({
          cliCommand: 'codex',
          error: 'Failed to check authentication status'
        }));
      }
    } catch (error) {
      console.error('Error checking Codex auth status:', error);
      setCodexAuthStatus(buildDefaultAuthState({
        cliCommand: 'codex',
        error: error.message
      }));
    }
  };

  const handleClaudeLogin = () => {
    if (claudeAuthStatus.cliAvailable === false) return;
    setLoginProvider('claude');
    setSelectedProject(projects?.[0] || { name: 'default', fullPath: process.cwd() });
    setShowLoginModal(true);
  };

  const handleCodexLogin = () => {
    if (codexAuthStatus.cliAvailable === false) return;
    setLoginProvider('codex');
    setSelectedProject(projects?.[0] || { name: 'default', fullPath: process.cwd() });
    setShowLoginModal(true);
  };

  const handleLoginComplete = (exitCode) => {
    if (exitCode === 0) {
      setSaveStatus('success');

      if (loginProvider === 'claude') {
        checkClaudeAuthStatus();
      } else if (loginProvider === 'codex') {
        checkCodexAuthStatus();
      }
    }
  };

  const saveSettings = () => {
    setIsSaving(true);
    setSaveStatus(null);
    
    try {
      // Save Claude settings
      const claudeSettings = {
        allowedTools,
        disallowedTools,
        skipPermissions,
        projectSortOrder,
        lastUpdated: new Date().toISOString()
      };
      
      // Save Codex settings
      const codexSettings = {
        permissionMode: codexPermissionMode,
        lastUpdated: new Date().toISOString()
      };

      // Save to localStorage
      localStorage.setItem('claude-settings', JSON.stringify(claudeSettings));
      localStorage.setItem('codex-settings', JSON.stringify(codexSettings));

      setSaveStatus('success');
    } catch (error) {
      console.error('Error saving tool settings:', error);
      setSaveStatus('error');
    } finally {
      setIsSaving(false);
    }
  };

  const saveWorkspaceRoot = async (newPath) => {
    setWorkspaceRootError('');
    setDataPathError('');
    setWorkspaceRootSaved(false);
    setWorkspaceRootSaving(true);
    try {
      const nextPath = newPath ? resolveDisplayedWorkspacePath(newPath) : null;
      const response = await updateWorkspaceRootSetting(nextPath);
      const data = await response.json();
      if (response.ok) {
        applyWorkspaceRootPayload(data);
        setWorkspaceRootSaved(true);
        setTimeout(() => setWorkspaceRootSaved(false), 2000);
      } else {
        setWorkspaceRootError(data.error || t('appearanceSettings.defaultProjectPath.invalidPath'));
      }
    } catch (err) {
      setWorkspaceRootError(err.message);
    } finally {
      setWorkspaceRootSaving(false);
    }
  };

  const resetWorkspaceRoot = () => {
    const nextDisplay = displayWorkspacePath(workspaceRootDefault);
    setWorkspaceRootDraft(nextDisplay);
    setWorkspaceRootError('');
    setDataPathError('');
    setWorkspaceRootSaved(false);
    setDataPathSaved(false);
  };

  const saveDataPathSettings = async () => {
    if (dataPathSaving || workspaceRootSaving) {
      return;
    }

    setDataPathSaving(true);
    setWorkspaceRootSaving(true);
    setDataPathError('');
    setWorkspaceRootError('');
    setDataPathSaved(false);
    setWorkspaceRootSaved(false);

    try {
      const nextPath = workspaceRootDraft ? resolveDisplayedWorkspacePath(workspaceRootDraft) : null;
      const rootResponse = await updateWorkspaceRootSetting(nextPath);
      const rootData = await rootResponse.json().catch(() => ({}));
      if (!rootResponse.ok) {
        throw new Error(rootData.error || t('appearanceSettings.defaultProjectPath.invalidPath'));
      }
      applyWorkspaceRootPayload(rootData);

      await window.refreshProjects?.();

      setDataPathSaved(true);
      setWorkspaceRootSaved(true);
      setTimeout(() => {
        setDataPathSaved(false);
        setWorkspaceRootSaved(false);
      }, 2000);
    } catch (error) {
      setDataPathError(error.message || t('dataPathSettings.errors.saveFailed'));
    } finally {
      setDataPathSaving(false);
      setWorkspaceRootSaving(false);
    }
  };

  const isWindowsDriveRootPath = (value) => /^[A-Za-z]:[\\/]?$/.test(String(value || '').trim());

  const appendWorkspacePathSegment = (basePath, segment) => {
    if (!basePath) {
      return segment;
    }
    const separator = basePath.includes('\\') ? '\\' : '/';
    if (basePath.endsWith('/') || basePath.endsWith('\\')) {
      return `${basePath}${segment}`;
    }
    return `${basePath}${separator}${segment}`;
  };

  const fetchWorkspaceBrowserFolders = (dirPath, showHidden = workspaceBrowserShowHidden) => {
    const params = new URLSearchParams();
    if (dirPath) params.set('path', dirPath);
    if (showHidden) params.set('showHidden', 'true');

    if (workspaceRootUsesLocalKernel) {
      return fetchWithLocalNetworkAccess(`${localKernelHttpBaseUrl}/api/local/browse-filesystem?${params.toString()}`, {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${localKernelSessionToken}` },
      });
    }

    return authenticatedFetch(`/api/browse-filesystem?${params.toString()}`);
  };

  const createWorkspaceBrowserFolderRequest = (folderPath) => {
    if (workspaceRootUsesLocalKernel) {
      return fetchWithLocalNetworkAccess(`${localKernelHttpBaseUrl}/api/local/create-folder`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${localKernelSessionToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ path: folderPath }),
      });
    }

    return api.createFolder(folderPath);
  };

  const loadWorkspaceBrowserFolders = async (dirPath, showHidden = workspaceBrowserShowHidden) => {
    setWorkspaceBrowserLoading(true);
    setWorkspaceBrowserError('');
    try {
      const response = await fetchWorkspaceBrowserFolders(dirPath, showHidden);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || t('appearanceSettings.defaultProjectPath.browseFailed'));
      }
      setWorkspaceBrowserCurrentPath(data.path || dirPath || '');
      setWorkspaceBrowserCurrentDisplayPath(data.displayPath || displayWorkspacePath(data.path || dirPath || ''));
      setWorkspaceBrowserParentPath(data.parentPath || '');
      setWorkspaceBrowserIsVirtualRoot(Boolean(data.isVirtualRoot));
      setWorkspaceBrowserDrivesRootPath(data.drivesRootPath || '');
      setWorkspaceBrowserFolders(Array.isArray(data.suggestions) ? data.suggestions : []);
    } catch (error) {
      setWorkspaceBrowserError(error.message || t('appearanceSettings.defaultProjectPath.browseFailed'));
    } finally {
      setWorkspaceBrowserLoading(false);
    }
  };

  const openWorkspaceBrowser = async () => {
    setWorkspaceBrowserOpen(true);
    setWorkspaceBrowserShowNewFolder(false);
    setWorkspaceBrowserNewFolderName('');
    const startPath = workspaceRoot || workspaceRootDefault || '~';
    await loadWorkspaceBrowserFolders(startPath, workspaceBrowserShowHidden);
  };

  const chooseWorkspaceBrowserFolder = (folderPath, folderDisplayPath = '') => {
    const nextDisplay = folderDisplayPath || displayWorkspacePath(folderPath);
    setWorkspaceRootDraft(nextDisplay);
    setWorkspaceRootError('');
    setDataPathSaved(false);
    setWorkspaceBrowserOpen(false);
    setWorkspaceBrowserShowNewFolder(false);
    setWorkspaceBrowserNewFolderName('');
  };

  const createWorkspaceBrowserFolder = async () => {
    const folderName = workspaceBrowserNewFolderName.trim();
    if (!folderName || workspaceBrowserCreatingFolder) {
      return;
    }

    setWorkspaceBrowserCreatingFolder(true);
    setWorkspaceBrowserError('');
    try {
      if (workspaceBrowserIsVirtualRoot) {
        return;
      }
      const folderPath = appendWorkspacePathSegment(workspaceBrowserCurrentPath, folderName);
      const response = await createWorkspaceBrowserFolderRequest(folderPath);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || t('appearanceSettings.defaultProjectPath.createFolderFailed'));
      }
      chooseWorkspaceBrowserFolder(data.path || folderPath, data.displayPath || '');
    } catch (error) {
      setWorkspaceBrowserError(error.message || t('appearanceSettings.defaultProjectPath.createFolderFailed'));
    } finally {
      setWorkspaceBrowserCreatingFolder(false);
    }
  };

  const addAllowedTool = (tool) => {
    if (tool && !allowedTools.includes(tool)) {
      setAllowedTools([...allowedTools, tool]);
      setNewAllowedTool('');
    }
  };

  const removeAllowedTool = (tool) => {
    setAllowedTools(allowedTools.filter(t => t !== tool));
  };

  const addDisallowedTool = (tool) => {
    if (tool && !disallowedTools.includes(tool)) {
      setDisallowedTools([...disallowedTools, tool]);
      setNewDisallowedTool('');
    }
  };

  const removeDisallowedTool = (tool) => {
    setDisallowedTools(disallowedTools.filter(t => t !== tool));
  };

  // MCP form handling functions
  const resetMcpForm = () => {
    setMcpFormData({
      name: '',
      type: 'stdio',
      scope: 'user', // Default to user scope
      projectPath: '',
      config: {
        command: '',
        args: [],
        env: {},
        url: '',
        headers: {},
        timeout: 30000
      },
      jsonInput: '',
      importMode: 'form'
    });
    setEditingMcpServer(null);
    setMcpBundleFile(null);
    setShowMcpForm(false);
    setJsonValidationError('');
  };

  const openMcpForm = (server = null) => {
    setMcpBundleFile(null);
    if (server) {
      setEditingMcpServer(server);
      setMcpFormData({
        name: server.name,
        type: server.type,
        scope: server.scope,
        projectPath: server.projectPath || '',
        config: { ...server.config },
        raw: server.raw, // Store raw config for display
        importMode: 'form', // Always use form mode when editing
        jsonInput: ''
      });
    } else {
      resetMcpForm();
    }
    setShowMcpForm(true);
  };

  const handleMcpSubmit = async (e) => {
    e.preventDefault();
    
    setMcpLoading(true);
    
    try {
      if (mcpFormData.importMode === 'bundle') {
        if (!mcpBundleFile) {
          throw new Error(t('mcpForm.bundle.fileRequired'));
        }
        const uploadData = new FormData();
        uploadData.append('file', mcpBundleFile);
        const response = await fetchClaudeMcpSettingsApi('/bundle/install', {
          method: 'POST',
          body: uploadData,
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.success) {
          throw new Error(result.details || result.error || t('mcpForm.bundle.installFailed'));
        }
        await fetchMcpServers();
        resetMcpForm();
        setSaveStatus('success');
        return;
      }

      if (mcpFormData.importMode === 'json') {
        // Use JSON import endpoint
        const response = await fetchClaudeMcpSettingsApi('/cli/add-json', {
          method: 'POST',
          body: JSON.stringify({
            name: mcpFormData.name,
            jsonConfig: mcpFormData.jsonInput,
            scope: mcpFormData.scope,
            projectPath: mcpFormData.projectPath
          })
        });

        if (response.ok) {
          const result = await response.json();
          if (result.success) {
            await fetchMcpServers(); // Refresh the list
            resetMcpForm();
            setSaveStatus('success');
          } else {
            throw new Error(result.error || 'Failed to add server via JSON');
          }
        } else {
          const error = await response.json();
          throw new Error(error.error || 'Failed to add server');
        }
      } else {
        // Use regular form-based save
        await saveMcpServer(mcpFormData);
        resetMcpForm();
        setSaveStatus('success');
      }
    } catch (error) {
      alert(`Error: ${error.message}`);
      setSaveStatus('error');
    } finally {
      setMcpLoading(false);
    }
  };

  const handleMcpDelete = async (serverId, scope, projectPath = '') => {
    if (confirm('Are you sure you want to delete this MCP server?')) {
      try {
        await deleteMcpServer(serverId, scope);
        setSaveStatus('success');
      } catch (error) {
        alert(`Error: ${error.message}`);
        setSaveStatus('error');
      }
    }
  };

  const handleMcpTest = async (serverId, scope) => {
    try {
      setMcpTestResults({ ...mcpTestResults, [serverId]: { loading: true } });
      const result = await testMcpServer(serverId, scope);
      setMcpTestResults({ ...mcpTestResults, [serverId]: result });
    } catch (error) {
      setMcpTestResults({ 
        ...mcpTestResults, 
        [serverId]: { 
          success: false, 
          message: error.message,
          details: []
        } 
      });
    }
  };

  const handleMcpToolsDiscovery = async (serverId, scope) => {
    try {
      setMcpToolsLoading({ ...mcpToolsLoading, [serverId]: true });
      const result = await discoverMcpTools(serverId, scope);
      setMcpServerTools({ ...mcpServerTools, [serverId]: result });
    } catch (error) {
      setMcpServerTools({ 
        ...mcpServerTools, 
        [serverId]: { 
          success: false, 
          tools: [], 
          resources: [], 
          prompts: [] 
        } 
      });
    } finally {
      setMcpToolsLoading({ ...mcpToolsLoading, [serverId]: false });
    }
  };

  const updateMcpConfig = (key, value) => {
    setMcpFormData(prev => ({
      ...prev,
      config: {
        ...prev.config,
        [key]: value
      }
    }));
  };


  const getTransportIcon = (type) => {
    switch (type) {
      case 'stdio': return <Terminal className="w-4 h-4" />;
      case 'sse': return <Zap className="w-4 h-4" />;
      case 'http': return <Globe className="w-4 h-4" />;
      default: return <Server className="w-4 h-4" />;
    }
  };

  const renderAgentCategoryContent = (agentId, category) => {
    if (agentId === 'pi' && (category === 'api' || category === 'models')) {
      return (
        <PiProviderSettingsContent
          mode={category}
          request={fetchPiApi}
          onConfigurationChange={checkPiAuthStatus}
        />
      );
    }

    if (agentId === 'pi' && category === 'permissions') {
      return <AgentServicesSettings key="permissions" projects={projects} initialSection="permissions" />;
    }

    if (category === 'permissions' && agentId === 'claude') {
      return (
        <PermissionsContent
          agent="claude"
          skipPermissions={skipPermissions}
          setSkipPermissions={setSkipPermissions}
          allowedTools={allowedTools}
          setAllowedTools={setAllowedTools}
          disallowedTools={disallowedTools}
          setDisallowedTools={setDisallowedTools}
          newAllowedTool={newAllowedTool}
          setNewAllowedTool={setNewAllowedTool}
          newDisallowedTool={newDisallowedTool}
          setNewDisallowedTool={setNewDisallowedTool}
        />
      );
    }

    if (category === 'permissions' && agentId === 'codex') {
      return (
        <PermissionsContent
          agent="codex"
          permissionMode={codexPermissionMode}
          setPermissionMode={setCodexPermissionMode}
        />
      );
    }

    return null;
  };

  const handleNavResizeStart = useCallback((event) => {
    event.preventDefault();
    isResizingNav.current = true;
    setIsNavResizing(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (moveEvent) => {
      if (!isResizingNav.current) return;
      const left = navRef.current?.getBoundingClientRect().left ?? 0;
      setNavWidth(Math.min(SETTINGS_NAV_MAX, Math.max(SETTINGS_NAV_MIN, moveEvent.clientX - left)));
    };

    const onMouseUp = () => {
      isResizingNav.current = false;
      setIsNavResizing(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      setNavWidth((width) => {
        window.localStorage.setItem(SETTINGS_NAV_WIDTH_KEY, String(width));
        return width;
      });
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  const settingsTabs = [
    { id: 'user', icon: LogIn, label: t('mainTabs.userAccount') },
    { id: 'im', icon: MessageSquare, label: t('mainTabs.imChannels') },
    { id: 'compute', icon: Cpu, label: t('mainTabs.compute') },
    { id: 'dataPaths', icon: HardDrive, label: t('mainTabs.dataPaths') },
    { id: 'agents', icon: Bot, label: t('mainTabs.agents') },
    { id: 'mcp', icon: Server, label: t('mainTabs.mcp') },
    { id: 'memory', icon: Brain, label: t('mainTabs.memory') },
    { id: 'appearance', icon: Sun, label: t('mainTabs.appearance') },
    { id: 'tokens', icon: Zap, label: t('mainTabs.tokens') },
    { id: 'api', icon: Key, label: t('mainTabs.apiTokens') },
    { id: 'trash', icon: Trash2, label: t('mainTabs.trash') },
  ];

  if (!isOpen) return null;

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-background">
      <div className="medical-settings-page medical-settings-modal flex h-full min-h-0 w-full flex-col bg-background">
        <div className="flex items-center justify-between border-b border-border p-3 md:p-4 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            {onMenuClick && (
              <button
                type="button"
                onClick={onMenuClick}
                className="rounded-lg border border-border p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground md:hidden"
                aria-label={t('title')}
              >
                <Menu className="h-4 w-4" />
              </button>
            )}
            <SettingsIcon className="h-4 w-4 text-primary" />
            <h2 className="text-base font-semibold tracking-tight text-foreground">
              {t('title')}
            </h2>
            {desktopAppVersion && (
              <span
                data-medhelp-desktop-app-version="true"
                className="rounded-md border border-border bg-muted/50 px-2 py-0.5 text-xs font-medium text-muted-foreground"
              >
                {t('appVersion', { version: desktopAppVersion })}
              </span>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground touch-manipulation"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden">
          <nav
            ref={navRef}
            className={`relative flex-shrink-0 border-b border-border md:h-full md:border-b-0 md:border-r md:shadow-[6px_0_16px_-16px_rgba(15,23,42,0.35)] dark:md:shadow-[6px_0_18px_-16px_rgba(0,0,0,0.62)] w-full md:w-[var(--settings-nav-width)] ${
              isNavResizing ? '' : 'md:transition-[width] md:duration-150'
            }`}
            style={{ '--settings-nav-width': `${navWidth}px` }}
          >
            <div className="flex flex-col gap-0.5 p-2">
              {settingsTabs.map(({ id, icon: Icon, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActiveTab(id)}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
                    activeTab === id
                      ? 'bg-accent/90 text-foreground'
                      : 'text-muted-foreground hover:bg-accent/70 hover:text-foreground'
                  }`}
                >
                  <Icon className="h-4 w-4 flex-shrink-0" strokeWidth={activeTab === id ? 2.2 : 1.85} />
                  <span className="min-w-0 flex-1 truncate text-[0.84375rem] font-medium">{label}</span>
                </button>
              ))}
            </div>
            <div
              className="absolute top-0 right-0 z-10 hidden h-full w-1.5 cursor-col-resize bg-transparent transition-[background-color,box-shadow] duration-150 hover:bg-primary/15 hover:shadow-[4px_0_14px_-6px_rgba(16,163,127,0.32)] active:bg-primary/25 md:block"
              onMouseDown={handleNavResizeStart}
              role="separator"
              aria-orientation="vertical"
              title={t('resizeNav')}
            />
          </nav>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
              <div className="space-y-4 p-3 md:space-y-5 md:p-4">

            {/* User Account Tab */}
            {activeTab === 'user' && <UserAccountContent projects={projects} />}

            {/* IM Channels Tab */}
            {activeTab === 'im' && <ImChannelsContent />}

            {/* Trash Tab */}
            {activeTab === 'trash' && <TrashSettingsContent />}

            {/* Compute Tab */}
            {activeTab === 'compute' && <ComputeSettingsContent />}

            {/* One settings entry, with distinct stores for facts and behavioral preferences. */}
            {activeTab === 'memory' && <UnifiedMemorySettingsContent projects={projects} initialSection={initialTab === 'preferences' ? 'preferences' : 'longTerm'} />}

            {/* MCP and plugins are a standalone settings page. */}
            {activeTab === 'mcp' && <PiMcpSettings projects={projects} request={fetchPiApi} />}

            {/* Token Usage Tab */}
            {activeTab === 'tokens' && <TokenUsageSettingsContent projects={projects} />}

            {/* Data Paths Tab */}
            {activeTab === 'dataPaths' && (
              <div className="space-y-4 md:space-y-5">
                <div className="border-b border-border pb-3">
                  <h3 className="text-lg font-semibold text-foreground">{t('dataPathSettings.title')}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{t('dataPathSettings.description')}</p>
                </div>

                {workspaceRootWaitingForLocalKernel && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                    {t('dataPathSettings.localKernelRequired')}
                  </div>
                )}

                <div className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                  <div className="mb-2">
                    <label className="font-medium text-foreground" htmlFor="settings-workspace-root">
                      {t('dataPathSettings.workspaceRoot.label')}
                    </label>
                    <div className="text-sm text-muted-foreground">
                      {t('dataPathSettings.workspaceRoot.description')}
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 mt-3">
                    <Input
                      id="settings-workspace-root"
                      value={workspaceRootDraft}
                      onChange={(event) => {
                        setWorkspaceRootDraft(event.target.value);
                        setWorkspaceRootError('');
                        setDataPathError('');
                        setWorkspaceRootSaved(false);
                        setDataPathSaved(false);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          void saveDataPathSettings();
                        }
                      }}
                      placeholder={displayWorkspacePath(workspaceRootDefault)}
                      className="flex-1 text-sm font-mono"
                      disabled={workspaceRootWaitingForLocalKernel || dataPathLoading || dataPathSaving}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => { void openWorkspaceBrowser(); }}
                      disabled={workspaceRootWaitingForLocalKernel || dataPathSaving || workspaceBrowserLoading}
                      className="shrink-0 gap-2"
                    >
                      <FolderOpen className="h-4 w-4" />
                      {t('appearanceSettings.defaultProjectPath.browse')}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={resetWorkspaceRoot}
                      disabled={workspaceRootWaitingForLocalKernel || dataPathSaving}
                      className="shrink-0 gap-2"
                    >
                      <RefreshCcw className="h-4 w-4" />
                      {t('appearanceSettings.defaultProjectPath.reset')}
                    </Button>
                  </div>
                  {workspaceRootUsesLocalKernel && (
                    <div className="text-xs text-muted-foreground mt-2">
                      {t('appearanceSettings.defaultProjectPath.localKernelSource')}
                    </div>
                  )}
                </div>

                {(dataPathError || workspaceRootError) && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
                    {dataPathError || workspaceRootError}
                  </div>
                )}
                {(dataPathSaved || workspaceRootSaved) && (
                  <div className="flex items-center gap-1 text-sm text-green-600 dark:text-green-400">
                    <Check className="h-4 w-4" />
                    {t('dataPathSettings.saved')}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    onClick={() => { void saveDataPathSettings(); }}
                    disabled={workspaceRootWaitingForLocalKernel || dataPathSaving || workspaceRootSaving}
                    className="gap-2"
                  >
                    {dataPathSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    {dataPathSaving ? t('dataPathSettings.saving') : t('dataPathSettings.saveAll')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => { void loadDataPathSettings(); }}
                    disabled={workspaceRootWaitingForLocalKernel || dataPathLoading || dataPathSaving}
                    className="gap-2"
                  >
                    <RefreshCcw className={`h-4 w-4 ${dataPathLoading ? 'animate-spin' : ''}`} />
                    {t('dataPathSettings.refresh')}
                  </Button>
                </div>
              </div>
            )}
            
            {/* Appearance Tab */}
            {activeTab === 'appearance' && (
              <div className="space-y-6 md:space-y-8">
    {/* Theme Settings */}
    <div className="space-y-4">
      <div className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium text-foreground">
              {t('appearanceSettings.darkMode.label')}
            </div>
            <div className="text-sm text-muted-foreground">
              {t('appearanceSettings.darkMode.description')}
            </div>
          </div>
          <button
            onClick={toggleDarkMode}
            className="relative inline-flex h-8 w-14 items-center rounded-full bg-gray-200 dark:bg-gray-700 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 dark:focus:ring-offset-gray-900"
            role="switch"
            aria-checked={isDarkMode}
            aria-label="Toggle dark mode"
          >
            <span className="sr-only">Toggle dark mode</span>
            <span
              className={`${
                isDarkMode ? 'translate-x-7' : 'translate-x-1'
              } inline-block h-6 w-6 transform rounded-full bg-white shadow-lg transition-transform duration-200 flex items-center justify-center`}
            >
              {isDarkMode ? (
                <Moon className="w-3.5 h-3.5 text-gray-700" />
              ) : (
                <Sun className="w-3.5 h-3.5 text-yellow-500" />
              )}
            </span>
          </button>
        </div>
      </div>

      {/* Task completion sound */}
      <div className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
        <div className="flex flex-col items-stretch justify-between gap-4 sm:flex-row sm:items-center">
          <div className="min-w-0">
            <div className="flex items-center gap-2 font-medium text-foreground">
              <Volume2 className="h-4 w-4 text-muted-foreground" />
              {t('appearanceSettings.completionSound.label')}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              {t('appearanceSettings.completionSound.description')}
            </div>
          </div>
          <div className="flex shrink-0 items-center justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => { void playTaskCompletionSound(); }}
            >
              <Volume2 className="h-3.5 w-3.5" />
              {t('appearanceSettings.completionSound.preview')}
            </Button>
            <div className="hidden min-w-12 text-right text-xs text-muted-foreground sm:block">
              {preferences.completionSoundEnabled
                ? t('appearanceSettings.completionSound.enabled')
                : t('appearanceSettings.completionSound.disabled')}
            </div>
            <SettingsToggle
              checked={preferences.completionSoundEnabled}
              onChange={(value) => {
                setPreference('completionSoundEnabled', value);
                if (value) {
                  void playTaskCompletionSound();
                }
              }}
              ariaLabel={t('appearanceSettings.completionSound.label')}
            />
          </div>
        </div>
      </div>

      {/* Accent color theme */}
      <div className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
        <div className="mb-3">
          <div className="font-medium text-foreground">
            {t('appearanceSettings.accentColor.label', { defaultValue: 'Color theme' })}
          </div>
          <div className="text-sm text-muted-foreground">
            {t('appearanceSettings.accentColor.description', { defaultValue: 'Pick an accent color. Works in both light and dark mode.' })}
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {accentThemes.map((theme) => {
            const isActive = accent === theme.id;
            return (
              <button
                key={theme.id}
                type="button"
                onClick={() => setAccent(theme.id)}
                aria-pressed={isActive}
                className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                  isActive
                    ? 'border-primary bg-primary/5 ring-1 ring-primary'
                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                }`}
              >
                <span
                  className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full shadow-inner"
                  style={{ backgroundColor: theme.swatch }}
                >
                  {isActive && <Check className="h-4 w-4 text-white" />}
                </span>
                <span className="text-sm font-medium text-foreground">
                  {t(`appearanceSettings.accentColor.themes.${theme.id}`, { defaultValue: theme.label })}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>

    {/* App Restart */}
    <div className="space-y-4">
      <div className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="font-medium text-foreground">
              {t('appearanceSettings.appRestart.label')}
            </div>
            <div className="text-sm text-muted-foreground">
              {t('appearanceSettings.appRestart.description')}
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => { void handleRestartApp(); }}
            disabled={isRestarting}
            title={t('appearanceSettings.appRestart.title')}
            className="shrink-0"
          >
            <RefreshCcw className={`w-4 h-4 ${isRestarting ? 'animate-spin' : ''}`} />
            <span>{isRestarting ? t('appearanceSettings.appRestart.restarting') : t('appearanceSettings.appRestart.button')}</span>
          </Button>
        </div>
      </div>
    </div>

    {/* Language Selector */}
    <div className="space-y-4">
      <LanguageSelector />
    </div>

    {/* Project Sorting */}
    <div className="space-y-4">
      <div className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium text-foreground">
              {t('appearanceSettings.projectSorting.label')}
            </div>
            <div className="text-sm text-muted-foreground">
              {t('appearanceSettings.projectSorting.description')}
            </div>
          </div>
          <select
            value={projectSortOrder}
            onChange={(e) => setProjectSortOrder(e.target.value)}
            className="text-sm bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-primary focus:border-primary p-2 w-32"
          >
            <option value="name">{t('appearanceSettings.projectSorting.alphabetical')}</option>
            <option value="date">{t('appearanceSettings.projectSorting.recentActivity')}</option>
            <option value="manual">{t('appearanceSettings.projectSorting.manual')}</option>
          </select>
        </div>
      </div>
    </div>

    {/* Code Editor Settings */}
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-foreground">{t('appearanceSettings.codeEditor.title')}</h3>

      {/* Tool Display */}
      <div className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium text-foreground">
              {t('appearanceSettings.codeEditor.toolCallsDisplay.label')}
            </div>
            <div className="text-sm text-muted-foreground">
              {t('appearanceSettings.codeEditor.toolCallsDisplay.description')}
            </div>
          </div>
          <SettingsToggle
            checked={preferences.autoExpandTools}
            onChange={(value) => setPreference('autoExpandTools', value)}
            ariaLabel={t('appearanceSettings.codeEditor.toolCallsDisplay.label')}
          />
        </div>
      </div>

      <div className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium text-foreground">
              {t('appearanceSettings.codeEditor.rawParametersDisplay.label')}
            </div>
            <div className="text-sm text-muted-foreground">
              {t('appearanceSettings.codeEditor.rawParametersDisplay.description')}
            </div>
          </div>
          <SettingsToggle
            checked={preferences.showRawParameters}
            onChange={(value) => setPreference('showRawParameters', value)}
            ariaLabel={t('appearanceSettings.codeEditor.rawParametersDisplay.label')}
          />
        </div>
      </div>

      <div className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium text-foreground">
              {t('appearanceSettings.codeEditor.thinkingDisplay.label')}
            </div>
            <div className="text-sm text-muted-foreground">
              {t('appearanceSettings.codeEditor.thinkingDisplay.description')}
            </div>
          </div>
          <SettingsToggle
            checked={preferences.showThinking}
            onChange={(value) => setPreference('showThinking', value)}
            ariaLabel={t('appearanceSettings.codeEditor.thinkingDisplay.label')}
          />
        </div>
      </div>

      {/* Editor Theme */}
      <div className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium text-foreground">
              {t('appearanceSettings.codeEditor.theme.label')}
            </div>
            <div className="text-sm text-muted-foreground">
              {t('appearanceSettings.codeEditor.theme.description')}
            </div>
          </div>
          <button
            onClick={() => setCodeEditorTheme(codeEditorTheme === 'dark' ? 'light' : 'dark')}
            className="relative inline-flex h-8 w-14 items-center rounded-full bg-gray-200 dark:bg-gray-700 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 dark:focus:ring-offset-gray-900"
            role="switch"
            aria-checked={codeEditorTheme === 'dark'}
            aria-label="Toggle editor theme"
          >
            <span className="sr-only">Toggle editor theme</span>
            <span
              className={`${
                codeEditorTheme === 'dark' ? 'translate-x-7' : 'translate-x-1'
              } inline-block h-6 w-6 transform rounded-full bg-white shadow-lg transition-transform duration-200 flex items-center justify-center`}
            >
              {codeEditorTheme === 'dark' ? (
                <Moon className="w-3.5 h-3.5 text-gray-700" />
              ) : (
                <Sun className="w-3.5 h-3.5 text-yellow-500" />
              )}
            </span>
          </button>
        </div>
      </div>

      {/* Word Wrap */}
      <div className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium text-foreground">
              {t('appearanceSettings.codeEditor.wordWrap.label')}
            </div>
            <div className="text-sm text-muted-foreground">
              {t('appearanceSettings.codeEditor.wordWrap.description')}
            </div>
          </div>
          <button
            onClick={() => setCodeEditorWordWrap(!codeEditorWordWrap)}
            className="relative inline-flex h-8 w-14 items-center rounded-full bg-gray-200 dark:bg-gray-700 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 dark:focus:ring-offset-gray-900"
            role="switch"
            aria-checked={codeEditorWordWrap}
            aria-label="Toggle word wrap"
          >
            <span className="sr-only">Toggle word wrap</span>
            <span
              className={`${
                codeEditorWordWrap ? 'translate-x-7' : 'translate-x-1'
              } inline-block h-6 w-6 transform rounded-full bg-white shadow-lg transition-transform duration-200`}
            />
          </button>
        </div>
      </div>

      {/* Show Minimap */}
      <div className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium text-foreground">
              {t('appearanceSettings.codeEditor.showMinimap.label')}
            </div>
            <div className="text-sm text-muted-foreground">
              {t('appearanceSettings.codeEditor.showMinimap.description')}
            </div>
          </div>
          <button
            onClick={() => setCodeEditorShowMinimap(!codeEditorShowMinimap)}
            className="relative inline-flex h-8 w-14 items-center rounded-full bg-gray-200 dark:bg-gray-700 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 dark:focus:ring-offset-gray-900"
            role="switch"
            aria-checked={codeEditorShowMinimap}
            aria-label="Toggle minimap"
          >
            <span className="sr-only">Toggle minimap</span>
            <span
              className={`${
                codeEditorShowMinimap ? 'translate-x-7' : 'translate-x-1'
              } inline-block h-6 w-6 transform rounded-full bg-white shadow-lg transition-transform duration-200`}
            />
          </button>
        </div>
      </div>

      {/* Show Line Numbers */}
      <div className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium text-foreground">
              {t('appearanceSettings.codeEditor.lineNumbers.label')}
            </div>
            <div className="text-sm text-muted-foreground">
              {t('appearanceSettings.codeEditor.lineNumbers.description')}
            </div>
          </div>
          <button
            onClick={() => setCodeEditorLineNumbers(!codeEditorLineNumbers)}
            className="relative inline-flex h-8 w-14 items-center rounded-full bg-gray-200 dark:bg-gray-700 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 dark:focus:ring-offset-gray-900"
            role="switch"
            aria-checked={codeEditorLineNumbers}
            aria-label="Toggle line numbers"
          >
            <span className="sr-only">Toggle line numbers</span>
            <span
              className={`${
                codeEditorLineNumbers ? 'translate-x-7' : 'translate-x-1'
              } inline-block h-6 w-6 transform rounded-full bg-white shadow-lg transition-transform duration-200`}
            />
          </button>
        </div>
      </div>

    </div>

    {/* Font settings stay at the bottom of Appearance as one unified group. */}
    <FontSettingsPanel
      t={t}
      uiFontScale={uiFontScale}
      setUiFontScale={setUiFontScale}
      chatFontScale={chatFontScale}
      setChatFontScale={setChatFontScale}
      fontScaleOptions={fontScaleOptions}
      codeEditorFontSize={codeEditorFontSize}
      setCodeEditorFontSize={setCodeEditorFontSize}
      codeEditorPreviewFontSize={codeEditorPreviewFontSize}
      setCodeEditorPreviewFontSize={setCodeEditorPreviewFontSize}
    />
  </div>
            )}

            {/* Agents Tab */}
            {activeTab === 'agents' && (
              <div className="-mx-3 -mt-3 md:-mx-4 md:-mt-4">
                <div className="border-b border-gray-200 dark:border-gray-700 px-3 md:px-4">
                  <div className="flex overflow-x-auto">
                    {getAgentSettings(selectedAgent).categories.map((category) => (
                      <button
                        key={category}
                        onClick={() => setSelectedCategory(category)}
                        className={`px-3 md:px-4 py-2 md:py-3 text-xs md:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                          selectedCategory === category
                            ? 'border-primary text-primary'
                            : 'border-transparent text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {t(AGENT_CATEGORY_LABEL_KEYS[category] || category)}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="p-3 md:p-4">
                  {renderAgentCategoryContent(selectedAgent, selectedCategory)}
                </div>
              </div>
            )}

            {/* MCP Server Form Modal */}
            {showMcpForm && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[110] p-4">
                <div className="bg-background border border-border rounded-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                  <div className="flex items-center justify-between p-4 border-b border-border">
                    <h3 className="text-lg font-medium text-foreground">
                      {editingMcpServer ? t('mcpForm.title.edit') : t('mcpForm.title.add')}
                    </h3>
                    <Button variant="ghost" size="sm" onClick={resetMcpForm}>
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                  
                  <form onSubmit={handleMcpSubmit} className="p-4 space-y-4">

                    {!editingMcpServer && (
                    <div className="flex flex-wrap gap-2 mb-4">
                      <button
                        type="button"
                        onClick={() => setMcpFormData(prev => ({...prev, importMode: 'form'}))}
                        className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                          mcpFormData.importMode === 'form'
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                        }`}
                      >
                        {t('mcpForm.importMode.form')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setMcpFormData(prev => ({...prev, importMode: 'json'}))}
                        className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                          mcpFormData.importMode === 'json'
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                        }`}
                      >
                        {t('mcpForm.importMode.json')}
                      </button>
                      {selectedAgent === 'claude' && (
                        <button
                          type="button"
                          onClick={() => setMcpFormData(prev => ({...prev, importMode: 'bundle'}))}
                          className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                            mcpFormData.importMode === 'bundle'
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                          }`}
                        >
                          <PackageOpen className="w-4 h-4" />
                          {t('mcpForm.importMode.bundle')}
                        </button>
                      )}
                    </div>
                    )}

                    {/* Show current scope when editing */}
                    {mcpFormData.importMode === 'form' && editingMcpServer && (
                      <div className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                        <label className="block text-sm font-medium text-foreground mb-2">
                          {t('mcpForm.scope.label')}
                        </label>
                        <div className="flex items-center gap-2">
                          {mcpFormData.scope === 'user' ? <Globe className="w-4 h-4" /> : <FolderOpen className="w-4 h-4" />}
                          <span className="text-sm">
                            {mcpFormData.scope === 'user' ? t('mcpForm.scope.userGlobal') : t('mcpForm.scope.projectLocal')}
                          </span>
                          {mcpFormData.scope === 'local' && mcpFormData.projectPath && (
                            <span className="text-xs text-muted-foreground">
                              - {mcpFormData.projectPath}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-2">
                          {t('mcpForm.scope.cannotChange')}
                        </p>
                      </div>
                    )}

                    {/* Scope Selection - Moved to top, disabled when editing */}
                    {mcpFormData.importMode === 'form' && !editingMcpServer && (
                      <div className="space-y-4">
                        <div>
                          <label className="block text-sm font-medium text-foreground mb-2">
                            {t('mcpForm.scope.label')} *
                          </label>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => setMcpFormData(prev => ({...prev, scope: 'user', projectPath: ''}))}
                              className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${
                                mcpFormData.scope === 'user'
                                  ? 'bg-primary text-primary-foreground'
                                  : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                              }`}
                            >
                              <div className="flex items-center justify-center gap-2">
                                <Globe className="w-4 h-4" />
                                <span>{t('mcpForm.scope.userGlobal')}</span>
                              </div>
                            </button>
                            <button
                              type="button"
                              onClick={() => setMcpFormData(prev => ({...prev, scope: 'local'}))}
                              className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${
                                mcpFormData.scope === 'local'
                                  ? 'bg-primary text-primary-foreground'
                                  : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                              }`}
                            >
                              <div className="flex items-center justify-center gap-2">
                                <FolderOpen className="w-4 h-4" />
                                <span>{t('mcpForm.scope.projectLocal')}</span>
                              </div>
                            </button>
                          </div>
                          <p className="text-xs text-muted-foreground mt-2">
                            {mcpFormData.scope === 'user'
                              ? t('mcpForm.scope.userDescription')
                              : t('mcpForm.scope.projectDescription')
                            }
                          </p>
                        </div>

                        {/* Project Selection for Local Scope */}
                        {mcpFormData.scope === 'local' && !editingMcpServer && (
                          <div>
                            <label className="block text-sm font-medium text-foreground mb-2">
                              {t('mcpForm.fields.selectProject')} *
                            </label>
                            <select
                              value={mcpFormData.projectPath}
                              onChange={(e) => setMcpFormData(prev => ({...prev, projectPath: e.target.value}))}
                              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-primary focus:border-primary"
                              required={mcpFormData.scope === 'local'}
                            >
                              <option value="">{t('mcpForm.fields.selectProject')}...</option>
                              {projects.map(project => (
                                <option key={project.name} value={project.path || project.fullPath}>
                                  {project.displayName || project.name}
                                </option>
                              ))}
                            </select>
                            {mcpFormData.projectPath && (
                              <p className="text-xs text-muted-foreground mt-1">
                                {t('mcpForm.projectPath', { path: mcpFormData.projectPath })}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Basic Info */}
                    {mcpFormData.importMode !== 'bundle' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className={mcpFormData.importMode === 'json' ? 'md:col-span-2' : ''}>
                        <label className="block text-sm font-medium text-foreground mb-2">
                          {t('mcpForm.fields.serverName')} *
                        </label>
                        <Input
                          value={mcpFormData.name}
                          onChange={(e) => {
                            setMcpFormData(prev => ({...prev, name: e.target.value}));
                          }}
                          placeholder={t('mcpForm.placeholders.serverName')}
                          required
                        />
                      </div>

                      {mcpFormData.importMode === 'form' && (
                        <div>
                          <label className="block text-sm font-medium text-foreground mb-2">
                            {t('mcpForm.fields.transportType')} *
                          </label>
                          <select
                            value={mcpFormData.type}
                            onChange={(e) => {
                              setMcpFormData(prev => ({...prev, type: e.target.value}));
                            }}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-primary focus:border-primary"
                          >
                            <option value="stdio">stdio</option>
                            <option value="sse">SSE</option>
                            <option value="http">HTTP</option>
                          </select>
                        </div>
                      )}
                    </div>
                    )}

                    {/* Local MCP bundle installation */}
                    {mcpFormData.importMode === 'bundle' && (
                      <div className="space-y-4">
                        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-100">
                          <div className="flex items-start gap-3">
                            <PackageOpen className="mt-0.5 h-5 w-5 flex-shrink-0" />
                            <div>
                              <p className="font-medium">{t('mcpForm.bundle.title')}</p>
                              <p className="mt-1 text-xs opacity-80">{t('mcpForm.bundle.description')}</p>
                            </div>
                          </div>
                        </div>

                        <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-border bg-muted/30 px-6 py-8 text-center transition-colors hover:border-primary/60 hover:bg-muted/50">
                          <Upload className="mb-3 h-8 w-8 text-muted-foreground" />
                          <span className="text-sm font-medium text-foreground">
                            {mcpBundleFile ? mcpBundleFile.name : t('mcpForm.bundle.chooseFile')}
                          </span>
                          <span className="mt-1 text-xs text-muted-foreground">
                            {mcpBundleFile
                              ? t('mcpForm.bundle.fileSize', { size: (mcpBundleFile.size / (1024 * 1024)).toFixed(1) })
                              : t('mcpForm.bundle.supportedFiles')}
                          </span>
                          <input
                            type="file"
                            accept=".mcpb,.dxt,application/zip"
                            className="sr-only"
                            onChange={(event) => setMcpBundleFile(event.target.files?.[0] || null)}
                          />
                        </label>

                        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
                          <Shield className="mt-0.5 h-4 w-4 flex-shrink-0" />
                          <p>{t('mcpForm.bundle.securityNotice')}</p>
                        </div>
                      </div>
                    )}


                    {/* Show raw configuration details when editing */}
                    {editingMcpServer && mcpFormData.raw && mcpFormData.importMode === 'form' && (
                      <div className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                        <h4 className="text-sm font-medium text-foreground mb-2">
                          {t('mcpForm.configDetails', {
                            configFile: editingMcpServer.scope === 'global' ? '~/.claude.json' : 'project config'
                          })}
                        </h4>
                        <pre className="text-xs bg-gray-100 dark:bg-gray-800 p-3 rounded overflow-x-auto">
                          {JSON.stringify(mcpFormData.raw, null, 2)}
                        </pre>
                      </div>
                    )}

                    {/* JSON Import Mode */}
                    {mcpFormData.importMode === 'json' && (
                      <div className="space-y-4">
                        <div>
                          <label className="block text-sm font-medium text-foreground mb-2">
                            {t('mcpForm.fields.jsonConfig')} *
                          </label>
                          <textarea
                            value={mcpFormData.jsonInput}
                            onChange={(e) => {
                              setMcpFormData(prev => ({...prev, jsonInput: e.target.value}));
                              // Validate JSON as user types
                              try {
                                if (e.target.value.trim()) {
                                  const parsed = JSON.parse(e.target.value);
                                  // Basic validation
                                  const inferredType = parsed.type || (parsed.command ? 'stdio' : parsed.transport === 'sse' ? 'sse' : parsed.url ? 'http' : '');
                                  if (!inferredType) {
                                    setJsonValidationError(t('mcpForm.validation.missingType'));
                                  } else if (inferredType === 'stdio' && !parsed.command) {
                                    setJsonValidationError(t('mcpForm.validation.stdioRequiresCommand'));
                                  } else if ((inferredType === 'http' || inferredType === 'sse') && !parsed.url) {
                                    setJsonValidationError(t('mcpForm.validation.httpRequiresUrl', { type: inferredType }));
                                  } else {
                                    setJsonValidationError('');
                                  }
                                }
                              } catch (err) {
                                if (e.target.value.trim()) {
                                  setJsonValidationError(t('mcpForm.validation.invalidJson'));
                                } else {
                                  setJsonValidationError('');
                                }
                              }
                            }}
                            className={`w-full px-3 py-2 border ${jsonValidationError ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'} bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-primary focus:border-primary font-mono text-sm`}
                            rows="8"
                            placeholder={'{\n  "type": "stdio",\n  "command": "/path/to/server",\n  "args": ["--api-key", "abc123"],\n  "env": {\n    "CACHE_DIR": "/tmp"\n  }\n}'}
                            required
                          />
                          {jsonValidationError && (
                            <p className="text-xs text-red-500 mt-1">{jsonValidationError}</p>
                          )}
                          <p className="text-xs text-muted-foreground mt-2">
                            {t('mcpForm.validation.jsonHelp')}
                            <br />• stdio: {`{"type":"stdio","command":"npx","args":["@upstash/context7-mcp"]}`}
                            <br />• http/sse: {`{"type":"http","url":"https://api.example.com/mcp"}`}
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Transport-specific Config - Only show in form mode */}
                    {mcpFormData.importMode === 'form' && mcpFormData.type === 'stdio' && (
                      <div className="space-y-4">
                        <div>
                          <label className="block text-sm font-medium text-foreground mb-2">
                            {t('mcpForm.fields.command')} *
                          </label>
                          <Input
                            value={mcpFormData.config.command}
                            onChange={(e) => updateMcpConfig('command', e.target.value)}
                            placeholder="/path/to/mcp-server"
                            required
                          />
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-foreground mb-2">
                            {t('mcpForm.fields.arguments')}
                          </label>
                          <textarea
                            value={Array.isArray(mcpFormData.config.args) ? mcpFormData.config.args.join('\n') : ''}
                            onChange={(e) => updateMcpConfig('args', e.target.value.split('\n').filter(arg => arg.trim()))}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-primary focus:border-primary"
                            rows="3"
                            placeholder="--api-key&#10;abc123"
                          />
                        </div>
                      </div>
                    )}

                    {mcpFormData.importMode === 'form' && (mcpFormData.type === 'sse' || mcpFormData.type === 'http') && (
                      <div>
                        <label className="block text-sm font-medium text-foreground mb-2">
                          {t('mcpForm.fields.url')} *
                        </label>
                        <Input
                          value={mcpFormData.config.url}
                          onChange={(e) => updateMcpConfig('url', e.target.value)}
                          placeholder="https://api.example.com/mcp"
                          type="url"
                          required
                        />
                      </div>
                    )}

                    {/* Environment Variables - Only show in form mode */}
                    {mcpFormData.importMode === 'form' && (
                      <div>
                      <label className="block text-sm font-medium text-foreground mb-2">
                        {t('mcpForm.fields.envVars')}
                      </label>
                      <textarea
                        value={Object.entries(mcpFormData.config.env || {}).map(([k, v]) => `${k}=${v}`).join('\n')}
                        onChange={(e) => {
                          const env = {};
                          e.target.value.split('\n').forEach(line => {
                            const [key, ...valueParts] = line.split('=');
                            if (key && key.trim()) {
                              env[key.trim()] = valueParts.join('=').trim();
                            }
                          });
                          updateMcpConfig('env', env);
                        }}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-primary focus:border-primary"
                        rows="3"
                        placeholder="API_KEY=your-key&#10;DEBUG=true"
                      />
                    </div>
                    )}

                    {mcpFormData.importMode === 'form' && (mcpFormData.type === 'sse' || mcpFormData.type === 'http') && (
                      <div>
                        <label className="block text-sm font-medium text-foreground mb-2">
                          {t('mcpForm.fields.headers')}
                        </label>
                        <textarea
                          value={Object.entries(mcpFormData.config.headers || {}).map(([k, v]) => `${k}=${v}`).join('\n')}
                          onChange={(e) => {
                            const headers = {};
                            e.target.value.split('\n').forEach(line => {
                              const [key, ...valueParts] = line.split('=');
                              if (key && key.trim()) {
                                headers[key.trim()] = valueParts.join('=').trim();
                              }
                            });
                            updateMcpConfig('headers', headers);
                          }}
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-primary focus:border-primary"
                          rows="3"
                          placeholder="Authorization=Bearer token&#10;X-API-Key=your-key"
                        />
                      </div>
                    )}


                    <div className="flex justify-end gap-2 pt-4">
                      <Button type="button" variant="outline" onClick={resetMcpForm}>
                        {t('mcpForm.actions.cancel')}
                      </Button>
                      <Button
                        type="submit"
                        disabled={mcpLoading || (mcpFormData.importMode === 'bundle' && !mcpBundleFile)}
                        className="bg-primary hover:bg-primary/90 disabled:opacity-50"
                      >
                        {mcpFormData.importMode === 'bundle'
                          ? (mcpLoading ? t('mcpForm.actions.installing') : t('mcpForm.actions.installBundle'))
                          : (mcpLoading ? t('mcpForm.actions.saving') : (editingMcpServer ? t('mcpForm.actions.updateServer') : t('mcpForm.actions.addServer')))}
                      </Button>
                    </div>
                  </form>
                </div>
              </div>
            )}

            {/* Codex MCP Server Form Modal */}
            {showCodexMcpForm && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[110] p-4">
                <div className="bg-background border border-border rounded-lg w-full max-w-lg max-h-[90vh] overflow-y-auto">
                  <div className="flex items-center justify-between p-4 border-b border-border">
                    <h3 className="text-lg font-medium text-foreground">
                      {editingCodexMcpServer ? t('mcpForm.title.edit') : t('mcpForm.title.add')}
                    </h3>
                    <Button variant="ghost" size="sm" onClick={resetCodexMcpForm}>
                      <X className="w-4 h-4" />
                    </Button>
                  </div>

                  <form onSubmit={handleCodexMcpSubmit} className="p-4 space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-2">
                        {t('mcpForm.fields.serverName')} *
                      </label>
                      <Input
                        value={codexMcpFormData.name}
                        onChange={(e) => setCodexMcpFormData(prev => ({...prev, name: e.target.value}))}
                        placeholder={t('mcpForm.placeholders.serverName')}
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-foreground mb-2">
                        {t('mcpForm.fields.command')} *
                      </label>
                      <Input
                        value={codexMcpFormData.config?.command || ''}
                        onChange={(e) => setCodexMcpFormData(prev => ({
                          ...prev,
                          config: { ...prev.config, command: e.target.value }
                        }))}
                        placeholder="npx @my-org/mcp-server"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-foreground mb-2">
                        {t('mcpForm.fields.arguments')}
                      </label>
                      <textarea
                        value={(codexMcpFormData.config?.args || []).join('\n')}
                        onChange={(e) => setCodexMcpFormData(prev => ({
                          ...prev,
                          config: { ...prev.config, args: e.target.value.split('\n').filter(a => a.trim()) }
                        }))}
                        placeholder="--port&#10;3000"
                        rows={3}
                        className="w-full px-3 py-2 text-sm bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-foreground mb-2">
                        {t('mcpForm.fields.envVars')}
                      </label>
                      <textarea
                        value={Object.entries(codexMcpFormData.config?.env || {}).map(([k, v]) => `${k}=${v}`).join('\n')}
                        onChange={(e) => {
                          const env = {};
                          e.target.value.split('\n').forEach(line => {
                            const [key, ...valueParts] = line.split('=');
                            if (key && valueParts.length > 0) {
                              env[key.trim()] = valueParts.join('=').trim();
                            }
                          });
                          setCodexMcpFormData(prev => ({
                            ...prev,
                            config: { ...prev.config, env }
                          }));
                        }}
                        placeholder="API_KEY=xxx&#10;DEBUG=true"
                        rows={3}
                        className="w-full px-3 py-2 text-sm bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                    </div>

                    <div className="flex justify-end gap-2 pt-4 border-t border-border">
                      <Button type="button" variant="outline" onClick={resetCodexMcpForm}>
                        {t('mcpForm.actions.cancel')}
                      </Button>
                      <Button
                        type="submit"
                        disabled={codexMcpLoading || !codexMcpFormData.name || !codexMcpFormData.config?.command}
                        className="bg-primary hover:bg-primary/90 text-primary-foreground"
                      >
                        {codexMcpLoading ? t('mcpForm.actions.saving') : (editingCodexMcpServer ? t('mcpForm.actions.updateServer') : t('mcpForm.actions.addServer'))}
                      </Button>
                    </div>
                  </form>
                </div>
              </div>
            )}

            {/* Connectors Tab */}
            {activeTab === 'api' && (
              <ConnectorsContent />
            )}
          </div>
            </div>

            <div className="medical-settings-footer flex flex-shrink-0 flex-col gap-3 border-t border-border p-4 pb-safe-area-inset-bottom sm:flex-row sm:items-center sm:justify-between md:p-6">
          <div className="flex items-center justify-center sm:justify-start gap-2 order-2 sm:order-1">
            {saveStatus === 'success' && (
              <div className="text-green-600 dark:text-green-400 text-sm flex items-center gap-1">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                {t('saveStatus.success')}
              </div>
            )}
            {saveStatus === 'error' && (
              <div className="text-red-600 dark:text-red-400 text-sm flex items-center gap-1">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                {t('saveStatus.error')}
              </div>
            )}
          </div>
          <div className="flex items-center gap-3 order-1 sm:order-2">
            <Button
              variant="outline"
              onClick={onClose}
              disabled={isSaving}
              className="flex-1 sm:flex-none h-10 touch-manipulation"
            >
              {t('footerActions.cancel')}
            </Button>
            <Button
              onClick={saveSettings}
              disabled={isSaving}
              className="flex-1 sm:flex-none h-10 bg-primary hover:bg-primary/90 disabled:opacity-50 touch-manipulation"
            >
              {isSaving ? (
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  {t('saveStatus.saving')}
                </div>
              ) : (
                t('footerActions.save')
              )}
            </Button>
          </div>
        </div>
          </div>
        </div>
      </div>

      {workspaceBrowserOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[110] p-4">
          <div className="bg-background border border-border rounded-lg shadow-xl w-full max-w-2xl max-h-[82vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <FolderOpen className="w-4 h-4 text-primary" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-base font-semibold text-foreground truncate">
                    {t('appearanceSettings.defaultProjectPath.selectFolderTitle')}
                  </h3>
                  <div className="text-xs text-muted-foreground font-mono truncate">
                    {workspaceBrowserCurrentDisplayPath || displayWorkspacePath(workspaceBrowserCurrentPath)}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {workspaceBrowserDrivesRootPath && !workspaceBrowserIsVirtualRoot && (
                  <button
                    type="button"
                    onClick={() => loadWorkspaceBrowserFolders(workspaceBrowserDrivesRootPath)}
                    className="p-2 text-muted-foreground hover:text-foreground rounded-md hover:bg-muted"
                    title={t('dataPathSettings.allowedFolders.thisPc')}
                  >
                    <HardDrive className="w-5 h-5" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    const nextShowHidden = !workspaceBrowserShowHidden;
                    setWorkspaceBrowserShowHidden(nextShowHidden);
                    loadWorkspaceBrowserFolders(workspaceBrowserCurrentPath, nextShowHidden);
                  }}
                  className={`p-2 rounded-md transition-colors ${
                    workspaceBrowserShowHidden
                      ? 'text-primary bg-primary/10'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                  }`}
                  title={workspaceBrowserShowHidden
                    ? t('appearanceSettings.defaultProjectPath.hideHidden')
                    : t('appearanceSettings.defaultProjectPath.showHidden')}
                >
                  {workspaceBrowserShowHidden ? <Eye className="w-5 h-5" /> : <EyeOff className="w-5 h-5" />}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (workspaceBrowserIsVirtualRoot) {
                      return;
                    }
                    setWorkspaceBrowserShowNewFolder((value) => !value);
                    setWorkspaceBrowserNewFolderName('');
                  }}
                  className={`p-2 rounded-md transition-colors ${
                    workspaceBrowserShowNewFolder
                      ? 'text-primary bg-primary/10'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                  } ${workspaceBrowserIsVirtualRoot ? 'cursor-not-allowed opacity-50' : ''}`}
                  title={t('appearanceSettings.defaultProjectPath.createFolder')}
                  disabled={workspaceBrowserIsVirtualRoot}
                >
                  <Plus className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setWorkspaceBrowserOpen(false);
                    setWorkspaceBrowserShowNewFolder(false);
                    setWorkspaceBrowserNewFolderName('');
                  }}
                  className="p-2 text-muted-foreground hover:text-foreground rounded-md hover:bg-muted"
                  title={t('appearanceSettings.defaultProjectPath.cancel')}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {workspaceBrowserShowNewFolder && !workspaceBrowserIsVirtualRoot && (
              <div className="px-4 py-3 border-b border-border bg-primary/10">
                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                  <Input
                    value={workspaceBrowserNewFolderName}
                    onChange={(event) => setWorkspaceBrowserNewFolderName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        createWorkspaceBrowserFolder();
                      }
                      if (event.key === 'Escape') {
                        setWorkspaceBrowserShowNewFolder(false);
                        setWorkspaceBrowserNewFolderName('');
                      }
                    }}
                    placeholder={t('appearanceSettings.defaultProjectPath.newFolderName')}
                    className="flex-1"
                    autoFocus
                  />
                  <Button
                    type="button"
                    size="sm"
                    onClick={createWorkspaceBrowserFolder}
                    disabled={!workspaceBrowserNewFolderName.trim() || workspaceBrowserCreatingFolder}
                    className="shrink-0 gap-2"
                  >
                    {workspaceBrowserCreatingFolder && <Loader2 className="w-4 h-4 animate-spin" />}
                    {t('appearanceSettings.defaultProjectPath.create')}
                  </Button>
                </div>
              </div>
            )}

            {workspaceBrowserError && (
              <div className="px-4 py-2 border-b border-border text-xs text-red-600 dark:text-red-400">
                {workspaceBrowserError}
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-4">
              {workspaceBrowserLoading ? (
                <div className="flex items-center justify-center py-10 text-muted-foreground">
                  <Loader2 className="w-6 h-6 animate-spin" />
                </div>
              ) : (
                <div className="space-y-1">
                  {workspaceBrowserParentPath && (
                    <button
                      type="button"
                      onClick={() => loadWorkspaceBrowserFolders(workspaceBrowserParentPath)}
                      className="w-full px-4 py-3 text-left hover:bg-muted rounded-lg flex items-center gap-3"
                    >
                      <FolderOpen className="w-5 h-5 text-muted-foreground" />
                      <span className="font-medium text-foreground">..</span>
                    </button>
                  )}

                  {workspaceBrowserFolders.length === 0 ? (
                    <div className="text-center py-10 text-sm text-muted-foreground">
                      {t('appearanceSettings.defaultProjectPath.noSubfolders')}
                    </div>
                  ) : (
                    workspaceBrowserFolders
                      .filter((folder) => workspaceBrowserShowHidden || !folder.name.startsWith('.'))
                      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
                      .map((folder) => (
                        <div key={folder.path} className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => loadWorkspaceBrowserFolders(folder.path)}
                            className="flex-1 min-w-0 px-4 py-3 text-left hover:bg-muted rounded-lg flex items-center gap-3"
                          >
                            {folder.isDrive ? (
                              <HardDrive className="w-5 h-5 text-primary shrink-0" />
                            ) : (
                              <FolderOpen className="w-5 h-5 text-primary shrink-0" />
                            )}
                            <span className="font-medium text-foreground truncate">{folder.name}</span>
                          </button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => chooseWorkspaceBrowserFolder(folder.path, folder.displayPath)}
                            disabled={workspaceRootSaving || dataPathSaving || folder.isDrive}
                            className="shrink-0"
                          >
                            {t('appearanceSettings.defaultProjectPath.select')}
                          </Button>
                        </div>
                      ))
                  )}
                </div>
              )}
            </div>

            <div className="border-t border-border">
              <div className="px-4 py-3 bg-muted/40 flex items-center gap-2 min-w-0">
                <span className="text-sm text-muted-foreground shrink-0">
                  {t('appearanceSettings.defaultProjectPath.path')}
                </span>
                <code className="text-sm font-mono text-foreground truncate">
                  {workspaceBrowserCurrentDisplayPath || displayWorkspacePath(workspaceBrowserCurrentPath)}
                </code>
              </div>
              <div className="flex items-center justify-end gap-2 p-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setWorkspaceBrowserOpen(false);
                    setWorkspaceBrowserShowNewFolder(false);
                    setWorkspaceBrowserNewFolderName('');
                  }}
                >
                  {t('appearanceSettings.defaultProjectPath.cancel')}
                </Button>
                <Button
                  type="button"
                  onClick={() => chooseWorkspaceBrowserFolder(
                    workspaceBrowserCurrentPath,
                    workspaceBrowserCurrentDisplayPath,
                  )}
                  disabled={!workspaceBrowserCurrentPath || workspaceRootSaving || dataPathSaving || workspaceBrowserIsVirtualRoot || isWindowsDriveRootPath(workspaceBrowserCurrentPath)}
                  className="gap-2"
                >
                  {(workspaceRootSaving || dataPathSaving) && <Loader2 className="w-4 h-4 animate-spin" />}
                  {t('appearanceSettings.defaultProjectPath.useThisFolder')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Login Modal */}
      <LoginModal
        key={loginProvider}
        isOpen={showLoginModal}
        onClose={() => setShowLoginModal(false)}
        provider={loginProvider}
        project={selectedProject}
        onComplete={handleLoginComplete}
        isAuthenticated={
          loginProvider === 'claude' ? claudeAuthStatus.authenticated :
          loginProvider === 'codex' ? codexAuthStatus.authenticated :
          false
        }
        cliAvailable={
          loginProvider === 'claude' ? claudeAuthStatus.cliAvailable !== false :
          loginProvider === 'codex' ? codexAuthStatus.cliAvailable !== false :
          true
        }
        installHint={
          loginProvider === 'claude' ? claudeAuthStatus.installHint :
          loginProvider === 'codex' ? codexAuthStatus.installHint :
          null
        }
      />
    </div>
  );
}

export default Settings;
