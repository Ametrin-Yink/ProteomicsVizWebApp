from pathlib import Path

import pandas as pd
import pytest
from app.services.ptm_tmt_processor import (
    apply_background_normalization,
    apply_centered_median_normalization,
    build_ptm_site_inputs,
    build_site_assignment,
    extract_peptide_sequence,
    parse_localization_scores,
    parse_modification_sites,
    prepare_pd_tmt_long,
    site_passes_coverage,
)


def test_real_pd_modification_and_localization_syntax():
    modifications = "N-Term(TMT6plex); C3(DBIA); C4(Carbamidomethyl); K8(TMT6plex)"
    localization = (
        "C3(DBIA): 50; C3(Carbamidomethyl): 50; C4(DBIA): 50; C4(Carbamidomethyl): 50"
    )

    assert parse_modification_sites(modifications, "DBIA") == [("C", 3)]
    assert parse_localization_scores(localization, "DBIA") == [
        ("C", 3, 50.0),
        ("C", 4, 50.0),
    ]


def test_extracts_unflanked_peptide_from_annotated_sequence():
    assert extract_peptide_sequence("[R].iHTGEkPYEcVQcGk.[S]") == "IHTGEKPYECVQCGK"


def test_ambiguous_candidates_are_one_feature_without_duplication():
    assignment = build_site_assignment(
        accession="P12345",
        peptide="ACCK",
        target_sites=[("C", 2)],
        localization_scores=[("C", 2, 50.0), ("C", 3, 50.0)],
        protein_sequence="MACKACCKTT",
        target_modification="DBIA",
    )

    assert assignment.site_token == "candidate_C6|C7"
    assert assignment.display_label == "P12345 · candidate positions C6|C7"
    assert assignment.localization_status == "Ambiguous"


def test_confident_multi_site_is_combined_feature():
    assignment = build_site_assignment(
        accession="P12345",
        peptide="ACCK",
        target_sites=[("C", 2), ("C", 3)],
        localization_scores=[("C", 2, 100.0), ("C", 3, 100.0)],
        protein_sequence="MACKACCKTT",
        target_modification="DBIA",
    )

    assert assignment.site_token == "C6+C7"
    assert assignment.display_label == "P12345 · C6+C7"
    assert assignment.localization_status == "Confident"


def test_fasta_unmapped_is_retained():
    assignment = build_site_assignment(
        accession="P12345",
        peptide="ACCK",
        target_sites=[("C", 2)],
        localization_scores=[],
        protein_sequence="MMMM",
        target_modification="DBIA",
    )

    assert assignment.site_token == "peptide_C2_unmapped"
    assert assignment.mapping_status == "FASTA-unmapped"
    assert assignment.localization_status == "Unscored"


def test_background_normalization_centers_channel_medians():
    background = pd.DataFrame(
        {
            "PeptideSequence": ["A", "A", "B", "B"],
            "Charge": [2, 2, 2, 2],
            "Channel": ["126", "127", "126", "127"],
            "Abundance": [100.0, 400.0, 200.0, 800.0],
        }
    )
    target = pd.DataFrame({"Channel": ["126", "127"], "Abundance": [100.0, 400.0]})

    normalized, factors = apply_background_normalization(
        target, background, sample_channels=["126", "127"], minimum_features=2
    )

    assert factors.applied is True
    assert factors.complete_feature_count == 2
    assert normalized["NormalizedAbundance"].round(6).nunique() == 1


def test_background_normalization_skips_below_minimum():
    background = pd.DataFrame(
        {
            "PeptideSequence": ["A", "A"],
            "Charge": [2, 2],
            "Channel": ["126", "127"],
            "Abundance": [100.0, 200.0],
        }
    )
    target = pd.DataFrame({"Channel": ["126"], "Abundance": [10.0]})

    normalized, factors = apply_background_normalization(
        target, background, sample_channels=["126", "127"], minimum_features=50
    )

    assert factors.applied is False
    assert factors.complete_feature_count == 1
    assert normalized["NormalizedAbundance"].tolist() == [10.0]


def test_centered_median_normalization_equalizes_target_channel_medians():
    target = pd.DataFrame(
        {
            "Channel": ["126", "126", "127", "127"],
            "Abundance": [100.0, 200.0, 400.0, 800.0],
        }
    )

    normalized, result = apply_centered_median_normalization(
        target,
        sample_channels=["126", "127"],
    )

    medians = normalized.groupby("Channel")["NormalizedAbundance"].median()
    assert result.applied is True
    assert result.method == "centered_median"
    assert medians["126"] == pytest.approx(medians["127"])


def test_coverage_requires_two_of_three_in_every_condition():
    observed = {"Drug": {"126", "127"}, "DMSO": {"129", "130"}}
    expected = {"Drug": {"126", "127", "128"}, "DMSO": {"129", "130", "131"}}
    assert site_passes_coverage(observed, expected, max_missing_fraction=0.40)

    observed["DMSO"] = {"129"}
    assert not site_passes_coverage(observed, expected, max_missing_fraction=0.40)


