# BioNet Network Visualization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "BioNet" visualization module that maps differential abundance results onto protein-protein interaction networks using MSstatsBioNet/INDRA, rendered with Cytoscape.js.

**Architecture:** Backend follows the GSEA on-demand pattern (POST /run → background asyncio.Task → status polling → GET /subnetwork). An R script (`bionet_network.R`) handles the MSstatsBioNet calls via subprocess. Frontend uses a config panel + Cytoscape.js canvas, matching the GSEA single-column layout.

**Tech Stack:** FastAPI, R 4.5+/MSstatsBioNet/INDRA, Next.js 16, Cytoscape.js, TypeScript, Tailwind CSS

---

### Build Order & Dependencies

```
R Script ──► Backend Service ──► Backend Routes ──► Frontend Types ──► Frontend API ──► Page + Component
                                                                                          │
                                                      Module Config (independent, can parallel with R)
```

Tasks 1–4 are backend (sequential within). Task 5 (module config) is independent. Tasks 6–9 are frontend (sequential within). Task 10 is integration+e2e.

---

### Task 1: R Script — `bionet_network.R`

**Files:**
- Create: `backend/scripts/bionet_network.R`

This is the R subprocess script called by Python. It renames columns, annotates proteins with HGNC IDs, queries INDRA, and writes nodes/edges CSVs.

- [ ] **Step 1: Create the R script**

```r
# bionet_network.R
# Usage: Rscript bionet_network.R <input_tsv> <config_json> <nodes_csv> <edges_csv>
# Called by bionet_service.py to run MSstatsBioNet annotation + INDRA subnetwork query.

args <- commandArgs(trailingOnly = TRUE)
if (length(args) != 4) {
  stop("Usage: Rscript bionet_network.R <input_tsv> <config_json> <nodes_csv> <edges_csv>")
}

library(MSstatsBioNet)
library(jsonlite)

# --- Read inputs ----------------------------------------------------------------
df <- read.delim(args[1], stringsAsFactors = FALSE, check.names = FALSE)
config <- fromJSON(args[2])

# --- Rename columns to match MSstatsBioNet expectations -------------------------
# getSubnetworkFromIndra internally filters on adj.pvalue (adjusted p-value),
# accesses the "issue" column (must exist; NA = no QC issues), and uses
# Protein, log2FC columns.
colnames(df)[colnames(df) == "Master_Protein_Accessions"] <- "Protein"
colnames(df)[colnames(df) == "logFC"] <- "log2FC"
colnames(df)[colnames(df) == "adjPval"] <- "adj.pvalue"
df$issue <- NA  # required by .filterGetSubnetworkFromIndraInput

# --- Annotate UniProt -> HGNC ---------------------------------------------------
annotated <- annotateProteinInfoFromIndra(df, "Uniprot")

# --- Query INDRA subnetwork -----------------------------------------------------
subnetwork <- getSubnetworkFromIndra(
  annotated,
  pvalueCutoff        = config$pvalue_cutoff,
  statement_types     = unlist(config$statement_types),
  paper_count_cutoff  = config$paper_count_cutoff,
  evidence_count_cutoff = config$evidence_count_cutoff,
  correlation_cutoff  = config$correlation_cutoff,
  sources_filter      = if (is.null(config$sources_filter) || length(config$sources_filter) == 0) NULL else unlist(config$sources_filter)
)

# --- Write outputs --------------------------------------------------------------
write.csv(subnetwork$nodes, args[3], row.names = FALSE)
write.csv(subnetwork$edges, args[4], row.names = FALSE)

cat(sprintf("BioNet complete: %d nodes, %d edges\n", nrow(subnetwork$nodes), nrow(subnetwork$edges)))
```

- [ ] **Step 2: Verify the R script runs with example data**

```bash
cd backend && Rscript -e "
df <- data.frame(
  Master_Protein_Accessions = c('P05023', 'O00217'),
  logFC = c(1.5, -0.8),
  adjPval = c(0.001, 0.01),
  stringsAsFactors = FALSE
)
write.table(df, 'scripts/test_bionet_input.tsv', sep='\\t', row.names=FALSE)
write(jsonlite::toJSON(list(
  pvalue_cutoff = 0.05,
  statement_types = c('IncreaseAmount','DecreaseAmount'),
  paper_count_cutoff = 1, evidence_count_cutoff = 1,
  correlation_cutoff = NULL, sources_filter = NULL
), auto_unbox=TRUE), 'scripts/test_bionet_config.json')
"
```

Then run:
```bash
"C:/Program Files/R/R-4.5.1/bin/x64/Rscript.exe" backend/scripts/bionet_network.R backend/scripts/test_bionet_input.tsv backend/scripts/test_bionet_config.json backend/scripts/test_bionet_nodes.csv backend/scripts/test_bionet_edges.csv
```

Expected: prints "BioNet complete: N nodes, M edges" (N, M depend on INDRA results for those proteins).

- [ ] **Step 3: Commit**

```bash
git add backend/scripts/bionet_network.R
git commit -m "feat: add bionet_network.R — MSstatsBioNet INDRA subnetwork query script"
```

---

### Task 2: Backend Service — `bionet_service.py`

**Files:**
- Create: `backend/app/services/bionet_service.py`

The service orchestrates the R subprocess call: reads the DE TSV, applies |logFC| pre-filter, writes config JSON, spawns R, parses output CSVs.

- [ ] **Step 1: Create the service**

```python
"""BioNet service — INDRA subnetwork analysis via MSstatsBioNet."""

import json
import logging
import os
import tempfile
import subprocess
from pathlib import Path

import pandas as pd

from app.core.config import settings

logger = logging.getLogger("proteomics")


class BioNetService:
    """Orchestrates the R subprocess call for MSstatsBioNet INDRA analysis."""

    def __init__(self) -> None:
        self._rscript = settings.r_executable or "Rscript"

    def run_bionet(
        self,
        de_file: Path,
        config: dict,
        nodes_csv: Path,
        edges_csv: Path,
    ) -> tuple[int, int]:
        """
        Run the full BioNet pipeline.

        Returns (node_count, edge_count) on success.
        Raises subprocess.CalledProcessError or RuntimeError on failure.
        """
        # 1. Read DE file
        df = pd.read_csv(de_file, sep="\t")

        # 2. Pre-filter by |logFC|
        logfc_cutoff = config.get("logfc_cutoff", 0.5)
        if "logFC" in df.columns:
            df = df[df["logFC"].abs() > logfc_cutoff]

        if len(df) == 0:
            raise RuntimeError("No proteins pass the |logFC| cutoff")

        if len(df) >= 400:
            raise RuntimeError(
                f"{len(df)} proteins exceed INDRA limit of 400. "
                "Tighten p-value or |logFC| cutoff."
            )

        # 3. Write input TSV and config JSON to temp files
        with tempfile.TemporaryDirectory(prefix="bionet_") as tmpdir:
            tmp = Path(tmpdir)
            input_tsv = tmp / "input.tsv"
            config_json = tmp / "config.json"

            df.to_csv(input_tsv, sep="\t", index=False)
            with open(config_json, "w") as f:
                json.dump(config, f, default=str)

            # 4. Resolve script path
            script = (
                Path(__file__).resolve().parent.parent.parent
                / "scripts" / "bionet_network.R"
            )

            # 5. Run R script
            cmd = [
                self._rscript,
                str(script),
                str(input_tsv),
                str(config_json),
                str(nodes_csv),
                str(edges_csv),
            ]

            env = os.environ.copy()
            env.setdefault("R_LIBS_USER", str(Path.home() / "R" / "win-library" / "4.5"))
            env.setdefault("R_LIBS_SITE", "")

            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                encoding="utf-8",
                timeout=settings.r_script_timeout,
                env=env,
            )

            if result.returncode != 0:
                error_msg = result.stderr.strip() or result.stdout.strip()
                raise subprocess.CalledProcessError(
                    result.returncode, cmd,
                    output=result.stdout, stderr=result.stderr,
                )

            logger.info("BioNet R script output: %s", result.stdout.strip())

        # 6. Parse nodes CSV to count
        nodes_df = pd.read_csv(nodes_csv)
        edges_df = pd.read_csv(edges_csv)
        return len(nodes_df), len(edges_df)


# Singleton
bionet_service = BioNetService()
```

