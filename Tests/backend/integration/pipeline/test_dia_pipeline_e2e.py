"""
E2E integration test: Full DIA protein analysis pipeline via File Library.

Uses 12 DIA sample files (10K rows each) with 4 conditions across 3 drugs.
Verifies all 8 msqrob2 pipeline steps complete via file library selection.
"""

import shutil
import time
from pathlib import Path

import pytest
import requests

API = "http://localhost:8000/api/sessions"
FILES_API = "http://localhost:8000/api/files"
FIXTURE_DIR = Path(__file__).resolve().parent.parent.parent.parent / "fixtures"

DIA_FILES = [
    ("dia_sample_01_10000rows.txt", {"experiment": "MGL2510", "drug": "DMSO", "replicate": "1", "batch": "P01C02"}),
    ("dia_sample_02_10000rows.txt", {"experiment": "MGL2510", "drug": "DMSO", "replicate": "2", "batch": "P01C02"}),
    ("dia_sample_03_10000rows.txt", {"experiment": "MGL2510", "drug": "DMSO", "replicate": "3", "batch": "P01C02"}),
    ("dia_sample_04_10000rows.txt", {"experiment": "MGL2510", "drug": "Drug1", "replicate": "1", "batch": "P01C02"}),
    ("dia_sample_05_10000rows.txt", {"experiment": "MGL2510", "drug": "Drug1", "replicate": "2", "batch": "P01C02"}),
    ("dia_sample_06_10000rows.txt", {"experiment": "MGL2510", "drug": "Drug1", "replicate": "3", "batch": "P01C02"}),
    ("dia_sample_07_10000rows.txt", {"experiment": "MGL2510", "drug": "Drug2", "replicate": "1", "batch": "P01C02"}),
    ("dia_sample_08_10000rows.txt", {"experiment": "MGL2510", "drug": "Drug2", "replicate": "2", "batch": "P01C02"}),
    ("dia_sample_09_10000rows.txt", {"experiment": "MGL2510", "drug": "Drug2", "replicate": "3", "batch": "P01C02"}),
    ("dia_sample_10_10000rows.txt", {"experiment": "MGL2510", "drug": "Drug3", "replicate": "1", "batch": "P01C02"}),
    ("dia_sample_11_10000rows.txt", {"experiment": "MGL2510", "drug": "Drug3", "replicate": "2", "batch": "P01C02"}),
    ("dia_sample_12_10000rows.txt", {"experiment": "MGL2510", "drug": "Drug3", "replicate": "3", "batch": "P01C02"}),
]

COMPARISONS = [
    {"group1": {"drug": "Drug1"}, "group2": {"drug": "DMSO"}},
    {"group1": {"drug": "Drug2"}, "group2": {"drug": "DMSO"}},
    {"group1": {"drug": "Drug3"}, "group2": {"drug": "DMSO"}},
]


def wait_for_completion(session_id: str, timeout: int = 600, interval: int = 10) -> str:
    """Poll pipeline status until completion or timeout. Returns final state."""
    elapsed = 0
    while elapsed < timeout:
        time.sleep(interval)
        elapsed += interval
        r = requests.get(f"{API}/{session_id}/status")
        state = r.json().get("state", "unknown")
        if state in ("completed", "error", "cancelled"):
            return state
    return "timeout"


# ── Fixture ──


@pytest.fixture(scope="module")
def dia_session():
    """Create DIA session, select files from library, configure msqrob2, run pipeline."""
    from app.core.config import settings

    lib_dir = settings.file_library_dir
    dia_folder = lib_dir / "E2E_DIA"
    dia_folder.mkdir(parents=True, exist_ok=True)

    # 1. Copy all 12 DIA fixtures into file library
    for fname, _ in DIA_FILES:
        fpath = FIXTURE_DIR / fname
        assert fpath.exists(), f"DIA fixture not found: {fpath}"
        dest = dia_folder / fname
        if not dest.exists():
            shutil.copy2(fpath, dest)

    # 2. Scan library to index
    requests.post(f"{FILES_API}/scan", timeout=30)

    # 3. Create session
    r = requests.post(
        API,
        json={"name": "DIA E2E (File Library)", "template": "multi_condition_comparison"},
    )
    assert r.status_code in (200, 201), f"Session creation failed: {r.text}"
    sid = r.json()["id"]

    # 4. Set file_type
    r = requests.post(f"{API}/{sid}/config", json={"file_type": "dia"})
    assert r.status_code == 200

    # 5. Select all 12 DIA fixtures FROM FILE LIBRARY (not direct upload)
    library_paths = [f"E2E_DIA/{fname}" for fname, _ in DIA_FILES]
    r = requests.post(
        f"{FILES_API}/select",
        json={"session_id": sid, "paths": library_paths},
        timeout=120,
    )
    assert r.status_code == 200, f"File library select failed: {r.text[:300]}"
    result = r.json()
    assert len(result["files"]) == 12, f"Expected 12 files, got {len(result['files'])}"

    # 6. Full configuration
    config = {
        "file_type": "dia",
        "organism": "human",
        "pipeline": "msqrob2",
        "remove_razor": True,
        "strict_filtering": False,
        "comparisons": COMPARISONS,
        "metadata_columns": {fname: meta for fname, meta in DIA_FILES},
        "msqrob2_normalization": "center.median",
        "msqrob2_imputation": "none",
        "msqrob2_aggregation": "robustSummary",
        "msqrob2_ridge": False,
        "msqrob2_adjust_method": "BH",
        "pvalue_threshold": 0.05,
        "logfc_threshold": 1.0,
        "min_peptides_per_protein": 1,
    }
    r = requests.post(f"{API}/{sid}/config", json=config)
    assert r.status_code == 200, f"Config failed: {r.text[:300]}"

    # 7. Start pipeline
    r = requests.post(f"{API}/{sid}/process")
    assert r.status_code in (200, 202), f"Process start failed: {r.text[:300]}"

    # 8. Wait for completion
    state = wait_for_completion(sid)
    assert state == "completed", (
        f"Pipeline ended with state '{state}', expected 'completed'. Session: {sid}"
    )

    r = requests.get(f"{API}/{sid}")
    yield r.json()

    # Cleanup: delete session + remove test folder from library
    requests.delete(f"{API}/{sid}")
    if dia_folder.exists():
        shutil.rmtree(dia_folder)
    requests.post(f"{FILES_API}/scan", timeout=30)


