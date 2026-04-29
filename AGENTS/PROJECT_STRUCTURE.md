# Project Structure

This document describes the organized folder structure of the Proteomics Visualization Web App project.

## Overview

```
ProteomicsVizWebApp/
├── frontend/          # Next.js frontend application
├── backend/           # FastAPI backend application
├── Tests/             # Playwright E2E tests
├── docs/              # Project documentation
├── ProjectDocs/       # Requirements and planning documents
├── AGENTS/            # Claude Code agent documentation
├── SampleData/        # Sample proteomics data files
└── protein_database/  # Protein database files
```

## Directory Details

### `/frontend/` - Next.js Frontend
React-based frontend application with TypeScript and Tailwind CSS.

```
frontend/
├── app/              # Next.js app directory (pages, layouts)
├── components/       # React components
├── hooks/            # Custom React hooks
├── lib/              # Utility functions
├── public/           # Static assets
├── styles/           # CSS/Tailwind styles
├── types/            # TypeScript type definitions
└── __tests__/        # Component unit tests
```

### `/backend/` - FastAPI Backend
Python FastAPI application for data processing and API endpoints.

```
backend/
├── app/              # Main application code
│   ├── api/          # API routes/routers
│   ├── core/         # Core config, exceptions
│   ├── db/           # Database/session storage
│   ├── models/       # Pydantic models
│   ├── services/     # Business logic
│   ├── utils/        # Utility functions
│   └── templates/    # R script templates
├── scripts/          # Utility scripts
├── sessions/         # Session data (runtime generated)
├── templates/        # R analysis templates
├── tests/            # Backend tests
│   ├── e2e/          # End-to-end tests
│   ├── integration/  # Integration tests
│   ├── unit/         # Unit tests
│   ├── fixtures/     # Test data files
│   └── r_scripts/    # R test scripts
├── protein_database/ # Protein database files
├── conftest.py       # Pytest configuration
└── requirements.txt  # Python dependencies
```

### `/Tests/` - E2E Tests
Playwright end-to-end tests for the complete application.

```
Tests/
├── e2e/              # Playwright test specs
│   ├── 01-welcome.spec.ts
│   ├── 02-data-input.spec.ts
│   ├── 03-processing.spec.ts
│   ├── 04-results.spec.ts
│   ├── 05-qc-plots.spec.ts
│   ├── 06-bioinformatics.spec.ts
│   ├── 07-pdf-export.spec.ts
│   └── 08-session-manager.spec.ts
├── fixtures/         # Test data and fixtures
├── scripts/          # Test helper scripts
├── reports/          # Test reports (generated)
├── screenshots/      # Test screenshots (generated)
├── test-results/     # Test results (generated)
├── playwright-report/# Playwright reports (generated)
├── helpers.ts        # Test utilities
└── playwright.config.ts # Playwright configuration
```

### `/docs/` - Documentation
Organized project documentation by category.

```
docs/
├── development/      # Development guides
│   ├── CONTRIBUTING.md
│   └── CLAUDE.md
├── testing/          # Testing documentation
│   └── PLAYWRIGHT_BEST_PRACTICES.md
├── deployment/       # Deployment guides
└── openapi.yaml      # API specification
```

### `/ProjectDocs/` - Project Planning
Requirements, test plans, and implementation documents.

```
ProjectDocs/
├── Implementation/   # Implementation documents
│   ├── Proteomics Visualization Web App requirements.md
│   ├── task_plan.md
│   ├── package_documentation.md
│   └── findings.md
└── Test/             # Test requirements
    └── test_requirements.md
```

### `/AGENTS/` - Claude Code Documentation
Agent instructions and guidelines for Claude Code.

```
AGENTS/
├── 01-overview.md
├── 02-absolute-red-lines.md
├── 03-coding-standards.md
├── 04-api-contract.md
├── 05-state-management.md
├── 06-error-handling.md
├── 07-security.md
├── 08-performance.md
├── 09-testing.md
├── 10-processing-pipeline.md
├── 11-websocket-protocol.md
├── 12-data-validation.md
└── 14-commands.md
```

## Key Principles

1. **Separation of Concerns**: Frontend, backend, and tests are in separate top-level directories
2. **Generated Files**: All generated files (logs, reports, session data) are in `.gitignore`
3. **Test Organization**:
   - Playwright E2E tests in `/Tests/`
   - Backend tests in `/backend/tests/`
4. **Documentation**: All docs organized by purpose in `/docs/`
5. **Runtime Data**: Session data and uploads are excluded from git

## Common Tasks

### Running Tests

```bash
# E2E Tests
cd Tests
npx playwright test

# Backend Tests
cd backend
pytest
```

### Starting Development

```bash
# Start backend
start_backend.bat

# Start frontend
cd frontend
npm run dev
```

## Notes

- Do not commit files in `sessions/`, `test-results/`, or `screenshots/`
- Keep test data in appropriate `fixtures/` directories
- Generated files should always be in `.gitignore`
