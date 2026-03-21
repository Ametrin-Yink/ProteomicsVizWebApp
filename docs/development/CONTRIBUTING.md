# Contributing to Proteomics Visualization Web App

Thank you for your interest in contributing! This document provides guidelines for contributing to the project.

---

## Development Setup

### Prerequisites

- Python 3.11+
- Node.js 20+
- R 4.3+
- Git

### Install R Packages (CRITICAL)

```bash
Rscript -e "
if (!require('BiocManager', quietly = TRUE))
    install.packages('BiocManager')
BiocManager::install(c('msqrob2', 'QFeatures', 'limma'))
"
```

### Backend Setup

```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
pip install -r requirements-dev.txt
```

### Frontend Setup

```bash
cd frontend
npm install
npx playwright install
```

---

## Code Style

### Python

- Follow PEP 8
- Use type hints
- Run `ruff check .` before committing
- Run `mypy app/` for type checking

### TypeScript

- Follow project ESLint rules
- Use strict TypeScript (`strict: true`)
- Run `npm run lint` before committing
- Run `npm run type-check` for type checking

---

## Commit Messages

Use conventional commits:

```
feat: add volcano plot selection modes
fix: resolve QC plots empty issue
docs: update API documentation
test: add E2E tests for bioinformatics
refactor: simplify data transformation
```

---

## Pull Request Process

1. Create feature branch from `main`
2. Make changes following code style
3. Run all tests (`pytest` + `npm test`)
4. Update documentation if needed
5. Submit PR with clear description
6. Request review from maintainers

---

## Testing

All changes must include tests:

- **Backend:** Unit tests with pytest
- **Frontend:** Component tests with Vitest
- **E2E:** Playwright tests for critical paths

---

## Questions?

See [AGENTS documentation](AGENTS/) for detailed guidelines.
