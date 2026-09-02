export type PetState = 'idle' | 'running' | 'waiting' | 'review' | 'jumping' | 'failed' | 'waving';

export const PET_STATE_ROWS: Record<PetState, number> = {
  idle: 0,
  waving: 3,
  jumping: 4,
  failed: 5,
  waiting: 6,
  running: 7,
  review: 8,
};

export const DEFAULT_PET_FRAME_COUNTS: Record<string, number> = {
  idle: 7,
  waving: 4,
  jumping: 5,
  failed: 8,
  waiting: 6,
  running: 6,
  review: 6,
};

export const PET_STATE_LABELS: Record<PetState, string> = {
  idle: '陪着你',
  running: '正在工作',
  waiting: '需要你',
  review: '正在审阅',
  jumping: '完成啦',
  failed: '遇到问题',
  waving: '嗨！',
};

const PROGRESS_TYPES = new Set([
  'session-created',
  'claude-response',
  'codex-response',
  'localgpu-response',
  'pi-response',
]);

const COMPLETE_TYPES = new Set([
  'claude-complete',
  'codex-complete',
  'localgpu-complete',
  'pi-complete',
]);

export function petStateFromRealtimeMessage(message: unknown): PetState | null {
  if (!message || typeof message !== 'object') return null;
  const payload = message as Record<string, unknown>;
  const type = typeof payload.type === 'string' ? payload.type.toLowerCase() : '';
  if (!type) return null;

  if (type === 'active-sessions') {
    if (!Array.isArray(payload.sessions) || payload.sessions.length === 0) return 'idle';
    const statuses = payload.sessions.map((session) => String((session as Record<string, unknown>)?.status || '').toLowerCase());
    if (statuses.some((status) => status.includes('waiting') || status === 'blocked')) return 'waiting';
    if (statuses.some((status) => status.includes('review'))) return 'review';
    if (statuses.some((status) => status === 'failed')) return 'failed';
    return 'running';
  }
  if (type === 'session-status') return payload.isProcessing === true ? 'running' : 'jumping';
  if (COMPLETE_TYPES.has(type)) return 'jumping';
  if (PROGRESS_TYPES.has(type)) return 'running';
  if (type.includes('permission') || type.includes('approval') || type.includes('ask-user') || type.includes('waiting')) {
    return 'waiting';
  }
  if (type.includes('review')) return 'review';
  if (type.includes('error') || type.includes('failed') || type === 'session-aborted') return 'failed';
  return null;
}

export function spriteBackgroundPosition(row: number, column: number) {
  const safeRow = Math.max(0, Math.min(10, Math.round(row)));
  const safeColumn = Math.max(0, Math.min(7, Math.round(column)));
  return `${(safeColumn * 100) / 7}% ${(safeRow * 100) / 10}%`;
}
