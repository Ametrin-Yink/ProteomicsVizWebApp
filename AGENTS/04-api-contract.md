# 04 - API Contract & Interface Definition

**Purpose:** Define the contract between frontend and backend to prevent mismatches

---

## API Design Principles

1. **Versioned:** All endpoints under `/api/v1/`
2. **RESTful:** Standard HTTP methods (GET, POST, PUT, DELETE)
3. **Consistent:** Uniform response format
4. **Typed:** Pydantic schemas (backend) ↔ TypeScript types (frontend)
5. **Documented:** OpenAPI/Swagger specification

---

## Base URL

```
Development: http://localhost:8000/api/v1
Production:  https://api.proteomics-app.com/api/v1
```

---

## Authentication

**Current:** No authentication required (single-user local app)

**Future:** JWT token in Authorization header
```
Authorization: Bearer <token>
```

---

## Response Format

### Success Response (2xx)
```json
{
  "data": { ... },           // Response payload
  "meta": {                  // Metadata
    "timestamp": "2026-03-16T10:00:00Z",
    "request_id": "uuid"
  }
}
```

### Error Response (4xx/5xx)
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid file format",
    "details": { ... },       // Additional context
    "timestamp": "2026-03-16T10:00:00Z",
    "request_id": "uuid"
  }
}
```

---

## Endpoints

### Sessions

#### Create Session
```http
POST /sessions
Content-Type: application/json

{
  "name": "DMSO vs Treatment Analysis",
  "template": "protein_pairwise_comparison"
}
```

**Response 201:**
```json
{
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "DMSO vs Treatment Analysis",
    "template": "protein_pairwise_comparison",
    "state": "created",
    "created_at": "2026-03-16T10:00:00Z",
    "updated_at": "2026-03-16T10:00:00Z"
  }
}
```

#### List Sessions
```http
GET /sessions
```

**Response 200:**
```json
{
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "name": "DMSO vs Treatment Analysis",
      "state": "completed",
      "created_at": "2026-03-16T10:00:00Z",
      "updated_at": "2026-03-16T12:00:00Z"
    }
  ],
  "meta": {
    "total": 1,
    "timestamp": "2026-03-16T10:00:00Z"
  }
}
```

#### Get Session
```http
GET /sessions/{session_id}
```

**Response 200:**
```json
{
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "DMSO vs Treatment Analysis",
    "template": "protein_pairwise_comparison",
    "state": "completed",
    "config": {
      "treatment": "INCZ123456",
      "control": "DMSO",
      "organism": "human",
      "remove_razor": true,
      "strict_filtering": false
    },
    "files": {
      "proteomics": [
        "PSM_SampleData_DMSO_1.csv",
        "PSM_SampleData_DMSO_2.csv",
        "PSM_SampleData_INCZ123456_1.csv",
        "PSM_SampleData_INCZ123456_2.csv"
      ],
      "compound": "compound id.csv"
    },
    "created_at": "2026-03-16T10:00:00Z",
    "updated_at": "2026-03-16T12:00:00Z"
  }
}
```

#### Update Session Config
```http
PUT /sessions/{session_id}/config
Content-Type: application/json

{
  "treatment": "INCZ123456",
  "control": "DMSO",
  "organism": "human",
  "remove_razor": true,
  "strict_filtering": false
}
```

**Response 200:** Updated session object

#### Delete Session
```http
DELETE /sessions/{session_id}
```

**Response 204:** No content

---

### File Upload

#### Upload Proteomics Files
```http
POST /sessions/{session_id}/upload/proteomics
Content-Type: multipart/form-data

files: [File, File, ...]
```

**Response 201:**
```json
{
  "data": {
    "uploaded": [
      {
        "filename": "PSM_SampleData_DMSO_1.csv",
        "experiment": "SampleData",
        "condition": "DMSO",
        "replicate": 1,
        "size": 2048576,
        "columns": ["Sequence", "Modifications", "Charge", ...]
      }
    ],
    "errors": []
  }
}
```

#### Upload Compound File
```http
POST /sessions/{session_id}/upload/compound
Content-Type: multipart/form-data

