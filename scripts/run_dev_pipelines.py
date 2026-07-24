"""
Dev helper: run DIA, TMT, and PTM pipelines using SampleData files
against the dev backend at http://127.0.0.1:8002.

.. warning::
    This script is for **local development only**. It hardcodes dev-server
    URLs, file-library paths, and experiment-specific metadata that are
    specific to one developer's machine. It is not expected to pass on a
    fresh checkout and is not maintained as part of the test suite.
"""
import csv
import io
import json
import os
import sys
import time
from pathlib import Path

import requests

API = "http://127.0.0.1:8002/api"
FILES_API = f"{API}/files"
SESSIONS_API = f"{API}/sessions"
BASE_DIR = Path(__file__).resolve().parent.parent / "backend" / "file_library"

# ── Helpers ──

def api(method, url, **kwargs):
    kwargs.setdefault("timeout", 120)
    r = requests.request(method, url, **kwargs)
    r.raise_for_status()
    return r.json()

def create_session(name, template="multi_condition_comparison"):
    r = requests.post(SESSIONS_API, json={"name": name, "template": template})
    assert r.status_code in (200, 201), f"Create session failed: {r.text}"
    return r.json()

def configure_session(sid, config):
    r = requests.post(f"{SESSIONS_API}/{sid}/config", json=config)
    assert r.status_code == 200, f"Config failed: {r.text[:500]}"
    return r.json()

def select_files(sid, paths, role="proteomics"):
    r = requests.post(
        f"{FILES_API}/select",
        json={"session_id": sid, "paths": paths, "role": role},
        timeout=120,
    )
    assert r.status_code == 200, f"File select failed (role={role}): {r.text[:500]}"
    return r.json()

def start_processing(sid):
    r = requests.post(f"{SESSIONS_API}/{sid}/process")
    assert r.status_code in (200, 202), f"Process start failed: {r.text[:500]}"
    return r.json()

def wait_for_completion(sid, timeout=7200, interval=20):
    elapsed = 0
    while elapsed < timeout:
        time.sleep(interval)
        elapsed += interval
        r = requests.get(f"{SESSIONS_API}/{sid}/status")
        state = r.json().get("state", "unknown")
        logs = requests.get(f"{SESSIONS_API}/{sid}/logs").json()
        steps = logs.get("completed_steps", [])
        print(f"  [{sid[:8]}] state={state}, steps={steps}, elapsed={elapsed}s")
        if state in ("completed", "error", "cancelled"):
            return state
    return "timeout"

# ── DIA Pipeline ──

def run_dia():
    print("\n=== DIA Pipeline (12 MGL2510 files) ===")

    dia_files = sorted(BASE_DIR.glob("DIA/MGL2510*.txt"))
    assert len(dia_files) == 12, f"Expected 12 DIA files, got {len(dia_files)}"

    # Metadata: 4 conditions x 3 replicates
    # Filename: MGL251001P01C02_NN_PSMs.txt -> NN is 01-12
    drug_map = {
        1: "DMSO", 2: "DMSO", 3: "DMSO",
        4: "Drug1", 5: "Drug1", 6: "Drug1",
        7: "Drug2", 8: "Drug2", 9: "Drug2",
        10: "Drug3", 11: "Drug3", 12: "Drug3",
    }

    metadata_columns = {}
    for f in dia_files:
        # stem = "MGL251001P01C02_01_PSMs"
        parts = f.stem.split("_")
        idx = int(parts[-2])  # "01", "02", etc.
        metadata_columns[f.name] = {
            "experiment": "MGL2510",
            "drug": drug_map[idx],
            "replicate": str(idx),
            "batch": "P01C02",
        }

    comparisons = [
        {"group1": {"drug": "Drug1"}, "group2": {"drug": "DMSO"}},
        {"group1": {"drug": "Drug2"}, "group2": {"drug": "DMSO"}},
        {"group1": {"drug": "Drug3"}, "group2": {"drug": "DMSO"}},
    ]

    paths = [f"DIA/{f.name}" for f in dia_files]

    session = create_session("DIA MGL2510 (Dev)")
    sid = session["id"]
    print(f"  Created session: {sid}")

    configure_session(sid, {
        "file_type": "dia",
        "organism": "human",
        "pipeline": "msqrob2",
        "resolve_shared_peptides": True,
        "max_missing_fraction_per_condition": 0.20,
        "min_psms_per_protein": 2,
        "metadata_columns": metadata_columns,
        "comparisons": comparisons,
        "pvalue_threshold": 0.05,
        "logfc_threshold": 1.0,
    })
    print("  Configured")

    result = select_files(sid, paths)
    print(f"  Selected {len(result.get('files', []))} files")

    start_processing(sid)
    print("  Pipeline started")
    return sid

