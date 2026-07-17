# 06 - Error Handling & Recovery

**Purpose:** Define error classification, handling patterns, and recovery procedures

---

## Error Classification

| Type | Example | User Action | System Action | Severity |
|------|---------|-------------|---------------|----------|
| **Validation** | Invalid CSV format | Fix and re-upload | Reject file, show message | Low |
| **Configuration** | Treatment == Control | Change selection | Block start, show warning | Low |
| **Processing** | R script failure | Retry or abort | Save state, allow retry | Medium |
| **Resource** | Out of memory | Use smaller dataset | Clean up, notify admin | High |
| **External** | Biomart offline | Continue with fallback | Log warning, use fallback | Medium |
| **System** | Database corruption | Contact support | Alert admin, preserve data | Critical |

---

## Frontend Error Handling

### Error Boundary
```typescript
// components/error-boundary.tsx
import React from 'react';
import { logger } from '@/lib/logger';

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    logger.error('React error boundary caught:', {
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div className="error-fallback">
            <h2>Something went wrong</h2>
            <p>Please refresh the page or contact support.</p>
            <button onClick={() => window.location.reload()}>
              Refresh Page
            </button>
          </div>
        )
      );
    }

    return this.props.children;
  }
}
```

### API Error Handling
```typescript
// lib/api.ts
import { useUIStore } from '@/stores/ui-store';

class APIError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public code: string
  ) {
    super(message);
    this.name = 'APIError';
  }
}

export const handleApiError = (error: unknown): never => {
  if (error instanceof APIError) {
    // Show user-friendly message
    const { addToast } = useUIStore.getState();

    switch (error.code) {
      case 'VALIDATION_ERROR':
        addToast({
          type: 'warning',
          message: `Validation failed: ${error.message}`,
        });
        break;
      case 'FILE_TOO_LARGE':
        addToast({
          type: 'error',
          message: 'File too large. Maximum size is 500MB.',
        });
        break;
      case 'PROCESSING_ERROR':
        addToast({
          type: 'error',
          message: 'Processing failed. You can retry the analysis.',
          duration: 10000,
        });
        break;
      default:
        addToast({
          type: 'error',
          message: 'An unexpected error occurred. Please try again.',
        });
    }

    throw error;
  }

  // Unknown error
  logger.error('Unexpected API error:', error);
  throw new Error('An unexpected error occurred');
};
```

### Async Action Error Handling
```typescript
// hooks/use-session-actions.ts
export const useSessionActions = () => {
  const { setError, setLoading } = useSessionStore();
  const { addToast } = useUIStore();

  const createSession = async (config: SessionConfig) => {
    setLoading(true);
    setError(null);

    try {
      const session = await api.sessions.create(config);
      return session;
    } catch (error) {
      if (error instanceof APIError) {
        setError(error.message);
        addToast({
          type: 'error',
          message: error.message,
        });
      } else {
        setError('Failed to create session');
        addToast({
          type: 'error',
          message: 'Failed to create session. Please try again.',
        });
      }
      throw error;
    } finally {
      setLoading(false);
    }
  };

  return { createSession };
};
```

---

## Backend Error Handling

### Exception Hierarchy
```python
# core/exceptions.py

class AppException(Exception):
    """Base application exception."""
    status_code = 500
    code = "INTERNAL_ERROR"

    def __init__(self, message: str, details: Optional[dict] = None):
        self.message = message
        self.details = details or {}
        super().__init__(self.message)

class ValidationError(AppException):
    """Invalid input data."""
    status_code = 400
    code = "VALIDATION_ERROR"

class FileTooLargeError(AppException):
    """File exceeds size limit."""
    status_code = 400
    code = "FILE_TOO_LARGE"

class InvalidFileFormatError(AppException):
    """CSV missing required columns."""
    status_code = 400
    code = "INVALID_FILE_FORMAT"

class SessionNotFoundError(AppException):
    """Session ID doesn't exist."""
    status_code = 404
    code = "SESSION_NOT_FOUND"

class ProcessingError(AppException):
    """Processing pipeline failure."""
    status_code = 500
    code = "PROCESSING_ERROR"

    def __init__(self, message: str, step: int, recoverable: bool = True):
        super().__init__(message)
        self.step = step
        self.recoverable = recoverable

class RScriptError(AppException):
    """R subprocess failed."""
    status_code = 500
    code = "R_SCRIPT_ERROR"

class ExternalAPIError(AppException):
    """External API (biomart) failed."""
    status_code = 503
    code = "EXTERNAL_API_ERROR"
```

### FastAPI Exception Handlers
```python
# core/exceptions.py

from fastapi import Request
from fastapi.responses import JSONResponse

async def app_exception_handler(request: Request, exc: AppException):
    """Handle all application exceptions."""
    logger.error(
        f"Exception: {exc.code}",
        extra={
            "path": request.url.path,
            "method": request.method,
            "code": exc.code,
            "message": exc.message,
        }
    )

    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": {
                "code": exc.code,
                "message": exc.message,
                "details": exc.details,
                "timestamp": datetime.utcnow().isoformat(),
                "request_id": request.state.request_id,
            }
        }
    )

# Register in main.py
app.add_exception_handler(AppException, app_exception_handler)
```

