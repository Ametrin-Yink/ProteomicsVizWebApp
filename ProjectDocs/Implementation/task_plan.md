# Proteomics Visualization Web App - Implementation Plan

## Project Overview
Full-stack scientific web application for proteomics data analysis and visualization. Researchers use it to perform differential protein abundance analysis, visualize results with interactive plots, and run pathway enrichment analysis (GSEA).

**Technology Stack:**
| Layer | Technology |
|-------|------------|
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS v4, Zustand, Plotly.js |
| Backend | FastAPI, Python 3.11+, Pydantic, asyncio |
| Analysis | R 4.3+, msqrob2, QFeatures, limma (Bioconductor) |
| Data | Pandas, NumPy, CSV/TSV peptide abundance files |
| GSEA | gseapy 1.1.8 |
| PDF | Playwright + reportlab (HTML to PDF) |

**Color Scheme:**
- Highlight 1: #E73564 (Pink/Red)
- Highlight 2: #00ADEF (Cyan/Blue)
- Background: White
- Complementary colors to be researched

---

## Phase 1: Project Setup & Architecture
**Status:** 🔲 Pending | **Priority:** Critical | **Est. Duration:** 2-3 days

### ⚠️ ABSOLUTE REQUIREMENTS (NEVER VIOLATE)

#### 1. R Package Installation (CRITICAL)
**REQUIRED Bioconductor packages (NEVER SKIP):**
- msqrob2
- QFeatures  
- limma

**Verification Command:**
```bash
Rscript -e "library(msqrob2); library(QFeatures); library(limma); cat('OK\n')"
```

#### 2. Peptide Filename Pattern (IMMUTABLE)
**Format:** `PSM_ExperimentName_Condition_ReplicateNumber.csv`
- Example: `PSM_SampleData_DMSO_1.csv`
- NEVER modify this pattern

#### 3. Minimum Replicates (STATISTICAL REQUIREMENT)
- **Minimum: 3 replicates per condition**
- Validation error if <3: "At least 3 replicates per condition required!"

#### 4. Abundance Column Naming
**Format:** `Abundance F{code} Sample`
- Examples: `Abundance F49 Sample`, `Abundance F18 Sample`
- R scripts parse this exactly - DO NOT CHANGE

#### 5. TypeScript Configuration
- **MUST have `strict: true` in tsconfig.json**
- NEVER remove this setting

#### 6. R Integration Method
- **Use subprocess method (NOT rpy2)**
- rpy2 causes stability issues

#### 7. File Upload Limit
- **Maximum: 500MB**
- Hard limit in `config.py`

#### 8. Zustand State Management
- **NEVER mutate state directly**
- Always use store actions: `updateSession()`, `updateSessionConfig()`

#### 9. TypeScript Error Handling
- **NEVER use `as any` or `@ts-ignore`**
- Fix type errors properly

#### 10. Python Async I/O
- **NEVER use blocking I/O in async functions**
- Use `asyncio` compatible libraries

### ALWAYS DO

1. **Start backend before frontend**
   - Frontend proxies `/api/*` to `localhost:8000`

2. **Validate CSV columns before processing**
   - Required: `Sequence`, `Modifications`, `Charge`, `Contaminant`, `Master Protein Accessions`, `Quan Info`, `Abundance F{code} Sample`

3. **Handle encoding in R subprocess**
   - UTF-8 with latin-1 fallback

4. **Use TSV format internally**
   - User uploads CSV
   - Convert to TSV for processing
   - Output CSV for downloads

5. **Clean up session directories**
   - Delete when user removes session from manager

6. **Use global settings instance**
   - Loaded from `.env` automatically

7. **Handle WebSocket disconnect gracefully**

