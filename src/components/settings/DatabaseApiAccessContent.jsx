import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Database, Eye, EyeOff, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { authenticatedFetch } from '../../utils/api';

const DEFAULT_DATABASE_API_BASE_URL = 'https://api.medtimehelp.com';

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '').replace(/\/api\/v1$/i, '');
}

function resolveStatusMessage(t, message, fallbackKey) {
  if (typeof message !== 'string' || !message.trim()) {
    return t(fallbackKey);
  }

  const key = {
    'Failed to load database API settings': 'databaseApiAccess.status.loadFailed',
    'Invalid API base URL': 'databaseApiAccess.status.invalidBaseUrl',
    'Database API token is required': 'databaseApiAccess.status.tokenRequired',
    'Database API credentials were rejected': 'databaseApiAccess.status.credentialsRejected',
    'Database API access is not authorized': 'databaseApiAccess.status.accessNotAuthorized',
    'Database API service is unavailable': 'databaseApiAccess.status.serviceUnavailable',
    'Unexpected Database API response': 'databaseApiAccess.status.unexpectedResponse',
    'Failed to test database API connection': 'databaseApiAccess.status.testFailed',
    'Failed to save database API settings': 'databaseApiAccess.status.saveFailed',
    'Failed to clear database API settings': 'databaseApiAccess.status.clearFailed',
  }[message];

  return key ? t(key) : message;
}

function resolveConnectionMessage(t, connection) {
  if (connection?.status === 'connected') {
    return t('databaseApiAccess.connection.connected', {
      count: connection.accessibleSourceCount ?? 0,
    });
  }
  const statusKey = {
    unverified: 'unverified',
    invalid_credentials: 'invalidCredentials',
    access_denied: 'accessDenied',
    unavailable: 'unavailable',
    invalid_response: 'invalidResponse',
  }[connection?.status];
  return statusKey
    ? t(`databaseApiAccess.connection.${statusKey}`)
    : t('databaseApiAccess.connection.notConfigured');
}

