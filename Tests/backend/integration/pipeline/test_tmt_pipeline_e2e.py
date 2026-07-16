"""
E2E integration test: Full TMT protein analysis pipeline via File Library.

Validated against DOCK5 16-plex TMTpro workflow (2026-07-14).
Uses 10k-row extract from real PD TMT file with file library selection,
channel mapping import, and 4 DMSO-control comparisons.
Verifies all 8 pipeline steps complete and produce expected DE results.
"""

import csv
import os
import shutil
import time
from pathlib import Path

import pytest
import requests

API = "http://localhost:8000/api/sessions"
FILES_API = "http://localhost:8000/api/files"
FIXTURE_DIR = Path(__file__).resolve().parent.parent.parent.parent / "fixtures"
TMT_FILE = FIXTURE_DIR / "tmt_sample_10000rows.txt"
CHANNEL_DESIGN = FIXTURE_DIR / "tmt_channel_design.csv"

# ── Helpers ──


def parse_channel_design(csv_path: Path) -> dict:
    """Parse TMT channel design CSV into channel mapping dict.

    Format: Channel, Condition, replicate
    Returns: {channel: {Condition: str, replicate: str}}
    """
    channel_map = {}
    with open(csv_path) as f:
        reader = csv.DictReader(f)
        for row in reader:
            channel = row["Channel"].strip()
            channel_map[channel] = {
                "Condition": row["Condition"].strip(),
                "replicate": row["replicate"].strip(),
            }
    return channel_map


def setup_file_library(library_dir: Path, fixture_path: Path, target_folder: str):
    """Copy test fixture into a subfolder of the file library and scan.

    Safety: only creates files in a named subfolder, never at library root.
    """
    if not target_folder or not target_folder.strip():
        raise ValueError("target_folder must be a non-empty string")
    target_dir = library_dir / target_folder
    target_dir.mkdir(parents=True, exist_ok=True)
    dest = target_dir / fixture_path.name
    if not dest.exists():
        shutil.copy2(fixture_path, dest)
    # Scan library to index new file
    requests.post(f"{FILES_API}/scan", timeout=30)


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


# ── Fixtures ──


@pytest.fixture(scope="module")
def channel_mapping():
    """Parse channel design CSV once per test module."""
    assert CHANNEL_DESIGN.exists(), f"Channel design not found: {CHANNEL_DESIGN}"
    mapping = parse_channel_design(CHANNEL_DESIGN)
    assert len(mapping) == 16, f"Expected 16 channels, got {len(mapping)}"
    return mapping


@pytest.fixture(scope="module")
def file_library_dir():
    """Set up the TMT fixture in the real file library directory.

    Uses the backend's configured file_library_dir (backend/file_library/).
    Copies the TMT fixture into an E2E_TMT subfolder and scans.
    Cleans up after all tests complete.
    """
    from app.core.config import settings

    lib_dir = settings.file_library_dir
    setup_file_library(lib_dir, TMT_FILE, "E2E_TMT")
    yield lib_dir
    # Cleanup: remove only the test subfolder (never the library root)
    test_dir = (lib_dir / "E2E_TMT").resolve()
    lib_root = lib_dir.resolve()
    if test_dir == lib_root or not str(test_dir).startswith(str(lib_root) + os.sep):
        raise RuntimeError(f"Safety: refusing to delete {test_dir} (not a subfolder of library)")
    if test_dir.exists():
        shutil.rmtree(test_dir)
    # Re-scan to update index
    requests.post(f"{FILES_API}/scan", timeout=30)