### 1.1 Repository Structure
```
proteomics-viz-webapp/
├── frontend/                    # Next.js 16 + React 19 + TypeScript
│   ├── src/
│   │   ├── app/                 # Next.js App Router
│   │   │   ├── page.tsx         # Welcome page
│   │   │   ├── layout.tsx       # Root layout with SessionManager
│   │   │   ├── analysis/
│   │   │   │   ├── page.tsx     # Data input & config page
│   │   │   │   ├── processing/
│   │   │   │   │   └── page.tsx # Real-time processing page
│   │   │   │   └── visualization/
│   │   │   │       └── page.tsx # Results/QC/Bioinformatics
│   │   ├── components/
│   │   │   ├── ui/              # shadcn/ui components
│   │   │   ├── plots/           # Plotly.js visualization components
│   │   │   ├── session/         # Session manager panel
│   │   │   └── analysis/        # Analysis-specific components
│   │   ├── stores/              # Zustand state management
│   │   ├── lib/                 # Utilities, API clients
│   │   └── types/               # TypeScript type definitions
│   ├── public/
│   ├── tests/                   # Playwright E2E tests
│   └── package.json
├── backend/                     # FastAPI + Python 3.11+
│   ├── app/
│   │   ├── main.py              # FastAPI entry point
│   │   ├── api/
│   │   │   ├── routes/
│   │   │   │   ├── sessions.py  # Session CRUD
│   │   │   │   ├── upload.py    # File upload endpoints
│   │   │   │   ├── analysis.py  # Analysis orchestration
│   │   │   │   ├── processing.py# Data processing endpoints
│   │   │   │   ├── visualization.py # Plot data endpoints
│   │   │   │   └── reports.py   # PDF report generation
│   │   │   └── dependencies.py  # FastAPI dependencies
│   │   ├── core/
│   │   │   ├── config.py        # App configuration
│   │   │   └── exceptions.py    # Custom exceptions
│   │   ├── models/
│   │   │   ├── session.py       # Session data models
│   │   │   ├── data.py          # Data structures (Pydantic)
│   │   │   └── analysis.py      # Analysis configuration
│   │   ├── services/
│   │   │   ├── session_manager.py
│   │   │   ├── data_processor.py # Steps 1-9 processing
│   │   │   ├── msqrob2_wrapper.py # R/msqrob2 integration
│   │   │   ├── gsea_service.py   # gseapy integration
│   │   │   ├── qc_calculator.py  # QC metrics calculation
│   │   │   ├── plot_generator.py # Plot data preparation
│   │   │   ├── compound_service.py # RDKit integration
│   │   │   └── report_generator.py # PDF generation
│   │   ├── db/
│   │   │   └── session_store.py  # Session persistence (JSON files)
│   │   └── utils/
│   │       ├── file_parser.py    # CSV parsing utilities
│   │       ├── validators.py     # Input validation
│   │       └── helpers.py        # General utilities
│   ├── sessions/                 # Session data storage
│   ├── protein_database/         # Organism databases (copied from ./ProteinDatabase)
│   ├── tests/
│   │   ├── unit/
│   │   ├── integration/
│   │   └── e2e/
│   ├── requirements.txt
│   └── Dockerfile
├── SampleData/                   # Test data (existing)
├── ProjectPlan/                  # Requirements docs (existing)
└── docs/                         # Architecture docs
```

### 1.2 Tasks
- [ ] Initialize Next.js 16 project with TypeScript, Tailwind v4
- [ ] **Configure tsconfig.json with `strict: true` (NEVER REMOVE)**
- [ ] Initialize FastAPI project structure
- [ ] Set up shadcn/ui component library
- [ ] Configure Zustand for state management
- [ ] **Configure Zustand store with proper actions (NEVER mutate directly)**
- [ ] Set up project linting (ESLint, Prettier, Ruff, Black)
- [ ] Create Docker Compose for local development
- [ ] Set up test infrastructure (Pytest, Playwright)
- [ ] **Configure backend settings with 500MB upload limit**
- [ ] **Set up global settings instance from .env**
- [ ] **Start backend before frontend (proxy config)**

---

## Phase 2: Backend Core Infrastructure
**Status:** 🔲 Pending | **Priority:** Critical | **Est. Duration:** 3-4 days

### 2.1 Session Management System
**Location:** `backend/app/services/session_manager.py`

**Requirements:**
- Sessions persist across server restarts
- Session data stored in `backend/sessions/{session_id}/`
- Session metadata in JSON format
- Auto-scan existing sessions on startup

**Data Structure:**
```python
class SessionState(Enum):
    CREATED = "created"
    CONFIGURING = "configuring"
    PROCESSING = "processing"
    COMPLETED = "completed"
    ERROR = "error"

class Session:
    id: UUID
    name: str
    template: str  # "protein_pairwise_comparison" or others
    state: SessionState
    created_at: datetime
    updated_at: datetime
    config: AnalysisConfig
    file_paths: FilePaths
    processing_status: ProcessingStatus
```

### 2.2 File Upload System
**Location:** `backend/app/api/routes/upload.py`

