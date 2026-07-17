"""Fixtures for opt-in live scientific pipeline tests."""

import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import pytest


@pytest.fixture(scope="session")
def live_server(tmp_path_factory):
    """Run the API against isolated roots for the live pipeline lane."""
    runtime_dir = tmp_path_factory.mktemp("live-pipeline")
    sessions_dir = runtime_dir / "sessions"
    file_library_dir = runtime_dir / "file-library"
    sessions_dir.mkdir()
    file_library_dir.mkdir()

    environment = os.environ.copy()
    environment["SESSIONS_DIR"] = str(sessions_dir)
    environment["FILE_LIBRARY_DIR"] = str(file_library_dir)

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as port_socket:
        port_socket.bind(("127.0.0.1", 0))
        port = port_socket.getsockname()[1]
    base_url = f"http://127.0.0.1:{port}"
    environment["PORT"] = str(port)

    backend_dir = Path(__file__).resolve().parents[4] / "backend"
    log_path = runtime_dir / "server.log"
    log_file = log_path.open("w", encoding="utf-8")
    process = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "app.main:app",
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
        ],
        cwd=backend_dir,
        env=environment,
        stdout=log_file,
        stderr=subprocess.STDOUT,
        text=True,
    )

    try:
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            if process.poll() is not None:
                break
            try:
                with urllib.request.urlopen(f"{base_url}/health", timeout=1):
                    break
            except (urllib.error.URLError, TimeoutError):
                time.sleep(0.25)
        else:
            pytest.fail("Timed out waiting for the isolated live-test API")

        if process.poll() is not None:
            log_file.flush()
            pytest.fail(
                f"Live-test API exited during startup:\n{log_path.read_text(encoding='utf-8')}"
            )

        from app.core.config import settings

        original_sessions_dir = settings.sessions_dir
        original_file_library_dir = settings.file_library_dir
        settings.sessions_dir = sessions_dir
        settings.file_library_dir = file_library_dir
        try:
            yield base_url
        finally:
            settings.sessions_dir = original_sessions_dir
            settings.file_library_dir = original_file_library_dir
    finally:
        process.terminate()
        try:
            process.wait(timeout=15)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
        log_file.close()
