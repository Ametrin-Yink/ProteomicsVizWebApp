# 08 - Performance Optimization

**Purpose:** Define performance requirements and optimization strategies

---

## Performance Targets

| Metric | Target | Critical |
|--------|--------|----------|
| Page Load (Welcome) | <2s | Yes |
| Page Load (Data Input) | <2s | Yes |
| Page Load (Visualization) | <3s | Yes |
| File Upload (10MB) | <5s | Yes |
| File Upload (100MB) | <30s | Yes |
| File Upload (500MB) | <2min | Yes |
| Processing Steps 1-5 | <10s | Yes |
| Processing Step 6 (msqrob2) | <2min | Yes |
| Processing Step 7 (msqrob2) | <30s | Yes |
| Processing Step 8 (QC) | <5s | Yes |
| Processing Step 9 (GSEA) | <2min/db | Yes |
| Plot Render (Volcano) | <3s | Yes |
| Plot Render (QC) | <3s | Yes |
| Concurrent Sessions | 5-10 | Yes |
| Memory per Session | <500MB | Yes |

---

## Memory Management

### Python - Streaming Large Files
```python
# services/file_processor.py

import pandas as pd
import gc

async def process_large_file(file_path: Path):
    """Process large files in chunks to avoid memory exhaustion."""
    chunk_size = 10000  # rows
    results = []
    
    for chunk in pd.read_csv(file_path, chunksize=chunk_size):
        # Process chunk
        processed = await process_chunk(chunk)
        results.append(processed)
        
        # Explicitly free memory
        del chunk
        gc.collect()
    
    # Combine results
    return pd.concat(results, ignore_index=True)
```

### Python - Limit Concurrent Processing
```python
# services/processing.py

from asyncio import Semaphore

# Limit concurrent processing to prevent memory exhaustion
processing_semaphore = Semaphore(3)  # Max 3 concurrent

async def process_session(session_id: str):
    async with processing_semaphore:
        await run_pipeline(session_id)
```

### Python - LRU Cache
```python
# services/organism_loader.py

from functools import lru_cache

@lru_cache(maxsize=10)
def load_gene_mapping(organism: str) -> Dict[str, str]:
    """Cache gene mappings to avoid repeated disk reads."""
    mapping_file = PROTEIN_DB / f"{organism}_uniprot_gene.tsv"
    return pd.read_csv(mapping_file, sep='\t', index_col=0).to_dict()
```

---

## Database Optimization

### Vectorized Operations
```python
# CORRECT ✅ - Vectorized (fast)
df['new_col'] = df['col1'] * df['col2']

# WRONG ❌ - Iterrows (slow)
for idx, row in df.iterrows():
    df.loc[idx, 'new_col'] = row['col1'] * row['col2']
```

### Efficient Data Types
```python
# Optimize memory usage
df['category_col'] = df['category_col'].astype('category')
df['int_col'] = df['int_col'].astype('int32')  # Instead of int64
df['float_col'] = df['float_col'].astype('float32')  # Instead of float64
```

---

## Frontend Optimization

### Lazy Loading
```typescript
// Lazy load Plotly (large library)
const Plot = lazy(() => import('react-plotly.js'));

// Lazy load heavy components
const VolcanoPlot = lazy(() => import('@/components/plots/volcano-plot'));
```

### Virtualized Tables
```typescript
// components/virtual-table.tsx
import { FixedSizeList as List } from 'react-window';

const VirtualTable = ({ data, rowHeight, height }) => (
  <List
    height={height}
    itemCount={data.length}
    itemSize={rowHeight}
    width="100%"
  >
    {({ index, style }) => (
      <div style={style}>
        <TableRow data={data[index]} />
      </div>
    )}
  </List>
);
```

### Debounced Inputs
```typescript
// hooks/use-debounce.ts
import { useState, useEffect } from 'react';

export const useDebounce = <T>(value: T, delay: number): T => {
  const [debouncedValue, setDebouncedValue] = useState(value);
  
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  
  return debouncedValue;
};

// Usage
const [filter, setFilter] = useState('');
const debouncedFilter = useDebounce(filter, 300);

useEffect(() => {
  updateFilter(debouncedFilter);
}, [debouncedFilter]);
```

### Memoization
```typescript
// Memoize expensive computations
const processedData = useMemo(() => {
  return data.map(transform).filter(filter);
}, [data]);

// Memoize callbacks
const handleClick = useCallback(() => {
  onSelect(item.id);
}, [item.id, onSelect]);
```

---

## Caching Strategy

