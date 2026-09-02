import type { ReactNode } from 'react';
import { LockKeyhole, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '../../lib/utils';
import { useEntitlements, type Capability } from '../../hooks/useEntitlements';

export type ProFeatureKey =
  | 'computeResources'
  | 'skillCatalog'
  | 'researchTasks'
  | 'literatureMonitor'
  | 'researchPipeline'
  | 'variableCatalog'
  | 'variableDiscovery'
  | 'projectMemory'
  | 'conversationArchive';

type ProFeatureGateProps = {
  capability: Capability;
  feature: ProFeatureKey;
  children: ReactNode;
  className?: string;
  compact?: boolean;
  overlay?: boolean;
};

export default function ProFeatureGate({
  capability,
  feature,
  children,
  className,
  compact = false,
  overlay = false,
}: ProFeatureGateProps) {
  const { t } = useTranslation('common');
  const { can } = useEntitlements();

  if (can(capability)) {
    return children;
  }

  return (
    <div className={cn(
      'flex h-full min-h-0 items-center justify-center p-5',
      overlay ? 'bg-background/20' : 'bg-background',
      className,
    )}>
      <div className={cn(
        'w-full max-w-xl rounded-3xl border border-primary/30 bg-gradient-to-br from-primary/10 via-background to-background text-center shadow-sm',
        compact ? 'px-5 py-7' : 'px-7 py-10 sm:px-10',
      )}>
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15 text-primary">
          <LockKeyhole className="h-5 w-5" />
        </div>
        <div className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-card/80 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-primary">
          <Sparkles className="h-3.5 w-3.5" />
          {t('entitlements.proBadge')}
        </div>
        <h2 className="mt-4 text-lg font-semibold text-foreground">
          {t(`entitlements.features.${feature}.title`)}
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
          {t(`entitlements.features.${feature}.description`)}
        </p>
        <p className="mt-5 text-xs font-medium text-primary">
          {t('entitlements.contactAdmin')}
        </p>
      </div>
    </div>
  );
}