**Requirements:**
- Accept multipart/form-data uploads
- **Maximum file size: 500MB (hard limit in config.py)**
- Validate CSV format
- **Validate required columns:** `Sequence`, `Modifications`, `Charge`, `Contaminant`, `Master Protein Accessions`, `Quan Info`, `Abundance F{code} Sample`
- Extract metadata from filename (PSM_ExperimentName_Condition_ReplicateNumber.csv)
- Store in session-specific folder
- Support proteomics data + optional compound data

**Filename Parsing:**
- **⚠️ IMMUTABLE Pattern:** `PSM_{ExperimentName}_{Condition}_{ReplicateNumber}.csv`
- Example: `PSM_SampleData_DMSO_1.csv` → Experiment: SampleData, Condition: DMSO, Replicate: 1

### 2.3 Organism Database Scanner
**Location:** `backend/app/services/organism_scanner.py`

**Requirements:**
- On startup, scan `backend/protein_database/`
- Find valid organisms (must have: `{organism}.fasta` + `{organism}_uniprot_gene.tsv`)
- Expose endpoint to list available organisms
- Copy from `./ProteinDatabase` during build

### 2.4 Tasks
- [ ] Implement session CRUD operations
- [ ] Create session persistence layer (JSON-based)
- [ ] **Implement session cleanup (delete directory when session removed)**
- [ ] Implement file upload endpoints with validation
- [ ] **Add 500MB file size limit**
- [ ] **Add CSV column validation**
- [ ] Create filename parser for experiment metadata
- [ ] Implement organism database scanner
- [ ] Add WebSocket support for real-time updates
- [ ] **Handle WebSocket disconnect gracefully**
- [ ] Write unit tests for core services

---

## Phase 3: Data Processing Pipeline (Steps 1-9)
**Status:** 🔲 Pending | **Priority:** Critical | **Est. Duration:** 5-7 days

### 3.1 Step 1: Combine Replicates
**Input:** Multiple PSM CSV files
**Output:** `PSM_Abundances.tsv` (TSV format for internal processing)

**⚠️ CRITICAL: Column Validation Required**
**Must validate these columns exist:**
- `Sequence`
- `Modifications`
- `Charge`
- `Contaminant`
- `Master Protein Accessions`
- `Quan Info`
- `Abundance F{code} Sample` (e.g., `Abundance F49 Sample`, `Abundance F18 Sample`)

**Abundance Column Pattern:**
- Format: `Abundance F{code} Sample`
- Examples: `Abundance F49 Sample`, `Abundance F18 Sample`
- R scripts parse this exactly - DO NOT CHANGE

**Transformations:**
- User uploads CSV → Convert to TSV for internal processing
- Create `Sample Origination` column: `{Condition}_{ReplicateNumber}`
- Rename abundance columns to unified `Abundance`
- Combine all files into single TSV
- Output CSV for downloads

### 3.2 Step 2: Generate Unique PSM
**Transformation:**
```python
unique_psm = f"{Sequence}|{Modifications}|{Charge}"
```

### 3.3 Step 3: Remove Razor Information (Optional)
**Logic:**
1. Group by `Unique PSM` within same sample
2. For entries with multiple proteins (semicolon-separated in `Master Protein Accessions`):
   - Select protein with most matched peptides
   - Tie-breaker: longer protein length (from FASTA)
   - Final tie-breaker: first in list

### 3.4 Step 4: Remove Low Quality PSM
**Filters:**
- `Contaminant` = True → Remove
- `Quan Info` = "No Value" → Remove
- `Abundance` < 1 → Remove

### 3.5 Step 5: Filter Based on User Configuration
**Strict Criteria (Yes):**
- Remove PSM with >20% missing values per condition
- Remove proteins with only 1 PSM

**Lenient Criteria (No):**
- Remove PSM with >40% missing values per condition

### 3.6 Step 6: Calculate Protein Abundance (msqrob2)
**R Integration (CRITICAL - Use Subprocess, NOT rpy2):**
```python
# Use subprocess for R integration
import subprocess
import json

result = subprocess.run(
    ['Rscript', 'scripts/msqrob2_protein.R', input_file, output_file],
    capture_output=True,
    text=True,
    encoding='utf-8'  # With latin-1 fallback in error handling
)
```

**R Script Requirements:**
```r
# scripts/msqrob2_protein.R
library(msqrob2)      # REQUIRED - Bioconductor
library(QFeatures)    # REQUIRED - Bioconductor
library(limma)        # REQUIRED - Bioconductor

# Parse TSV input (converted from CSV)
# Output TSV format
```

