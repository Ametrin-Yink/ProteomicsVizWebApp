# Report Module Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dual-viewer (vanilla JS ZIP template + React weblink) with a single React-based report viewer backed by server-side file copy and report-scoped API endpoints.

**Architecture:** Export copies the session directory (excluding `uploads/` and `pipeline_state.json`) into a standalone report directory. The report viewer page uses the same React components as the visualization page, with API calls routed through report-scoped endpoints that read from the report's own files. A React Context provides the API prefix (`/api/sessions/{sid}` vs `/api/reports/{rid}`) so components work for both.

**Tech Stack:** Python 3.12 (FastAPI, asyncio, shutil), TypeScript/React 19 (Next.js, Plotly, Cytoscape), pytest, Playwright

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `backend/app/services/report_store.py` | Rewrite | Report CRUD, state management (remove ZIP) |
| `backend/app/services/report_generator.py` | Create | Copy session files → report directory |
| `backend/app/api/routes/reports.py` | Rewrite | All report API endpoints |
| `backend/app/main.py` | Modify | Mount updated report routes |
| `frontend/src/lib/api-context.tsx` | Create | React Context for API prefix |
| `frontend/src/lib/api.ts` | Modify | Refactor to accept `apiPrefix` parameter |
| `frontend/src/components/visualization/ProteinInfo.tsx` | Modify | Remove `sessionId` prop, use context |
| `frontend/src/components/visualization/GSEAPlot.tsx` | Modify | Remove `sessionId` prop, use context |
| `frontend/src/components/visualization/compare/ComparisonCorrelationPanel.tsx` | Modify | Remove `sessionId` prop, use context |
| `frontend/src/components/visualization/compare/ProteinCorrelationPanel.tsx` | Modify | Remove `sessionId` prop, use context |
| `frontend/src/components/visualization/ExportModal.tsx` | Simplify | Name input + single POST |
| `frontend/src/app/reports/[reportId]/page.tsx` | Rewrite | Thin shell using shared components |
| `frontend/src/app/analysis/visualization/layout.tsx` | Modify | Add ApiProvider wrapper (covers all 5 viz sub-pages) |
| `frontend/public/report-template.html` | Delete | Vanilla JS template |
| `frontend/src/lib/html-report-builder.ts` | Delete | ZIP assembly |
| `Tests/backend/unit/test_report_store.py` | Rewrite | Match new store API |
| `Tests/backend/unit/test_report_generator.py` | Create | Test file copy + metadata |
| `Tests/backend/integration/test_report_routes.py` | Rewrite | Match new endpoints |
| `Tests/e2e/report-export.spec.ts` | Rewrite | Match new export flow |

---

## Phase 1: Backend — Report Store Rewrite

### Task 1: Write failing tests for new report_store API

**Files:**
- Rewrite: `Tests/backend/unit/test_report_store.py`

- [ ] **Step 1: Write the complete test file**

```python
"""
Unit tests for report_store service (post-redesign).
"""

import json
import shutil
from pathlib import Path
import pytest


@pytest.fixture
def temp_reports_dir(monkeypatch, tmp_path):
    """Redirect reports dir to a temp path."""
    from app.core import config
    monkeypatch.setattr(config.settings, "base_dir", tmp_path)
    import app.services.report_store as store
    monkeypatch.setattr(store, "REPORTS_DIR", tmp_path / "reports")
    yield tmp_path / "reports"


def make_report_files(report_dir: Path, name="Test Report",
                      session_id="ses_123", session_name="Experiment A"):
    """Create a minimal valid report on disk (simulating export)."""
    report_dir.mkdir(parents=True, exist_ok=True)

    session_json = {
        "id": session_id,
        "name": session_name,
        "template": "multi_condition_comparison",
        "state": "completed",
        "config": {
            "experiment_name": session_name,
            "conditions": ["Treatment", "Control"],
            "comparisons": [
                {"group1": {"Condition": "Treatment"}, "group2": {"Condition": "Control"}}
            ],
        },
        "markers": {},
        "volcano_filters": {"foldChange": 1, "pValue": 0.05, "adjPValue": 1, "s0": 0.1},
    }
    (report_dir / "session.json").write_text(json.dumps(session_json, indent=2))

    report_json = {
        "report_id": report_dir.name,
        "name": name,
        "session_id": session_id,
        "session_name": session_name,
        "created_at": "2026-05-07T00:00:00Z",
    }
    (report_dir / "report.json").write_text(json.dumps(report_json, indent=2))


def test_create_report_from_session_copy(temp_reports_dir, tmp_path):
    """create_report now takes metadata dict, not ZIP bytes."""
    from app.services.report_store import create_report

    meta = create_report(
        name="My Report",
        session_id="ses_abc",
        session_name="Experiment X",
    )

    assert meta["name"] == "My Report"
    assert meta["session_id"] == "ses_abc"
    assert meta["report_id"].startswith("rpt_")
    assert "created_at" in meta

    # Verify directory and report.json exist
    report_dir = temp_reports_dir / meta["report_id"]
    assert report_dir.is_dir()
    assert (report_dir / "report.json").exists()

    stored = json.loads((report_dir / "report.json").read_text())
    assert stored["name"] == "My Report"


def test_list_reports_empty(temp_reports_dir):
    from app.services.report_store import list_reports
    assert list_reports() == []


def test_list_reports_sorted(temp_reports_dir):
    from app.services.report_store import create_report, list_reports
    import time

    m1 = create_report("A", "s1", "E1")
    time.sleep(0.1)
    m2 = create_report("B", "s2", "E2")

    reports = list_reports()
    assert len(reports) == 2
    assert reports[0]["report_id"] == m2["report_id"]  # newest first


def test_get_report_dir(temp_reports_dir):
    from app.services.report_store import create_report, get_report_dir

    meta = create_report("R", "s1", "E1")
    rd = get_report_dir(meta["report_id"])
    assert rd is not None
    assert rd.is_dir()


def test_get_report_dir_nonexistent(temp_reports_dir):
    from app.services.report_store import get_report_dir
    assert get_report_dir("rpt_nonexistent") is None


def test_delete_report(temp_reports_dir):
    from app.services.report_store import create_report, delete_report, get_report_dir

    meta = create_report("R", "s1", "E1")
    assert delete_report(meta["report_id"]) is True
    assert get_report_dir(meta["report_id"]) is None


def test_delete_nonexistent(temp_reports_dir):
    from app.services.report_store import delete_report
    assert delete_report("rpt_nonexistent") is False


def test_get_report_metadata(temp_reports_dir):
    from app.services.report_store import create_report, get_report_metadata

    meta = create_report("R", "s1", "E1")
    stored = get_report_metadata(meta["report_id"])
    assert stored == meta


def test_patch_report_state_writes_to_session_json(temp_reports_dir):
    """PATCH visualization-state updates markers in the report's session.json."""
    from app.services.report_store import create_report, patch_report_state

    meta = create_report("R", "ses_src", "Exp")
    report_dir = temp_reports_dir / meta["report_id"]
    # Simulate export: copy a session.json into the report
    make_report_files(report_dir, session_id="ses_src")

    patch_report_state(meta["report_id"], markers={"comp_a": ["P12345"]})
    session_json = json.loads((report_dir / "session.json").read_text())
    assert session_json["markers"] == {"comp_a": ["P12345"]}


def test_patch_report_state_volcano_filters(temp_reports_dir):
    from app.services.report_store import create_report, patch_report_state

    meta = create_report("R", "ses_src", "Exp")
    report_dir = temp_reports_dir / meta["report_id"]
    make_report_files(report_dir)

    new_filters = {"foldChange": 2, "pValue": 0.01, "adjPValue": 0.05, "s0": 0.2}
    patch_report_state(meta["report_id"], volcano_filters=new_filters)
    session_json = json.loads((report_dir / "session.json").read_text())
    assert session_json["volcano_filters"] == new_filters


def test_get_report_session_json(temp_reports_dir):
    from app.services.report_store import create_report, get_report_session

    meta = create_report("R", "ses_src", "Exp")
    report_dir = temp_reports_dir / meta["report_id"]
    make_report_files(report_dir, session_name="My Experiment")

    session_data = get_report_session(meta["report_id"])
    assert session_data is not None
    assert session_data["config"]["experiment_name"] == "My Experiment"
    assert session_data["config"]["comparisons"] == [
        {"group1": {"Condition": "Treatment"}, "group2": {"Condition": "Control"}}
    ]


def test_get_report_session_nonexistent(temp_reports_dir):
    from app.services.report_store import get_report_session
    assert get_report_session("rpt_nonexistent") is None
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
backend/.venv/Scripts/python.exe -m pytest Tests/backend/unit/test_report_store.py -v
```
Expected: All tests FAIL (import errors for new functions).

