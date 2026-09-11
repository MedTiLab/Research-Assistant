import React, { useEffect, useMemo, useRef, useState } from 'react';
import { GitBranch, GripVertical, LayoutGrid, Maximize, Minus, Plus, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { authenticatedFetch } from '../../../../utils/api';
import { safeLocalStorage } from '../../utils/chatStorage';

export type CanvasBranch = { id: string; parentId: string | null; label: string; leafId: string | null; fromEntryId: string | null };
type CanvasMessage = { id: string; branchId: string; role: string; preview: string; active: boolean };
type BranchTree = { activeBranchId: string; branches: CanvasBranch[]; canvasMessages: CanvasMessage[] };

type Position = { x: number; y: number };
type Positions = Record<string, Position>;

export function readCanvasPositions(key: string): Positions {
  try {
    const value = JSON.parse(safeLocalStorage.getItem(key) || '{}');
    return Object.fromEntries(Object.entries(value || {}).filter(([, point]) => {
      const position = point as Position;
      return position && Number.isFinite(position.x) && Number.isFinite(position.y)
        && position.x >= 0 && position.y >= 0 && position.x <= 100000 && position.y <= 100000;
    })) as Positions;
  } catch { return {}; }
}

export function layoutBranches(branches: CanvasBranch[]) {
  const byId = new Map(branches.map((branch) => [branch.id, branch]));
  const children = new Map<string, CanvasBranch[]>();
  for (const branch of branches) {
    if (branch.parentId && byId.has(branch.parentId)) {
      children.set(branch.parentId, [...(children.get(branch.parentId) || []), branch]);
    }
  }
  const positions = new Map<string, Position>();
  const visited = new Set<string>();
  let row = 0;
  const place = (branch: CanvasBranch, depth: number): number => {
    visited.add(branch.id);
    const rows: number[] = [];
    for (const child of children.get(branch.id) || []) {
      if (!visited.has(child.id)) rows.push(place(child, depth + 1));
    }
    const y = rows.length ? (rows[0] + rows[rows.length - 1]) / 2 : 40 + row++ * 380;
    positions.set(branch.id, { x: 40 + depth * 400, y });
    return y;
  };
  for (const branch of branches.filter((item) => !item.parentId || !byId.has(item.parentId))) {
    if (!visited.has(branch.id)) place(branch, 0);
  }
  // Malformed/cyclic imports still get a finite, visible layout.
  for (const branch of branches) if (!visited.has(branch.id)) place(branch, 0);
  return branches.map((branch) => ({ ...branch, ...positions.get(branch.id)! }));
}

export default function ConversationCanvas({ projectName, sessionId, isLoading, revision, onBranchChanged, onBusyChange }: {
  projectName: string;
  sessionId: string | null;
  isLoading: boolean;
  revision: number;
  onBranchChanged: () => Promise<void>;
  onBusyChange: (busy: boolean) => void;
}) {
  const { t } = useTranslation('chat');
  const [tree, setTree] = useState<BranchTree | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [label, setLabel] = useState('');
  const positionKey = `conversation-canvas-positions:${JSON.stringify([projectName, sessionId])}`;
  const [positions, setPositions] = useState<Positions>(() => readCanvasPositions(positionKey));
  const positionsRef = useRef(positions);
  const [draggingNode, setDraggingNode] = useState<string | null>(null);
  const nodeDrag = useRef<{ id: string; clientX: number; clientY: number; x: number; y: number; scrollLeft: number; scrollTop: number; zoom: number } | null>(null);
  const savePositions = (next: Positions) => {
    positionsRef.current = next;
    setPositions(next);
  };
  useEffect(() => {
    const next = readCanvasPositions(positionKey);
    positionsRef.current = next;
    setPositions(next);
  }, [positionKey]);
  useEffect(() => {
    const timer = window.setTimeout(() => safeLocalStorage.setItem(positionKey, JSON.stringify(positions)), 200);
    return () => window.clearTimeout(timer);
  }, [positions, positionKey]);

  const [needsHistoryRefresh, setNeedsHistoryRefresh] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const mutationLock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const base = sessionId ? `/api/pi/projects/${encodeURIComponent(projectName)}/sessions/${encodeURIComponent(sessionId)}/branches` : null;
  useEffect(() => {
    if (!base || pending) return;
    const controller = new AbortController();
    setFetching(true);
    authenticatedFetch(base, { signal: controller.signal }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t('canvas.loadFailed'));
      if (!controller.signal.aborted) { setTree(data); if (!needsHistoryRefresh) setError(''); }
    }).catch((reason) => {
      if (!controller.signal.aborted) setError(reason.message || t('canvas.loadFailed'));
    }).finally(() => { if (!controller.signal.aborted) setFetching(false); });
    return () => controller.abort();
  }, [base, isLoading, revision, refresh, pending, t]);
  const nodes = useMemo(() => layoutBranches(tree?.branches || []).map((node) => ({
    ...node, ...(positions[node.id] || {}),
  })), [tree, positions]);
  useEffect(() => {
    const node = nodes.find((item) => item.id === tree?.activeBranchId);
    if (node && viewport.current) viewport.current.scrollTo({ left: Math.max(0, node.x * zoom - 40), top: Math.max(0, node.y * zoom - 40), behavior: 'smooth' });
  }, [tree?.activeBranchId]);
  const width = Math.max(760, ...nodes.map((node) => node.x + 380));
  const height = Math.max(400, ...nodes.map((node) => node.y + 380));
  const fitNodes = (items = nodes) => {
    const element = viewport.current;
    if (!element || !items.length) return;
    const right = Math.max(...items.map((node) => node.x + 360));
    const bottom = Math.max(...items.map((node) => node.y + 360));
    setZoom(Math.max(.1, Math.min(1, element.clientWidth / right, element.clientHeight / bottom)));
    element.scrollTo({ left: 0, top: 0 });
  };
  const autoLayout = () => {
    const next = layoutBranches(tree?.branches || []);
    const nextPositions = Object.fromEntries(next.map(({ id, x, y }) => [id, { x, y }]));
    savePositions(nextPositions);
    safeLocalStorage.setItem(positionKey, JSON.stringify(nextPositions));
    fitNodes(next);
  };
  const finishNodeDrag = () => {
    nodeDrag.current = null;
    setDraggingNode(null);
    safeLocalStorage.setItem(positionKey, JSON.stringify(positionsRef.current));
  };
  const busy = pending || isLoading || fetching;
  const changeBranch = async (action: 'create' | 'switch', input: Record<string, string>) => {
    if (!base || busy || mutationLock.current || needsHistoryRefresh) return;
    mutationLock.current = true;
    setPending(true); onBusyChange(true); setError('');
    let historyFailed = false;
    try {
      const response = await authenticatedFetch(`${base}/${action}`, { method: 'POST', body: JSON.stringify(input) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || t('canvas.changeFailed'));
      setTree(result);
      await onBranchChanged();
      setLabel('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('canvas.changeFailed'));
      historyFailed = true; setNeedsHistoryRefresh(true);
    } finally {
      mutationLock.current = false;
      setPending(false);
      if (!historyFailed && mounted.current) onBusyChange(false);
    }
  };
  const retryHistory = async () => {
    setPending(true); onBusyChange(true);
    let recovered = false;
    try { await onBranchChanged(); setNeedsHistoryRefresh(false); setError(''); recovered = true; }
    catch (reason) { setError(reason instanceof Error ? reason.message : t('canvas.loadFailed')); }
    finally { setPending(false); if (recovered && mounted.current) onBusyChange(false); }
  };
  return (
    <section className="flex min-h-0 flex-1 flex-col bg-muted/20" aria-label={t('canvas.title')}>
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2 text-xs">
        <GitBranch className="h-4 w-4 text-primary" />
        <span className="font-medium">{t('canvas.title')}</span>
        <span className="text-muted-foreground">{t('canvas.hint')}</span>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" disabled={!nodes.length} onClick={autoLayout} className="flex items-center gap-1 rounded px-2 py-1 hover:bg-muted disabled:opacity-40"><LayoutGrid size={14} />{t('canvas.autoLayout')}</button>
          <button type="button" disabled={!nodes.length} aria-label={t('canvas.fitView')} title={t('canvas.fitView')} onClick={() => fitNodes()} className="rounded p-1 hover:bg-muted"><Maximize size={15} /></button>
          <button type="button" aria-label={t('canvas.zoomOut')} onClick={() => setZoom((value) => Math.max(.1, value - .1))}><Minus size={16} /></button>
          <button type="button" aria-label={t('canvas.resetZoom')} onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
          <button type="button" aria-label={t('canvas.zoomIn')} onClick={() => setZoom((value) => Math.min(1.5, value + .1))}><Plus size={16} /></button>
          <button type="button" disabled={busy} aria-label={t('canvas.refresh')} onClick={() => setRefresh((value) => value + 1)}><RefreshCw size={14} className={fetching ? 'animate-spin' : ''} /></button>
        </div>
      </div>
      {error && <div role="alert" className="px-3 py-2 text-xs text-destructive">{error} {needsHistoryRefresh && <button type="button" disabled={pending} onClick={retryHistory} className="underline">{t('canvas.retryHistory')}</button>}</div>}
      {!base ? <div className="m-auto p-8 text-center text-sm text-muted-foreground">{t('canvas.empty')}</div> : <>
        <div className="flex items-center gap-2 border-b px-3 py-2 text-xs">
          <input aria-label={t('canvas.branchName')} maxLength={100} placeholder={t('canvas.branchName')} value={label} onChange={(event) => setLabel(event.target.value)} className="w-44 rounded border bg-background px-2 py-1" />
          <span className="text-muted-foreground">{isLoading ? t('canvas.running') : t('canvas.sharedFiles')}</span>
        </div>
        <div ref={viewport} className="min-h-0 flex-1 overflow-auto cursor-grab active:cursor-grabbing" style={{ backgroundImage: 'radial-gradient(circle, hsl(var(--border)) 1px, transparent 1px)', backgroundSize: '20px 20px' }}
          onPointerDown={(event) => {
            if (event.button !== 0 || (event.target as HTMLElement).closest('button, input, article')) return;
            const element = event.currentTarget;
            drag.current = { x: event.clientX, y: event.clientY, left: element.scrollLeft, top: element.scrollTop };
            element.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => { if (drag.current) { event.currentTarget.scrollLeft = drag.current.left - event.clientX + drag.current.x; event.currentTarget.scrollTop = drag.current.top - event.clientY + drag.current.y; } }}
          onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}>
          <div style={{ width: width * zoom, height: height * zoom }}>
            <div className="relative origin-top-left" style={{ width, height, transform: `scale(${zoom})` }}>
              <svg className="pointer-events-none absolute inset-0 text-primary/30" width={width} height={height} aria-hidden="true">
                {nodes.map((node) => {
                  const parent = nodes.find((item) => item.id === node.parentId);
                  return parent ? <path key={node.id} d={`M ${parent.x + 320} ${parent.y + 30} C ${parent.x + 350} ${parent.y + 30}, ${node.x - 30} ${node.y + 30}, ${node.x} ${node.y + 30}`} fill="none" stroke="currentColor" strokeWidth="2" /> : null;
                })}
              </svg>
              {nodes.map((node) => {
                const active = tree?.activeBranchId === node.id;
                const messages = tree?.canvasMessages?.filter((message) => message.branchId === node.id) || [];
                return <article key={node.id} data-branch-id={node.id} className={`absolute flex h-[320px] w-80 flex-col rounded-xl border bg-background shadow-sm ${active ? 'border-primary ring-2 ring-primary/15' : ''}`} style={{ left: node.x, top: node.y, zIndex: draggingNode === node.id ? 10 : 1 }}>
                  <header className="flex items-center gap-2 border-b px-3 py-3 text-sm">
                    <button type="button" aria-label={t('canvas.moveBranch', { name: node.id === 'main' ? t('canvas.main') : node.label })} title={t('canvas.dragHint')}
                      className="-ml-1 flex min-w-0 flex-1 touch-none select-none items-center gap-2 rounded p-1 text-left cursor-grab active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-primary"
                      onPointerDown={(event) => {
                        if (event.button !== 0 || !viewport.current) return;
                        event.stopPropagation(); event.preventDefault();
                        nodeDrag.current = { id: node.id, clientX: event.clientX, clientY: event.clientY, x: node.x, y: node.y, scrollLeft: viewport.current.scrollLeft, scrollTop: viewport.current.scrollTop, zoom };
                        setDraggingNode(node.id);
                        event.currentTarget.setPointerCapture(event.pointerId);
                      }}
                      onPointerMove={(event) => {
                        const start = nodeDrag.current;
                        if (!start || !viewport.current) return;
                        event.stopPropagation();
                        const x = start.x + (event.clientX - start.clientX + viewport.current.scrollLeft - start.scrollLeft) / start.zoom;
                        const y = start.y + (event.clientY - start.clientY + viewport.current.scrollTop - start.scrollTop) / start.zoom;
                        savePositions({ ...positionsRef.current, [start.id]: { x: Math.max(24, Math.min(100000, x)), y: Math.max(24, Math.min(100000, y)) } });
                      }}
                      onPointerUp={finishNodeDrag} onPointerCancel={finishNodeDrag} onLostPointerCapture={finishNodeDrag}
                      onKeyDown={(event) => {
                        const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
                        if (!delta) return;
                        event.preventDefault();
                        const step = event.shiftKey ? 50 : 10;
                        savePositions({ ...positionsRef.current, [node.id]: { x: Math.max(24, node.x + delta[0] * step), y: Math.max(24, node.y + delta[1] * step) } });
                      }}>
                    <GripVertical size={14} className="shrink-0 text-muted-foreground" />
                    <span className="truncate font-medium" title={node.label}>{node.id === 'main' ? t('canvas.main') : node.label}</span>
                    </button>
                    <button type="button" disabled={busy || active || !node.leafId || needsHistoryRefresh} onClick={() => changeBranch('switch', { branchId: node.id })} className="ml-auto shrink-0 rounded bg-primary/10 px-2 py-1 text-xs text-primary disabled:opacity-50">{active ? t('canvas.active') : t('canvas.continue')}</button>
                  </header>
                  <div className="min-h-0 flex-1 cursor-auto space-y-2 overflow-auto p-3" style={{ touchAction: 'pan-y' }}>
                    {messages.length === 0 && <p className="text-xs text-muted-foreground">{t('canvas.branchEmpty')}</p>}
                    {messages.map((message) => <div key={message.id} className={`rounded-lg p-2 text-xs ${message.role === 'user' ? 'bg-primary/5' : 'bg-muted/50'}`}>
                      <div className="mb-1 flex items-center justify-between text-muted-foreground">
                        <span>{message.role === 'user' ? t('canvas.you') : 'AI'}</span>
                        {message.active && <button type="button" disabled={busy || needsHistoryRefresh} onClick={() => changeBranch('create', { entryId: message.id, label: label.trim() || t('canvas.defaultName', { count: tree?.branches.length }) })} className="text-primary disabled:opacity-40">{t('canvas.branchHere')}</button>}
                      </div>
                      <p className="whitespace-pre-wrap break-words">{message.preview}</p>
                    </div>)}
                  </div>
                </article>;
              })}
            </div>
          </div>
        </div>
      </>}
    </section>
  );
}
