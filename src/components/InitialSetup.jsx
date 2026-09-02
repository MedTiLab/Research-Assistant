import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  Check,
  CheckCircle2,
  ChevronRight,
  Code2,
  Database,
  ExternalLink,
  Folder,
  FolderOpen,
  HardDrive,
  Loader2,
  RefreshCw,
  TerminalSquare,
  X,
} from 'lucide-react';

import { api, authenticatedFetch } from '../utils/api';
import { getEnvironmentSetupGuidance } from '../utils/environmentSetupGuidance';
import { fetchWithLocalNetworkAccess } from '../utils/localNetworkAccess';
import { useOptionalLocalKernel } from '../state/localKernelStore';

const EMPTY_FORM = {
  ccSwitchDataDir: '~/.cc-switch',
  pythonExecutable: '',
  rExecutable: '',
  workspaceRoot: '~/Documents/MedHelpSec',
};

const SETUP_SECTIONS = [
  { id: 'cc-switch', label: 'CC Switch', icon: Bot },
  { id: 'runtimes', label: 'R 与 Python', icon: Code2 },
  { id: 'paths', label: '路径配置', icon: HardDrive },
];

function FieldStatus({ ok, optional = false, children }) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${
      ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'
    }`}>
      {ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : null}
      {children || (ok ? '已检测' : optional ? '可选' : '待配置')}
    </span>
  );
}

function PathField({
  id,
  label,
  description,
  value,
  onChange,
  onBrowse,
  error,
  status,
  placeholder,
  optional = false,
  mono = true,
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <label htmlFor={id} className="text-sm font-medium text-foreground">{label}</label>
          {description ? <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{description}</p> : null}
        </div>
        <FieldStatus ok={Boolean(status)} optional={optional}>{status}</FieldStatus>
      </div>
      <div className="flex gap-2">
        <input
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          spellCheck={false}
          className={`min-w-0 flex-1 rounded-lg border bg-background px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15 ${
            error ? 'border-red-400' : 'border-border'
          } ${mono ? 'font-mono' : ''}`}
        />
        {onBrowse ? (
          <button
            type="button"
            onClick={onBrowse}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground transition hover:bg-muted"
          >
            <FolderOpen className="h-4 w-4" />
            浏览
          </button>
        ) : null}
      </div>
      {error ? <p className="text-xs text-red-600 dark:text-red-400">{error}</p> : null}
    </div>
  );
}

function SetupActionNotice({ title, description, downloadUrl = '', downloadLabel = '', onRecheck }) {
  return (
    <div className="rounded-xl border border-amber-300/70 bg-amber-50/80 p-4 dark:border-amber-800/60 dark:bg-amber-950/25" role="status">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-amber-950 dark:text-amber-100">{title}</p>
          <p className="mt-1 text-xs leading-5 text-amber-900/80 dark:text-amber-100/75">{description}</p>
          {downloadUrl ? (
            <a
              href={downloadUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-white/70 px-2.5 py-1.5 text-xs font-medium text-amber-950 hover:bg-white dark:border-amber-800 dark:bg-black/20 dark:text-amber-100"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {downloadLabel || '打开官方下载页'}
            </a>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onRecheck}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-amber-300 bg-white/70 px-3 py-2 text-xs font-semibold text-amber-950 hover:bg-white dark:border-amber-800 dark:bg-black/20 dark:text-amber-100"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          重新检测
        </button>
      </div>
    </div>
  );
}

function DirectoryBrowser({ state, onClose, onNavigate, onSelect, onToggleHidden }) {
  if (!state.open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
      <div className="flex max-h-[min(680px,88vh)] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
        <div className="flex items-start justify-between border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h3 className="font-semibold text-foreground">选择目录</h3>
            <p className="mt-1 truncate font-mono text-xs text-muted-foreground" title={state.displayPath || state.currentPath}>
              {state.displayPath || state.currentPath || '加载中…'}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="关闭目录选择">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/35 px-5 py-2.5">
          <button
            type="button"
            onClick={() => state.parentPath && onNavigate(state.parentPath)}
            disabled={!state.parentPath || state.loading}
            className="text-xs font-medium text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          >
            返回上一级
          </button>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={state.showHidden} onChange={(event) => onToggleHidden(event.target.checked)} />
            显示隐藏目录
          </label>
        </div>

        <div className="min-h-[260px] flex-1 overflow-y-auto p-3">
          {state.loading ? (
            <div className="flex h-52 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> 正在读取目录…
            </div>
          ) : state.error ? (
            <div className="m-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
              {state.error}
            </div>
          ) : state.folders.length ? (
            <ul className="space-y-1">
              {state.folders.map((folder) => (
                <li key={folder.path}>
                  <button
                    type="button"
                    onDoubleClick={() => onNavigate(folder.path)}
                    onClick={() => onNavigate(folder.path)}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-foreground transition hover:bg-muted"
                  >
                    <Folder className="h-4 w-4 shrink-0 text-amber-500" />
                    <span className="truncate">{folder.name}</span>
                    <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex h-52 items-center justify-center text-sm text-muted-foreground">当前目录没有子目录</div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border bg-muted/25 px-5 py-3">
          <p className="min-w-0 truncate text-xs text-muted-foreground">将选择当前显示的目录</p>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted">取消</button>
            <button
              type="button"
              onClick={() => onSelect(state.currentPath)}
              disabled={!state.currentPath || state.loading || Boolean(state.error)}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              选择此目录
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function InitialSetup({ initialStatus = null, onComplete, completeAccountOnboarding = false }) {
  const localKernel = useOptionalLocalKernel();
  const usesLocalKernel = Boolean(
    localKernel?.state === 'connected'
      && localKernel.endpoint?.httpBaseUrl
      && localKernel.sessionToken,
  );
  const [form, setForm] = useState(EMPTY_FORM);
  const [detected, setDetected] = useState(initialStatus?.detected || null);
  const [loading, setLoading] = useState(true);
  const [detecting, setDetecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [browser, setBrowser] = useState({
    open: false,
    field: '',
    purpose: '',
    currentPath: '',
    displayPath: '',
    parentPath: '',
    folders: [],
    showHidden: false,
    loading: false,
    error: '',
  });

  const localRequest = useCallback((pathname, options = {}) => {
    if (!usesLocalKernel) return null;
    return fetchWithLocalNetworkAccess(`${localKernel.endpoint.httpBaseUrl}/api/local${pathname}`, {
      cache: 'no-store',
      ...options,
      headers: {
        Authorization: `Bearer ${localKernel.sessionToken}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
    });
  }, [localKernel?.endpoint?.httpBaseUrl, localKernel?.sessionToken, usesLocalKernel]);

  const requestSetup = useCallback((suffix = '', options = {}) => (
    localRequest(`/environment-setup${suffix}`, options)
      || authenticatedFetch(`/api/environment-setup${suffix}`, options)
  ), [localRequest]);

  const requestWorkspace = useCallback((suffix, options = {}) => (
    localRequest(`/projects/${suffix}`, options)
      || authenticatedFetch(`/api/projects/${suffix}`, options)
  ), [localRequest]);

  const requestBrowse = useCallback((dirPath, showHidden, purpose) => {
    const params = new URLSearchParams();
    if (dirPath) params.set('path', dirPath);
    if (showHidden) params.set('showHidden', 'true');
    if (purpose) params.set('purpose', purpose);
    return localRequest(`/browse-filesystem?${params.toString()}`)
      || authenticatedFetch(`/api/browse-filesystem?${params.toString()}`);
  }, [localRequest]);

  const applyLoadedValues = useCallback((setup, workspace) => {
    const setupValues = setup?.displayConfig || setup?.config || EMPTY_FORM;
    const { dataPath: _ignoredDataPath, ...setupFields } = setupValues;
    const workspacePath = workspace?.displayPath
      || workspace?.displayRoot
      || workspace?.path
      || workspace?.defaultPath
      || setupFields.workspaceRoot
      || '~';
    setForm({
      ...EMPTY_FORM,
      ...setupFields,
      workspaceRoot: workspacePath,
    });
    setDetected(setup?.detected || null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      initialStatus ? Promise.resolve(initialStatus) : requestSetup().then((response) => response.json()),
      requestWorkspace('workspace-root').then((response) => response.json()),
    ]).then(([setup, workspace]) => {
      if (!cancelled) applyLoadedValues(setup, workspace);
    }).catch((loadError) => {
      if (!cancelled) setError(loadError.message || '读取本机配置失败');
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [applyLoadedValues, initialStatus, requestSetup, requestWorkspace]);

  const updateField = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => ({ ...current, [field]: '' }));
    setError('');
  };

  const handleDetect = async () => {
    setDetecting(true);
    setError('');
    try {
      const response = await requestSetup('/detect', { method: 'POST' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || '环境检测失败');
      setDetected(payload);
      setForm((current) => ({
        ...current,
        ccSwitchDataDir: payload.ccSwitch?.dataDir || current.ccSwitchDataDir,
        pythonExecutable: payload.python?.executablePath || current.pythonExecutable,
        rExecutable: payload.r?.executablePath || current.rExecutable,
      }));
    } catch (detectError) {
      setError(detectError.message || '环境检测失败');
    } finally {
      setDetecting(false);
    }
  };

  const loadBrowserPath = useCallback(async (dirPath, showHidden = browser.showHidden, purpose = browser.purpose) => {
    setBrowser((current) => ({ ...current, loading: true, error: '' }));
    try {
      const response = await requestBrowse(dirPath || '~', showHidden, purpose);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || '读取目录失败');
      setBrowser((current) => ({
        ...current,
        loading: false,
        currentPath: payload.path || dirPath || '',
        displayPath: payload.displayPath || payload.path || dirPath || '',
        parentPath: payload.parentPath || '',
        folders: Array.isArray(payload.suggestions) ? payload.suggestions : [],
        error: '',
        showHidden,
        purpose,
      }));
    } catch (browseError) {
      setBrowser((current) => ({ ...current, loading: false, error: browseError.message || '读取目录失败' }));
    }
  }, [browser.purpose, browser.showHidden, requestBrowse]);

  const openBrowser = (field, purpose = '') => {
    const startPath = form[field] || form.workspaceRoot || '~';
    setBrowser((current) => ({ ...current, open: true, field, purpose }));
    void loadBrowserPath(startPath, browser.showHidden, purpose);
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setFieldErrors({});
    try {
      const validateResponse = await requestSetup('/validate', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      const validation = await validateResponse.json().catch(() => ({}));
      if (!validateResponse.ok) {
        setFieldErrors(validation.errors || validation.fieldErrors || {});
        throw new Error(validation.error || '请修正标出的配置项');
      }

      const workspaceResponse = await requestWorkspace('workspace-root', {
        method: 'PUT',
        body: JSON.stringify({ path: form.workspaceRoot }),
      });
      const workspacePayload = await workspaceResponse.json().catch(() => ({}));
      if (!workspaceResponse.ok) throw new Error(workspacePayload.error || '保存工作区路径失败');

      const saveResponse = await requestSetup('', {
        method: 'PUT',
        body: JSON.stringify(form),
      });
      const savePayload = await saveResponse.json().catch(() => ({}));
      if (!saveResponse.ok) {
        setFieldErrors(savePayload.fieldErrors || {});
        throw new Error(savePayload.error || '保存环境配置失败');
      }

      if (completeAccountOnboarding) {
        const onboardingResponse = await api.user.completeOnboarding();
        const onboardingPayload = await onboardingResponse.json().catch(() => ({}));
        if (!onboardingResponse.ok) throw new Error(onboardingPayload.error || '完成账号初始化失败');
      }

      await onComplete?.(savePayload);
    } catch (saveError) {
      setError(saveError.message || '保存配置失败');
    } finally {
      setSaving(false);
    }
  };

  const readiness = useMemo(() => ({
    ccSwitch: Boolean(form.ccSwitchDataDir),
    runtimes: Boolean(form.pythonExecutable && form.rExecutable),
    paths: Boolean(form.workspaceRoot),
  }), [form]);
  const setupGuidance = getEnvironmentSetupGuidance(detected?.platform);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin text-emerald-600" /> 正在检测本机环境…
        </div>
      </div>
    );
  }

  return (
    <>
      <main
        data-medhelp-initial-setup="true"
        data-medhelp-desktop-ready="true"
        className="medhelp-initial-setup-page overflow-y-auto bg-muted/30 px-4 py-6 text-foreground sm:px-8 sm:py-9 lg:overflow-hidden"
      >
        <div className="mx-auto w-full max-w-6xl lg:flex lg:h-full lg:min-h-0 lg:flex-col">
          <div className="flex shrink-0 items-center gap-3">
            <img src="/logo.png" alt="MedHelp" className="h-10 w-10 rounded-xl ring-1 ring-border" />
            <div>
              <p className="text-base font-semibold">MedHelp</p>
              <p className="text-xs text-muted-foreground">本机首次配置</p>
            </div>
          </div>

          <div className="mt-8 grid gap-6 lg:min-h-0 lg:flex-1 lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-9">
            <aside className="lg:min-h-0 lg:overflow-y-auto lg:pr-1">
              <p className="text-[11px] font-semibold tracking-[0.16em] text-emerald-600">首次配置</p>
              <h1 className="mt-2 text-3xl font-semibold leading-tight tracking-tight">配置这台电脑</h1>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                这些设置只保存在本机，不会跟随账号同步到其他设备。以后可在设置中修改。
              </p>
              <ol className="mt-6 space-y-3">
                {SETUP_SECTIONS.map(({ id, label, icon: Icon }, index) => {
                  const done = readiness[id === 'cc-switch' ? 'ccSwitch' : id];
                  return (
                    <li key={id} className="flex items-center gap-3 text-sm">
                      <span className={`flex h-7 w-7 items-center justify-center rounded-full border ${
                        done ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600' : 'border-border bg-card text-muted-foreground'
                      }`}>
                        {done ? <Check className="h-4 w-4" /> : <Icon className="h-3.5 w-3.5" />}
                      </span>
                      <span className={done ? 'font-medium text-foreground' : 'text-muted-foreground'}>{index + 1}. {label}</span>
                    </li>
                  );
                })}
              </ol>

              <button
                type="button"
                onClick={handleDetect}
                disabled={detecting || saving}
                className="mt-7 inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3.5 py-2 text-sm font-medium text-foreground shadow-sm transition hover:bg-muted disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${detecting ? 'animate-spin' : ''}`} />
                {detecting ? '正在检测…' : '重新检测环境'}
              </button>
            </aside>

            <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm lg:flex lg:min-h-0 lg:flex-col">
              <div className="shrink-0 border-b border-border px-6 py-5 sm:px-8">
                <h2 className="text-lg font-semibold">运行环境与目录</h2>
                <p className="mt-1 text-sm text-muted-foreground">已自动填充检测结果，请确认后完成配置。</p>
              </div>

              <div className="divide-y divide-border lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
                <section id="cc-switch" className="space-y-5 px-6 py-6 sm:px-8">
                  <div className="flex items-start gap-3">
                    <span className="rounded-xl bg-violet-500/10 p-2.5 text-violet-600"><Bot className="h-5 w-5" /></span>
                    <div>
                      <h3 className="font-semibold">CC Switch 配置</h3>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        仅检测 CC Switch 应用和本机数据目录，不修改智能体自身的默认配置目录。
                      </p>
                    </div>
                    <FieldStatus ok={detected?.ccSwitch?.installed}>
                      {detected?.ccSwitch?.installed ? '已发现 CC Switch' : '未发现应用，仍可先配置目录'}
                    </FieldStatus>
                  </div>
                  {!detected?.ccSwitch?.installed ? (
                    <SetupActionNotice
                      title="未检测到 CC Switch"
                      description={setupGuidance.ccSwitchDescription}
                      onRecheck={handleDetect}
                    />
                  ) : !detected?.ccSwitch?.dataDirExists ? (
                    <SetupActionNotice
                      title="CC Switch 已安装，但配置目录尚未生成"
                      description="请打开 CC Switch 完成一次供应商配置；也可以在下方重新选择已有的数据目录，然后再次检测。"
                      onRecheck={handleDetect}
                    />
                  ) : null}
                  <div className="grid gap-5">
                    <PathField id="cc-switch-data" label="CC Switch 数据目录" value={form.ccSwitchDataDir} onChange={(value) => updateField('ccSwitchDataDir', value)} onBrowse={() => openBrowser('ccSwitchDataDir')} error={fieldErrors.ccSwitchDataDir} status={detected?.ccSwitch?.dataDirExists ? '目录已存在' : ''} />
                  </div>
                  {detected?.ccSwitch?.applicationPath ? (
                    <p className="rounded-lg bg-muted/55 px-3 py-2 font-mono text-xs text-muted-foreground">应用：{detected.ccSwitch.applicationPath}</p>
                  ) : null}
                </section>

                <section id="runtimes" className="space-y-5 px-6 py-6 sm:px-8">
                  <div className="flex items-start gap-3">
                    <span className="rounded-xl bg-blue-500/10 p-2.5 text-blue-600"><TerminalSquare className="h-5 w-5" /></span>
                    <div>
                      <h3 className="font-semibold">R 与 Python</h3>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">R 与 Python 均为核心分析环境，用于统计分析、数据处理和科研绘图工作流。</p>
                    </div>
                  </div>
                  {!detected?.python?.ready || fieldErrors.pythonExecutable ? (
                    <SetupActionNotice
                      title={fieldErrors.pythonExecutable ? 'Python 路径不可用，需要修复' : '未检测到 Python 3'}
                      description={setupGuidance.pythonDescription}
                      downloadUrl={setupGuidance.pythonDownloadUrl}
                      downloadLabel={setupGuidance.pythonDownloadLabel}
                      onRecheck={handleDetect}
                    />
                  ) : null}
                  {!detected?.r?.ready || fieldErrors.rExecutable ? (
                    <SetupActionNotice
                      title={fieldErrors.rExecutable ? 'R 路径不可用，需要修复' : '未检测到 R'}
                      description={setupGuidance.rDescription}
                      downloadUrl={setupGuidance.rDownloadUrl}
                      downloadLabel={setupGuidance.rDownloadLabel}
                      onRecheck={handleDetect}
                    />
                  ) : null}
                  <PathField id="python-executable" label="Python 可执行文件" value={form.pythonExecutable} onChange={(value) => updateField('pythonExecutable', value)} error={fieldErrors.pythonExecutable} status={detected?.python?.ready ? detected.python.version || '已检测' : ''} placeholder={setupGuidance.pythonPlaceholder} />
                  <PathField id="r-executable" label="R 可执行文件" value={form.rExecutable} onChange={(value) => updateField('rExecutable', value)} error={fieldErrors.rExecutable} status={detected?.r?.ready ? detected.r.version || '已检测' : ''} placeholder={setupGuidance.rPlaceholder} />
                </section>

                <section id="paths" className="space-y-5 px-6 py-6 sm:px-8">
                  <div className="flex items-start gap-3">
                    <span className="rounded-xl bg-emerald-500/10 p-2.5 text-emerald-600"><Database className="h-5 w-5" /></span>
                    <div>
                      <h3 className="font-semibold">路径配置</h3>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">设置默认项目工作区。</p>
                    </div>
                  </div>
                  {fieldErrors.workspaceRoot ? (
                    <SetupActionNotice
                      title="目录不可访问，需要重新选择"
                      description="当前目录不存在或 MedHelp 无法访问。请用“浏览”重新选择本机目录；如果目录来自外置磁盘，请先连接磁盘后再检测。"
                      onRecheck={handleDetect}
                    />
                  ) : null}
                  <PathField id="workspace-root" label="默认工作区" value={form.workspaceRoot} onChange={(value) => updateField('workspaceRoot', value)} onBrowse={() => openBrowser('workspaceRoot')} error={fieldErrors.workspaceRoot} description="新项目和项目发现默认从此目录开始" />
                </section>
              </div>

              <div className="flex shrink-0 flex-col gap-3 border-t border-border bg-muted/30 px-6 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-8">
                <div className="min-h-5">
                  {error ? (
                    <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
                  ) : readiness.runtimes ? (
                    <p className="text-xs text-muted-foreground">保存后将立即应用到新的智能体会话。</p>
                  ) : (
                    <p className="text-xs text-amber-700 dark:text-amber-300">R 和 Python 可稍后配置，不影响现在进入 MedHelp。</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving || detecting || !readiness.ccSwitch || !readiness.paths}
                  className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  {saving ? '正在保存…' : readiness.runtimes ? '完成配置并进入 MedHelp' : '暂不配置 R / Python，进入 MedHelp'}
                </button>
              </div>
            </section>
          </div>
        </div>
      </main>

      <DirectoryBrowser
        state={browser}
        onClose={() => setBrowser((current) => ({ ...current, open: false }))}
        onNavigate={(nextPath) => void loadBrowserPath(nextPath, browser.showHidden, browser.purpose)}
        onToggleHidden={(showHidden) => void loadBrowserPath(browser.currentPath || '~', showHidden, browser.purpose)}
        onSelect={(selectedPath) => {
          updateField(browser.field, selectedPath);
          setBrowser((current) => ({ ...current, open: false }));
        }}
      />
    </>
  );
}
