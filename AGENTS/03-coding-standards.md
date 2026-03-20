# 03 - Coding Standards & Style Guidelines

**Purpose:** Ensure consistent, maintainable code across the project

---

## Naming Conventions

### TypeScript / React

| Type | Convention | Example |
|------|------------|---------|
| Components | PascalCase | `VolcanoPlot.tsx`, `SessionManager.tsx` |
| Hooks | camelCase with 'use' prefix | `useSession.ts`, `useProcessing.ts` |
| Types/Interfaces | PascalCase, descriptive | `DiffExpressionResult`, `SessionConfig` |
| Constants | UPPER_SNAKE_CASE | `MAX_UPLOAD_SIZE`, `API_BASE_URL` |
| Functions | camelCase, verb-based | `uploadFile`, `processData` |
| Variables | camelCase | `sessionId`, `isLoading` |
| Files (non-components) | kebab-case | `api-client.ts`, `data-utils.ts` |
| Enums | PascalCase | `ProcessingStatus`, `SessionState` |
| Enum values | UPPER_SNAKE_CASE | `PENDING`, `COMPLETED` |

**Examples:**
```typescript
// Component
const VolcanoPlot: React.FC<VolcanoPlotProps> = ({ data }) => { ... }

// Hook
const useSession = (sessionId: string) => { ... }

// Type
interface DiffExpressionResult {
  proteinAccession: string;
  logFC: number;
  pval: number;
}

// Constant
const MAX_UPLOAD_SIZE = 500 * 1024 * 1024;

// Function
const uploadFile = async (file: File): Promise<UploadResult> => { ... }
```

### Python

| Type | Convention | Example |
|------|------------|---------|
| Classes | PascalCase | `SessionManager`, `DataProcessor` |
| Functions | snake_case | `process_file`, `validate_upload` |
| Variables | snake_case | `session_id`, `is_loading` |
| Constants | UPPER_SNAKE_CASE | `MAX_UPLOAD_SIZE`, `SESSION_BASE_PATH` |
| Private methods | _leading_underscore | `_validate_file`, `_process_chunk` |
| Files | snake_case.py | `session_manager.py`, `data_processor.py` |
| Modules | snake_case | `api.routes`, `core.config` |

**Examples:**
```python
# Class
class SessionManager:
    def __init__(self):
        self._sessions: Dict[str, Session] = {}

# Function
def process_file(file_path: Path) -> ProcessingResult:
    pass

# Private method
def _validate_file(self, file: UploadFile) -> None:
    pass

# Constant
MAX_UPLOAD_SIZE = 500 * 1024 * 1024
```

---

## File Organization

### Frontend Structure

```
frontend/src/
├── app/                          # Next.js App Router
│   ├── page.tsx                  # Welcome page
│   ├── layout.tsx                # Root layout
│   ├── analysis/
│   │   ├── page.tsx              # Data input page
│   │   ├── processing/
│   │   │   └── page.tsx          # Processing page
│   │   └── visualization/
│   │       └── page.tsx          # Results page
│   └── globals.css
├── components/                   # React components
│   ├── ui/                       # shadcn/ui components
│   │   ├── button.tsx
│   │   ├── table.tsx
│   │   └── ...
│   ├── plots/                    # Plotly visualization
│   │   ├── volcano-plot.tsx
│   │   ├── pca-plot.tsx
│   │   └── ...
│   ├── forms/                    # Form components
│   │   ├── file-upload.tsx
│   │   └── config-form.tsx
│   ├── layout/                   # Layout components
│   │   ├── sidebar.tsx
│   │   └── header.tsx
│   └── analysis/                 # Analysis-specific
│       ├── protein-info.tsx
│       └── pathway-table.tsx
├── hooks/                        # Custom React hooks
│   ├── use-session.ts
│   ├── use-processing.ts
│   └── use-api.ts
├── lib/                          # Utilities, API clients
│   ├── api.ts                    # API client
│   ├── utils.ts                  # General utilities
│   └── constants.ts              # Constants
├── stores/                       # Zustand stores
│   ├── session-store.ts
│   ├── ui-store.ts
│   └── data-store.ts
├── types/                        # TypeScript definitions
│   ├── session.ts
│   ├── data.ts
│   └── api.ts
└── utils/                        # Helper functions
    ├── formatters.ts
    └── validators.ts
```

### Backend Structure

