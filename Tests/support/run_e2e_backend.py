"""Run an isolated backend for Playwright's real-stack journey."""

import os
import sys
import tempfile
from pathlib import Path

repo_dir = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(repo_dir / "backend"))

with tempfile.TemporaryDirectory(prefix="proteomicsviz-browser-") as runtime:
    runtime_dir = Path(runtime)
    os.environ["SESSIONS_DIR"] = str(runtime_dir / "sessions")
    os.environ["FILE_LIBRARY_DIR"] = str(runtime_dir / "file-library")
    os.environ["PORT"] = "8766"

    import uvicorn

    uvicorn.run(
        "app.main:app",
        host="127.0.0.1",
        port=8766,
        log_level="warning",
    )
