"""
Unit tests for Session model extensions (visualization state).
"""
from datetime import UTC


class TestSessionVisualizationState:
    """Test visualization state fields on Session model."""

    def test_session_has_markers_field(self):
        """Session model accepts markers list."""
        from datetime import datetime

        from app.models.session import Session, SessionState

        session = Session(
            id="test-id",
            name="test",
            state=SessionState.CREATED,
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
            markers={"default": ["P00367", "Q9Y6Q9"]},
        )
        assert session.markers == {"default": ["P00367", "Q9Y6Q9"]}

    def test_session_markers_default_empty(self):
        """Session markers defaults to empty list."""
        from datetime import datetime

        from app.models.session import Session, SessionState

        session = Session(
            id="test-id",
            name="test",
            state=SessionState.CREATED,
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        assert session.markers == {}

    def test_session_has_volcano_filters_field(self):
        """Session model accepts volcano_filters dict."""
        from datetime import datetime

        from app.models.session import Session, SessionState

        vf = {"foldChange": 1.5, "pValue": 0.05, "adjPValue": 1, "s0": 0.1}
        session = Session(
            id="test-id",
            name="test",
            state=SessionState.CREATED,
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
            volcano_filters=vf,
        )
        assert session.volcano_filters == vf

    def test_session_volcano_filters_default_none(self):
        """Session volcano_filters defaults to None."""
        from datetime import datetime

        from app.models.session import Session, SessionState

        session = Session(
            id="test-id",
            name="test",
            state=SessionState.CREATED,
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        assert session.volcano_filters is None

    def test_session_serialization_roundtrip(self):
        """Session with markers and volcano_filters serializes and deserializes correctly."""
        from datetime import datetime

        from app.models.session import Session, SessionState

        vf = {"foldChange": 1.5, "pValue": 0.05, "adjPValue": 1, "s0": 0.1}
        session = Session(
            id="test-id",
            name="test",
            state=SessionState.CREATED,
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
            markers={"default": ["P00367"]},
            volcano_filters=vf,
        )
        json_str = session.model_dump_json()
        restored = Session.model_validate_json(json_str)
        assert restored.markers == {"default": ["P00367"]}
        assert restored.volcano_filters == vf
