import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { IS_PLATFORM } from '../constants/config';
import { useOptionalLocalKernel } from '../state/localKernelStore';
import { resolveChatWebSocketConnection } from './webSocketConnection';
import { enqueueRealtimeMessage } from './webSocketMessageQueue';
import {
  createOutboundQueueEntry,
  enqueueOutboundMessage,
  OUTBOUND_QUEUE_DEFAULTS,
  pruneExpiredOutboundMessages,
  type OutboundQueueEntry,
} from './webSocketOutboundQueue';
import { useDesktopRuntime } from './DesktopRuntimeContext';

declare global {
  interface Window {
    __medhelpWsMetrics?: {
      enabled: boolean;
      connectStartedAt?: number;
      openedAt?: number;
      firstMessageAt?: number;
      lastMessageAt?: number;
      messageCount?: number;
      lastCloseAt?: number;
      lastErrorAt?: number;
      lastError?: unknown;
      url?: string | null;
    };
  }
}

type WebSocketContextType = {
  ws: WebSocket | null;
  sendMessage: (message: any) => void;
  latestMessage: any | null;
  isConnected: boolean;
};

const WebSocketContext = createContext<WebSocketContextType | null>(null);

export const useWebSocket = () => {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocket must be used within a WebSocketProvider');
  }
  return context;
};

const isWsMetricsEnabled = () => {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem('debug-ws-metrics') === '1';
  } catch {
    return false;
  }
};

