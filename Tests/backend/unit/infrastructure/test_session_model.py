"""Behavior contracts for persisted session models."""

from app.models.session import Session, SessionFiles


def test_legacy_marker_list_migrates_and_round_trips():
    session = Session.model_validate(
        {
            "id": "legacy-session",
            "name": "Legacy",
            "markers": ["P00367", "Q9Y6Q9"],
            "volcano_filters": {
                "foldChange": 1.5,
                "pValue": 0.05,
                "adjPValue": 0.1,
                "s0": 0.2,
            },
        }
    )

    restored = Session.model_validate_json(session.model_dump_json())
    assert restored.markers == {"default": ["P00367", "Q9Y6Q9"]}
    assert restored.volcano_filters == session.volcano_filters


def test_mutable_session_defaults_are_isolated():
    first = Session(id="first", name="First")
    second = Session(id="second", name="Second")

    first.markers["default"] = ["P1"]
    first.files.proteomics.append(
        {
            "filename": "sample.txt",
            "size": 1,
        }
    )

    assert second.markers == {}
    assert second.files == SessionFiles()


def test_session_pipeline_default_keeps_legacy_derivation_available():
    session = Session(id="pipeline-default", name="Pipeline default")
    assert session.pipeline == ""