file: File
```

**Response 201:**
```json
{
  "data": {
    "filename": "compound id.csv",
    "size": 1024,
    "compounds": [
      {
        "corp_id": "INCZ123456",
        "smiles": "CC(C)CC1=CC=C(C=C1)C(C)C(O)=O"
      }
    ]
  }
}
```

---

### Processing

#### Start Processing
```http
POST /sessions/{session_id}/process
```

**Response 202:** Accepted
```json
{
  "data": {
    "status": "started",
    "websocket_url": "ws://localhost:8000/ws/sessions/{session_id}"
  }
}
```

#### Get Processing Status
```http
GET /sessions/{session_id}/status
```

**Response 200:**
```json
{
  "data": {
    "state": "processing",
    "current_step": 6,
    "step_name": "protein_abundance",
    "progress": 65,
    "steps": [
      {"step": 1, "name": "combine_replicates", "status": "completed"},
      {"step": 2, "name": "generate_unique_psm", "status": "completed"},
      {"step": 3, "name": "remove_razor", "status": "completed"},
      {"step": 4, "name": "remove_low_quality", "status": "completed"},
      {"step": 5, "name": "filter", "status": "completed"},
      {"step": 6, "name": "protein_abundance", "status": "in_progress"},
      {"step": 7, "name": "differential_expression", "status": "pending"},
      {"step": 8, "name": "qc_metrics", "status": "pending"},
      {"step": 9, "name": "gsea", "status": "pending"}
    ],
    "started_at": "2026-03-16T10:00:00Z",
    "estimated_completion": "2026-03-16T10:05:00Z"
  }
}
```

---

### Results

#### Get Differential Expression Results
```http
GET /sessions/{session_id}/results
```

**Response 200:**
```json
{
  "data": {
    "total_proteins": 2239,
    "significant_proteins": 300,
    "upregulated": 180,
    "downregulated": 120,
    "results": [
      {
        "master_protein_accessions": "P12345",
        "gene_name": "GENE1",
        "log_fc": 2.1,
        "pval": 0.001,
        "adj_pval": 0.005,
        "significant": true
      }
    ]
  },
  "meta": {
    "page": 1,
    "per_page": 25,
    "total": 2239
  }
}
```

**Query Parameters:**
- `significant_only` (boolean): Filter to significant only
- `page` (integer): Page number
- `per_page` (integer): Items per page
- `sort_by` (string): Column to sort by
- `sort_order` (string): 'asc' or 'desc'

---

### QC Plots

#### Get QC Plot Data
```http
GET /sessions/{session_id}/qc/plots
```

**⚠️ CRITICAL:** Endpoint is `/qc/plots` NOT `/qc/data`

**Response 200:**
```json
{
  "data": {
    "pca": {
      "samples": ["DMSO_1", "DMSO_2", "INCZ_1", "INCZ_2"],
      "pc1": [1.0, 1.2, -0.9, -1.1],
      "pc2": [0.5, 0.3, -0.4, -0.6],
      "conditions": ["DMSO", "DMSO", "INCZ123456", "INCZ123456"],
      "pc1_variance": 45.2,
      "pc2_variance": 23.8
    },
    "pvalue_distribution": {
      "bins": [0.0, 0.05, 0.1, ..., 1.0],
      "counts": [150, 80, 60, ...]
    },
    "psm_cv": {
      "DMSO": [0.15, 0.18, 0.12, ...],
      "INCZ123456": [0.16, 0.19, 0.14, ...]
    },
    "intensity_distributions": {
      "psm": {
        "DMSO": {"replicate_1": [...], "replicate_2": [...]},
        "INCZ123456": {"replicate_1": [...], "replicate_2": [...]}
      },
      "protein": {
        "DMSO": [...],
        "INCZ123456": [...]
      }
    },
    "data_completeness": {
      "DMSO_1": {"missing": 150, "present": 4850},
      "DMSO_2": {"missing": 120, "present": 4880},
      ...
    }
  }
}
```

**Note:** Frontend must transform column-based to row-based for Plotly.

---

### Bioinformatics (GSEA)

#### Get GSEA Results
```http
GET /sessions/{session_id}/gsea/{database}
```

**Path Parameters:**
- `database`: One of `go_bp`, `go_mf`, `go_cc`, `kegg`, `reactome`

**Response 200:**
```json
{
  "data": {
    "database": "GO_Biological_Process_2021",
    "total_pathways": 500,
    "significant_pathways": 45,
    "overrepresented": 30,
    "underrepresented": 15,
    "results": [
      {
        "term": "GO:0001234",
        "name": "cellular response to stress",
        "es": 0.85,
        "nes": 1.23,
        "pval": 0.001,
        "fdr": 0.05,
        "lead_genes": ["GENE1", "GENE2", "GENE3"],
        "matched_genes": 25
      }
    ]
  },
  "meta": {
    "page": 1,
    "per_page": 25,
    "total": 500
  }
}
```

**Query Parameters:**
- `significant_only` (boolean): Filter to |NES| >= 1 and FDR < 0.05
- `page` (integer)
- `per_page` (integer)
- `sort_by` (string): 'nes', 'pval', 'fdr'

---

### Reports

#### Generate PDF Report
```http
POST /sessions/{session_id}/reports
```

**Response 202:** Accepted
```json
{
  "data": {
    "status": "generating",
    "report_id": "report-uuid"
  }
}
```

#### Download Report
```http
GET /sessions/{session_id}/reports/{report_id}
```

**Response 200:** `application/pdf`

---

## TypeScript Types (Frontend)

```typescript
// types/api.ts

