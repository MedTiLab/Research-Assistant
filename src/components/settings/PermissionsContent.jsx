import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Shield, AlertTriangle, Plus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// Common tool patterns for Claude
const commonClaudeTools = [
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

// Claude Permissions
function ClaudePermissions({
  skipPermissions,
  setSkipPermissions,
  allowedTools,
  setAllowedTools,
  disallowedTools,
  setDisallowedTools,
  newAllowedTool,
  setNewAllowedTool,
  newDisallowedTool,
  setNewDisallowedTool,
}) {
  const { t } = useTranslation('settings');
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

  return (
    <div className="space-y-6">
      {/* Skip Permissions */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-orange-500" />
          <h3 className="text-lg font-medium text-foreground">
            {t('permissions.title')}
          </h3>
        </div>
        <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg p-4">
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={skipPermissions}
              onChange={(e) => setSkipPermissions(e.target.checked)}
              className="w-4 h-4 text-blue-600 bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600 rounded focus:ring-blue-500 focus:ring-2"
            />
            <div>
              <div className="font-medium text-orange-900 dark:text-orange-100">
                {t('permissions.skipPermissions.label')}
              </div>
              <div className="text-sm text-orange-700 dark:text-orange-300">
                {t('permissions.skipPermissions.claudeDescription')}
              </div>
            </div>
          </label>
        </div>
      </div>

      {/* Allowed Tools */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Shield className="w-5 h-5 text-green-500" />
          <h3 className="text-lg font-medium text-foreground">
            {t('permissions.allowedTools.title')}
          </h3>
        </div>
        <p className="text-sm text-muted-foreground">
          {t('permissions.allowedTools.description')}
        </p>

        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            value={newAllowedTool}
            onChange={(e) => setNewAllowedTool(e.target.value)}
            placeholder={t('permissions.allowedTools.placeholder')}
            onKeyPress={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addAllowedTool(newAllowedTool);
              }
            }}
            className="flex-1 h-10"
          />
          <Button
            onClick={() => addAllowedTool(newAllowedTool)}
            disabled={!newAllowedTool}
            size="sm"
            className="h-10 px-4"
          >
            <Plus className="w-4 h-4 mr-2 sm:mr-0" />
            <span className="sm:hidden">{t('permissions.actions.add')}</span>
          </Button>
        </div>

        {/* Quick add buttons */}
        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('permissions.allowedTools.quickAdd')}
          </p>
          <div className="flex flex-wrap gap-2">
            {commonClaudeTools.map(tool => (
              <Button
                key={tool}
                variant="outline"
                size="sm"
                onClick={() => addAllowedTool(tool)}
                disabled={allowedTools.includes(tool)}
                className="text-xs h-8"
              >
                {tool}
              </Button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          {allowedTools.map(tool => (
            <div key={tool} className="flex items-center justify-between bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3">
              <span className="font-mono text-sm text-green-800 dark:text-green-200">
                {tool}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeAllowedTool(tool)}
                className="text-green-600 hover:text-green-700"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          ))}
          {allowedTools.length === 0 && (
            <div className="text-center py-6 text-gray-500 dark:text-gray-400">
              {t('permissions.allowedTools.empty')}
            </div>
          )}
        </div>
      </div>

      {/* Disallowed Tools */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-red-500" />
          <h3 className="text-lg font-medium text-foreground">
            {t('permissions.blockedTools.title')}
          </h3>
        </div>
        <p className="text-sm text-muted-foreground">
          {t('permissions.blockedTools.description')}
        </p>

        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            value={newDisallowedTool}
            onChange={(e) => setNewDisallowedTool(e.target.value)}
            placeholder={t('permissions.blockedTools.placeholder')}
            onKeyPress={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addDisallowedTool(newDisallowedTool);
              }
            }}
            className="flex-1 h-10"
          />
          <Button
            onClick={() => addDisallowedTool(newDisallowedTool)}
            disabled={!newDisallowedTool}
            size="sm"
            className="h-10 px-4"
          >
            <Plus className="w-4 h-4 mr-2 sm:mr-0" />
            <span className="sm:hidden">{t('permissions.actions.add')}</span>
          </Button>
        </div>

        <div className="space-y-2">
          {disallowedTools.map(tool => (
            <div key={tool} className="flex items-center justify-between bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
              <span className="font-mono text-sm text-red-800 dark:text-red-200">
                {tool}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeDisallowedTool(tool)}
                className="text-red-600 hover:text-red-700"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          ))}
          {disallowedTools.length === 0 && (
            <div className="text-center py-6 text-gray-500 dark:text-gray-400">
              {t('permissions.blockedTools.empty')}
            </div>
          )}
        </div>
      </div>

      {/* Help Section */}
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
        <h4 className="font-medium text-blue-900 dark:text-blue-100 mb-2">
          {t('permissions.toolExamples.title')}
        </h4>
        <ul className="text-sm text-blue-800 dark:text-blue-200 space-y-1">
          <li><code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">"Bash(git log:*)"</code> {t('permissions.toolExamples.bashGitLog')}</li>
          <li><code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">"Bash(git diff:*)"</code> {t('permissions.toolExamples.bashGitDiff')}</li>
          <li><code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">"Write"</code> {t('permissions.toolExamples.write')}</li>
          <li><code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">"Bash(rm:*)"</code> {t('permissions.toolExamples.bashRm')}</li>
        </ul>
      </div>
    </div>
  );
}

