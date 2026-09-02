import { useCallback, useEffect, useRef, useState } from 'react';
import { authenticatedFetch } from '../../utils/api';
import { PI_PERMISSION_PRESETS } from '../../../shared/piPermissionPresets.js';

type Project = { name: string; displayName?: string };
type Entry = { id: string; title?: string; tool?: string; presetId?: string; status?: string; type?: string; nextRunAt?: string; lastStatus?: string; lastError?: string; createdAt?: string };
export default function AgentServicesSettings({ projects, initialSection = 'integrations' }: { projects: Project[]; initialSection?: 'integrations' | 'permissions' }) {
  const [project, setProject] = useState(projects[0]?.name || '');
  const [section, setSection] = useState<'integrations' | 'permissions' | 'automations'>(initialSection);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [entriesScope, setEntriesScope] = useState('');
  const [loading, setLoading] = useState(true);
  const refreshSequence = useRef(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [authUrl, setAuthUrl] = useState('');
  const [id, setId] = useState('');
  const [url, setUrl] = useState('');
  const [redirectUri, setRedirectUri] = useState('');
  const scope = JSON.stringify([project, section]);
  const visibleEntries = entriesScope === scope ? entries : [];
  const addedPresetIds = new Set(visibleEntries.filter((entry) => entry.tool === 'bash').map((entry) => entry.presetId));
  const missingPresetIds = PI_PERMISSION_PRESETS.filter((preset) => !addedPresetIds.has(preset.id)).map((preset) => preset.id);
  const canAddPresets = Boolean(project) && !busy && !loading && entriesScope === scope;
  const request = useCallback(async (suffix = '', options: RequestInit = {}) => {
    const response = await authenticatedFetch(`/api/agent-services/${section}${suffix}?projectKey=${encodeURIComponent(project)}`, options);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Request failed');
    return result;
  }, [project, section]);
  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    if (!project) { setLoading(false); return; }
    setLoading(true);
    setError('');
    try {
      const result = await request();
      if (sequence !== refreshSequence.current) return;
      setEntries(result); setEntriesScope(scope);
    } catch (failure) {
      if (sequence === refreshSequence.current) setError(String((failure as Error).message));
    } finally {
      if (sequence === refreshSequence.current) setLoading(false);
    }
  }, [request, project, scope]);
  useEffect(() => {
    setEntries([]); setEntriesScope(''); setError(''); setAuthUrl(''); void refresh();
    return () => { refreshSequence.current += 1; };
  }, [refresh]);
  const action = async (suffix: string, method: string, body?: object) => {
    setBusy(true); setError('');
    try {
      const result = await request(suffix, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
      setAuthUrl(result.authorizationUrl && /^https:\/\//.test(result.authorizationUrl) ? result.authorizationUrl : '');
      await refresh();
    } catch (failure) { setError((failure as Error).message); } finally { setBusy(false); }
  };
  return <section className="space-y-4">
    <h3 className="font-medium">{section === 'permissions' ? 'medhelpOS 权限设置' : 'Agent 执行服务'}</h3>
    <p className="text-xs text-muted-foreground">{section === 'permissions' ? '为所选项目添加常用命令授权，或撤销已记住的权限。' : '复用已安装 MCP 和现有 Memory。远程连接按项目保存；媒体与第三方工具需你已有的服务账户。'}</p>
    <select aria-label="项目" disabled={busy} value={project} onChange={(event) => setProject(event.target.value)} className="w-full rounded border bg-background p-2">
      <option value="">选择项目</option>{projects.map((item) => <option key={item.name} value={item.name}>{item.displayName || item.name}</option>)}
    </select>
    <div className="flex gap-3 text-sm">{(['integrations', 'permissions', 'automations'] as const).map((key) => <button key={key} type="button" disabled={busy} className={section === key ? 'font-semibold text-violet-600' : 'text-muted-foreground'} onClick={() => setSection(key)}>{({ integrations: '连接与授权', permissions: '记住的权限', automations: '自动化' })[key]}</button>)}</div>
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    {authUrl && <a href={authUrl} target="_blank" rel="noreferrer" className="block rounded border border-amber-400 p-3 text-sm text-amber-700">打开服务授权页面，完成后回到这里刷新</a>}
    {section === 'integrations' && <form className="space-y-2 rounded border p-3" onSubmit={(event) => { event.preventDefault(); void action('', 'POST', { id, url, redirectUri: redirectUri || undefined }); }}>
      <input required aria-label="连接名称" placeholder="连接名称，如 browser / media" value={id} onChange={(event) => setId(event.target.value)} className="w-full rounded border bg-background p-2 text-sm" />
      <input required type="url" aria-label="MCP HTTPS URL" placeholder="MCP HTTPS URL" value={url} onChange={(event) => setUrl(event.target.value)} className="w-full rounded border bg-background p-2 text-sm" />
      <input type="url" aria-label="OAuth 回调地址" placeholder="OAuth 回调地址（留空使用本机后端）" value={redirectUri} onChange={(event) => setRedirectUri(event.target.value)} className="w-full rounded border bg-background p-2 text-sm" />
      <button disabled={!project || busy} type="submit" className="rounded border px-3 py-1.5 text-sm disabled:opacity-50">保存连接</button>
      <p className="text-xs text-muted-foreground">本地命令继续通过已有 MCP 离线包安装。服务器部署请填写该服务器的 /api/agent-services/oauth/callback 完整地址。</p>
    </form>}
    {section === 'permissions' && <>
      <div role="group" aria-label="快速添加常用命令" className="space-y-3 rounded-lg border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-medium">快速添加常用命令</h4>
          <button type="button" disabled={!canAddPresets || !missingPresetIds.length}
            onClick={() => void action('/presets', 'POST', { presetIds: missingPresetIds })}
            className="rounded border px-3 py-1.5 text-sm disabled:opacity-50">{missingPresetIds.length ? '一次添加全部' : '已全部添加'}</button>
        </div>
        <p className="text-xs text-muted-foreground">只授权下面列出的完整 Shell 命令，不包含额外参数、组合命令或通配符。添加不会执行命令；询问模式下免去重复确认，计划和只读模式的限制不变。</p>
        {!project && <p className="text-sm text-muted-foreground">请先选择项目</p>}
        <div className="flex flex-wrap gap-2">
          {PI_PERMISSION_PRESETS.map((preset) => <button key={preset.id} type="button"
            aria-label={`添加 ${preset.command}`} title={preset.description}
            disabled={!canAddPresets || addedPresetIds.has(preset.id)}
            onClick={() => void action('/presets', 'POST', { presetIds: [preset.id] })}
            className="rounded-md border px-3 py-2 text-left text-xs hover:bg-muted disabled:opacity-50">
            <span className="block font-mono">{preset.command}{addedPresetIds.has(preset.id) ? ' · 已添加' : ''}</span>
            <span className="mt-1 block text-muted-foreground">{preset.description}</span>
          </button>)}
        </div>
      </div>
      <h4 className="text-sm font-medium">已记住的权限</h4>
      <p className="text-xs text-muted-foreground">授权仅在所选项目生效。常用命令允许调整执行超时；聊天中记住的其他授权仍匹配完整参数。撤销不影响已有文件。</p>
    </>}
    {section === 'automations' && <p className="text-xs text-muted-foreground">在聊天中明确描述时间和任务即可创建。自动执行为只读，需后端持续运行；暂停/取消会中断正在执行的该自动化。</p>}
    {visibleEntries.map((entry) => <div key={entry.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-3 text-sm">
      <div className="min-w-0"><div className="break-all font-medium">{PI_PERMISSION_PRESETS.find((preset) => preset.id === entry.presetId)?.command || entry.title || entry.tool || entry.id}</div><div className="text-xs text-muted-foreground">{entry.status || entry.createdAt}{entry.nextRunAt ? ` · ${new Date(entry.nextRunAt).toLocaleString()}` : ''}{entry.lastStatus ? ` · ${entry.lastStatus}` : ''}</div>{entry.lastError && <p className="text-xs text-red-600">{entry.lastError}</p>}</div>
      <div className="flex gap-2">
        {section === 'integrations' && <><button disabled={busy} onClick={() => void action(`/${encodeURIComponent(entry.id)}/reconnect`, 'POST', {})}>重连</button>{entry.type !== 'stdio' && <button disabled={busy} onClick={() => void action(`/${encodeURIComponent(entry.id)}/authorize`, 'POST', { reauthorize: true })}>重新授权</button>}</>}
        {section === 'permissions' && <button disabled={busy} onClick={() => void action(`/${entry.id}`, 'DELETE')}>撤销</button>}
        {section === 'automations' && <><button disabled={busy} onClick={() => void action(`/${entry.id}`, 'PATCH', { status: entry.status === 'active' ? 'paused' : 'active' })}>{entry.status === 'active' ? '暂停' : '恢复'}</button><button disabled={busy || entry.status === 'cancelled'} onClick={() => void action(`/${entry.id}`, 'PATCH', { status: 'cancelled' })}>取消</button></>}
      </div>
    </div>)}
    {loading ? <p role="status" className="text-sm text-muted-foreground">加载中…</p> : !visibleEntries.length && !error && <p className="text-sm text-muted-foreground">暂无记录</p>}
    <button disabled={busy || loading || !project} onClick={() => void refresh()} className="text-sm text-violet-600">刷新</button>
  </section>;
}