### Backend Caching
```python
# services/cache.py

from functools import wraps
import time

_cache = {}

def cache_with_ttl(ttl_seconds: int):
    """Cache function results with TTL."""
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            key = f"{func.__name__}:{hash(args)}:{hash(tuple(kwargs.items()))}"
            
            if key in _cache:
                result, expiry = _cache[key]
                if time.time() < expiry:
                    return result
            
            result = await func(*args, **kwargs)
            _cache[key] = (result, time.time() + ttl_seconds)
            return result
        
        return wrapper
    return decorator

@cache_with_ttl(ttl_seconds=3600)  # 1 hour
def get_organism_list():
    return scan_organism_database()
```

### Frontend Caching (React Query)
```typescript
// hooks/use-session.ts
import { useQuery } from '@tanstack/react-query';

export const useSession = (sessionId: string) => {
  return useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => api.sessions.get(sessionId),
    staleTime: 5 * 60 * 1000,  // 5 minutes
    cacheTime: 10 * 60 * 1000, // 10 minutes
  });
};
```

---

## WebSocket Optimization

### Message Batching
```typescript
// lib/websocket.ts

class WebSocketManager {
  private messageQueue: any[] = [];
  private flushInterval: number = 100; // ms
  
  constructor() {
    setInterval(() => this.flush(), this.flushInterval);
  }
  
  send(message: any) {
    this.messageQueue.push(message);
  }
  
  private flush() {
    if (this.messageQueue.length === 0) return;
    
    // Batch send
    const batch = this.messageQueue.splice(0, this.messageQueue.length);
    this.ws.send(JSON.stringify({ type: 'batch', messages: batch }));
  }
}
```

### Connection Pooling
```python
# Limit concurrent WebSocket connections
from fastapi import WebSocket

active_connections: Dict[str, WebSocket] = {}
MAX_CONNECTIONS = 100

async def websocket_endpoint(websocket: WebSocket, session_id: str):
    if len(active_connections) >= MAX_CONNECTIONS:
        await websocket.close(code=1008, reason="Server at capacity")
        return
    
    active_connections[session_id] = websocket
    try:
        await handle_connection(websocket, session_id)
    finally:
        del active_connections[session_id]
```

---

## File Upload Optimization

### Chunked Upload
```typescript
// lib/upload.ts

async function uploadLargeFile(file: File, sessionId: string) {
  const chunkSize = 5 * 1024 * 1024; // 5MB chunks
  const chunks = Math.ceil(file.size / chunkSize);
  
  for (let i = 0; i < chunks; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, file.size);
    const chunk = file.slice(start, end);
    
    await api.uploadChunk(sessionId, chunk, i, chunks);
  }
}
```

### Compression
```python
# services/upload.py

import gzip
import shutil

async def compress_upload(file_path: Path) -> Path:
    """Compress uploaded file for storage."""
    compressed_path = file_path.with_suffix('.csv.gz')
    
    with open(file_path, 'rb') as f_in:
        with gzip.open(compressed_path, 'wb') as f_out:
            shutil.copyfileobj(f_in, f_out)
    
    return compressed_path
```

---

## Monitoring

### Performance Metrics
```python
# middleware/metrics.py

import time
from prometheus_client import Counter, Histogram

request_count = Counter('http_requests_total', 'Total requests', ['method', 'endpoint'])
request_duration = Histogram('http_request_duration_seconds', 'Request duration')

@app.middleware("http")
async def metrics_middleware(request: Request, call_next):
    start = time.time()
    
    response = await call_next(request)
    
    duration = time.time() - start
    request_duration.observe(duration)
    request_count.labels(
        method=request.method,
        endpoint=request.url.path
    ).inc()
    
    return response
```

### Frontend Performance
```typescript
// lib/performance.ts

export const measurePerformance = (name: string, fn: () => void) => {
  const start = performance.now();
  fn();
  const end = performance.now();
  
  console.log(`${name}: ${end - start}ms`);
  
  // Send to analytics
  analytics.track('performance', {
    name,
    duration: end - start,
  });
};
```

---

## Load Testing

```python
# tests/load/locustfile.py

from locust import HttpUser, task, between

class ProteomicsUser(HttpUser):
    wait_time = between(1, 5)
    
    @task
    def upload_file(self):
        self.client.post("/sessions/test-session/upload")
    
    @task
    def get_results(self):
        self.client.get("/sessions/test-session/results")
    
    @task(3)
    def view_page(self):
        self.client.get("/")

# Run: locust -f locustfile.py --host=http://localhost:8000
```

---

## Next Steps

See [09-testing.md](09-testing.md) for testing requirements.
