"""Test CRIT-006 fix - verify protein abundance normalization to highest median."""
import requests
import json
import time
from pathlib import Path

session_id = "test-crit-006-" + str(int(time.time()))
base_url = "http://localhost:8000/api"

# Create session
print("Creating session...")
resp = requests.post(f"{base_url}/sessions", json={
    "name": "CRIT-006 Test",
    "experiment": "Test",
    "organism": "human"
})
if resp.status_code != 200:
    print(f"Failed to create session: {resp.text}")
    exit(1)

session_id = resp.json()["data"]["id"]
print(f"Session created: {session_id}")

# Upload sample files
sample_files = [
    "SampleData/PSM_SampleData_DMSO_1.csv",
    "SampleData/PSM_SampleData_DMSO_2.csv",
    "SampleData/PSM_SampleData_DMSO_3.csv",
    "SampleData/PSM_SampleData_INCZ123456_1.csv",
    "SampleData/PSM_SampleData_INCZ123456_2.csv",
    "SampleData/PSM_SampleData_INCZ123456_3.csv",
]

print("\nUploading files...")
for file_path in sample_files:
    full_path = Path(file_path)
    if not full_path.exists():
        print(f"File not found: {file_path}")
        continue

    with open(full_path, 'rb') as f:
        files = {'files': (full_path.name, f, 'text/csv')}
        response = requests.post(
            f"{base_url}/sessions/{session_id}/upload/proteomics",
            files=files
        )
        print(f"Uploaded {full_path.name}: {response.status_code}")

# Update config
print("\nUpdating config...")
resp = requests.put(f"{base_url}/sessions/{session_id}/config", json={
    "controlCondition": "DMSO",
    "treatmentCondition": "INCZ123456",
    "removeRazor": False,
    "strictFiltering": False
})
print(f"Config update: {resp.status_code}")

# Start processing
print("\nStarting processing...")
resp = requests.post(f"{base_url}/sessions/{session_id}/process")
print(f"Process start: {resp.status_code}")

if resp.status_code == 200:
    print(f"Processing started. Session ID: {session_id}")
    print("Waiting for completion via WebSocket or polling...")

    # Poll for completion
    for i in range(60):  # Wait up to 10 minutes
        time.sleep(10)
        resp = requests.get(f"{base_url}/sessions/{session_id}")
        if resp.status_code == 200:
            status = resp.json()["data"].get("status", "unknown")
            print(f"  Status: {status}")
            if status == "completed":
                print("Processing complete!")
                break
            elif status == "error":
                print("Processing failed!")
                break

print(f"\nTest session ID: {session_id}")
print(f"View results at: http://localhost:3000/analysis/visualization?session_id={session_id}")
