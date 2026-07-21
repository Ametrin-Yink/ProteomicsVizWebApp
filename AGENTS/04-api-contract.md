# 04 - API Contract

API surfaces:

- Session and application API: `/api/sessions`, `/api/files`, and related routes
  on the private application listener.
- Report management API: `/api/reports` on the private application listener.
- Shared capability API: `/api/shared-reports/{share_token}` on the public report
  listener.

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

## Report endpoints

| Method | Path | Exposure | Description |
|---|---|---|---|
| POST | `/api/sessions/{id}/reports/generate` | Private | Atomically publish a completed session snapshot and return its internal ID and share token |
| GET | `/api/reports` | Private | List reports, including management IDs and share tokens |
| PATCH | `/api/reports/{report_id}` | Private | Rename a report |
| DELETE | `/api/reports/{report_id}` | Private | Delete a report |
| POST | `/api/reports/{report_id}/share-token/rotate` | Private | Revoke the old link and return a replacement |
| GET | `/api/shared-reports/{share_token}` | Public capability | Get sanitized report metadata and copied session configuration |
| GET | `/api/shared-reports/{share_token}/results` | Public capability | Get differential-expression results |
| GET | `/api/shared-reports/{share_token}/qc/plots` | Public capability | Get QC data |
| GET/POST | `/api/shared-reports/{share_token}/gsea/...` | Public capability | Read or run bounded report GSEA |
| GET/POST | `/api/shared-reports/{share_token}/bionet/...` | Public capability | Read or run bounded report BioNet |
| GET/POST | `/api/shared-reports/{share_token}/compare/...` | Public capability | Read or run bounded report comparisons |
| GET | `/api/shared-reports/{share_token}/protein/{protein_id}/...` | Public capability | Get abundance or peptide data from the report |

The shared surface intentionally has no list, upload, session creation, rename,
delete, link rotation, task cancellation, or visualization-state PATCH endpoint.
Do not accept an internal `report_id` on shared routes. Invalid and revoked tokens
return the same 404 response.

Shared users can write derived GSEA, BioNet, and Compare artifacts within the one
report granted by the token. Input comparisons must exist in that report, request
sizes must stay bounded, and heavy work must use `TaskManager`. Viewer markers and
filters are local state and must not be persisted to the report.

See `docs/REPORT_SHARING.md` for the bearer-capability model and public gateway
allowlist. The generated route-level contract is `docs/api/openapi.yaml`.

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