**⚠️ NEVER use rpy2 directly - use subprocess method for stability**

**Output:** `Protein_Abundances.tsv`
- Add `Gene Name` column (lookup from UniProt → Gene mapping)
- Treat semicolon-separated UniProt IDs as separate proteins

### 3.7 Step 7: Differential Expression Analysis (msqrob2)
**R Integration (Subprocess - NOT rpy2):**
```python
# CORRECT: Use subprocess
result = subprocess.run(
    ['Rscript', 'scripts/msqrob2_de.R', protein_file, output_file, treatment, control],
    capture_output=True,
    text=True,
    encoding='utf-8'
)
```

**R Script:** `scripts/msqrob2_de.R`
- Input: Protein_Abundances.tsv
- Output: Diff_Expression.tsv
- Comparison: Treatment vs Control

**Output:** `Diff_Expression.tsv`
- Columns: `logFC`, `pval`, `adjPval` for each protein

### 3.8 Step 8: Calculate QC Metrics
**Metrics to Calculate:**
1. **PCA:** On protein abundance across samples
2. **P-value Distribution:** 20 bins from 0-1
3. **PSM CV:** Coefficient of variance per condition
4. **Intensity Distributions:** Log2 transformed
5. **Data Completeness:** Missing vs non-missing counts

**Output:** JSON files for each metric

### 3.9 Step 9: GSEA Analysis (gseapy)
**Databases:**
- GO Biological Processes
- GO Molecular Function
- GO Cellular Component
- Reactome
- KEGG

**Output:** JSON files per database with NES, pval, adjPval, leading edge genes

### 3.10 Tasks
- [ ] Implement Steps 1-5 (Python/pandas)
- [ ] **Install R packages: msqrob2, QFeatures, limma (NEVER SKIP)**
- [ ] **Set up R/msqrob2 integration via subprocess (NOT rpy2)**
- [ ] Implement Step 6 (protein abundance) with subprocess R calls
- [ ] Implement Step 7 (differential expression) with subprocess R calls
- [ ] Implement Step 8 (QC metrics calculation)
- [ ] **Verify R outputs single QC_Results.json (not separate files)**
- [ ] Implement Step 9 (GSEA with gseapy)
- [ ] **Add biomart fallback when offline (return UniProt IDs as-is)**
- [ ] Create processing status tracking
- [ ] Add comprehensive error handling
- [ ] Write integration tests
- [ ] **Add CSV column validation before processing**
- [ ] **Implement encoding fallback (UTF-8 → latin-1) for R subprocess**
- [ ] **Create TSV conversion utilities (CSV ↔ TSV)**
- [ ] **Document all API endpoints and verify frontend/backend sync**

---

## Phase 4: Frontend - Welcome & Session Management
**Status:** 🔲 Pending | **Priority:** High | **Est. Duration:** 2-3 days

### 4.1 Welcome Page
**Route:** `/`

**Features:**
- Display available analysis templates
- Template: "Protein Pair-wise Comparison Analysis"
- Other templates show "TBD" tooltip
- "New Analysis" button creates session → navigates to `/analysis`

### 4.2 Session Manager Panel
**Location:** Left sidebar (persistent across pages)

**Features:**
- List all existing sessions (scanned from backend)
- Session cards with: name, created date, status
- Click to resume session
- Delete session button
- Auto-refresh on session changes

### 4.3 Tasks
- [ ] Create root layout with session manager sidebar
- [ ] Build welcome page with template selection
- [ ] Implement session list component
- [ ] **Add session delete functionality (cleans up session directory)**
- [ ] Create Zustand stores for session state
- [ ] **NEVER mutate Zustand state directly - use actions only**
- [ ] Write component tests

---

## Phase 5: Frontend - Data Input & Configuration
**Status:** 🔲 Pending | **Priority:** High | **Est. Duration:** 3-4 days

### 5.1 Data Input Section
**Route:** `/analysis`

**Features:**
- File upload dropzone (proteomics CSV)
- Optional compound file upload
- "Upload from Database" button (shows TBD)
- Display uploaded files table with metadata

### 5.2 Experiment Structure Table
**Features:**
- Parse filenames to extract: ExperimentName, Condition, Replicate
- **⚠️ Filename Pattern (IMMUTABLE):** `PSM_ExperimentName_Condition_ReplicateNumber.csv`
- Display in sortable/filterable table
- Checkboxes for file selection
- Validation warnings:
  - ❌ Multiple experiments: "Samples must be from the same experiment!"
  - ❌ >2 conditions: "Sample must be from 2 conditions for paired comparison!"
  - ❌ <3 replicates per condition: "At least 3 replicates per condition required!"
