import {
  Cookie,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Plus,
  QrCode,
  Settings2,
  Terminal,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { IS_PLATFORM } from '../../../constants/config';
import { api } from '../../../utils/api';
import { Button } from '../../ui/button';
import type { NewsSourceKey, ResearchDomain, SourceInfo } from './useNewsDashboardData';

const ARXIV_CATEGORIES = [
  'cs.AI', 'cs.CL', 'cs.CV', 'cs.IR', 'cs.LG',
  'eess.IV', 'q-bio.GN', 'q-bio.QM',
];

const SOURCE_TITLE_KEYS: Record<NewsSourceKey, string> = {
  pubmed: 'settings.pubmedTitle',
  europepmc: 'settings.europepmcTitle',
  medrxiv: 'settings.medrxivTitle',
  arxiv: 'settings.arxivTitle',
  wechat: 'settings.wechatTitle',
  xiaohongshu: 'settings.xiaohongshuTitle',
};

const MAX_RESULTS_LABEL_KEYS: Partial<Record<NewsSourceKey, string>> = {
  pubmed: 'settings.maxPubmedResults',
  europepmc: 'settings.maxEuropepmcResults',
  medrxiv: 'settings.maxMedrxivResults',
};

type XhsLoginMethod = 'browser' | 'qrcode';

const XHS_COOKIE_SOURCES = [
  { value: 'auto', label: 'Auto' },
  { value: 'chrome', label: 'Chrome' },
  { value: 'chromium', label: 'Chromium' },
  { value: 'edge', label: 'Edge' },
  { value: 'firefox', label: 'Firefox' },
  { value: 'arc', label: 'Arc' },
  { value: 'brave', label: 'Brave' },
  { value: 'vivaldi', label: 'Vivaldi' },
  { value: 'opera', label: 'Opera' },
  { value: 'opera_gx', label: 'Opera GX' },
  { value: 'librewolf', label: 'LibreWolf' },
  { value: 'safari', label: 'Safari' },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyConfig = Record<string, any>;

function TokenInput({
  value,
  onChange,
  onClear,
  placeholder,
  envVarLabel,
  isSaved,
}: {
  value: string | null | undefined;
  onChange: (next: string) => void;
  onClear?: () => void;
  placeholder: string;
  envVarLabel: string;
  isSaved?: boolean;
}) {
  const { t } = useTranslation('news');
  const [reveal, setReveal] = useState(false);

  const displayValue = typeof value === 'string' ? value : '';
  const pendingClear = value === null;
  const showSavedBadge = !!isSaved && !displayValue && !pendingClear;

  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
        <KeyRound className="h-3 w-3" />
        {t('settings.apiToken')}
        <span className="ml-1 rounded bg-muted/60 px-1 py-px font-mono text-[9px] tracking-normal text-muted-foreground">
          {envVarLabel}
        </span>
      </label>
      <div className="relative">
        <input
          type={reveal ? 'text' : 'password'}
          value={displayValue}
          onChange={(e) => onChange(e.target.value)}
          placeholder={showSavedBadge ? t('settings.tokenSavedPlaceholder') : placeholder}
          autoComplete="off"
          spellCheck={false}
          className="w-full rounded-lg border border-border/50 bg-background px-3 py-2 pr-10 text-sm font-mono focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/20"
        />
        <button
          type="button"
          onClick={() => setReveal((value) => !value)}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
          aria-label={reveal ? t('settings.hideToken') : t('settings.revealToken')}
        >
          {reveal ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </button>
      </div>
      {showSavedBadge ? (
        <p className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground/70">
          <span className="inline-flex items-center gap-1 font-medium text-emerald-600 dark:text-emerald-400">
            {t('settings.tokenSavedIndicator')}
          </span>
          {onClear && (
            <button
              type="button"
              onClick={onClear}
              className="rounded text-[10px] font-medium text-muted-foreground underline-offset-2 transition-colors hover:text-destructive hover:underline"
            >
              {t('settings.tokenClearAction')}
            </button>
          )}
        </p>
      ) : pendingClear ? (
        <p className="text-[10px] font-medium text-amber-600 dark:text-amber-400">
          {t('settings.tokenPendingClear')}
        </p>
      ) : (
        <p className="text-[10px] text-muted-foreground/70">{t('settings.tokenHelp')}</p>
      )}
    </div>
  );
}

function shouldPreferXhsQrLogin() {
  if (IS_PLATFORM) return true;
  if (typeof window === 'undefined') return false;

  const hostname = window.location.hostname.toLowerCase();
  const localHostnames = new Set(['localhost', '127.0.0.1', '::1']);
  return !localHostnames.has(hostname);
}

function DomainEditor({
  name,
  domain,
  onUpdate,
  onRemove,
  showCategories,
}: {
  name: string;
  domain: ResearchDomain;
  onUpdate: (name: string, domain: ResearchDomain) => void;
  onRemove: (name: string) => void;
  showCategories?: boolean;
}) {
  const { t } = useTranslation('news');
  const [keywordInput, setKeywordInput] = useState('');
  const [catInput, setCatInput] = useState('');

  const addKeyword = () => {
    const keyword = keywordInput.trim();
    if (keyword && !domain.keywords.includes(keyword)) {
      onUpdate(name, { ...domain, keywords: [...domain.keywords, keyword] });
      setKeywordInput('');
    }
  };

  const removeKeyword = (keyword: string) => {
    onUpdate(name, { ...domain, keywords: domain.keywords.filter((entry) => entry !== keyword) });
  };

  return (
    <div className="rounded-2xl border border-border/50 bg-background/60 p-4 space-y-3 transition-colors hover:border-border/80">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-foreground">{name}</h4>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <label className="text-[10px] font-medium text-muted-foreground">{t('settings.priority')}</label>
            <input
              type="number"
              min={1}
              max={10}
              value={domain.priority}
              onChange={(e) => onUpdate(name, { ...domain, priority: parseInt(e.target.value, 10) || 5 })}
              className="w-12 rounded-lg border border-border/60 bg-background px-2 py-1 text-xs text-center font-medium tabular-nums"
            />
          </div>
          <button onClick={() => onRemove(name)} className="rounded-lg p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div>
        <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">{t('settings.keywords')}</label>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {domain.keywords.map((keyword) => (
            <span key={keyword} className="inline-flex items-center gap-1 rounded-lg border border-primary/30 bg-primary/[0.08] px-2 py-0.5 text-[10px] font-medium text-primary">
              {keyword}
              <button onClick={() => removeKeyword(keyword)} className="text-primary/60 hover:text-destructive transition-colors">&times;</button>
            </span>
          ))}
          <div className="inline-flex items-center gap-1">
            <input
              value={keywordInput}
              onChange={(e) => setKeywordInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addKeyword()}
              placeholder={t('settings.addPlaceholder')}
              className="w-24 rounded-lg border border-dashed border-border/60 bg-transparent px-2 py-0.5 text-[10px] placeholder:text-muted-foreground/40 focus:border-primary/40 focus:outline-none"
            />
            <button onClick={addKeyword} className="rounded p-0.5 text-primary/60 hover:text-primary transition-colors"><Plus className="h-3 w-3" /></button>
          </div>
        </div>
      </div>

      {showCategories && (
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">{t('settings.arxivCategories')}</label>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {domain.arxiv_categories.map((category) => (
              <span key={category} className="inline-flex items-center gap-1 rounded-lg border border-emerald-200/60 bg-emerald-50/80 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-950/30 dark:text-emerald-300">
                {category}
                <button onClick={() => onUpdate(name, { ...domain, arxiv_categories: domain.arxiv_categories.filter((entry) => entry !== category) })} className="text-emerald-400 hover:text-destructive transition-colors">&times;</button>
              </span>
            ))}
            <select
              value={catInput}
              onChange={(e) => {
                const category = e.target.value;
                if (category && !domain.arxiv_categories.includes(category)) {
                  onUpdate(name, { ...domain, arxiv_categories: [...domain.arxiv_categories, category] });
                }
                setCatInput('');
              }}
              className="rounded-lg border border-dashed border-border/60 bg-transparent px-2 py-0.5 text-[10px] text-muted-foreground/70 focus:border-primary/40 focus:outline-none"
            >
              <option value="">{t('settings.addPlaceholder')}</option>
              {ARXIV_CATEGORIES.filter((category) => !domain.arxiv_categories.includes(category)).map((category) => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  );
}