- [ ] **Step 3: Commit**

```bash
git add Tests/backend/unit/test_report_store.py
git commit -m "test: add failing tests for new report_store API"
```

### Task 2: Rewrite report_store.py

**Files:**
- Rewrite: `backend/app/services/report_store.py`

- [ ] **Step 1: Write the new implementation**

```python
"""
Report storage service.

Manages a global reports directory independent of session lifecycle.
Reports are self-contained directories with session data + metadata.
"""

import json
import logging
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from app.core.config import settings

logger = logging.getLogger("proteomics")

REPORTS_DIR = settings.base_dir / "reports"


def _reports_dir() -> Path:
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    return REPORTS_DIR


def create_report(name: str, session_id: str, session_name: str) -> dict:
    """Create a report directory with metadata. Returns metadata dict.

    Does NOT copy session files — that's done by report_generator.
    """
    report_id = f"rpt_{uuid.uuid4().hex[:12]}"
    report_dir = _reports_dir() / report_id
    report_dir.mkdir(parents=True, exist_ok=True)

    metadata = {
        "report_id": report_id,
        "name": name,
        "session_id": session_id,
        "session_name": session_name,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    (report_dir / "report.json").write_text(
        json.dumps(metadata, indent=2), encoding="utf-8"
    )

    logger.info(f"Report created: {report_id} ({name})")
    return metadata


def list_reports() -> list[dict]:
    """List all reports sorted by creation time (newest first)."""
    rd = _reports_dir()
    if not rd.exists():
        return []

    reports = []
    for report_dir in sorted(rd.iterdir(), key=lambda p: p.name, reverse=True):
        if not report_dir.is_dir():
            continue
        meta_path = report_dir / "report.json"
        if meta_path.exists():
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
                reports.append(meta)
            except Exception:
                logger.warning(f"Corrupt report metadata: {meta_path}")

    reports.sort(key=lambda r: r.get("created_at", ""), reverse=True)
    return reports


def get_report_dir(report_id: str) -> Optional[Path]:
    """Get report directory path, validating it exists."""
    rd = _reports_dir()
    report_dir = rd / report_id
    if report_dir.is_dir() and (report_dir / "report.json").exists():
        return report_dir
    return None


def get_report_metadata(report_id: str) -> Optional[dict]:
    """Get report metadata dict."""
    report_dir = get_report_dir(report_id)
    if not report_dir:
        return None
    return json.loads((report_dir / "report.json").read_text(encoding="utf-8"))


def get_report_session(report_id: str) -> Optional[dict]:
    """Get the report's session.json content (config, markers, filters)."""
    report_dir = get_report_dir(report_id)
    if not report_dir:
        return None
    session_path = report_dir / "session.json"
    if not session_path.exists():
        return None
    return json.loads(session_path.read_text(encoding="utf-8"))


def patch_report_state(
    report_id: str,
    markers: Optional[dict] = None,
    volcano_filters: Optional[dict] = None,
) -> bool:
    """Update markers and/or volcano_filters in the report's session.json."""
    report_dir = get_report_dir(report_id)
    if not report_dir:
        return False
    session_path = report_dir / "session.json"
    if not session_path.exists():
        return False
    session_data = json.loads(session_path.read_text(encoding="utf-8"))
    if markers is not None:
        session_data["markers"] = markers
    if volcano_filters is not None:
        session_data["volcano_filters"] = volcano_filters
    session_path.write_text(json.dumps(session_data, indent=2), encoding="utf-8")
    return True


def delete_report(report_id: str) -> bool:
    """Delete a report directory. Returns True if deleted, False if not found."""
    report_dir = get_report_dir(report_id)
    if not report_dir:
        return False
    shutil.rmtree(report_dir)
    logger.info(f"Report deleted: {report_id}")
    return True
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
backend/.venv/Scripts/python.exe -m pytest Tests/backend/unit/test_report_store.py -v
```
Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/report_store.py
git commit -m "feat: rewrite report_store — remove ZIP, add state and session access"
```

---

## Phase 2: Backend — Report Generator

### Task 3: Write tests for report_generator

**Files:**
- Create: `Tests/backend/unit/test_report_generator.py`

- [ ] **Step 1: Write the test file**

```python
"""
Unit tests for report_generator service.
"""

import json
import shutil
from pathlib import Path
import pytest


@pytest.fixture
def temp_dirs(monkeypatch, tmp_path):
    """Set up temp session and report directories."""
    sessions_dir = tmp_path / "sessions"
    reports_dir = tmp_path / "reports"

    from app.core import config
    monkeypatch.setattr(config.settings, "base_dir", tmp_path)
    monkeypatch.setattr(config.settings, "sessions_dir", sessions_dir)

    import app.services.report_store as store
    monkeypatch.setattr(store, "REPORTS_DIR", reports_dir)

    return sessions_dir, reports_dir


def make_completed_session(sessions_dir: Path, session_id: str) -> Path:
    """Create a minimal completed session directory with result files."""
    session_dir = sessions_dir / session_id
    results_dir = session_dir / "results"
    results_dir.mkdir(parents=True, exist_ok=True)

    # session.json
    session_json = {
        "id": session_id,
        "name": "Test Experiment",
        "state": "completed",
        "config": {
            "experiment_name": "Test Experiment",
            "conditions": ["Treatment", "Control"],
            "comparisons": [
                {"group1": {"Condition": "Treatment"}, "group2": {"Condition": "Control"}}
            ],
        },
        "markers": {"Treatment_vs_Control": ["P12345"]},
        "volcano_filters": {"foldChange": 1, "pValue": 0.05, "adjPValue": 1, "s0": 0.1},
    }
    (session_dir / "session.json").write_text(json.dumps(session_json, indent=2))

    # pipeline_state.json (should be excluded)
    (session_dir / "pipeline_state.json").write_text('{"current_step": 9, "state": "completed"}')

    # results files
    (results_dir / "Diff_Expression_Treatment_vs_Control.tsv").write_text(
        "Master_Protein_Accessions\tGene_Name\tlogFC\tpval\tadjPval\tPSM_Count\n"
        "P12345\tGENE1\t2.5\t0.001\t0.01\t10\n"
    )
    (results_dir / "Protein_Abundances.tsv").write_text(
        "Master_Protein_Accessions\tGene_Name\tPSM_Count\tSample1\tSample2\n"
        "P12345\tGENE1\t10\t15.2\t14.8\n"
    )
    (results_dir / "QC_Results.json").write_text('{"pca": {"pc1": [1,2,3]}}')
    (results_dir / "PSM_Abundances.parquet").write_bytes(b"fake_parquet")

    # GSEA results
    gsea_dir = results_dir / "gsea" / "Treatment_vs_Control"
    gsea_dir.mkdir(parents=True)
    (gsea_dir / "GSEA_Results.json").write_text('{"go_bp": []}')

    # Compare results
    compare_dir = results_dir / "compare"
    compare_dir.mkdir(parents=True)
    (compare_dir / "comparison-correlation_status.json").write_text('{"status": "completed"}')

    # BioNet
    bionet_dir = session_dir / "bionet"
    bionet_dir.mkdir(parents=True)
    (bionet_dir / "bionet_subnetwork.json").write_text('{"nodes": [], "edges": []}')

    # gsea_run_status.json
    (session_dir / "gsea_run_status.json").write_text('{"Treatment_vs_Control": "completed"}')

    # uploads (should be excluded)
    uploads_dir = session_dir / "uploads"
    uploads_dir.mkdir(parents=True)
    (uploads_dir / "large_file.csv").write_text("big,data,here\n" * 1000)

    return session_dir


def test_generate_copies_all_expected_files(temp_dirs, monkeypatch):
    from app.services.report_generator import generate_report
    from app.services.report_store import create_report, get_report_dir

    sessions_dir, reports_dir = temp_dirs
    session_id = "abc-123-def"
    make_completed_session(sessions_dir, session_id)

    meta = create_report("My Report", session_id, "Test Experiment")
    report_dir = reports_dir / meta["report_id"]
    report_dir.mkdir(parents=True, exist_ok=True)
    (report_dir / "report.json").write_text(json.dumps(meta))

    generate_report(session_id, meta["report_id"])

    # Should copy session.json
    assert (report_dir / "session.json").exists()
    # Should copy results
    assert (report_dir / "results" / "Diff_Expression_Treatment_vs_Control.tsv").exists()
    assert (report_dir / "results" / "Protein_Abundances.tsv").exists()
    assert (report_dir / "results" / "QC_Results.json").exists()
    assert (report_dir / "results" / "PSM_Abundances.parquet").exists()
    # Should copy GSEA
    assert (report_dir / "results" / "gsea" / "Treatment_vs_Control" / "GSEA_Results.json").exists()
    # Should copy compare
    assert (report_dir / "results" / "compare" / "comparison-correlation_status.json").exists()
    # Should copy bionet
    assert (report_dir / "bionet" / "bionet_subnetwork.json").exists()
    # Should copy gsea_run_status.json
    assert (report_dir / "gsea_run_status.json").exists()