- "Start Analysis" button (disabled until valid)

### 5.3 Compound Display
**Features:**
- If compound file uploaded with "Corp ID" & "SMILES"
- Match Corp ID to Condition names
- Display 2D structure using RDKit (via backend API)
- Show "No available compound" if no match

### 5.4 User Configuration Panel
**Features:**
1. **Treatment/Control Setup:**
   - Two dropdowns populated from selected conditions
   - Must be different values

2. **Organism Selection:**
   - Dropdown from scanned organism database
   - Shows available organisms only

3. **Remove Razor Information:**
   - Yes/No toggle (default: No)
   - Note: "Bioinformatics analysis will be disabled if No"

4. **Strict Filtering:**
   - Yes/No toggle (default: No)
   - Tooltip explaining reliability vs coverage trade-off

### 5.5 Tasks
- [ ] Build file upload components
- [ ] Create experiment structure table
- [ ] Implement validation logic
- [ ] Build configuration form
- [ ] Integrate with backend APIs
- [ ] Add form state management

---

## Phase 6: Frontend - Processing Page
**Status:** 🔲 Pending | **Priority:** High | **Est. Duration:** 2-3 days

### 6.1 Real-time Processing Display
**Route:** `/analysis/processing`

**Features:**
- Step-by-step progress tracker
- Each step shows: Not Started / In Progress / Completed
- Overall progress bar (percentage)
- Real-time log output (WebSocket)
- Auto-redirect to visualization on completion

### 6.2 Step Display
**Steps Shown:**
1. Combine Replicates
2. Generate Unique PSM
3. Remove Razor Information (conditional)
4. Remove Low Quality PSM
5. Filter Based on Configuration
6. Calculate Protein Abundance
7. Differential Expression Analysis
8. Calculate QC Metrics
9. Perform GSEA Analysis

### 6.3 Tasks
- [ ] Create processing status component
- [ ] Implement WebSocket client for real-time updates
- [ ] **Handle WebSocket disconnect gracefully**
- [ ] Build step visualization with icons
- [ ] Add log display component
- [ ] Implement auto-redirect on completion

---

## Phase 7: Frontend - Visualization (Results)
**Status:** 🔲 Pending | **Priority:** Critical | **Est. Duration:** 5-7 days

### 7.1 Results Tab
**Route:** `/analysis/visualization?tab=results`

#### 7.1.1 General Info Panel
- Total proteins identified
- Dynamically updated DE protein count

#### 7.1.2 Volcano Plot (Plotly.js)
**Interactive Features:**
- Toggle filters:
  - Fold change: 1-5 (default: 2)
  - P-value: 0-1 (default: 0.05)
  - Adj P-value: 0-1 (default: 1)
- Visual elements:
  - X-axis: log2(Treatment/Control)
  - Y-axis: -log10(p-value)
  - Dashed threshold lines
  - Colors: Pink (up), Blue (down), Grey (other)
- Selection modes:
  - **Click:** Single protein selection
  - **Box:** Multi-select rectangle
  - **Lasso:** Freehand multi-select
- Selected proteins: Darker, black border, larger, on top
- Selection panel shows count + "Clear Selection" button

#### 7.1.3 Protein Info Panel
**Display when 1 protein selected:**
- Master Protein Accessions (UniProt links)
- Gene Names
- Fold change (non-log)
- Log2 fold change
- P-value
- Adj P-value
- Number of PSMs
- Protein abundance plot (column, log2)
- PSM abundance plot (dot-line, original scale)

#### 7.1.4 Protein Results Table
**Features:**
- Columns: Protein, Gene Name, Log2FC, P-value, Adj P-value, Significance
- Sortable headers (default: Adj P-value ascending)
- Pagination (25 per page)
- Filter: Show selected proteins only (if selection active)
- Export to CSV button
- Click row → show in Protein Info panel

### 7.2 QC Plots Tab
**Route:** `/analysis/visualization?tab=qc`

**Plots (all Plotly.js):**
1. **PCA Analysis:** Scatter plot of samples
2. **P-value Distribution:** Histogram, 20 bins
3. **PSM CV Variance:** Violin plot per condition
4. **PSM Intensity Distribution:** Per condition (2 plots)
5. **Protein Intensity Distribution:** Per condition
6. **Data Completeness:** Stacked bar chart