# ── TMT Pipeline ──

def run_tmt():
    print("\n=== TMT Pipeline (DOCK5 PANC0203) ===")

    tmt_file = BASE_DIR / "TMT" / "20260424_DOCK5_PANC0203_PSMs.txt"
    channel_csv = BASE_DIR / "TMT" / "TMT-Channel-design.csv"
    assert tmt_file.exists(), f"TMT file not found: {tmt_file}"
    assert channel_csv.exists(), f"Channel design not found: {channel_csv}"

    # Parse channel design CSV — skip BOM and two // header lines
    raw = channel_csv.read_text(encoding="utf-8-sig")
    # Remove // comment lines
    lines = [line for line in raw.splitlines() if not line.startswith("//")]
    csv_text = "\n".join(lines)
    reader = csv.DictReader(io.StringIO(csv_text))
    rows = list(reader)
    print(f"  Parsed {len(rows)} channel rows, columns: {reader.fieldnames}")

    channel_mapping = {}
    for row in rows:
        channel = row["Channel"].strip()
        treatment = row.get("Factor 1: Treatment", "").strip()
        cell_line = row.get("Factor 2: Cell line", "").strip()
        time_val = row.get("Factor 3: Time", "").strip()
        condition = f"{treatment}_{cell_line}_{time_val}"
        batch = row.get("Batch", "1").strip()
        channel_mapping[channel] = {
            "Condition": condition,
            "replicate": batch,
        }

    print(f"  Channel mapping: {len(channel_mapping)} channels")

    # Build comparisons: treated vs matching DMSO
    conditions = sorted(set(v["Condition"] for v in channel_mapping.values()))
    dmso_conditions = [c for c in conditions if "DMSO" in c]
    treated_conditions = [c for c in conditions if "DMSO" not in c]

    comparisons = []
    for tc in treated_conditions:
        parts = tc.split("_")
        tc_cell = parts[1] if len(parts) > 1 else ""
        tc_time = parts[2] if len(parts) > 2 else ""
        matching_dmso = [d for d in dmso_conditions if tc_cell in d and tc_time in d]
        dmso_ref = matching_dmso[0] if matching_dmso else dmso_conditions[0]
        comparisons.append({
            "group1": {"Condition": tc},
            "group2": {"Condition": dmso_ref},
        })

    print(f"  Comparisons: {len(comparisons)}")

    session = create_session("TMT DOCK5 PANC0203 (Dev)")
    sid = session["id"]
    print(f"  Created session: {sid}")

    configure_session(sid, {
        "file_type": "tmt",
        "organism": "human",
        "pipeline": "msstats",
        "resolve_shared_peptides": True,
        "max_missing_fraction_per_condition": 0.20,
        "min_psms_per_protein": 2,
        "tmt_channel_mapping": channel_mapping,
        "comparisons": comparisons,
        "msstats_normalization": "equalizeMedians",
        "msstats_summary_method": "TMP",
        "msstats_feature_selection": "all",
        "msstats_impute": True,
        "msstats_log_base": 2,
        "pvalue_threshold": 0.05,
        "logfc_threshold": 1.0,
    })
    print("  Configured")

    result = select_files(sid, ["TMT/20260424_DOCK5_PANC0203_PSMs.txt"])
    print(f"  Selected {len(result.get('files', []))} files")

    start_processing(sid)
    print("  Pipeline started")
    return sid

# ── PTM Pipeline ──