def test_generate_excludes_uploads_and_pipeline_state(temp_dirs):
    from app.services.report_generator import generate_report
    from app.services.report_store import create_report

    sessions_dir, reports_dir = temp_dirs
    session_id = "abc-456"
    make_completed_session(sessions_dir, session_id)

    meta = create_report("R", session_id, "E")
    report_dir = reports_dir / meta["report_id"]
    report_dir.mkdir(parents=True, exist_ok=True)
    (report_dir / "report.json").write_text(json.dumps(meta))

    generate_report(session_id, meta["report_id"])

    # Should NOT copy uploads
    assert not (report_dir / "uploads").exists()
    # Should NOT copy pipeline_state.json
    assert not (report_dir / "pipeline_state.json").exists()


def test_generate_rejects_non_completed_session(temp_dirs):
    from app.services.report_generator import generate_report

    sessions_dir, reports_dir = temp_dirs
    session_id = "incomplete-session"
    session_dir = sessions_dir / session_id
    session_dir.mkdir(parents=True)
    (session_dir / "session.json").write_text('{"id": "incomplete", "state": "processing"}')

    with pytest.raises(ValueError, match="not completed"):
        generate_report(session_id, "rpt_whatever")
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
backend/.venv/Scripts/python.exe -m pytest Tests/backend/unit/test_report_generator.py -v
```
Expected: FAIL (module not found).

- [ ] **Step 3: Commit**

```bash
git add Tests/backend/unit/test_report_generator.py
git commit -m "test: add failing tests for report_generator"
```

### Task 4: Implement report_generator.py

**Files:**
- Create: `backend/app/services/report_generator.py`

- [ ] **Step 1: Write the implementation**

```python
"""
Report generator service.

Copies session files into a report directory at export time.
Uses a blacklist approach: session directory is copied in full,
excluding only uploads/ and pipeline_state.json.
"""

import json
import logging
import shutil
from pathlib import Path

from app.core.config import settings

logger = logging.getLogger("proteomics")

EXCLUDED_NAMES = {"uploads", "pipeline_state.json"}


def _copytree_blacklist(src: Path, dst: Path) -> None:
    """Recursively copy src to dst, skipping EXCLUDED_NAMES."""
    dst.mkdir(parents=True, exist_ok=True)
    for item in src.iterdir():
        if item.name in EXCLUDED_NAMES:
            logger.debug(f"Skipping excluded: {item}")
            continue
        dest = dst / item.name
        if item.is_dir():
            _copytree_blacklist(item, dest)
        else:
            shutil.copy2(item, dest)


def generate_report(session_id: str, report_id: str) -> None:
    """Copy session files into the report directory.

    Reads session state from session.json to verify the session is completed.
    Copies everything except uploads/ and pipeline_state.json.

    Raises:
        ValueError: if session is not found or not completed.
    """
    session_dir = settings.sessions_dir / session_id
    if not session_dir.is_dir():
        raise ValueError(f"Session not found: {session_id}")

    session_json_path = session_dir / "session.json"
    if not session_json_path.exists():
        raise ValueError(f"Session {session_id} has no session.json")

    session_data = json.loads(session_json_path.read_text(encoding="utf-8"))
    state = session_data.get("state", "")
    if state != "completed":
        raise ValueError(
            f"Session {session_id} is not completed (state={state}). "
            "Only completed sessions can be exported."
        )

    reports_dir = settings.base_dir / "reports"
    report_dir = reports_dir / report_id
    if not report_dir.is_dir():
        raise ValueError(f"Report directory not found: {report_id}")

    logger.info(f"Copying session {session_id} → report {report_id}")

    _copytree_blacklist(session_dir, report_dir)

    logger.info(f"Report {report_id} populated with session data")
```

- [ ] **Step 2: Run tests**

```bash
backend/.venv/Scripts/python.exe -m pytest Tests/backend/unit/test_report_generator.py -v
```
Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/report_generator.py
git commit -m "feat: add report_generator — blacklist copy of session to report"
```

---

## Phase 3: Backend — Report Routes Rewrite

### Task 5: Write integration tests for new report endpoints

**Files:**
- Rewrite: `Tests/backend/integration/test_report_routes.py`

- [ ] **Step 1: Write the integration test file**

```python
"""
Integration tests for report API routes (post-redesign).
"""

import json
import uuid
import pytest
from httpx import AsyncClient, ASGITransport
from pathlib import Path
from app.main import app


@pytest.fixture
def client(monkeypatch, tmp_path):
    """Create an async test client with temp directories."""
    sessions_dir = tmp_path / "sessions"
    reports_dir = tmp_path / "reports"
    sessions_dir.mkdir(parents=True)
    reports_dir.mkdir(parents=True)

    from app.core import config
    monkeypatch.setattr(config.settings, "base_dir", tmp_path)
    monkeypatch.setattr(config.settings, "sessions_dir", sessions_dir)

    from app.db.session_store import SessionStore
    from app.services.session_manager import session_manager

    if not hasattr(app.state, "session_manager"):
        store = SessionStore(sessions_dir)
        app.state.session_store = store
        session_manager.session_store = store
        app.state.session_manager = session_manager

    import app.services.report_store as report_store
    monkeypatch.setattr(report_store, "REPORTS_DIR", reports_dir)

    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


def make_completed_session_with_files(sessions_dir: Path, session_id: str):
    """Create a completed session with result files for export testing."""
    session_dir = sessions_dir / session_id
    session_dir.mkdir(parents=True)

    (session_dir / "session.json").write_text(json.dumps({
        "id": session_id,
        "name": "Test Experiment",
        "state": "completed",
        "config": {
            "experiment_name": "Test Experiment",
            "comparisons": [
                {"group1": {"C": "Trt"}, "group2": {"C": "Ctrl"}}
            ],
        },
        "markers": {},
        "volcano_filters": {"foldChange": 1, "pValue": 0.05, "adjPValue": 1, "s0": 0.1},
    }))

    results_dir = session_dir / "results"
    results_dir.mkdir(parents=True)
    (results_dir / "Diff_Expression_Trt_vs_Ctrl.tsv").write_text(
        "Master_Protein_Accessions\tGene_Name\tlogFC\tpval\tadjPval\tPSM_Count\n"
        "P12345\tGENE1\t2.5\t0.001\t0.01\t10\n"
    )
    (results_dir / "Protein_Abundances.tsv").write_text(
        "Master_Protein_Accessions\tGene_Name\tPSM_Count\tS1\tS2\n"
        "P12345\tGENE1\t10\t15.2\t14.8\n"
    )
    (results_dir / "QC_Results.json").write_text('{"pca": {"pc1": [1,2,3]}}')
    (results_dir / "PSM_Abundances.tsv").write_text("Sequence\tS1\tS2\nPEPTIDE\t100\t200\n")

    # GSEA
    gsea_dir = results_dir / "gsea" / "Trt_vs_Ctrl"
    gsea_dir.mkdir(parents=True)
    (gsea_dir / "GSEA_Results.json").write_text('{"go_bp": [{"Term": "test", "P-value": 0.01}]}')

    # BioNet
    bionet_dir = session_dir / "bionet"
    bionet_dir.mkdir(parents=True)
    (bionet_dir / "bionet_subnetwork.json").write_text('{"nodes": [], "edges": []}')
    (bionet_dir / "bionet_status.json").write_text('{"status": "completed"}')

    # gsea_run_status
    (session_dir / "gsea_run_status.json").write_text('{"Trt_vs_Ctrl": "completed"}')


@pytest.mark.asyncio
async def test_list_reports_empty(client):
    response = await client.get("/api/reports")
    assert response.status_code == 200
    assert response.json() == {"reports": []}


@pytest.mark.asyncio
async def test_generate_and_view_report(client, monkeypatch, tmp_path):
    """End-to-end: create session, generate report, view it."""
    sessions_dir = tmp_path / "sessions"
    reports_dir = tmp_path / "reports"

    session_id = str(uuid.uuid4())
    make_completed_session_with_files(sessions_dir, session_id)

    # Generate report
    response = await client.post(
        f"/api/sessions/{session_id}/reports/generate",
        json={"name": "Integration Test Report"},
    )
    assert response.status_code == 200
    data = response.json()
    assert "report_id" in data
    assert "weblink" in data
    report_id = data["report_id"]
    assert report_id.startswith("rpt_")

    # GET report metadata
    response = await client.get(f"/api/reports/{report_id}")
    assert response.status_code == 200
    meta = response.json()
    assert meta["report"]["name"] == "Integration Test Report"
    assert "session" in meta  # session.json content

    # GET results
    response = await client.get(f"/api/reports/{report_id}/results")
    assert response.status_code == 200
    results = response.json()
    assert results["total_proteins"] == 1

    # GET QC plots
    response = await client.get(f"/api/reports/{report_id}/qc/plots")
    assert response.status_code == 200

    # GET GSEA status
    response = await client.get(f"/api/reports/{report_id}/gsea/status")
    assert response.status_code == 200

    # GET GSEA data
    response = await client.get(f"/api/reports/{report_id}/gsea/go_bp")
    assert response.status_code == 200

    # GET protein abundance
    response = await client.get(f"/api/reports/{report_id}/protein/P12345/abundance")
    assert response.status_code == 200

    # GET peptide abundance
    response = await client.get(f"/api/reports/{report_id}/protein/P12345/peptide")
    assert response.status_code == 200

    # GET bionet subnetwork
    response = await client.get(f"/api/reports/{report_id}/bionet/subnetwork")
    assert response.status_code == 200

    # GET bionet status
    response = await client.get(f"/api/reports/{report_id}/bionet/status")
    assert response.status_code == 200

    # GET compare correlation status
    response = await client.get(f"/api/reports/{report_id}/compare/comparison-correlation/status")
    assert response.status_code in (200, 404)  # may not have been run

    # GET compare proteins
    response = await client.get(f"/api/reports/{report_id}/compare/proteins")
    assert response.status_code == 200

    # PATCH visualization state
    response = await client.patch(
        f"/api/reports/{report_id}/visualization-state",
        json={"markers": {"Trt_vs_Ctrl": ["P12345"]}},
    )
    assert response.status_code == 200

    # DELETE report
    response = await client.delete(f"/api/reports/{report_id}")
    assert response.status_code == 200

    # Verify deleted
    response = await client.get(f"/api/reports/{report_id}")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_generate_rejects_non_completed_session(client, tmp_path):
    sessions_dir = tmp_path / "sessions"
    session_id = str(uuid.uuid4())
    session_dir = sessions_dir / session_id
    session_dir.mkdir(parents=True)
    (session_dir / "session.json").write_text('{"id": "x", "state": "processing"}')

    response = await client.post(
        f"/api/sessions/{session_id}/reports/generate",
        json={"name": "Should Fail"},
    )
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_report_not_found(client):
    response = await client.get("/api/reports/rpt_nonexistent")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_report_survives_session_deletion(client, monkeypatch, tmp_path):
    """Report remains functional after original session is deleted."""
    sessions_dir = tmp_path / "sessions"
    reports_dir = tmp_path / "reports"

    session_id = str(uuid.uuid4())
    make_completed_session_with_files(sessions_dir, session_id)

    # Generate report
    response = await client.post(
        f"/api/sessions/{session_id}/reports/generate",
        json={"name": "Persistent Report"},
    )
    assert response.status_code == 200
    report_id = response.json()["report_id"]

    # Delete the original session
    import shutil
    shutil.rmtree(sessions_dir / session_id)

    # Report should still work
    response = await client.get(f"/api/reports/{report_id}")
    assert response.status_code == 200

    response = await client.get(f"/api/reports/{report_id}/results")
    assert response.status_code == 200

    response = await client.get(f"/api/reports/{report_id}/protein/P12345/abundance")
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_delete_nonexistent_report(client):
    response = await client.delete("/api/reports/rpt_nonexistent")
    assert response.status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
backend/.venv/Scripts/python.exe -m pytest Tests/backend/integration/test_report_routes.py -v
```
Expected: FAIL (new endpoints not mounted yet, or returns 404).

