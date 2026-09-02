import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Mail, Plug } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { authenticatedFetch, api } from '../../utils/api';
import EmailSettingsContent from './EmailSettingsContent';

function ConnectorTile({ icon: Icon, title, description, configured, onClick }) {
  const { t } = useTranslation('settings');

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[132px] flex-col items-start gap-3 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-blue-300 hover:bg-blue-50/50 dark:hover:border-blue-900/70 dark:hover:bg-blue-950/20"
    >
      <div className="flex w-full items-start justify-between gap-3">
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-2 text-blue-600 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-300">
          <Icon className="h-4 w-4" />
        </div>
        {configured ? (
          <Badge variant="secondary" className="border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300">
            {t('connectors.status.configured')}
          </Badge>
        ) : (
          <Badge variant="secondary" className="bg-muted text-muted-foreground">
            {t('connectors.status.notConfigured')}
          </Badge>
        )}
      </div>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-foreground">{title}</div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
      </div>
    </button>
  );
}

export default function ConnectorsContent() {
  const { t } = useTranslation('settings');
  const [activeConnector, setActiveConnector] = useState(null);
  const [status, setStatus] = useState({
    emailConfigured: false,
    loading: true,
  });

  const loadStatus = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setStatus((prev) => ({ ...prev, loading: true }));
    }
    try {
      const [profileRes, senderRes] = await Promise.all([
        authenticatedFetch('/api/user/profile'),
        api.settings.autoResearchEmail(),
      ]);

      const profileData = await profileRes.json();
      const senderData = await senderRes.json();

      const notificationEmail = profileRes.ok ? String(profileData?.profile?.notificationEmail || '').trim() : '';
      const senderEmail = senderRes.ok ? String(senderData?.senderEmail || '').trim() : '';

      setStatus({
        emailConfigured: Boolean(notificationEmail || senderEmail),
        loading: false,
      });
    } catch {
      setStatus((prev) => ({ ...prev, loading: false }));
    }
  }, []);

  useEffect(() => {
    void loadStatus();

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') {
        void loadStatus({ silent: true });
      }
    };
    const intervalId = window.setInterval(refreshWhenVisible, 15_000);
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [loadStatus]);

  const connectors = [
    {
      id: 'email',
      icon: Mail,
      title: t('connectors.email.title'),
      description: t('connectors.email.description'),
      configured: status.emailConfigured,
    },
  ];

  const activeMeta = connectors.find((connector) => connector.id === activeConnector);

  if (activeConnector && activeMeta) {
    const ActiveIcon = activeMeta.icon;

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setActiveConnector(null);
              void loadStatus();
            }}
            className="shrink-0 px-2"
          >
            <ArrowLeft className="mr-1 h-4 w-4" />
            {t('connectors.actions.back')}
          </Button>
          <div className="flex min-w-0 items-center gap-2">
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-2 text-blue-600 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-300">
              <ActiveIcon className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h3 className="truncate text-lg font-medium text-foreground">{activeMeta.title}</h3>
              <p className="truncate text-sm text-muted-foreground">{activeMeta.description}</p>
            </div>
          </div>
        </div>

        {activeConnector === 'email' && <EmailSettingsContent embedded />}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-2 text-blue-600 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-300">
          <Plug className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-foreground">{t('connectors.title')}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{t('connectors.description')}</p>
        </div>
      </div>

      {status.loading ? (
        <div className="text-sm text-muted-foreground">{t('connectors.status.loading')}</div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {connectors.map((connector) => (
            <ConnectorTile
              key={connector.id}
              icon={connector.icon}
              title={connector.title}
              description={connector.description}
              configured={connector.configured}
              onClick={() => setActiveConnector(connector.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