def run_ptm():
    print("\n=== PTM Pipeline (VRK ABPP) ===")

    enrichment_file = BASE_DIR / "PTM" / "20241024_BottomUp_VRK_ABPP_Trail2_EnrichedPeptide_PSMs.txt"
    protein_file = BASE_DIR / "PTM" / "20241024_BottomUp_VRK_ABPP_Trail2_Protein_PSMs.txt"
    assert enrichment_file.exists(), f"PTM enrichment file not found: {enrichment_file}"
    assert protein_file.exists(), f"PTM protein file not found: {protein_file}"

    session = create_session("VRK ABPP PTM (Dev)")
    sid = session["id"]
    print(f"  Created session: {sid}")

    # Step 1: Set file_type and pipeline so role-based selection works
    configure_session(sid, {
        "file_type": "tmt",
        "pipeline": "ptm",
    })
    print("  Set file_type=tmt, pipeline=ptm")

    # Step 2: Select PTM enrichment file with proper role
    result = select_files(
        sid,
        ["PTM/20241024_BottomUp_VRK_ABPP_Trail2_EnrichedPeptide_PSMs.txt"],
        role="ptm_enrichment",
    )
    detected = result["files"][0].get("tmt_channels", [])
    print(f"  Selected enrichment file, {len(detected)} channels detected")

    # Step 3: Select global proteome file with proper role
    result2 = select_files(
        sid,
        ["PTM/20241024_BottomUp_VRK_ABPP_Trail2_Protein_PSMs.txt"],
        role="global_proteome",
    )
    prot_channels = result2["files"][0].get("tmt_channels", [])
    print(f"  Selected protein file, {len(prot_channels)} channels detected")

    # Step 4: Build channel mapping from detected channels
    # The VRK ABPP experiment has 6 TMT channels (TMT 6-plex)
    # Drug vs Ctrl design
    channel_mapping = {}
    for i, ch in enumerate(detected):
        # Assign Drug/Ctrl based on channel order
        group = "Drug" if i < len(detected) // 2 else "Ctrl"
        channel_mapping[ch] = {"Condition": group, "replicate": str(i + 1)}

    print(f"  Channel mapping: {len(channel_mapping)} channels")

    # Step 5: Full configuration
    configure_session(sid, {
        "file_type": "tmt",
        "organism": "human",
        "pipeline": "ptm",
        "ptm_target_modification": "DBIA",  # Desthiobiotin — the ABPP enrichment handle
        "resolve_shared_peptides": True,
        "max_missing_fraction_per_condition": 0.40,
        "min_psms_per_protein": 1,
        "tmt_channel_mapping": channel_mapping,
        "comparisons": [
            {"group1": {"Condition": "Drug"}, "group2": {"Condition": "Ctrl"}},
        ],
        "metadata_columns": {
            enrichment_file.name: {
                "experiment": "VRK ABPP",
                "replicate": "0",
                "batch": "",
            }
        },
        "msstats_normalization": "equalizeMedians",
        "msstats_summary_method": "TMP",
        "msstats_feature_selection": "all",
        "msstats_impute": True,
        "msstats_log_base": 2,
        "pvalue_threshold": 0.05,
        "logfc_threshold": 1.0,
    })
    print("  Configured")

    start_processing(sid)
    print("  Pipeline started")
    return sid

# ── Main ──

if __name__ == "__main__":
    print("Starting pipeline runs against dev backend at", API)

    sessions = {}

    try:
        dia_sid = run_dia()
        sessions["DIA"] = dia_sid
    except Exception as e:
        print(f"DIA setup failed: {e}")
        import traceback; traceback.print_exc()

    try:
        tmt_sid = run_tmt()
        sessions["TMT"] = tmt_sid
    except Exception as e:
        print(f"TMT setup failed: {e}")
        import traceback; traceback.print_exc()

    try:
        ptm_sid = run_ptm()
        sessions["PTM"] = ptm_sid
    except Exception as e:
        print(f"PTM setup failed: {e}")
        import traceback; traceback.print_exc()

    print("\n=== All pipelines started ===")
    print(json.dumps(sessions, indent=2))

    # Wait for all to complete
    for name, sid in sessions.items():
        print(f"\n--- Waiting for {name} ({sid}) ---")
        state = wait_for_completion(sid)
        print(f"  {name} final state: {state}")
        if state != "completed":
            r = requests.get(f"{SESSIONS_API}/{sid}")
            s = r.json()
            print(f"  Error: {s.get('error_message', 'none')}")
            logs = requests.get(f"{SESSIONS_API}/{sid}/logs").json()
            print(f"  Logs: {json.dumps(logs, indent=2)[:500]}")

    print("\n=== Done ===")
