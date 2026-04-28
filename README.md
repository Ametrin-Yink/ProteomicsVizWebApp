# Proteomics Visualization Web App

Full-stack scientific web application for proteomics data analysis and visualization.

## Features

- **Data Input:** Upload proteomics CSV files with automatic validation
- **Processing Pipeline:** 9-step analysis pipeline with real-time progress tracking
- **Visualization:** Interactive volcano plots, QC plots, and GSEA enrichment plots
- **Session Management:** Persistent sessions that survive server restarts
- **PDF Reports:** Export comprehensive analysis reports

## Prerequisites

- **Python 3.11+**
- **Node.js 20+**
- **R 4.3+** with bioinformatics packages

## Installation

### 1. Install R Packages

```bash
Rscript -e "
if (!require('BiocManager', quietly = TRUE))
    install.packages('BiocManager')
BiocManager::install(c('msqrob2', 'QFeatures', 'limma'))
"
```

### 2. Install Dependencies

```bash
# Backend (from project root)
pip install -r backend/requirements.txt

# Frontend (from project root)
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

### 2. Upload Data

Upload PSM (Peptide-Spectrum Match) CSV files. Filenames must follow this pattern:

```
PSM_ExperimentName_Condition_ReplicateNumber.csv
```

For example: `PSM_Exp1_Control_1.csv`, `PSM_Exp1_Control_2.csv`, `PSM_Exp1_Treated_1.csv`

**Required CSV columns:** Sequence, Modifications, Charge, Contaminant, Master Protein Accessions, Quan Info, Abundance

**Minimum replicates:** 3 per condition for reliable statistical analysis.

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

| Step | Description | Technology |
|------|-------------|------------|
| 1-5 | Combine, filter, and clean PSM data | Python/Pandas |
| 6 | Protein abundance aggregation | R/msqrob2 |
| 7 | Differential expression analysis | R/msqrob2 |
| 8 | QC metrics (PCA, CV, distributions) | Python/sklearn |
| 9 | Gene Set Enrichment Analysis | Python/gseapy |

## Project Structure

```
ProteomicsVizWebApp/
├── backend/            # FastAPI server + R scripts
├── frontend/           # Next.js web application
├── Tests/              # All test files
├── AGENTS/             # Developer documentation
└── docs/               # API specification
```

## Documentation

- **[AGENTS/](AGENTS/)** — Developer guides covering architecture, coding standards, API contract, and more
- **[docs/openapi.yaml](docs/openapi.yaml)** — Full API specification

## Testing

```bash
# Backend unit tests (from project root)
backend/.venv/Scripts/python.exe -m pytest Tests/backend/unit -v
backend/.venv/Scripts/python.exe -m pytest Tests/backend/integration -v

# Frontend E2E tests
cd Tests && npx playwright test
```

## Tech Stack

- **Frontend:** Next.js 16, React 19, TypeScript, Tailwind CSS, Zustand, Plotly.js
- **Backend:** FastAPI, Python 3.11+, Pydantic, asyncio
- **Analysis:** R 4.3+, msqrob2, QFeatures, limma, gseapy

## Contact

[Ametrin-Yink](https://github.com/Ametrin-Yink)

## License

MIT License — see LICENSE file for details.
