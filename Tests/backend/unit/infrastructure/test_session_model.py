"""Behavior contracts for persisted session models."""

from app.models.session import ProteomicsFileInfo, Session, SessionConfig, SessionFiles


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


def test_ptm_session_contract_round_trips_detected_modifications():
    session = Session(
        id="ptm-session",
        name="PTM",
        pipeline="ptm",
        config=SessionConfig(
            file_type="tmt",
            organism="human",
            ptm_target_modification="DBIA",
            ptm_fasta_source="human",
            ptm_background_normalization=True,
            ptm_normalization_method="centered_median",
            ptm_imputation=True,
            resolve_shared_peptides=True,
        ),
        files=SessionFiles(
            ptm_enrichment=[
                ProteomicsFileInfo(
                    filename="ptm.txt",
                    size=1,
                    file_type="ptm",
                    tmt_channels=["126", "127"],
                    detected_modifications=[
                        {"name": "DBIA", "row_count": 2, "occurrence_count": 2}
                    ],
                )
            ]
        ),
    )

    restored = Session.model_validate_json(session.model_dump_json())
    assert restored.config.ptm_target_modification == "DBIA"
    assert restored.config.ptm_normalization_method == "centered_median"
    assert restored.files.ptm_enrichment[0].detected_modifications[0]["name"] == "DBIA"


def test_legacy_ptm_normalization_boolean_migrates_to_method():
    disabled = SessionConfig.model_validate({"ptm_background_normalization": False})
    enabled = SessionConfig.model_validate({"ptm_background_normalization": True})

    assert disabled.ptm_normalization_method == "none"
    assert enabled.ptm_normalization_method == "background_peptide"