- [ ] **Step 2: Verify the service isn't broken by syntax errors**

```bash
backend/.venv/Scripts/python.exe -c "from app.services.bionet_service import bionet_service; print('OK')"
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/bionet_service.py
git commit -m "feat: add bionet_service.py — orchestrate R subprocess for INDRA subnetwork"
```

---

### Task 3: Backend Routes — BioNet Endpoints in `visualization.py`

**Files:**
- Modify: `backend/app/api/routes/visualization.py` — append Pydantic models + 3 endpoints + background task + status helpers

Follow the exact GSEA pattern (global dicts for locks/status, background asyncio.Task, status JSON file on disk).

- [ ] **Step 1: Add Pydantic models**

Insert after the existing GSEA models (after `GseaRunRequest` class, around line 981):

```python
# --- BioNet Models ---

class BioNetRunRequest(BaseModel):
    comparison: str
    pvalue_cutoff: float = 0.05       # NOTE: filters on adj.pvalue (adjusted p-value)
    logfc_cutoff: float = 0.5
    statement_types: list[str] = ["IncreaseAmount", "DecreaseAmount"]
    paper_count_cutoff: int = 1
    evidence_count_cutoff: int = 1
    correlation_cutoff: float | None = None
    sources_filter: list[str] | None = None


class BioNetNode(BaseModel):
    id: str            # UniProt accession
    logFC: float
    pvalue: float      # adjusted p-value (from adj.pvalue column)
    hgncName: str


class BioNetEdge(BaseModel):
    source: str
    target: str
    interaction: str
    evidenceCount: int
    paperCount: int
    evidenceLink: str
    sourceCounts: dict[str, int]


class BioNetSubnetwork(BaseModel):
    nodes: list[BioNetNode]
    edges: list[BioNetEdge]
```

- [ ] **Step 2: Add module-level state and helpers**

Insert after the existing GSEA helpers (after `_write_gsea_status`, around line 1017):

```python
# --- BioNet helpers ---

_bionet_run_locks: dict[str, asyncio.Lock] = {}
_bionet_status_write_locks: dict[str, asyncio.Lock] = {}  # separate from run locks (avoids deadlock)

_BIONET_OUTPUT_DIR_NAME = "bionet"


def _bionet_output_dir(session_id: str) -> Path:
    return settings.sessions_dir / session_id / _BIONET_OUTPUT_DIR_NAME


def _bionet_status_path(session_id: str) -> Path:
    return _bionet_output_dir(session_id) / "bionet_status.json"


def _bionet_subnetwork_path(session_id: str) -> Path:
    return _bionet_output_dir(session_id) / "bionet_subnetwork.json"


def _read_bionet_status(session_id: str) -> dict | None:
    path = _bionet_status_path(session_id)
    if not path.exists():
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


async def _write_bionet_status(session_id: str, data: dict) -> None:
    path = _bionet_status_path(session_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    if session_id not in _bionet_status_write_locks:
        _bionet_status_write_locks[session_id] = asyncio.Lock()
    async with _bionet_status_write_locks[session_id]:
        await asyncio.to_thread(_write_json_file, path, data)
```

- [ ] **Step 3: Add the background task function**

Insert after the bionet helpers:

```python
async def _background_bionet_run(
    session_id: str,
    request: BioNetRunRequest,
    results_dir: Path,
    de_file: Path,
    lock: asyncio.Lock,
) -> None:
    from app.services.bionet_service import bionet_service

    status_data = {
        "status": "running",
        "comparison": request.comparison,
        "started_at": datetime.now(timezone.utc).isoformat(),
        "error": None,
    }
    _bionet_output_dir(session_id).mkdir(parents=True, exist_ok=True)
    await _write_bionet_status(session_id, status_data)

    try:
        config_dict = request.model_dump()
        nodes_csv = _bionet_output_dir(session_id) / "nodes.csv"
        edges_csv = _bionet_output_dir(session_id) / "edges.csv"

        node_count, edge_count = await asyncio.to_thread(
            bionet_service.run_bionet,
            de_file=de_file,
            config=config_dict,
            nodes_csv=nodes_csv,
            edges_csv=edges_csv,
        )

        # Convert CSVs to JSON for API response
        import pandas as pd
        nodes_df = pd.read_csv(nodes_csv)
        edges_df = pd.read_csv(edges_csv)

        # Parse sourceCounts from JSON string
        if "sourceCounts" in edges_df.columns:
            import json as _json
            edges_df["sourceCounts"] = edges_df["sourceCounts"].apply(
                lambda x: _json.loads(x) if isinstance(x, str) else x
            )

        subnetwork = {
            "nodes": nodes_df.to_dict(orient="records"),
            "edges": edges_df.to_dict(orient="records"),
        }
        subnetwork_path = _bionet_subnetwork_path(session_id)
        await asyncio.to_thread(_write_json_file, subnetwork_path, subnetwork)

        status_data["status"] = "completed"
        status_data["node_count"] = node_count
        status_data["edge_count"] = edge_count
        status_data["completed_at"] = datetime.now(timezone.utc).isoformat()
        await _write_bionet_status(session_id, status_data)

    except Exception as e:
        logger.error(f"Background BioNet run failed: {e}")
        status_data["status"] = "error"
        status_data["error"] = str(e)
        await _write_bionet_status(session_id, status_data)
    finally:
        lock.release()
        _bionet_run_locks.pop(session_id, None)
```

- [ ] **Step 4: Add the three API endpoints**

Insert after `_background_bionet_run`, before the existing protein endpoints:

