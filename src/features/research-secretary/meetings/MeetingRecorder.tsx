import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CirclePause, CirclePlay, Loader2, Mic, Square } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import type { ResearchSecretaryApi } from '../services/researchSecretaryApi';

const CONSENT_KEY = 'research-secretary:openai-transcription-consent';
const SEGMENT_DURATION_MS = 30_000;
const SEGMENT_START_INTERVAL_MS = 25_000;

type RecorderState = 'idle' | 'starting' | 'recording' | 'paused' | 'stopping';

export default function MeetingRecorder({
  meetingId,
  api,
  onChanged,
}: {
  meetingId: string;
  api: ResearchSecretaryApi;
  onChanged: () => Promise<unknown>;
}) {
  const { t } = useTranslation('workbench');
  const [state, setState] = useState<RecorderState>('idle');
  const [error, setError] = useState<string | null>(null);
  const stateRef = useRef<RecorderState>('idle');
  const streamRef = useRef<MediaStream | null>(null);
  const activeRecordersRef = useRef(new Set<MediaRecorder>());
  const segmentTimerRef = useRef<number | null>(null);
  const segmentStopTimersRef = useRef(new Map<MediaRecorder, number>());
  const segmentJobsRef = useRef<Promise<void>[]>([]);
  const segmentIndexRef = useRef(0);
  const startedAtRef = useRef(0);
  const pausedAtRef = useRef(0);
  const totalPausedMsRef = useRef(0);
  const mimeTypeRef = useRef('audio/webm');
  const finalizingRef = useRef(false);

  const updateState = (next: RecorderState) => {
    stateRef.current = next;
    setState(next);
  };

  const activeElapsedMs = () => {
    const currentPauseMs = stateRef.current === 'paused'
      ? performance.now() - pausedAtRef.current
      : 0;
    return Math.max(0, Math.round(
      performance.now() - startedAtRef.current - totalPausedMsRef.current - currentPauseMs,
    ));
  };

  const clearSegmentInterval = () => {
    if (segmentTimerRef.current !== null) {
      window.clearInterval(segmentTimerRef.current);
      segmentTimerRef.current = null;
    }
  };

  const releaseStream = () => {
    clearSegmentInterval();
    segmentStopTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    segmentStopTimersRef.current.clear();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    activeRecordersRef.current.clear();
  };

  const beginSegment = () => {
    const stream = streamRef.current;
    if (!stream || stateRef.current !== 'recording') return;
    const recorder = new MediaRecorder(stream, { mimeType: mimeTypeRef.current });
    const chunks: Blob[] = [];
    const segmentIndex = segmentIndexRef.current++;
    const startMs = activeElapsedMs();
    let resolveJob = () => {};
    const job = new Promise<void>((resolve) => { resolveJob = resolve; });
    segmentJobsRef.current.push(job);
    activeRecordersRef.current.add(recorder);

    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size) chunks.push(event.data);
    });
    recorder.addEventListener('error', () => {
      setError(t('recorder.chunkFailed', { index: segmentIndex + 1 }));
    });
    recorder.addEventListener('stop', () => {
      const stopTimer = segmentStopTimersRef.current.get(recorder);
      if (stopTimer !== undefined) window.clearTimeout(stopTimer);
      segmentStopTimersRef.current.delete(recorder);
      activeRecordersRef.current.delete(recorder);
      const endMs = Math.max(startMs + 1, activeElapsedMs());
      const audio = new Blob(chunks, { type: mimeTypeRef.current });
      if (!audio.size) {
        resolveJob();
        return;
      }
      void api.uploadRecordingChunk(meetingId, {
        audio,
        segmentIndex,
        startMs,
        endMs,
        language: 'zh',
      }).then(async () => {
        await onChanged();
      }).catch((uploadError) => {
        setError(uploadError instanceof Error ? uploadError.message : t('recorder.uploadFailed'));
      }).finally(resolveJob);
    });
    recorder.start();
    const stopTimer = window.setTimeout(() => {
      if (recorder.state !== 'inactive') recorder.stop();
    }, SEGMENT_DURATION_MS);
    segmentStopTimersRef.current.set(recorder, stopTimer);
  };

  const scheduleSegments = () => {
    clearSegmentInterval();
    beginSegment();
    segmentTimerRef.current = window.setInterval(beginSegment, SEGMENT_START_INTERVAL_MS);
  };

  const stopActiveSegments = () => {
    activeRecordersRef.current.forEach((recorder) => {
      if (recorder.state !== 'inactive') recorder.stop();
    });
  };

  const finalizeRecording = async () => {
    if (finalizingRef.current) return;
    finalizingRef.current = true;
    if (stateRef.current === 'paused') {
      totalPausedMsRef.current += performance.now() - pausedAtRef.current;
    }
    updateState('stopping');
    clearSegmentInterval();
    stopActiveSegments();
    try {
      await Promise.allSettled(segmentJobsRef.current);
      await api.stopRecording(meetingId);
      await onChanged();
    } catch (stopError) {
      setError(stopError instanceof Error ? stopError.message : t('recorder.stopFailed'));
    } finally {
      releaseStream();
      finalizingRef.current = false;
      updateState('idle');
    }
  };

  useEffect(() => () => {
    clearSegmentInterval();
    stopActiveSegments();
    releaseStream();
  }, []);

  useEffect(() => {
    if (state !== 'recording' && state !== 'paused') return undefined;
    const timer = window.setInterval(() => { void onChanged(); }, 3000);
    return () => window.clearInterval(timer);
  }, [onChanged, state]);

  const start = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError(t('recorder.unsupported'));
      return;
    }
    let consented = window.localStorage.getItem(CONSENT_KEY) === 'accepted';
    if (!consented) {
      consented = window.confirm(t('recorder.consent'));
      if (!consented) return;
      window.localStorage.setItem(CONSENT_KEY, 'accepted');
    }
    updateState('starting');
    setError(null);
    let serverRecordingStarted = false;
    try {
      await api.startRecording(meetingId, { provider: 'openai', language: 'zh', privacyConsent: true });
      serverRecordingStarted = true;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mimeTypeRef.current = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      streamRef.current = stream;
      segmentIndexRef.current = 0;
      totalPausedMsRef.current = 0;
      pausedAtRef.current = 0;
      segmentJobsRef.current = [];
      startedAtRef.current = performance.now();
      updateState('recording');
      scheduleSegments();
    } catch (startError) {
      releaseStream();
      if (serverRecordingStarted) void api.stopRecording(meetingId).catch(() => undefined);
      setError(startError instanceof Error ? startError.message : t('recorder.startFailed'));
      updateState('idle');
    }
  };

  const togglePause = () => {
    if (stateRef.current === 'recording') {
      pausedAtRef.current = performance.now();
      updateState('paused');
      clearSegmentInterval();
      stopActiveSegments();
      return;
    }
    if (stateRef.current === 'paused') {
      totalPausedMsRef.current += performance.now() - pausedAtRef.current;
      pausedAtRef.current = 0;
      updateState('recording');
      scheduleSegments();
    }
  };

  return <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><div className="text-sm font-medium text-foreground">{t('recorder.title')}</div><div className="mt-1 text-xs text-muted-foreground">{t('recorder.hint')}</div></div>
      <div className="flex gap-2">
        {state === 'idle' ? <Button size="sm" onClick={() => void start()}><Mic className="h-4 w-4" />{t('recorder.start')}</Button> : <>
          <Button size="sm" variant="outline" disabled={state === 'starting' || state === 'stopping'} onClick={togglePause}>{state === 'paused' ? <CirclePlay className="h-4 w-4" /> : <CirclePause className="h-4 w-4" />}{state === 'paused' ? t('recorder.resume') : t('recorder.pause')}</Button>
          <Button size="sm" variant="destructive" disabled={state === 'starting' || state === 'stopping'} onClick={() => void finalizeRecording()}>{state === 'stopping' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}{t('recorder.stop')}</Button>
        </>}
      </div>
    </div>
    {error && <div className="mt-3 text-xs text-red-600 dark:text-red-300">{error}</div>}
  </div>;
}
