"""
E2E integration test: Full DIA protein analysis pipeline via File Library.

Uses 12 DIA sample files (10K rows each) with 4 conditions across 3 drugs.
Verifies all 8 msqrob2 pipeline steps complete via file library selection.
"""

import os
import shutil
import time
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
import requests

pytestmark = [pytest.mark.live, pytest.mark.r, pytest.mark.slow]

FIXTURE_DIR = Path(__file__).resolve().parent.parent.parent.parent / "fixtures"

DIA_FILES = [
    (
        "dia_sample_01_10000rows.txt",
        {"experiment": "MGL2510", "drug": "DMSO", "replicate": "1", "batch": "P01C02"},
    ),
    (
        "dia_sample_02_10000rows.txt",
        {"experiment": "MGL2510", "drug": "DMSO", "replicate": "2", "batch": "P01C02"},
    ),
    (
        "dia_sample_03_10000rows.txt",
        {"experiment": "MGL2510", "drug": "DMSO", "replicate": "3", "batch": "P01C02"},
    ),
    (
        "dia_sample_04_10000rows.txt",
        {"experiment": "MGL2510", "drug": "Drug1", "replicate": "1", "batch": "P01C02"},
    ),
    (
        "dia_sample_05_10000rows.txt",
        {"experiment": "MGL2510", "drug": "Drug1", "replicate": "2", "batch": "P01C02"},
    ),
    (
        "dia_sample_06_10000rows.txt",
        {"experiment": "MGL2510", "drug": "Drug1", "replicate": "3", "batch": "P01C02"},
    ),
    (
        "dia_sample_07_10000rows.txt",
        {"experiment": "MGL2510", "drug": "Drug2", "replicate": "1", "batch": "P01C02"},
    ),
    (
        "dia_sample_08_10000rows.txt",
        {"experiment": "MGL2510", "drug": "Drug2", "replicate": "2", "batch": "P01C02"},
    ),
    (
        "dia_sample_09_10000rows.txt",
        {"experiment": "MGL2510", "drug": "Drug2", "replicate": "3", "batch": "P01C02"},
    ),
    (
        "dia_sample_10_10000rows.txt",
        {"experiment": "MGL2510", "drug": "Drug3", "replicate": "1", "batch": "P01C02"},
    ),
    (
        "dia_sample_11_10000rows.txt",
        {"experiment": "MGL2510", "drug": "Drug3", "replicate": "2", "batch": "P01C02"},
    ),
    (
        "dia_sample_12_10000rows.txt",
        {"experiment": "MGL2510", "drug": "Drug3", "replicate": "3", "batch": "P01C02"},
    ),
]

COMPARISONS = [
    {"group1": {"drug": "Drug1"}, "group2": {"drug": "DMSO"}},
    {"group1": {"drug": "Drug2"}, "group2": {"drug": "DMSO"}},
    {"group1": {"drug": "Drug3"}, "group2": {"drug": "DMSO"}},
]


def inject_dia_known_answers(file_path: Path, drug: str) -> None:
    """Edit only controlled cells, preserving the vendor export around them."""
    target = "P13010" if drug == "Drug2" else "P62424" if drug == "DMSO" else None
    if target is None:
        return
    with file_path.open(encoding="utf-8", newline="") as handle:
        lines = handle.readlines()
    headers = lines[0].rstrip("\r\n").split("\t")
    accession_index = headers.index("Master Protein Accessions")
    value_index = headers.index("Quan Value")
    found = False
    for line_index, line in enumerate(lines[1:], start=1):
        newline = (
            "\r\n" if line.endswith("\r\n") else "\n" if line.endswith("\n") else ""
        )
        fields = line.rstrip("\r\n").split("\t")
        if fields[accession_index] != target:
            continue
        fields[value_index] = str(float(fields[value_index]) * 16)
        lines[line_index] = "\t".join(fields) + newline
        found = True
    assert found, target
    with file_path.open("w", encoding="utf-8", newline="") as handle:
        handle.writelines(lines)