- [ ] **Step 3: Commit**

```bash
git add Tests/backend/integration/test_report_routes.py
git commit -m "test: rewrite integration tests for new report endpoints"
```

### Task 6: Rewrite reports.py routes

**Files:**
- Rewrite: `backend/app/api/routes/reports.py`

- [ ] **Step 1: Write the new route file**

```python
"""
Report API routes.

Endpoints for report generation, viewing, and management.
All read from reports/{rid}/ instead of sessions/{sid}/.
"""

import logging
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse

from app.core.config import settings
from app.models.analysis import GseaRunRequest, GseaDatabase
from app.services.report_store import (
    create_report,
    list_reports,
    get_report_dir,
    get_report_metadata,
    get_report_session,
    patch_report_state,
    delete_report,
)
from app.services.report_generator import generate_report

logger = logging.getLogger("proteomics")

router = APIRouter()
global_router = APIRouter()

REPORTS_DIR = settings.base_dir / "reports"


def _report_data_dir(report_id: str) -> Path:
    """Resolve and validate report results directory."""
    report_dir = get_report_dir(report_id)
    if not report_dir:
        raise HTTPException(status_code=404, detail="Report not found")
    return report_dir


# --- Session-scoped routes (mounted at /api/sessions) ---

@router.post("/{session_id}/reports/generate")
async def generate_report_endpoint(
    session_id: str,
    request: Request,
):
    """Copy session files to a new report directory."""
    body = await request.json()
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Report name is required")

    # Create report entry first (validates nothing yet)
    metadata = create_report(
        name=name,
        session_id=session_id,
        session_name="",  # Will be populated from session.json after copy
    )

    try:
        generate_report(session_id, metadata["report_id"])
    except ValueError as e:
        # Clean up the empty report directory on failure
        delete_report(metadata["report_id"])
        raise HTTPException(status_code=400, detail=str(e))

    # Update report metadata with session name from copied session.json
    report_dir = REPORTS_DIR / metadata["report_id"]
    session_json_path = report_dir / "session.json"
    if session_json_path.exists():
        import json
        session_data = json.loads(session_json_path.read_text(encoding="utf-8"))
        metadata["session_name"] = session_data.get("name", "")
        (report_dir / "report.json").write_text(
            json.dumps(metadata, indent=2), encoding="utf-8"
        )
    else:
        metadata["session_name"] = ""

    return {
        "report_id": metadata["report_id"],
        "name": metadata["name"],
        "weblink": f"/reports/{metadata['report_id']}",
        "created_at": metadata["created_at"],
    }


# --- Global routes (mounted at /api) ---

@global_router.get("/reports")
async def get_reports():
    """List all generated reports."""
    return {"reports": list_reports()}


@global_router.get("/reports/{report_id}")
async def get_report_info(report_id: str):
    """Get report metadata + session config for the viewer."""
    report_dir = _report_data_dir(report_id)
    metadata = get_report_metadata(report_id)
    session_data = get_report_session(report_id)
    return {"report": metadata, "session": session_data}


@global_router.delete("/reports/{report_id}")
async def delete_report_endpoint(report_id: str):
    """Delete a report and all its files."""
    if not delete_report(report_id):
        raise HTTPException(status_code=404, detail="Report not found")
    return {"message": "Report deleted"}


# --- Visualization endpoints (mirror session endpoints) ---

# Import shared handler functions from visualization routes
from app.api.routes.visualization import (
    load_diff_expression_results as _load_de,
)
from app.api.routes.visualization import (
    _read_gsea_status,
    _run_gsea_background,
    _read_bionet_status,
    _bionet_output_dir,
    _write_bionet_status,
    _bionet_subnetwork_path,
)
from app.api.routes.visualization import (
    load_protein_abundance as _load_protein_abundance,
    load_peptide_abundance as _load_peptide_abundance,
)


@global_router.get("/reports/{report_id}/results")
async def get_report_results(
    report_id: str,
    page: int = 1,
    page_size: int = 50,
    comparison: str = "",
):
    """Get differential expression results from report."""
    report_dir = _report_data_dir(report_id)
    results_dir = report_dir / "results"
    all_results = await _load_de(results_dir, report_id, comparison)
    # ... same pagination/filtering as session endpoint
    # (abbreviated for plan — full implementation mirrors visualization.py:494-567)
    return {"results": all_results, "total": len(all_results)}


@global_router.get("/reports/{report_id}/qc/plots")
async def get_report_qc_plots(report_id: str):
    """Get QC plots from report."""
    report_dir = _report_data_dir(report_id)
    # ... delegates to shared QC loader
    # (full implementation mirrors visualization.py:570-610)


@global_router.get("/reports/{report_id}/gsea/status")
async def get_report_gsea_status(report_id: str):
    """Get GSEA run status from report."""
    report_dir = _report_data_dir(report_id)
    status_path = report_dir / "gsea_run_status.json"
    if not status_path.exists():
        return {"databases": {}}
    import json
    return json.loads(status_path.read_text(encoding="utf-8"))


@global_router.post("/reports/{report_id}/gsea/run")
async def run_report_gsea(report_id: str, request: Request):
    """Run GSEA on report's data."""
    report_dir = _report_data_dir(report_id)
    body = await request.json()
    # ... delegates to shared GSEA runner with report data_dir
    # (full implementation mirrors visualization.py:1167-1224)


@global_router.get("/reports/{report_id}/gsea/{database}")
async def get_report_gsea_data(report_id: str, database: str, comparison: str = ""):
    """Get GSEA results from report."""
    report_dir = _report_data_dir(report_id)
    # ... delegates to shared GSEA loader
    # (full implementation mirrors visualization.py:1227+)


@global_router.get("/reports/{report_id}/gsea/{database}/plot")
async def get_report_gsea_plot(report_id: str, database: str, term: str, comparison: str = ""):
    """Get GSEA running ES plot data from report."""
    report_dir = _report_data_dir(report_id)
    # ... delegates to shared plot data loader


@global_router.get("/reports/{report_id}/gsea/{database}/heatmap")
async def get_report_gsea_heatmap(report_id: str, database: str, term: str, comparison: str = ""):
    """Get GSEA heatmap data from report."""
    report_dir = _report_data_dir(report_id)
    # ... delegates to shared heatmap loader


@global_router.post("/reports/{report_id}/bionet/run")
async def run_report_bionet(report_id: str, request: Request):
    """Run BioNet on report's data."""
    report_dir = _report_data_dir(report_id)
    # ... delegates to shared bionet runner


@global_router.get("/reports/{report_id}/bionet/status")
async def get_report_bionet_status(report_id: str):
    """Get BioNet run status from report."""
    report_dir = _report_data_dir(report_id)
    status_path = report_dir / "bionet" / "bionet_status.json"
    if not status_path.exists():
        raise HTTPException(status_code=404, detail="BioNet not run yet")
    import json
    return json.loads(status_path.read_text(encoding="utf-8"))


@global_router.get("/reports/{report_id}/bionet/subnetwork")
async def get_report_bionet_subnetwork(report_id: str):
    """Get BioNet subnetwork from report."""
    report_dir = _report_data_dir(report_id)
    subnetwork_path = report_dir / "bionet" / "bionet_subnetwork.json"
    if not subnetwork_path.exists():
        raise HTTPException(status_code=404, detail="BioNet subnetwork not found")
    import json
    return json.loads(subnetwork_path.read_text(encoding="utf-8"))


@global_router.get("/reports/{report_id}/protein/{protein_id}/abundance")
async def get_report_protein_abundance(report_id: str, protein_id: str, comparison: str = ""):
    """Get protein abundance from report."""
    report_dir = _report_data_dir(report_id)
    return await _load_protein_abundance(report_dir / "results", protein_id, comparison)


@global_router.get("/reports/{report_id}/protein/{protein_id}/peptide")
async def get_report_protein_peptide(report_id: str, protein_id: str, comparison: str = ""):
    """Get peptide abundance from report."""
    report_dir = _report_data_dir(report_id)
    return await _load_peptide_abundance(report_dir / "results", protein_id, comparison)


@global_router.post("/reports/{report_id}/compare/protein-correlation")
async def run_report_protein_correlation(report_id: str, request: Request):
    """Run protein correlation on report's data."""
    report_dir = _report_data_dir(report_id)
    # ... delegates to shared compare runner


@global_router.get("/reports/{report_id}/compare/protein-correlation/status")
async def get_report_protein_correlation_status(report_id: str):
    """Get protein correlation status from report."""
    report_dir = _report_data_dir(report_id)
    status_path = report_dir / "results" / "compare" / "protein-correlation_status.json"
    if not status_path.exists():
        raise HTTPException(status_code=404, detail="Not run yet")
    import json
    return json.loads(status_path.read_text(encoding="utf-8"))


@global_router.get("/reports/{report_id}/compare/protein-correlation")
async def get_report_protein_correlation(report_id: str):
    """Get protein correlation results from report."""
    report_dir = _report_data_dir(report_id)
    result_path = report_dir / "results" / "compare" / "protein-correlation_result.json"
    if not result_path.exists():
        raise HTTPException(status_code=404, detail="Not run yet")
    import json
    return json.loads(result_path.read_text(encoding="utf-8"))


@global_router.post("/reports/{report_id}/compare/comparison-correlation")
async def run_report_comparison_correlation(report_id: str, request: Request):
    """Run comparison correlation on report's data."""
    report_dir = _report_data_dir(report_id)
    # ... delegates to shared compare runner


@global_router.get("/reports/{report_id}/compare/comparison-correlation/status")
async def get_report_comparison_correlation_status(report_id: str):
    """Get comparison correlation status from report."""
    report_dir = _report_data_dir(report_id)
    status_path = report_dir / "results" / "compare" / "comparison-correlation_status.json"
    if not status_path.exists():
        raise HTTPException(status_code=404, detail="Not run yet")
    import json
    return json.loads(status_path.read_text(encoding="utf-8"))


@global_router.get("/reports/{report_id}/compare/comparison-correlation")
async def get_report_comparison_correlation(report_id: str):
    """Get comparison correlation results from report."""
    report_dir = _report_data_dir(report_id)
    result_path = report_dir / "results" / "compare" / "comparison-correlation_result.json"
    if not result_path.exists():
        raise HTTPException(status_code=404, detail="Not run yet")
    import json
    return json.loads(result_path.read_text(encoding="utf-8"))


@global_router.post("/reports/{report_id}/compare/venn")
async def compute_report_venn(report_id: str, request: Request):
    """Compute Venn diagram from report's data."""
    report_dir = _report_data_dir(report_id)
    # ... delegates to shared venn computer


@global_router.get("/reports/{report_id}/compare/proteins")
async def list_report_proteins(report_id: str):
    """List all proteins from report's DE files."""
    report_dir = _report_data_dir(report_id)
    # ... delegates to shared protein lister


@global_router.patch("/reports/{report_id}/visualization-state")
async def update_report_visualization_state(report_id: str, request: Request):
    """Update markers and/or volcano filters in report's session.json."""
    body = await request.json()
    markers = body.get("markers")
    volcano_filters = body.get("volcano_filters")

    if not patch_report_state(report_id, markers=markers, volcano_filters=volcano_filters):
        raise HTTPException(status_code=404, detail="Report not found")

    return {"message": "State updated"}
```

