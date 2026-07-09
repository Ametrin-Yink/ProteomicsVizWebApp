"""TMT analysis v2 — treatment+time groups only, no cell_line."""
import csv, json, time, sys, requests
from pathlib import Path
from collections import defaultdict

API = "http://localhost:8000/api/sessions"
TMT_FILE = Path("SampleData/real_PD_files/20260424_DOCK5_PANC0203_PSMs.txt")
DESIGN_CSV = Path("SampleData/real_PD_files/TMT-Channel-design.csv")

# ── Parse channel design ──
print("=== Parsing channel design ===")
channel_map = {}
replicate_counter = defaultdict(int)

with open(DESIGN_CSV) as f:
    reader = csv.reader(f)
    for row in reader:
        if not row or len(row) < 9 or row[0].startswith("//") or row[0] == "Study":
            continue
        channel = row[5]
        drug = row[6]
        time_pt = row[8]
        # Skip if already mapped (only use first batch=PANC02_03)
        if channel in channel_map:
            continue
        key = f"{drug}_{time_pt}"
        replicate_counter[key] += 1
        channel_map[channel] = {
            "treatment": drug,
            "time": time_pt,
            "replicate": replicate_counter[key],
        }

conditions = set(f"{v['treatment']}_{v['time']}" for v in channel_map.values())
print(f"Channels: {len(channel_map)}, Conditions: {sorted(conditions)}")
for key, count in sorted(replicate_counter.items()):
    print(f"  {key}: {count} reps")

# ── Create session ──
print("\n=== Session ===")
r = requests.post(API, json={"name": "TMT DOCK5 v2", "template": "multi_condition_comparison"})
sid = r.json()["id"]
print(f"Session: {sid}")

# ── Set file_type first (required before upload validation) ──
r = requests.post(f"{API}/{sid}/config", json={"file_type": "tmt"})
print(f"Type set: {r.status_code}")

# ── Upload ──
print(f"\n=== Upload ({TMT_FILE.stat().st_size/(1024*1024):.0f} MB) ===")
with open(TMT_FILE, "rb") as f:
    r = requests.post(f"{API}/{sid}/upload/proteomics", files={"files": (TMT_FILE.name, f, "text/plain")}, timeout=600)
if r.status_code != 200:
    print(f"FAIL: {r.status_code}"); sys.exit(1)
result = r.json()
channels = result["files"][0].get("tmt_channels", [])
print(f"OK — {len(channels)} channels detected")

# ── Config + comparisons ──
comparisons = [
    {"group1": {"treatment": "INCB224525", "time": "4h"},  "group2": {"treatment": "DMSO", "time": "24h"}},
    {"group1": {"treatment": "INCB231845", "time": "4h"},  "group2": {"treatment": "DMSO", "time": "24h"}},
    {"group1": {"treatment": "INCB224525", "time": "24h"}, "group2": {"treatment": "DMSO", "time": "24h"}},
    {"group1": {"treatment": "INCB231845", "time": "24h"}, "group2": {"treatment": "DMSO", "time": "24h"}},
]

config = {
    "file_type": "tmt", "organism": "human", "pipeline": "msstats",
    "remove_razor": True, "strict_filtering": True,
    "tmt_channel_mapping": channel_map, "comparisons": comparisons,
    "msstats_normalization": "equalizeMedians", "msstats_summary_method": "TMP",
    "msstats_feature_selection": "all", "msstats_impute": True,
    "msstats_log_base": 2, "msstats_censored_int": "NA",
    "msstats_max_quantile": 0.999, "msstats_remove50missing": False,
    "pvalue_threshold": 0.05, "logfc_threshold": 1.0,
    "min_peptides_per_protein": 1,
}

r = requests.post(f"{API}/{sid}/config", json=config)
print(f"Config: {r.status_code}")

# ── Start ──
print("\n=== Starting ===")
r = requests.post(f"{API}/{sid}/process")
print(f"Process: {r.status_code}")

# ── Monitor ──
print("\n=== Monitoring ===")
max_wait, interval, elapsed = 3600, 15, 0
last_step = 0
while elapsed < max_wait:
    time.sleep(interval); elapsed += interval
    r = requests.get(f"{API}/{sid}/logs")
    logs = r.json()
    step = logs.get("current_step", 0)
    comp = logs.get("completed_steps", [])
    state_r = requests.get(f"{API}/{sid}/status")
    state = state_r.json().get("state", "?")
    if step != last_step:
        print(f"[{elapsed}s] Step {step}, Completed: {comp}, State: {state}")
        last_step = step
    else:
        sys.stdout.write("."); sys.stdout.flush()
    if state in ("completed", "error", "cancelled"):
        print(f"\nState: {state}")
        break

# ── Results ──
print("\n=== Logs (last 20) ===")
r = requests.get(f"{API}/{sid}/logs")
for l in r.json().get("logs", [])[-20:]:
    print(f"  [{l['level']:7s}] [{l.get('step','?'):1s}] {l['message'][:150]}")