// Base response
interface ApiResponse<T> {
  data: T;
  meta: {
    timestamp: string;
    request_id: string;
  };
}

interface ApiError {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    timestamp: string;
    request_id: string;
  };
}

// Session types
interface Session {
  id: string;
  name: string;
  template: string;
  state: 'created' | 'configuring' | 'processing' | 'completed' | 'error';
  config?: SessionConfig;
  files?: SessionFiles;
  created_at: string;
  updated_at: string;
}

interface SessionConfig {
  treatment: string;
  control: string;
  organism: string;
  remove_razor: boolean;
  strict_filtering: boolean;
}

// QC types
interface QCData {
  pca?: {
    samples: string[];
    pc1: number[];
    pc2: number[];
    conditions: string[];
    pc1_variance: number;
    pc2_variance: number;
  };
  pvalue_distribution?: {
    bins: number[];
    counts: number[];
  };
  // ... other fields optional
}

// Transform to row-based for Plotly
interface PCAPoint {
  sample: string;
  pc1: number;
  pc2: number;
  condition: string;
}
```

---

## Pydantic Schemas (Backend)

```python
# schemas/session.py
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime

class SessionConfig(BaseModel):
    treatment: str = Field(..., min_length=1)
    control: str = Field(..., min_length=1)
    organism: str = Field(..., pattern=r'^[a-z]+$')
    remove_razor: bool = False
    strict_filtering: bool = False
    
    @validator('control')
    def control_differs_from_treatment(cls, v, values):
        if 'treatment' in values and v == values['treatment']:
            raise ValueError('Control must differ from treatment')
        return v

class Session(BaseModel):
    id: str
    name: str
    template: str
    state: str
    config: Optional[SessionConfig]
    files: Optional[dict]
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True

# schemas/qc.py
class QCData(BaseModel):
    pca: Optional[dict]
    pvalue_distribution: Optional[dict]
    psm_cv: Optional[dict]
    intensity_distributions: Optional[dict]
    data_completeness: Optional[dict]
```

---

## WebSocket Protocol

See [11-websocket-protocol.md](11-websocket-protocol.md) for detailed WebSocket specification.

---

## Versioning Strategy

### Current: v1
All endpoints prefixed with `/api/v1/`

### Future Changes
- Add `/api/v2/` for breaking changes
- Maintain `/api/v1/` for backward compatibility
- Deprecate v1 with 6-month notice

---

## Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `VALIDATION_ERROR` | 400 | Invalid input data |
| `FILE_TOO_LARGE` | 400 | File exceeds 500MB |
| `INVALID_FILE_FORMAT` | 400 | CSV missing required columns |
| `SESSION_NOT_FOUND` | 404 | Session ID doesn't exist |
| `PROCESSING_ERROR` | 500 | Pipeline step failed |
| `R_SCRIPT_ERROR` | 500 | R subprocess failed |

---

## Next Steps

See [05-state-management.md](05-state-management.md) for state management patterns.