- [ ] **Step 2: Verify tests pass**

```bash
backend/.venv/Scripts/python.exe -m pytest Tests/backend/integration/test_report_routes.py -v
```
Expected: All integration tests PASS.

- [ ] **Step 3: Commit**

```bash
git add backend/app/api/routes/reports.py
git commit -m "feat: rewrite report routes — report-scoped visualization endpoints"
```

### Task 7: Update main.py router mounting

**Files:**
- Modify: `backend/app/main.py`

- [ ] **Step 1: Check current router mounting and update if needed**

Read the current `main.py` to find where `reports.router` and `reports.global_router` are mounted. The new reports.py uses the same router variable names, so no mount changes should be needed. Verify:

```bash
grep -n "reports" backend/app/main.py
```

- [ ] **Step 2: Run full backend test suite**

```bash
backend/.venv/Scripts/python.exe -m pytest Tests/backend/ -v --ignore=Tests/backend/integration/test_report_routes.py -k "not report"
```
Expected: All pre-existing tests still PASS (no regressions).

```bash
backend/.venv/Scripts/python.exe -m pytest Tests/backend/unit/test_report_store.py Tests/backend/unit/test_report_generator.py Tests/backend/integration/test_report_routes.py -v
```
Expected: All new report tests PASS.

- [ ] **Step 3: Commit**

```bash
git add backend/app/main.py
git commit -m "chore: verify report router mounting"
```

---

## Phase 4: Frontend — API Context and Refactoring

### Task 8: Create ApiProvider context

**Files:**
- Create: `frontend/src/lib/api-context.tsx`

- [ ] **Step 1: Write the context module**

```tsx
'use client';

import React, { createContext, useContext } from 'react';

interface ApiContextValue {
  /** Base path for API calls. e.g. "/api/sessions/abc123" or "/api/reports/rpt_xyz" */
  apiPrefix: string;
}

const ApiContext = createContext<ApiContextValue>({
  apiPrefix: '/api/sessions',
});

export function ApiProvider({
  apiPrefix,
  children,
}: {
  apiPrefix: string;
  children: React.ReactNode;
}) {
  return (
    <ApiContext.Provider value={{ apiPrefix }}>
      {children}
    </ApiContext.Provider>
  );
}

export function useApi(): ApiContextValue {
  return useContext(ApiContext);
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd frontend && npm run lint -- --file src/lib/api-context.tsx
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/api-context.tsx
git commit -m "feat: add ApiProvider context for session/report API routing"
```

