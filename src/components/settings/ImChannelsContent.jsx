import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  KeyRound,
  Loader2,
  MessageSquare,
  QrCode,
  Radio,
  XCircle,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import { api } from '../../utils/api';

const EMPTY_STATUS = {
  defaultAgent: 'pi',
  feishu: {
    enabled: false,
    appId: '',
    hasSecret: false,
    connectionMode: 'stream',
    domainName: 'feishu',
    runtime: { running: false, lastError: null, lastStartedAt: null },
  },
  dingtalk: { enabled: false, appId: '', hasSecret: false, runtime: { running: false, lastError: null, lastStartedAt: null } },
  wecom: { enabled: false, botId: '', hasSecret: false, runtime: { running: false, lastError: null, lastStartedAt: null } },
  qq: { enabled: false, appId: '', hasSecret: false, runtime: { running: false, lastError: null, lastStartedAt: null } },
  weixin: {
    enabled: false,
    hasCredentials: false,
    accountId: '',
    baseUrl: '',
    runtime: {
      running: false,
      lastError: null,
      lastStartedAt: null,
    },
  },
};

const qrImageSrc = (value) =>
  `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(value)}`;

function clearPoll(ref) {
  if (ref.current) {
    window.clearInterval(ref.current);
    ref.current = null;
  }
}

function StatusBadge({ enabled }) {
  const { t } = useTranslation('settings');
  return enabled ? (
    <Badge variant="secondary" className="border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300">
      {t('imChannels.enabled')}
    </Badge>
  ) : (
    <Badge variant="secondary" className="bg-muted text-muted-foreground">
      {t('imChannels.notConfigured')}
    </Badge>
  );
}

function ResultNotice({ result }) {
  if (!result) return null;
  const ok = result.ok;
  const Icon = ok ? CheckCircle2 : XCircle;
  return (
    <div
      className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
        ok
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300'
          : 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300'
      }`}
    >
      <Icon className="mt-0.5 h-4 w-4 flex-shrink-0" />
      <span>{ok ? result.message : result.error}</span>
    </div>
  );
}

function ChannelCard({ title, description, enabled, children }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900/40 md:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-2 text-blue-600 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-300">
            <MessageSquare className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h4 className="text-base font-semibold text-foreground">{title}</h4>
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          </div>
        </div>
        <StatusBadge enabled={enabled} />
      </div>
      <div className="mt-5 border-t border-border/70 pt-5">
        {children}
      </div>
    </section>
  );
}

function SetupChoice({ icon: Icon, title, description, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[118px] flex-col items-center justify-center gap-2 rounded-lg border border-border bg-background p-4 text-center transition-colors hover:border-blue-300 hover:bg-blue-50/60 dark:hover:border-blue-900/70 dark:hover:bg-blue-950/20"
    >
      <Icon className="h-6 w-6 text-muted-foreground" />
      <span className="text-sm font-medium text-foreground">{title}</span>
      <span className="text-xs leading-5 text-muted-foreground">{description}</span>
    </button>
  );
}

const CHANNEL_TILE_STYLE = {
  feishu: { glyph: '飞', color: 'bg-sky-500 text-white' },
  dingtalk: { glyph: '钉', color: 'bg-blue-600 text-white' },
  wecom: { glyph: '企', color: 'bg-emerald-600 text-white' },
  qq: { glyph: 'Q', color: 'bg-indigo-600 text-white' },
  weixin: { glyph: '微', color: 'bg-green-600 text-white' },
};

function ChannelTile({ platform, title, hint, enabled, running, selected, onClick }) {
  const style = CHANNEL_TILE_STYLE[platform] || { glyph: '聊', color: 'bg-blue-600 text-white' };
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative flex aspect-square min-h-[132px] flex-col items-center justify-center gap-2 rounded-xl border p-4 text-center transition-all ${
        selected
          ? 'border-blue-500 bg-blue-50 shadow-sm ring-2 ring-blue-500/15 dark:bg-blue-950/25'
          : 'border-border bg-background hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-sm dark:hover:border-blue-900'
      }`}
    >
      <span className={`grid h-11 w-11 place-items-center rounded-xl text-base font-bold shadow-sm ${style.color}`}>
        {style.glyph}
      </span>
      <span className="text-sm font-semibold text-foreground">{title}</span>
      <span className="line-clamp-2 text-[11px] leading-4 text-muted-foreground">{hint}</span>
      <span
        className={`absolute right-3 top-3 h-2.5 w-2.5 rounded-full ${
          enabled && running
            ? 'bg-emerald-500'
            : enabled
              ? 'bg-amber-500'
              : 'bg-gray-300 dark:bg-gray-700'
        }`}
      />
    </button>
  );
}

