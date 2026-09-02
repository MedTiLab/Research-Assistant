import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Cpu } from 'lucide-react';

import { formatCompactModelName } from './CustomModelInput';

interface ModelSelectorProps {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}

export default function ModelSelector({
  value,
  options,
  onChange,
}: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const displayLabel = options.find((option) => option.value === value)?.label || value;
  const compactLabel = formatCompactModelName(displayLabel);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    if (open) {
      document.addEventListener('mousedown', handlePointerDown);
    }

    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        className="flex h-7 max-w-[12.5rem] items-center gap-1.5 rounded-lg border border-border/60 bg-white px-2 text-[11px] font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 focus:outline-none focus:ring-1 focus:ring-primary/30"
        aria-label={displayLabel}
        title={displayLabel}
      >
        <Cpu className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        {compactLabel && <span className="min-w-0 truncate">{compactLabel}</span>}
        <ChevronDown className={`h-3 w-3 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-1 max-h-[240px] w-72 overflow-y-auto rounded-xl border border-border bg-popover shadow-xl">
          {options.map((option) => {
            const active = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] transition-colors ${
                  active
                    ? 'bg-primary/8 font-medium text-foreground'
                    : 'text-muted-foreground hover:bg-muted/50'
                }`}
              >
                <span className="flex-1 truncate" title={option.label}>{option.label}</span>
                {active && <Check className="h-3 w-3 shrink-0 text-primary" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