# ── Tests ──


class TestDIAPipelineE2E:
    """Full DIA msqrob2 protein analysis pipeline E2E tests via File Library."""

    def test_session_state_completed(self, dia_session):
        assert dia_session["state"] == "completed"

    def test_all_eight_steps_completed(self, dia_session):
        sid = dia_session["id"]
        r = requests.get(f"{API}/{sid}/logs")
        logs = r.json()
        completed = logs.get("completed_steps", [])
        assert completed == [1, 2, 3, 4, 5, 6, 7, 8], (
            f"Expected all 8 steps completed, got {completed}"
        )

    def test_three_comparison_files_exist(self, dia_session):
        """All 3 DE comparison files are generated on disk."""
        import os
        from app.core.config import settings

        sid = dia_session["id"]
        result_dir = settings.sessions_dir / sid / "results"
        for comparison in ["Drug1_vs_DMSO", "Drug2_vs_DMSO", "Drug3_vs_DMSO"]:
            fpath = result_dir / f"Diff_Expression_{comparison}.tsv"
            assert fpath.exists(), f"Missing comparison file: {fpath}"

    def test_protein_abundances_produced(self, dia_session):
        """Pipeline returns protein counts via results endpoint."""
        sid = dia_session["id"]
        r = requests.get(f"{API}/{sid}/results")
        assert r.status_code == 200
        data = r.json().get("data", {})
        total_proteins = data.get("total_proteins", 0)
        assert total_proteins > 50, f"Expected >50 proteins, got {total_proteins}"
        results = data.get("results", [])
        assert len(results) > 0, "No DE results returned"

    def test_qc_metrics_available(self, dia_session):
        """QC metrics are calculated."""
        sid = dia_session["id"]
        r = requests.get(f"{API}/{sid}/qc/plots")
        assert r.status_code == 200
        qc = r.json()
        assert "pca" in qc or "data" in qc, "QC data missing PCA"

    def test_remove_razor_applied(self, dia_session):
        """Remove razor step was executed (step 3 in completed_steps)."""
        sid = dia_session["id"]
        r = requests.get(f"{API}/{sid}/logs")
        logs = r.json()
        completed = logs.get("completed_steps", [])
        assert 3 in completed, "Step 3 (Remove Razor) not completed"

    def test_strict_filtering_applied(self, dia_session):
        """Strict filtering config matches session."""
        config = dia_session.get("config", {})
        assert config.get("strict_filtering") is False
        assert config.get("remove_razor") is True

    def test_pipeline_uses_msqrob2(self, dia_session):
        """Pipeline logs reference msqrob2."""
        r = requests.get(f"{API}/{dia_session['id']}/logs")
        logs = r.json()
        log_messages = " ".join(
            log["message"] for log in logs.get("logs", [])
        )
        assert "msqrob2" in log_messages.lower(), "Pipeline should mention msqrob2"

    def test_file_library_select_used(self, dia_session):
        """All 12 files were selected from the file library."""
        files = dia_session.get("files", {}).get("proteomics", [])
        assert len(files) == 12
        for f in files:
            assert f["file_type"] == "dia"

    def test_metadata_columns_present(self, dia_session):
        """Metadata columns are configured for all 12 files."""
        config = dia_session.get("config", {})
        meta = config.get("metadata_columns", {})
        assert len(meta) == 12, f"Expected 12 metadata entries, got {len(meta)}"
        for fname in [f[0] for f in DIA_FILES]:
            assert fname in meta, f"Missing metadata for {fname}"
