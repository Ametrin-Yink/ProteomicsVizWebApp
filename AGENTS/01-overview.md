# 01 - Project Overview

Full-stack scientific web application for proteomics data analysis and visualization. Researchers upload PSM (peptide-spectrum match) CSV files, configure experimental conditions, and get differential protein abundance analysis with interactive visualizations.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS v4, Zustand (4 stores with Immer), Plotly.js, Cytoscape.js, Radix UI |
| Backend | FastAPI, Python 3.12, Pydantic v2, asyncio, scipy, scikit-learn |
| Analysis | R 4.5+, msqrob2, QFeatures, limma, MSstats, MSstatsBioNet (Bioconductor) |
| GSEA | gseapy (on-demand, not a pipeline step) |
| Testing | pytest (backend), Playwright (E2E) |

## Project Structure

```
ProteomicsVizWebApp/
├── backend/
│   ├── app/
│   │   ├── api/routes/        # 8 route modules (sessions, upload, analysis, processing, visualization, reports, compounds, compare)
│   │   ├── core/              # config, exceptions
│   │   ├── db/                # JSON session store
│   │   ├── models/            # Pydantic models
│   │   ├── schemas/           # Request/response schemas
│   │   ├── services/          # Business logic (pipeline engine, task manager, R wrappers, compare, bionet, GSEA)
│   │   │   └── steps/          # Individual pipeline step handlers (10 files + helpers)
│   │   └── utils/             # validators, file_parser, helpers
│   └── scripts/               # R scripts (msqrob2_data_process.R, msqrob2_group_comparison_multi.R, MSstats, install/verify)
├── frontend/
│   └── src/
│       ├── app/               # Next.js pages
│       ├── components/        # React components (35+)
│       ├── hooks/             # Custom hooks (use-websocket)
│       ├── lib/               # API client, utils
│       ├── stores/            # 4 Zustand stores (with Immer)
│       └── types/             # TypeScript types
├── Tests/                     # ALL tests go here
│   ├── backend/               # pytest unit + integration
│   ├── e2e/                   # Playwright E2E
│   └── fixtures/              # Test data
├── AGENTS/                    # Developer guides
├── docs/
│   └── openapi.yaml           # API specification
└── backend/sessions/          # Runtime session storage
```

## Color Scheme

| Purpose | Color | Hex |
|---------|-------|-----|
| Upregulated / Primary | Pink (Coral) | `#E73564` |
| Downregulated / Secondary | Blue (Cyan) | `#00ADEF` |
| Neutral | Gray | `#6B7280` |

## Key Guides

| Topic | File |
|-------|------|
| Red lines | [02-absolute-red-lines.md](02-absolute-red-lines.md) |
| Coding standards | [03-coding-standards.md](03-coding-standards.md) |
| API contract | [04-api-contract.md](04-api-contract.md) |
| State management | [05-state-management.md](05-state-management.md) |
| Error handling | [06-error-handling.md](06-error-handling.md) |
| Testing | [07-testing.md](07-testing.md) |
| Pipeline | [08-processing-pipeline.md](08-processing-pipeline.md) |
| Lessons learned | [09-lessons-learned.md](09-lessons-learned.md) |
