# Proteomics Visualization Web App

Full-stack scientific web application for proteomics data analysis and visualization.

## Features

- **File Library:** Centralized file management with DuckDB-backed indexing. Create folders, upload/manage `.txt` and `.csv` files, then select from the library when creating analyses — no re-uploading needed.
- **Data Input:** Upload TMT or DIA proteomics data files (tab-delimited `.txt` or `.csv`), or select from the File Library
- **Processing Pipeline:** 8-step analysis pipeline with TMT→MSstats or DIA→msqrob2 paths
- **Visualization:** Interactive volcano plots, QC metrics, GSEA enrichment, BioNet networks
- **Session Management:** Persistent sessions that survive server restarts
- **Reports:** Export comprehensive HTML analysis reports

## Prerequisites

- **Python 3.12+**
- **Node.js 20+**
- **R 4.5+** with bioinformatics packages (msqrob2, QFeatures, limma, MSstats)

## Installation

### 1. Install R Packages

```bash
Rscript backend/scripts/install_r_packages.R
```

### 2. Install Dependencies

```bash
# Backend (from project root)
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements.txt

# Frontend
cd frontend && npm install
```

## Running the App

Start the backend and frontend in separate terminals:

```bash
# Terminal 1 - Backend
cd backend
.venv/Scripts/python.exe -m uvicorn app.main:app --reload --port 8000

# Terminal 2 - Frontend
cd frontend
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## How to Use

### 1. Create a Session

From the welcome page, create a new analysis session and give it a name.

### 2. Manage Files (Optional)

Use the **Files** tab to upload and organize your proteomics data files. Create folders, upload `.txt`/`.csv` files, rename, move, or delete them. The file library is indexed by DuckDB and survives across sessions.

### 3. Create a Session and Select Files

From the Home page, click a workflow card (TMT, DIA, or PTM) to create a new analysis session. On the upload step, click **Browse File Library** to select files from your library instead of uploading them each time. Files are copied into the session for processing.

For TMT data, you can also import a channel design CSV from the file library on the Metadata page.

### 3. Configure and Process

Set your analysis options (e.g., which conditions to compare), then start the processing pipeline. Progress is shown in real time.

### 4. View Results

Once processing completes, explore your results through interactive visualizations:

- **Volcano Plot** — Click, box-select, or lasso-select proteins of interest
- **QC Plots** — PCA, p-value distribution, coefficient of variation, intensity distributions
- **GSEA** — Gene Set Enrichment Analysis results with leading edge gene details

### 5. Export

Download results as CSV or generate a comprehensive PDF report.

## Processing Pipeline

8-step symmetric pipeline. TMT data uses MSstats; DIA data uses msqrob2.

| Step | TMT (MSstats) | DIA (msqrob2) |
|------|--------------|----------------|
| 1 | Melt TMT channels, map groups | Rename Quan Value, metadata |
| 2-5 | Shared: unique PSM, remove razor, low-quality filter, criteria filter | Same |
| 6 | MSstats protein abundance (R) | msqrob2 protein abundance (R) |
| 7 | MSstats group comparison (R) | msqrob2 DE contrasts (R) |
| 8 | QC metrics (PCA, CV, distributions) | Same |

On-demand analysis: GSEA (enrichment), BioNet (INDRA subnetworks), Compare (PCA/UMAP/t-SNE clustering).

## Project Structure

```
ProteomicsVizWebApp/
├── backend/            # FastAPI server + R pipeline scripts
├── frontend/           # Next.js web application
├── Tests/              # All test files (unit + integration, organized by domain)
├── AGENTS/             # Developer documentation
└── docs/               # API specification + design specs
```

## Documentation

- **[AGENTS/](AGENTS/)** — Developer guides covering architecture, coding standards, API contract, and more
- **[docs/api/openapi.yaml](docs/api/openapi.yaml)** — Full API specification
- **[docs/CONTRIBUTING.md](docs/CONTRIBUTING.md)** — Contributor guidelines

## Testing

```bash
# Hermetic backend PR suite (from project root)
backend/.venv/Scripts/python.exe -m pytest

# Frontend unit/component tests
npm --prefix frontend test

# Browser critical journeys (starts an isolated backend)
npm --prefix frontend run test:e2e

# Mandatory TMT/DIA scientific release gate
backend/.venv/Scripts/python.exe -m pytest -m r Tests/backend/integration/pipeline
```

R-backed live scientific pipelines and representative-data performance checks are
explicit opt-in lanes. TMT/DIA releases require the scientific gate above; PTM is
outside the release-quality scope. See `AGENTS/07-testing.md` for the test quality
standard, layer definitions, and commands.

## Tech Stack

- **Frontend:** Next.js 16, React 19, TypeScript, Tailwind CSS, Zustand, Plotly.js
- **Backend:** FastAPI, Python 3.12+, Pydantic, asyncio
- **Analysis:** R 4.5+, msqrob2, QFeatures, limma, MSstats, gseapy

## Contact

[Ametrin-Yink](https://github.com/Ametrin-Yink)

## License

MIT License — see LICENSE file for details.
