import { useEffect, useRef, useCallback, useState } from 'react';

export type WebSocketStatus = 'connecting' | 'open' | 'backoff' | 'offline' | 'auth-failed' | 'disposed';

interface UseWsOptions {
  url?: string;
  createUrl?: () => Promise<string>;
  onMessage: (data: string) => void;
  onClose?: (final?: boolean) => void;
  onOpen?: (sendNow: (data: string) => void) => void;
}

export function useWebSocket({ url, createUrl, onMessage, onClose, onOpen }: UseWsOptions) {
  const [status, setStatus] = useState<WebSocketStatus>(navigator.onLine ? 'connecting' : 'offline');
  const wsRef = useRef<WebSocket | null>(null);
  const retryCountRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const bufferRef = useRef<string[]>([]);
  const disposedRef = useRef(false);
  const connectRef = useRef<() => void>(() => {});
  const generationRef = useRef(0);

  // Keep latest callbacks in refs to avoid reconnect on re-render
  const onMessageRef = useRef(onMessage);
  const onCloseRef = useRef(onClose);
  const onOpenRef = useRef(onOpen);
  useEffect(() => {
    onMessageRef.current = onMessage;
    onCloseRef.current = onClose;
    onOpenRef.current = onOpen;
  }, [onClose, onMessage, onOpen]);

  // Full jitter prevents many panes from reconnecting in lockstep. Retrying is
  // lifecycle-bound, not count-bound; auth failures are terminal in connect.
  const scheduleReconnect = useCallback(() => {
    if (disposedRef.current || timerRef.current !== undefined) return;
    if (!navigator.onLine) {
      setStatus('offline');
      return;
    }
    setStatus('backoff');
    const ceiling = Math.min(1000 * Math.pow(2, Math.min(retryCountRef.current, 5)), 30000);
    retryCountRef.current++;
    timerRef.current = setTimeout(() => {
      timerRef.current = undefined;
      void connectRef.current();
    }, Math.floor(Math.random() * ceiling));
  }, []);

  const connect = useCallback(async () => {
    if (disposedRef.current) return;
    if (!navigator.onLine) {
      setStatus('offline');
      return;
    }
    setStatus('connecting');
    const generation = ++generationRef.current;
    let resolvedUrl: string;
    try {
      resolvedUrl = createUrl ? await createUrl() : (url || '');
    } catch (error) {
      if (disposedRef.current || generation !== generationRef.current) return;
      if (typeof error === 'object' && error !== null && 'retryable' in error && error.retryable === false) {
        setStatus('auth-failed');
        onCloseRef.current?.(true);
        return;
      }
      scheduleReconnect();
      return;
    }
    if (disposedRef.current || generation !== generationRef.current || !resolvedUrl) return;
    const previous = wsRef.current;
    if (previous) {
      previous.onclose = null;
      previous.close();
    }
    const ws = new WebSocket(resolvedUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus('open');
      retryCountRef.current = 0;
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ action: 'ping' }));
      }, 20000);
      if (bufferRef.current.length > 0) {
        for (const msg of bufferRef.current) {
          ws.send(msg);
        }
        bufferRef.current = [];
      }
      onOpenRef.current?.((data) => ws.send(data));
    };

    ws.onmessage = (event) => {
      const data = typeof event.data === 'string' ? event.data : '';
      try {
        const control = JSON.parse(data) as { type?: string };
        if (control.type === 'ping') {
          ws.send(JSON.stringify({ action: 'pong' }));
          return;
        }
        if (control.type === 'pong') return;
        if (control.type === 'shutdown') {
          ws.close();
          return;
        }
      } catch { /* terminal data is not required to be JSON text */ }
      onMessageRef.current(data);
    };

    ws.onclose = () => {
      if (wsRef.current !== ws || disposedRef.current) return;
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = undefined;
      wsRef.current = null;
      onCloseRef.current?.();
      scheduleReconnect();
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [url, createUrl, scheduleReconnect]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  useEffect(() => {
    disposedRef.current = false;
    const lifecycleGeneration = generationRef;
    const reconnectOnline = () => {
      clearTimeout(timerRef.current);
      clearInterval(heartbeatRef.current);
      timerRef.current = undefined;
      heartbeatRef.current = undefined;
      retryCountRef.current = 0;
      setStatus('connecting');
      void connectRef.current();
    };
    const pauseOffline = () => {
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
      setStatus('offline');
      wsRef.current?.close();
    };
    window.addEventListener('online', reconnectOnline);
    window.addEventListener('offline', pauseOffline);
    queueMicrotask(() => { if (!disposedRef.current) void connect(); });
    return () => {
      disposedRef.current = true;
      lifecycleGeneration.current++;
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
      wsRef.current?.close();
      window.removeEventListener('online', reconnectOnline);
      window.removeEventListener('offline', pauseOffline);
    };
  }, [connect]);

  const send = useCallback((data: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(data);
    } else {
      bufferRef.current.push(data);
    }
  }, []);

  return { send, status };
}