### Task 9: Refactor api.ts to accept apiPrefix

**Files:**
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: Refactor each API function**

Change every function that currently takes `sessionId: string` as the first parameter to take `apiPrefix: string` instead. The URL construction changes from `` `/api/sessions/${sessionId}/...` `` to `` `${apiPrefix}/...` ``.

Pattern — every function follows this transformation:

```typescript
// Before:
export async function getDEResults(sessionId: string, params?: {...}): Promise<DEResultsData> {
  return fetchApi<DEResultsData>(`/api/sessions/${sessionId}/results${query}`);
}

// After:
export async function getDEResults(apiPrefix: string, params?: {...}): Promise<DEResultsData> {
  return fetchApi<DEResultsData>(`${apiPrefix}/results${query}`);
}
```

Functions to refactor (all in `api.ts`):
- `getSession` → renamed to `getDataSource` (used only for metadata)
- `getDEResults(sessionId, params)` → `getDEResults(apiPrefix, params)`
- `getQCData(sessionId)` → `getQCData(apiPrefix)`
- `getGSEAData(sessionId, database, params)` → `getGSEAData(apiPrefix, database, params)`
- `getGSEAPlotData(sessionId, database, term, comparison)` → `getGSEAPlotData(apiPrefix, database, term, comparison)`
- `getGSEAHeatmapData(sessionId, database, term, comparison)` → `getGSEAHeatmapData(apiPrefix, database, term, comparison)`
- `runGSEA(sessionId, body)` → `runGSEA(apiPrefix, body)`
- `getGSEAStatus(sessionId)` → `getGSEAStatus(apiPrefix)`
- `getProteinAbundance(sessionId, proteinId, comparison)` → `getProteinAbundance(apiPrefix, proteinId, comparison)`
- `getPeptideAbundance(sessionId, proteinId, comparison)` → `getPeptideAbundance(apiPrefix, proteinId, comparison)`
- `updateSessionVisualizationState(sessionId, data)` → `updateVisualizationState(apiPrefix, data)` (URL changes from `/visualization-state` to `/visualization-state` — same path, different prefix)
- `runProteinCorrelation(sessionId, body)` → `runProteinCorrelation(apiPrefix, body)`
- `getProteinCorrelationStatus(sessionId)` → `getProteinCorrelationStatus(apiPrefix)`
- `getProteinCorrelationData(sessionId)` → `getProteinCorrelationData(apiPrefix)`
- `runComparisonCorrelation(sessionId, body)` → `runComparisonCorrelation(apiPrefix, body)`
- `getComparisonCorrelationStatus(sessionId)` → `getComparisonCorrelationStatus(apiPrefix)`
- `getComparisonCorrelationData(sessionId)` → `getComparisonCorrelationData(apiPrefix)`
- `computeVennData(sessionId, body)` → `computeVennData(apiPrefix, body)`
- `listProteins(sessionId)` → `listProteins(apiPrefix)`
- `runBioNet(sessionId, body)` → `runBioNet(apiPrefix, body)`
- `getBioNetStatus(sessionId)` → `getBioNetStatus(apiPrefix)`
- `getBioNetSubnetwork(sessionId)` → `getBioNetSubnetwork(apiPrefix)`

Also add a helper:

```typescript
export function sessionApiPrefix(sessionId: string): string {
  return `/api/sessions/${sessionId}`;
}

export function reportApiPrefix(reportId: string): string {
  return `/api/reports/${reportId}`;
}
```

- [ ] **Step 2: Update all callers across the codebase**

```bash
cd frontend && grep -rn "getDEResults\|getProteinAbundance\|getGSEAData\|runGSEA\|getQCData\|getPeptideAbundance\|getGSEAPlot\|getGSEAHeatmap\|getGSEAStatus\|runProteinCorrelation\|getProteinCorrelation\|runComparisonCorrelation\|getComparisonCorrelation\|computeVennData\|listProteins\|runBioNet\|getBioNetStatus\|getBioNetSubnetwork\|updateSessionVisualizationState" src/ --include="*.tsx" --include="*.ts" -l
```

Update each caller to pass `apiPrefix` instead of `sessionId`. The visualization page callers construct `apiPrefix` using `sessionApiPrefix(sessionId)`. For now, since ApiProvider isn't wired into pages yet, pass it explicitly.

- [ ] **Step 3: Verify compilation**

```bash
cd frontend && npm run build 2>&1 | head -50
```
Expected: no TypeScript errors related to these changes.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/api.ts
git add frontend/src/app/analysis/visualization/page.tsx  # and other caller files
git commit -m "refactor: change api.ts functions to accept apiPrefix instead of sessionId"
```

### Task 10: Refactor ProteinInfo to use ApiProvider

**Files:**
- Modify: `frontend/src/components/visualization/ProteinInfo.tsx`

- [ ] **Step 1: Update the component**

Remove `sessionId` from the Props interface. Use `useApi()` hook to get `apiPrefix`. Update internal API calls.

```typescript
// Before:
interface ProteinInfoProps {
  protein: DEResult | null;
  sessionId: string;
  isLoading?: boolean;
  filters?: VolcanoFilters;
  comparison?: string;
}

// In component:
getProteinAbundance(sessionId, protein.master_protein_accessions, comparison)

// After:
import { useApi } from '@/lib/api-context';

interface ProteinInfoProps {
  protein: DEResult | null;
  isLoading?: boolean;
  filters?: VolcanoFilters;
  comparison?: string;
}

// In component:
const { apiPrefix } = useApi();
getProteinAbundance(apiPrefix, protein.master_protein_accessions, comparison)
```

- [ ] **Step 2: Update callers**

Remove `sessionId` prop from all `<ProteinInfo>` usages:
- `analysis/visualization/page.tsx` — remove `sessionId={sessionId}`
- `[reportId]/page.tsx` (after rewrite)

- [ ] **Step 3: Verify compilation**

```bash
cd frontend && npm run lint
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/visualization/ProteinInfo.tsx frontend/src/app/analysis/visualization/page.tsx
git commit -m "refactor: ProteinInfo reads apiPrefix from context instead of sessionId prop"
```

### Task 11: Refactor GSEAPlot to use ApiProvider

**Files:**
- Modify: `frontend/src/components/visualization/GSEAPlot.tsx`

- [ ] **Step 1: Update GSEAPlot**

Remove `sessionId` from `GSEAPlotProps`. Add `useApi()` hook. Replace `sessionId` with `apiPrefix` in all API calls.

```typescript
// Before:
interface GSEAPlotProps {
  pathway: GSEAPathwayResult | null;
  sessionId: string;
  database: GSEADatabase;
  comparison?: string;
  onPathwayUpdated?: (data: Partial<GSEAPathwayResult>) => void;
}

// Inside component:
getGSEAPlotData(sessionId, database, currentPathway.term, comparison)
getGSEAHeatmapData(sessionId, database, currentPathway.term, comparison)

// After:
import { useApi } from '@/lib/api-context';

interface GSEAPlotProps {
  pathway: GSEAPathwayResult | null;
  database: GSEADatabase;
  comparison?: string;
  onPathwayUpdated?: (data: Partial<GSEAPathwayResult>) => void;
}

// Inside component:
const { apiPrefix } = useApi();
getGSEAPlotData(apiPrefix, database, currentPathway.term, comparison)
getGSEAHeatmapData(apiPrefix, database, currentPathway.term, comparison)
```

- [ ] **Step 2: Update callers**

Find all usages of `<GSEAPlot` and remove `sessionId` prop:
```bash
cd frontend && grep -rn "<GSEAPlot" src/ --include="*.tsx"
```

Remove `sessionId={...}` from each occurrence.

- [ ] **Step 3: Verify compilation**

```bash
cd frontend && npm run lint
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/visualization/GSEAPlot.tsx
git commit -m "refactor: GSEAPlot reads apiPrefix from context instead of sessionId prop"
```

### Task 12: Refactor Compare panels to use ApiProvider

**Files:**
- Modify: `frontend/src/components/visualization/compare/ComparisonCorrelationPanel.tsx`
- Modify: `frontend/src/components/visualization/compare/ProteinCorrelationPanel.tsx`

- [ ] **Step 1: Update ComparisonCorrelationPanel**

Remove `sessionId` from Props. Add `useApi()` hook. Replace every `sessionId` variable with `apiPrefix` from context. Affected calls:
- `getSession(sessionId)` → `fetch(${apiPrefix})` (to get session config for markers)
- `getComparisonCorrelationData(sessionId)` → `getComparisonCorrelationData(apiPrefix)`
- `getComparisonCorrelationStatus(sessionId)` → `getComparisonCorrelationStatus(apiPrefix)`
- `runComparisonCorrelation(sessionId, ...)` → `runComparisonCorrelation(apiPrefix, ...)`
- `computeVennData(sessionId, ...)` → `computeVennData(apiPrefix, ...)`

```typescript
import { useApi } from '@/lib/api-context';

