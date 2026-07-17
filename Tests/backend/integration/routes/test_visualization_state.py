"""
Integration test for visualization state persistence.

Verifies that markers and volcano filters are correctly saved
to session.json and restored on session retrieval.
"""

import pytest
from app.db.session_store import SessionStore
from app.models.session import Session, SessionConfig, SessionFiles, SessionState


@pytest.fixture
def sessions_dir(tmp_path):
    """Create a temporary sessions directory."""
    return tmp_path / "sessions"


@pytest.fixture
def store(sessions_dir):
    """Create a SessionStore with temp directory."""
    return SessionStore(sessions_dir)


@pytest.fixture
def sample_session():
    """Create a sample completed session."""

    return Session(
        id="550e8400-e29b-41d4-a716-446655440000",
        name="Integration Test",
        template="multi_condition_comparison",
        state=SessionState.COMPLETED,
        config=SessionConfig(
            treatment="DMSO",
            control="Vehicle",
            organism="human",
            resolve_shared_peptides=False,
            max_missing_fraction_per_condition=0.40,
            min_psms_per_protein=1,
        ),
        files=SessionFiles(),
    )


class TestVisualizationStatePersistence:
    """Test that visualization state persists correctly in session.json."""

    @pytest.mark.asyncio
    async def test_save_and_restore_markers(self, store, sample_session):
        """Markers are saved to session.json and restored on get."""
        await store.create(sample_session)

        # Get session, add markers
        session = await store.get(sample_session.id)
        session.markers = {"default": ["P00367", "Q9Y6Q9"]}
        await store.update(session)

        # Restore and verify
        restored = await store.get(sample_session.id)
        assert restored.markers == {"default": ["P00367", "Q9Y6Q9"]}

    @pytest.mark.asyncio
    async def test_save_and_restore_volcano_filters(self, store, sample_session):
        """Volcano filters are saved and restored correctly."""
        await store.create(sample_session)

        session = await store.get(sample_session.id)
        session.volcano_filters = {
            "foldChange": 2.0,
            "pValue": 0.01,
            "adjPValue": 0.05,
            "s0": 0.15,
        }
        await store.update(session)

        restored = await store.get(sample_session.id)
        assert restored.volcano_filters["foldChange"] == 2.0
        assert restored.volcano_filters["s0"] == 0.15

    @pytest.mark.asyncio
    async def test_session_json_file_contains_fields(
        self, store, sample_session, sessions_dir
    ):
        """The session.json file on disk contains markers and volcano_filters."""
        await store.create(sample_session)

        session = await store.get(sample_session.id)
        session.markers = {"default": ["P00367"]}
        session.volcano_filters = {
            "foldChange": 1.5,
            "pValue": 0.05,
            "adjPValue": 1,
            "s0": 0.1,
        }
        await store.update(session)

        # Read the actual JSON file
        json_path = sessions_dir / sample_session.id / "session.json"
        import json

        with open(json_path) as f:
            data = json.load(f)

        assert "markers" in data
        assert data["markers"] == {"default": ["P00367"]}
        assert "volcano_filters" in data
        assert data["volcano_filters"]["foldChange"] == 1.5
