"""
Full TMT analysis: upload 20260424_DOCK5_PANC0203_PSMs.txt,
apply channel design, run MSstats pipeline with 4 comparisons vs DMSO_24h.
"""
import csv, json, time, sys, requests
from pathlib import Path

API = "http://localhost:8000/api/sessions"
TMT_FILE = Path("SampleData/real_PD_files/20260424_DOCK5_PANC0203_PSMs.txt")
DESIGN_CSV = Path("SampleData/real_PD_files/TMT-Channel-design.csv")

# ── 1. Parse channel design CSV ──
print("=== Parsing channel design ===")
channel_map = {}
with open(DESIGN_CSV) as f:
    reader = csv.reader(f)
    for row in reader:
        if not row or len(row) < 9 or row[0].startswith("//") or row[0] == "Study":
            continue
        study, sample, pos, order, batch, channel, drug, cell, time_pt = row[0], row[1], row[2], row[3], row[4], row[5], row[6], row[7], row[8]
        channel_map[channel] = {
            "treatment": drug,
            "cell_line": cell,
            "time": time_pt,
            "replicate": 1,  # Will count per group
        }

# Assign replicate numbers per unique condition group
from collections import defaultdict
replicate_counter = defaultdict(int)
for ch in sorted(channel_map.keys()):
    key = f"{channel_map[ch]['treatment']}_{channel_map[ch]['cell_line']}_{channel_map[ch]['time']}"
    replicate_counter[key] += 1
    channel_map[ch]['replicate'] = replicate_counter[key]

# Summary
conditions = set()
for ch, info in channel_map.items():
    cond = f"{info['treatment']}_{info['time']}"
    conditions.add(cond)
print(f"Channels mapped: {len(channel_map)}")
print(f"Conditions: {sorted(conditions)}")
print(f"Replicates per condition:")
for key, count in sorted(replicate_counter.items()):
    print(f"  {key}: {count}")

# ── 2. Create session ──
print("\n=== Creating session ===")
r = requests.post(API, json={"name": "TMT DOCK5 Full Analysis", "template": "multi_condition_comparison"})
session = r.json()
sid = session["id"]
print(f"Session: {sid}")

# Set config
r = requests.post(f"{API}/{sid}/config", json={
    "file_type": "tmt",
    "organism": "human",
    "remove_razor": True,
    "strict_filtering": True,
    "tmt_channel_mapping": channel_map,
    "pipeline": "msstats",
})
print(f"Config: {r.status_code}")

# ── 3. Upload file ──
print("\n=== Uploading TMT file ===")
file_size_mb = TMT_FILE.stat().st_size / (1024*1024)
print(f"File: {TMT_FILE.name} ({file_size_mb:.0f} MB)")
sys.stdout.flush()

with open(TMT_FILE, "rb") as f:
    r = requests.post(
        f"{API}/{sid}/upload/proteomics",
        files={"files": (TMT_FILE.name, f, "text/plain")},
        timeout=600,
    )
if r.status_code == 200:
    result = r.json()
    channels = result["files"][0].get("tmt_channels", [])
    print(f"Upload OK. Detected {len(channels)} TMT channels: {channels[:5]}...")
else:
    print(f"Upload FAILED: {r.status_code} {r.text[:300]}")
    sys.exit(1)

# ── 4. Set comparisons: 4 drug+time groups vs DMSO_24h ──
print("\n=== Setting comparisons ===")
comparisons = [
    {"group1": {"treatment": "INCB224525", "time": "4h"},  "group2": {"treatment": "DMSO", "time": "24h"}},
    {"group1": {"treatment": "INCB231845", "time": "4h"},  "group2": {"treatment": "DMSO", "time": "24h"}},
    {"group1": {"treatment": "INCB224525", "time": "24h"}, "group2": {"treatment": "DMSO", "time": "24h"}},
    {"group1": {"treatment": "INCB231845", "time": "24h"}, "group2": {"treatment": "DMSO", "time": "24h"}},
]
for i, comp in enumerate(comparisons):
    g1 = "_".join(comp["group1"].values())
    g2 = "_".join(comp["group2"].values())
    print(f"  Comparison {i+1}: {g1} vs {g2}")

r = requests.post(f"{API}/{sid}/config", json={
    "file_type": "tmt",
    "organism": "human",
    "remove_razor": True,
    "strict_filtering": True,
    "tmt_channel_mapping": channel_map,
    "comparisons": comparisons,
    "pipeline": "msstats",
})
print(f"Comparisons saved: {r.status_code}")

# ── 5. Set MSstats config with defaults ──
print("\n=== Configuring MSstats ===")
msstats_config = {
    "file_type": "tmt",
    "organism": "human",
    "remove_razor": True,
    "strict_filtering": True,
    "tmt_channel_mapping": channel_map,
    "comparisons": comparisons,
    "pipeline": "msstats",
    # MSstats defaults
    "msstats_normalization": "equalizeMedians",
    "msstats_summary_method": "TMP",
    "msstats_feature_selection": "all",
    "msstats_impute": True,
    "msstats_log_base": 2,
    "msstats_censored_int": "NA",
    "msstats_max_quantile": 0.999,
    "msstats_remove50missing": False,
    "pvalue_threshold": 0.05,
    "logfc_threshold": 1.0,
    "min_peptides_per_protein": 1,
}
r = requests.post(f"{API}/{sid}/config", json=msstats_config)
print(f"MSstats config: {r.status_code}")

# ── 6. Start processing ──
print("\n=== Starting pipeline ===")
r = requests.post(f"{API}/{sid}/process")
if r.status_code == 202:
    print("Pipeline started")
elif r.status_code == 200:
    data = r.json()
    if data.get("data", {}).get("status") == "started":
        print("Pipeline started (status: started)")
    else:
        print(f"Unexpected response: {r.text[:300]}")
        sys.exit(1)
else:
    print(f"Start failed: {r.status_code} {r.text[:300]}")
    sys.exit(1)

# ── 7. Monitor progress ──
print("\n=== Monitoring pipeline ===")
max_wait = 3600  # 1 hour max
interval = 15    # poll every 15 seconds
elapsed = 0
last_step = 0

while elapsed < max_wait:
    time.sleep(interval)
    elapsed += interval

    r = requests.get(f"{API}/{sid}/status")
    status = r.json()
    state = status.get("state", "unknown")
    step = status.get("current_step", 0)
    progress = status.get("progress", 0)

    if step != last_step:
        print(f"  [{elapsed}s] State: {state}, Step: {step}, Progress: {progress}%")
        last_step = step
    else:
        sys.stdout.write(".")
        sys.stdout.flush()

    if state in ("completed", "error", "cancelled"):
        print(f"\n  Final state: {state}")
        break

# ── 8. Check results ──
print("\n=== Results ===")
r = requests.get(f"{API}/{sid}")
session_data = r.json()
state = session_data.get("state")
print(f"Session state: {state}")

if state == "error":
    print(f"Error: {session_data.get('error_message', 'unknown')}")

# Check for DE results
r = requests.get(f"{API}/{sid}/results")
if r.status_code == 200:
    results = r.json()
    print(f"Results: {json.dumps(results, indent=2)[:500]}")
else:
    print(f"Results endpoint: {r.status_code}")

# Check logs
r = requests.get(f"{API}/{sid}/logs")
if r.status_code == 200:
    logs = r.json()
    completed = logs.get("completed_steps", [])
    print(f"Completed steps: {completed}")
    if logs.get("logs"):
        print(f"Last log entries:")
        for entry in logs["logs"][-10:]:
            print(f"  [{entry.get('timestamp','')}] {entry.get('message','')[:120]}")