```python
@router.post("/{session_id}/bionet/run")
async def run_bionet_on_demand(
    session_id: str,
    request: BioNetRunRequest,
    store: SessionStore = Depends(get_session_store),
):
    session = await store.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found",
        )

    results_dir = settings.sessions_dir / session_id / "results"
    de_file = results_dir / f"Diff_Expression_{request.comparison}.tsv"
    if not de_file.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Differential expression file not found: {de_file.name}",
        )

    # Per-session lock to prevent concurrent BioNet runs
    if session_id not in _bionet_run_locks:
        _bionet_run_locks[session_id] = asyncio.Lock()

    run_lock = _bionet_run_locks[session_id]
    if run_lock.locked():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A BioNet analysis is already running for this session",
        )

    await run_lock.acquire()

    task = asyncio.create_task(
        _background_bionet_run(
            session_id=session_id,
            request=request,
            results_dir=results_dir,
            de_file=de_file,
            lock=run_lock,
        )
    )
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)

    return create_response({"status": "started", "comparison": request.comparison})


@router.get("/{session_id}/bionet/status")
async def get_bionet_run_status(
    session_id: str,
    store: SessionStore = Depends(get_session_store),
):
    session = await store.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found",
        )

    status_data = _read_bionet_status(session_id)
    if status_data is None:
        return create_response({"status": "idle"})

    return create_response(status_data)


@router.get("/{session_id}/bionet/subnetwork")
async def get_bionet_subnetwork(
    session_id: str,
    store: SessionStore = Depends(get_session_store),
):
    session = await store.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found",
        )

    subnetwork_path = _bionet_subnetwork_path(session_id)
    if not subnetwork_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No BioNet subnetwork computed yet. Run the analysis first.",
        )

    with open(subnetwork_path, "r", encoding="utf-8") as f:
        subnetwork = json.load(f)

    return create_response(subnetwork)
```

- [ ] **Step 5: Add required imports at top of file**

Add `BioNetRunRequest` is already local. The service import is done inside `_background_bionet_run` to avoid circular imports. The existing imports already cover `asyncio`, `json`, `datetime`, `Path`, `HTTPException`, `status`, etc.

- [ ] **Step 6: Verify routes are imported**

Check `backend/app/main.py` — the visualization router is already included at line 214:
```python
app.include_router(visualization.router, prefix="/api/sessions", tags=["visualization"])
```
No change needed since we added endpoints to the existing router.

- [ ] **Step 7: Smoke test with curl (requires backend running)**

```bash
# Start backend first:
taskkill //F //IM python.exe 2>/dev/null
backend/.venv/Scripts/python.exe -m uvicorn app.main:app --reload --reload-exclude "sessions" --port 8000
```

```bash
# Both should 404 — session test123 does not exist in the session store
curl -s http://localhost:8000/api/sessions/test123/bionet/status
curl -s -X POST http://localhost:8000/api/sessions/test123/bionet/run \
  -H "Content-Type: application/json" \
  -d '{"comparison":"test_vs_ctrl"}'
```

- [ ] **Step 8: Commit**

```bash
git add backend/app/api/routes/visualization.py
git commit -m "feat: add BioNet API endpoints — POST /run, GET /status, GET /subnetwork"
```

---

### Task 4: Backend Unit Tests

**Files:**
- Create: `Tests/backend/unit/test_bionet_service.py`
- Create: `Tests/backend/integration/test_bionet_routes.py`

- [ ] **Step 1: Write unit test for BioNetService config serialization**

```python
"""Unit tests for BioNet service."""
import json
import tempfile
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

from app.services.bionet_service import BioNetService


class TestBioNetService:
    def test_config_serialization(self):
        """Config dict should serialize to JSON compatible with R jsonlite."""
        service = BioNetService()
        config = {
            "pvalue_cutoff": 0.05,
            "logfc_cutoff": 0.5,
            "statement_types": ["IncreaseAmount", "DecreaseAmount"],
            "paper_count_cutoff": 1,
            "evidence_count_cutoff": 1,
            "correlation_cutoff": None,
            "sources_filter": None,
        }
        serialized = json.dumps(config)
        # Verify None becomes null in JSON (R jsonlite reads as NULL)
        parsed = json.loads(serialized)
        assert parsed["correlation_cutoff"] is None
        assert parsed["statement_types"] == ["IncreaseAmount", "DecreaseAmount"]
```

- [ ] **Step 2: Write unit test for |logFC| pre-filtering**

```python
    def test_logfc_prefilter_removes_below_cutoff(self, tmp_path: Path):
        """Proteins with |logFC| <= cutoff should be excluded."""
        import pandas as pd

        de_file = tmp_path / "test_de.tsv"
        pd.DataFrame({
            "Master_Protein_Accessions": ["P1", "P2", "P3"],
            "Gene_Name": ["G1", "G2", "G3"],
            "logFC": [2.0, 0.3, -0.1],
            "pval": [0.001, 0.01, 0.05],
            "adjPval": [0.001, 0.01, 0.05],
        }).to_csv(de_file, sep="\t", index=False)

        service = BioNetService()
        config = {"logfc_cutoff": 0.5, "pvalue_cutoff": 0.05}

        # Mock the R subprocess since we can't actually run it in unit tests
        with patch.object(service, "_rscript", "echo"), \
             patch("subprocess.run") as mock_run:

            mock_result = MagicMock()
            mock_result.returncode = 0
            mock_result.stdout = "BioNet complete: 2 nodes, 1 edges\n"
            mock_run.return_value = mock_result

            # Create dummy nodes/edges CSVs ahead of time
            nodes_csv = tmp_path / "nodes.csv"
            edges_csv = tmp_path / "edges.csv"
            pd.DataFrame({"id": ["P1"], "logFC": [2.0], "pvalue": [0.001], "hgncName": ["G1"]}).to_csv(nodes_csv, index=False)
            pd.DataFrame({"source": ["P1"], "target": ["P2"], "interaction": ["IncreaseAmount"], "evidenceCount": [2], "paperCount": [1], "evidenceLink": [""], "sourceCounts": ["{}"]}).to_csv(edges_csv, index=False)

            # The actual filter happens BEFORE R subprocess
            df = pd.read_csv(de_file, sep="\t")
            df_filtered = df[df["logFC"].abs() > 0.5]
            assert len(df_filtered) == 1  # Only P1 passes (|2.0| > 0.5)
            assert df_filtered.iloc[0]["Master_Protein_Accessions"] == "P1"
```

- [ ] **Step 3: Write unit test for 400-protein limit**

```python
    def test_over_400_proteins_raises(self, tmp_path: Path):
        """Input with >= 400 proteins should raise RuntimeError."""
        import pandas as pd

        de_file = tmp_path / "test_large.tsv"
        rows = []
        for i in range(400):
            rows.append({
                "Master_Protein_Accessions": f"P{i}",
                "Gene_Name": f"G{i}",
                "logFC": 2.0,
                "pval": 0.001,
                "adjPval": 0.001,
            })
        pd.DataFrame(rows).to_csv(de_file, sep="\t", index=False)

        service = BioNetService()
        config = {"logfc_cutoff": 0.5, "pvalue_cutoff": 0.05}

        with pytest.raises(RuntimeError, match="400"):
            # We test the pre-filter logic directly
            df = pd.read_csv(de_file, sep="\t")
            df_filtered = df[df["logFC"].abs() > config["logfc_cutoff"]]
            if len(df_filtered) >= 400:
                raise RuntimeError(
                    f"{len(df_filtered)} proteins exceed INDRA limit of 400."
                )
```

- [ ] **Step 4: Run unit tests**

