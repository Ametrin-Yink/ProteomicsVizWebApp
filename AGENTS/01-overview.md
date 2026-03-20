# 01 - Project Overview

**Generated:** 2026-03-16  
**Project Phase:** Planning → Implementation  
**Status:** No code exists yet; follow conventions strictly

---

## What is This Project?

Full-stack scientific web application for proteomics data analysis and visualization. Researchers use it to perform differential protein abundance analysis, visualize results with interactive plots, and run pathway enrichment analysis (GSEA).

## Core Technology Stack

| Layer | Technology | Version |
|-------|------------|---------|
| **Frontend** | Next.js | 16.x |
| | React | 19.x |
| | TypeScript | 5.6+ |
| | Tailwind CSS | v4 |
| | Zustand | 5.x |
| | Plotly.js | 2.35+ |
| **Backend** | FastAPI | 0.115+ |
| | Python | 3.11+ |
| | Pydantic | 2.9+ |
| | asyncio | native |
| **Analysis** | R | 4.3+ |
| | msqrob2 | 1.12.0 (Bioconductor) |
| | QFeatures | 1.1.2+ (Bioconductor) |
| | limma | (Bioconductor) |
| **GSEA** | gseapy | 1.1.8 |
| **PDF** | Playwright | 1.48+ |
| | reportlab | 4.2+ |

## Project Structure

```
proteomics-viz-webapp/
├── AGENTS/                    # This documentation
│   ├── 01-overview.md
│   ├── 02-absolute-red-lines.md
│   ├── 03-coding-standards.md
│   ├── 04-api-contract.md
│   ├── 05-state-management.md
│   ├── 06-error-handling.md
│   ├── 07-security.md
│   ├── 08-performance.md
│   ├── 09-testing.md
│   ├── 10-processing-pipeline.md
│   ├── 11-websocket-protocol.md
│   ├── 12-data-validation.md
│   ├── 13-lessons-learned.md
│   └── 14-commands.md
├── AGENTS.md                  # Index to all AGENTS docs
├── task_plan.md              # 10-phase implementation plan
├── test_requirements.md      # MUST fulfill before completion
├── findings.md               # Research findings, red lines
├── progress.md               # Progress log
├── ProjectPlan/              # Requirements documentation
│   ├── Proteomics Visualization Web App requirements.md
│   └── package_documentation.md
├── SampleData/               # Test data (PSM CSVs)
├── ProteinDatabase/          # Organism reference data
├── frontend/                 # Next.js 16 (TO CREATE)
│   ├── src/
│   │   ├── app/              # Next.js App Router
│   │   ├── components/       # UI, plots, session, analysis
│   │   ├── hooks/            # Custom React hooks
│   │   ├── stores/           # Zustand state
│   │   ├── lib/              # Utilities, API clients
│   │   ├── types/            # TypeScript definitions
│   │   └── utils/            # Helper functions
│   ├── public/
│   ├── tests/                # Playwright E2E
│   └── package.json
├── backend/                  # FastAPI (TO CREATE)
│   ├── app/
│   │   ├── api/
│   │   │   ├── deps.py       # FastAPI dependencies
│   │   │   └── routes/       # API endpoints
│   │   ├── core/             # Config, exceptions, logging
│   │   ├── models/           # Pydantic models
│   │   ├── schemas/          # Request/response schemas
│   │   ├── services/         # Business logic
│   │   ├── db/               # Session persistence
│   │   └── utils/            # Utilities
│   ├── sessions/             # Session data storage
│   ├── protein_database/     # Organism databases
│   ├── tests/                # Unit, integration, e2e
│   ├── scripts/              # R scripts
│   └── requirements.txt
└── docs/                     # Architecture docs
    └── adr/                  # Architecture Decision Records
```

## Where to Look

| Task | Location | Notes |
|------|----------|-------|
| **Requirements** | `ProjectPlan/Proteomics Visualization Web App requirements.md` | Original spec |
| **Package APIs** | `ProjectPlan/package_documentation.md` | msqrob2 & gseapy reference |
| **Test Requirements** | `test_requirements.md` | **MUST fulfill before completion** |
| **Implementation Plan** | `task_plan.md` | 10 phases, detailed tasks |
| **Research Findings** | `findings.md` | Data analysis, tech decisions |
| **Progress Tracking** | `progress.md` | Decisions made, blockers |
| **Sample Data** | `SampleData/` | PSM CSVs for testing |
| **Organism DBs** | `ProteinDatabase/` | FASTA + gene mapping files |

## Color Scheme (REQUIRED)

| Purpose | Color | Hex |
|---------|-------|-----|
| Upregulated | Pink/Red | `#E73564` |
| Downregulated | Cyan/Blue | `#00ADEF` |
| Neutral | Gray | `#6B7280` |
| Background | White | `#FFFFFF` |
| Surface | Light Gray | `#F9FAFB` |
| Border | Border Gray | `#E5E7EB` |
| Text Primary | Near Black | `#111827` |
| Text Secondary | Gray | `#6B7280` |
| Warning | Amber | `#F59E0B` |
| Error | Red | `#DC2626` |
| Info | Blue | `#3B82F6` |

## Quick Start for New Developers

1. **Read AGENTS documentation** (this directory)
2. **Install dependencies** (see [14-commands.md](14-commands.md))
3. **Install R packages** (CRITICAL - see [02-absolute-red-lines.md](02-absolute-red-lines.md))
4. **Run tests** to verify setup
5. **Start with Phase 1** in task_plan.md

## Next Steps

See [02-absolute-red-lines.md](02-absolute-red-lines.md) for critical requirements that must never be violated.
