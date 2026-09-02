import { Check, ChevronDown, Laptop, Loader2, Server } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '../../../../lib/utils';
import { useOptionalLocalKernel } from '../../../../state/localKernelStore';
import { buildComputeApi } from '../../../../utils/computeApi';
import { CAPABILITIES, useEntitlements } from '../../../../hooks/useEntitlements';

type ComputeNodeSelectorVariant = 'composer' | 'rail';

type ComputeNode = {
  id: string;
  name?: string;
  host?: string;
  type?: 'direct' | 'slurm' | string;
};

const LOCAL_RESOURCE_ID = '__local__';

function ComputeNodeSelectorContent({ variant }: { variant: ComputeNodeSelectorVariant }) {
  const isRail = variant === 'rail';
  const { t } = useTranslation('chat');
  const localKernel = useOptionalLocalKernel();
  const [nodes, setNodes] = useState<ComputeNode[]>([]);
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const computeApi = useMemo(() => buildComputeApi(localKernel), [
    localKernel?.endpoint?.httpBaseUrl,
    localKernel?.sessionToken,
    localKernel?.state,
  ]);

  const loadNodes = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setLoading(true);
    }
    setError(null);

    try {
      const response = await computeApi.getNodes();
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || t('input.computeResource.loadFailed'));
      }

      const nextNodes = Array.isArray(data?.nodes) ? data.nodes : [];
      const nextActiveNodeId = nextNodes.some((node: ComputeNode) => node.id === data?.activeNodeId)
        ? data.activeNodeId
        : null;
      setNodes(nextNodes);
      setActiveNodeId(nextActiveNodeId);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t('input.computeResource.loadFailed'));
      setNodes([]);
      setActiveNodeId(null);
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, [computeApi, t]);

  useEffect(() => {
    void loadNodes();
  }, [loadNodes]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  const handleToggle = () => {
    setOpen((previous) => {
      const next = !previous;
      if (next) {
        void loadNodes({ silent: true });
      }
      return next;
    });
  };

  const handleSelect = async (resourceId: string) => {
    const nextNodeId = resourceId === LOCAL_RESOURCE_ID ? null : resourceId;
    if (nextNodeId === activeNodeId) {
      setOpen(false);
      return;
    }

    setSelectingId(resourceId);
    setError(null);
    try {
      const response = await computeApi.setActive(nextNodeId);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || t('input.computeResource.selectFailed'));
      }
      setActiveNodeId(nextNodeId);
      setOpen(false);
    } catch (selectError) {
      setError(selectError instanceof Error ? selectError.message : t('input.computeResource.selectFailed'));
    } finally {
      setSelectingId(null);
    }
  };

  const activeNode = nodes.find((node) => node.id === activeNodeId) || null;
  const activeLabel = activeNode?.name || activeNode?.host || t('input.computeResource.local');
  const ActiveIcon = activeNode ? Server : Laptop;

  return (
    <div
      ref={containerRef}
      className={cn('relative', isRail ? 'shrink-0' : 'min-w-0')}
      data-compute-rail={isRail ? 'true' : undefined}
    >
      <button
        type="button"
        onClick={handleToggle}
        className={isRail
          ? cn(
            'relative mt-1 flex h-10 w-10 items-center justify-center rounded-xl text-muted-foreground transition-colors',
            'hover:bg-accent/80 hover:text-foreground',
            open && 'bg-primary/12 text-primary shadow-sm',
          )
          : cn(
            'flex h-7 items-center justify-center rounded-lg border border-border/60 bg-background text-[11px] font-medium text-foreground shadow-sm transition-colors hover:bg-muted/60 focus:outline-none focus:ring-1 focus:ring-primary/30',
            activeNode ? 'max-w-[150px] gap-1.5 px-2' : 'w-7',
          )}
        aria-label={t('input.computeResource.label', { name: activeLabel })}
        aria-expanded={open}
        aria-haspopup="menu"
        title={t('input.computeResource.label', { name: activeLabel })}
      >
        {loading ? (
          <Loader2 className={cn('shrink-0 animate-spin', isRail ? 'h-[1.125rem] w-[1.125rem]' : 'h-3.5 w-3.5 text-muted-foreground')} />
        ) : (
          <ActiveIcon
            className={cn(
              'shrink-0',
              isRail ? 'h-[1.125rem] w-[1.125rem]' : activeNode ? 'h-3.5 w-3.5 text-muted-foreground' : 'h-[18px] w-[18px] text-muted-foreground',
            )}
            strokeWidth={isRail ? 1.9 : undefined}
          />
        )}
        {!isRail && activeNode && <span className="truncate">{activeLabel}</span>}
        {!isRail && activeNode && (
          <ChevronDown className={`h-3 w-3 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
        )}
      </button>

      {open && (
        <div
          role="menu"
          className={cn(
            'absolute z-50 w-64 overflow-hidden rounded-xl border border-border bg-popover shadow-xl',
            isRail ? 'right-full top-0 mr-1.5' : 'bottom-full right-0 mb-1',
          )}
        >
          <div className="border-b border-border/60 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            {t('input.computeResource.menuTitle')}
          </div>

          <button
            type="button"
            role="menuitemradio"
            aria-checked={!activeNodeId}
            disabled={selectingId !== null}
            onClick={() => void handleSelect(LOCAL_RESOURCE_ID)}
            className={`flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs transition-colors ${
              !activeNodeId ? 'bg-primary/8 font-medium text-foreground' : 'text-muted-foreground hover:bg-muted/50'
            }`}
          >
            <Laptop className="h-3.5 w-3.5 shrink-0" />
            <span className="flex-1 truncate">{t('input.computeResource.local')}</span>
            {selectingId === LOCAL_RESOURCE_ID
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : !activeNodeId && <Check className="h-3 w-3 text-primary" />}
          </button>

          {nodes.map((node) => {
            const active = node.id === activeNodeId;
            return (
              <button
                key={node.id}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                disabled={selectingId !== null}
                onClick={() => void handleSelect(node.id)}
                className={`flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs transition-colors ${
                  active ? 'bg-primary/8 font-medium text-foreground' : 'text-muted-foreground hover:bg-muted/50'
                }`}
              >
                <Server className="h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{node.name || node.host}</span>
                  <span className="block truncate text-[10px] opacity-70">
                    {node.type === 'slurm' ? t('input.computeResource.slurm') : t('input.computeResource.remote')}
                    {node.host ? ` · ${node.host}` : ''}
                  </span>
                </span>
                {selectingId === node.id
                  ? <Loader2 className="h-3 w-3 animate-spin" />
                  : active && <Check className="h-3 w-3 text-primary" />}
              </button>
            );
          })}

          {nodes.length === 0 && !loading && (
            <div className="border-t border-border/60 px-3 py-2 text-[10px] leading-4 text-muted-foreground">
              {t('input.computeResource.noRemoteNodes')}
            </div>
          )}

          {error && (
            <div className="border-t border-destructive/20 bg-destructive/5 px-3 py-2 text-[10px] leading-4 text-destructive">
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ComputeNodeSelector({
  variant = 'composer',
}: {
  variant?: ComputeNodeSelectorVariant;
} = {}) {
  const { can } = useEntitlements();

  if (!can(CAPABILITIES.computeResources)) {
    return null;
  }

  return <ComputeNodeSelectorContent variant={variant} />;
}
