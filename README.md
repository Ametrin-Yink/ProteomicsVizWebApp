# Proteomics Visualization Web App

Full-stack scientific web application for proteomics data analysis and visualization.

## Features

- **Data Input:** Upload proteomics CSV files with validation
- **Processing Pipeline:** 9-step analysis with real-time progress
- **Visualization:** Interactive volcano plots, QC plots, GSEA results
- **Session Management:** Persistent sessions with resume capability
- **PDF Reports:** Export comprehensive analysis reports

## Tech Stack

- **Frontend:** Next.js 16, React 19, TypeScript, Tailwind CSS, Zustand, Plotly.js
- **Backend:** FastAPI, Python 3.11+, Pydantic, asyncio
- **Analysis:** R 4.3+, msqrob2, QFeatures, limma, gseapy

## Quick Start

### Prerequisites

- Python 3.11+
- Node.js 20+
- R 4.3+

### Install R Packages (CRITICAL)

```bash
Rscript -e "
if (!require('BiocManager', quietly = TRUE))
    install.packages('BiocManager')
BiocManager::install(c('msqrob2', 'QFeatures', 'limma'))
"
```

### Start Development

```bash
# Terminal 1 - Backend
cd backend
.venv/Scripts/python.exe -m uvicorn app.main:app --reload --port 8000

# Terminal 2 - Frontend
cd frontend
npm run dev

# Access at http://localhost:3000
```

## Documentation

- [CLAUDE.md](CLAUDE.md) - Primary guide for AI agents
- [AGENTS/](AGENTS/) - Human-readable developer guides
- [API Spec](docs/openapi.yaml) - OpenAPI/Swagger specification

## Testing

```bash
# Backend (from project root)
backend/.venv/Scripts/python.exe -m pytest Tests/backend/unit -v
backend/.venv/Scripts/python.exe -m pytest Tests/backend/integration -v

# E2E tests
cd Tests && npx playwright test
```

## Project Structure

```
ProteomicsVizWebApp/
├── backend/
│   ├── app/
│   │   ├── api/routes/       # API endpoints (7 modules)
│   │   ├── core/             # Config, exceptions
│   │   ├── db/               # Session store
│   │   ├── models/           # Pydantic models
│   │   ├── services/         # Business logic (11 modules)
│   │   └── utils/            # Validators, parsers
│   └── scripts/              # R scripts
├── frontend/
│   └── src/
│       ├── app/              # Next.js pages
│       ├── components/       # React components (35+)
│       ├── stores/           # Zustand stores (5 stores)
│       └── hooks/            # Custom hooks
├── Tests/                    # All tests (backend, e2e, fixtures)
├── AGENTS/                   # Developer guides (8 files)
└── docs/
    └── openapi.yaml          # API specification
```

## Processing Pipeline

| Step | Description | Technology |
|------|-------------|------------|
| 1-5 | Combine, filter, clean PSM data | Python/Pandas |
| 6 | Protein abundance aggregation | R/msqrob2 |
| 7 | Differential expression analysis | R/msqrob2 |
| 8 | QC metrics (PCA, CV, distributions) | Python/sklearn |
| 9 | Gene Set Enrichment Analysis | Python/gseapy |

## Key Features

### Data Processing
- **Filename Parsing:** Automatic extraction of experiment, condition, replicate from `PSM_ExperimentName_Condition_ReplicateNumber.csv`
- **Quality Control:** Filters contaminants, low-quality PSMs, and applies strict/lenient criteria

### Visualization
- **Volcano Plot:** Interactive with click, box select, and lasso selection
- **QC Plots:** PCA, p-value distribution, CV, intensity distributions, data completeness
- **GSEA Plots:** Enrichment plots with leading edge genes
- **Colors:** Pink `#E73564` (upregulated), Blue `#00ADEF` (downregulated)

### Session Management
- **Persistent Sessions:** JSON-based storage survives server restart
- **Real-time Updates:** WebSocket connection for live progress
- **Resume Capability:** Can resume from failed steps

## API Endpoints

### Sessions
- `POST /api/sessions` - Create new session
- `GET /api/sessions` - List all sessions
- `GET /api/sessions/{id}` - Get session details
- `PUT /api/sessions/{id}/config` - Update session config
- `DELETE /api/sessions/{id}` - Delete session

### Upload
- `POST /api/sessions/{id}/upload/proteomics` - Upload PSM files
- `POST /api/sessions/{id}/upload/compound` - Upload compound file

### Processing & Results
- `POST /api/sessions/{id}/process` - Start processing
- `GET /api/sessions/{id}/status` - Get processing status
- `GET /api/sessions/{id}/results` - Get DE results
- `GET /api/sessions/{id}/qc/plots` - Get QC data
- `GET /api/sessions/{id}/gsea/{database}` - Get GSEA results

### WebSocket
- `WS /ws/sessions/{id}` - Real-time updates

## Critical Requirements

1. **R packages** — msqrob2, QFeatures, limma must be installed
2. **Filename pattern** — `PSM_ExperimentName_Condition_ReplicateNumber.csv`
3. **Minimum replicates** — 3 per condition
4. **TypeScript** — strict mode, no `as any` or `@ts-ignore`
5. **Zustand** — Never mutate state directly
6. **R integration** — Use subprocess, never rpy2
7. **File upload** — Maximum 500MB
8. **Python async** — No blocking I/O in async functions

## AGENTS/ Documentation

| File | Topic |
|------|-------|
| 01-overview.md | Project overview and structure |
| 02-absolute-red-lines.md | Critical requirements |
| 03-coding-standards.md | Code conventions |
| 04-api-contract.md | API specification |
| 05-state-management.md | Zustand patterns |
| 06-error-handling.md | Error handling |
| 09-testing.md | Testing strategy |
| 10-processing-pipeline.md | Pipeline details |
| 13-lessons-learned.md | Common issues and solutions |

## License

MIT License - see LICENSE file for details.
