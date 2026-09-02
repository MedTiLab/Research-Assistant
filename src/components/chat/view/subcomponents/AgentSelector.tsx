import React, { useState } from 'react';

import SessionProviderLogo from '../../../SessionProviderLogo';
import type { ProviderAvailability } from '../../types/types';
import type { SessionProvider } from '../../../../types/app';

export type ProviderDef = {
  id: SessionProvider;
  name: string;
  accent: string;
  ring: string;
  check: string;
};

interface AgentSelectorProps {
  providers: ProviderDef[];
  activeProvider: SessionProvider;
  providerAvailability: Partial<Record<SessionProvider, ProviderAvailability>>;
  onSelect: (id: SessionProvider) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}

export default function AgentSelector({
  providers,
  activeProvider,
  providerAvailability,
  onSelect,
  t: _t,
}: AgentSelectorProps) {
  const [open, setOpen] = useState(false);
  const activeProviderDef = providers.find((provider) => provider.id === activeProvider);
  const canOpen = providers.length > 1;

  if (!canOpen) {
    return null;
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        disabled={!canOpen}
        className="flex h-7 w-7 items-center justify-center rounded-lg border border-border/60 bg-white text-slate-700 shadow-sm transition-colors hover:bg-slate-50 focus:outline-none focus:ring-1 focus:ring-primary/30"
        aria-label={activeProviderDef?.name || activeProvider}
        title={activeProviderDef?.name || activeProvider}
      >
        <SessionProviderLogo provider={activeProvider} className="w-3.5 h-3.5 shrink-0" />
      </button>
      {open && (
        <div
          className="absolute bottom-full left-0 z-50 mb-2 min-w-48 overflow-hidden rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-xl"
          onMouseLeave={() => setOpen(false)}
        >
          {providers.map((provider) => {
            const availability = providerAvailability[provider.id];
            const planLocked = availability?.planLocked === true;
            const cliUnavailable = availability?.cliAvailable === false;
            const piNotConfigured = provider.id === 'pi' && availability?.configured === false;
            const disabled = planLocked || cliUnavailable;
            const reason = planLocked
              ? (availability?.disabledReason || _t('providerSelection.proOnly'))
              : cliUnavailable
                ? (availability?.installHint || _t('providerSelection.notInstalled'))
                : null;

            return (
              <button
                key={provider.id}
                type="button"
                disabled={disabled}
                onClick={() => {
                  onSelect(provider.id);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
                  disabled
                    ? 'cursor-not-allowed text-muted-foreground/45 grayscale'
                    : provider.id === activeProvider
                      ? 'bg-primary/10 text-foreground'
                      : 'text-foreground hover:bg-muted'
                }`}
                title={reason || provider.name}
              >
                <SessionProviderLogo provider={provider.id} className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{provider.name}</span>
                {planLocked && (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    PRO
                  </span>
                )}
                {!planLocked && cliUnavailable && (
                  <span className="text-[10px] text-muted-foreground">
                    {_t(piNotConfigured ? 'providerSelection.piNotConfigured' : 'providerSelection.notInstalled')}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