def _mapping():
    return {
        "126": {"condition": "Drug", "replicate": 1, "role": "Sample"},
        "127": {"condition": "Drug", "replicate": 2, "role": "Sample"},
        "128": {"condition": "Drug", "replicate": 3, "role": "Sample"},
        "129": {"condition": "DMSO", "replicate": 1, "role": "Sample"},
        "130": {"condition": "DMSO", "replicate": 2, "role": "Sample"},
        "131": {"condition": "DMSO", "replicate": 3, "role": "Sample"},
    }


def _write_pd(path: Path, rows: list[dict]) -> None:
    pd.DataFrame(rows).to_csv(path, sep="\t", index=False)


def test_prepare_ptm_long_uses_inclusive_fixed_filters(tmp_path):
    base = {
        "Annotated Sequence": "[K].acDK.[R]",
        "Modifications": "N-Term(TMT6plex); C2(DBIA)",
        "Charge": 2,
        "Contaminant": False,
        "Master Protein Accessions": "P12345",
        "Quan Info": "ExcludedByMethod",
        "Average Reporter SN": 5,
        "Isolation Interference in Percent": 50,
        "ptmRS Best Site Probabilities": "C2(DBIA): 100",
        **{f"Abundance {channel}": 100 for channel in _mapping()},
    }
    rows = [
        base,
        {**base, "Average Reporter SN": 4.99},
        {**base, "Isolation Interference in Percent": 50.01},
        {**base, "Contaminant": True},
    ]
    source = tmp_path / "ptm.txt"
    output = tmp_path / "ptm.parquet"
    _write_pd(source, rows)

    metrics = prepare_pd_tmt_long(source, output, _mapping(), role="ptm")
    result = pd.read_parquet(output)

    assert metrics == {
        "input_psms": 4,
        "quality_filtered_psms": 1,
        "long_reporter_rows": 6,
    }
    assert set(result["Channel"].astype(str)) == set(_mapping())
    assert set(result["Condition"]) == {"Drug", "DMSO"}
    assert result["Annotated_Sequence"].eq("[K].acDK.[R]").all()


def test_prepare_ptm_accepts_filename_prefixed_channel_metadata(tmp_path):
    mapping = {f"ptm.txt::{channel}": values for channel, values in _mapping().items()}
    row = {
        "Annotated Sequence": "[K].ACDK.[R]",
        "Modifications": "C2(DBIA)",
        "Charge": 2,
        "Contaminant": False,
        "Master Protein Accessions": "P1",
        "Quan Info": "",
        "Average Reporter SN": 10,
        "Isolation Interference in Percent": 10,
        **{f"Abundance {channel}": 100 for channel in _mapping()},
    }
    source = tmp_path / "ptm.txt"
    output = tmp_path / "ptm.parquet"
    _write_pd(source, [row])

    prepare_pd_tmt_long(source, output, mapping, role="ptm")

    assert set(pd.read_parquet(output)["Channel"].astype(str)) == set(_mapping())


def test_prepare_ptm_uses_canonical_condition_order(tmp_path):
    mapping = {
        channel: {
            **(
                {"time": "24h", "condition": values["condition"]}
                if index % 2
                else {"condition": values["condition"], "time": "24h"}
            ),
            "replicate": values["replicate"],
            "role": values["role"],
        }
        for index, (channel, values) in enumerate(_mapping().items())
    }
    row = {
        "Sequence": "ACDK",
        "Modifications": "C2(DBIA)",
        "Charge": 2,
        "Contaminant": False,
        "Master Protein Accessions": "P1",
        "Average Reporter SN": 10,
        "Isolation Interference in Percent": 10,
        **{f"Abundance {channel}": 100 for channel in mapping},
    }
    source = tmp_path / "ptm.txt"
    output = tmp_path / "ptm.parquet"
    _write_pd(source, [row])

    prepare_pd_tmt_long(source, output, mapping, role="ptm")

    assert set(pd.read_parquet(output)["Condition"]) == {
        "DMSO_24h",
        "Drug_24h",
    }


def test_sequence_alias_is_canonical_for_optional_protein(tmp_path):
    row = {
        "Sequence": "ACDK",
        "Modifications": "C2(Carbamidomethyl)",
        "Charge": 2,
        "Contaminant": False,
        "Master Protein Accessions": "P1",
        "Average Reporter SN": 10,
        "Normalized CHIMERYS Coefficient": 0.8,
        **{f"Abundance {channel}": 100 for channel in _mapping()},
    }
    source = tmp_path / "protein.txt"
    output = tmp_path / "protein.parquet"
    _write_pd(source, [row])

    prepare_pd_tmt_long(source, output, _mapping(), role="protein")

    result = pd.read_parquet(output)
    assert "Annotated_Sequence" in result
    assert "Sequence" not in result