def wait_for_completion(
    api_url: str, session_id: str, timeout: int = 600, interval: int = 10
) -> str:
    """Poll pipeline status until completion or timeout. Returns final state."""
    elapsed = 0
    while elapsed < timeout:
        time.sleep(interval)
        elapsed += interval
        r = requests.get(f"{api_url}/{session_id}/status")
        state = r.json().get("state", "unknown")
        if state in ("completed", "error", "cancelled"):
            return state
    return "timeout"


# ── Fixture ──


@pytest.fixture(scope="module")
def dia_session(live_server):
    """Create DIA session, select files from library, configure msqrob2, run pipeline."""
    from app.core.config import settings

    lib_dir = settings.file_library_dir
    api_url = f"{live_server}/api/sessions"
    files_api_url = f"{live_server}/api/files"
    dia_folder = lib_dir / "E2E_DIA"
    dia_folder.mkdir(parents=True, exist_ok=True)

    # 1. Copy all 12 DIA fixtures into file library
    for fname, metadata in DIA_FILES:
        fpath = FIXTURE_DIR / fname
        assert fpath.exists(), f"DIA fixture not found: {fpath}"
        dest = dia_folder / fname
        shutil.copy2(fpath, dest)
        inject_dia_known_answers(dest, metadata["drug"])

    # 2. Scan library to index
    requests.post(f"{files_api_url}/scan", timeout=30)

    # 3. Create session
    r = requests.post(
        api_url,
        json={
            "name": "DIA E2E (File Library)",
            "template": "multi_condition_comparison",
        },
    )
    assert r.status_code in (200, 201), f"Session creation failed: {r.text}"
    sid = r.json()["id"]

    # 4. Set file_type
    r = requests.post(f"{api_url}/{sid}/config", json={"file_type": "dia"})
    assert r.status_code == 200

    # 5. Select all 12 DIA fixtures FROM FILE LIBRARY (not direct upload)
    library_paths = [f"E2E_DIA/{fname}" for fname, _ in DIA_FILES]
    r = requests.post(
        f"{files_api_url}/select",
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
    r = requests.post(f"{api_url}/{sid}/config", json=config)
    assert r.status_code == 200, f"Config failed: {r.text[:300]}"

    # 7. Start pipeline
    r = requests.post(f"{api_url}/{sid}/process")
    assert r.status_code in (200, 202), f"Process start failed: {r.text[:300]}"

    # 8. Wait for completion
    state = wait_for_completion(api_url, sid)
    assert (
        state == "completed"
    ), f"Pipeline ended with state '{state}', expected 'completed'. Session: {sid}"

    r = requests.get(f"{api_url}/{sid}")
    session = r.json()
    session["_api_url"] = api_url
    yield session

    # Cleanup: delete session + remove only the test subfolder
    requests.delete(f"{api_url}/{sid}")
    test_dir = dia_folder.resolve()
    lib_root = lib_dir.resolve()
    if test_dir == lib_root or not str(test_dir).startswith(str(lib_root) + os.sep):
        raise RuntimeError(
            f"Safety: refusing to delete {test_dir} (not a subfolder of library)"
        )
    if dia_folder.exists():
        shutil.rmtree(dia_folder)
    requests.post(f"{files_api_url}/scan", timeout=30)


# ── Tests ──


class TestDIAPipelineE2E:
    """Full DIA msqrob2 protein analysis pipeline E2E tests via File Library."""

    def test_session_state_completed(self, dia_session):
        assert dia_session["state"] == "completed"

    def test_all_eight_steps_completed(self, dia_session):
        sid = dia_session["id"]
        r = requests.get(f"{dia_session['_api_url']}/{sid}/logs")
        logs = r.json()
        completed = logs.get("completed_steps", [])
        assert completed == [
            1,
            2,
            3,
            4,
            5,
            6,
            7,
            8,
        ], f"Expected all 8 steps completed, got {completed}"

    def test_three_comparison_files_exist(self, dia_session):
        """All 3 DE comparison files are generated on disk."""
        from app.core.config import settings

        sid = dia_session["id"]
        result_dir = settings.sessions_dir / sid / "results"
        for comparison in ["Drug1_vs_DMSO", "Drug2_vs_DMSO", "Drug3_vs_DMSO"]:
            fpath = result_dir / f"Diff_Expression_{comparison}.tsv"
            assert fpath.exists(), f"Missing comparison file: {fpath}"

    def test_protein_abundances_produced(self, dia_session):
        """Pipeline returns protein counts via results endpoint."""
        sid = dia_session["id"]
        r = requests.get(f"{dia_session['_api_url']}/{sid}/results")
        assert r.status_code == 200
        data = r.json().get("data", {})
        total_proteins = data.get("total_proteins", 0)
        assert total_proteins > 50, f"Expected >50 proteins, got {total_proteins}"
        results = data.get("results", [])
        assert len(results) > 0, "No DE results returned"

    def test_qc_metrics_available(self, dia_session):
        """QC metrics are calculated."""
        sid = dia_session["id"]
        r = requests.get(f"{dia_session['_api_url']}/{sid}/qc/plots")
        assert r.status_code == 200
        qc = r.json()
        assert "pca" in qc or "data" in qc, "QC data missing PCA"

    def test_remove_razor_applied(self, dia_session):
        """Remove razor step was executed (step 3 in completed_steps)."""
        sid = dia_session["id"]
        r = requests.get(f"{dia_session['_api_url']}/{sid}/logs")
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
        r = requests.get(f"{dia_session['_api_url']}/{dia_session['id']}/logs")
        logs = r.json()
        log_messages = " ".join(log["message"] for log in logs.get("logs", []))
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

    def test_de_tables_obey_numeric_contract(self, dia_session):
        """Every estimable DIA result has finite effects and valid probabilities."""
        from app.core.config import settings

        result_dir = settings.sessions_dir / dia_session["id"] / "results"
        for result_path in result_dir.glob("Diff_Expression_*.tsv"):
            frame = pd.read_csv(result_path, sep="\t")
            required = {
                "Master_Protein_Accessions",
                "logFC",
                "pval",
                "adjPval",
            }
            assert required <= set(frame.columns), result_path.name
            assert frame["Master_Protein_Accessions"].is_unique, result_path.name

            estimable = frame.dropna(subset=["logFC", "pval", "adjPval"])
            assert not estimable.empty, result_path.name
            assert np.isfinite(estimable[["logFC", "pval", "adjPval"]]).all().all()
            assert estimable["pval"].between(0, 1).all()
            assert estimable["adjPval"].between(0, 1).all()
            assert (estimable["adjPval"] + 1e-12 >= estimable["pval"]).all()

    def test_known_answer_drug2_has_both_effect_directions(self, dia_session):
        """Protect two input-derived DIA effects against sign or scale regressions."""
        from app.core.config import settings

        def raw_effect(accession: str) -> float:
            abundance_by_condition: dict[str, list[float]] = {}
            for filename, metadata in DIA_FILES:
                raw = pd.read_csv(
                    settings.file_library_dir / "E2E_DIA" / filename,
                    sep="\t",
                    usecols=[
                        "Master Protein Accessions",
                        "Contaminant",
                        "Number of Proteins",
                        "Quan Value",
                    ],
                )
                filtered = raw.loc[
                    (~raw["Contaminant"]) & (raw["Number of Proteins"] == 1)
                ]
                protein = filtered.loc[
                    filtered["Master Protein Accessions"] == accession,
                    "Quan Value",
                ]
                abundance_by_condition.setdefault(metadata["drug"], []).append(
                    float(
                        np.log2(protein).median()
                        - np.log2(filtered["Quan Value"]).median()
                    )
                )
            return float(
                np.median(abundance_by_condition["Drug2"])
                - np.median(abundance_by_condition["DMSO"])
            )

        assert raw_effect("P13010") > 4
        assert raw_effect("P62424") < -4

        result_path = (
            settings.sessions_dir
            / dia_session["id"]
            / "results"
            / "Diff_Expression_Drug2_vs_DMSO.tsv"
        )
        frame = pd.read_csv(result_path, sep="\t").set_index(
            "Master_Protein_Accessions"
        )
        anchors = frame.loc[["P13010", "P62424"]]
        effects = anchors["logFC"].astype(float)
        assert 1 < effects["P13010"] < 10, effects.to_dict()
        assert -10 < effects["P62424"] < -1, effects.to_dict()
        assert (anchors["adjPval"].astype(float) < 0.05).all()