// Codex Permissions
function CodexPermissions({ permissionMode, setPermissionMode }) {
  const { t } = useTranslation('settings');
  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Shield className="w-5 h-5 text-green-500" />
          <h3 className="text-lg font-medium text-foreground">
            {t('permissions.codex.permissionMode')}
          </h3>
        </div>
        <p className="text-sm text-muted-foreground">
          {t('permissions.codex.description')}
        </p>

        {/* Default Mode */}
        <div
          className={`border rounded-lg p-4 cursor-pointer transition-all ${
            permissionMode === 'default'
              ? 'bg-gray-100 dark:bg-gray-800 border-gray-400 dark:border-gray-500'
              : 'bg-gray-50 dark:bg-gray-900/50 border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
          }`}
          onClick={() => setPermissionMode('default')}
        >
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="radio"
              name="codexPermissionMode"
              checked={permissionMode === 'default'}
              onChange={() => setPermissionMode('default')}
              className="mt-1 w-4 h-4 text-green-600"
            />
            <div>
              <div className="font-medium text-foreground">{t('permissions.codex.modes.default.title')}</div>
              <div className="text-sm text-muted-foreground">
                {t('permissions.codex.modes.default.description')}
              </div>
            </div>
          </label>
        </div>

        {/* Accept Edits Mode */}
        <div
          className={`border rounded-lg p-4 cursor-pointer transition-all ${
            permissionMode === 'acceptEdits'
              ? 'bg-green-50 dark:bg-green-900/20 border-green-400 dark:border-green-600'
              : 'bg-gray-50 dark:bg-gray-900/50 border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
          }`}
          onClick={() => setPermissionMode('acceptEdits')}
        >
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="radio"
              name="codexPermissionMode"
              checked={permissionMode === 'acceptEdits'}
              onChange={() => setPermissionMode('acceptEdits')}
              className="mt-1 w-4 h-4 text-green-600"
            />
            <div>
              <div className="font-medium text-green-900 dark:text-green-100">{t('permissions.codex.modes.acceptEdits.title')}</div>
              <div className="text-sm text-green-700 dark:text-green-300">
                {t('permissions.codex.modes.acceptEdits.description')}
              </div>
            </div>
          </label>
        </div>

        {/* Bypass Permissions Mode */}
        <div
          className={`border rounded-lg p-4 cursor-pointer transition-all ${
            permissionMode === 'bypassPermissions'
              ? 'bg-orange-50 dark:bg-orange-900/20 border-orange-400 dark:border-orange-600'
              : 'bg-gray-50 dark:bg-gray-900/50 border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
          }`}
          onClick={() => setPermissionMode('bypassPermissions')}
        >
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="radio"
              name="codexPermissionMode"
              checked={permissionMode === 'bypassPermissions'}
              onChange={() => setPermissionMode('bypassPermissions')}
              className="mt-1 w-4 h-4 text-orange-600"
            />
            <div>
              <div className="font-medium text-orange-900 dark:text-orange-100 flex items-center gap-2">
                {t('permissions.codex.modes.bypassPermissions.title')}
                <AlertTriangle className="w-4 h-4" />
              </div>
              <div className="text-sm text-orange-700 dark:text-orange-300">
                {t('permissions.codex.modes.bypassPermissions.description')}
              </div>
            </div>
          </label>
        </div>

        {/* Technical Details */}
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            {t('permissions.codex.technicalDetails')}
          </summary>
          <div className="mt-2 p-3 bg-gray-50 dark:bg-gray-900/50 rounded-lg text-xs text-muted-foreground space-y-2">
            <p><strong>{t('permissions.codex.modes.default.title')}:</strong> {t('permissions.codex.technicalInfo.default')}</p>
            <p><strong>{t('permissions.codex.modes.acceptEdits.title')}:</strong> {t('permissions.codex.technicalInfo.acceptEdits')}</p>
            <p><strong>{t('permissions.codex.modes.bypassPermissions.title')}:</strong> {t('permissions.codex.technicalInfo.bypassPermissions')}</p>
            <p className="text-xs opacity-75">{t('permissions.codex.technicalInfo.overrideNote')}</p>
          </div>
        </details>
      </div>
    </div>
  );
}

// Main component
export default function PermissionsContent({ agent, ...props }) {
  if (agent === 'claude') {
    return <ClaudePermissions {...props} />;
  }
  if (agent === 'codex') {
    return <CodexPermissions {...props} />;
  }
  return null;
}
