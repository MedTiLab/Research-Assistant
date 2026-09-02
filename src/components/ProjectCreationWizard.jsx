import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, FolderPlus, ChevronRight, ChevronLeft, Check, Loader2, AlertCircle, FolderOpen, Eye, EyeOff, Plus, RefreshCw, GitBranch, HardDrive } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { api } from '../utils/api';
import { useTranslation } from 'react-i18next';
import generateWorkspaceName from '../utils/workspaceNameGenerator';
import { buildImportedWorkspaceScanPrompt } from '../utils/importedWorkspaceAnalysis';

const ProjectCreationWizard = ({ onClose, onProjectCreated, connectFolderOnly = false }) => {
  const { t } = useTranslation();
  // Wizard state
  const [step, setStep] = useState(1); // 1: Choose type, 2: Configure, 3: Confirm
  const [workspaceType, setWorkspaceType] = useState('existing'); // 'existing' or 'new' - default to 'existing'

  // Form state
  const [workspacePath, setWorkspacePath] = useState('');
  const [projectName, setProjectName] = useState('');

  // UI state
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState(null);
  const [pathSuggestions, setPathSuggestions] = useState([]);
  const [showPathDropdown, setShowPathDropdown] = useState(false);
  const [showFolderBrowser, setShowFolderBrowser] = useState(connectFolderOnly);
  const [browserCurrentPath, setBrowserCurrentPath] = useState('~');
  const [browserCurrentDisplayPath, setBrowserCurrentDisplayPath] = useState('');
  const [browserParentPath, setBrowserParentPath] = useState(null);
  const [browserIsVirtualRoot, setBrowserIsVirtualRoot] = useState(false);
  const [browserFolders, setBrowserFolders] = useState([]);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [showHiddenFolders, setShowHiddenFolders] = useState(false);
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [workspaceRoot, setWorkspaceRoot] = useState('~/Documents/MedHelpSec');
  const [workspaceRootDefault, setWorkspaceRootDefault] = useState('~/Documents/MedHelpSec');
  const [workspaceRootDisplay, setWorkspaceRootDisplay] = useState('~/Documents/MedHelpSec');

  const normalizePath = (value) => String(value || '').replace(/\\/g, '/').replace(/\/+$/, '');

  useEffect(() => {
    if (typeof document === 'undefined') {
      return undefined;
    }
    const previous = document.body.getAttribute('data-medhelp-project-wizard-open');
    document.body.setAttribute('data-medhelp-project-wizard-open', 'true');
    return () => {
      if (previous === null) {
        document.body.removeAttribute('data-medhelp-project-wizard-open');
      } else {
        document.body.setAttribute('data-medhelp-project-wizard-open', previous);
      }
    };
  }, []);
  const isWindowsDriveRootPath = (value) => /^[A-Za-z]:[\\/]?$/.test(String(value || '').trim());

  const getDisplayPath = (inputPath) => {
    const normalizedPath = normalizePath(inputPath);
    if (!normalizedPath) {
      return '';
    }

    const normalizedRoot = normalizePath(workspaceRoot || workspaceRootDefault || '');
    if (normalizedRoot && normalizedPath.startsWith(normalizedRoot)) {
      const relativePath = normalizedPath.slice(normalizedRoot.length).replace(/^\/+/, '');
      return relativePath ? `${normalizePath(displayWorkspaceRoot())}/${relativePath}` : displayWorkspaceRoot();
    }

    return normalizedPath.replace(/^\/(Users|home)\/[^/]+/, '~');
  };

  const displayWorkspaceRoot = () => {
    const normalizedRoot = normalizePath(workspaceRoot || workspaceRootDefault || '~');
    return workspaceRootDisplay || normalizedRoot.replace(/^\/(Users|home)\/[^/]+/, '~');
  };

  const getInputPath = () => getDisplayPath(workspacePath);

  const toWorkspacePath = (displayPath) => {
    const rawValue = String(displayPath || '').trim();
    if (!rawValue) {
      return '';
    }

    const normalizedRoot = normalizePath(workspaceRoot || workspaceRootDefault || '');
    const displayRoot = displayWorkspaceRoot();

    if (normalizedRoot && rawValue.startsWith(displayRoot)) {
      return normalizedRoot + rawValue.slice(displayRoot.length);
    }

    const normalizedHomeRoot = normalizePath(workspaceRootDefault || workspaceRoot || '');
    if (rawValue.startsWith('~') && normalizedHomeRoot) {
      return normalizedHomeRoot + rawValue.slice(1);
    }

    return rawValue;
  };

  const appendPathSegment = (basePath, segment) => {
    const separator = basePath.includes('\\') ? '\\' : '/';

    if (basePath.endsWith('/') || basePath.endsWith('\\')) {
      return `${basePath}${segment}`;
    }

    return `${basePath}${separator}${segment}`;
  };

  const normalizePathForComparison = (value) => value.replace(/\\/g, '/').toLowerCase();

  const getParentDirectoryPath = (inputPath) => {
    const trimmedPath = inputPath.trim();
    if (!trimmedPath) return '~';

    const lastSeparatorIndex = Math.max(trimmedPath.lastIndexOf('/'), trimmedPath.lastIndexOf('\\'));

    if (lastSeparatorIndex < 0) {
      return '~';
    }

    // Handle Windows drive root (e.g. C:\ or C:/) correctly.
    if (/^[A-Za-z]:[\\/]/.test(trimmedPath) && lastSeparatorIndex === 2) {
      return trimmedPath.slice(0, 3);
    }

    if (lastSeparatorIndex === 0) {
      return '/';
    }

    return trimmedPath.slice(0, lastSeparatorIndex);
  };

  const getProjectNameFromPath = (inputPath) => {
    const parts = String(inputPath || '').split(/[\\/]/).filter(Boolean);
    const lastPart = parts[parts.length - 1] || '';
    return /^[A-Za-z]:$/.test(lastPart) ? '' : lastPart;
  };

  const fetchWorkspaceRootSetting = () => api.getWorkspaceRoot();

  const browseFilesystemRequest = (dirPath = null, showHidden = false) => {
    return api.browseFilesystem(
      dirPath,
      showHidden,
      connectFolderOnly ? { purpose: 'connectFolder' } : undefined,
    );
  };

  const createFolderRequest = (folderPath) => api.createFolder(
    folderPath,
    connectFolderOnly ? { purpose: 'connectFolder' } : undefined,
  );

  const createWorkspaceRequest = (payload) => api.createWorkspace(payload);

  const getResolvedWorkspaceRoot = async () => {
    try {
      const response = await fetchWorkspaceRootSetting();
      const data = await response.json();
      const resolvedRoot = data.path || data.defaultPath || '~';
      setWorkspaceRoot(resolvedRoot);
      setWorkspaceRootDefault(data.defaultPath || resolvedRoot);
      setWorkspaceRootDisplay(data.displayPath || data.displayRoot || '');
      return resolvedRoot;
    } catch (error) {
      console.error('Error loading workspace root:', error);
      return workspaceRoot || '~';
    }
  };

  const suggestWorkspaceName = async (basePath) => {
    try {
      const response = await browseFilesystemRequest(basePath);
      const data = await response.json();
      const existingNames = Array.isArray(data.suggestions)
        ? data.suggestions.map((item) => item?.name).filter(Boolean)
        : [];
      return generateWorkspaceName(existingNames);
    } catch (error) {
      console.error('Error suggesting workspace name:', error);
      return generateWorkspaceName([]);
    }
  };

  // Auto-fill new workspace path so users can continue without opening folder browser.
  useEffect(() => {
    if (step !== 2 || workspaceType !== 'new' || (workspacePath.trim() && projectName.trim())) {
      return;
    }

    const autoFillPath = async () => {
      try {
        const basePath = await getResolvedWorkspaceRoot();
        const suggestedName = await suggestWorkspaceName(basePath);
        const suggestedPath = appendPathSegment(basePath, suggestedName);
        setWorkspacePath((currentPath) => (currentPath.trim() ? currentPath : suggestedPath));
        setProjectName((currentName) => (currentName.trim() ? currentName : suggestedName));
      } catch (error) {
        console.error('Error auto-filling workspace path:', error);
        const suggestedName = generateWorkspaceName([]);
        const fallbackPath = appendPathSegment(workspaceRoot || '~', suggestedName);
        setWorkspacePath((currentPath) => (currentPath.trim() ? currentPath : fallbackPath));
        setProjectName((currentName) => (currentName.trim() ? currentName : suggestedName));
      }
    };

    autoFillPath();
  }, [step, workspaceType, workspacePath, projectName]);

  // Load path suggestions
  useEffect(() => {
    if (workspacePath.length > 2) {
      loadPathSuggestions(workspacePath);
    } else {
      setPathSuggestions([]);
      setShowPathDropdown(false);
    }
  }, [workspacePath]);

  useEffect(() => {
    if (!showFolderBrowser) {
      return;
    }

    const refreshNewFolderName = async () => {
      const basePath = browserCurrentPath || (await getResolvedWorkspaceRoot());
      const suggestedName = await suggestWorkspaceName(basePath);
      setNewFolderName(suggestedName);
    };

    refreshNewFolderName();
  }, [showFolderBrowser, browserCurrentPath]);

  const loadPathSuggestions = async (inputPath) => {
    try {
      // Extract the directory to browse (parent of input)
      const dirPath = getParentDirectoryPath(inputPath);

      const response = await browseFilesystemRequest(dirPath);
      const data = await response.json();

      if (data.suggestions) {
        // Filter suggestions based on the input, excluding exact match
        const normalizedInput = normalizePathForComparison(inputPath);
        const filtered = data.suggestions.filter(s =>
          normalizePathForComparison(s.path).startsWith(normalizedInput) &&
          normalizePathForComparison(s.path) !== normalizedInput
        );
        setPathSuggestions(filtered.slice(0, 5));
        setShowPathDropdown(filtered.length > 0);
      }
    } catch (error) {
      console.error('Error loading path suggestions:', error);
    }
  };

  const handleNext = () => {
    setError(null);

    if (step === 1) {
      if (!workspaceType) {
        setError(t('projectWizard.errors.selectType'));
        return;
      }
      setStep(2);
    } else if (step === 2) {
      if (!workspacePath.trim()) {
        setError(t('projectWizard.errors.providePath'));
        return;
      }

      // If no project name specified, use the last part of path
      if (!projectName.trim()) {
        const parts = workspacePath.split(/[\\/]/).filter(Boolean);
        if (parts.length > 0) {
          setProjectName(parts[parts.length - 1]);
        }
      }

      // No validation for GitHub token - it's optional (only needed for private repos)
      setStep(3);
    }
  };

  const handleBack = () => {
    setError(null);
    setStep(step - 1);
  };

  const handleCreate = async () => {
    setIsCreating(true);
    setError(null);

    try {
      const payload = {
        workspaceType,
        path: workspacePath.trim(),
        displayName: projectName.trim(),
      };

      const response = await createWorkspaceRequest(payload);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.details || data.error || t('projectWizard.errors.failedToCreate'));
      }

      if (onProjectCreated) {
        const trimmedProjectName = projectName.trim() || data.project?.displayName || data.project?.name;
        const creationOptions = workspaceType === 'existing'
          ? {
              importedProjectAnalysisPrompt: {
                project: data.project,
                prompt: buildImportedWorkspaceScanPrompt(trimmedProjectName),
              },
            }
          : undefined;

        onProjectCreated(data.project, creationOptions);
      }

      onClose();
    } catch (error) {
      console.error('Error creating workspace:', error);
      setError(error.message || t('projectWizard.errors.failedToCreate'));
    } finally {
      setIsCreating(false);
    }
  };

  const connectExistingFolder = async (folderPath) => {
    if (isCreating) return;
    setIsCreating(true);
    setError(null);
    try {
      const response = await createWorkspaceRequest({
        workspaceType: 'existing',
        path: folderPath,
        displayName: getProjectNameFromPath(folderPath),
        connectionMode: 'localFolder',
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.details || data.error || t('projectWizard.errors.failedToConnect'));
      }
      onProjectCreated?.(data.project);
      onClose();
    } catch (connectError) {
      console.error('Error connecting workspace:', connectError);
      setError(connectError.message || t('projectWizard.errors.failedToConnect'));
    } finally {
      setIsCreating(false);
    }
  };

  const selectPathSuggestion = (suggestion) => {
    setWorkspacePath(suggestion.path);
    setShowPathDropdown(false);
  };

  const openFolderBrowser = async () => {
    setShowFolderBrowser(true);
    await loadBrowserFolders(await getResolvedWorkspaceRoot());
  };

  const loadBrowserFolders = async (path, showHidden = showHiddenFolders) => {
    try {
      setLoadingFolders(true);
      const response = await browseFilesystemRequest(path, showHidden);
      const data = await response.json();
      setBrowserCurrentPath(data.path || path);
      setBrowserCurrentDisplayPath(data.displayPath || getDisplayPath(data.path || path));
      setBrowserParentPath(data.parentPath || null);
      setBrowserIsVirtualRoot(Boolean(data.isVirtualRoot));
      setBrowserFolders(data.suggestions || []);
    } catch (error) {
      console.error('Error loading folders:', error);
    } finally {
      setLoadingFolders(false);
    }
  };

  useEffect(() => {
    if (!connectFolderOnly) {
      return;
    }
    const loadInitialFolder = async () => {
      const initialPath = await getResolvedWorkspaceRoot();
      await loadBrowserFolders(initialPath);
    };
    void loadInitialFolder();
  }, [connectFolderOnly]);

  const selectFolder = (folderPath, advanceToConfirm = false) => {
    if (connectFolderOnly) {
      void connectExistingFolder(folderPath);
      return;
    }
    setWorkspacePath(folderPath);
    setProjectName((currentName) => currentName.trim() || getProjectNameFromPath(folderPath));
    setShowFolderBrowser(false);
    if (advanceToConfirm) {
      setStep(3);
    }
  };

  const navigateToFolder = async (folderPath) => {
    await loadBrowserFolders(folderPath);
  };

  const createNewFolder = async () => {
    if (!newFolderName.trim()) return;
    setCreatingFolder(true);
    setError(null);
    try {
      if (browserIsVirtualRoot) {
        return;
      }
      const folderPath = appendPathSegment(browserCurrentPath, newFolderName.trim());
      const response = await createFolderRequest(folderPath);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || t('projectWizard.errors.failedToCreateFolder', 'Failed to create folder'));
      }
      const createdFolderPath = data.path || folderPath;
      if (connectFolderOnly) {
        await connectExistingFolder(createdFolderPath);
        return;
      }
      setWorkspacePath(createdFolderPath);
      setProjectName((currentName) => currentName.trim() || getProjectNameFromPath(createdFolderPath));
      setNewFolderName('');
      setShowNewFolderInput(false);
      setShowFolderBrowser(false);

      if (workspaceType === 'existing') {
        setStep(3);
      }
    } catch (error) {
      console.error('Error creating folder:', error);
      setError(error.message || t('projectWizard.errors.failedToCreateFolder', 'Failed to create folder'));
    } finally {
      setCreatingFolder(false);
    }
  };

  const wizard = (
    <div className={`fixed inset-0 z-[10000] ${connectFolderOnly ? '' : 'bg-black/50 backdrop-blur-sm flex items-center justify-center p-0 sm:p-4'}`}>
      {!connectFolderOnly && (
        <div className="bg-white dark:bg-gray-800 rounded-none sm:rounded-lg shadow-xl w-full h-full sm:h-auto sm:max-w-2xl border-0 sm:border border-gray-200 dark:border-gray-700 overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900/50 rounded-lg flex items-center justify-center">
              <FolderPlus className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              {t('projectWizard.title')}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700"
            disabled={isCreating}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Progress Indicator */}
        <div className="px-6 pt-4 pb-2">
          <div className="flex items-center justify-between">
            {[1, 2, 3].map((s) => (
              <React.Fragment key={s}>
                <div className="flex items-center gap-2">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center font-medium text-sm ${
                      s < step
                        ? 'bg-green-500 text-white'
                        : s === step
                        ? 'bg-blue-500 text-white'
                        : 'bg-gray-200 dark:bg-gray-700 text-gray-500'
                    }`}
                  >
                    {s < step ? <Check className="w-4 h-4" /> : s}
                  </div>
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300 hidden sm:inline">
                    {s === 1 ? t('projectWizard.steps.type') : s === 2 ? t('projectWizard.steps.configure') : t('projectWizard.steps.confirm')}
                  </span>
                </div>
                {s < 3 && (
                  <div
                    className={`flex-1 h-1 mx-2 rounded ${
                      s < step ? 'bg-green-500' : 'bg-gray-200 dark:bg-gray-700'
                    }`}
                  />
                )}
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 min-h-[300px]">
          {/* Error Display */}
          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
              </div>
            </div>
          )}

          {/* Step 1: Choose workspace type */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                  {t('projectWizard.step1.question')}
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Existing Workspace */}
                  <button
                    onClick={() => setWorkspaceType('existing')}
                    className={`p-4 border-2 rounded-lg text-left transition-all ${
                      workspaceType === 'existing'
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                        : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 bg-green-100 dark:bg-green-900/50 rounded-lg flex items-center justify-center flex-shrink-0">
                        <FolderPlus className="w-5 h-5 text-green-600 dark:text-green-400" />
                      </div>
                      <div className="flex-1">
                        <h5 className="font-semibold text-gray-900 dark:text-white mb-1">
                          {t('projectWizard.step1.existing.title')}
                        </h5>
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          {t('projectWizard.step1.existing.description')}
                        </p>
                      </div>
                    </div>
                  </button>

                  {/* New Workspace */}
                  <button
                    onClick={() => setWorkspaceType('new')}
                    className={`p-4 border-2 rounded-lg text-left transition-all ${
                      workspaceType === 'new'
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                        : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 bg-purple-100 dark:bg-purple-900/50 rounded-lg flex items-center justify-center flex-shrink-0">
                        <GitBranch className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                      </div>
                      <div className="flex-1">
                        <h5 className="font-semibold text-gray-900 dark:text-white mb-1">
                          {t('projectWizard.step1.new.title')}
                        </h5>
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          {t('projectWizard.step1.new.description')}
                        </p>
                      </div>
                    </div>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Configure workspace */}
          {step === 2 && (
            <div className="space-y-4">
              {/* Project Name (Optional/New) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t('projectWizard.step2.projectName', 'Project Name')}
                </label>
                <div className="flex gap-2">
                  <Input
                    type="text"
                    value={projectName}
                    onChange={(e) => {
                      const newName = e.target.value;
                      setProjectName(newName);

                      // If it's a new workspace and path follows default pattern, update path too
                      if (workspaceType === 'new' && newName.trim()) {
                        const parentPath = getParentDirectoryPath(workspacePath);
                        setWorkspacePath(appendPathSegment(parentPath, newName.trim()));
                      }
                    }}
                    placeholder={t('projectWizard.step2.projectNamePlaceholder', 'Enter project name')}
                    className="flex-1"
                  />
                  {workspaceType === 'new' && (
                    <Button
                      size="icon"
                      variant="outline"
                      type="button"
                      onClick={async () => {
                        const parentPath = getParentDirectoryPath(workspacePath);
                        const suggestedName = await suggestWorkspaceName(parentPath);
                        setProjectName(suggestedName);
                        setWorkspacePath(appendPathSegment(parentPath, suggestedName));
                      }}
                      title={t('projectWizard.folderBrowser.regenerateName')}
                    >
                      <RefreshCw className="w-4 h-4" />
                    </Button>
                  )}
                </div>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {t('projectWizard.step2.projectNameHelp', 'A friendly name for your project.')}
                </p>
              </div>

              {/* Workspace Path */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {workspaceType === 'existing' ? t('projectWizard.step2.existingPath') : t('projectWizard.step2.newPath')}
                </label>
                <div className="relative flex gap-2">
                  <div className="flex-1 relative">
                    <Input
                      type="text"
                      value={getInputPath()}
                      onChange={(e) => setWorkspacePath(toWorkspacePath(e.target.value))}
                      placeholder={workspaceType === 'existing' ? '/path/to/existing/workspace' : '/path/to/new/workspace'}
                      className="w-full"
                    />
                    {showPathDropdown && pathSuggestions.length > 0 && (
                      <div className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                        {pathSuggestions.map((suggestion, index) => (
                          <button
                            key={index}
                            onClick={() => selectPathSuggestion(suggestion)}
                            className="w-full px-4 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-700 text-sm"
                          >
                            <div className="font-medium text-gray-900 dark:text-white">{suggestion.name}</div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">{getDisplayPath(suggestion.path)}</div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {workspaceType === 'existing' && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={openFolderBrowser}
                      className="px-3"
                      title="Browse folders"
                    >
                      <FolderOpen className="w-4 h-4" />
                    </Button>
                  )}
                </div>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {workspaceType === 'existing'
                    ? t('projectWizard.step2.existingHelp')
                    : t('projectWizard.step2.newHelp')}
                </p>
              </div>
            </div>
          )}

          {/* Step 3: Confirm */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
                  {t('projectWizard.step3.reviewConfig')}
                </h4>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600 dark:text-gray-400">{t('projectWizard.step3.workspaceType')}</span>
                    <span className="font-medium text-gray-900 dark:text-white">
                      {workspaceType === 'existing' ? t('projectWizard.step3.existingWorkspace') : t('projectWizard.step3.newWorkspace')}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600 dark:text-gray-400">{t('projectWizard.step3.path')}</span>
                    <span className="font-mono text-xs text-gray-900 dark:text-white break-all">
                      {getDisplayPath(workspacePath)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 border border-blue-200 dark:border-blue-800">
                <p className="text-sm text-blue-800 dark:text-blue-200">
                  {workspaceType === 'existing'
                    ? t('projectWizard.step3.existingInfo')
                    : t('projectWizard.step3.newEmpty')}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t border-gray-200 dark:border-gray-700">
          <Button
            variant="outline"
            onClick={step === 1 ? onClose : handleBack}
            disabled={isCreating}
          >
            {step === 1 ? (
              t('projectWizard.buttons.cancel')
            ) : (
              <>
                <ChevronLeft className="w-4 h-4 mr-1" />
                {t('projectWizard.buttons.back')}
              </>
            )}
          </Button>

          <Button
            onClick={step === 3 ? handleCreate : handleNext}
            disabled={isCreating || (step === 1 && !workspaceType)}
          >
            {isCreating ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {t('projectWizard.buttons.creating')}
              </>
            ) : step === 3 ? (
              <>
                <Check className="w-4 h-4 mr-1" />
                {t('projectWizard.buttons.createProject')}
              </>
            ) : (
              <>
                {t('projectWizard.buttons.next')}
                <ChevronRight className="w-4 h-4 ml-1" />
              </>
            )}
          </Button>
        </div>
        </div>
      )}

      {/* Folder Browser Modal */}
      {showFolderBrowser && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[70] p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] border border-gray-200 dark:border-gray-700 flex flex-col">
            {/* Browser Header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900/50 rounded-lg flex items-center justify-center">
                  <FolderOpen className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  {t('projectWizard.connect.title')}
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const nextShowHidden = !showHiddenFolders;
                    setShowHiddenFolders(nextShowHidden);
                    loadBrowserFolders(browserCurrentPath, nextShowHidden);
                  }}
                  className={`p-2 rounded-md transition-colors ${
                    showHiddenFolders
                      ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30'
                      : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                  title={showHiddenFolders ? 'Hide hidden folders' : 'Show hidden folders'}
                >
                  {showHiddenFolders ? <Eye className="w-5 h-5" /> : <EyeOff className="w-5 h-5" />}
                </button>
                <button
                  onClick={async () => {
                    if (browserIsVirtualRoot) {
                      return;
                    }
                    const shouldShowInput = !showNewFolderInput;
                    setShowNewFolderInput(shouldShowInput);
                    if (shouldShowInput) {
                      const suggestedName = await suggestWorkspaceName(browserCurrentPath || workspaceRoot || '~');
                      setNewFolderName(suggestedName);
                    }
                  }}
                  className={`p-2 rounded-md transition-colors ${
                    showNewFolderInput
                      ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30'
                      : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                  } ${browserIsVirtualRoot ? 'cursor-not-allowed opacity-50' : ''}`}
                  title="Create new folder"
                  disabled={browserIsVirtualRoot}
                >
                  <Plus className="w-5 h-5" />
                </button>
                <button
                  onClick={() => connectFolderOnly ? onClose() : setShowFolderBrowser(false)}
                  className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {error && (
              <div className="mx-4 mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
                {error}
              </div>
            )}

            {/* New Folder Input */}
            {showNewFolderInput && !browserIsVirtualRoot && (
              <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-blue-50 dark:bg-blue-900/20">
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-2 flex-1">
                    <Input
                      type="text"
                      value={newFolderName}
                      onChange={(e) => setNewFolderName(e.target.value)}
                      placeholder="New folder name"
                      className="flex-1"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') createNewFolder();
                        if (e.key === 'Escape') {
                          setShowNewFolderInput(false);
                          setNewFolderName('');
                        }
                      }}
                      autoFocus
                    />
                    <Button
                      size="icon"
                      variant="outline"
                      type="button"
                      onClick={async () => {
                        const suggestedName = await suggestWorkspaceName(browserCurrentPath || workspaceRoot || '~');
                        setNewFolderName(suggestedName);
                      }}
                      title={t('projectWizard.folderBrowser.regenerateName')}
                      aria-label={t('projectWizard.folderBrowser.regenerateName')}
                    >
                      <RefreshCw className="w-4 h-4" />
                    </Button>
                  </div>
                  <Button
                    size="sm"
                    onClick={createNewFolder}
                    disabled={!newFolderName.trim() || creatingFolder}
                  >
                    {creatingFolder ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setShowNewFolderInput(false);
                      setNewFolderName('');
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {/* Folder List */}
            <div className="flex-1 overflow-y-auto p-4">
              {loadingFolders ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                </div>
              ) : (
                <div className="space-y-1">
                  {/* Parent Directory */}
                  {browserParentPath && (
                    <button
                      onClick={() => {
                        navigateToFolder(browserParentPath);
                      }}
                      className="w-full px-4 py-3 text-left hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg flex items-center gap-3"
                    >
                      <FolderOpen className="w-5 h-5 text-gray-400" />
                      <span className="font-medium text-gray-700 dark:text-gray-300">..</span>
                    </button>
                  )}

                  {/* Folders */}
                  {browserFolders.length === 0 ? (
                    <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                      No subfolders found
                    </div>
                  ) : (
                    browserFolders
                      .filter(folder => showHiddenFolders || !folder.name.startsWith('.'))
                      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
                      .map((folder, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <button
                          onClick={() => navigateToFolder(folder.path)}
                          className="flex-1 px-4 py-3 text-left hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg flex items-center gap-3"
                        >
                          {folder.isDrive ? (
                            <HardDrive className="w-5 h-5 text-blue-500" />
                          ) : (
                            <FolderPlus className="w-5 h-5 text-blue-500" />
                          )}
                          <span className="font-medium text-gray-900 dark:text-white">{folder.name}</span>
                        </button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => selectFolder(folder.path, workspaceType === 'existing')}
                          disabled={folder.isDrive || isCreating}
                          className="text-xs px-3"
                        >
                          {isCreating ? t('projectWizard.connect.connecting') : t('projectWizard.connect.select')}
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Browser Footer with Current Path */}
            <div className="border-t border-gray-200 dark:border-gray-700">
              <div className="px-4 py-3 bg-gray-50 dark:bg-gray-900/50 flex items-center gap-2">
                <span className="text-sm text-gray-600 dark:text-gray-400">Path:</span>
                <code className="text-sm font-mono text-gray-900 dark:text-white flex-1 truncate">
                  {browserCurrentDisplayPath || getDisplayPath(browserCurrentPath)}
                </code>
              </div>
              <div className="flex items-center justify-end gap-2 p-4">
                <Button
                  variant="outline"
                  onClick={() => {
                    if (connectFolderOnly) {
                      onClose();
                      return;
                    }
                    setShowFolderBrowser(false);
                    setShowNewFolderInput(false);
                    setNewFolderName('');
                  }}
                >
                  {t('projectWizard.buttons.cancel')}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => selectFolder(browserCurrentPath, workspaceType === 'existing')}
                  disabled={isCreating || browserIsVirtualRoot || isWindowsDriveRootPath(browserCurrentPath)}
                >
                  {isCreating ? t('projectWizard.connect.connecting') : t('projectWizard.connect.useThisFolder')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  return typeof document !== 'undefined'
    ? createPortal(wizard, document.body)
    : wizard;
};

export default ProjectCreationWizard;
