# 11 - WebSocket Protocol

**Purpose:** Define WebSocket communication protocol for real-time updates

---

## Connection

### URL
```
ws://localhost:8000/ws/sessions/{session_id}
```

### Connection Lifecycle
```
1. Client connects
2. Server accepts
3. Client subscribes to session
4. Server sends updates
5. Connection closes (completion or error)
```

---

## Message Format

### Base Message Structure
```typescript
interface WSMessage {
  type: 'subscribe' | 'progress' | 'complete' | 'error' | 'log' | 'ping' | 'pong';
  timestamp: string;  // ISO 8601
  payload: unknown;
}
```

### Subscribe Message (Client → Server)
```typescript
interface SubscribeMessage {
  type: 'subscribe';
  payload: {
    session_id: string;
  };
}

// Example
{
  "type": "subscribe",
  "timestamp": "2026-03-16T10:00:00Z",
  "payload": {
    "session_id": "550e8400-e29b-41d4-a716-446655440000"
  }
}
```

### Progress Message (Server → Client)
```typescript
interface ProgressMessage {
  type: 'progress';
  payload: {
    step: number;           // 1-9
    step_name: string;      // e.g., "protein_abundance"
    status: 'started' | 'in_progress' | 'completed';
    progress: number;       // 0-100
    message?: string;       // Human-readable status
    overall_progress: number; // 0-100
  };
}

// Example
{
  "type": "progress",
  "timestamp": "2026-03-16T10:00:05Z",
  "payload": {
    "step": 6,
    "step_name": "protein_abundance",
    "status": "in_progress",
    "progress": 45,
    "message": "Aggregating peptides to proteins...",
    "overall_progress": 65
  }
}
```

### Complete Message (Server → Client)
```typescript
interface CompleteMessage {
  type: 'complete';
  payload: {
    session_id: string;
    outputs: {
      psm_abundances: string;
      protein_abundances: string;
      diff_expression: string;
      qc_results: string;
      gsea_results: string;
    };
    duration: number;  // seconds
  };
}

// Example
{
  "type": "complete",
  "timestamp": "2026-03-16T10:05:00Z",
  "payload": {
    "session_id": "550e8400-e29b-41d4-a716-446655440000",
    "outputs": {
      "psm_abundances": "/sessions/.../PSM_Abundances.tsv",
      "protein_abundances": "/sessions/.../Protein_Abundances.tsv",
      "diff_expression": "/sessions/.../Diff_Expression.tsv",
      "qc_results": "/sessions/.../QC_Results.json",
      "gsea_results": "/sessions/.../gsea/"
    },
    "duration": 300
  }
}
```

### Error Message (Server → Client)
```typescript
interface ErrorMessage {
  type: 'error';
  payload: {
    step: number;
    step_name: string;
    error: string;
    recoverable: boolean;
    suggestion?: string;
  };
}

// Example
{
  "type": "error",
  "timestamp": "2026-03-16T10:02:30Z",
  "payload": {
    "step": 6,
    "step_name": "protein_abundance",
    "error": "R script failed: missing required package",
    "recoverable": true,
    "suggestion": "Please ensure msqrob2 is installed"
  }
}
```

### Log Message (Server → Client)
```typescript
interface LogMessage {
  type: 'log';
  payload: {
    level: 'info' | 'warning' | 'error';
    message: string;
    step?: number;
    timestamp: string;
  };
}

// Example
{
  "type": "log",
  "timestamp": "2026-03-16T10:01:00Z",
  "payload": {
    "level": "info",
    "message": "Starting protein abundance calculation",
    "step": 6,
    "timestamp": "2026-03-16T10:01:00Z"
  }
}
```

### Ping/Pong (Keepalive)
```typescript
// Client → Server
interface PingMessage {
  type: 'ping';
  payload: {
    timestamp: string;
  };
}

// Server → Client
interface PongMessage {
  type: 'pong';
  payload: {
    timestamp: string;
    server_time: string;
  };
}
```

---

## Client Implementation