function XhsLoginSection() {
  const { t } = useTranslation('news');
  const preferQrLogin = shouldPreferXhsQrLogin();
  const [isLogging, setIsLogging] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [cookieSource, setCookieSource] = useState('auto');
  const [activeMethod, setActiveMethod] = useState<XhsLoginMethod>(preferQrLogin ? 'qrcode' : 'browser');
  const [result, setResult] = useState<{ success: boolean; message?: string; hint?: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  const handleLogin = async (method: XhsLoginMethod) => {
    setIsLogging(true);
    setLogs([]);
    setResult(null);
    setActiveMethod(method);

    try {
      const requestBody = method === 'browser'
        ? { method, cookieSource }
        : { method };

      const res = await api.news.xhsLogin(requestBody);
      const data = await res.json();

      if (data.logs?.length) setLogs(data.logs);

      if (data.success) {
        setResult({
          success: true,
          message: method === 'qrcode'
            ? (data.nickname ? t('settings.cookieSuccessWithName', { nickname: data.nickname }) : t('settings.qrSuccess'))
            : (data.nickname ? t('settings.cookieSuccessWithName', { nickname: data.nickname }) : t('settings.cookieSuccess')),
        });
      } else {
        setResult({
          success: false,
          message: data.error || (method === 'qrcode' ? t('settings.qrFailure') : t('settings.cookieFailure')),
          hint: data.contextHint,
        });
      }
    } catch (err: unknown) {
      setResult({
        success: false,
        message: err instanceof Error ? err.message : (method === 'qrcode' ? t('settings.qrFailure') : t('settings.loginFailed')),
      });
    } finally {
      setIsLogging(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border/50 bg-background/60 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Cookie className="h-4 w-4 text-muted-foreground" />
        <h4 className="text-sm font-semibold text-foreground">{t('settings.browserCookieAuth')}</h4>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {t('settings.browserCookieDescription')}
      </p>
      <div className="rounded-xl border border-amber-200/70 bg-amber-50/80 p-3 text-[11px] text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
        {t('settings.serviceMachineHint')}
      </div>
      {preferQrLogin && (
        <div className="rounded-xl border border-primary/30 bg-primary/[0.08] p-3 text-[11px] text-primary">
          {t('settings.qrRecommendedHint')}
        </div>
      )}

      <div className={`rounded-xl border p-3.5 space-y-2.5 ${preferQrLogin ? 'border-primary/40 bg-primary/5' : 'border-border/40 bg-background/50'}`}>
        <div className="flex items-center gap-2">
          <QrCode className="h-4 w-4 text-muted-foreground" />
          <h5 className="text-xs font-semibold text-foreground">{t('settings.qrLoginTitle')}</h5>
          {preferQrLogin && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-primary">
              {t('settings.recommendedTag')}
            </span>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">{t('settings.qrLoginDescription')}</p>
        <Button
          size="sm"
          variant={preferQrLogin ? 'default' : 'outline'}
          onClick={() => handleLogin('qrcode')}
          disabled={isLogging}
          className="rounded-lg text-xs gap-1.5"
        >
          {isLogging && activeMethod === 'qrcode' ? <Loader2 className="h-3 w-3 animate-spin" /> : <QrCode className="h-3 w-3" />}
          {isLogging && activeMethod === 'qrcode' ? t('settings.qrLoggingIn') : t('settings.loginViaQr')}
        </Button>
      </div>

      <div className={`rounded-xl border p-3.5 space-y-2.5 ${preferQrLogin ? 'border-border/40 bg-background/50' : 'border-primary/40 bg-primary/5'}`}>
        <div className="flex items-center gap-2">
          <Cookie className="h-4 w-4 text-muted-foreground" />
          <h5 className="text-xs font-semibold text-foreground">{t('settings.browserCookieAuth')}</h5>
        </div>
        <p className="text-[11px] text-muted-foreground">{t('settings.cookieSourceDescription')}</p>
        <div className="space-y-1.5">
          <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
            {t('settings.cookieSource')}
          </label>
          <select
            value={cookieSource}
            onChange={(e) => setCookieSource(e.target.value)}
            className="w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/20"
          >
            {XHS_COOKIE_SOURCES.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
        <Button
          size="sm"
          variant={preferQrLogin ? 'outline' : 'default'}
          onClick={() => handleLogin('browser')}
          disabled={isLogging}
          className="rounded-lg text-xs gap-1.5"
        >
          {isLogging && activeMethod === 'browser' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Cookie className="h-3 w-3" />}
          {isLogging && activeMethod === 'browser' ? t('settings.extracting') : t('settings.extractBrowserCookie')}
        </Button>
      </div>

      {logs.length > 0 && (
        <div
          ref={scrollRef}
          className="max-h-28 overflow-y-auto rounded-xl border border-border/40 bg-slate-950/90 p-2.5 font-mono text-[10px] leading-4 text-emerald-400 dark:border-border/30"
        >
          {logs.map((line, i) => (
            <div key={i} className="flex gap-1.5">
              <Terminal className="mt-0.5 h-2.5 w-2.5 flex-shrink-0 text-emerald-600" />
              <span>{line}</span>
            </div>
          ))}
        </div>
      )}

      {result && (
        <div className="space-y-1">
          <p className={`text-[11px] font-medium ${result.success ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
            {result.message}
          </p>
          {result.hint && (
            <p className="text-[11px] text-muted-foreground">
              {result.hint}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function SourceSettingsDialog({
  sourceKey,
  config,
  onConfigChange,
  onSave,
  onReset,
  onClose,
  sourceInfo: _sourceInfo,
  configDirty,
}: {
  sourceKey: NewsSourceKey;
  config: AnyConfig;
  onConfigChange: (config: AnyConfig) => void;
  onSave: () => void;
  onReset: () => void;
  onClose: () => void;
  sourceInfo?: SourceInfo;
  configDirty: boolean;
}) {
  const { t } = useTranslation('news');
  const [newDomainName, setNewDomainName] = useState('');

  const updateField = useCallback((field: string, value: unknown) => {
    onConfigChange({ ...config, [field]: value });
  }, [config, onConfigChange]);

  const updateDomain = useCallback((name: string, domain: ResearchDomain) => {
    onConfigChange({ ...config, research_domains: { ...(config.research_domains || {}), [name]: domain } });
  }, [config, onConfigChange]);

  const removeDomain = useCallback((name: string) => {
    const domains = { ...(config.research_domains || {}) };
    delete domains[name];
    onConfigChange({ ...config, research_domains: domains });
  }, [config, onConfigChange]);

  const addDomain = useCallback(() => {
    const name = newDomainName.trim();
    if (!name) return;
    onConfigChange({
      ...config,
      research_domains: {
        ...(config.research_domains || {}),
        [name]: {
          keywords: [],
          arxiv_categories: sourceKey === 'arxiv' ? ['q-bio.QM'] : [],
          priority: 5,
        },
      },
    });
    setNewDomainName('');
  }, [config, newDomainName, onConfigChange, sourceKey]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-[28px] border border-border/60 bg-card p-6 shadow-2xl space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10">
              <Settings2 className="h-4 w-4 text-primary" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">{t(SOURCE_TITLE_KEYS[sourceKey])}</h3>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="rounded-full text-xs"
              onClick={onReset}
            >
              {t('actions.resetDefaults')}
            </Button>
            {configDirty && (
              <Button size="sm" className="rounded-full text-xs gap-1.5 shadow-sm" onClick={onSave}>
                {t('actions.save')}
              </Button>
            )}
            <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {sourceKey === 'xiaohongshu' && <XhsLoginSection />}

        {sourceKey === 'xiaohongshu' && (
          <div className="rounded-xl border border-border/40 bg-background/50 p-3.5">
            <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">{t('settings.searchKeywords')}</label>
            <input
              value={config.keywords || ''}
              onChange={(e) => updateField('keywords', e.target.value)}
              placeholder={t('settings.searchKeywordsPlaceholder')}
              className="mt-1.5 w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/20"
            />
          </div>
        )}

        {sourceKey === 'wechat' && (
          <>
            <div className="space-y-3 rounded-2xl border border-border/50 bg-background/60 p-4">
              <h4 className="text-sm font-semibold text-foreground">{t('settings.wechatRsshubTitle')}</h4>
              <p className="text-[11px] text-muted-foreground">{t('settings.wechatRsshubDescription')}</p>
              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
                  {t('settings.wechatInstanceUrl')}
                </label>
                <input
                  type="url"
                  value={typeof config.instance_url === 'string' ? config.instance_url : ''}
                  onChange={(e) => updateField('instance_url', e.target.value)}
                  placeholder="https://rsshub.app"
                  spellCheck={false}
                  className="w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm font-mono focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/20"
                />
                <p className="text-[10px] text-muted-foreground/70">{t('settings.wechatInstanceHelp')}</p>
              </div>
              <TokenInput
                value={config.access_key as string | null | undefined}
                onChange={(next) => updateField('access_key', next)}
                onClear={() => updateField('access_key', null)}
                isSaved={config.access_key_set === true}
                placeholder={t('settings.wechatAccessKeyPlaceholder')}
                envVarLabel="?key=..."
              />
            </div>
            <div className="space-y-2 rounded-xl border border-border/40 bg-background/50 p-3.5">
              <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
                {t('settings.wechatAccounts')}
              </label>
              <p className="text-[11px] text-muted-foreground/80">{t('settings.wechatAccountsHelp')}</p>
              <textarea
                value={
                  Array.isArray(config.accounts)
                    ? config.accounts.join('\n')
                    : (typeof config.accounts === 'string' ? config.accounts.replace(/,\s*/g, '\n') : '')
                }
                onChange={(e) => {
                  const lines = e.target.value
                    .split(/\n/)
                    .map((entry) => entry.trim())
                    .filter(Boolean);
                  updateField('accounts', lines.join(','));
                }}
                placeholder={'wechat/ce/huxiu_com\nwechat/ce/ifanr\nhttps://rsshub.app/wechat/ce/PingWest'}
                rows={5}
                spellCheck={false}
                className="w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-xs font-mono focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/20"
              />
              <p className="text-[10px] text-muted-foreground/70">
                {t('settings.wechatAccountsFormat')}
              </p>
            </div>
          </>
        )}

        <div className={`grid gap-4 ${sourceKey === 'arxiv' ? 'sm:grid-cols-2' : sourceKey === 'xiaohongshu' || sourceKey === 'wechat' ? 'sm:grid-cols-1' : 'sm:grid-cols-3'}`}>
          <div className="rounded-xl border border-border/40 bg-background/50 p-3.5">
            <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">{t('settings.resultsToShow')}</label>
            <input
              type="number"
              min={1}
              max={50}
              value={config.top_n || 10}
              onChange={(e) => updateField('top_n', parseInt(e.target.value, 10) || 10)}
              className="mt-1.5 w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm font-medium tabular-nums focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/20"
            />
          </div>

          {sourceKey === 'arxiv' && (
            <div className="rounded-xl border border-border/40 bg-background/50 p-3.5">
              <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">{t('settings.maxArxivResults')}</label>
              <input
                type="number"
                min={50}
                max={1000}
                step={50}
                value={config.max_results || 200}
                onChange={(e) => updateField('max_results', parseInt(e.target.value, 10) || 200)}
                className="mt-1.5 w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm font-medium tabular-nums focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/20"
              />
            </div>
          )}

          {(sourceKey === 'pubmed' || sourceKey === 'europepmc' || sourceKey === 'medrxiv') && (
            <>
              <div className="rounded-xl border border-border/40 bg-background/50 p-3.5">
                <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">{t(MAX_RESULTS_LABEL_KEYS[sourceKey] ?? 'settings.resultsToShow')}</label>
                <input
                  type="number"
                  min={20}
                  max={300}
                  step={10}
                  value={config.max_results || (sourceKey === 'medrxiv' ? 150 : 120)}
                  onChange={(e) => updateField('max_results', parseInt(e.target.value, 10) || (sourceKey === 'medrxiv' ? 150 : 120))}
                  className="mt-1.5 w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm font-medium tabular-nums focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/20"
                />
              </div>
              <div className="rounded-xl border border-border/40 bg-background/50 p-3.5">
                <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">{t('settings.dateRangeDays')}</label>
                <input
                  type="number"
                  min={7}
                  max={365}
                  step={1}
                  value={config.date_range_days || 30}
                  onChange={(e) => updateField('date_range_days', parseInt(e.target.value, 10) || 30)}
                  className="mt-1.5 w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm font-medium tabular-nums focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/20"
                />
              </div>
            </>
          )}
        </div>

        <div className="space-y-3">
          <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">{t('settings.researchDomains')}</label>
          {Object.entries(config.research_domains || {}).map(([name, domain]) => (
            <DomainEditor
              key={name}
              name={name}
              domain={domain as ResearchDomain}
              onUpdate={updateDomain}
              onRemove={removeDomain}
              showCategories={sourceKey === 'arxiv'}
            />
          ))}
          <div className="flex items-center gap-2">
            <input
              value={newDomainName}
              onChange={(e) => setNewDomainName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addDomain()}
              placeholder={t('settings.newDomainPlaceholder')}
              className="flex-1 rounded-xl border border-dashed border-border/60 bg-transparent px-3.5 py-2 text-sm placeholder:text-muted-foreground/40 focus:border-primary/40 focus:outline-none"
            />
            <Button size="sm" variant="outline" className="rounded-full gap-1.5" onClick={addDomain} disabled={!newDomainName.trim()}>
              <Plus className="h-3.5 w-3.5" /> {t('settings.addDomain')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
