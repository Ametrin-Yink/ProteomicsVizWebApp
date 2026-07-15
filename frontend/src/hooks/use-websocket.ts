/**
 * WebSocket hook for real-time processing updates
 * Following AGENTS/11-websocket-protocol.md
 * Implements reconnection with exponential backoff
 */

import { useEffect, useRef, useCallback } from 'react';
import { useProcessingStore } from '@/stores/processing-store';
import { useUIStore } from '@/stores/ui-store';
import {
  WSMessage,
  ProgressMessage,
  LogMessage,
  ErrorMessage,
  CompleteMessage,
} from '@/types/processing';

// Use relative URL to go through Next.js proxy (avoid CORS)
// WebSocket URL can be overridden via NEXT_PUBLIC_WS_URL env var
const WS_BASE_URL = process.env.NEXT_PUBLIC_WS_URL || '';
const MAX_RECONNECT_ATTEMPTS = 5;
const BASE_RECONNECT_DELAY = 1000; // 1 second
const CONNECTION_TIMEOUT = 10000; // 10 seconds

export const useWebSocket = (sessionId: string | null) => {
  const ws = useRef<WebSocket | null>(null);
  const reconnectAttempts = useRef(0);
  const reconnectTimeout = useRef<NodeJS.Timeout | null>(null);
  const isManualClose = useRef(false);
  const connectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const { addToast } = useUIStore();

  const {
    updateStepProgress,
    addLog,
    setError,
    setComplete,
    setConnected,
  } = useProcessingStore();

  const getReconnectDelay = useCallback((): number => {
    // Exponential backoff with jitter
    const delay = Math.min(
      BASE_RECONNECT_DELAY * 2 ** reconnectAttempts.current,
      30000 // Max 30 seconds
    );
    const jitter = Math.random() * 1000;
    return delay + jitter;
  }, []);

  const handleMessage = useCallback((message: WSMessage) => {
    switch (message.type) {
      case 'progress': {
        const progressMessage = message as ProgressMessage;
        updateStepProgress(progressMessage.payload);
        break;
      }
      case 'log': {
        const logMessage = message as LogMessage;
        addLog(logMessage.payload);
        break;
      }
      case 'complete': {
        const completeMessage = message as CompleteMessage;
        setComplete(completeMessage.payload);
        // Close connection on completion
        if (ws.current) {
          ws.current.close();
        }
        break;
      }
      case 'error': {
        const errorMessage = message as ErrorMessage;
        setError(errorMessage.payload);
        break;
      }
      case 'pong': {
        // Keepalive response - no action needed
        break;
      }
      default: {
        console.warn('Unknown WebSocket message type:', message.type);
      }
    }
  }, [updateStepProgress, addLog, setComplete, setError]);

  // Ref to hold the latest connect function for self-referential reconnect calls
  const connectRef = useRef<(() => void) | null>(null);

  const connect = useCallback(() => {
    if (!sessionId) return;

    // Clear any existing reconnect timeout
    if (reconnectTimeout.current) {
      clearTimeout(reconnectTimeout.current);
      reconnectTimeout.current = null;
    }

    // Prevent multiple simultaneous connections
    if (ws.current?.readyState === WebSocket.CONNECTING) {
      return;
    }

    // Close existing connection before creating new one
    if (ws.current) {
      // Don't flag as manual close — let the onclose handler see it wasn't manual
      // so the reconnect logic can still fire if needed
      ws.current.onclose = null;  // Prevent spurious reconnect attempts from old onclose
      ws.current.close();
      ws.current = null;
    }

    // Connect via WebSocket - use env var for production, fallback to direct backend for dev
    const wsUrl = WS_BASE_URL
      ? `${WS_BASE_URL}/ws/sessions/${sessionId}`
      : `ws://127.0.0.1:8000/ws/sessions/${sessionId}`;

    try {
      ws.current = new WebSocket(wsUrl);

      // X-007: Connection timeout
      connectionTimeoutRef.current = setTimeout(() => {
        if (ws.current?.readyState === WebSocket.CONNECTING || ws.current?.readyState === WebSocket.OPEN) {
          console.warn('WebSocket connection timed out after 10s');
          ws.current.close();
        }
      }, CONNECTION_TIMEOUT);

      ws.current.onopen = () => {
        if (connectionTimeoutRef.current) {
          clearTimeout(connectionTimeoutRef.current);
          connectionTimeoutRef.current = null;
        }
        setConnected(true);
        reconnectAttempts.current = 0;
        isManualClose.current = false;

        // Subscribe to session updates
        if (ws.current?.readyState === WebSocket.OPEN) {
          try {
            ws.current.send(JSON.stringify({
              type: 'subscribe',
              payload: { session_id: sessionId },
            }));
          } catch (subscribeError) {
            console.error('Failed to send subscribe message:', subscribeError);
            addToast('warning', 'Failed to subscribe to session updates via WebSocket');
          }
        }
      };

      ws.current.onmessage = (event) => {
        try {
          // Handle plain text ping/pong messages from backend
          if (event.data === 'ping') {
            // Respond with JSON pong
            if (ws.current?.readyState === WebSocket.OPEN) {
              ws.current.send(JSON.stringify({ type: 'pong' }));
            }
            return;
          }
          if (event.data === 'pong') {
            // Keepalive response - no action needed
            return;
          }

          // Try to parse as JSON
          const message: WSMessage = JSON.parse(event.data);

          // Handle JSON ping/pong messages
          if (message.type === 'ping') {
            if (ws.current?.readyState === WebSocket.OPEN) {
              ws.current.send(JSON.stringify({ type: 'pong' }));
            }
            return;
          }
          if (message.type === 'pong') {
            // Keepalive response - no action needed
            return;
          }

          handleMessage(message);
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error, 'Data:', event.data);
        }
      };

      ws.current.onclose = (event) => {
        if (connectionTimeoutRef.current) {
          clearTimeout(connectionTimeoutRef.current);
          connectionTimeoutRef.current = null;
        }
        setConnected(false);

        // Don't reconnect if manually closed
        if (isManualClose.current) {
          return;
        }

        // Don't reconnect if connection was closed cleanly (processing complete)
        if (event.wasClean) {
          return;
        }

        // Attempt reconnection if not at max attempts
        if (reconnectAttempts.current < MAX_RECONNECT_ATTEMPTS) {
          const delay = getReconnectDelay();
          reconnectTimeout.current = setTimeout(() => {
            reconnectAttempts.current += 1;
            connectRef.current?.();
          }, delay);
        } else {
          console.error('Max WebSocket reconnection attempts reached');
          addToast('warning', 'Unable to maintain real-time connection. Updates may be delayed.');
        }
      };

      ws.current.onerror = (_error) => {
        // WebSocket error events don't carry useful info — onclose handles reconnection
      };
    } catch (error) {
      console.error('Failed to create WebSocket connection:', error);
    }
  }, [sessionId, setConnected, getReconnectDelay, handleMessage]);

  // Sync connect ref so reconnect callbacks can invoke latest connect
  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  // Setup connection
  useEffect(() => {
    if (sessionId) {
      connect();
    }

    // Cleanup on unmount
    return () => {
      isManualClose.current = true;
      if (reconnectTimeout.current) {
        clearTimeout(reconnectTimeout.current);
        reconnectTimeout.current = null;
      }
      if (connectionTimeoutRef.current) {
        clearTimeout(connectionTimeoutRef.current);
        connectionTimeoutRef.current = null;
      }
      // D-035: Clear ping interval on disconnect
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }
      if (ws.current) {
        ws.current.close();
        ws.current = null;
      }
    };
  }, [sessionId, connect]);

  // Keepalive ping
  useEffect(() => {
    if (!sessionId) return;

    pingIntervalRef.current = setInterval(() => {
      if (ws.current?.readyState === WebSocket.OPEN) {
        ws.current.send(JSON.stringify({
          type: 'ping',
          payload: { timestamp: new Date().toISOString() },
        }));
      }
    }, 30000); // Ping every 30 seconds

    return () => {
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }
    };
  }, [sessionId]);

  return {
    isConnected: useProcessingStore((s) => s.isConnected),
  };
};