### 7.3 Bioinformatics Tab
**Route:** `/analysis/visualization?tab=bioinformatics`

**Features:**
- Database selector: GO BP, GO MF, GO CC, Reactome, KEGG
- Loading state on switch

**Overview Panel:**
- Total significant pathways (adjPval ≤ 0.05)
- Overrepresented/Underrepresented counts

**Top Enriched Pathways:**
- Bar chart: Top 5 highest + lowest NES
- Click to select pathway

**Enriched Pathways Table:**
- Filter: |NES| ≥ 1
- Columns: Pathway, NES, P-value, Adj P-value, Gene Count
- Sortable headers
- Pagination (25 per page)
- Export to CSV
- Click row → show details

**Pathway Details Panel:**
- Pathway name, NES, P-value, Adj P-value, Gene count
- Leading edge genes (show 10, "Show More" for full list)
- GSEA plot (from gseapy)

### 7.4 Tasks
- [ ] Create tabbed layout for visualization
- [ ] Build volcano plot with all interactions
- [ ] Implement selection modes (click, box, lasso)
- [ ] Create protein info panel
- [ ] Build protein results table
- [ ] **Transform QC data from column-based to row-based for Plotly**
- [ ] Create all QC plot components
- [ ] **Verify QC plots display real data (not empty)**
- [ ] Build bioinformatics dashboard
- [ ] Implement GSEA plot display
- [ ] **Add biomart fallback handling in UI (show warning if offline)**
- [ ] Add CSV export functionality
- [ ] **Log all API responses during development**
- [ ] **Verify all API endpoint URLs match backend routes**

---

## Phase 8: PDF Report Generation
**Status:** 🔲 Pending | **Priority:** Medium | **Est. Duration:** 2-3 days

### 8.1 Report Content
**Sections:**
1. Sample Information
2. User Configuration
3. Results (volcano plot, protein table)
4. QC Plots
5. Bioinformatics Analysis

### 8.2 Implementation
**Approach:** HTML → PDF via Playwright + reportlab
- Generate HTML report with all content
- Use Playwright to render and print to PDF
- Or use reportlab for direct PDF construction

### 8.3 Tasks
- [ ] Design report HTML template
- [ ] Implement report data aggregation
- [ ] Create PDF generation service
- [ ] Add download button to visualization page
- [ ] Test PDF output formatting

---

## Phase 9: Testing & Quality Assurance
**Status:** 🔲 Pending | **Priority:** Critical | **Est. Duration:** 4-5 days

**📋 Reference:** See `test_requirements.md` for complete test specifications

### 9.1 Test Structure
```
tests/
├── e2e/                          # Playwright E2E tests
│   ├── 01-welcome.spec.ts
│   ├── 02-data-input.spec.ts
│   ├── 03-processing.spec.ts
│   ├── 04-results.spec.ts
│   ├── 05-qc-plots.spec.ts
│   ├── 06-bioinformatics.spec.ts
│   ├── 07-pdf-export.spec.ts
│   └── 08-session-manager.spec.ts
├── integration/                  # Integration tests
│   ├── test_api.py
│   ├── test_processing.py
│   └── test_r_integration.py
└── unit/                         # Unit tests
    ├── test_file_parser.py
    ├── test_validators.py
    └── test_data_processor.py
```

### 9.2 Unit Tests
**Backend:**
- Session management
- File parsing
- Data processing steps
- QC calculations

**Frontend:**
- Component tests (React Testing Library)
- Store tests (Zustand)
- Utility function tests

### 9.3 Integration Tests
- API endpoint tests
- File upload flow
- Processing pipeline
- R/msqrob2 integration

### 9.4 E2E Tests (Playwright)
**Test Scenarios (from test_requirements.md):**

*Suite 1: Welcome Page*
- Page load, template selection, session persistence

*Suite 2: Data Input & Configuration*
- File upload (proteomics + compound), validation warnings
- Experiment structure table, user configuration
- Treatment/Control setup, organism selection

*Suite 3: Processing Pipeline*
- Real-time progress display, all 9 steps
- Step-by-step verification, completion
- Error handling, WebSocket resilience

*Suite 4: Results Visualization*
- General info, DE count, volcano plot
- Plot filters (FC, p-value, adj p-value)
- Selection modes (click, box, lasso)
- Protein info panel, abundance plots
- Protein results table with CSV export

