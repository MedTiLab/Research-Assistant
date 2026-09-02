import { Link2Off, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useOptionalLocalKernel } from '../../state/localKernelStore';

export default function LocalKernelStatusBar() {
  const { t } = useTranslation('common');
  const localKernel = useOptionalLocalKernel();

  if (!localKernel?.isRequired || localKernel.state !== 'connected') {
    return null;
  }

  const { health, status, disconnect } = localKernel;
  return (
      <div className="flex h-9 flex-shrink-0 items-center justify-between gap-3 border-b border-border/70 bg-background px-3 text-xs text-muted-foreground">
        <div className="flex min-w-0 items-center gap-2">
          <ShieldCheck className="h-4 w-4 flex-shrink-0 text-primary" />
          <span className="truncate font-medium text-foreground">
            {t('localKernel.status.connected')}
          </span>
          <span className="hidden min-w-0 truncate sm:inline">{t('localKernel.productName')}</span>
          {health?.version && <span className="hidden sm:inline">v{health.version}</span>}
          <span className="hidden rounded-sm border border-border px-1.5 py-0.5 sm:inline">
            {status?.permissionMode || 'analysis'}
          </span>
        </div>
        <button
          type="button"
          className="inline-flex h-7 flex-shrink-0 items-center gap-1.5 rounded-md border border-border bg-background px-2 font-medium text-foreground hover:bg-muted"
          onClick={disconnect}
        >
          <Link2Off className="h-3.5 w-3.5" />
          <span>{t('localKernel.actions.disconnect')}</span>
        </button>
      </div>
  );
}
