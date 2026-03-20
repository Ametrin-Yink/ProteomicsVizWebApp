# 14 - Development Commands

**Purpose:** Quick reference for all development commands

---

## Setup

### Install R Packages (CRITICAL - DO FIRST)
```bash
# Verify R is installed
R --version

# Install required Bioconductor packages
Rscript -e "
if (!require('BiocManager', quietly = TRUE))
    install.packages('BiocManager')
BiocManager::install(c('msqrob2', 'QFeatures', 'limma'))
cat('Installation complete\n')
"

# Verify installation
Rscript -e "library(msqrob2); library(QFeatures); library(limma); cat('OK\n')"
```

### Backend Setup
```bash
cd backend

# Create virtual environment
python -m venv .venv

# Activate (Windows)
.venv\Scripts\activate

# Activate (macOS/Linux)
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Install development dependencies
pip install -r requirements-dev.txt
```

### Frontend Setup
```bash
cd frontend

# Install dependencies
npm install

# Install Playwright browsers
npx playwright install
```

---

## Development

### Start Backend
```bash
cd backend

# Development with auto-reload
uvicorn app.main:app --reload --port 8000

# Production
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### Start Frontend
```bash
cd frontend

# Development
npm run dev

# Build
npm run build

# Production preview
npm run start
```

### Full Stack Development
```bash
# Terminal 1 - Backend
cd backend && uvicorn app.main:app --reload --port 8000

# Terminal 2 - Frontend
cd frontend && npm run dev

# Access at http://localhost:3000
```

---

## Testing

### Backend Tests
```bash
cd backend

# Run all tests
pytest

# Run with coverage
pytest --cov=app --cov-report=html

# Run specific test file
pytest tests/unit/test_file_parser.py

# Run specific test
pytest tests/unit/test_file_parser.py::TestFileParser::test_parse_valid_filename

# Run with verbose output
pytest -v

# Run integration tests only
pytest tests/integration/
```

### Frontend Unit Tests
```bash
cd frontend

# Run all tests
npm run test

# Run in watch mode
npm run test:watch

# Run with coverage
npm run test:coverage
```

### E2E Tests (Playwright)
```bash
cd frontend

# Run all E2E tests
npx playwright test

# Run with UI
npx playwright test --ui

# Run specific test file
npx playwright test e2e/04-results.spec.ts

# Run with headed browser (visible)
npx playwright test --headed

# Debug specific test
npx playwright test e2e/04-results.spec.ts --debug

# Generate test report
npx playwright show-report
```

### All Tests
```bash
# From root
npm run test:all
```

---

## Code Quality

### Python Linting
```bash
cd backend

# Run ruff (linter)
ruff check .

# Run ruff (formatter)
ruff format .

# Run mypy (type checker)
mypy app/

# Run black (alternative formatter)
black app/ tests/
```

### TypeScript/JavaScript Linting
```bash
cd frontend

# Run ESLint
npm run lint

# Run ESLint with fix
npm run lint:fix

# Run Prettier
npm run format

# Type check
npm run type-check
```

### Pre-commit Hooks
```bash
# Install pre-commit
pip install pre-commit

# Install hooks
pre-commit install

# Run manually
pre-commit run --all-files
```

---

## Database

### Session Management
```bash
# List all sessions
ls backend/sessions/

# Clean up old sessions (manual)
rm -rf backend/sessions/{session_id}

# Clean up all sessions (DANGER)
rm -rf backend/sessions/*
```

---

## Docker

### Build Images
```bash
# Build all
docker-compose build

# Build specific service
docker-compose build backend
docker-compose build frontend
```

### Run Containers
```bash
# Start all services
docker-compose up

# Start in background
docker-compose up -d

# View logs
docker-compose logs -f

# Stop
docker-compose down
```

---

## Deployment

### Environment Variables
```bash
# Copy example
cp backend/.env.example backend/.env

# Edit
nano backend/.env
```

### Production Build
```bash
# Build frontend
cd frontend && npm run build

# Copy to backend static
cp -r frontend/dist backend/app/static

# Start production server
cd backend && uvicorn app.main:app --host 0.0.0.0 --port 8000
```

---

## Troubleshooting

### R Issues
```bash
# Check R installation
which R
R --version

# Check R packages
Rscript -e "installed.packages()[,c('Package','Version')]"

# Reinstall packages
Rscript -e "remove.packages(c('msqrob2','QFeatures','limma'))"
Rscript scripts/install_r_packages.R
```

### Port Already in Use
```bash
# Find process using port 8000
lsof -i :8000

# Kill process
kill -9 <PID>

# Or use different port
uvicorn app.main:app --port 8001
```

### Clear Caches
```bash
# Python cache
find . -type d -name __pycache__ -exec rm -rf {} +
find . -type f -name "*.pyc" -delete

# Node modules
rm -rf frontend/node_modules
npm install

# Next.js cache
rm -rf frontend/.next
```

---

## Quick Reference

| Task | Command |
|------|---------|
| Start dev | `cd backend && uvicorn app.main:app --reload` + `cd frontend && npm run dev` |
| Run tests | `cd backend && pytest` + `cd frontend && npm test` |
| Run E2E | `cd frontend && npx playwright test` |
| Lint Python | `cd backend && ruff check .` |
| Lint TS | `cd frontend && npm run lint` |
| Type check | `cd frontend && npm run type-check` |
| Build | `cd frontend && npm run build` |
| Docker | `docker-compose up` |

---

## Next Steps

Return to [01-overview.md](01-overview.md) for project overview.