*Suite 5: QC Plots*
- All 6 plots display with real data
- PCA, p-value distribution, CV variance
- Intensity distributions, data completeness
- **NO EMPTY PLOTS**

*Suite 6: Bioinformatics*
- Database selection (GO BP/MF/CC, Reactome, KEGG)
- Overview panel, top enriched pathways
- Enriched pathways table, pathway details
- GSEA plot, biomart fallback

*Suite 7: PDF Export*
- PDF generation, content verification
- Quality checks

*Suite 8: Session Manager*
- Session list, resume, delete
- New session creation

### 9.5 Performance Tests
- File upload: 10MB <5s, 100MB <30s, 500MB <2min
- Processing: Step 6 <2min, Step 9 <2min per database
- Page load: All pages <3 seconds
- Concurrent users: Support 5-10 sessions

### 9.6 Success Criteria
- [ ] All E2E test suites pass (100%)
- [ ] Code coverage >80%
- [ ] No flaky tests
- [ ] Screenshots captured for verification
- [ ] Performance benchmarks met

### 9.7 Tasks
- [ ] Set up test infrastructure (Pytest, Vitest, Playwright)
- [ ] Write backend unit tests
- [ ] Write frontend component tests
- [ ] **Test R script output format matches expected structure**
- [ ] **Test data transformation (column-based → row-based)**
- [ ] Create Playwright E2E test suite (8 suites)
- [ ] **Verify with real data (not mocks)**
- [ ] Add performance tests
- [ ] Run full test suite
- [ ] Fix any failing tests
- [ ] **Manual QA: Check all plots display correctly**
- [ ] Generate test report

---

## Phase 10: Deployment & Documentation
**Status:** 🔲 Pending | **Priority:** Medium | **Est. Duration:** 2-3 days

### 10.1 Documentation
- API documentation (OpenAPI/Swagger)
- User guide
- Developer setup guide
- Architecture decision records

### 10.2 Deployment
- Docker Compose configuration
- Environment variable documentation
- Local development setup script

### 10.3 Tasks
- [ ] Write API documentation
- [ ] Create user guide
- [ ] Write developer setup instructions
- [ ] Create Docker Compose file
- [ ] Test fresh installation

---

## Dependencies & External Services

### Python Packages
```
# Core
fastapi==0.115.0
uvicorn[standard]==0.32.0
pydantic==2.9.0
python-multipart==0.0.17
websockets==13.0

# Data
pandas==2.2.0
numpy==1.26.0
scipy==1.14.0
scikit-learn==1.5.0

# R Integration - NOT USED
# Use subprocess method instead (see Phase 3)

# GSEA
gseapy==1.1.8

# Chemistry
rdkit==2024.3.0

# PDF
reportlab==4.2.0
playwright==1.48.0

# Testing
pytest==8.3.0
pytest-asyncio==0.24.0
httpx==0.27.0
```

### R Packages (Bioconductor) - REQUIRED
```r
# CRITICAL: These packages are ABSOLUTELY REQUIRED
# NEVER skip installation
BiocManager::install(c("msqrob2", "QFeatures", "limma"))
```

**Installation Verification:**
```python
# backend/scripts/verify_r_packages.R
required_packages <- c("msqrob2", "QFeatures", "limma")
for (pkg in required_packages) {
    if (!require(pkg, character.only = TRUE, quietly = TRUE)) {
        stop(paste("Missing required package:", pkg))
    }
}
cat("All required R packages installed successfully\n")
```

### Node.js Packages
```json
{
  "dependencies": {
    "next": "^16.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "typescript": "^5.6.0",
    "tailwindcss": "^4.0.0",
    "zustand": "^5.0.0",
    "plotly.js": "^2.35.0",
    "react-plotly.js": "^2.6.0",
    "@radix-ui/react-*": "latest",
    "class-variance-authority": "latest",
    "clsx": "latest",
    "tailwind-merge": "latest"
  },
  "devDependencies": {
    "@playwright/test": "^1.48.0",
    "@testing-library/react": "^16.0.0",
    "vitest": "^2.1.0"
  }
}
```

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| R/msqrob2 integration issues | Medium | High | Test early, have fallback, document R requirements |
| Large file processing performance | Medium | High | Implement streaming, async processing, progress tracking |
| Plotly.js bundle size | Medium | Medium | Dynamic imports, consider lighter alternatives for simple plots |
| Session data corruption | Low | High | Regular backups, validation, atomic writes |
| Browser compatibility | Low | Medium | Test on target browsers, polyfills if needed |

