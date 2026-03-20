/**
 * WebSocket Client for Real-time Updates
 * 
 * Manages WebSocket connection for processing pipeline updates.
 * Following AGENTS/11-websocket-protocol.md
 */

import type { 
  WebSocketMessageUnion, 
  SessionUpdateMessage,
  ProgressUpdateMessage,
  ProcessingCompleteMessage,
  ProcessingErrorMessage,
  UploadProgressMessage 
} from '@/types/api';

// WebSocket connection status
export type WebSocketStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

// Callback types
export type MessageHandler = (message: WebSocketMessageUnion) => void;
export type StatusHandler = (status: WebSocketStatus) => void;

// WebSocket client configuration
interface WebSocketConfig {
  url: string;
  sessionId: string;
  reconnectAttempts?: number;
  reconnectDelay?: number;
  heartbeatInterval?: number;
}

/**
 * WebSocket Client Class
 * 
 * Handles connection management, message routing, and reconnection logic.
 */
export class WebSocketClient {
  private ws: WebSocket | null = null;
  private config: WebSocketConfig;
  private status: WebSocketStatus = 'disconnected';
  private reconnectCount = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private messageHandlers: Set<MessageHandler> = new Set();
  private statusHandlers: Set<StatusHandler> = new Set();

  constructor(config: WebSocketConfig) {
    this.config = {
      reconnectAttempts: 5,
      reconnectDelay: 3000,
      heartbeatInterval: 30000,
      ...config,
    };
  }

  /**
   * Get current connection status
   */
  getStatus(): WebSocketStatus {
    return this.status;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.status === 'connected' && this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Connect to WebSocket server
   */
  connect(): void {
    if (this.ws?.readyState === WebSocket.CONNECTING) {
      console.log('[WebSocket] Already connecting...');
      return;
    }

    if (this.ws?.readyState === WebSocket.OPEN) {
      console.log('[WebSocket] Already connected');
      return;
    }

    this.setStatus('connecting');

    try {
      const wsUrl = `${this.config.url}?session_id=${this.config.sessionId}`;
      console.log(`[WebSocket] Connecting to ${wsUrl}`);

      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = this.handleOpen.bind(this);
      this.ws.onmessage = this.handleMessage.bind(this);
      this.ws.onclose = this.handleClose.bind(this);
      this.ws.onerror = this.handleError.bind(this);
    } catch (error) {
      console.error('[WebSocket] Connection error:', error);
      this.setStatus('error');
      this.scheduleReconnect();
    }
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect(): void {
    console.log('[WebSocket] Disconnecting...');

    // Clear timers
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    // Close connection
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }

    this.reconnectCount = 0;
    this.setStatus('disconnected');
  }

  /**
   * Send message to server
   */
  send(message: Record<string, unknown>): void {
    if (!this.isConnected()) {
      console.warn('[WebSocket] Cannot send, not connected');
      return;
    }

    try {
      const messageStr = JSON.stringify(message);
      this.ws?.send(messageStr);
      console.log('[WebSocket] Sent:', message);
    } catch (error) {
      console.error('[WebSocket] Send error:', error);
    }
  }

  /**
   * Subscribe to session updates
   */
  subscribe(): void {
    this.send({
      type: 'subscribe',
      payload: {
        session_id: this.config.sessionId,
      },
    });
  }

  /**
   * Register message handler
   */
  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  /**
   * Register status handler
   */
  onStatusChange(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  /**
   * Handle connection open
   */
  private handleOpen(): void {
    console.log('[WebSocket] Connected');
    this.reconnectCount = 0;
    this.setStatus('connected');
    this.startHeartbeat();
    this.subscribe();
  }

  /**
   * Handle incoming message
   */
  private handleMessage(event: MessageEvent): void {
    try {
      const message = JSON.parse(event.data) as WebSocketMessageUnion;
      console.log('[WebSocket] Received:', message.type, message);

      // Notify all handlers
      this.messageHandlers.forEach((handler) => {
        try {
          handler(message);
        } catch (error) {
          console.error('[WebSocket] Handler error:', error);
        }
      });
    } catch (error) {
      console.error('[WebSocket] Message parse error:', error);
    }
  }

  /**
   * Handle connection close
   */
  private handleClose(event: CloseEvent): void {
    console.log(`[WebSocket] Closed: ${event.code} - ${event.reason}`);

    // Clear heartbeat
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    // Don't reconnect if closed normally
    if (event.code === 1000) {
      this.setStatus('disconnected');
      return;
    }

    this.setStatus('disconnected');
    this.scheduleReconnect();
  }

  /**
   * Handle connection error
   */
  private handleError(error: Event): void {
    console.error('[WebSocket] Error:', error);
    this.setStatus('error');
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnect(): void {
    if (this.reconnectCount >= (this.config.reconnectAttempts ?? 5)) {
      console.error('[WebSocket] Max reconnection attempts reached');
      return;
    }

    this.reconnectCount++;
    const delay = (this.config.reconnectDelay ?? 3000) * this.reconnectCount;

    console.log(`[WebSocket] Reconnecting in ${delay}ms (attempt ${this.reconnectCount})`);

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  /**
   * Start heartbeat to keep connection alive
   */
  private startHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }

    this.heartbeatTimer = setInterval(() => {
      if (this.isConnected()) {
        this.send({ type: 'ping', timestamp: new Date().toISOString() });
      }
    }, this.config.heartbeatInterval ?? 30000);
  }

  /**
   * Update status and notify handlers
   */
  private setStatus(status: WebSocketStatus): void {
    this.status = status;
    this.statusHandlers.forEach((handler) => {
      try {
        handler(status);
      } catch (error) {
        console.error('[WebSocket] Status handler error:', error);
      }
    });
  }
}

/**
 * Create WebSocket URL from base API URL
 */
export function createWebSocketUrl(baseUrl: string): string {
  // Convert http to ws, https to wss
  const wsProtocol = baseUrl.startsWith('https') ? 'wss' : 'ws';
  const wsHost = baseUrl.replace(/^https?:\/\//, '');
  return `${wsProtocol}://${wsHost}/ws`;
}

/**
 * Type guards for WebSocket messages
 */
export function isSessionUpdateMessage(
  message: WebSocketMessageUnion
): message is SessionUpdateMessage {
  return message.type === 'session_update';
}

export function isProgressUpdateMessage(
  message: WebSocketMessageUnion
): message is ProgressUpdateMessage {
  return message.type === 'progress_update';
}

export function isProcessingCompleteMessage(
  message: WebSocketMessageUnion
): message is ProcessingCompleteMessage {
  return message.type === 'processing_complete';
}

export function isProcessingErrorMessage(
  message: WebSocketMessageUnion
): message is ProcessingErrorMessage {
  return message.type === 'processing_error';
}

export function isUploadProgressMessage(
  message: WebSocketMessageUnion
): message is UploadProgressMessage {
  return message.type === 'upload_progress';
}

// Singleton instance for app-wide use
let globalWebSocketClient: WebSocketClient | null = null;

/**
 * Get or create global WebSocket client
 */
export function getWebSocketClient(
  sessionId: string,
  baseUrl: string = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000/ws'
): WebSocketClient {
  if (!globalWebSocketClient || globalWebSocketClient.getStatus() === 'disconnected') {
    globalWebSocketClient = new WebSocketClient({
      url: baseUrl,
      sessionId,
    });
  }
  return globalWebSocketClient;
}

/**
 * Disconnect global WebSocket client
 */
export function disconnectWebSocket(): void {
  if (globalWebSocketClient) {
    globalWebSocketClient.disconnect();
    globalWebSocketClient = null;
  }
}