def test_prepare_ptm_rejects_duplicate_metadata_for_one_reporter_channel(tmp_path):
    mapping = _mapping()
    mapping["old-ptm.txt::126"] = mapping["126"]
    row = {
        "Annotated Sequence": "[K].ACDK.[R]",
        "Modifications": "C2(DBIA)",
        "Charge": 2,
        "Contaminant": False,
        "Master Protein Accessions": "P1",
        "Quan Info": "",
        "Average Reporter SN": 10,
        "Isolation Interference in Percent": 10,
        **{f"Abundance {channel}": 100 for channel in _mapping()},
    }
    source = tmp_path / "ptm.txt"
    _write_pd(source, [row])

    with pytest.raises(ValueError, match="Reporter channel 126 has duplicate metadata"):
        prepare_pd_tmt_long(source, tmp_path / "ptm.parquet", mapping, role="ptm")


@pytest.mark.parametrize("sequence_column", ["Sequence", "Annotated Sequence"])
def test_build_site_inputs_sums_repeated_psms_and_keeps_peptidoforms(
    tmp_path,
    sequence_column,
):
    mapping = _mapping()
    target = {
        sequence_column: "[K].acDK.[R]",
        "Modifications": "N-Term(TMT6plex); C2(DBIA)",
        "Charge": 2,
        "Contaminant": False,
        "Master Protein Accessions": "P12345",
        "Quan Info": "",
        "Average Reporter SN": 10,
        "Isolation Interference in Percent": 10,
        "ptmRS Best Site Probabilities": "C2(DBIA): 100",
        **{f"Abundance {channel}": 100 for channel in mapping},
    }
    background = {
        **target,
        sequence_column: "[K].TTK.[R]",
        "Modifications": "N-Term(TMT6plex)",
        "ptmRS Best Site Probabilities": "",
        **{f"Abundance {channel}": 200 for channel in mapping},
    }
    source = tmp_path / "ptm.txt"
    long_path = tmp_path / "ptm.parquet"
    _write_pd(source, [target, target, background])
    prepare_pd_tmt_long(source, long_path, mapping, role="ptm")
    fasta = tmp_path / "test.fasta"
    fasta.write_text(">sp|P12345|TEST GN=GENE1\nMACDKTTK\n", encoding="utf-8")

    outputs = build_ptm_site_inputs(
        long_path,
        tmp_path / "results",
        target_modification="DBIA",
        fasta_path=fasta,
        channel_mapping=mapping,
        background_normalization=True,
        max_missing_fraction=0.40,
        minimum_background_features=1,
    )

    msstats = pd.read_csv(outputs["ptm_input_path"], sep="\t")
    metadata = pd.read_csv(outputs["site_metadata_path"], sep="\t")
    abundance = pd.read_csv(outputs["abundance_path"], sep="\t")
    assert msstats["ProteinName"].unique().tolist() == ["P12345_C3"]
    assert metadata.loc[0, "SiteLabel"] == "P12345 · C3"
    assert metadata.loc[0, "LocalizationStatus"] == "Confident"
    assert abundance["Abundance"].eq(200).all()


def test_site_specific_feature_ids_do_not_collapse_localization_groups(tmp_path):
    mapping = _mapping()
    target = {
        "Annotated Sequence": "[K].ACDKC.[R]",
        "Modifications": "N-Term(TMT6plex); C2(DBIA)",
        "Charge": 2,
        "Contaminant": False,
        "Master Protein Accessions": "P12345",
        "Quan Info": "",
        "Average Reporter SN": 10,
        "Isolation Interference in Percent": 10,
        "ptmRS Best Site Probabilities": "C2(DBIA): 100",
        **{f"Abundance {channel}": 100 for channel in mapping},
    }
    ambiguous = {
        **target,
        "ptmRS Best Site Probabilities": "C2(DBIA): 60; C5(DBIA): 40",
        **{f"Abundance {channel}": 200 for channel in mapping},
    }
    source = tmp_path / "ptm.txt"
    long_path = tmp_path / "ptm.parquet"
    _write_pd(source, [target, ambiguous])
    prepare_pd_tmt_long(source, long_path, mapping, role="ptm")
    fasta = tmp_path / "test.fasta"
    fasta.write_text(">sp|P12345|TEST GN=GENE1\nMACDKC\n", encoding="utf-8")

    outputs = build_ptm_site_inputs(
        long_path,
        tmp_path / "results",
        target_modification="DBIA",
        fasta_path=fasta,
        channel_mapping=mapping,
        background_normalization=False,
        max_missing_fraction=0.40,
    )

    msstats = pd.read_csv(outputs["ptm_input_path"], sep="\t")
    assert msstats["ProteinName"].nunique() == 2
    assert not msstats.duplicated(["PSM", "Channel", "Run"]).any()
    assert not msstats.duplicated(["PeptideSequence", "Charge", "Channel", "Run"]).any()