```
backend/
├── app/
│   ├── __init__.py
│   ├── main.py                   # FastAPI entry point
│   ├── api/
│   │   ├── __init__.py
│   │   ├── deps.py               # FastAPI dependencies
│   │   └── routes/
│   │       ├── __init__.py
│   │       ├── sessions.py       # Session CRUD
│   │       ├── upload.py         # File upload
│   │       ├── processing.py     # Processing endpoints
│   │       ├── visualization.py  # Plot data
│   │       └── reports.py        # PDF reports
│   ├── core/
│   │   ├── __init__.py
│   │   ├── config.py             # App configuration
│   │   ├── exceptions.py         # Custom exceptions
│   │   └── logging.py            # Logging setup
│   ├── models/
│   │   ├── __init__.py
│   │   ├── session.py            # Session models
│   │   └── data.py               # Data models
│   ├── schemas/
│   │   ├── __init__.py
│   │   ├── session.py            # Pydantic schemas
│   │   ├── data.py
│   │   └── responses.py          # API response schemas
│   ├── services/
│   │   ├── __init__.py
│   │   ├── session_manager.py
│   │   ├── data_processor.py     # Steps 1-9
│   │   ├── msqrob2_wrapper.py    # R integration
│   │   ├── gsea_service.py       # GSEA analysis
│   │   ├── qc_calculator.py      # QC metrics
│   │   └── report_generator.py   # PDF generation
│   ├── db/
│   │   ├── __init__.py
│   │   └── session_store.py      # Session persistence
│   └── utils/
│       ├── __init__.py
│       ├── file_parser.py
│       └── validators.py
├── scripts/                      # R scripts
│   ├── msqrob2_protein.R
│   ├── msqrob2_de.R
│   └── install_r_packages.R
├── sessions/                     # Session data storage
├── protein_database/             # Organism databases
└── tests/
    ├── __init__.py
    ├── conftest.py
    ├── unit/
    ├── integration/
    └── e2e/
```

---

## Code Style Rules

### TypeScript / React

#### Component Structure
```typescript
// 1. Imports (grouped: React, external, internal)
import React, { useState, useEffect } from 'react';
import { useSessionStore } from '@/stores/session-store';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';

// 2. Types/Interfaces
interface VolcanoPlotProps {
  data: DiffExpressionResult[];
  onSelect: (protein: string) => void;
}

// 3. Component (export default at bottom)
const VolcanoPlot: React.FC<VolcanoPlotProps> = ({ data, onSelect }) => {
  // State
  const [selected, setSelected] = useState<string[]>([]);
  
  // Hooks
  const { updateSelection } = useSessionStore();
  
  // Effects
  useEffect(() => {
    updateSelection(selected);
  }, [selected, updateSelection]);
  
  // Handlers
  const handleClick = (protein: string) => {
    setSelected(prev => [...prev, protein]);
    onSelect(protein);
  };
  
  // Render
  return (
    <div className="volcano-plot">
      {/* ... */}
    </div>
  );
};

// 4. Export
export default VolcanoPlot;
```

#### Import Order
```typescript
// 1. React imports
import React, { useState, useEffect } from 'react';

// 2. External libraries
import { useQuery } from '@tanstack/react-query';
import Plot from 'react-plotly.js';

// 3. Internal absolute imports (@/)
import { api } from '@/lib/api';
import { useSessionStore } from '@/stores/session-store';

// 4. Internal relative imports (./)
import { ProteinInfo } from './protein-info';
import { useProteinData } from '../hooks/use-protein-data';

// 5. Types
import type { DiffExpressionResult } from '@/types/data';
```

#### Error Handling
```typescript
// MUST use typed errors
try {
  await api.uploadFile(file);
} catch (error) {
  if (error instanceof APIError) {
    // Known error type
    showToast({
      type: 'error',
      message: error.message,
    });
  } else if (error instanceof ValidationError) {
    showToast({
      type: 'warning',
      message: `Validation failed: ${error.message}`,
    });
  } else {
    // Unknown error
    logger.error('Unexpected error:', error);
    showToast({
      type: 'error',
      message: 'An unexpected error occurred. Please try again.',
    });
  }
}
```

### Python

#### Function Structure
```python
def process_file(
    file_path: Path,
    session_id: str,
    config: ProcessingConfig
) -> ProcessingResult:
    """
    Process a proteomics data file.
    
    Args:
        file_path: Path to the uploaded file
        session_id: Unique session identifier
        config: Processing configuration
    
    Returns:
        ProcessingResult with output paths and metadata
    
    Raises:
        ValidationError: If file format is invalid
        ProcessingError: If processing fails
    """
    # 1. Validation
    _validate_file(file_path)
    
    # 2. Setup
    session_dir = get_session_dir(session_id)
    
    # 3. Processing
    try:
        result = _process_with_config(file_path, config)
    except Exception as e:
        logger.error(f"Processing failed: {e}", extra={
            "session_id": session_id,
            "file": file_path.name,
        })
        raise ProcessingError(f"Failed to process file: {e}")
    
    # 4. Cleanup/Return
    return ProcessingResult(
        output_path=session_dir / "output.tsv",
        metadata=result.metadata,
    )
```

