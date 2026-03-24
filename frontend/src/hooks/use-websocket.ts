/**
 * WebSocket hook for real-time processing updates
 * Following AGENTS/11-websocket-protocol.md
 * Implements reconnection with exponential backoff
 */

import { useEffect, useRef, useCallback } from 'react';
import { useProcessingStore } from '@/stores/processing-store';
import {
  WSMessage,
  ProgressMessage,
  LogMessage,
  ErrorMessage,
  CompleteMessage,
} from '@/types/processing';

// Use relative URL to go through Next.js proxy
const WS_BASE_URL = process.env.NEXT_PUBLIC_WS_URL || '';
const MAX_RECONNECT_ATTEMPTS = 5;
const BASE_RECONNECT_DELAY = 1000; // 1 second

export const useWebSocket = (sessionId: string | null) => {
  const ws = useRef<WebSocket | null>(null);
  const reconnectAttempts = useRef(0);
  const reconnectTimeout = useRef<NodeJS.Timeout | null>(null);

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

  const connect = useCallback(() => {
    if (!sessionId) return;

    // Clear any existing reconnect timeout
    if (reconnectTimeout.current) {
      clearTimeout(reconnectTimeout.current);
      reconnectTimeout.current = null;
    }

    const wsUrl = `${WS_BASE_URL}/ws/sessions/${sessionId}`;
    
    try {
      ws.current = new WebSocket(wsUrl);

      ws.current.onopen = () => {
        setConnected(true);
        reconnectAttempts.current = 0;

        // Subscribe to session updates
        if (ws.current?.readyState === WebSocket.OPEN) {
          ws.current.send(JSON.stringify({
            type: 'subscribe',
            payload: { session_id: sessionId },
          }));
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

      ws.current.onclose = () => {
        setConnected(false);

        // Attempt reconnection if not at max attempts
        if (reconnectAttempts.current < MAX_RECONNECT_ATTEMPTS) {
          const delay = getReconnectDelay();
          reconnectTimeout.current = setTimeout(() => {
            reconnectAttempts.current += 1;
            connect();
          }, delay);
        } else {
          console.error('Max WebSocket reconnection attempts reached');
        }
      };

      ws.current.onerror = (error) => {
        console.error('WebSocket error:', error);
      };
    } catch (error) {
      console.error('Failed to create WebSocket connection:', error);
    }
  }, [sessionId, setConnected, getReconnectDelay]);

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

  // Setup connection
  useEffect(() => {
    if (sessionId) {
      connect();
    }

    // Cleanup on unmount
    return () => {
      if (reconnectTimeout.current) {
        clearTimeout(reconnectTimeout.current);
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

    const pingInterval = setInterval(() => {
      if (ws.current?.readyState === WebSocket.OPEN) {
        ws.current.send(JSON.stringify({
          type: 'ping',
          payload: { timestamp: new Date().toISOString() },
        }));
      }
    }, 30000); // Ping every 30 seconds

    return () => clearInterval(pingInterval);
  }, [sessionId]);

  return {
    isConnected: useProcessingStore((s) => s.isConnected),
  };
};
