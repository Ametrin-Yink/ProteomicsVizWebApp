"""Test CRIT-005 - verify GSEA heatmap is shown in bioinformatics page."""
import requests
import json
import time
from pathlib import Path

session_id = None
base_url = "http://localhost:8000/api"

def log(msg):
    print(f"[TEST] {msg}")

try:
    # Create session
    log("Creating session...")
    resp = requests.post(f"{base_url}/sessions", json={
        "name": "CRIT-005 Heatmap Test",
        "experiment": "Test",
        "organism": "human"
    })
    log(f"Response status: {resp.status_code}")
    log(f"Response: {resp.text[:200]}")

    if resp.status_code not in [200, 201]:
        log(f"Failed to create session: {resp.text}")
        exit(1)

    session_data = resp.json()
    # Handle both direct response and wrapped response
    session_id = session_data.get("id") or session_data.get("data", {}).get("id")
    if not session_id:
        log(f"Could not extract session ID from response: {session_data}")
        exit(1)
    log(f"Session created: {session_id}")

    # Upload sample files
    sample_files = [
        "SampleData/PSM_SampleData_DMSO_1.csv",
        "SampleData/PSM_SampleData_DMSO_2.csv",
        "SampleData/PSM_SampleData_DMSO_3.csv",
        "SampleData/PSM_SampleData_INCZ123456_1.csv",
        "SampleData/PSM_SampleData_INCZ123456_2.csv",
        "SampleData/PSM_SampleData_INCZ123456_3.csv",
    ]

    log("Uploading files...")
    for file_path in sample_files:
        full_path = Path(file_path)
        if not full_path.exists():
            log(f"File not found: {file_path}")
            continue

        with open(full_path, 'rb') as f:
            files = {'files': (full_path.name, f, 'text/csv')}
            response = requests.post(
                f"{base_url}/sessions/{session_id}/upload/proteomics",
                files=files
            )
            log(f"Uploaded {full_path.name}: {response.status_code}")

    # Update config
    log("Updating config...")
    resp = requests.put(f"{base_url}/sessions/{session_id}/config", json={
        "control": "DMSO",
        "treatment": "INCZ123456",
        "organism": "human",
        "remove_razor": False
    })
    log(f"Config update: {resp.status_code}")

    # Start processing
    log("Starting processing...")
    resp = requests.post(f"{base_url}/sessions/{session_id}/process")
    log(f"Process start: {resp.status_code}")

    if resp.status_code == 200:
        log(f"Processing started. Session ID: {session_id}")
        log("Waiting for completion...")

        # Poll for completion
        for i in range(60):  # Wait up to 10 minutes
            time.sleep(10)
            resp = requests.get(f"{base_url}/sessions/{session_id}")
            if resp.status_code == 200:
                data = resp.json()
                status = data.get("state") or data.get("data", {}).get("status", "unknown")
                log(f"  Status: {status}")
                if status == "completed":
                    log("Processing complete!")
                    break
                elif status == "error":
                    log("Processing failed!")
                    error_msg = data.get("error_message") or data.get("data", {}).get("error_message", "")
                    log(f"Error: {error_msg}")
                    exit(1)

    log(f"\nTest session ID: {session_id}")
    log(f"View results at: http://localhost:3000/analysis/visualization?session_id={session_id}")

    # Check if GSEA results exist
    results_dir = Path(f"backend/sessions/{session_id}/results")
    gsea_file = results_dir / "GSEA_Results.json"

    if gsea_file.exists():
        log(f"\nGSEA results found! Checking heatmap data...")
        with open(gsea_file, 'r') as f:
            gsea_data = json.load(f)

        for db_name, db_results in gsea_data.items():
            log(f"\nDatabase: {db_name}")
            results = db_results.get("results", [])
            for i, result in enumerate(results[:3]):  # Check first 3 pathways
                pathway_name = result.get("name", "Unknown")
                heatmap_data = result.get("heatmap_data")
                if heatmap_data:
                    genes = heatmap_data.get("genes", [])
                    samples = heatmap_data.get("samples", [])
                    z_scores = heatmap_data.get("z_scores", [])
                    log(f"  Pathway {i+1}: {pathway_name}")
                    log(f"    - Genes: {len(genes)}, Samples: {len(samples)}, Z-scores shape: {len(z_scores)}x{len(z_scores[0]) if z_scores else 0}")
                else:
                    log(f"  Pathway {i+1}: {pathway_name} - NO HEATMAP DATA")
    else:
        log(f"\nGSEA results not found at: {gsea_file}")

except Exception as e:
    log(f"Error: {e}")
    import traceback
    traceback.print_exc()
