import { useEffect, useMemo, useRef, useState } from 'react';
import { GripHorizontal } from 'lucide-react';
import { api } from '../../utils/api';
import { useWebSocket } from '../../contexts/WebSocketContext';
import DesktopPet from './DesktopPet';
import { getLocalPetDirectory, petDirectoryStorageKey } from './petPreferences';
import { PET_STATE_LABELS, petStateFromRealtimeMessage, type PetState } from './petRuntime';
import type { Companion } from './types';

export default function DesktopCompanionWindow() {
  const companionId = useMemo(() => new URLSearchParams(window.location.search).get('companionId'), []);
  const [companion, setCompanion] = useState<Companion | null>(null);
  const [petState, setPetState] = useState<PetState>('idle');
  const [petDirectory, setPetDirectory] = useState(() => companionId ? getLocalPetDirectory(companionId) : '');
  const [petAsset, setPetAsset] = useState<CodexPetAsset | null>(null);
  const [petAssetError, setPetAssetError] = useState('');
  const stateTimerRef = useRef<number | null>(null);
  const { latestMessage, isConnected, sendMessage } = useWebSocket();

  useEffect(() => {
    document.documentElement.classList.add('companion-window-root');
    document.body.classList.add('companion-window-body');
    return () => {
      document.documentElement.classList.remove('companion-window-root');
      document.body.classList.remove('companion-window-body');
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void api.companions.list().then(async (response) => {
      if (!response.ok || cancelled) return;
      const payload = await response.json() as { companions?: Companion[] };
      setCompanion((payload.companions || []).find((item) => item.id === companionId) || null);
    });
    return () => { cancelled = true; };
  }, [companionId]);

  useEffect(() => {
    if (!companionId) return undefined;
    const key = petDirectoryStorageKey(companionId);
    const syncDirectory = (event: StorageEvent | Event) => {
      if (event instanceof StorageEvent && event.key !== key) return;
      setPetDirectory(getLocalPetDirectory(companionId));
    };
    window.addEventListener('storage', syncDirectory);
    window.addEventListener('medhelp-pet-directory-changed', syncDirectory);
    return () => {
      window.removeEventListener('storage', syncDirectory);
      window.removeEventListener('medhelp-pet-directory-changed', syncDirectory);
    };
  }, [companionId]);

  useEffect(() => {
    let cancelled = false;
    if (!petDirectory || !window.medhelpDesktop?.loadPetAsset) {
      setPetAsset(null);
      setPetAssetError('');
      return undefined;
    }
    void window.medhelpDesktop.loadPetAsset(petDirectory).then((asset) => {
      if (cancelled) return;
      setPetAsset(asset);
      setPetAssetError('');
    }).catch((error) => {
      if (cancelled) return;
      setPetAsset(null);
      setPetAssetError(error instanceof Error ? error.message : String(error));
    });
    return () => { cancelled = true; };
  }, [petDirectory]);

  useEffect(() => {
    if (isConnected) sendMessage({ type: 'get-active-sessions' });
  }, [isConnected, sendMessage]);

  useEffect(() => {
    const nextState = petStateFromRealtimeMessage(latestMessage);
    if (!nextState) return;
    if (stateTimerRef.current != null) window.clearTimeout(stateTimerRef.current);
    setPetState(nextState);
    if (nextState === 'jumping' || nextState === 'failed') {
      stateTimerRef.current = window.setTimeout(() => setPetState('idle'), nextState === 'failed' ? 1800 : 900);
    }
  }, [latestMessage]);

  useEffect(() => () => {
    if (stateTimerRef.current != null) window.clearTimeout(stateTimerRef.current);
  }, []);

  const interactWithPet = () => {
    if (petState !== 'idle' && petState !== 'waving') {
      void window.medhelpDesktop?.focusMainWindow?.('companions');
      return;
    }
    if (stateTimerRef.current != null) window.clearTimeout(stateTimerRef.current);
    setPetState('waving');
    stateTimerRef.current = window.setTimeout(() => setPetState('idle'), 720);
  };

  if (!companion) return null;
  return (
    <main className="companion-window-stage flex h-screen w-screen select-none flex-col items-center justify-end overflow-hidden bg-transparent pb-4">
      <div className="companion-native-drag companion-drag-handle" title="拖动桌面宠物">
        <GripHorizontal aria-hidden="true" />
      </div>
      <button
        type="button"
        className="companion-native-no-drag companion-pet-button group relative border-0 bg-transparent p-0"
        onClick={interactWithPet}
        onDoubleClick={() => window.medhelpDesktop?.focusMainWindow?.('companions')}
        aria-label={companion.name}
        title={petAssetError || `${companion.name} · 单击互动，双击打开`}
      >
        <div className="companion-pet-bubble">
          {petState === 'idle' ? (companion.mood === 'sleepy' ? '稍微休息一下吧' : '今天也一起加油') : PET_STATE_LABELS[petState]}
        </div>
        <DesktopPet avatar={companion.avatar} state={petState} asset={petAsset} />
        <span className="companion-pet-status-dot" data-state={petState} />
      </button>
      <button
        type="button"
        className="companion-native-no-drag companion-pet-label"
        onClick={() => window.medhelpDesktop?.focusMainWindow?.('companions')}
      >
        <span className="companion-pet-label-dot" data-state={petState} />
        <span>{petState === 'idle' || petState === 'waving' ? companion.name : PET_STATE_LABELS[petState]}</span>
      </button>
    </main>
  );
}
