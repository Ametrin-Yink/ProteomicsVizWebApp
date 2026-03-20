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
- **PDF:** Playwright + reportlab

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
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Terminal 2 - Frontend
cd frontend
npm install
npm run dev

# Access at http://localhost:3000
```

## Documentation

- [AGENTS Knowledge Base](AGENTS/) - Comprehensive development guide
- [Requirements](ProjectPlan/Proteomics%20Visualization%20Web%20App%20requirements.md)
- [Test Requirements](ProjectDocs/test_requirements.md)
- [API Documentation](docs/openapi.yaml)

## Testing

```bash
# Backend tests
cd backend && pytest

# Frontend tests
cd frontend && npm test

# E2E tests
cd frontend && npx playwright test
```

## Project Structure

```
ProteomicsVizWebApp/
├── backend/
│   ├── app/
│   │   ├── api/routes/       # API endpoints (7 modules)
│   │   ├── core/             # Config, exceptions
│   │   ├── db/               # Session store
│   │   ├── models/           # Pydantic models (session, data, analysis)
│   │   ├── services/         # Business logic (11 modules)
│   │   └── utils/            # Utilities (file_parser, validators, helpers)
│   ├── scripts/              # R scripts (msqrob2_protein.R, msqrob2_de.R, verify_r_packages.R)
│   └── tests/                # Test suites (7 modules)
├── frontend/
│   ├── src/
│   │   ├── app/              # Next.js pages (9 pages)
│   │   ├── components/       # React components (35+ components)
│   │   ├── hooks/            # Custom hooks (use-websocket)
│   │   ├── lib/              # Utilities (api, websocket, utils)
│   │   ├── stores/           # Zustand stores (5 stores)
│   │   └── types/            # TypeScript types (5 modules)
│   └── tests/e2e/            # E2E tests (8 suites)
├── AGENTS/                   # Documentation (14 files)
├── ProjectDocs/              # Project documentation
├── SampleData/               # Sample data files
└── ProteinDatabase/          # FASTA and gene mapping files
```

## Implementation Status

### ✅ Completed Components

#### Backend (42 Python files)
- ✅ FastAPI application with CORS and WebSocket support
- ✅ 7 API route modules (sessions, upload, analysis, processing, visualization, reports, compounds)
- ✅ 3 Pydantic model modules
- ✅ 11 service modules (data_processor, msqrob2_wrapper, gsea_service, qc_calculator, etc.)
- ✅ Session store with JSON persistence
- ✅ 3 R scripts for msqrob2 integration
- ✅ 7 test modules (unit + integration)

#### Frontend (51 TypeScript files)
- ✅ 9 Next.js pages (welcome, analysis, processing, visualization, etc.)
- ✅ 35+ React components (UI, session, analysis, processing, visualization)
- ✅ 5 Zustand stores with Immer middleware
- ✅ 5 TypeScript type modules
- ✅ WebSocket hook for real-time updates
- ✅ 8 E2E test suites

### Processing Pipeline

| Step | Description | Status |
|------|-------------|--------|
| 1 | Combine Replicates | ✅ Python/Pandas |
| 2 | Generate Unique PSM | ✅ Python/Pandas |
| 3 | Remove Razor | ✅ Python (optional) |
| 4 | Remove Low Quality | ✅ Python/Pandas |
| 5 | Filter by Criteria | ✅ Python/Pandas |
| 6 | Protein Abundance | ✅ R/msqrob2 |
| 7 | Differential Expression | ✅ R/msqrob2 |
| 8 | QC Metrics | ✅ Python/sklearn |
| 9 | GSEA Analysis | ✅ Python/gseapy |

## Key Features

### Data Processing
- **Filename Parsing:** Automatic extraction of experiment, condition, replicate from `PSM_ExperimentName_Condition_ReplicateNumber.csv`
- **Column Validation:** Validates required columns (Sequence, Modifications, Charge, Contaminant, Master Protein Accessions, Quan Info, Abundance)
- **Quality Control:** Filters contaminants, low-quality PSMs, and applies strict/lenient criteria

### Visualization
- **Volcano Plot:** Interactive with click, box select, and lasso selection modes
- **QC Plots:** PCA, p-value distribution, CV variance, intensity distributions, data completeness
- **GSEA Plots:** Enrichment plots with leading edge genes
- **Colors:** Pink #E73564 (upregulated), Blue #00ADEF (downregulated)

### Session Management
- **Persistent Sessions:** JSON-based storage survives server restart
- **Real-time Updates:** WebSocket connection for live progress
- **Resume Capability:** Can resume from failed steps

## API Endpoints

### Sessions
- `POST /api/sessions` - Create new session
- `GET /api/sessions` - List all sessions
- `GET /api/sessions/{id}` - Get session details
- `PUT /api/sessions/{id}` - Update session
- `DELETE /api/sessions/{id}` - Delete session

### Upload
- `POST /api/sessions/{id}/upload/proteomics` - Upload PSM files
- `POST /api/sessions/{id}/upload/compound` - Upload compound file

### Analysis
- `POST /api/sessions/{id}/start` - Start processing
- `POST /api/sessions/{id}/cancel` - Cancel processing

### Results
- `GET /api/sessions/{id}/results` - Get DE results
- `GET /api/sessions/{id}/qc/plots` - Get QC data
- `GET /api/sessions/{id}/gsea/{database}` - Get GSEA results
- `GET /api/sessions/{id}/protein/{id}/abundance` - Get protein abundance
- `GET /api/sessions/{id}/protein/{id}/psm` - Get PSM data

### WebSocket
- `WS /ws/sessions/{id}` - Real-time updates

## Configuration

### Backend (.env)
```
APP_NAME=Proteomics Visualization API
APP_VERSION=1.0.0
DEBUG=false
HOST=0.0.0.0
PORT=8000
MAX_UPLOAD_SIZE_MB=500
R_EXECUTABLE=Rscript
R_SCRIPT_TIMEOUT=300
CORS_ORIGINS=["http://localhost:3000"]
```

### Frontend (next.config.ts)
- API proxy to backend at localhost:8000
- TypeScript strict mode enabled
- Tailwind CSS with custom colors

## Testing

### Backend Tests (7 modules)
```bash
cd backend
pytest tests/ -v --cov=app --cov-report=html
```

**Test Coverage:**
- Unit tests: file_parser, validators, data_processor
- Integration tests: api, processing, r_integration

### Frontend E2E Tests (8 suites)
```bash
cd frontend
npx playwright test
```

**Test Suites:**
1. 01-welcome.spec.ts - Welcome page
2. 02-data-input.spec.ts - Data upload
3. 03-processing.spec.ts - Processing pipeline
4. 04-results.spec.ts - Results visualization
5. 05-qc-plots.spec.ts - QC plots
6. 06-bioinformatics.spec.ts - GSEA analysis
7. 07-pdf-export.spec.ts - PDF generation
8. 08-session-manager.spec.ts - Session management

## Absolute Red Lines

**CRITICAL REQUIREMENTS (NEVER VIOLATE):**

1. **R Packages** - Never skip msqrob2, QFeatures, limma installation
2. **Filename Pattern** - Must follow `PSM_ExperimentName_Condition_ReplicateNumber.csv`
3. **Minimum Replicates** - At least 3 per condition required
4. **TypeScript** - MUST have `strict: true`
5. **Zustand** - NEVER mutate state directly (use Immer)
6. **R Integration** - Use subprocess (NEVER rpy2)
7. **File Upload** - Maximum 500MB
8. **Python Async** - NEVER blocking I/O in async functions
9. **Type Safety** - NEVER use `as any` or `@ts-ignore`
10. **Data Format** - Transform column-based R output to row-based for frontend

## Documentation

- `AGENTS/01-overview.md` - Project overview
- `AGENTS/02-absolute-red-lines.md` - Critical requirements
- `AGENTS/03-coding-standards.md` - Code conventions
- `AGENTS/04-api-contract.md` - API specification
- `AGENTS/05-state-management.md` - Zustand patterns
- `AGENTS/06-error-handling.md` - Error handling
- `AGENTS/07-security.md` - Security requirements
- `AGENTS/08-performance.md` - Performance targets
- `AGENTS/09-testing.md` - Testing strategy
- `AGENTS/10-processing-pipeline.md` - Pipeline details
- `AGENTS/11-websocket-protocol.md` - WebSocket protocol
- `AGENTS/12-data-validation.md` - Data validation
- `AGENTS/13-lessons-learned.md` - Common issues
- `AGENTS/14-commands.md` - Development commands

## Backup

Latest backup: `D:\CodingWorks\Backup\ProteomicsVizWebApp_Backup_20250316`

## License

MIT License - see LICENSE file for details.