### Service Layer Error Handling
```python
# services/data_processor.py

class ProcessingPipeline:
    def __init__(self, session_id: str):
        self.session_id = session_id
        self.state = self.load_state()

    async def run(self, start_from_step: Optional[int] = None):
        """Run processing pipeline with error recovery."""
        step = start_from_step or self.state.last_completed_step + 1

        for step_num in range(step, 10):
            try:
                result = await self.run_step(step_num)
                self.state.mark_completed(step_num, result)
                self.save_state()

            except Exception as e:
                self.state.mark_failed(step_num, str(e))
                self.save_state()

                # Determine if recoverable
                recoverable = not isinstance(e, (MemoryError, SystemError))

                logger.error(
                    f"Step {step_num} failed",
                    extra={
                        "session_id": self.session_id,
                        "step": step_num,
                        "error": str(e),
                        "recoverable": recoverable,
                    }
                )

                raise ProcessingError(
                    f"Step {step_num} failed: {e}",
                    step=step_num,
                    recoverable=recoverable
                )

    async def run_step(self, step_num: int):
        """Run a single processing step."""
        step_runners = {
            1: self._combine_replicates,
            2: self._generate_unique_psm,
            3: self._remove_razor,
            4: self._remove_low_quality,
            5: self._filter,
            6: self._protein_abundance,
            7: self._differential_expression,
            8: self._qc_metrics,
            9: self._gsea,
        }

        runner = step_runners.get(step_num)
        if not runner:
            raise ValueError(f"Invalid step: {step_num}")

        return await runner()
```

---

## Recovery Procedures

### Processing Recovery

Retries are clean full replays, not step-level resumes. The retry route accepts
only errored sessions, revalidates their configuration and uploaded files, then
schedules the normal pipeline from step 1. `PipelineState.mark_started()` clears
the prior attempt's state summary before execution. On-disk inputs and result
artifacts remain in place, so configuration changes before retry require explicit
artifact reconciliation and are not currently supported.

### Session Recovery
```python
# services/session_manager.py

async def recover_session(session_id: str) -> Session:
    """Recover a session after server restart."""
    session = await load_session(session_id)

    if session.state == 'processing':
        # Check if processing actually running
        if not is_processing_running(session_id):
            # Mark as error, allow retry
            session.state = 'error'
            session.error = 'Processing interrupted'
            await save_session(session)

    return session
```

---

## User-Facing Error Messages

### Guidelines
1. **Be specific:** "CSV missing required column 'Sequence'"
2. **Be actionable:** "Click 'Retry' to attempt again"
3. **Provide context:** "Processing failed at Step 6 (Protein Abundance)"
4. **Suggest next steps:** "Contact support if the problem persists"

### Message Templates
```typescript
const errorMessages: Record<string, (details?: any) => string> = {
  VALIDATION_ERROR: (details) =>
    `Validation failed: ${details.field} - ${details.message}`,

  FILE_TOO_LARGE: () =>
    'File too large. Maximum size is 500MB. Please compress or split your file.',

  INVALID_FILE_FORMAT: (details) =>
    `Invalid file format: ${details.reason}. Required columns: ${details.required.join(', ')}`,

  PROCESSING_ERROR: (details) =>
    `Processing failed at Step ${details.step} (${details.stepName}). ${details.recoverable ? 'You can retry the analysis.' : 'Please contact support.'}`,

  SESSION_NOT_FOUND: () =>
    'Session not found. It may have been deleted or expired.',

  NETWORK_ERROR: () =>
    'Network error. Please check your connection and try again.',

  UNKNOWN_ERROR: () =>
    'An unexpected error occurred. Please try again or contact support.',
};
```

---

## Logging

### Structured Logging
```python
# core/logging.py

import logging
import json
from pythonjsonlogger import jsonlogger

def setup_logging():
    """Setup structured JSON logging."""
    logHandler = logging.StreamHandler()
    formatter = jsonlogger.JsonFormatter(
        '%(timestamp)s %(level)s %(name)s %(message)s %(correlation_id)s',
        rename_fields={
            'levelname': 'level',
            'asctime': 'timestamp'
        }
    )
    logHandler.setFormatter(formatter)

    logger = logging.getLogger("proteomics")
    logger.addHandler(logHandler)
    logger.setLevel(logging.INFO)

    return logger

logger = setup_logging()

# Usage with context
logger.info(
    "Processing started",
    extra={
        "session_id": session_id,
        "step": "protein_abundance",
        "input_rows": len(df),
        "correlation_id": correlation_id,
    }
)

logger.error(
    "Processing failed",
    extra={
        "session_id": session_id,
        "step": "protein_abundance",
        "error": str(e),
        "traceback": traceback.format_exc(),
        "correlation_id": correlation_id,
    }
)
```

---

## Next Steps

See [07-testing.md](07-testing.md) for testing guidelines.
