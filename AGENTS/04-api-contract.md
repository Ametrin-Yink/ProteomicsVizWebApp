# 04 - API Contract

Base URL: `http://localhost:8000/api/sessions`

## Response Format

**Success (2xx):**
```json
{ "id": "...", "name": "...", "state": "created", "config": null, "files": { "proteomics": [] } }
```

**Error (4xx/5xx):**
```json
{ "error": { "code": "SESSION_NOT_FOUND", "message": "...", "details": {} } }
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/sessions` | Create session |
| GET | `/api/sessions` | List sessions |
| GET | `/api/sessions/{id}` | Get session details |
| PUT | `/api/sessions/{id}/config` | Update config |
| DELETE | `/api/sessions/{id}` | Delete session |
| POST | `/api/sessions/{id}/upload/proteomics` | Upload PSM files |
| GET | `/api/sessions/{id}/status` | Get processing status + queue position |
| POST | `/api/sessions/{id}/process` | Start pipeline |
| GET | `/api/sessions/{id}/logs` | Get processing logs |
| POST | `/api/sessions/{id}/retry` | Replay a failed analysis from step 1 |
| GET | `/api/sessions/{id}/results` | Get DE results |
| GET | `/api/sessions/{id}/qc/plots` | Get QC data |
| GET | `/api/sessions/{id}/gsea/{database}` | Get GSEA results |
| POST | `/api/sessions/{id}/gsea/run` | Run GSEA on-demand per comparison |
| POST | `/api/sessions/{id}/compare/protein` | Protein correlation analysis |
| POST | `/api/sessions/{id}/compare/matrix` | Similarity matrix clustering |
| GET | `/api/sessions/{id}/compare/status` | Compare task status |
| GET | `/api/sessions/{id}/compare/result` | Compare task results |
| GET | `/api/organisms` | List supported organisms |
| WS | `/ws/sessions/{id}` | Real-time pipeline updates |

## Key Types

```typescript
interface Session {
  id: string;
  name: string;
  template: string;
  pipeline: 'msqrob2' | 'msstats';
  state: 'created' | 'configuring' | 'queued' | 'processing' | 'completed' | 'error' | 'cancelled';
  config?: SessionConfig;
  files?: { proteomics: string[] };
  created_at: string;
}

interface SessionConfig {
  treatment?: string;
  control?: string;
  organism?: string;
  resolve_shared_peptides: boolean;
  max_missing_fraction_per_condition: number; // 0..1
  min_psms_per_protein: number; // 1..10 distinct surviving PSMs
  comparisons?: Array<{ group1: Record<string, string>; group2: Record<string, string> }>;
  // MSstats and msqrob2 parameters (normalization, imputation, aggregation, etc.)
  msstats_normalization?: string;
  msqrob2_normalization?: string;
}
```

## Error Codes

| Code | Status | Meaning |
|------|--------|---------|
| VALIDATION_ERROR | 400 | Invalid input |
| FILE_TOO_LARGE | 400 | > 500MB |
| INVALID_FILE_FORMAT | 400 | Missing required columns |
| SESSION_NOT_FOUND | 404 | Session doesn't exist |
| PROCESSING_ERROR | 500 | Pipeline step failed |
| R_SCRIPT_ERROR | 500 | R subprocess failed |

**CRITICAL:** Endpoint is `/qc/plots` NOT `/qc/data`. Never change endpoint URLs without updating frontend.
