import { useCallback, useEffect, useState } from 'react';
import { api } from '../../utils/api';
import type { SessionAgentState } from '../chat/utils/sessionContextSummary';

export const AGENT_WORK_CHANGED = 'medhelp-agent-work-changed';
export const PI_SESSION_STATE = 'medhelp-pi-session-state';

export function usePiSessionState(projectName: string, sessionId: string | null, enabled = true) {
  const [snapshot, setSnapshot] = useState<{ key: string; state: SessionAgentState } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [revision, setRevision] = useState(0);
  const key = JSON.stringify([projectName, sessionId]);
  const canLoad = enabled && Boolean(projectName && sessionId && !/^(new-session-|temp-)/.test(sessionId));
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    if (!canLoad || !sessionId) return;
    let cancelled = false;
    let loading = false;
    let debounce: number | undefined;
    let request: AbortController | undefined;
    setFailure(null);
    const load = async () => {
      if (loading) return;
      loading = true;
      request = new AbortController();
      const timeout = window.setTimeout(() => request?.abort(), 15000);
      try {
        const response = await api.piSessionState(projectName, sessionId, { signal: request.signal });
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          const reason = body?.code === 'PI_PROJECT_UNAVAILABLE' ? '项目目录不可用，请检查项目路径'
            : body?.code === 'PI_SESSION_NOT_FOUND' ? '未找到当前 Pi 会话，请重新打开会话'
            : response.status === 401 ? '登录已失效，请重新登录'
            : response.status === 403 ? '无权读取当前会话进度'
            : response.status === 404 ? '进度接口未找到，请确认前端与内核已同步更新'
            : `进度请求失败（HTTP ${response.status}）`;
          throw new Error(reason);
        }
        const state = await response.json();
        if (!cancelled) {
          setSnapshot({ key, state });
          setFailure(null);
          window.dispatchEvent(new CustomEvent(PI_SESSION_STATE, { detail: { projectName, sessionId, state } }));
        }
      } catch (cause) {
        if (!cancelled) setFailure({ key, message: request.signal.aborted ? '进度请求超时，请重试' : cause instanceof Error ? cause.message : 'Failed to load task state' });
      } finally { window.clearTimeout(timeout); loading = false; }
    };
    void load();
    const interval = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 5000);
    const invalidate = () => { window.clearTimeout(debounce); debounce = window.setTimeout(() => void load(), 120); };
    window.addEventListener(AGENT_WORK_CHANGED, invalidate);
    return () => { cancelled = true; request?.abort(); window.clearInterval(interval); window.clearTimeout(debounce); window.removeEventListener(AGENT_WORK_CHANGED, invalidate); };
  }, [canLoad, projectName, sessionId, key, revision]);
  return { state: canLoad && snapshot?.key === key ? snapshot.state : null, error: canLoad && failure?.key === key ? failure.message : null, refresh };
}

export function agentStatusLabel(status: string | null | undefined, chinese: boolean) {
  if (!chinese) return status?.replace(/_/g, ' ') || '';
  return ({ queued: '排队中', pending: '待处理', running: '运行中', in_progress: '进行中', waiting_on_user: '等待确认', blocked: '受阻', scheduled: '已计划', completed: '已完成', failed: '失败', cancelled: '已取消', interrupted: '已中断', exited: '已退出', timed_out: '超时', approved: '已批准', draft: '草稿', rejected: '已拒绝' } as Record<string, string>)[status || ''] || status || '';
}