### React Hook
```typescript
// hooks/use-websocket.ts
import { useEffect, useRef, useCallback } from 'react';
import { useProcessingStore } from '@/stores/processing-store';

export const useWebSocket = (sessionId: string | null) => {
  const ws = useRef<WebSocket | null>(null);
  const { setStatus, addLog, setConnected } = useProcessingStore();
  
  const connect = useCallback(() => {
    if (!sessionId) return;
    
    const wsUrl = `${WS_BASE_URL}/ws/sessions/${sessionId}`;
    ws.current = new WebSocket(wsUrl);
    
    ws.current.onopen = () => {
      setConnected(true);
      // Subscribe to session
      ws.current?.send(JSON.stringify({
        type: 'subscribe',
        payload: { session_id: sessionId }
      }));
    };
    
    ws.current.onmessage = (event) => {
      const message: WSMessage = JSON.parse(event.data);
      handleMessage(message);
    };
    
    ws.current.onclose = () => {
      setConnected(false);
      // Attempt reconnection
      setTimeout(connect, 5000);
    };
    
    ws.current.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }, [sessionId]);
  
  const handleMessage = (message: WSMessage) => {
    switch (message.type) {
      case 'progress':
        setStatus(message.payload);
        break;
      case 'log':
        addLog(message.payload);
        break;
      case 'complete':
        // Handle completion
        break;
      case 'error':
        // Handle error
        break;
    }
  };
  
  useEffect(() => {
    connect();
    return () => ws.current?.close();
  }, [connect]);
  
  return { isConnected: useProcessingStore((s) => s.isConnected) };
};
```

---

## Server Implementation

### FastAPI WebSocket
```python
# api/routes/websocket.py

from fastapi import WebSocket, WebSocketDisconnect
from typing import Dict

class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
    
    async def connect(self, session_id: str, websocket: WebSocket):
        await websocket.accept()
        self.active_connections[session_id] = websocket
    
    def disconnect(self, session_id: str):
        if session_id in self.active_connections:
            del self.active_connections[session_id]
    
    async def send_message(self, session_id: str, message: dict):
        if session_id in self.active_connections:
            await self.active_connections[session_id].send_json(message)

manager = ConnectionManager()

@app.websocket("/ws/sessions/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    await manager.connect(session_id, websocket)
    
    try:
        while True:
            # Receive message
            data = await websocket.receive_json()
            
            if data['type'] == 'subscribe':
                # Start sending updates
                await handle_subscription(session_id)
            elif data['type'] == 'ping':
                await websocket.send_json({
                    'type': 'pong',
                    'payload': {
                        'timestamp': data['payload']['timestamp'],
                        'server_time': datetime.utcnow().isoformat()
                    }
                })
    
    except WebSocketDisconnect:
        manager.disconnect(session_id)

async def send_progress_update(session_id: str, step: int, progress: int):
    """Send progress update to client."""
    await manager.send_message(session_id, {
        'type': 'progress',
        'timestamp': datetime.utcnow().isoformat(),
        'payload': {
            'step': step,
            'step_name': STEP_NAMES[step],
            'status': 'in_progress',
            'progress': progress,
            'overall_progress': calculate_overall_progress(step, progress)
        }
    })
```

---

## Reconnection Strategy

### Exponential Backoff
```typescript
// lib/websocket.ts

class WebSocketManager {
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private baseDelay = 1000; // 1 second
  
  private getReconnectDelay(): number {
    // Exponential backoff with jitter
    const delay = Math.min(
      this.baseDelay * 2 ** this.reconnectAttempts,
      30000 // Max 30 seconds
    );
    const jitter = Math.random() * 1000;
    return delay + jitter;
  }
  
  private handleDisconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      const delay = this.getReconnectDelay();
      setTimeout(() => this.connect(), delay);
      this.reconnectAttempts++;
    } else {
      // Max attempts reached
      this.onMaxReconnectAttemptsReached();
    }
  }
  
  private onOpen() {
    // Reset attempts on successful connection
    this.reconnectAttempts = 0;
  }
}
```

---

## Error Handling

### Connection Errors
```typescript
// Handle various WebSocket errors
ws.onerror = (error) => {
  if (ws.readyState === WebSocket.CONNECTING) {
    // Connection failed
    logger.error('WebSocket connection failed');
  } else if (ws.readyState === WebSocket.OPEN) {
    // Message error
    logger.error('WebSocket message error:', error);
  }
};
```

### Message Parse Errors
```typescript
ws.onmessage = (event) => {
  try {
    const message = JSON.parse(event.data);
    handleMessage(message);
  } catch (error) {
    logger.error('Failed to parse WebSocket message:', error);
  }
};
```

---

## Next Steps

See [12-data-validation.md](12-data-validation.md) for data validation.