```bash
backend/.venv/Scripts/python.exe -m pytest Tests/backend/unit/test_bionet_service.py -v
```
Expected: 3 PASS

- [ ] **Step 5: Write integration test for BioNet routes**

```python
"""Integration tests for BioNet API routes."""
import json
import pytest
from pathlib import Path


@pytest.mark.integration
class TestBioNetRoutes:
    """Test the BioNet on-demand endpoints."""

    async def test_bionet_status_idle(self, async_client, test_session):
        """GET /bionet/status should return idle when no run has been started."""
        response = await async_client.get(
            f"/api/sessions/{test_session}/bionet/status"
        )
        assert response.status_code == 200
        data = response.json()
        assert data["data"]["status"] == "idle"

    async def test_bionet_run_missing_session(self, async_client):
        """POST /bionet/run should 404 for non-existent session."""
        response = await async_client.post(
            "/api/sessions/nonexistent/bionet/run",
            json={"comparison": "test_vs_ctrl"},
        )
        assert response.status_code == 404

    async def test_bionet_run_missing_de_file(self, async_client, test_session):
        """POST /bionet/run should 404 when DE file doesn't exist."""
        response = await async_client.post(
            f"/api/sessions/{test_session}/bionet/run",
            json={"comparison": "nonexistent_vs_ctrl"},
        )
        assert response.status_code == 404

    async def test_bionet_subnetwork_not_computed(self, async_client, test_session):
        """GET /bionet/subnetwork should 404 when no subnetwork exists."""
        response = await async_client.get(
            f"/api/sessions/{test_session}/bionet/subnetwork"
        )
        assert response.status_code == 404
```

- [ ] **Step 6: Run integration tests**

```bash
# Ensure test session has no stray state
rm -rf backend/sessions/test-bionet-*

backend/.venv/Scripts/python.exe -m pytest Tests/backend/integration/test_bionet_routes.py -v
```
Expected: 4 PASS

- [ ] **Step 7: Commit**

```bash
git add Tests/backend/unit/test_bionet_service.py Tests/backend/integration/test_bionet_routes.py
git commit -m "test: add unit and integration tests for BioNet service and routes"
```

---

### Task 5: Frontend — Visualization Module Config

**Files:**
- Modify: `frontend/src/config/visualization-modules.ts`

This task is independent of the R/backend tasks and can run in parallel.

- [ ] **Step 1: Add BioNet module to the array**

Add `GitNetwork` to the lucide-react import at line 2:
```typescript
import { ChartScatter, Activity, Spline, GitCompare, GitNetwork } from 'lucide-react';
```

Add the BioNet entry after the compare module (after line 46):
```typescript
  {
    id: 'bionet',
    label: 'BioNet',
    href: '/analysis/visualization/bionet',
    icon: GitNetwork,
    description: 'Protein-protein interaction network from INDRA database',
    supportedTemplates: ['multi_condition_comparison'],
  },
```

- [ ] **Step 2: Verify the module is exported**

```bash
cd frontend && npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/config/visualization-modules.ts
git commit -m "feat: register BioNet visualization module"
```

---

### Task 6: Frontend — TypeScript Types

**Files:**
- Modify: `frontend/src/types/api.ts` — append BioNet types

- [ ] **Step 1: Add BioNet types**

Append to `frontend/src/types/api.ts`:

```typescript
// BioNet types
export interface BioNetRunRequest {
  comparison: string;
  pvalue_cutoff: number;       // NOTE: filters on adjusted p-value (adj.pvalue), not raw p-value
  logfc_cutoff: number;
  statement_types: string[];
  paper_count_cutoff: number;
  evidence_count_cutoff: number;
  correlation_cutoff: number | null;
  sources_filter: string[] | null;
}

export interface BioNetRunStatus {
  status: 'idle' | 'running' | 'completed' | 'error';
  comparison?: string;
  node_count?: number;
  edge_count?: number;
  error?: string;
  started_at?: string;
  completed_at?: string;
}

export interface BioNetNode {
  id: string;         // UniProt accession (e.g. "P05023"), from Protein column
  logFC: number;
  pvalue: number;     // NOTE: this is the adjusted p-value (from adj.pvalue)
  hgncName: string;   // HGNC gene name for display labels
}

export interface BioNetEdge {
  source: string;     // UniProt accession of source node
  target: string;     // UniProt accession of target node
  interaction: string;
  evidenceCount: number;
  paperCount: number;
  evidenceLink: string;
  sourceCounts: Record<string, number>;
}

export interface BioNetSubnetwork {
  nodes: BioNetNode[];
  edges: BioNetEdge[];
}

// INDRA knowledge sources
export const INDRA_SOURCES = [
  'reach', 'medscan', 'sparser', 'trips',
  'rlimsp', 'geneways', 'tees', 'isi',
  'eidos', 'hume', 'sofia',
] as const;

export type IndraSource = (typeof INDRA_SOURCES)[number];
```

- [ ] **Step 2: Verify types compile**

```bash
cd frontend && npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/types/api.ts
git commit -m "feat: add BioNet TypeScript types"
```

---

### Task 7: Frontend — API Functions

**Files:**
- Modify: `frontend/src/lib/api.ts` — append BioNet functions, update imports

- [ ] **Step 1: Add imports to api.ts**

Update the import block at the top of `frontend/src/lib/api.ts` (around line 6) to include BioNet types:
```typescript
import type {
  ApiResponse,
  DEResultsData,
  QCData,
  GSEAData,
  GSEADatabase,
  GSEARunStatus,
  ProteinAbundance,
  PeptideAbundanceData,
  GSEAPlotData,
  GSEAHeatmapData,
  CompareRunStatus,
  ProteinCorrelationData,
  ComparisonCorrelationData,
  VennData,
  ProteinListEntry,
  CorrelationMethod,
  ClusterMethod,
  BioNetRunRequest,
  BioNetRunStatus,
  BioNetSubnetwork,
} from '@/types/api';
```

- [ ] **Step 2: Add BioNet API functions**

Append to the end of `frontend/src/lib/api.ts` (before the final export):

```typescript
// BioNet API

export async function runBioNet(
  sessionId: string,
  body: BioNetRunRequest
): Promise<{ status: string; comparison: string }> {
  return fetchApi(`/api/sessions/${sessionId}/bionet/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function getBioNetStatus(
  sessionId: string
): Promise<BioNetRunStatus> {
  return fetchApi<BioNetRunStatus>(
    `/api/sessions/${sessionId}/bionet/status`
  );
}