---

## Success Criteria

### Functional Requirements
- [ ] All 9 processing steps execute correctly
- [ ] Volcano plot has all interactive features
- [ ] QC plots display correctly
- [ ] GSEA analysis runs and displays results
- [ ] PDF reports generate with all content
- [ ] Session management works across restarts

### Performance Requirements
- [ ] File upload handles 10MB+ files
- [ ] Processing shows real-time progress
- [ ] Plots render in <3 seconds
- [ ] Session list loads in <1 second

### Quality Requirements
- [ ] All E2E tests pass
- [ ] No critical bugs
- [ ] Code coverage >80%
- [ ] Documentation complete

---

## Notes & Decisions

### ⚠️ Critical Implementation Notes

#### R Integration (REMEMBER)
- **ALWAYS use subprocess method**
- **NEVER use rpy2 directly**
- Handle encoding: UTF-8 with latin-1 fallback
- Verify R packages installed before processing

#### File Format Handling
- **Input:** User uploads CSV
- **Processing:** Convert to TSV internally
- **Output:** CSV for downloads
- **Never modify abundance column names:** `Abundance F{code} Sample`

#### Session Management
- Clean up session directories on delete
- Use global settings instance from .env
- Sessions survive server restart

#### TypeScript Strict Mode
- **tsconfig.json MUST have `strict: true`**
- Fix all type errors properly
- No `as any` or `@ts-ignore`

#### Zustand State Management
```typescript
// CORRECT: Use actions
const updateSession = useSessionStore((state) => state.updateSession)
updateSession({ name: 'New Name' })

// WRONG: Never mutate directly
const state = useSessionStore.getState()
state.session.name = 'New Name'  // ❌ Forbidden
```

#### Async Python
```python
# CORRECT: Non-blocking I/O
async def process_file(file_path: Path):
    content = await asyncio.to_thread(read_file, file_path)
    return content

# WRONG: Blocking in async
async def process_file(file_path: Path):
    content = open(file_path).read()  # ❌ Blocking I/O
    return content
```

### Color Scheme Research
Need to research complementary colors for:
- Primary: #E73564 (Pink/Red)
- Secondary: #00ADEF (Cyan/Blue)
- Background: White
- Text: Dark grey
- Accents: To be determined

### File Format Notes
- PSM files are CSV with quoted fields
- Abundance columns vary by replicate (Abundance F49 Sample, etc.)
- Compound file has Corp ID → SMILES mapping

### Processing Notes
- msqrob2 requires log2 transformed data
- Protein summarization uses robust regression
- GSEA requires pre-ranked gene list

### Data Format Compatibility (CRITICAL)
**R Output Format:**
- R scripts output column-based format (arrays per field)
- Example: `{ "samples": ["A", "B"], "pc1": [1.0, 2.0], "pc2": [0.5, 1.5] }`

**Frontend Expected Format:**
- Components need row-based format (array of objects)
- Example: `[{ "sample": "A", "pc1": 1.0, "pc2": 0.5 }, { "sample": "B", "pc1": 2.0, "pc2": 1.5 }]`

**Transformation Required:**
```typescript
// Transform in frontend useEffect
const transformedData = samples.map((sample, i) => ({
    sample,
    pc1: pc1Values[i] || 0,
    pc2: pc2Values[i] || 0,
    condition: conditions[i] || 'Unknown',
}));
```

### API Endpoint Verification (CRITICAL)
**Must verify these match between frontend and backend:**
- QC plots: `/sessions/{id}/qc/plots` (not `/qc/data`)
- All other endpoints must be documented in OpenAPI/Swagger

### External API Fallbacks (CRITICAL)
**gseapy.biomart() can fail silently:**
- Always implement fallback when offline
- Return UniProt IDs as gene symbols if biomart fails
- Log warnings for debugging

```python
def _uniprot_to_gene_symbol(self, uniprot_ids: List[str]) -> Dict[str, str]:
    try:
        result = gseapy.biomart(...)
        if result is not None and len(result) > 0:
            return dict(zip(result['uniprot_gn'], result['external_gene_name']))
    except Exception as e:
        logger.warning(f"Biomart failed: {e}")
    
    # Fallback: return UniProt IDs as-is
    return {uid: uid for uid in uniprot_ids}
```

---

## Change Log

| Date | Version | Changes |
|------|---------|---------|
| 2026-03-16 | 1.0.0 | Initial plan creation |