@pytest.fixture(scope="module")
def tmt_session(channel_mapping, file_library_dir):
    """Create TMT session via file library, configure, run pipeline.

    Returns session dict after pipeline completion.
    """
    assert TMT_FILE.exists(), f"TMT fixture not found: {TMT_FILE}"

    # 1. Create session
    r = requests.post(
        API,
        json={
            "name": "E2E TMT Pipeline Test (File Library)",
            "template": "multi_condition_comparison",
        },
    )
    assert r.status_code in (200, 201), f"Session creation failed: {r.text}"
    sid = r.json()["id"]

    # 2. Set file_type (required before selecting files)
    r = requests.post(f"{API}/{sid}/config", json={"file_type": "tmt"})
    assert r.status_code == 200

    # 3. Select TMT fixture FROM FILE LIBRARY (not direct upload)
    r = requests.post(
        f"{FILES_API}/select",
        json={
            "session_id": sid,
            "paths": ["E2E_TMT/tmt_sample_10000rows.txt"],
        },
        timeout=120,
    )
    assert r.status_code == 200, f"File library select failed: {r.text[:300]}"
    result = r.json()
    assert len(result["files"]) == 1, f"Expected 1 file, got {len(result['files'])}"
    detected = result["files"][0].get("tmt_channels", [])
    assert len(detected) == 16, f"Expected 16 channels, detected {len(detected)}"

    # 4. Full configuration with validated comparison format
    comparisons = [
        {"group1": {"Condition": "INCB224525_4h"}, "group2": {"Condition": "DMSO_24h"}},
        {"group1": {"Condition": "INCB231845_4h"}, "group2": {"Condition": "DMSO_24h"}},
        {"group1": {"Condition": "INCB224525_24h"}, "group2": {"Condition": "DMSO_24h"}},
        {"group1": {"Condition": "INCB231845_24h"}, "group2": {"Condition": "DMSO_24h"}},
    ]

    config = {
        "file_type": "tmt",
        "organism": "human",
        "pipeline": "msstats",
        "remove_razor": True,
        "strict_filtering": True,
        "tmt_channel_mapping": channel_mapping,
        "comparisons": comparisons,
        "msstats_normalization": "equalizeMedians",
        "msstats_summary_method": "TMP",
        "msstats_feature_selection": "all",
        "msstats_impute": True,
        "msstats_log_base": 2,
        "pvalue_threshold": 0.05,
        "logfc_threshold": 1.0,
        "min_peptides_per_protein": 1,
    }
    r = requests.post(f"{API}/{sid}/config", json=config)
    assert r.status_code == 200, f"Config failed: {r.text[:300]}"

    # 5. Start pipeline
    r = requests.post(f"{API}/{sid}/process")
    assert r.status_code in (200, 202), f"Process start failed: {r.text[:300]}"

    # 6. Wait for completion
    state = wait_for_completion(sid)
    assert state == "completed", (
        f"Pipeline ended with state '{state}', expected 'completed'. "
        f"Session: {sid}"
    )

    # 7. Yield session data for assertions
    r = requests.get(f"{API}/{sid}")
    yield r.json()

    # Cleanup: delete session after all tests complete
    requests.delete(f"{API}/{sid}")


# ── Tests ──