#### Type Hints (REQUIRED)
```python
from typing import Optional, List, Dict, Tuple
from pathlib import Path

# Function signatures MUST have type hints
def calculate_qc_metrics(
    data: pd.DataFrame,
    conditions: List[str]
) -> Dict[str, QCMetric]:
    pass

# Optional types
def find_session(session_id: str) -> Optional[Session]:
    pass

# Return None explicitly if applicable
def validate_upload(file: UploadFile) -> Optional[str]:
    """Returns error message if invalid, None if valid."""
    pass
```

#### Docstrings (Google Style)
```python
def aggregate_proteins(
    peptide_data: pd.DataFrame,
    protein_column: str = "Proteins"
) -> pd.DataFrame:
    """Aggregate peptide-level data to protein level.
    
    Uses robust summarization (M-estimation) to calculate protein
    abundances from peptide abundances.
    
    Args:
        peptide_data: DataFrame with peptide abundances
        protein_column: Column name containing protein group IDs
    
    Returns:
        DataFrame with protein-level abundances
    
    Raises:
        ValueError: If protein_column not found in data
        ProcessingError: If aggregation fails
    
    Example:
        >>> peptides = pd.read_csv("peptides.tsv", sep="\t")
        >>> proteins = aggregate_proteins(peptides)
        >>> print(proteins.head())
    """
    pass
```

---

## Error Handling Patterns

### Frontend Error Boundary
```typescript
// components/error-boundary.tsx
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error?: Error }
> {
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    logger.error('React error boundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return <ErrorFallback error={this.state.error} />;
    }
    return this.props.children;
  }
}
```

### Backend Exception Hierarchy
```python
# core/exceptions.py
class AppException(Exception):
    """Base application exception."""
    pass

class ValidationError(AppException):
    """Invalid input data."""
    status_code = 400

class ProcessingError(AppException):
    """Processing pipeline failure."""
    status_code = 500
    
class NotFoundError(AppException):
    """Resource not found."""
    status_code = 404

# Usage in FastAPI
@app.exception_handler(AppException)
async def app_exception_handler(request: Request, exc: AppException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": str(exc), "type": exc.__class__.__name__},
    )
```

---

## Logging Standards

### Frontend Logging
```typescript
// lib/logger.ts
import { createLogger } from 'logging-library';

export const logger = createLogger({
  level: process.env.NODE_ENV === 'production' ? 'warn' : 'debug',
  format: 'json',
});

// Usage
logger.info('Session created', { sessionId, userId });
logger.warn('Upload slow', { duration, fileSize });
logger.error('Processing failed', { error, sessionId, step });
```

### Backend Logging
```python
# core/logging.py
import logging
import json
from pythonjsonlogger import jsonlogger

# Structured JSON logging
logHandler = logging.StreamHandler()
formatter = jsonlogger.JsonFormatter(
    '%(timestamp)s %(level)s %(name)s %(message)s',
    rename_fields={'levelname': 'level', 'asctime': 'timestamp'}
)
logHandler.setFormatter(formatter)

logger = logging.getLogger("proteomics")
logger.addHandler(logHandler)
logger.setLevel(logging.INFO)

# Usage with context
logger.info("Processing started", extra={
    "session_id": session_id,
    "step": "protein_abundance",
    "input_rows": len(df),
})

logger.error("Processing failed", extra={
    "session_id": session_id,
    "step": "protein_abundance",
    "error": str(e),
    "traceback": traceback.format_exc(),
})
```

---

## Comments & Documentation

### When to Comment
- **DO** comment: Complex algorithms, business logic, workarounds
- **DON'T** comment: Obvious code (e.g., `i++  // increment i`)

### Comment Format
```typescript
// Good: Explains WHY, not WHAT
// Use binary search because dataset is sorted and large
const index = binarySearch(sortedData, target);

// Bad: Obvious
// Loop through items
for (const item of items) { ... }
```

### TODO Comments
```typescript
// TODO: Implement caching for large datasets
// FIXME: Handle edge case when n=0
// HACK: Workaround for library bug, remove after upgrade
```

---

## Next Steps

See [04-api-contract.md](04-api-contract.md) for API specifications.
