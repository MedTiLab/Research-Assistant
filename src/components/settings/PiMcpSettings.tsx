import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Edit3, FolderOpen, Globe, Loader2, PackageOpen, Plus, RefreshCw, Server, Trash2, X } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { emptyPiMcpForm, parsePiMcpJson } from './piMcpForm';
import { defaultPiRequest, readPiResponse, type PiRequest, type PiResources } from './piResourceApi';

type Project = { name: string; displayName?: string };
type Scope = 'user' | 'local';
type Connection = { id: string; type: string; installed: boolean; enabled: boolean; status: string; version?: string; url?: string; redirectUri?: string; scope: Scope; projectKey?: string; projectName?: string; managed?: boolean; pluginKind?: 'builtin' | 'bundle' };
type McpTool = { name: string; description?: string; inputSchema?: object };
type TestResult = { success: boolean; message: string };

export default function PiMcpSettings({ projects, request = defaultPiRequest }: { projects: Project[]; request?: PiRequest }) {
  const { t } = useTranslation('settings');
  const label = useCallback((key: string, options = {}) => t(`piIntegrations.${key}`, options), [t]);
  const [entries, setEntries] = useState<Connection[]>([]);
  const [resources, setResources] = useState<PiResources | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState<'remote' | 'json' | 'bundle'>('remote');
  const [form, setForm] = useState(emptyPiMcpForm);
  const [json, setJson] = useState('');
  const [bundle, setBundle] = useState<File | null>(null);
  const [trusted, setTrusted] = useState(false);
  const [tools, setTools] = useState<Record<string, McpTool[]>>({});
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});
  const [authorization, setAuthorization] = useState<{ id: string; url: string } | null>(null);
  const sequence = useRef(0);

  const scopeQuery = useCallback((scope: Scope, projectKey = '') => {
    const params = new URLSearchParams({ scope });
    if (scope === 'local') params.set('projectKey', projectKey);
    return params.toString();
  }, []);
  const servicePath = useCallback((scope: Scope, projectKey = '', suffix = '') => `/services/integrations${suffix}?${scopeQuery(scope, projectKey)}`, [scopeQuery]);
  const entryKey = (entry: Pick<Connection, 'scope' | 'projectKey' | 'id'>) => `${entry.scope}:${entry.projectKey || ''}:${entry.id}`;

  const refresh = useCallback(async () => {
    const current = ++sequence.current;
    setLoading(true);
    try {
      const resourcePromise = request('/resources').then(readPiResponse);
      const scopes = [{ scope: 'user' as const, projectKey: '', projectName: '' }, ...projects.map((project) => ({ scope: 'local' as const, projectKey: project.name, projectName: project.displayName || project.name }))];
      const settled = await Promise.allSettled(scopes.map(async (item) => {
        const records = await readPiResponse(await request(servicePath(item.scope, item.projectKey)));
        return records.map((entry: Omit<Connection, 'scope'>) => ({ ...entry, ...item }));
      }));
      const catalog = await resourcePromise;
      if (current !== sequence.current) return;
      const failures = settled.filter((result) => result.status === 'rejected');
      setEntries(settled.flatMap((result) => result.status === 'fulfilled' ? result.value : []));
      setResources(catalog);
      setError(failures.length ? label('partialLoad', { count: failures.length }) : '');
    } catch (failure) {
      if (current === sequence.current) setError((failure as Error).message);
    } finally {
      if (current === sequence.current) setLoading(false);
    }
  }, [label, projects, request, servicePath]);
  useEffect(() => {
    setEntries([]); setTools({}); setTestResults({}); setAuthorization(null); setError('');
    void refresh();
    return () => { sequence.current += 1; };
  }, [refresh]);

  const post = (path: string, body: object) => request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(readPiResponse);
  const run = async (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError('');
    try { await operation(); } catch (failure) { setError((failure as Error).message); } finally { setBusy(false); }
  };
  const closeForm = () => { setShowForm(false); setEditing(false); setForm(emptyPiMcpForm()); setJson(''); setBundle(null); setTrusted(false); };
  const openAdd = () => { closeForm(); setMode('remote'); setShowForm(true); };
  const save = async () => {
    if (form.scope === 'local' && !form.projectKey) return;
    if (!editing && entries.some((entry) => entry.scope === form.scope && entry.projectKey === form.projectKey && entry.id === form.id)) throw new Error(label('nameExists'));
    await post(servicePath(form.scope as Scope, form.projectKey), form);
    closeForm(); setTools({}); setAuthorization(null); await refresh();
  };
  const inspect = async (entry: Connection, authorize = false) => {
    const key = entryKey(entry);
    setAuthorization(null);
    setTools((current) => { const next = { ...current }; delete next[key]; return next; });
    try {
      const result = await post(servicePath(entry.scope, entry.projectKey, `/${encodeURIComponent(entry.id)}/${authorize ? 'authorize' : 'reconnect'}`), {});
      if (result.authorizationUrl && /^https:\/\//.test(result.authorizationUrl)) setAuthorization({ id: entry.id, url: result.authorizationUrl });
      if (result.tools) setTools((current) => ({ ...current, [key]: result.tools }));
      setTestResults((current) => ({ ...current, [key]: { success: result.status === 'connected', message: result.status === 'connected' ? label('testSuccess') : label('authorizationRequired') } }));
      await refresh();
    } catch (failure) {
      setTestResults((current) => ({ ...current, [key]: { success: false, message: (failure as Error).message } }));
    }
  };
  const install = async () => {
    if (!bundle || !trusted) return;
    if (!/\.(mcpb|dxt)$/i.test(bundle.name) || bundle.size > 256 * 1024 * 1024) throw new Error(label('bundleLimit'));
    const body = new FormData(); body.append('file', bundle);
    await readPiResponse(await request('/mcp/bundle/install', { method: 'POST', body }));
    closeForm(); await refresh();
  };
  const setEntryAccess = async (entry: Connection) => {
    if (entry.managed) {
      await readPiResponse(await request(`/resources/mcp-access/${encodeURIComponent(entry.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowed: !entry.enabled }),
      }));
    } else {
      await post(servicePath(entry.scope, entry.projectKey), {
        id: entry.id,
        url: entry.url,
        redirectUri: entry.redirectUri,
        enabled: !entry.enabled,
      });
    }
    setTools({});
    setTestResults({});
    await refresh();
  };
  const visibleEntries = useMemo(() => {
    const merged = new Map(entries.map((entry) => [entryKey(entry), entry]));
    for (const plugin of resources?.mcpPlugins || []) {
      const key = `user::${plugin.id}`;
      const existing = merged.get(key);
      merged.set(key, {
        id: plugin.id,
        type: existing?.type || (plugin.kind === 'bundle' ? 'stdio' : 'builtin'),
        installed: plugin.kind === 'bundle',
        version: plugin.version,
        scope: 'user',
        projectKey: '',
        projectName: '',
        ...existing,
        managed: true,
        pluginKind: plugin.kind,
        enabled: plugin.allowed,
        status: plugin.allowed ? (existing?.status === 'connected' ? 'connected' : 'disconnected') : 'disabled',
      });
    }
    const priority = (entry: Connection) => entry.id === 'medhelp_workbench' ? 0 : entry.id === 'medhelp_compute' ? 1 : 2;
    return [...merged.values()].sort((left, right) => priority(left) - priority(right) || Number(left.scope === 'local') - Number(right.scope === 'local') || String(left.projectName).localeCompare(String(right.projectName)) || left.id.localeCompare(right.id));
  }, [entries, resources]);
  const displayName = (entry: Connection) => entry.id === 'medhelp_workbench'
    ? label('builtins.workbench')
    : entry.id === 'medhelp_compute'
      ? label('builtins.compute')
      : entry.id;
  const description = (entry: Connection) => entry.id === 'medhelp_workbench'
    ? label('builtins.workbenchHelp')
    : entry.id === 'medhelp_compute'
      ? label('builtins.computeHelp')
      : '';

  return <section className="space-y-4">
    <div><div className="flex items-center gap-3"><Server className="h-5 w-5 text-purple-500" /><h3 className="text-lg font-medium">{label('title')}</h3></div><p className="mt-1 text-sm text-muted-foreground">{label('description')}</p></div>
    <div className="rounded-lg border border-purple-200 bg-purple-50/50 p-3 text-sm text-purple-900 dark:border-purple-900/60 dark:bg-purple-950/20 dark:text-purple-100">{label('accessHelp')}</div>
    <div className="flex flex-wrap items-center gap-2"><Button type="button" size="sm" className="bg-purple-600 text-white hover:bg-purple-700" disabled={busy} onClick={openAdd}><Plus className="mr-2 h-4 w-4" />{label('add')}</Button><Button type="button" size="sm" variant="outline" disabled={busy || loading} onClick={() => void refresh()}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />{label('refresh')}</Button></div>
    {!showForm && error && <p role="alert" className="rounded-md border border-red-300 p-3 text-sm text-red-600">{error}</p>}
    {resources?.mcpEnabled === false && <p role="alert" className="text-sm text-amber-600">{label('mcpDisabled')}</p>}
    {authorization && <a href={authorization.url} target="_blank" rel="noreferrer" className="block rounded-md border border-amber-400 p-3 text-sm">{label('openAuthorization', { name: authorization.id })}</a>}
    {loading && !entries.length && <p role="status" className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{label('loading')}</p>}
    {!loading && !visibleEntries.length && !error && <div className="py-8 text-center text-sm text-muted-foreground">{label('empty')}</div>}
    <div className="space-y-2">{visibleEntries.map((entry) => {
      const key = entryKey(entry); const result = testResults[key]; const discovered = tools[key];
      return <article key={key} aria-label={entry.id} className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/50"><div className="flex items-start justify-between gap-3"><div className="min-w-0 flex-1">
        <div className="mb-2 flex flex-wrap items-center gap-2"><Globe className="h-4 w-4" /><span className="font-medium">{displayName(entry)}</span>{displayName(entry) !== entry.id && <code className="text-xs text-muted-foreground">{entry.id}</code>}<Badge variant="outline" className="text-xs">{entry.type}</Badge><Badge variant="outline" className="text-xs">{entry.managed ? label('kernelScope') : entry.scope === 'user' ? label('userScope') : label('localScope')}</Badge><Badge variant="outline" className="text-xs">{label(`status.${entry.status}`)}</Badge></div>
        <div className="space-y-1 text-sm text-muted-foreground">{description(entry) && <div>{description(entry)}</div>}{entry.url && <div>{label('url')}: <code className="break-all rounded bg-gray-100 px-1 text-xs dark:bg-gray-800">{entry.url}</code></div>}{entry.scope === 'local' && <div>{label('project')}: <code className="rounded bg-gray-100 px-1 text-xs dark:bg-gray-800">{entry.projectName}</code></div>}{entry.managed && <div>{label('bundleVersion')}: <code className="rounded bg-gray-100 px-1 text-xs dark:bg-gray-800">{entry.version || '-'}</code></div>}</div>
        {result && <div className={`mt-2 rounded p-2 text-xs ${result.success ? 'bg-green-50 text-green-800 dark:bg-green-900/20 dark:text-green-200' : 'bg-red-50 text-red-800 dark:bg-red-900/20 dark:text-red-200'}`}>{result.message}</div>}
        {discovered && <div className="mt-2 rounded bg-blue-50 p-2 text-xs text-blue-800 dark:bg-blue-900/20 dark:text-blue-200"><div className="font-medium">{label('toolsCount', { count: discovered.length })}</div><div className="mt-1 flex flex-wrap gap-1">{discovered.slice(0, 5).map((tool) => <code key={tool.name} className="rounded bg-blue-100 px-1 dark:bg-blue-800">{tool.name}</code>)}{discovered.length > 5 && <span>{label('moreTools', { count: discovered.length - 5 })}</span>}</div></div>}
      </div><div className="flex flex-wrap items-center justify-end gap-1">{entry.pluginKind !== 'builtin' && <Button type="button" size="sm" variant="outline" disabled={busy || !entry.enabled || resources?.mcpEnabled === false} onClick={() => void run(() => inspect(entry))}>{label('testConnection')}</Button>}{!entry.managed && <><Button type="button" size="sm" variant="ghost" disabled={busy || !entry.enabled} onClick={() => void run(() => inspect(entry, true))}>{label('authorize')}</Button><Button type="button" size="sm" variant="ghost" title={label('edit')} disabled={busy} onClick={() => { setForm({ ...emptyPiMcpForm(), id: entry.id, url: entry.url || '', redirectUri: entry.redirectUri || '', enabled: entry.enabled, scope: entry.scope, projectKey: entry.projectKey || '' }); setEditing(true); setMode('remote'); setShowForm(true); }}><Edit3 className="h-4 w-4" /></Button><Button type="button" size="sm" variant="ghost" className="text-red-600" title={label('delete')} disabled={busy} onClick={() => { if (window.confirm(label('deleteConfirm', { name: entry.id }))) void run(async () => { await readPiResponse(await request(servicePath(entry.scope, entry.projectKey, `/${encodeURIComponent(entry.id)}`), { method: 'DELETE' })); setTools({}); await refresh(); }); }}><Trash2 className="h-4 w-4" /></Button></>}<Button type="button" size="sm" variant={entry.enabled ? 'default' : 'outline'} role="switch" aria-checked={entry.enabled} aria-label={label('accessToggle', { name: displayName(entry) })} disabled={busy || resources?.mcpEnabled === false} onClick={() => void run(() => setEntryAccess(entry))}>{label(entry.enabled ? 'accessAllowed' : 'allowAccess')}</Button></div></div></article>;
    })}</div>

    {showForm && <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-4"><div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border bg-background"><div className="flex items-center justify-between border-b p-4"><h3 className="text-lg font-medium">{label(editing ? 'edit' : 'add')}</h3><Button type="button" variant="ghost" size="sm" onClick={closeForm}><X className="h-4 w-4" /></Button></div><div className="space-y-4 p-4">
      {error && <p role="alert" className="rounded-md border border-red-300 p-3 text-sm text-red-600">{error}</p>}
      {!editing && <div className="flex flex-wrap gap-2" role="group" aria-label={label('addMethod')}>{(['remote', 'json', 'bundle'] as const).map((kind) => <Button key={kind} type="button" size="sm" variant={mode === kind ? 'default' : 'outline'} onClick={() => { setMode(kind); setBundle(null); setTrusted(false); }}>{kind === 'bundle' && <PackageOpen className="mr-2 h-4 w-4" />}{label(kind)}</Button>)}</div>}
      {mode !== 'bundle' && <div className="space-y-2"><label className="text-sm font-medium">{label('scope')}</label><div className="flex gap-2"><Button type="button" className="flex-1" variant={form.scope === 'user' ? 'default' : 'outline'} disabled={editing} onClick={() => setForm({ ...form, scope: 'user', projectKey: '' })}><Globe className="mr-2 h-4 w-4" />{label('userScope')}</Button><Button type="button" className="flex-1" variant={form.scope === 'local' ? 'default' : 'outline'} disabled={editing} onClick={() => setForm({ ...form, scope: 'local' })}><FolderOpen className="mr-2 h-4 w-4" />{label('localScope')}</Button></div><p className="text-xs text-muted-foreground">{label(form.scope === 'user' ? 'userScopeHelp' : 'localScopeHelp')}</p></div>}
      {mode !== 'bundle' && form.scope === 'local' && <label className="block space-y-1 text-sm"><span>{label('project')}</span><select required disabled={editing} value={form.projectKey} onChange={(event) => setForm({ ...form, projectKey: event.target.value })} className="w-full rounded-md border bg-background p-2"><option value="">{label('selectProject')}</option>{projects.map((project) => <option key={project.name} value={project.name}>{project.displayName || project.name}</option>)}</select></label>}
      {mode === 'remote' && <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void run(save); }}><label className="block space-y-1 text-sm"><span>{label('name')}</span><Input required disabled={editing || busy} pattern="[a-zA-Z0-9][a-zA-Z0-9_.-]{0,126}" value={form.id} onChange={(event) => setForm({ ...form, id: event.target.value })} /></label><label className="block space-y-1 text-sm"><span>{label('url')}</span><Input required type="url" value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} /></label><details><summary className="cursor-pointer text-sm text-muted-foreground">{label('advanced')}</summary><label className="mt-2 block space-y-1 text-sm"><span>{label('callback')}</span><Input type="url" value={form.redirectUri} onChange={(event) => setForm({ ...form, redirectUri: event.target.value })} /></label></details><div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={closeForm}>{label('cancel')}</Button><Button type="submit" disabled={busy || (form.scope === 'local' && !form.projectKey)}>{label('save')}</Button></div></form>}
      {mode === 'json' && <div className="space-y-3"><textarea aria-label={label('json')} rows={8} value={json} onChange={(event) => setJson(event.target.value)} className="w-full rounded-md border bg-background p-3 font-mono text-xs" /><p className="text-xs text-muted-foreground">{label('jsonHelp')}</p><div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={closeForm}>{label('cancel')}</Button><Button type="button" disabled={!json.trim()} onClick={() => { try { const parsed = parsePiMcpJson(json); setForm({ ...parsed, scope: form.scope, projectKey: form.projectKey }); setMode('remote'); setError(''); } catch (failure) { setError(label(`errors.${(failure as Error).message}`)); } }}>{label('preview')}</Button></div></div>}
      {mode === 'bundle' && <div className="space-y-3"><p className="text-sm text-muted-foreground">{label('bundleHelp')}</p><input type="file" aria-label={label('bundleFile')} accept=".mcpb,.dxt" onChange={(event) => { setBundle(event.target.files?.[0] || null); setTrusted(false); }} /><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={trusted} onChange={(event) => setTrusted(event.target.checked)} className="mt-1" />{label('trustBundle')}</label><div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={closeForm}>{label('cancel')}</Button><Button type="button" disabled={busy || !bundle || !trusted} onClick={() => void run(install)}>{label(busy ? 'installing' : 'install')}</Button></div></div>}
    </div></div></div>}
  </section>;
}