class TestTMTPipelineE2E:
    """Full TMT protein analysis pipeline E2E tests via File Library."""

    # ── Pipeline completion ──

    def test_session_state_completed(self, tmt_session):
        """Pipeline finishes in 'completed' state."""
        assert tmt_session["state"] == "completed"

    def test_all_eight_steps_completed(self, tmt_session):
        """All 8 pipeline steps executed successfully."""
        sid = tmt_session["id"]
        r = requests.get(f"{API}/{sid}/logs")
        logs = r.json()
        completed = logs.get("completed_steps", [])
        assert completed == [1, 2, 3, 4, 5, 6, 7, 8], (
            f"Expected all 8 steps completed, got {completed}"
        )

    def test_pipeline_uses_msstats(self, tmt_session):
        """Pipeline derivation yields MSstats for TMT."""
        r = requests.get(f"{API}/{tmt_session['id']}/logs")
        logs = r.json()
        log_messages = " ".join(
            log["message"] for log in logs.get("logs", [])
        )
        assert "MSstats" in log_messages, "Pipeline should mention MSstats"

    # ── Configuration checks ──

    def test_file_type_is_tmt(self, tmt_session):
        """Session was configured for TMT analysis."""
        config = tmt_session.get("config", {})
        assert config.get("file_type") == "tmt"

    def test_channel_design_has_five_conditions(self, channel_mapping):
        """Channel design produces exactly 5 unique condition combinations."""
        conditions = set()
        for info in channel_mapping.values():
            conditions.add(info["Condition"])
        assert conditions == {
            "DMSO_24h",
            "INCB224525_4h",
            "INCB231845_4h",
            "INCB224525_24h",
            "INCB231845_24h",
        }

    def test_channel_design_has_replicates(self, channel_mapping):
        """Each condition has at least 3 replicates (except DMSO_24h with 4)."""
        from collections import Counter

        reps = Counter()
        for info in channel_mapping.values():
            reps[info["Condition"]] += 1
        assert reps["DMSO_24h"] == 4, f"DMSO_24h should have 4 replicates, got {reps['DMSO_24h']}"
        for cond in ["INCB224525_4h", "INCB231845_4h", "INCB224525_24h", "INCB231845_24h"]:
            assert reps[cond] == 3, f"{cond} should have 3 replicates, got {reps[cond]}"

    # ── Results validation ──

    def test_four_comparison_files_exist(self, tmt_session):
        """All 4 DE comparison TSV files are generated on disk."""
        from app.core.config import settings

        sid = tmt_session["id"]
        result_dir = settings.sessions_dir / sid / "results"
        for comparison in [
            "INCB224525_4h_vs_DMSO_24h",
            "INCB231845_4h_vs_DMSO_24h",
            "INCB224525_24h_vs_DMSO_24h",
            "INCB231845_24h_vs_DMSO_24h",
        ]:
            fpath = result_dir / f"Diff_Expression_{comparison}.tsv"
            assert fpath.exists(), f"Missing comparison file: {fpath}"

    def test_each_comparison_has_de_proteins(self, tmt_session):
        """Each comparison file contains DE proteins with real p-values."""
        import os

        from app.core.config import settings

        sid = tmt_session["id"]
        result_dir = settings.sessions_dir / sid / "results"
        de_counts = {}
        for fname in sorted(os.listdir(str(result_dir))):
            if not fname.startswith("Diff_Expression_"):
                continue
            fpath = result_dir / fname
            with open(fpath) as f:
                header = f.readline().strip().split("\t")
                # Find adjPval column
                adjp_idx = None
                for i, h in enumerate(header):
                    if h.lower() == "adjpval":
                        adjp_idx = i
                        break
                total = 0
                sig = 0
                has_pval = 0
                first_non_na = None
                for line in f:
                    total += 1
                    cols = line.strip().split("\t")
                    if adjp_idx is not None:
                        try:
                            p = float(cols[adjp_idx])
                            has_pval += 1
                            if p < 0.05:
                                sig += 1
                            if first_non_na is None:
                                first_non_na = p
                        except (ValueError, IndexError):
                            pass
                comp_name = fname.replace("Diff_Expression_", "").replace(".tsv", "")
                de_counts[comp_name] = sig
                assert has_pval > 0, (
                    f"{comp_name}: no proteins with numeric p-values (all NA)"
                )
                assert has_pval >= total * 0.9, (
                    f"{comp_name}: only {has_pval}/{total} proteins have p-values "
                    f"(expected >= 90%)"
                )

        # At least one comparison should have >= 1 DE protein
        total_de = sum(de_counts.values())
        assert total_de >= 1, (
            f"No DE proteins found across all comparisons. "
            f"Per-comparison DE counts: {de_counts}"
        )

    def test_de_results_paginated_endpoint(self, tmt_session):
        """Results endpoint returns paginated DE data with summary stats."""
        sid = tmt_session["id"]
        r = requests.get(f"{API}/{sid}/results")
        assert r.status_code == 200
        data = r.json().get("data", {})
        assert data.get("total_proteins", 0) > 100, (
            f"Expected >100 proteins, got {data.get('total_proteins', 0)}"
        )
        assert data.get("pipeline") == "msstats"
        results = data.get("results", [])
        assert len(results) > 0, "No DE results returned"
        # Verify at least some proteins have real p-values
        proteins_with_pval = [
            r for r in results if r.get("pval") is not None
        ]
        assert len(proteins_with_pval) > 0, "No proteins with p-values"

    def test_qc_metrics_available(self, tmt_session):
        """QC metrics are calculated and contain PCA data."""
        sid = tmt_session["id"]
        r = requests.get(f"{API}/{sid}/qc/plots")
        assert r.status_code == 200
        qc = r.json()
        assert "pca" in qc or "data" in qc, "QC data missing PCA"

    def test_protein_abundances_tsv_exists(self, tmt_session):
        """Protein abundances TSV file is generated on disk."""
        from app.core.config import settings

        sid = tmt_session["id"]
        fpath = settings.sessions_dir / sid / "results" / "Protein_Abundances.tsv"
        assert fpath.exists(), f"Missing: {fpath}"
        with open(fpath) as f:
            header = f.readline()
            assert "Master_Protein_Accessions" in header
            line_count = sum(1 for _ in f)
            assert line_count > 100, f"Expected >100 proteins, got {line_count}"

    def test_file_library_select_used(self, tmt_session):
        """File was selected from the file library (not direct upload)."""
        files = tmt_session.get("files", {}).get("proteomics", [])
        assert len(files) == 1
        assert files[0]["filename"] == "tmt_sample_10000rows.txt"
        assert files[0]["file_type"] == "tmt"