const useWebSocketProviderState = (): WebSocketContextType => {
  const wsRef = useRef<WebSocket | null>(null);
  const unmountedRef = useRef(false);
  const [latestMessage, setLatestMessage] = useState<any>(null);
  const [isConnected, setIsConnected] = useState(false);
  const isConnectingRef = useRef(false);
  const connectionSeqRef = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const { token, isLoading: authLoading } = useAuth() as {
    token?: string | null;
    isLoading?: boolean;
  };
  const localKernel = useOptionalLocalKernel();
  const desktopRuntime = useDesktopRuntime();
  const localKernelRequired = Boolean(localKernel?.isRequired);
  // Once the hosted shell is paired with the local Kernel, cloud auth refreshes
  // must not tear down the active loopback chat stream. The Kernel session has
  // its own token and receives refreshed cloud credentials through the pairing
  // API in LocalKernelProvider.
  const {
    disabled: disableLegacyWebSocket,
    identity: webSocketIdentity,
    url: webSocketUrl,
  } = resolveChatWebSocketConnection({
    isPlatform: IS_PLATFORM,
    pageProtocol: window.location.protocol,
    pageHost: window.location.host,
    cloudToken: token || null,
    authLoading: Boolean(authLoading),
    localKernelRequired,
    localKernelState: localKernel?.state,
    localKernelWsBaseUrl: localKernel?.endpoint?.wsBaseUrl,
    localKernelSessionToken: localKernel?.sessionToken,
  });
  const desktopRuntimeWaiting = Boolean(
    desktopRuntime.supported
    && desktopRuntime.status
    && !['running', 'disabled'].includes(desktopRuntime.status.status),
  );
  const disableWebSocket = disableLegacyWebSocket || desktopRuntimeWaiting;
  const effectiveWebSocketIdentity = desktopRuntimeWaiting
    ? 'desktop-runtime-waiting'
    : webSocketIdentity;
  const desktopRuntimeWaitingRef = useRef(desktopRuntimeWaiting);
  desktopRuntimeWaitingRef.current = desktopRuntimeWaiting;
  const connectionConfigRef = useRef({
    disabled: disableWebSocket,
    url: webSocketUrl,
  });
  connectionConfigRef.current = {
    disabled: disableWebSocket,
    url: webSocketUrl,
  };

  // Message queue: ensures every WebSocket message is delivered to consumers
  // even when multiple arrive before React can re-render.
  const messageQueueRef = useRef<any[]>([]);
  const drainTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drainScheduledRef = useRef(false);
  const awaitingCommitRef = useRef(false);
  const messageChannelRef = useRef<MessageChannel | null>(null);
  const scheduleDrainRef = useRef<() => void>(() => {});

  // Outbound queue: ensures messages are not lost when the socket isn't open yet.
  const outboundQueueRef = useRef<OutboundQueueEntry[]>([]);

  const drainQueue = useCallback(() => {
    drainScheduledRef.current = false;
    drainTimerRef.current = null;
    if (awaitingCommitRef.current || messageQueueRef.current.length === 0) return;
    const next = messageQueueRef.current.shift()!;
    awaitingCommitRef.current = true;
    setLatestMessage(next);
  }, []);

  const scheduleDrain = useCallback(() => {
    if (awaitingCommitRef.current || drainScheduledRef.current || messageQueueRef.current.length === 0) {
      return;
    }

    drainScheduledRef.current = true;
    if (messageChannelRef.current) {
      messageChannelRef.current.port2.postMessage(null);
      return;
    }

    drainTimerRef.current = setTimeout(drainQueue, 0);
  }, [drainQueue]);

  scheduleDrainRef.current = scheduleDrain;

  // A browser task is not a React commit boundary. Wait until consumers have
  // committed this event before publishing another one into latestMessage.
  useEffect(() => {
    awaitingCommitRef.current = false;
    scheduleDrainRef.current();
  }, [latestMessage]);

  const clearInboundQueue = useCallback(() => {
    if (drainTimerRef.current) {
      clearTimeout(drainTimerRef.current);
      drainTimerRef.current = null;
    }
    drainScheduledRef.current = false;
    messageQueueRef.current = [];
  }, []);

  // Deliver the next distinct event as soon as the browser can run a task.
  // High-frequency cumulative provider snapshots are coalesced before they
  // reach this scheduler, so immediate delivery no longer creates the large
  // renderer workload that motivated the former fixed 16/32ms delay.
  useEffect(() => {
    if (typeof MessageChannel === 'undefined') {
      return;
    }

    const channel = new MessageChannel();
    channel.port1.onmessage = drainQueue;
    messageChannelRef.current = channel;

    return () => {
      channel.port1.onmessage = null;
      channel.port1.close();
      channel.port2.close();
      if (messageChannelRef.current === channel) {
        messageChannelRef.current = null;
      }
    };
  }, [drainQueue]);

  // Mark unmounted only on actual provider unmount.
  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  const flushOutbound = useCallback(() => {
    const socket = wsRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    if (outboundQueueRef.current.length === 0) return;
    const expired = pruneExpiredOutboundMessages(outboundQueueRef.current);
    if (expired > 0) {
      console.warn(`Discarded ${expired} expired WebSocket message(s) during reconnect`);
    }
    while (outboundQueueRef.current.length > 0) {
      const entry = outboundQueueRef.current[0];
      try {
        socket.send(entry.payload);
        outboundQueueRef.current.shift();
      } catch (error) {
        console.error('Error sending queued WebSocket message:', error);
        // Keep this entry and every later entry in their original order.
        break;
      }
    }
  }, []);

  const connect = useCallback(() => {
    if (unmountedRef.current) return;
    const connectionConfig = connectionConfigRef.current;
    if (connectionConfig.disabled) {
      setIsConnected(false);
      return;
    }
    if (isConnectingRef.current) return;
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;
    try {
      const nextWebSocketUrl = connectionConfig.url;
      if (!nextWebSocketUrl) {
        setIsConnected(false);
        return;
      }
      const metricsEnabled = isWsMetricsEnabled();
      if (metricsEnabled && typeof window !== 'undefined') {
        window.__medhelpWsMetrics = {
          enabled: true,
          connectStartedAt: performance.now(),
          openedAt: undefined,
          firstMessageAt: undefined,
          lastMessageAt: undefined,
          messageCount: 0,
          lastCloseAt: undefined,
          lastErrorAt: undefined,
          lastError: undefined,
          url: nextWebSocketUrl,
        };
      }

      const connectionSeq = connectionSeqRef.current + 1;
      connectionSeqRef.current = connectionSeq;
      const isCurrentConnection = () => connectionSeqRef.current === connectionSeq && !unmountedRef.current;
      isConnectingRef.current = true;
      const websocket = new WebSocket(nextWebSocketUrl);

      websocket.onopen = () => {
        if (!isCurrentConnection()) {
          websocket.close(1000, 'stale-websocket');
          return;
        }
        if (metricsEnabled && typeof window !== 'undefined' && window.__medhelpWsMetrics) {
          window.__medhelpWsMetrics.openedAt = performance.now();
        }
        setIsConnected(true);
        wsRef.current = websocket;
        isConnectingRef.current = false;
        flushOutbound();
      };

      websocket.onmessage = (event) => {
        try {
          if (metricsEnabled && typeof window !== 'undefined' && window.__medhelpWsMetrics) {
            const now = performance.now();
            const metrics = window.__medhelpWsMetrics;
            metrics.messageCount = (metrics.messageCount || 0) + 1;
            metrics.lastMessageAt = now;
            if (!metrics.firstMessageAt) {
              metrics.firstMessageAt = now;
              if (metrics.openedAt != null && metrics.connectStartedAt != null) {
                // eslint-disable-next-line no-console
                console.log(
                  `[WS metrics] connect→open=${Math.round(metrics.openedAt - metrics.connectStartedAt)}ms, open→firstMsg=${Math.round(now - metrics.openedAt)}ms`,
                );
              }
            }
          }
          const data = JSON.parse(event.data);
          if (metricsEnabled) {
            const type = (data && typeof data === 'object' && 'type' in data) ? (data as any).type : undefined;
            const sessionId = (data && typeof data === 'object' && 'sessionId' in data) ? (data as any).sessionId : undefined;
            // eslint-disable-next-line no-console
            console.log('[WS recv]', type || '(no type)', sessionId ? `session=${sessionId}` : '');
          }
          enqueueRealtimeMessage(messageQueueRef.current, data);
          scheduleDrain();
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      websocket.onclose = (event) => {
        if (metricsEnabled && typeof window !== 'undefined' && window.__medhelpWsMetrics) {
          window.__medhelpWsMetrics.lastCloseAt = performance.now();
        }
        if (!isCurrentConnection()) {
          return;
        }

        console.warn('WebSocket closed; reconnecting', {
          code: event.code,
          reason: event.reason || null,
          wasClean: event.wasClean,
        });

        setIsConnected(false);
        if (wsRef.current === websocket) {
          wsRef.current = null;
        }
        isConnectingRef.current = false;

        reconnectTimeoutRef.current = setTimeout(() => {
          if (unmountedRef.current) return;
          connect();
        }, 3000);
      };

      websocket.onerror = (error) => {
        if (!isCurrentConnection()) {
          return;
        }
        if (metricsEnabled && typeof window !== 'undefined') {
          window.__medhelpWsMetrics = window.__medhelpWsMetrics || { enabled: true };
          window.__medhelpWsMetrics.lastErrorAt = performance.now();
          window.__medhelpWsMetrics.lastError = error;
        }
        isConnectingRef.current = false;
        console.error('WebSocket error:', error);
      };

    } catch (error) {
      isConnectingRef.current = false;
      console.error('Error creating WebSocket connection:', error);
    }
  }, [
    flushOutbound,
    scheduleDrain,
  ]);

  useEffect(() => {
    if (disableWebSocket) {
      connectionSeqRef.current += 1;
      isConnectingRef.current = false;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      clearInboundQueue();
      if (!desktopRuntimeWaiting) {
        outboundQueueRef.current = [];
      }
      if (wsRef.current) {
        wsRef.current.close(1000, 'chat-connection-unavailable');
        wsRef.current = null;
      }
      setIsConnected(false);
      return;
    }

    connect();

    return () => {
      connectionSeqRef.current += 1;
      isConnectingRef.current = false;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      clearInboundQueue();
      if (!desktopRuntimeWaitingRef.current) {
        outboundQueueRef.current = [];
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [clearInboundQueue, connect, desktopRuntimeWaiting, disableWebSocket, effectiveWebSocketIdentity]);

  const sendMessage = useCallback((message: any) => {
    let entry: OutboundQueueEntry;
    try {
      entry = createOutboundQueueEntry(message);
    } catch (error) {
      console.error('Error serializing WebSocket message:', error);
      return;
    }
    const socket = wsRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(entry.payload);
        return;
      } catch (error) {
        console.error('WebSocket send failed; preserving message for reconnect:', error);
      }
    }

    const queued = enqueueOutboundMessage(outboundQueueRef.current, entry, OUTBOUND_QUEUE_DEFAULTS);
    if (!queued.accepted) {
      console.error('WebSocket outbound queue is full; message was not queued', {
        type: entry.type,
        bytes: entry.bytes,
      });
      return;
    }
    if (queued.expired > 0 || queued.coalesced > 0) {
      console.info('WebSocket outbound queue compacted', queued);
    }
    if (connectionConfigRef.current.disabled) {
      console.warn(desktopRuntimeWaiting
        ? 'WebSocket waiting for the desktop Runtime to recover'
        : 'Legacy WebSocket disabled while Local Kernel is required');
      return;
    }
    console.warn('WebSocket not connected; message queued');
    // Try to connect immediately so queued messages flush ASAP.
    connect();
  }, [connect, desktopRuntimeWaiting]);

  const value: WebSocketContextType = useMemo(() =>
  ({
    ws: wsRef.current,
    sendMessage,
    latestMessage,
    isConnected
  }), [sendMessage, latestMessage, isConnected]);

  return value;
};

export const WebSocketProvider = ({ children }: { children: React.ReactNode }) => {
  const webSocketData = useWebSocketProviderState();
  
  return (
    <WebSocketContext.Provider value={webSocketData}>
      {children}
    </WebSocketContext.Provider>
  );
};

export default WebSocketContext;
