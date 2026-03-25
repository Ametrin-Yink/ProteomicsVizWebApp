"""Upload files and start processing."""
import requests
import json
from pathlib import Path

session_id = "787c43f6-d8a2-47db-8564-c06074036a42"
base_url = "http://localhost:8000/api"

# Upload sample files
sample_files = [
    "SampleData/PSM_SampleData_DMSO_1.csv",
    "SampleData/PSM_SampleData_DMSO_2.csv",
    "SampleData/PSM_SampleData_DMSO_3.csv",
    "SampleData/PSM_SampleData_INCZ123456_1.csv",
    "SampleData/PSM_SampleData_INCZ123456_2.csv",
    "SampleData/PSM_SampleData_INCZ123456_3.csv",
]

print("Uploading files...")
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
        if response.status_code != 200:
            print(f"Error: {response.text}")

print("\nStarting processing...")
response = requests.post(f"{base_url}/sessions/{session_id}/process")
print(f"Process start: {response.status_code}")
print(response.text)