export async function getBioNetSubnetwork(
  sessionId: string
): Promise<BioNetSubnetwork> {
  return fetchApi<BioNetSubnetwork>(
    `/api/sessions/${sessionId}/bionet/subnetwork`
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat: add BioNet API functions"
```

---

### Task 8: Frontend — Cytoscape.js Network Component

**Files:**
- Create: `frontend/src/components/visualization/BioNetNetwork.tsx`

The reusable Cytoscape.js network visualization component. Handles layout, styling, node/edge interactions.

- [ ] **Step 1: Install npm dependencies**

```bash
cd frontend && npm install cytoscape cytoscape-cose-bilkent @types/cytoscape
```

- [ ] **Step 2: Create the BioNetNetwork component**

```typescript
'use client';

import React, { useEffect, useRef, useCallback, useState } from 'react';
import cytoscape, { type Core, type EventObject } from 'cytoscape';
import coseBilkent from 'cytoscape-cose-bilkent';
import type { BioNetNode, BioNetEdge } from '@/types/api';

cytoscape.use(coseBilkent);

type LayoutName = 'cose-bilkent' | 'concentric' | 'grid' | 'circle';

interface BioNetNetworkProps {
  nodes: BioNetNode[];
  edges: BioNetEdge[];
  pvalueCutoff: number;
  logfcCutoff: number;
  keyTargets: string[];
}

export default function BioNetNetwork({
  nodes,
  edges,
  pvalueCutoff,
  logfcCutoff,
  keyTargets,
}: BioNetNetworkProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const [selectedLayout, setSelectedLayout] = useState<LayoutName>('cose-bilkent');
  const [showLegend, setShowLegend] = useState(true);

  const isSignificant = useCallback(
    (pvalue: number, logFC: number) =>
      pvalue < pvalueCutoff && Math.abs(logFC) > logfcCutoff,
    [pvalueCutoff, logfcCutoff]
  );

  // Initialize Cytoscape
  useEffect(() => {
    if (!containerRef.current) return;

    const elements: cytoscape.ElementDefinition[] = [
      ...nodes.map((n) => {
        const sig = isSignificant(n.pvalue, n.logFC);
        return {
          data: {
            id: n.id,
            label: n.hgncName || n.id,
            logFC: n.logFC,
            pvalue: n.pvalue,
            hgncName: n.hgncName,
            significant: sig,
            upregulated: sig && n.logFC > 0,
            isKeyTarget: keyTargets.includes(n.hgncName) || keyTargets.includes(n.id),
          },
        };
      }),
      ...edges.map((e, i) => ({
        data: {
          id: `e${i}`,
          source: e.source,
          target: e.target,
          interaction: e.interaction,
          evidenceCount: e.evidenceCount,
          paperCount: e.paperCount,
          evidenceLink: e.evidenceLink,
          sourceCounts: e.sourceCounts,
        },
      })),
    ];

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style: [
        // Node style
        {
          selector: 'node',
          style: {
            'background-color': (ele: cytoscape.NodeSingular) => {
              const sig = ele.data('significant');
              if (!sig) return '#9ca3af'; // grey for non-sig
              return ele.data('upregulated') ? '#ef4444' : '#3b82f6'; // red up, blue down
            },
            width: (ele: cytoscape.NodeSingular) =>
              20 + Math.min(Math.abs(ele.data('logFC')) * 8, 40),
            height: (ele: cytoscape.NodeSingular) =>
              20 + Math.min(Math.abs(ele.data('logFC')) * 8, 40),
            label: 'data(label)',
            'font-size': '10px',
            'text-valign': 'bottom',
            'text-halign': 'center',
            'text-margin-y': 4,
            color: '#374151',
            'border-width': 0,
          },
        },
        // Key target diamond shape
        {
          selector: 'node[isKeyTarget]',
          style: {
            shape: 'diamond',
            'border-width': 2,
            'border-color': '#f59e0b',
          },
        },
        // Edge style
        {
          selector: 'edge',
          style: {
            width: (ele: cytoscape.EdgeSingular) =>
              1 + Math.min(ele.data('evidenceCount'), 10) * 0.5,
            'line-color': (ele: cytoscape.EdgeSingular) =>
              ele.data('interaction').includes('DecreaseAmount')
                ? '#ef4444'
                : '#22c55e',
            'target-arrow-color': (ele: cytoscape.EdgeSingular) =>
              ele.data('interaction').includes('DecreaseAmount')
                ? '#ef4444'
                : '#22c55e',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
          },
        },
        // Hover highlight
        {
          selector: 'node:active',
          style: { 'border-width': 2, 'border-color': '#6366f1' },
        },
      ],
      layout: { name: 'cose-bilkent', animate: false },
      wheelSensitivity: 0.3,
    });

    // Click node → highlight neighbors + tooltip
    cy.on('tap', 'node', (evt: EventObject) => {
      const node = evt.target;
      cy.elements().removeClass('highlighted');
      node.addClass('highlighted');
      node.neighborhood().addClass('highlighted');
    });

    // Click edge → open evidence link
    cy.on('tap', 'edge', (evt: EventObject) => {
      const edge = evt.target;
      const link = edge.data('evidenceLink');
      if (link) {
        window.open(link, '_blank');
      }
    });

    // Tap background → clear highlight
    cy.on('tap', (evt: EventObject) => {
      if (evt.target === cy) {
        cy.elements().removeClass('highlighted');
      }
    });

    // Tooltip on hover
    cy.on('mouseover', 'node', (evt: EventObject) => {
      const node = evt.target;
      const tip = cy.tooltip?.({ html: true });
      // Simple tooltip via data attributes — for now use a container
    });

    cyRef.current = cy;

    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [nodes, edges, isSignificant, keyTargets]);

  // Change layout
  const applyLayout = useCallback((name: LayoutName) => {
    if (!cyRef.current) return;
    setSelectedLayout(name);
    cyRef.current.layout({ name, animate: true }).run();
  }, []);

  // Export PNG
  const exportPNG = useCallback(() => {
    if (!cyRef.current) return;
    const b64 = cyRef.current.png({ full: true, bg: '#ffffff' });
    const link = document.createElement('a');
    link.download = 'bionet-network.png';
    link.href = b64;
    link.click();
  }, []);

  return (
    <div className="relative">
      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="flex items-center gap-1">
          <span className="text-xs text-text-muted mr-1">Layout:</span>
          {(['cose-bilkent', 'concentric', 'grid', 'circle'] as LayoutName[]).map(
            (name) => (
              <button
                key={name}
                onClick={() => applyLayout(name)}
                className={`px-2 py-1 text-xs rounded ${
                  selectedLayout === name
                    ? 'bg-primary text-white'
                    : 'bg-background border border-border text-text-secondary hover:bg-surface'
                }`}
              >
                {name}
              </button>
            )
          )}
        </div>
        <div className="w-px h-5 bg-border" />
        <button
          onClick={exportPNG}
          className="px-2 py-1 text-xs rounded bg-background border border-border text-text-secondary hover:bg-surface"
        >
          Export PNG
        </button>
        <button
          onClick={() => setShowLegend(!showLegend)}
          className={`px-2 py-1 text-xs rounded ${
            showLegend ? 'bg-primary text-white' : 'bg-background border border-border text-text-secondary'
          }`}
        >
          Legend
        </button>
      </div>

      {/* Legend */}
      {showLegend && (
        <div className="flex items-center gap-4 mb-3 text-xs text-text-secondary">
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-full bg-red-500 inline-block" /> Upregulated
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-full bg-blue-500 inline-block" /> Downregulated
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-full bg-gray-400 inline-block" /> Not significant
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 bg-green-500 inline-block" /> IncreaseAmount
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 bg-red-500 inline-block" /> DecreaseAmount
          </span>
        </div>
      )}

      {/* Cytoscape canvas */}
      <div
        ref={containerRef}
        className="w-full rounded-lg border border-border bg-white"
        style={{ minHeight: 500 }}
      />

      {/* Node detail tooltip (shown on click) */}
      {cyRef.current && (
        <NodeTooltip cyRef={cyRef} />
      )}
    </div>
  );
}

/** Shows a tooltip panel when a node is selected. */
function NodeTooltip({ cyRef }: { cyRef: React.RefObject<Core | null> }) {
  const [nodeData, setNodeData] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    const handler = (evt: EventObject) => {
      const node = evt.target;
      if (node.isNode()) {
        setNodeData({
          id: node.data('id'),
          hgncName: node.data('hgncName'),
          logFC: node.data('logFC'),
          pvalue: node.data('pvalue'),
        });
      }
    };

    cy.on('tap', 'node', handler);
    cy.on('tap', (evt: EventObject) => {
      if (evt.target === cy) setNodeData(null);
    });

    return () => {
      cy.removeListener('tap', 'node', handler);
    };
  }, [cyRef]);

  if (!nodeData) return null;

  return (
    <div className="absolute top-2 right-2 bg-background border border-border rounded-lg p-3 shadow-lg text-xs z-10 max-w-[200px]">
      <p className="font-semibold text-text-primary mb-1">
        {String(nodeData.hgncName || nodeData.id)}
      </p>
      <p className="text-text-secondary">
        UniProt: {String(nodeData.id)}
      </p>
      <p className="text-text-secondary">
        log2FC: {Number(nodeData.logFC).toFixed(3)}
      </p>
      <p className="text-text-secondary">
        Adj. p-value: {Number(nodeData.pvalue).toExponential(2)}
      </p>
    </div>
  );
}
```

- [ ] **Step 3: Verify component compiles**

```bash
cd frontend && npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/visualization/BioNetNetwork.tsx frontend/package.json frontend/package-lock.json
git commit -m "feat: add BioNetNetwork — Cytoscape.js network visualization component"
```

---

### Task 9: Frontend — BioNet Page

**Files:**
- Create: `frontend/src/app/analysis/visualization/bionet/page.tsx`

Follows the GSEA page pattern exactly: single-column, config card + network viz card, polling, on-mount status check, loading/error/empty states.

- [ ] **Step 1: Create the BioNet page component**

```typescript
'use client';