// Inside component:
const { apiPrefix } = useApi();
```

- [ ] **Step 2: Update ProteinCorrelationPanel**

Same pattern. Remove `sessionId` from Props, add `useApi()`. Replace:
- `listProteins(sessionId)` → `listProteins(apiPrefix)`
- `getProteinCorrelationData(sessionId)` → `getProteinCorrelationData(apiPrefix)`
- `getProteinCorrelationStatus(sessionId)` → `getProteinCorrelationStatus(apiPrefix)`
- `runProteinCorrelation(sessionId, ...)` → `runProteinCorrelation(apiPrefix, ...)`

- [ ] **Step 3: Update callers**

```bash
cd frontend && grep -rn "ComparisonCorrelationPanel\|ProteinCorrelationPanel" src/ --include="*.tsx"
```

Remove `sessionId` prop from each usage.

- [ ] **Step 4: Verify compilation**

```bash
cd frontend && npm run lint
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/visualization/compare/ComparisonCorrelationPanel.tsx frontend/src/components/visualization/compare/ProteinCorrelationPanel.tsx
git commit -m "refactor: Compare panels read apiPrefix from context instead of sessionId"

---

## Phase 5: Frontend — Export Modal

### Task 12b: Wrap visualization pages in ApiProvider

**Files:**
- Modify: `frontend/src/app/analysis/visualization/layout.tsx`

- [ ] **Step 1: Read the layout to understand current structure**

```bash
grep -n "children\|return\|sessionId" frontend/src/app/analysis/visualization/layout.tsx
```

- [ ] **Step 2: Add ApiProvider to the layout**

The visualization layout wraps all sub-pages (volcano, qc, gsea, compare, bionet). Add ApiProvider here so all pages inherit the session API prefix.

```tsx
import { ApiProvider } from '@/lib/api-context';
import { sessionApiPrefix } from '@/lib/api';

// Inside the layout component, read sessionId from searchParams:
const searchParams = useSearchParams();
const sessionId = searchParams.get('session_id') || '';

if (!sessionId) {
  return <NoSessionSelected />;
}

return (
  <ApiProvider apiPrefix={sessionApiPrefix(sessionId)}>
    {/* existing layout content */}
    {children}
  </ApiProvider>
);
```

- [ ] **Step 3: Remove ApiProvider wrappers from individual page entries**

The File Map listed individual pages for ApiProvider modification. Since the layout handles it, individual pages don't need separate wrappers.

- [ ] **Step 4: Verify compilation**

```bash
cd frontend && npm run lint
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/analysis/visualization/layout.tsx
git commit -m "feat: wrap visualization layout in ApiProvider"
```

---

### Task 13: Simplify ExportModal

**Files:**
- Modify: `frontend/src/components/visualization/ExportModal.tsx`

- [ ] **Step 1: Rewrite ExportModal**

