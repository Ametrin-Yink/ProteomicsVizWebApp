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
| GET | `/api/sessions/{id}/status` | Get processing status |
| POST | `/api/sessions/{id}/process` | Start pipeline |
| GET | `/api/sessions/{id}/results` | Get DE results |
| GET | `/api/sessions/{id}/qc/plots` | Get QC data |
| GET | `/api/sessions/{id}/gsea/{database}` | Get GSEA results |
| WS | `/ws/sessions/{id}` | Real-time updates |

## Key Types

```typescript
interface Session {
  id: string;
  name: string;
  template: string;
  state: 'created' | 'configuring' | 'processing' | 'completed' | 'error';
  config?: SessionConfig;
  files?: { proteomics: string[]; compound?: string };
  created_at: string;
}

interface SessionConfig {
  treatment: string;
  control: string;
  organism: string;
  remove_razor: boolean;
  strict_filtering: boolean;
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