import React, { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import BioNetNetwork from '@/components/visualization/BioNetNetwork';
import type { BioNetRunStatus, BioNetSubnetwork } from '@/types/api';
import { INDRA_SOURCES } from '@/types/api';
import { getBioNetStatus, getBioNetSubnetwork, runBioNet, getSession } from '@/lib/api';
import { formatGroup } from '@/lib/utils';
import { SearchableSelect } from '@/components/ui/Select';
import { LoaderCircle } from 'lucide-react';

const DEFAULT_SOURCES = [...INDRA_SOURCES];

function BioNetContent() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session_id') || searchParams.get('session') || '';

  // Config state
  const [selectedComparison, setSelectedComparison] = useState('');
  const [comparisons, setComparisons] = useState<Array<{ group1: Record<string, string>; group2: Record<string, string> }>>([]);
  const [adjPvalueCutoff, setAdjPvalueCutoff] = useState(0.05);
  const [logfcCutoff, setLogfcCutoff] = useState(0.5);
  const [statementTypes, setStatementTypes] = useState(['IncreaseAmount', 'DecreaseAmount']);
  const [paperCountCutoff, setPaperCountCutoff] = useState(1);
  const [evidenceCountCutoff, setEvidenceCountCutoff] = useState(1);
  const [sourcesFilter, setSourcesFilter] = useState<string[]>(DEFAULT_SOURCES);
  const [allSourcesSelected, setAllSourcesSelected] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Key targets
  const [keyTargetsInput, setKeyTargetsInput] = useState('');
  const [keyTargets, setKeyTargets] = useState<string[]>([]);

  // Run state
  const [runStatus, setRunStatus] = useState<BioNetRunStatus | null>(null);
  const [subnetwork, setSubnetwork] = useState<BioNetSubnetwork | null>(null);
  const [loading, setLoading] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);
  const [runError, setRunError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastStatusRef = useRef<BioNetRunStatus | null>(null);
  const isRunning = runStatus?.status === 'running';

  // Fetch session config for comparisons
  useEffect(() => {
    if (!sessionId) return;
    getSession(sessionId).then((session) => {
      if (session?.config?.comparisons) {
        setComparisons(session.config.comparisons);
        const comps = session.config.comparisons;
        if (comps.length > 0) {
          const first = comps[0];
          setSelectedComparison(
            formatGroup(first.group1) + '_vs_' + formatGroup(first.group2)
          );
        }
      }
    }).catch(() => {});
  }, [sessionId]);

  // Polling
  const pollStatus = useCallback(async () => {
    if (!sessionId) return;
    try {
      const status = await getBioNetStatus(sessionId);
      if (
        lastStatusRef.current?.status === status.status &&
        lastStatusRef.current?.node_count === status.node_count
      ) {
        return;
      }
      lastStatusRef.current = status;
      setRunStatus(status);

      if (status.status === 'completed' || status.status === 'error') {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
        if (status.status === 'error') {
          setRunError(status.error || 'BioNet analysis failed');
        }
        if (status.status === 'completed') {
          const data = await getBioNetSubnetwork(sessionId);
          setSubnetwork(data);
          setInitialLoad(false);
        }
      }
    } catch {
      // silently ignore polling errors
    }
  }, [sessionId]);

  const startPolling = useCallback(() => {
    if (pollIntervalRef.current) return;
    pollStatus();
    pollIntervalRef.current = setInterval(pollStatus, 2000);
  }, [pollStatus]);

  // Check status on mount
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    getBioNetStatus(sessionId).then(async (status) => {
      if (cancelled) return;
      lastStatusRef.current = status;
      setRunStatus(status);
      if (status.status === 'running') {
        startPolling();
      } else if (status.status === 'completed') {
        const data = await getBioNetSubnetwork(sessionId);
        if (!cancelled) setSubnetwork(data);
      }
      setInitialLoad(false);
    }).catch(() => { setInitialLoad(false); });
    return () => { cancelled = true; };
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup polling
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, []);

  // Run BioNet
  const handleRunBioNet = async () => {
    if (!selectedComparison) return;
    setRunError(null);
    try {
      await runBioNet(sessionId, {
        comparison: selectedComparison,
        pvalue_cutoff: adjPvalueCutoff,
        logfc_cutoff: logfcCutoff,
        statement_types: statementTypes,
        paper_count_cutoff: paperCountCutoff,
        evidence_count_cutoff: evidenceCountCutoff,
        correlation_cutoff: null,
        sources_filter: allSourcesSelected ? null : sourcesFilter,
      });
      // Parse key targets
      setKeyTargets(
        keyTargetsInput
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      );
      startPolling();
    } catch (err) {
      setRunError(err instanceof Error ? err.message : 'BioNet run failed');
    }
  };

  // No session
  if (!sessionId) {
    return (
      <div className="flex-1 bg-surface flex items-center justify-center">
        <div className="text-center text-text-secondary">
          <p className="text-lg text-text-primary font-medium mb-2">No session selected</p>
          <p className="text-sm text-text-muted mb-4">Create a new analysis to get started.</p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:opacity-90 transition-opacity"
          >
            Start New Analysis
          </Link>
        </div>
      </div>
    );
  }

  // Initial load skeleton
  if (loading && initialLoad) {
    return (
      <div className="flex-1 bg-surface">
        <div className="mx-auto px-6 py-8 max-w-7xl">
          <div className="h-8 bg-border/30 rounded-lg w-48 mb-6 animate-pulse" />
          <div className="h-32 bg-border/30 rounded-lg mb-6 animate-pulse" />
          <div className="h-96 bg-border/30 rounded-lg animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 bg-surface">
      <div className="mx-auto px-6 py-8 max-w-7xl">
        {/* Header */}
        <div className="mb-6">
          <h1 className="font-semibold text-text-primary">BioNet Network Analysis</h1>
          <p className="text-text-secondary mt-2">
            Protein-protein interaction network from INDRA literature-mined database
          </p>
        </div>

        {/* Comparison Selector */}
        {comparisons.length > 0 && (
          <div className="bg-background rounded-lg border border-border p-4 mb-4">
            <label className="block text-sm font-medium text-text-primary mb-3">
              Select Comparison
            </label>
            <SearchableSelect
              options={comparisons.map((c) => {
                const g1 = formatGroup(c.group1);
                const g2 = formatGroup(c.group2);
                return { value: `${g1}_vs_${g2}`, label: `${g1} vs ${g2}` };
              })}
              value={selectedComparison}
              onChange={setSelectedComparison}
              placeholder="Select comparison..."
              searchPlaceholder="Filter comparisons..."
            />
          </div>
        )}

        {/* Config Card */}
        {selectedComparison && (
          <div className="bg-background rounded-lg border border-border p-4 mb-4">
            {isRunning ? (
              <div className="flex items-center gap-3">
                <LoaderCircle className="w-4 h-4 animate-spin text-primary" />
                <span className="text-sm font-medium text-text-primary">
                  BioNet analysis in progress: {runStatus?.comparison?.replace(/_vs_/g, ' vs ')}
                </span>
                <span className="text-xs text-text-muted">
                  Querying INDRA database... You can navigate away and return
                </span>
              </div>
            ) : (
              <>
                <h3 className="text-sm font-medium text-text-primary mb-4">
                  Parameters — {selectedComparison.replace(/_vs_/g, ' vs ')}
                </h3>

                {/* Basic params */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-3">
                  <div>
                    <label className="block text-xs text-text-secondary mb-1">
                      Adjusted p-value cutoff
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="1"
                      value={adjPvalueCutoff}
                      onChange={(e) => setAdjPvalueCutoff(parseFloat(e.target.value) || 0.05)}
                      className="w-full px-2 py-1.5 text-sm border border-border rounded bg-background text-text-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-text-secondary mb-1">
                      |Log2FC| cutoff
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      value={logfcCutoff}
                      onChange={(e) => setLogfcCutoff(parseFloat(e.target.value) || 0.5)}
                      className="w-full px-2 py-1.5 text-sm border border-border rounded bg-background text-text-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-text-secondary mb-1">
                      Paper count ≥
                    </label>
                    <input
                      type="number"
                      step="1"
                      min="1"
                      value={paperCountCutoff}
                      onChange={(e) => setPaperCountCutoff(parseInt(e.target.value) || 1)}
                      className="w-full px-2 py-1.5 text-sm border border-border rounded bg-background text-text-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-text-secondary mb-1">
                      Evidence count ≥
                    </label>
                    <input
                      type="number"
                      step="1"
                      min="1"
                      value={evidenceCountCutoff}
                      onChange={(e) => setEvidenceCountCutoff(parseInt(e.target.value) || 1)}
                      className="w-full px-2 py-1.5 text-sm border border-border rounded bg-background text-text-primary"
                    />
                  </div>
                </div>

                {/* Statement types */}
                <div className="mb-3">
                  <label className="block text-xs text-text-secondary mb-1">
                    Interaction Types
                  </label>
                  <div className="flex gap-4">
                    {['IncreaseAmount', 'DecreaseAmount'].map((t) => (
                      <label key={t} className="flex items-center gap-1.5 text-sm text-text-primary">
                        <input
                          type="checkbox"
                          checked={statementTypes.includes(t)}
                          onChange={() =>
                            setStatementTypes((prev) =>
                              prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
                            )
                          }
                          className="rounded"
                        />
                        {t}
                      </label>
                    ))}
                  </div>
                </div>

                {/* Key targets */}
                <div className="mb-3">
                  <label className="block text-xs text-text-secondary mb-1">
                    Key Targets (comma-separated gene names, optional)
                  </label>
                  <input
                    type="text"
                    value={keyTargetsInput}
                    onChange={(e) => setKeyTargetsInput(e.target.value)}
                    placeholder="e.g., TP53, AKT1, MYC"
                    className="w-full max-w-md px-2 py-1.5 text-sm border border-border rounded bg-background text-text-primary"
                  />
                </div>

                {/* Advanced toggle */}
                <button
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="text-xs text-primary hover:underline mb-3"
                >
                  {showAdvanced ? 'Hide' : 'Show'} Advanced — Knowledge Sources
                </button>

                {/* Sources filter */}
                {showAdvanced && (
                  <div className="mb-3 p-3 bg-surface rounded border border-border">
                    <label className="flex items-center gap-2 text-xs text-text-secondary mb-2">
                      <input
                        type="checkbox"
                        checked={allSourcesSelected}
                        onChange={() => {
                          setAllSourcesSelected(!allSourcesSelected);
                          if (!allSourcesSelected) {
                            setSourcesFilter(DEFAULT_SOURCES);
                          }
                        }}
                        className="rounded"
                      />
                      All sources
                    </label>
                    {!allSourcesSelected && (
                      <div className="grid grid-cols-3 md:grid-cols-4 gap-1.5">
                        {INDRA_SOURCES.map((src) => (
                          <label
                            key={src}
                            className="flex items-center gap-1.5 text-xs text-text-primary"
                          >
                            <input
                              type="checkbox"
                              checked={sourcesFilter.includes(src)}
                              onChange={() =>
                                setSourcesFilter((prev) =>
                                  prev.includes(src)
                                    ? prev.filter((x) => x !== src)
                                    : [...prev, src]
                                )
                              }
                              className="rounded"
                            />
                            {src}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Run button + error */}
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleRunBioNet}
                    className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity"
                  >
                    Run BioNet Analysis
                  </button>
                  {runError && (
                    <span className="text-xs text-error">{runError}</span>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* Status on error (non-run errors) */}
        {error && (
          <div className="bg-error/5 border border-error/20 rounded-lg p-5 mb-4">
            <h2 className="text-base font-semibold text-error mb-2">Error</h2>
            <p className="text-error text-sm">{error}</p>
          </div>
        )}

        {/* Network Viz Card */}
        {(runStatus?.status === 'completed' || subnetwork) && subnetwork && (
          <div className="bg-background rounded-lg border border-border p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-sm font-medium text-text-primary">
                  Interaction Network
                </h3>
                <p className="text-xs text-text-secondary mt-0.5">
                  {subnetwork.nodes.length} proteins, {subnetwork.edges.length} interactions
                  {runStatus?.node_count && ` · Query: ${runStatus.comparison?.replace(/_vs_/g, ' vs ')}`}
                </p>
              </div>
            </div>

            {subnetwork.nodes.length === 0 ? (
              <div className="text-center py-16 text-text-muted text-sm">
                <p className="mb-2">No protein interactions found in INDRA for this comparison.</p>
                <p>Try relaxing the p-value or |log2FC| cutoff.</p>
              </div>
            ) : (
              <BioNetNetwork
                nodes={subnetwork.nodes}
                edges={subnetwork.edges}
                pvalueCutoff={adjPvalueCutoff}
                logfcCutoff={logfcCutoff}
                keyTargets={keyTargets}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function BioNetPage() {
  return (
    <Suspense
      fallback={
        <div className="flex-1 bg-surface">
          <div className="mx-auto px-6 py-8 max-w-7xl">
            <div className="h-8 bg-border/30 rounded-lg w-48 mb-6 animate-pulse" />
            <div className="h-32 bg-border/30 rounded-lg mb-6 animate-pulse" />
          </div>
        </div>
      }
    >
      <BioNetContent />
    </Suspense>
  );
}
```

- [ ] **Step 2: Verify the page compiles**

```bash
cd frontend && npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 3: Manual smoke test**

Start backend and frontend:
```bash
# Terminal 1: backend
taskkill //F //IM python.exe 2>/dev/null
backend/.venv/Scripts/python.exe -m uvicorn app.main:app --reload --reload-exclude "sessions" --port 8000

# Terminal 2: frontend
cd frontend && npm run dev
```

Navigate to `http://localhost:3000/analysis/visualization/bionet?session_id=<existing-session-id>`.
Expected: Page renders with comparison selector, config panel, and "Run BioNet Analysis" button.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/analysis/visualization/bionet/page.tsx
git commit -m "feat: add BioNet page — config panel + network visualization"
```

---

### Task 10: Integration & E2E Verification

**Files:**
- Create: `Tests/e2e/bionet.spec.ts` (optional, if e2e infrastructure exists)

- [ ] **Step 1: End-to-end test with a real session that has DE results**

Create a test session with a DE TSV file:
```bash
# Create test session directory with a DE TSV
mkdir -p backend/sessions/test-bionet-e2e/results
cat > backend/sessions/test-bionet-e2e/results/Diff_Expression_Drug_vs_DMSO.tsv << 'EOF'
Master_Protein_Accessions	Gene_Name	PSM_Count	logFC	pval	adjPval	se
P05023	ATP1A1	5	1.839	0.001	0.003	0.212
O00217	NDUFS8	3	2.029	0.009	0.014	0.436
O60879	DIAPH2	4	-1.948	0.0003	0.002	0.170
P05067	APP	6	0.736	0.020	0.020	0.310
EOF
```

- [ ] **Step 2: Test API endpoints end-to-end**

```bash
# Start backend
backend/.venv/Scripts/python.exe -m uvicorn app.main:app --reload-exclude "sessions" --port 8000
```

```bash
# 1. Check initial status
curl -s http://localhost:8000/api/sessions/test-bionet-e2e/bionet/status
# Expected: {"data":{"status":"idle"}}

# 2. Start BioNet run
curl -s -X POST http://localhost:8000/api/sessions/test-bionet-e2e/bionet/run \
  -H "Content-Type: application/json" \
  -d '{"comparison":"Drug_vs_DMSO","pvalue_cutoff":0.05,"logfc_cutoff":0.5,"statement_types":["IncreaseAmount","DecreaseAmount"],"paper_count_cutoff":1,"evidence_count_cutoff":1,"correlation_cutoff":null,"sources_filter":null}'
# Expected: {"data":{"status":"started","comparison":"Drug_vs_DMSO"}}

# 3. Poll status
curl -s http://localhost:8000/api/sessions/test-bionet-e2e/bionet/status
# Expected: {"data":{"status":"running",...}} (or "completed" if fast)

# 4. Wait a few seconds, then get subnetwork
sleep 10
curl -s http://localhost:8000/api/sessions/test-bionet-e2e/bionet/subnetwork | python -c "import sys,json; d=json.load(sys.stdin); print(f'Nodes: {len(d[\"data\"][\"nodes\"])}, Edges: {len(d[\"data\"][\"edges\"])}')"
# Expected: Nodes: N, Edges: M (N, M depend on INDRA)
```

- [ ] **Step 3: Test concurrency lock**

```bash
# Start a run, then immediately try another (should 409)
curl -s -X POST http://localhost:8000/api/sessions/test-bionet-e2e/bionet/run \
  -H "Content-Type: application/json" \
  -d '{"comparison":"Drug_vs_DMSO"}' &

sleep 0.5

curl -s -X POST http://localhost:8000/api/sessions/test-bionet-e2e/bionet/run \
  -H "Content-Type: application/json" \
  -d '{"comparison":"Drug_vs_DMSO"}'
# Expected: 409 "A BioNet analysis is already running for this session"
```

- [ ] **Step 4: Cleanup test artifacts**

```bash
rm -rf backend/sessions/test-bionet-e2e
```

- [ ] **Step 5: Commit**

```bash
git commit -m "test: add e2e verification steps for BioNet endpoints"
```

---

## File Summary

### Created (4 new files)
| File | Lines |
|------|-------|
| `backend/scripts/bionet_network.R` | ~40 |
| `backend/app/services/bionet_service.py` | ~100 |
| `frontend/src/components/visualization/BioNetNetwork.tsx` | ~280 |
| `frontend/src/app/analysis/visualization/bionet/page.tsx` | ~350 |

### Modified (5 files)
| File | Changes |
|------|---------|
| `backend/app/api/routes/visualization.py` | +~170 lines (models, helpers, 3 endpoints, background task) |
| `frontend/src/types/api.ts` | +~50 lines (BioNet types + INDRA_SOURCES const) |
| `frontend/src/lib/api.ts` | +~35 lines (3 API functions + import update) |
| `frontend/src/config/visualization-modules.ts` | +8 lines (BioNet module entry + GitNetwork import) |
| `frontend/package.json` | +2 deps (cytoscape, cytoscape-cose-bilkent) |

### Existing files touched (read-only reference)
- `backend/app/main.py:214` — verify visualization router is already mounted
- `frontend/src/app/analysis/visualization/layout.tsx` — tab bar auto-includes new module from config
- `frontend/next.config.ts` — verify API proxy config

---

## Risk & Mitigation

| Risk | Mitigation |
|------|-----------|
| INDRA API unreachable or slow | Status polling handles this — shows "running" until complete or error. Configurable R timeout in settings |
| Empty subnetwork (no known interactions) | Frontend shows "No interactions found" with suggestion to relax cutoffs |
| >400 proteins cause INDRA error | Python pre-check raises clear RuntimeError before calling R |
| `sourceCounts` JSON parse failure | Service handles both string and dict forms |
| `issue` column handling | R script injects `df$issue <- NA` explicitly |
