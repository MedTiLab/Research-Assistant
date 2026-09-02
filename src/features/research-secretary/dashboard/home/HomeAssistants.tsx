import type { ReactNode } from 'react';
import { cn } from '../../../../lib/utils';

export type QuickLink = {
  key: string;
  label: string;
  icon: ReactNode;
  onClick: () => void;
};

export function QuickLinkRow({ links, className }: { links: QuickLink[]; className?: string }) {
  return (
    <div className={cn('flex w-full flex-wrap gap-2', className)}>
      {links.map((link) => (
        <button
          key={link.key}
          type="button"
          onClick={link.onClick}
          className="inline-flex min-w-0 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-border/70 bg-card px-3 py-2 text-sm font-semibold text-foreground shadow-sm transition-colors hover:border-primary/35 hover:text-foreground"
        >
          <span className="text-primary">{link.icon}</span>
          {link.label}
        </button>
      ))}
    </div>
  );
}