export default function DatabaseApiAccessContent({ embedded = false, onStatusChange }) {
  const { t } = useTranslation('settings');
  const [baseUrl, setBaseUrl] = useState(DEFAULT_DATABASE_API_BASE_URL);
  const [savedBaseUrl, setSavedBaseUrl] = useState(DEFAULT_DATABASE_API_BASE_URL);
  const [token, setToken] = useState('');
  const [tokenConfigured, setTokenConfigured] = useState(false);
  const [connection, setConnection] = useState({ connected: false, status: 'not_configured' });
  const [showToken, setShowToken] = useState(false);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [status, setStatus] = useState(null);
  const [copied, setCopied] = useState(false);

  const normalizedBaseUrl = useMemo(
    () => normalizeBaseUrl(baseUrl) || DEFAULT_DATABASE_API_BASE_URL,
    [baseUrl],
  );

  const curlExample = useMemo(() => {
    const endpoint = `${normalizedBaseUrl}/api/v1/datasets/<dataset_id>/download`;
    return [
      'curl -L -H "Authorization: Bearer <your_mdpat_token>" \\',
      `  "${endpoint}" -o dataset.csv`,
    ].join('\n');
  }, [normalizedBaseUrl]);

  const loadSettings = async () => {
    try {
      setLoading(true);
      setStatus(null);
      const response = await authenticatedFetch('/api/settings/database-api-access', { forceCloud: true });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to load database API settings');
      }
      setBaseUrl(data.baseUrl || DEFAULT_DATABASE_API_BASE_URL);
      setSavedBaseUrl(data.baseUrl || DEFAULT_DATABASE_API_BASE_URL);
      setTokenConfigured(Boolean(data.tokenConfigured));
      setConnection(data.connection || {
        connected: false,
        status: data.tokenConfigured ? 'unverified' : 'not_configured',
      });
    } catch (error) {
      setStatus({
        success: false,
        message: resolveStatusMessage(t, error.message, 'databaseApiAccess.status.loadFailed'),
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSettings();
  }, []);

  const handleTest = async () => {
    const nextBaseUrl = normalizeBaseUrl(baseUrl) || DEFAULT_DATABASE_API_BASE_URL;
    const nextToken = token.trim();
    if (!tokenConfigured && !nextToken) {
      setStatus({ success: false, message: t('databaseApiAccess.status.tokenRequired') });
      return;
    }

    try {
      new URL(nextBaseUrl);
    } catch {
      setStatus({ success: false, message: t('databaseApiAccess.status.invalidBaseUrl') });
      return;
    }

    try {
      setTesting(true);
      setStatus(null);
      const payload = { baseUrl: nextBaseUrl };
      if (nextToken) {
        payload.token = nextToken;
      }
      const response = await authenticatedFetch('/api/settings/database-api-access/test', {
        method: 'POST',
        forceCloud: true,
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to test database API connection');
      }
      if (data?.persisted && data?.connection) {
        setConnection(data.connection);
        onStatusChange?.();
      }
      const successMessageKey = data?.persisted
        ? 'databaseApiAccess.status.testSucceededSaved'
        : 'databaseApiAccess.status.testSucceeded';
      setStatus({
        success: Boolean(data?.success),
        message: data?.success
          ? t(successMessageKey, {
            count: data.connection?.accessibleSourceCount ?? 0,
          })
          : resolveConnectionMessage(t, data?.connection),
      });
    } catch (error) {
      setStatus({
        success: false,
        message: resolveStatusMessage(t, error.message, 'databaseApiAccess.status.testFailed'),
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    const nextBaseUrl = normalizeBaseUrl(baseUrl) || DEFAULT_DATABASE_API_BASE_URL;
    const nextToken = token.trim();

    if (!tokenConfigured && !nextToken) {
      setStatus({ success: false, message: t('databaseApiAccess.status.tokenRequired') });
      return;
    }

    try {
      new URL(nextBaseUrl);
    } catch {
      setStatus({ success: false, message: t('databaseApiAccess.status.invalidBaseUrl') });
      return;
    }

    try {
      setSaving(true);
      setStatus(null);
      const payload = { baseUrl: nextBaseUrl };
      if (nextToken) {
        payload.token = nextToken;
      }
      const response = await authenticatedFetch('/api/settings/database-api-access', {
        method: 'PUT',
        forceCloud: true,
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok || !data?.success) {
        if (data?.persisted && data?.connection) {
          setConnection(data.connection);
          onStatusChange?.();
        }
        throw new Error(data?.error || 'Failed to save database API settings');
      }
      setBaseUrl(data.baseUrl || nextBaseUrl);
      setSavedBaseUrl(data.baseUrl || nextBaseUrl);
      setToken('');
      setTokenConfigured(Boolean(data.tokenConfigured));
      setConnection(data.connection || { connected: true, status: 'connected' });
      setStatus({ success: true, message: t('databaseApiAccess.status.saved') });
      onStatusChange?.();
    } catch (error) {
      setStatus({
        success: false,
        message: resolveStatusMessage(t, error.message, 'databaseApiAccess.status.saveFailed'),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    try {
      setClearing(true);
      setStatus(null);
      const response = await authenticatedFetch('/api/settings/database-api-access', {
        method: 'DELETE',
        forceCloud: true,
      });
      const data = await response.json();
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || 'Failed to clear database API settings');
      }
      setBaseUrl(data.baseUrl || DEFAULT_DATABASE_API_BASE_URL);
      setSavedBaseUrl(data.baseUrl || DEFAULT_DATABASE_API_BASE_URL);
      setToken('');
      setTokenConfigured(false);
      setConnection(data.connection || { connected: false, status: 'not_configured' });
      setStatus({ success: true, message: t('databaseApiAccess.status.cleared') });
      onStatusChange?.();
    } catch (error) {
      setStatus({
        success: false,
        message: resolveStatusMessage(t, error.message, 'databaseApiAccess.status.clearFailed'),
      });
    } finally {
      setClearing(false);
    }
  };

  const copyCurl = async () => {
    await navigator.clipboard.writeText(curlExample);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const connectionDetail = resolveConnectionMessage(t, connection);

  if (loading) {
    return <div className="text-sm text-muted-foreground">{t('databaseApiAccess.status.loading')}</div>;
  }

  return (
    <div className="space-y-4">
      {!embedded && (
        <div>
          <h3 className="text-lg font-medium text-foreground">{t('databaseApiAccess.title')}</h3>
          <p className="text-sm text-muted-foreground">{t('databaseApiAccess.description')}</p>
        </div>
      )}

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Database className="h-4 w-4 shrink-0 text-gray-500" />
            <div className="min-w-0">
              <div className="font-medium text-foreground">{t('databaseApiAccess.connection.title')}</div>
              <div className={`text-xs ${connection.connected ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'}`}>
                {connectionDetail}
              </div>
            </div>
          </div>
          {tokenConfigured && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleClear}
              disabled={clearing || saving || testing}
              className="shrink-0 text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="mr-1 h-4 w-4" />
              {clearing ? t('databaseApiAccess.actions.clearing') : t('databaseApiAccess.actions.clear')}
            </Button>
          )}
        </div>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm text-muted-foreground" htmlFor="database-api-base-url">
              {t('databaseApiAccess.baseUrl.label')}
            </label>
            <Input
              id="database-api-base-url"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder={DEFAULT_DATABASE_API_BASE_URL}
              autoComplete="off"
            />
            <div className="mt-1 text-xs text-muted-foreground">{t('databaseApiAccess.baseUrl.help')}</div>
          </div>

          <div>
            <label className="mb-1 block text-sm text-muted-foreground" htmlFor="database-api-token">
              {t('databaseApiAccess.token.label')}
            </label>
            <div className="relative">
              <Input
                id="database-api-token"
                type={showToken ? 'text' : 'password'}
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder={tokenConfigured
                  ? t('databaseApiAccess.token.placeholderConfigured')
                  : t('databaseApiAccess.token.placeholder')}
                autoComplete="off"
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowToken((value) => !value)}
                className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground"
                aria-label={showToken ? t('databaseApiAccess.token.hide') : t('databaseApiAccess.token.show')}
              >
                {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{t('databaseApiAccess.token.help')}</div>
          </div>

          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-sm font-medium text-foreground">{t('databaseApiAccess.curl.title')}</div>
              <Button type="button" variant="outline" size="sm" onClick={copyCurl}>
                {copied ? <Check className="mr-1 h-4 w-4" /> : <Copy className="mr-1 h-4 w-4" />}
                {copied ? t('databaseApiAccess.actions.copied') : t('databaseApiAccess.actions.copyCurl')}
              </Button>
            </div>
            <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-background p-3 text-xs text-foreground">
              {curlExample}
            </pre>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              onClick={handleTest}
              disabled={testing || saving || clearing || (!token.trim() && !tokenConfigured)}
              size="sm"
              variant="outline"
            >
              {testing ? t('databaseApiAccess.actions.testing') : t('databaseApiAccess.actions.test')}
            </Button>
            <Button
              type="button"
              onClick={handleSave}
              disabled={saving || testing || clearing || (
                connection.connected
                && !token.trim()
                && tokenConfigured
                && normalizedBaseUrl === normalizeBaseUrl(savedBaseUrl)
              )}
              size="sm"
              variant="outline"
            >
              {saving ? t('databaseApiAccess.actions.saving') : t('databaseApiAccess.actions.save')}
            </Button>
            {status && (
              <div className={`text-sm ${status.success ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                {status.message}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
