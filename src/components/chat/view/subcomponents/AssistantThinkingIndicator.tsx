import { SessionProvider } from '../../../../types/app';
import { useTranslation } from 'react-i18next';
import { useEffect, useRef, useState } from 'react';
import { formatDurationSeconds, getProviderDisplayName } from '../../utils/chatFormatting';
import { resolveChatStatusText } from '../../utils/statusText';
import type { ChatStatus } from '../../types/types';

type AssistantThinkingIndicatorProps = {
  selectedProvider: SessionProvider;
  status?: ChatStatus | null;
}

export default function AssistantThinkingIndicator({ selectedProvider, status }: AssistantThinkingIndicatorProps) {
  const { t } = useTranslation('chat');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const startTimeRef = useRef<number | null>(null);
  const displayStatusText = resolveChatStatusText(status?.text, t, 'status.processing');
  const isStoppedStatus = /(?:stop|stopped|abort|aborted|interrupt|interrupted|停止|已停止|暂停|已暂停)/i.test(
    `${status?.text || ''} ${displayStatusText}`,
  );

  useEffect(() => {
    if (typeof status?.startTime === 'number') {
      startTimeRef.current = status.startTime;
    }

    if (!startTimeRef.current) {
      setElapsedSeconds(0);
      return;
    }

    const startTime = startTimeRef.current;
    const updateElapsed = () => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startTime) / 1000)));
    };

    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [status?.startTime]);

  return (
    <div className="chat-message assistant flex flex-col w-full px-4 sm:px-6">
      <div className="flex flex-col w-full mb-6">
        <div className="flex items-center space-x-2 mb-2">
          <div className="text-xs font-semibold text-gray-900 dark:text-white">
            {getProviderDisplayName(selectedProvider)}
          </div>
        </div>
        <div className="w-full text-sm text-gray-500 dark:text-gray-400">
          <div className="inline-flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/45" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
            </span>
            <span className={`text-xs font-semibold ${isStoppedStatus ? 'text-muted-foreground' : 'text-red-600 dark:text-red-400'}`}>
              {displayStatusText}
            </span>
            {startTimeRef.current !== null && (
              <>
                <span className="h-3 w-px bg-border" />
                <span className="font-mono text-[11px] tabular-nums text-muted-foreground/80">
                  {formatDurationSeconds(elapsedSeconds)}
                </span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
