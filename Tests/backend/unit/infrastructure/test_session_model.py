"""
Unit tests for Session model extensions (visualization state + pipeline reform).
"""
from datetime import UTC, datetime


class TestSessionVisualizationState:
    """Test visualization state fields on Session model."""

    def test_session_has_markers_field(self):
        """Session model accepts markers dict."""
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
        """Session markers defaults to empty dict."""
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


class TestProteomicsFileInfo:
    """Test ProteomicsFileInfo model updates (pipeline reform)."""

    def test_proteomics_file_info_no_conditions_field(self):
        """ProteomicsFileInfo can be created without a conditions field."""
        from app.models.session import ProteomicsFileInfo

        info = ProteomicsFileInfo(
            filename="test_file.txt",
            size=1024,
        )
        assert info.filename == "test_file.txt"
        assert info.size == 1024
        assert info.experiment == ""
        assert info.replicate == 0
        assert info.batch is None
        assert info.file_type is None

    def test_proteomics_file_info_with_batch(self):
        """ProteomicsFileInfo accepts batch field."""
        from app.models.session import ProteomicsFileInfo

        info = ProteomicsFileInfo(
            filename="test_file.txt",
            size=1024,
            batch="BatchA",
        )
        assert info.batch == "BatchA"

    def test_proteomics_file_info_with_file_type(self):
        """ProteomicsFileInfo accepts file_type field."""
        from app.models.session import ProteomicsFileInfo

        info = ProteomicsFileInfo(
            filename="test_file.txt",
            size=1024,
            file_type="tmt",
        )
        assert info.file_type == "tmt"


class TestSessionConfig:
    """Test SessionConfig model updates (pipeline reform)."""

    def test_session_config_with_file_type(self):
        """SessionConfig accepts file_type='tmt'."""
        from app.models.session import SessionConfig

        config = SessionConfig(
            file_type="tmt",
            treatment="DrugA",
            control="DMSO",
        )
        assert config.file_type == "tmt"
        assert config.treatment == "DrugA"

    def test_session_config_with_tmt_channel_mapping(self):
        """SessionConfig accepts tmt_channel_mapping."""
        from app.models.session import SessionConfig

        mapping = {
            "126": {"condition": "DMSO", "replicate": 1},
            "127N": {"condition": "DMSO", "replicate": 2},
        }
        config = SessionConfig(tmt_channel_mapping=mapping)
        assert config.tmt_channel_mapping == mapping
        assert config.tmt_channel_mapping["126"]["condition"] == "DMSO"
        assert config.tmt_channel_mapping["126"]["replicate"] == 1

    def test_session_config_file_type_default_none(self):
        """SessionConfig.file_type defaults to None."""
        from app.models.session import SessionConfig

        config = SessionConfig()
        assert config.file_type is None

    def test_session_config_tmt_channel_mapping_default_none(self):
        """SessionConfig.tmt_channel_mapping defaults to None."""
        from app.models.session import SessionConfig

        config = SessionConfig()
        assert config.tmt_channel_mapping is None


class TestSessionPipelineDefault:
    """Test Session pipeline field default (changed from 'msqrob2' to '')."""

    def test_session_pipeline_default_empty(self):
        """Session pipeline field defaults to empty string."""
        from app.models.session import Session, SessionState

        session = Session(
            id="pipeline-default-test",
            name="test",
            state=SessionState.CREATED,
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        assert session.pipeline == ""