```tsx
'use client';

import React, { useState, useCallback } from 'react';
import { X, Loader2, Link, Copy, CheckCircle } from 'lucide-react';

interface ExportModalProps {
  sessionId: string;
  onClose: () => void;
}

export function ExportModal({ sessionId, onClose }: ExportModalProps) {
  const [name, setName] = useState('');
  const [state, setState] = useState<'input' | 'generating' | 'ready' | 'error'>('input');
  const [resultUrl, setResultUrl] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [copied, setCopied] = useState(false);

  const handleGenerate = useCallback(async () => {
    if (!name.trim()) return;
    setState('generating');
    setErrorMsg('');

    try {
      const res = await fetch(`/api/sessions/${sessionId}/reports/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Export failed' }));
        throw new Error(err.detail || 'Export failed');
      }
      const data = await res.json();
      setResultUrl(`${window.location.origin}${data.weblink}`);
      setState('ready');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Export failed');
      setState('error');
    }
  }, [name, sessionId]);

  const copyUrl = useCallback(async () => {
    try { await navigator.clipboard.writeText(resultUrl); setCopied(true); } catch {}
  }, [resultUrl]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-background rounded-lg w-[480px] max-w-[90vw] shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="text-lg font-semibold">Export Report</h3>
          <button onClick={onClose} className="p-2 hover:bg-surface rounded-lg"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-6">
          {state === 'input' && (
            <>
              <label className="block text-sm font-medium mb-2">Report Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter report name..."
                className="w-full px-3 py-2 border border-border rounded-lg mb-6 focus:outline-none focus:ring-2 focus:ring-primary"
                autoFocus
              />
              <button
                disabled={!name.trim()}
                onClick={handleGenerate}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-primary text-white rounded-lg hover:bg-primary-dark disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Link className="w-4 h-4" /> Generate Report Link
              </button>
            </>
          )}

          {state === 'generating' && (
            <div className="flex flex-col items-center gap-4 py-8">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="text-text-secondary">Generating report...</p>
            </div>
          )}

          {state === 'ready' && (
            <div className="flex flex-col items-center gap-4 py-4">
              <CheckCircle className="w-12 h-12 text-success" />
              <p className="font-semibold">Report ready!</p>
              <div className="flex items-center gap-2 w-full">
                <input readOnly value={resultUrl}
                  className="flex-1 px-3 py-2 border border-border rounded-lg text-sm bg-surface" />
                <button onClick={copyUrl}
                  className="flex items-center gap-1 px-3 py-2 bg-primary text-white rounded-lg text-sm">
                  {copied ? <CheckCircle className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <button onClick={onClose} className="px-4 py-2 bg-surface rounded-lg">Close</button>
            </div>
          )}

          {state === 'error' && (
            <div className="flex flex-col items-center gap-4 py-4">
              <p className="text-error font-semibold">Export failed</p>
              <p className="text-sm text-text-secondary text-center">{errorMsg}</p>
              <button onClick={() => setState('input')} className="px-4 py-2 bg-surface rounded-lg">Back</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify compilation**

```bash
cd frontend && npm run lint
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/visualization/ExportModal.tsx
git commit -m "refactor: simplify ExportModal to name input + single POST"
```

---

## Phase 6: Frontend — Report Viewer Rewrite

### Task 14: Rewrite [reportId]/page.tsx

**Files:**
- Rewrite: `frontend/src/app/reports/[reportId]/page.tsx`

- [ ] **Step 1: Write the new report viewer page**

The page is a thin shell that:
1. Fetches report metadata from `GET /api/reports/{rid}`
2. Provides ApiContext with `apiPrefix="/api/reports/{rid}"`
3. Renders tabs using the same components as the visualization page

```tsx
'use client';

import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { ChartScatter, Activity, Spline, GitCompare, ChartNetwork, Loader2, AlertCircle, ExternalLink } from 'lucide-react';
import { ApiProvider } from '@/lib/api-context';

// Shared components
import VolcanoPlot from '@/components/visualization/VolcanoPlot';
import ProteinInfo from '@/components/visualization/ProteinInfo';
import ProteinTable from '@/components/visualization/ProteinTable';
import { FilterPanel } from '@/components/visualization/FilterPanel';
import { QCPlots } from '@/components/visualization/QCPlots';
import GSEADashboard from '@/components/visualization/GSEADashboard';
import BioNetNetwork from '@/components/visualization/BioNetNetwork';
import ComparisonCorrelationPanel from '@/components/visualization/compare/ComparisonCorrelationPanel';
import ProteinCorrelationPanel from '@/components/visualization/compare/ProteinCorrelationPanel';

// API
import {
  getDEResults, getQCData, getGSEAData, getGSEAStatus,
  getBioNetSubnetwork, getBioNetStatus,
  getComparisonCorrelationData, getComparisonCorrelationStatus,
  updateVisualizationState,
  reportApiPrefix, sessionApiPrefix,
} from '@/lib/api';
import type { DEResult, VolcanoFilters } from '@/types/api';
import { formatGroup, isSignificantVolcano } from '@/lib/utils';
import { SearchableSelect } from '@/components/ui/Select';

// ─── Constants ────────────────────────────────────

const TABS = [
  { id: 'volcano', label: 'Volcano Plot', icon: ChartScatter },
  { id: 'qc', label: 'QC Plots', icon: Activity },
  { id: 'gsea', label: 'GSEA Analysis', icon: Spline },
  { id: 'compare', label: 'Compare', icon: GitCompare },
  { id: 'bionet', label: 'BioNet', icon: ChartNetwork },
];

// ─── Main Page ────────────────────────────────────

export default function ReportViewerPage() {
  const params = useParams();
  const reportId = params.reportId as string;
  const apiPrefix = reportApiPrefix(reportId);

  const [reportMeta, setReportMeta] = useState<{
    report: { name: string; session_name: string; created_at: string };
    session: Record<string, unknown>;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('volcano');

  useEffect(() => {
    if (!reportId) return;
    fetch(`/api/reports/${reportId}`)
      .then(r => { if (!r.ok) throw new Error('Report not found'); return r.json(); })
      .then(setReportMeta)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [reportId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !reportMeta) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="w-10 h-10 text-error mx-auto mb-3" />
          <p className="text-lg">{error || 'Report not found'}</p>
          <a href="/reports" className="text-primary hover:underline mt-4 inline-block">Back to Reports</a>
        </div>
      </div>
    );
  }

  const comparisons = (reportMeta.session as Record<string, unknown>)?.config?.comparisons || [];
  const comparisonOptions = (comparisons as Array<{group1: Record<string,string>, group2: Record<string,string>}> || [])
    .map(c => ({ value: `${formatGroup(c.group1)}_vs_${formatGroup(c.group2)}`, label: `${formatGroup(c.group1)} vs ${formatGroup(c.group2)}` }));

  return (
    <ApiProvider apiPrefix={apiPrefix}>
      <div className="min-h-screen bg-surface flex flex-col">
        {/* Header */}
        <div className="bg-background border-b border-border px-6 py-3">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div>
              <h1 className="text-lg font-semibold">{reportMeta.report.name}</h1>
              <p className="text-xs text-text-muted">
                {reportMeta.report.session_name} &middot; {new Date(reportMeta.report.created_at).toLocaleDateString()}
              </p>
            </div>
            <a href="/reports" className="text-sm text-text-secondary hover:text-text-primary">
              &larr; All Reports
            </a>
          </div>
        </div>

        {/* Tab Bar */}
        <div className="bg-background border-b border-border sticky top-0 z-10">
          <div className="max-w-7xl mx-auto px-6">
            <div className="flex items-center gap-1 py-2">
              {TABS.map(tab => {
                const Icon = tab.icon;
                return (
                  <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      activeTab === tab.id ? 'bg-primary/5 text-primary' : 'text-text-secondary hover:bg-surface hover:text-text-primary'
                    }`}>
                    <Icon className="w-4 h-4" />{tab.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Tab Content */}
        <div className="flex-1 max-w-7xl mx-auto px-6 py-8 w-full">
          {activeTab === 'volcano' && <ReportVolcanoTab apiPrefix={apiPrefix} comparisons={comparisonOptions} />}
          {activeTab === 'qc' && <ReportQCTab apiPrefix={apiPrefix} />}
          {activeTab === 'gsea' && <ReportGSEATab apiPrefix={apiPrefix} />}
          {activeTab === 'compare' && <ReportCompareTab apiPrefix={apiPrefix} comparisons={comparisonOptions} />}
          {activeTab === 'bionet' && <ReportBioNetTab apiPrefix={apiPrefix} />}
        </div>
      </div>
    </ApiProvider>
  );
}

// ─── Tab Components ───────────────────────────────
// Each tab mirrors the visualization page's pattern but fetches from report API

function ReportVolcanoTab({ apiPrefix, comparisons }: { apiPrefix: string; comparisons: {value: string, label: string}[] }) {
  const [data, setData] = useState<DEResultsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedComparison, setSelectedComparison] = useState(comparisons[0]?.value || '');
  const [filters, setFilters] = useState<VolcanoFilters>({ foldChange: 1, pValue: 0.05, adjPValue: 1, s0: 0.1 });
  const [markedProteins, setMarkedProteins] = useState<Set<string>>(new Set());
  const [selectedProteins, setSelectedProteins] = useState<Set<string>>(new Set());
  const [selectedProteinData, setSelectedProteinData] = useState<DEResult | null>(null);

  useEffect(() => {
    getDEResults(apiPrefix, { per_page: 20000, comparison: selectedComparison || undefined })
      .then(setData).finally(() => setLoading(false));
  }, [apiPrefix, selectedComparison]);

  // ... rest of volcano tab logic (filters, marking, protein selection)
  // mirrors analysis/visualization/page.tsx pattern
  // (abbreviated for plan — full implementation is ~200 lines)

  if (loading) return <Loader2 className="animate-spin" />;
  if (!data) return <p>No results</p>;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-6">
        <VolcanoPlot data={data.results} filters={filters}
          selectedProteins={selectedProteins} markedProteins={markedProteins}
          onSelectProteins={(prots) => setSelectedProteins(new Set(prots))}
          comparisonLabel={selectedComparison?.replace(/_vs_/g, ' vs ')} />
        <FilterPanel foldChange={filters.foldChange} pValue={filters.pValue}
          adjPValue={filters.adjPValue} s0={filters.s0}
          onChange={setFilters} onReset={() => setFilters({ foldChange: 1, pValue: 0.05, adjPValue: 1, s0: 0.1 })} />
        <ProteinTable data={data.results} selectedProteins={selectedProteins}
          onSelectProtein={(p) => { setSelectedProteinData(p); setSelectedProteins(new Set([p.master_protein_accessions])); }}
          filters={filters} markedProteins={markedProteins}
          onToggleMark={(p) => { /* toggle mark logic */ }} />
      </div>
      <div className="lg:col-span-1">
        <ProteinInfo protein={selectedProteinData} filters={filters}
          comparison={selectedComparison || undefined} />
      </div>
    </div>
  );
}

// ReportQCTab, ReportGSEATab, ReportCompareTab, ReportBioNetTab
// follow the same pattern — fetch data from apiPrefix, render shared components
```

- [ ] **Step 2: Verify compilation**

```bash
cd frontend && npm run lint
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/reports/[reportId]/page.tsx
git commit -m "feat: rewrite report viewer — shared components + report API"
```

---

## Phase 7: Cleanup

### Task 15: Delete old files

- [ ] **Step 1: Delete the files**

```bash
rm frontend/public/report-template.html
rm frontend/src/lib/html-report-builder.ts
```

- [ ] **Step 2: Verify no remaining imports**

```bash
cd frontend && grep -r "report-template\|html-report-builder\|captureAllStates\|buildZipBlob\|downloadZip" src/ --include="*.tsx" --include="*.ts"
```
Expected: no results.

- [ ] **Step 3: Commit**

```bash
git rm frontend/public/report-template.html frontend/src/lib/html-report-builder.ts
git commit -m "chore: remove old ZIP-based report template and builder"
```

### Task 16: Update E2E tests

**Files:**
- Rewrite: `Tests/e2e/report-export.spec.ts`

- [ ] **Step 1: Rewrite the E2E test**

```typescript
import { test, expect } from '@playwright/test';

test.describe('Report Export (Redesigned)', () => {
  test('Reports page shows empty state', async ({ page }) => {
    await page.goto('/reports');
    await expect(page.getByText('Reports')).toBeVisible();
    await expect(page.getByText('No reports yet')).toBeVisible();
  });

  test('Reports link is in navigation', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Reports')).toBeVisible();
  });

  test('Export modal requires a name', async ({ page }) => {
    // This test requires a completed session
    test.skip();
  });

  test('Report viewer page shows error for nonexistent report', async ({ page }) => {
    await page.goto('/reports/rpt_nonexistent');
    await expect(page.getByText('Report not found')).toBeVisible();
  });
});
```

- [ ] **Step 2: Run E2E tests**

```bash
cd Tests && npx playwright test report-export.spec.ts
```

- [ ] **Step 3: Commit**

```bash
git add Tests/e2e/report-export.spec.ts
git commit -m "test: update E2E tests for redesigned report export"
```

---

## Verification Checklist

Before declaring complete:

1. Run backend unit tests:
```bash
backend/.venv/Scripts/python.exe -m pytest Tests/backend/unit/ -v
```

2. Run backend integration tests:
```bash
backend/.venv/Scripts/python.exe -m pytest Tests/backend/integration/ -v
```

3. Start backend and frontend, manually test:
   - Complete an analysis → click Export → enter name → get weblink
   - Open weblink → verify all 5 tabs render
   - Volcano: select comparison, mark proteins, view protein info
   - QC: all plots render
   - GSEA: switch databases, view bar chart + heatmap + table
   - Delete the original session → verify report still works
   - Delete the report from reports list

4. Run E2E tests:
```bash
cd Tests && npx playwright test
```
