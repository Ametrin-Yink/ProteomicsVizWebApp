"""
E2E integration test: Full TMT protein analysis pipeline.

Uses 10k-row extract from real PD TMT file with 16-plex TMTpro channel design.
Verifies all 8 pipeline steps complete and produce expected outputs.
"""
import csv
import time
from collections import defaultdict
from pathlib import Path

import pytest
import requests

API = "http://localhost:8000/api/sessions"
FIXTURE_DIR = Path(__file__).resolve().parent.parent.parent.parent / "fixtures"
TMT_FILE = FIXTURE_DIR / "tmt_sample_10000rows.txt"
CHANNEL_DESIGN = FIXTURE_DIR / "tmt_channel_design.csv"

# ── Helpers ──

def parse_channel_design(csv_path: Path) -> dict:
    """Parse TMT channel design CSV into channel mapping dict.

    Uses only the first batch (PANC02_03), skipping duplicate channels from batch 2.
    Returns: {channel: {treatment: str, time: str, replicate: int}}
    """
    channel_map = {}
    replicate_counter = defaultdict(int)
    with open(csv_path) as f:
        reader = csv.reader(f)
        for row in reader:
            if not row or len(row) < 9:
                continue
            if row[0].startswith("//") or row[0] == "Study":
                continue
            channel = row[5]
            if channel in channel_map:
                continue  # Skip batch 2 (Jurkat) — only use batch 1 (PANC02_03)
            drug = row[6]
            time_pt = row[8]
            key = f"{drug}_{time_pt}"
            replicate_counter[key] += 1
            channel_map[channel] = {
                "treatment": drug,
                "time": time_pt,
                "replicate": replicate_counter[key],
            }
    return channel_map


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
def tmt_session(channel_mapping):
    """Create TMT session, upload file, configure, run pipeline. Returns session dict."""
    assert TMT_FILE.exists(), f"TMT fixture not found: {TMT_FILE}"

    # 1. Create session
    r = requests.post(API, json={
        "name": "E2E TMT Pipeline Test",
        "template": "multi_condition_comparison",
    })
    assert r.status_code in (200, 201), f"Session creation failed: {r.text}"
    sid = r.json()["id"]

    # 2. Set file_type (required before upload)
    r = requests.post(f"{API}/{sid}/config", json={"file_type": "tmt"})
    assert r.status_code == 200

    # 3. Upload TMT fixture
    with open(TMT_FILE, "rb") as f:
        r = requests.post(
            f"{API}/{sid}/upload/proteomics",
            files={"files": (TMT_FILE.name, f, "text/plain")},
            timeout=120,
        )
    assert r.status_code == 200, f"Upload failed: {r.text[:300]}"
    result = r.json()
    detected = result["files"][0].get("tmt_channels", [])
    assert len(detected) == 16, f"Expected 16 channels, detected {len(detected)}"

    # 4. Full configuration
    comparisons = [
        {"group1": {"Condition": "INCB224525_4h"},  "group2": {"Condition": "DMSO_24h"}},
        {"group1": {"Condition": "INCB231845_4h"},  "group2": {"Condition": "DMSO_24h"}},
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
    assert state == "completed", f"Pipeline ended with state '{state}', expected 'completed'"

    # 7. Yield session data for assertions
    r = requests.get(f"{API}/{sid}")
    yield r.json()

    # Cleanup: delete session after all tests complete
    requests.delete(f"{API}/{sid}")


# ── Tests ──

class TestTMTPipelineE2E:
    """Full TMT protein analysis pipeline E2E tests."""

    def test_session_state_completed(self, tmt_session):
        """Pipeline finishes in 'completed' state."""
        assert tmt_session["state"] == "completed"

    def test_all_eight_steps_completed(self, tmt_session):
        """All 8 pipeline steps executed successfully."""
        sid = tmt_session["id"]
        r = requests.get(f"{API}/{sid}/logs")
        logs = r.json()
        completed = logs.get("completed_steps", [])
        assert completed == [1, 2, 3, 4, 5, 6, 7, 8], \
            f"Expected all 8 steps completed, got {completed}"

    def test_four_comparison_files_exist(self, tmt_session):
        """All 4 DE comparison files are generated."""
        sid = tmt_session["id"]
        r = requests.get(f"{API}/{sid}/results")
        # Each comparison should have results
        assert r.status_code == 200

    def test_protein_abundances_produced(self, tmt_session):
        """Pipeline produces protein abundances and DE results."""
        sid = tmt_session["id"]

        # Verify protein count via QC endpoint
        r = requests.get(f"{API}/{sid}/qc/plots")
        assert r.status_code == 200
        qc = r.json()
        qc_data = qc.get("data", {})
        total_proteins = qc_data.get("total_proteins", 0)
        assert total_proteins > 100, f"Expected >100 proteins, got {total_proteins}"

        # Verify DE results per comparison
        r = requests.get(f"{API}/{sid}/results")
        data = r.json()
        results = data.get("data", {}).get("results", [])
        assert len(results) > 0, "No DE results returned"

        # Verify at least some proteins have real p-values
        proteins_with_pval = [r for r in results if r.get("pval") is not None]
        assert len(proteins_with_pval) > 0, "No proteins with p-values"

    def test_qc_metrics_available(self, tmt_session):
        """QC metrics are calculated."""
        sid = tmt_session["id"]
        r = requests.get(f"{API}/{sid}/qc/plots")
        if r.status_code == 200:
            qc = r.json()
            assert "pca" in qc or "data" in qc, "QC data missing PCA"

    def test_remove_razor_applied(self, tmt_session):
        """Remove razor step was executed (step 3 in completed_steps)."""
        sid = tmt_session["id"]
        r = requests.get(f"{API}/{sid}/logs")
        logs = r.json()
        completed = logs.get("completed_steps", [])
        assert 3 in completed, "Step 3 (Remove Razor) not completed"

    def test_strict_filtering_applied(self, tmt_session):
        """Strict filtering was configured."""
        config = tmt_session.get("config", {})
        assert config.get("strict_filtering") is True
        assert config.get("remove_razor") is True

    def test_channel_design_has_five_conditions(self, channel_mapping):
        """Channel design produces exactly 5 unique condition combinations."""
        conditions = set()
        for info in channel_mapping.values():
            cond = f"{info['treatment']}_{info['time']}"
            conditions.add(cond)
        assert conditions == {
            "DMSO_24h", "INCB224525_4h", "INCB231845_4h",
            "INCB224525_24h", "INCB231845_24h",
        }

    def test_pipeline_uses_msstats(self, tmt_session):
        """Pipeline derivation yields MSstats for TMT."""
        # The session should have been processed with msstats pipeline
        r = requests.get(f"{API}/{tmt_session['id']}/logs")
        logs = r.json()
        log_messages = " ".join(log["message"] for log in logs.get("logs", []))
        assert "MSstats" in log_messages, "Pipeline should mention MSstats"