function PiAgentBinding() {
  const { t } = useTranslation('settings');

  return (
    <section className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900/40 md:p-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <h4 className="text-base font-semibold text-foreground">{t('imChannels.defaultAgent.title')}</h4>
          <p className="mt-1 text-sm text-muted-foreground">{t('imChannels.defaultAgent.description')}</p>
        </div>
        <div className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 text-sm font-semibold text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300 md:w-auto">
          <Radio className="h-4 w-4" />
          {t('imChannels.defaultAgent.pi')}
        </div>
      </div>
    </section>
  );
}

function CommandHelp() {
  const { t } = useTranslation('settings');
  const commands = t('imChannels.commandHelp.items', { returnObjects: true });
  return (
    <section className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900/40 md:p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <h4 className="text-base font-semibold text-foreground">{t('imChannels.commandHelp.title')}</h4>
          <p className="mt-1 text-sm text-muted-foreground">{t('imChannels.commandHelp.description')}</p>
        </div>
        <Badge variant="secondary" className="w-fit bg-muted text-muted-foreground">
          {t('imChannels.commandHelp.badge')}
        </Badge>
      </div>
      <div className="mt-4 grid gap-2 md:grid-cols-2">
        {Array.isArray(commands) && commands.map((item) => (
          <div key={item.command} className="rounded-lg border border-border bg-background px-3 py-2">
            <div className="font-mono text-sm text-foreground">{item.command}</div>
            <div className="mt-1 text-xs leading-5 text-muted-foreground">{item.description}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function FeishuSection({ status, onStatusUpdate }) {
  const { t } = useTranslation('settings');
  const [expanded, setExpanded] = useState(!status.enabled);
  const [setupMode, setSetupMode] = useState('choose');
  const [appId, setAppId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [domainName, setDomainName] = useState(status.domainName || 'feishu');
  const [connectionMode, setConnectionMode] = useState(status.connectionMode || 'stream');
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);
  const [qrPhase, setQrPhase] = useState('idle');
  const [qrUrl, setQrUrl] = useState('');
  const [qrError, setQrError] = useState('');
  const qrPollRef = useRef(null);

  useEffect(() => {
    setDomainName(status.domainName || 'feishu');
    setConnectionMode(status.connectionMode || 'stream');
  }, [status.connectionMode, status.domainName]);

  useEffect(() => () => clearPoll(qrPollRef), []);

  const refresh = async () => {
    const response = await api.settings.imChannelsStatus();
    if (response.ok) {
      onStatusUpdate(await response.json());
    }
  };

  const resetQr = async () => {
    clearPoll(qrPollRef);
    await api.settings.cancelFeishuImQr().catch(() => null);
    setQrPhase('idle');
    setQrUrl('');
    setQrError('');
  };

  const closeEditor = async () => {
    await resetQr();
    setSetupMode('choose');
    setExpanded(false);
    setResult(null);
  };

  const startQr = async () => {
    setQrPhase('connecting');
    setQrError('');
    setQrUrl('');
    try {
      const response = await api.settings.beginFeishuImQr({ domainName });
      const data = await response.json();
      if (!data.ok) {
        setQrPhase('error');
        setQrError(data.error || t('imChannels.messages.qrFailed'));
        return;
      }

      setQrUrl(data.qrUrl);
      setQrPhase('scanning');
      qrPollRef.current = window.setInterval(async () => {
        try {
          const pollResponse = await api.settings.pollFeishuImQr();
          const pollData = await pollResponse.json();
          if (pollData.pending) return;

          clearPoll(qrPollRef);
          if (pollData.ok) {
            setQrPhase('success');
            await refresh();
          } else {
            setQrPhase('error');
            setQrError(pollData.error || t('imChannels.messages.qrFailed'));
          }
        } catch {
          // Keep polling through transient backend/network hiccups.
        }
      }, 3000);
    } catch (error) {
      setQrPhase('error');
      setQrError(error.message || t('imChannels.messages.qrFailed'));
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setResult(null);
    try {
      const response = await api.settings.testFeishuImChannel({ appId, appSecret, domainName });
      const data = await response.json();
      setResult({
        ok: data.ok,
        message: data.message || t('imChannels.messages.testPassed'),
        error: data.error || t('imChannels.messages.testFailed'),
      });
    } catch (error) {
      setResult({ ok: false, error: error.message || t('imChannels.messages.testFailed') });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setResult(null);
    try {
      const response = await api.settings.saveFeishuImChannel({
        appId,
        appSecret,
        domainName,
        connectionMode,
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        if (data.status) onStatusUpdate(data.status);
        setResult({ ok: false, error: data.error || t('imChannels.messages.saveFailed') });
        return;
      }

      onStatusUpdate(data.status);
      setExpanded(false);
      setSetupMode('choose');
      setResult({ ok: true, message: t('imChannels.messages.saved') });
      setAppSecret('');
    } catch (error) {
      setResult({ ok: false, error: error.message || t('imChannels.messages.saveFailed') });
    } finally {
      setSaving(false);
    }
  };

  const handleDisable = async () => {
    setSaving(true);
    setResult(null);
    try {
      const response = await api.settings.disableFeishuImChannel();
      const data = await response.json();
      if (data.status) {
        onStatusUpdate(data.status);
      } else {
        await refresh();
      }
      setExpanded(false);
      setResult({ ok: true, message: t('imChannels.messages.disabled') });
    } catch (error) {
      setResult({ ok: false, error: error.message || t('imChannels.messages.disableFailed') });
    } finally {
      setSaving(false);
    }
  };

  return (
    <ChannelCard
      title={t('imChannels.feishu.title')}
      description={t('imChannels.feishu.description')}
      enabled={status.enabled}
    >
      <div className="space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0 space-y-1 text-sm text-muted-foreground">
            <div>
              {status.enabled
                ? t('imChannels.feishu.connectedAs', { appId: status.appId || t('imChannels.unknown') })
                : t('imChannels.notConfiguredDetail')}
            </div>
            {status.enabled && (
              <div className={status.runtime?.running ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>
                {status.runtime?.running
                  ? t('imChannels.runtime.running')
                  : t('imChannels.runtime.stopped')}
              </div>
            )}
            {status.runtime?.lastError && (
              <div className="text-red-600 dark:text-red-400">
                {t('imChannels.runtime.error', { error: status.runtime.lastError })}
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {!expanded && (
              <Button variant="outline" size="sm" onClick={() => setExpanded(true)}>
                <KeyRound className="h-4 w-4" />
                {status.enabled ? t('imChannels.actions.edit') : t('imChannels.actions.setup')}
              </Button>
            )}
            {status.enabled && (
              <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-700" onClick={handleDisable} disabled={saving}>
                {t('imChannels.actions.disable')}
              </Button>
            )}
          </div>
        </div>

        {!expanded && <ResultNotice result={result} />}

        {expanded && setupMode === 'choose' && (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <SetupChoice
                icon={QrCode}
                title={t('imChannels.feishu.qrScan')}
                description={t('imChannels.feishu.qrScanDesc')}
                onClick={() => setSetupMode('qr')}
              />
              <SetupChoice
                icon={KeyRound}
                title={t('imChannels.feishu.manualInput')}
                description={t('imChannels.feishu.manualInputDesc')}
                onClick={() => setSetupMode('manual')}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {status.enabled && (
                <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-700" onClick={handleDisable} disabled={saving}>
                  {t('imChannels.actions.disable')}
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={closeEditor}>
                {t('actions.cancelChanges')}
              </Button>
            </div>
          </div>
        )}

        {expanded && setupMode === 'qr' && (
          <div className="space-y-4 rounded-lg border border-border bg-background p-4">
            {qrPhase === 'idle' && (
              <div className="space-y-4">
                <label className="block space-y-1">
                  <span className="text-sm font-medium text-foreground">{t('imChannels.feishu.domain')}</span>
                  <select
                    value={domainName}
                    onChange={(event) => setDomainName(event.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  >
                    <option value="feishu">feishu.cn</option>
                  </select>
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={startQr}>
                    <QrCode className="h-4 w-4" />
                    {t('imChannels.feishu.startQr')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setSetupMode('choose')}>
                    {t('actions.cancelChanges')}
                  </Button>
                </div>
              </div>
            )}

            {qrPhase === 'connecting' && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('imChannels.messages.connecting')}
              </div>
            )}

            {qrPhase === 'scanning' && qrUrl && (
              <div className="space-y-3">
                <div className="flex justify-center rounded-lg border border-border bg-white p-4">
                  <img src={qrImageSrc(qrUrl)} alt={t('imChannels.feishu.qrAlt')} className="h-[200px] w-[200px]" />
                </div>
                <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('imChannels.feishu.scanPrompt')}
                </div>
                <div className="flex justify-center">
                  <Button variant="ghost" size="sm" onClick={resetQr}>
                    {t('actions.cancelChanges')}
                  </Button>
                </div>
              </div>
            )}

            {qrPhase === 'success' && (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300">
                <CheckCircle2 className="h-4 w-4" />
                {t('imChannels.feishu.qrSuccess')}
                <Button variant="ghost" size="sm" className="ml-auto" onClick={closeEditor}>
                  {t('imChannels.actions.dismiss')}
                </Button>
              </div>
            )}

            {qrPhase === 'error' && (
              <div className="space-y-3">
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
                  <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  <span>{qrError}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => setQrPhase('idle')}>
                    {t('imChannels.actions.retry')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setSetupMode('choose')}>
                    {t('actions.cancelChanges')}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {expanded && setupMode === 'manual' && (
          <div className="space-y-4 rounded-lg border border-border bg-background p-4">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-1">
                <span className="text-sm font-medium text-foreground">{t('imChannels.feishu.domain')}</span>
                <select
                  value={domainName}
                  onChange={(event) => setDomainName(event.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                >
                  <option value="feishu">feishu.cn</option>
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-sm font-medium text-foreground">{t('imChannels.feishu.connectionMode')}</span>
                <select
                  value={connectionMode}
                  onChange={(event) => setConnectionMode(event.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                >
                  <option value="stream">WebSocket 长连接</option>
                </select>
              </label>
            </div>
            <label className="block space-y-1">
              <span className="text-sm font-medium text-foreground">App ID</span>
              <Input value={appId} onChange={(event) => setAppId(event.target.value.trim())} placeholder="cli_xxxxxxxxxxxx" className="font-mono" />
            </label>
            <label className="block space-y-1">
              <span className="text-sm font-medium text-foreground">App Secret</span>
              <Input type="password" value={appSecret} onChange={(event) => setAppSecret(event.target.value.trim())} placeholder="********" className="font-mono" />
            </label>
            <ResultNotice result={result} />
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={handleTest} disabled={!appId || !appSecret || testing}>
                {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radio className="h-4 w-4" />}
                {t('imChannels.actions.testConnection')}
              </Button>
              <Button size="sm" onClick={handleSave} disabled={!appId || !appSecret || saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {t('imChannels.actions.save')}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSetupMode('choose')}>
                {t('actions.cancelChanges')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </ChannelCard>
  );
}

function DomesticCredentialSection({ platform, status, onStatusUpdate }) {
  const { t } = useTranslation('settings');
  const isWecom = platform === 'wecom';
  const idKey = isWecom ? 'botId' : 'appId';
  const secretKey = isWecom ? 'secret' : 'appSecret';
  const [expanded, setExpanded] = useState(!status.enabled);
  const [identifier, setIdentifier] = useState('');
  const [secret, setSecret] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState(null);
  const labelPrefix = `imChannels.${platform}`;

  const payload = { [idKey]: identifier, [secretKey]: secret };

  const handleTest = async () => {
    setTesting(true);
    setResult(null);
    try {
      const response = await api.settings.testDomesticImChannel(platform, payload);
      const data = await response.json();
      setResult({
        ok: Boolean(data.ok),
        message: data.message || t('imChannels.messages.testPassed'),
        error: data.error || t('imChannels.messages.testFailed'),
      });
    } catch (error) {
      setResult({ ok: false, error: error.message || t('imChannels.messages.testFailed') });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setResult(null);
    try {
      const response = await api.settings.saveDomesticImChannel(platform, payload);
      const data = await response.json();
      if (!response.ok || !data.ok) {
        if (data.status) onStatusUpdate(data.status);
        setResult({ ok: false, error: data.error || t('imChannels.messages.saveFailed') });
        return;
      }
      onStatusUpdate(data.status);
      setExpanded(false);
      setSecret('');
      setResult({ ok: true, message: t('imChannels.messages.saved') });
    } catch (error) {
      setResult({ ok: false, error: error.message || t('imChannels.messages.saveFailed') });
    } finally {
      setSaving(false);
    }
  };

  const handleDisable = async () => {
    setSaving(true);
    setResult(null);
    try {
      const response = await api.settings.disableDomesticImChannel(platform);
      const data = await response.json();
      if (!response.ok || !data.ok) {
        setResult({ ok: false, error: data.error || t('imChannels.messages.disableFailed') });
        return;
      }
      onStatusUpdate(data.status);
      setExpanded(false);
      setResult({ ok: true, message: t('imChannels.messages.disabled') });
    } catch (error) {
      setResult({ ok: false, error: error.message || t('imChannels.messages.disableFailed') });
    } finally {
      setSaving(false);
    }
  };

  return (
    <ChannelCard
      title={t(`${labelPrefix}.title`)}
      description={t(`${labelPrefix}.description`)}
      enabled={status.enabled}
    >
      <div className="space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0 space-y-1 text-sm text-muted-foreground">
            <div>
              {status.enabled
                ? t(`${labelPrefix}.connectedAs`, { id: status[idKey] || t('imChannels.unknown') })
                : t('imChannels.notConfiguredDetail')}
            </div>
            {status.enabled && (
              <div className={status.runtime?.running ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>
                {status.runtime?.running
                  ? t('imChannels.runtime.running')
                  : t('imChannels.runtime.stopped')}
              </div>
            )}
            {status.runtime?.lastError && (
              <div className="text-red-600 dark:text-red-400">
                {t('imChannels.runtime.error', { error: status.runtime.lastError })}
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setExpanded((value) => !value)}>
              <KeyRound className="h-4 w-4" />
              {status.enabled ? t('imChannels.actions.edit') : t('imChannels.actions.setup')}
            </Button>
            {status.enabled && (
              <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-700" onClick={handleDisable} disabled={saving}>
                {t('imChannels.actions.disable')}
              </Button>
            )}
          </div>
        </div>

        {!expanded && <ResultNotice result={result} />}
        {expanded && (
          <div className="space-y-4 rounded-lg border border-border bg-background p-4">
            <label className="block space-y-1">
              <span className="text-sm font-medium text-foreground">{t(`${labelPrefix}.idLabel`)}</span>
              <Input value={identifier} onChange={(event) => setIdentifier(event.target.value.trim())} className="font-mono" />
            </label>
            <label className="block space-y-1">
              <span className="text-sm font-medium text-foreground">{t(`${labelPrefix}.secretLabel`)}</span>
              <Input type="password" value={secret} onChange={(event) => setSecret(event.target.value.trim())} className="font-mono" />
            </label>
            <ResultNotice result={result} />
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={handleTest} disabled={!identifier || !secret || testing || saving}>
                {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radio className="h-4 w-4" />}
                {t('imChannels.actions.testConnection')}
              </Button>
              <Button size="sm" onClick={handleSave} disabled={!identifier || !secret || testing || saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {t('imChannels.actions.save')}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setExpanded(false)}>
                {t('actions.cancelChanges')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </ChannelCard>
  );
}

function WeixinSection({ status, onStatusUpdate }) {
  const { t } = useTranslation('settings');
  const [expanded, setExpanded] = useState(!status.enabled);
  const [setupMode, setSetupMode] = useState('choose');
  const [phase, setPhase] = useState('idle');
  const [qrUrl, setQrUrl] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [botToken, setBotToken] = useState('');
  const [accountId, setAccountId] = useState('');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);
  const pollRef = useRef(null);

  useEffect(() => () => clearPoll(pollRef), []);

  const refresh = async () => {
    const response = await api.settings.imChannelsStatus();
    if (response.ok) {
      onStatusUpdate(await response.json());
    }
  };

  const startQrLogin = async () => {
    setPhase('loading');
    setResult(null);
    setQrUrl('');
    try {
      const response = await api.settings.beginWeixinImQr();
      const data = await response.json();
      if (!data.ok) {
        setPhase('error');
        setResult({ ok: false, error: data.error || t('imChannels.messages.qrFailed') });
        return;
      }

      setQrUrl(data.qrUrl);
      setPhase('scanning');
      pollRef.current = window.setInterval(async () => {
        try {
          const pollResponse = await api.settings.pollWeixinImQr();
          const pollData = await pollResponse.json();
          if (pollData.pending) return;

          clearPoll(pollRef);
          if (pollData.ok) {
            setPhase('success');
            setResult({ ok: true, message: t('imChannels.weixin.loginSuccess') });
            await refresh();
          } else {
            setPhase('error');
            setResult({ ok: false, error: pollData.error || t('imChannels.messages.qrFailed') });
          }
        } catch {
          // Keep polling through transient backend/network hiccups.
        }
      }, 2000);
    } catch (error) {
      setPhase('error');
      setResult({ ok: false, error: error.message || t('imChannels.messages.qrFailed') });
    }
  };

  const stopQr = () => {
    clearPoll(pollRef);
    setPhase('idle');
    setQrUrl('');
  };

  const handleSave = async () => {
    setSaving(true);
    setResult(null);
    try {
      const response = await api.settings.saveWeixinImChannel({ baseUrl, botToken, accountId });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        setResult({ ok: false, error: data.error || t('imChannels.messages.saveFailed') });
        return;
      }

      onStatusUpdate(data.status);
      setExpanded(false);
      setSetupMode('choose');
      setResult({ ok: true, message: t('imChannels.messages.saved') });
      setBotToken('');
    } catch (error) {
      setResult({ ok: false, error: error.message || t('imChannels.messages.saveFailed') });
    } finally {
      setSaving(false);
    }
  };

  const handleDisable = async () => {
    setSaving(true);
    setResult(null);
    try {
      const response = await api.settings.disableWeixinImChannel();
      const data = await response.json();
      if (data.status) {
        onStatusUpdate(data.status);
      } else {
        await refresh();
      }
      setExpanded(false);
      setResult({ ok: true, message: t('imChannels.messages.disabled') });
    } catch (error) {
      setResult({ ok: false, error: error.message || t('imChannels.messages.disableFailed') });
    } finally {
      setSaving(false);
    }
  };

  return (
    <ChannelCard
      title={t('imChannels.weixin.title')}
      description={t('imChannels.weixin.description')}
      enabled={status.enabled}
    >
      <div className="space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0 space-y-1 text-sm text-muted-foreground">
            <div>
              {status.enabled
                ? t('imChannels.weixin.connectedAs', { accountId: status.accountId || t('imChannels.unknown') })
                : t('imChannels.notConfiguredDetail')}
            </div>
            {status.enabled && (
              <div className={status.runtime?.running ? 'text-xs text-emerald-700 dark:text-emerald-300' : 'text-xs text-amber-700 dark:text-amber-300'}>
                {status.runtime?.running
                  ? t('imChannels.weixin.runtimeRunning')
                  : t('imChannels.weixin.runtimeStopped')}
              </div>
            )}
            {status.enabled && status.runtime?.lastError && (
              <div className="text-xs text-red-600 dark:text-red-300">
                {t('imChannels.weixin.runtimeError', { error: status.runtime.lastError })}
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {!expanded && (
              <Button variant="outline" size="sm" onClick={() => setExpanded(true)}>
                <QrCode className="h-4 w-4" />
                {status.enabled ? t('imChannels.actions.edit') : t('imChannels.actions.setup')}
              </Button>
            )}
            {status.enabled && (
              <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-700" onClick={handleDisable} disabled={saving}>
                {t('imChannels.actions.disable')}
              </Button>
            )}
          </div>
        </div>

        {!expanded && <ResultNotice result={result} />}

        {expanded && setupMode === 'choose' && (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <SetupChoice
                icon={QrCode}
                title={t('imChannels.weixin.qrLogin')}
                description={t('imChannels.weixin.qrLoginDesc')}
                onClick={() => setSetupMode('qr')}
              />
              <SetupChoice
                icon={KeyRound}
                title={t('imChannels.weixin.manualInput')}
                description={t('imChannels.weixin.manualInputDesc')}
                onClick={() => setSetupMode('manual')}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {status.enabled && (
                <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-700" onClick={handleDisable} disabled={saving}>
                  {t('imChannels.actions.disable')}
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => setExpanded(false)}>
                {t('actions.cancelChanges')}
              </Button>
            </div>
          </div>
        )}

        {expanded && setupMode === 'qr' && (
          <div className="space-y-4 rounded-lg border border-border bg-background p-4">
            {phase === 'idle' && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={startQrLogin}>
                  <QrCode className="h-4 w-4" />
                  {status.enabled ? t('imChannels.weixin.relogin') : t('imChannels.weixin.qrLogin')}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setSetupMode('choose')}>
                  {t('actions.cancelChanges')}
                </Button>
              </div>
            )}

            {phase === 'loading' && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('imChannels.weixin.loadingQr')}
              </div>
            )}

            {phase === 'scanning' && qrUrl && (
              <div className="space-y-3">
                <div className="flex justify-center rounded-lg border border-border bg-white p-4">
                  <img src={qrImageSrc(qrUrl)} alt={t('imChannels.weixin.qrAlt')} className="h-[200px] w-[200px]" />
                </div>
                <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('imChannels.weixin.scanPrompt')}
                </div>
                <div className="flex justify-center">
                  <Button variant="ghost" size="sm" onClick={stopQr}>
                    {t('actions.cancelChanges')}
                  </Button>
                </div>
              </div>
            )}

            {(phase === 'success' || phase === 'error') && (
              <div className="space-y-3">
                <ResultNotice result={result} />
                <div className="flex flex-wrap gap-2">
                  {phase === 'error' && (
                    <Button variant="outline" size="sm" onClick={() => setPhase('idle')}>
                      {t('imChannels.actions.retry')}
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => setSetupMode('choose')}>
                    {t('imChannels.actions.dismiss')}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {expanded && setupMode === 'manual' && (
          <div className="space-y-4 rounded-lg border border-border bg-background p-4">
            <label className="block space-y-1">
              <span className="text-sm font-medium text-foreground">{t('imChannels.weixin.baseUrl')}</span>
              <Input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value.trim())} placeholder="https://..." className="font-mono" />
            </label>
            <label className="block space-y-1">
              <span className="text-sm font-medium text-foreground">{t('imChannels.weixin.botToken')}</span>
              <Input type="password" value={botToken} onChange={(event) => setBotToken(event.target.value.trim())} placeholder="********" className="font-mono" />
            </label>
            <label className="block space-y-1">
              <span className="text-sm font-medium text-foreground">{t('imChannels.weixin.accountId')}</span>
              <Input value={accountId} onChange={(event) => setAccountId(event.target.value.trim())} placeholder={t('imChannels.weixin.accountIdPlaceholder')} className="font-mono" />
            </label>
            <ResultNotice result={result} />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={handleSave} disabled={!baseUrl || !botToken || saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {t('imChannels.actions.save')}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSetupMode('choose')}>
                {t('actions.cancelChanges')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </ChannelCard>
  );
}

export default function ImChannelsContent() {
  const { t } = useTranslation('settings');
  const [status, setStatus] = useState(EMPTY_STATUS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedChannel, setSelectedChannel] = useState('feishu');

  const loadStatus = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await api.settings.imChannelsStatus();
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || t('imChannels.messages.loadFailed'));
        return;
      }
      setStatus({
        defaultAgent: 'pi',
        feishu: { ...EMPTY_STATUS.feishu, ...(data.feishu || {}) },
        dingtalk: { ...EMPTY_STATUS.dingtalk, ...(data.dingtalk || {}) },
        wecom: { ...EMPTY_STATUS.wecom, ...(data.wecom || {}) },
        qq: { ...EMPTY_STATUS.qq, ...(data.qq || {}) },
        weixin: { ...EMPTY_STATUS.weixin, ...(data.weixin || {}) },
      });
    } catch (loadError) {
      setError(loadError.message || t('imChannels.messages.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadStatus();
  }, []);

  const handleStatusUpdate = (nextStatus) => {
    setStatus({
      defaultAgent: 'pi',
      feishu: { ...EMPTY_STATUS.feishu, ...(nextStatus?.feishu || {}) },
      dingtalk: { ...EMPTY_STATUS.dingtalk, ...(nextStatus?.dingtalk || {}) },
      wecom: { ...EMPTY_STATUS.wecom, ...(nextStatus?.wecom || {}) },
      qq: { ...EMPTY_STATUS.qq, ...(nextStatus?.qq || {}) },
      weixin: { ...EMPTY_STATUS.weixin, ...(nextStatus?.weixin || {}) },
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 pl-1 md:pl-2">
        <div className="flex items-center gap-3">
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-2 text-blue-600 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-300">
            <MessageSquare className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="whitespace-nowrap text-lg font-semibold leading-tight text-foreground">
              {t('imChannels.title')}
            </h3>
            <p className="max-w-full text-sm text-muted-foreground">
              {t('imChannels.description')}
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center rounded-xl border border-border bg-card py-16 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          {t('imChannels.messages.loading')}
        </div>
      ) : (
        <>
          <PiAgentBinding />
          <section className="rounded-xl border border-border bg-card p-4 md:p-5">
            <div className="mb-4">
              <h4 className="text-base font-semibold text-foreground">{t('imChannels.domestic.title')}</h4>
              <p className="mt-1 text-sm text-muted-foreground">{t('imChannels.domestic.description')}</p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {['feishu', 'dingtalk', 'wecom', 'qq', 'weixin'].map((platform) => (
                <ChannelTile
                  key={platform}
                  platform={platform}
                  title={t(`imChannels.${platform}.title`)}
                  hint={t(`imChannels.${platform}.tileHint`)}
                  enabled={status[platform].enabled}
                  running={status[platform].runtime?.running}
                  selected={selectedChannel === platform}
                  onClick={() => setSelectedChannel(platform)}
                />
              ))}
            </div>
          </section>

          <div key={selectedChannel}>
            {selectedChannel === 'feishu' && (
              <FeishuSection status={status.feishu} onStatusUpdate={handleStatusUpdate} />
            )}
            {['dingtalk', 'wecom', 'qq'].includes(selectedChannel) && (
              <DomesticCredentialSection
                platform={selectedChannel}
                status={status[selectedChannel]}
                onStatusUpdate={handleStatusUpdate}
              />
            )}
            {selectedChannel === 'weixin' && (
              <WeixinSection status={status.weixin} onStatusUpdate={handleStatusUpdate} />
            )}
          </div>
          <CommandHelp />
        </>
      )}
    </div>
  );
}
