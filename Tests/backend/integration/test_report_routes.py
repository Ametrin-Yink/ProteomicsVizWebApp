"""
Integration tests for report API routes.
"""

import io
import uuid
import zipfile
import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app


NONEXISTENT_SESSION = str(uuid.uuid4())


def make_test_zip() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("index.html", "<html><body>Test Report</body></html>")
        zf.writestr("assets/data.json", '{"test": true}')
    return buf.getvalue()


@pytest.fixture
def client():
    """Create an async test client."""
    # Set up app state as done in main.py lifespan
    from app.core.config import settings
    from app.db.session_store import SessionStore
    from app.services.session_manager import session_manager

    if not hasattr(app.state, "session_manager"):
        store = SessionStore(settings.sessions_dir)
        app.state.session_store = store
        session_manager.session_store = store
        app.state.session_manager = session_manager

    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


@pytest.mark.asyncio
async def test_list_reports_empty(client):
    response = await client.get("/api/reports")
    assert response.status_code == 200
    data = response.json()
    assert "reports" in data
    assert data["reports"] == []


@pytest.mark.asyncio
async def test_delete_nonexistent_report(client):
    response = await client.delete("/api/reports/rpt_nonexistent")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_report_not_found_serve(client):
    response = await client.get("/api/reports/rpt_nonexistent")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_weblink_upload_requires_completed_session(client):
    """Upload should fail if session doesn't exist."""
    response = await client.post(
        f"/api/sessions/{NONEXISTENT_SESSION}/export/weblink",
        data={"name": "Test"},
        files={"zip": ("report.zip", make_test_zip(), "application/zip")},
    )
    assert response.status_code == 404
