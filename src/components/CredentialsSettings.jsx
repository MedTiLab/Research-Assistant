import { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Key, Plus, Trash2, Eye, EyeOff, Copy, Check, Github, ExternalLink, Sparkles } from 'lucide-react';
import { useVersionCheck } from '../hooks/useVersionCheck';
import { version } from '../../package.json';
import { authenticatedFetch } from '../utils/api';
import { getOnlineResourceUrl } from '../utils/onlineResources';
import { useTranslation } from 'react-i18next';

function CredentialsSettings({ onCredentialsChanged }) {
  const { t } = useTranslation('settings');
  const [apiKeys, setApiKeys] = useState([]);
  const [githubCredentials, setGithubCredentials] = useState([]);
  const [geminiCredentials, setGeminiCredentials] = useState([]);
  const [geminiBaseUrlCredentials, setGeminiBaseUrlCredentials] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNewKeyForm, setShowNewKeyForm] = useState(false);
  const [showNewGithubForm, setShowNewGithubForm] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newGithubName, setNewGithubName] = useState('');
  const [newGithubToken, setNewGithubToken] = useState('');
  const [newGithubDescription, setNewGithubDescription] = useState('');
  const [newGeminiKey, setNewGeminiKey] = useState('');
  const [newGeminiBaseUrl, setNewGeminiBaseUrl] = useState('');
  const [showToken, setShowToken] = useState({});
  const [copiedKey, setCopiedKey] = useState(null);
  const [newlyCreatedKey, setNewlyCreatedKey] = useState(null);
  const [isResettingRuntime, setIsResettingRuntime] = useState(false);
  const [runtimeResetStatus, setRuntimeResetStatus] = useState(null);
  const activeGeminiBaseUrlCredential = geminiBaseUrlCredentials.find((credential) => credential.is_active) || geminiBaseUrlCredentials[0] || null;

  // Version check hook
  const { updateAvailable, latestVersion, releaseInfo } = useVersionCheck('MedTiLab', 'Research-Assistant');

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    setNewGeminiBaseUrl(activeGeminiBaseUrlCredential?.credential_name || '');
  }, [activeGeminiBaseUrlCredential?.id, activeGeminiBaseUrlCredential?.credential_name]);

  const fetchData = async () => {
    try {
      setLoading(true);

      // Fetch API keys
      const apiKeysRes = await authenticatedFetch('/api/settings/api-keys');
      const apiKeysData = await apiKeysRes.json();
      setApiKeys(apiKeysData.apiKeys || []);

      // Fetch GitHub credentials only
      const credentialsRes = await authenticatedFetch('/api/settings/credentials?type=github_token');
      const credentialsData = await credentialsRes.json();
      setGithubCredentials(credentialsData.credentials || []);

      // Fetch Gemini API key credentials
      const geminiRes = await authenticatedFetch('/api/settings/credentials?type=gemini_api_key');
      const geminiData = await geminiRes.json();
      setGeminiCredentials(geminiData.credentials || []);

      // Fetch Gemini API base URL credentials
      const geminiBaseUrlRes = await authenticatedFetch('/api/settings/credentials?type=gemini_api_base_url');
      const geminiBaseUrlData = await geminiBaseUrlRes.json();
      setGeminiBaseUrlCredentials(geminiBaseUrlData.credentials || []);
    } catch (error) {
      console.error('Error fetching settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const createApiKey = async () => {
    if (!newKeyName.trim()) return;

    try {
      const res = await authenticatedFetch('/api/settings/api-keys', {
        method: 'POST',
        body: JSON.stringify({ keyName: newKeyName })
      });

      const data = await res.json();
      if (data.success) {
        setNewlyCreatedKey(data.apiKey);
        setNewKeyName('');
        setShowNewKeyForm(false);
        fetchData();
      }
    } catch (error) {
      console.error('Error creating API key:', error);
    }
  };

  const deleteApiKey = async (keyId) => {
    if (!confirm(t('apiKeys.confirmDelete'))) return;

    try {
      await authenticatedFetch(`/api/settings/api-keys/${keyId}`, {
        method: 'DELETE'
      });
      fetchData();
    } catch (error) {
      console.error('Error deleting API key:', error);
    }
  };

  const toggleApiKey = async (keyId, isActive) => {
    try {
      await authenticatedFetch(`/api/settings/api-keys/${keyId}/toggle`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !isActive })
      });
      fetchData();
    } catch (error) {
      console.error('Error toggling API key:', error);
    }
  };

  const createGithubCredential = async () => {
    if (!newGithubName.trim() || !newGithubToken.trim()) return;

    try {
      const res = await authenticatedFetch('/api/settings/credentials', {
        method: 'POST',
        body: JSON.stringify({
          credentialName: newGithubName,
          credentialType: 'github_token',
          credentialValue: newGithubToken,
          description: newGithubDescription
        })
      });

      const data = await res.json();
      if (data.success) {
        setNewGithubName('');
        setNewGithubToken('');
        setNewGithubDescription('');
        setShowNewGithubForm(false);
        fetchData();
        onCredentialsChanged?.('github_token');
      }
    } catch (error) {
      console.error('Error creating GitHub credential:', error);
    }
  };

  const deleteGithubCredential = async (credentialId) => {
    if (!confirm(t('apiKeys.github.confirmDelete'))) return;

    try {
      await authenticatedFetch(`/api/settings/credentials/${credentialId}`, {
        method: 'DELETE'
      });
      fetchData();
      onCredentialsChanged?.('github_token');
    } catch (error) {
      console.error('Error deleting GitHub credential:', error);
    }
  };

  const toggleGithubCredential = async (credentialId, isActive) => {
    try {
      await authenticatedFetch(`/api/settings/credentials/${credentialId}/toggle`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !isActive })
      });
      fetchData();
      onCredentialsChanged?.('github_token');
    } catch (error) {
      console.error('Error toggling GitHub credential:', error);
    }
  };

  const deleteCredentialsByType = async (credentials) => {
    await Promise.all(
      credentials.map((credential) =>
        authenticatedFetch(`/api/settings/credentials/${credential.id}`, {
          method: 'DELETE'
        })
      )
    );
  };

  const clearGeminiCredential = async () => {
    if (!geminiCredentials.length) return;
    if (!confirm(t('apiKeys.gemini.confirmDelete'))) return;

    try {
      await deleteCredentialsByType(geminiCredentials);
      setNewGeminiKey('');
      fetchData();
      onCredentialsChanged?.('gemini_api_key');
    } catch (error) {
      console.error('Error deleting Gemini credential:', error);
    }
  };

  const clearGeminiBaseUrlCredential = async () => {
    if (!geminiBaseUrlCredentials.length) return;
    if (!confirm(t('apiKeys.gemini.baseUrl.confirmDelete'))) return;

    try {
      await deleteCredentialsByType(geminiBaseUrlCredentials);
      setNewGeminiBaseUrl('');
      fetchData();
      onCredentialsChanged?.('gemini_api_base_url');
    } catch (error) {
      console.error('Error deleting Gemini base URL credential:', error);
    }
  };

  const copyToClipboard = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(id);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const saveGeminiDirectApiConfig = async () => {
    const trimmedKey = newGeminiKey.trim();
    const trimmedBaseUrl = newGeminiBaseUrl.trim().replace(/\/+$/, '');
    const currentBaseUrl = (activeGeminiBaseUrlCredential?.credential_name || '').trim().replace(/\/+$/, '');
    const shouldUpdateKey = Boolean(trimmedKey);
    const shouldUpdateBaseUrl = trimmedBaseUrl !== currentBaseUrl;

    if (!shouldUpdateKey && !shouldUpdateBaseUrl) return;

    if (shouldUpdateBaseUrl && trimmedBaseUrl) {
      try {
        new URL(trimmedBaseUrl);
      } catch {
        alert(t('apiKeys.gemini.baseUrl.invalid'));
        return;
      }
    }

    try {
      if (shouldUpdateKey) {
        await deleteCredentialsByType(geminiCredentials);
        await authenticatedFetch('/api/settings/credentials', {
          method: 'POST',
          body: JSON.stringify({
            credentialName: 'Gemini API Key',
            credentialType: 'gemini_api_key',
            credentialValue: trimmedKey,
            description: ''
          })
        });
      }

      if (shouldUpdateBaseUrl) {
        await deleteCredentialsByType(geminiBaseUrlCredentials);

        if (trimmedBaseUrl) {
          await authenticatedFetch('/api/settings/credentials', {
            method: 'POST',
            body: JSON.stringify({
              credentialName: trimmedBaseUrl,
              credentialType: 'gemini_api_base_url',
              credentialValue: trimmedBaseUrl,
              description: ''
            })
          });
        }
      }

      setNewGeminiKey('');
      if (shouldUpdateBaseUrl) {
        setNewGeminiBaseUrl(trimmedBaseUrl);
      }
      fetchData();
      if (shouldUpdateKey) onCredentialsChanged?.('gemini_api_key');
      if (shouldUpdateBaseUrl) onCredentialsChanged?.('gemini_api_base_url');
    } catch (error) {
      console.error('Error saving Gemini direct API config:', error);
    }
  };

  const resetRuntime = async () => {
    const confirmText = t('apiKeys.runtimeReset.confirm', {
      defaultValue:
        'Reset runtime? This will abort all active sessions and clear in-memory caches. It will not delete session history.',
    });
    if (!confirm(confirmText)) return;

    try {
      setIsResettingRuntime(true);
      setRuntimeResetStatus(null);
      const res = await authenticatedFetch('/api/settings/runtime-reset', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || 'Runtime reset failed');
      }
      setRuntimeResetStatus({ ok: true, results: data.results });
      fetchData();
    } catch (error) {
      setRuntimeResetStatus({ ok: false, error: error.message || String(error) });
    } finally {
      setIsResettingRuntime(false);
    }
  };

  if (loading) {
    return <div className="text-muted-foreground">{t('apiKeys.loading')}</div>;
  }

  return (
    <div className="space-y-8">
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
        <div className="flex items-start gap-3">
          <Sparkles className="mt-0.5 h-5 w-5" />
          <div className="flex-1">
            <div className="font-medium">
              {t('apiKeys.runtimeReset.title', { defaultValue: 'Runtime reset (panic button)' })}
            </div>
            <div className="mt-1 text-sm opacity-90">
              {t('apiKeys.runtimeReset.description', {
                defaultValue:
                  'If the backend gets stuck (sessions keep “processing” and no output), use this to abort active sessions and clear in-memory caches. No history is deleted.',
              })}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <Button variant="destructive" onClick={resetRuntime} disabled={isResettingRuntime}>
                {isResettingRuntime
                  ? t('apiKeys.runtimeReset.resetting', { defaultValue: 'Resetting…' })
                  : t('apiKeys.runtimeReset.action', { defaultValue: 'Reset runtime now' })}
              </Button>
              {runtimeResetStatus?.ok && (
                <span className="text-sm">
                  {t('apiKeys.runtimeReset.success', { defaultValue: 'Done.' })}
                </span>
              )}
              {runtimeResetStatus && runtimeResetStatus.ok === false && (
                <span className="text-sm text-red-700 dark:text-red-300">
                  {t('apiKeys.runtimeReset.failed', { defaultValue: 'Failed:' })} {runtimeResetStatus.error}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* New API Key Alert */}
      {newlyCreatedKey && (
        <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
          <h4 className="font-semibold text-yellow-500 mb-2">{t('apiKeys.newKey.alertTitle')}</h4>
          <p className="text-sm text-muted-foreground mb-3">
            {t('apiKeys.newKey.alertMessage')}
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 px-3 py-2 bg-background/50 rounded font-mono text-sm break-all">
              {newlyCreatedKey.apiKey}
            </code>
            <Button
              size="sm"
              variant="outline"
              onClick={() => copyToClipboard(newlyCreatedKey.apiKey, 'new')}
            >
              {copiedKey === 'new' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="mt-3"
            onClick={() => setNewlyCreatedKey(null)}
          >
            {t('apiKeys.newKey.iveSavedIt')}
          </Button>
        </div>
      )}

      {/* API Keys Section */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            <h3 className="text-lg font-semibold">{t('apiKeys.title')}</h3>
          </div>
          <Button
            size="sm"
            onClick={() => setShowNewKeyForm(!showNewKeyForm)}
          >
            <Plus className="h-4 w-4 mr-1" />
            {t('apiKeys.newButton')}
          </Button>
        </div>

        <div className="mb-4">
          <p className="text-sm text-muted-foreground mb-2">
            {t('apiKeys.description')}
          </p>
          <a
            href={getOnlineResourceUrl('/api-docs.html')}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-primary hover:underline inline-flex items-center gap-1"
          >
            {t('apiKeys.apiDocsLink')}
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>

        {showNewKeyForm && (
          <div className="mb-4 p-4 border rounded-lg bg-card">
            <Input
              placeholder={t('apiKeys.form.placeholder')}
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              className="mb-2"
            />
            <div className="flex gap-2">
              <Button onClick={createApiKey}>{t('apiKeys.form.createButton')}</Button>
              <Button variant="outline" onClick={() => setShowNewKeyForm(false)}>
                {t('apiKeys.form.cancelButton')}
              </Button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          {apiKeys.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">{t('apiKeys.empty')}</p>
          ) : (
            apiKeys.map((key) => (
              <div
                key={key.id}
                className="flex items-center justify-between p-3 border rounded-lg"
              >
                <div className="flex-1">
                  <div className="font-medium">{key.key_name}</div>
                  <code className="text-xs text-muted-foreground">{key.api_key}</code>
                  <div className="text-xs text-muted-foreground mt-1">
                    {t('apiKeys.list.created')} {new Date(key.created_at).toLocaleDateString()}
                    {key.last_used && ` • ${t('apiKeys.list.lastUsed')} ${new Date(key.last_used).toLocaleDateString()}`}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant={key.is_active ? 'outline' : 'secondary'}
                    onClick={() => toggleApiKey(key.id, key.is_active)}
                  >
                    {key.is_active ? t('apiKeys.status.active') : t('apiKeys.status.inactive')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => deleteApiKey(key.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* GitHub Credentials Section */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Github className="h-5 w-5" />
            <h3 className="text-lg font-semibold">{t('apiKeys.github.title')}</h3>
          </div>
          <Button
            size="sm"
            onClick={() => setShowNewGithubForm(!showNewGithubForm)}
          >
            <Plus className="h-4 w-4 mr-1" />
            {t('apiKeys.github.addButton')}
          </Button>
        </div>

        <p className="text-sm text-muted-foreground mb-4">
          {t('apiKeys.github.descriptionAlt')}
        </p>

        {showNewGithubForm && (
          <div className="mb-4 p-4 border rounded-lg bg-card space-y-3">
            <Input
              placeholder={t('apiKeys.github.form.namePlaceholder')}
              value={newGithubName}
              onChange={(e) => setNewGithubName(e.target.value)}
            />

            <div className="relative">
              <Input
                type={showToken['new'] ? 'text' : 'password'}
                placeholder={t('apiKeys.github.form.tokenPlaceholder')}
                value={newGithubToken}
                onChange={(e) => setNewGithubToken(e.target.value)}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowToken({ ...showToken, new: !showToken['new'] })}
                className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground"
              >
                {showToken['new'] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>

            <Input
              placeholder={t('apiKeys.github.form.descriptionPlaceholder')}
              value={newGithubDescription}
              onChange={(e) => setNewGithubDescription(e.target.value)}
            />

            <div className="flex gap-2">
              <Button onClick={createGithubCredential}>{t('apiKeys.github.form.addButton')}</Button>
              <Button variant="outline" onClick={() => {
                setShowNewGithubForm(false);
                setNewGithubName('');
                setNewGithubToken('');
                setNewGithubDescription('');
              }}>
                {t('apiKeys.github.form.cancelButton')}
              </Button>
            </div>

            <a
              href="https://github.com/settings/tokens"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary hover:underline block"
            >
              {t('apiKeys.github.form.howToCreate')}
            </a>
          </div>
        )}

        <div className="space-y-2">
          {githubCredentials.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">{t('apiKeys.github.empty')}</p>
          ) : (
            githubCredentials.map((credential) => (
              <div
                key={credential.id}
                className="flex items-center justify-between p-3 border rounded-lg"
              >
                <div className="flex-1">
                  <div className="font-medium">{credential.credential_name}</div>
                  {credential.description && (
                    <div className="text-xs text-muted-foreground">{credential.description}</div>
                  )}
                  <div className="text-xs text-muted-foreground mt-1">
                    {t('apiKeys.github.added')} {new Date(credential.created_at).toLocaleDateString()}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant={credential.is_active ? 'outline' : 'secondary'}
                    onClick={() => toggleGithubCredential(credential.id, credential.is_active)}
                  >
                    {credential.is_active ? t('apiKeys.status.active') : t('apiKeys.status.inactive')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => deleteGithubCredential(credential.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Gemini API Key Section */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Sparkles className="h-5 w-5" />
          <h3 className="text-lg font-semibold">{t('apiKeys.gemini.title')}</h3>
        </div>
        <p className="text-sm text-muted-foreground mb-4">{t('apiKeys.gemini.purpose')}</p>

        <div className="rounded-lg border p-4 bg-card space-y-4">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="text-sm font-medium">{t('apiKeys.gemini.baseUrl.title')}</div>
              <Input
                placeholder={t('apiKeys.gemini.baseUrl.placeholder')}
                value={newGeminiBaseUrl}
                onChange={(e) => setNewGeminiBaseUrl(e.target.value)}
              />
            </div>
            {geminiBaseUrlCredentials.length > 0 && (
              <Button
                size="icon"
                variant="ghost"
                className="mt-6 shrink-0"
                onClick={clearGeminiBaseUrlCredential}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="mb-2 text-sm font-medium">{t('apiKeys.gemini.form.keyLabel')}</div>
              <div className="relative">
                <Input
                  type={showToken['gemini-new'] ? 'text' : 'password'}
                  placeholder={t('apiKeys.gemini.form.keyPlaceholder')}
                  value={newGeminiKey}
                  onChange={(e) => setNewGeminiKey(e.target.value)}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowToken({ ...showToken, 'gemini-new': !showToken['gemini-new'] })}
                  className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground"
                >
                  {showToken['gemini-new'] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            {geminiCredentials.length > 0 && (
              <Button
                size="icon"
                variant="ghost"
                className="mt-6 shrink-0"
                onClick={clearGeminiCredential}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>

          <div className="flex justify-end">
            <Button onClick={saveGeminiDirectApiConfig}>{t('apiKeys.gemini.form.saveButton')}</Button>
          </div>
        </div>
      </div>

      {/* Version Information */}
      <div className="pt-6 border-t border-border/50">
        <div className="flex items-center justify-between text-xs italic text-muted-foreground/60">
          <a
            href={releaseInfo?.htmlUrl || 'https://github.com/MedTiLab/Research-Assistant/releases'}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-muted-foreground transition-colors"
          >
            v{version}
          </a>
          {updateAvailable && latestVersion && (
            <a
              href={releaseInfo?.htmlUrl || 'https://github.com/MedTiLab/Research-Assistant/releases'}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-2 py-0.5 bg-green-500/10 text-green-600 dark:text-green-400 rounded-full hover:bg-green-500/20 transition-colors not-italic font-medium"
            >
              <span className="text-[10px]">{t('apiKeys.version.updateAvailable', { version: latestVersion })}</span>
              <ExternalLink className="h-2.5 w-2.5" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

export default CredentialsSettings;
