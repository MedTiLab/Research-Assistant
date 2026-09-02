import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { CompanionAvatar } from './types';
import {
  DEFAULT_PET_FRAME_COUNTS,
  PET_STATE_ROWS,
  spriteBackgroundPosition,
  type PetState,
} from './petRuntime';

const PALETTES: Record<CompanionAvatar, { body: string; shade: string; accent: string; ink: string }> = {
  mochi: { body: '#ffd7cc', shade: '#f4a896', accent: '#fff4e8', ink: '#62443e' },
  ink: { body: '#b9c8ff', shade: '#7d92df', accent: '#eef2ff', ink: '#33406d' },
  roux: { body: '#efbf72', shade: '#c98545', accent: '#fff0ce', ink: '#5b402c' },
  pixel: { body: '#9de5cc', shade: '#50b89c', accent: '#e8fff7', ink: '#285b52' },
  bolt: { body: '#f7dc65', shade: '#d0a928', accent: '#fff8be', ink: '#5c4d22' },
  boo: { body: '#d4b7fb', shade: '#9e70dc', accent: '#f5ecff', ink: '#533d6e' },
};

function BuiltInPet({ avatar, state }: { avatar: CompanionAvatar; state: PetState }) {
  const palette = PALETTES[avatar] || PALETTES.mochi;
  const style = {
    '--pet-body': palette.body,
    '--pet-shade': palette.shade,
    '--pet-accent': palette.accent,
    '--pet-ink': palette.ink,
  } as CSSProperties;

  return (
    <span className="companion-builtin-pet" data-state={state} style={style} aria-hidden="true">
      <svg viewBox="0 0 160 172" role="img">
        <ellipse className="pet-shadow" cx="80" cy="157" rx="45" ry="9" />
        <g className="pet-tail"><path d="M125 118c29 1 29-31 12-34-14-3-16 12-7 16" fill="none" stroke="var(--pet-shade)" strokeWidth="14" strokeLinecap="round" /></g>
        <g className="pet-body">
          <path className="pet-ear pet-ear-left" d="M42 48 35 11c-1-6 6-9 10-5l24 25Z" fill="var(--pet-body)" stroke="var(--pet-ink)" strokeWidth="4" strokeLinejoin="round" />
          <path className="pet-ear pet-ear-right" d="m91 31 25-25c4-4 11-1 10 5l-7 38Z" fill="var(--pet-body)" stroke="var(--pet-ink)" strokeWidth="4" strokeLinejoin="round" />
          <path d="M46 28 40 15l17 18Z" fill="var(--pet-shade)" opacity=".7" />
          <path d="m109 32 15-17-4 23Z" fill="var(--pet-shade)" opacity=".7" />
          <rect x="30" y="27" width="100" height="118" rx="46" fill="var(--pet-body)" stroke="var(--pet-ink)" strokeWidth="4" />
          <ellipse cx="80" cy="118" rx="33" ry="24" fill="var(--pet-accent)" opacity=".72" />
          <g className="pet-arm pet-arm-left"><path d="M39 94c-21 6-20 33-4 37" fill="none" stroke="var(--pet-body)" strokeWidth="16" strokeLinecap="round" /><path d="M39 94c-21 6-20 33-4 37" fill="none" stroke="var(--pet-ink)" strokeWidth="4" strokeLinecap="round" /></g>
          <g className="pet-arm pet-arm-right"><path d="M122 95c20 8 18 31 4 36" fill="none" stroke="var(--pet-body)" strokeWidth="16" strokeLinecap="round" /><path d="M122 95c20 8 18 31 4 36" fill="none" stroke="var(--pet-ink)" strokeWidth="4" strokeLinecap="round" /></g>
          <g className="pet-face">
            <ellipse className="pet-eye pet-eye-left" cx="61" cy="68" rx="5" ry="8" fill="var(--pet-ink)" />
            <ellipse className="pet-eye pet-eye-right" cx="99" cy="68" rx="5" ry="8" fill="var(--pet-ink)" />
            <circle cx="48" cy="84" r="6" fill="var(--pet-shade)" opacity=".45" />
            <circle cx="112" cy="84" r="6" fill="var(--pet-shade)" opacity=".45" />
            <path className="pet-mouth" d="M72 84c5 6 11 6 16 0" fill="none" stroke="var(--pet-ink)" strokeWidth="4" strokeLinecap="round" />
          </g>
          <path className="pet-foot pet-foot-left" d="M47 139q14 15 27 0" fill="var(--pet-shade)" stroke="var(--pet-ink)" strokeWidth="4" strokeLinejoin="round" />
          <path className="pet-foot pet-foot-right" d="M86 139q13 15 27 0" fill="var(--pet-shade)" stroke="var(--pet-ink)" strokeWidth="4" strokeLinejoin="round" />
        </g>
        <g className="pet-sparkles" fill="var(--pet-shade)"><path d="m21 49 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z" /><path d="m139 48 2 5 5 2-5 2-2 5-2-5-5-2 5-2Z" /></g>
      </svg>
    </span>
  );
}

export default function DesktopPet({
  avatar,
  state,
  asset,
}: {
  avatar: CompanionAvatar;
  state: PetState;
  asset?: CodexPetAsset | null;
}) {
  const spriteRef = useRef<HTMLSpanElement>(null);
  const [frame, setFrame] = useState(0);
  const [look, setLook] = useState<{ row: number; column: number } | null>(null);
  const reducedMotion = useMemo(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false, []);

  useEffect(() => {
    setFrame(0);
    setLook(null);
    if (!asset || reducedMotion) return undefined;
    const count = Math.max(1, Math.min(8, Number(asset.frameCounts?.[state] ?? DEFAULT_PET_FRAME_COUNTS[state] ?? 1)));
    const timer = window.setInterval(() => setFrame((value) => (value + 1) % count), state === 'idle' ? 170 : 125);
    return () => window.clearInterval(timer);
  }, [asset, reducedMotion, state]);

  useEffect(() => {
    if (!asset || state !== 'idle' || reducedMotion) return undefined;
    let resetTimer = 0;
    const onPointerMove = (event: PointerEvent) => {
      const rect = spriteRef.current?.getBoundingClientRect();
      if (!rect) return;
      const dx = event.clientX - (rect.left + rect.width / 2);
      const dy = event.clientY - (rect.top + rect.height / 2);
      const distance = Math.hypot(dx, dy);
      if (distance < 28 || distance > 240) return;
      const degrees = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
      const direction = Math.round(degrees / 22.5) % 16;
      setLook({ row: direction < 8 ? 9 : 10, column: direction % 8 });
      window.clearTimeout(resetTimer);
      resetTimer = window.setTimeout(() => setLook(null), 850);
    };
    document.addEventListener('pointermove', onPointerMove, { passive: true });
    return () => {
      document.removeEventListener('pointermove', onPointerMove);
      window.clearTimeout(resetTimer);
    };
  }, [asset, reducedMotion, state]);

  if (!asset) return <BuiltInPet avatar={avatar} state={state} />;
  const position = look
    ? spriteBackgroundPosition(look.row, look.column)
    : spriteBackgroundPosition(PET_STATE_ROWS[state], frame);
  return (
    <span
      ref={spriteRef}
      className="companion-codex-pet-sprite"
      style={{ backgroundImage: `url(${JSON.stringify(asset.spritesheetDataUrl)})`, backgroundPosition: position }}
      aria-hidden="true"
    />
  );
}
