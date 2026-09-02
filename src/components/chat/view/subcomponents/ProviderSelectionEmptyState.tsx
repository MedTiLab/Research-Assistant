import React from 'react';
import { useTranslation } from 'react-i18next';

import type { ProjectSession } from '../../../../types/app';

interface ProviderSelectionEmptyStateProps {
  selectedSession: ProjectSession | null;
  currentSessionId: string | null;
  hasConnectedProjectFolder?: boolean;
}

export default function ProviderSelectionEmptyState({
  selectedSession,
  currentSessionId,
  hasConnectedProjectFolder = false,
}: ProviderSelectionEmptyStateProps) {
  const { t } = useTranslation('chat');

  if (!selectedSession && !currentSessionId) {
    return (
      <div className="w-full max-w-3xl mx-auto px-4 pt-4 pb-4">
        <div className="text-center">
          <p
            className="text-base sm:text-lg font-medium text-muted-foreground/70 invisible select-none"
            aria-hidden="true"
          >
            {'\u00A0'}
          </p>
          <h1 className="text-2xl sm:text-4xl font-semibold tracking-tight text-foreground">
            {t(hasConnectedProjectFolder ? 'guidedStarter.connectedProjectTitle' : 'guidedStarter.title')}
          </h1>
        </div>
      </div>
    );
  }

  if (selectedSession) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center px-6 max-w-2xl">
          <div className="max-w-md mx-auto">
            <p className="text-lg font-semibold text-foreground mb-1.5">{t('session.continue.title')}</p>
            <p className="text-sm text-muted-foreground leading-relaxed">{t('session.continue.description')}</p>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
