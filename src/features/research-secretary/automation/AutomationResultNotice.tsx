import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bell, X } from 'lucide-react';
import { AUTOMATION_RESULTS_UPDATED_EVENT, automationRequestJson, markAutomationRunRead, type AutomationNotice, type AutomationResultTarget } from '../services/automationsApi';

export default function AutomationResultNotice({ onOpenResult, onRunsChanged }: {
  onOpenResult: (target: AutomationResultTarget) => void;
  onRunsChanged: () => void;
}) {
  const { t } = useTranslation('workbench');
  const [items, setItems] = useState<AutomationNotice[]>([]);
  const changed = useRef(onRunsChanged);
  changed.current = onRunsChanged;
  useEffect(() => {
    let active = true;
    let pending = false;
    let signature = '';
    const load = async () => {
      if (pending) return;
      pending = true;
      try {
        const next = await automationRequestJson<AutomationNotice[]>('/api/agent-services/automations/inbox');
        if (!active) return;
        setItems(next.filter((item) => item.status !== 'running'));
        const nextSignature = JSON.stringify(next.map((item) => [item.projectKey, item.sessionId, item.status]));
        if (nextSignature !== signature) { signature = nextSignature; changed.current(); }
      } catch { /* Retain unread notifications through temporary disconnects. */ }
      finally { pending = false; }
    };
    void load();
    const timer = window.setInterval(() => void load(), 10000);
    const refresh = () => { void load(); };
    window.addEventListener('focus', refresh);
    window.addEventListener(AUTOMATION_RESULTS_UPDATED_EVENT, refresh);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', refresh); window.removeEventListener(AUTOMATION_RESULTS_UPDATED_EVENT, refresh); };
  }, []);
  const item = items[0];
  if (!item) return null;
  return <aside role="status" aria-live="polite" className="fixed bottom-5 right-5 z-[90] w-[min(24rem,calc(100vw-2.5rem))] rounded-2xl border border-primary/25 bg-card p-4 shadow-xl">
    <div className="flex items-start gap-3"><Bell className="mt-0.5 h-5 w-5 shrink-0 text-primary" /><div className="min-w-0 flex-1"><p className="text-sm font-semibold">{t('automation.unreadResults', { count: items.length })}</p><p className="mt-1 break-words text-sm">{item.title}</p><p className="mt-1 text-xs text-muted-foreground">{t(`automation.runStatus.${item.status}`, { defaultValue: item.status })} · {new Date(item.startedAt).toLocaleString()}</p></div><button type="button" aria-label={t('automation.dismissResult')} onClick={() => void markAutomationRunRead(item).then(() => setItems((current) => current.filter((entry) => entry.sessionId !== item.sessionId || entry.projectKey !== item.projectKey))).catch(() => undefined)} className="rounded-lg p-1 hover:bg-muted"><X className="h-4 w-4" /></button></div>
    <button type="button" onClick={() => onOpenResult(item)} className="mt-3 w-full rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground">{t('automation.viewResult')}</button>
  </aside>;
}
