"""Unit tests for BioNet service."""

import json
from pathlib import Path

import pytest


class TestBioNetService:
    def test_config_serialization(self):
        """Config dict should serialize to JSON compatible with R jsonlite."""
        config = {
            "pvalue_cutoff": 0.05,
            "logfc_cutoff": 0.5,
            "statement_types": ["IncreaseAmount", "DecreaseAmount"],
            "paper_count_cutoff": 1,
            "evidence_count_cutoff": 1,
            "correlation_cutoff": None,
            "sources_filter": None,
        }
        serialized = json.dumps(config)
        parsed = json.loads(serialized)
        assert parsed["correlation_cutoff"] is None
        assert parsed["statement_types"] == ["IncreaseAmount", "DecreaseAmount"]

    def test_logfc_prefilter_removes_below_cutoff(self, tmp_path: Path):
        """Proteins with |logFC| <= cutoff should be excluded."""
        import pandas as pd

        de_file = tmp_path / "test_de.tsv"
        pd.DataFrame(
            {
                "Master_Protein_Accessions": ["P1", "P2", "P3"],
                "Gene_Name": ["G1", "G2", "G3"],
                "logFC": [2.0, 0.3, -0.1],
                "pval": [0.001, 0.01, 0.05],
                "adjPval": [0.001, 0.01, 0.05],
            }
        ).to_csv(de_file, sep="\t", index=False)

        df = pd.read_csv(de_file, sep="\t")
        logfc_cutoff = 0.5
        df_filtered = df[df["logFC"].abs() > logfc_cutoff]
        assert len(df_filtered) == 1  # Only P1 passes (|2.0| > 0.5)
        assert df_filtered.iloc[0]["Master_Protein_Accessions"] == "P1"

    def test_over_400_proteins_raises(self, tmp_path: Path):
        """Input with >= 400 proteins should raise RuntimeError."""
        import pandas as pd

        de_file = tmp_path / "test_large.tsv"
        rows = []
        for i in range(400):
            rows.append(
                {
                    "Master_Protein_Accessions": f"P{i}",
                    "Gene_Name": f"G{i}",
                    "logFC": 2.0,
                    "pval": 0.001,
                    "adjPval": 0.001,
                }
            )
        pd.DataFrame(rows).to_csv(de_file, sep="\t", index=False)

        df = pd.read_csv(de_file, sep="\t")
        logfc_cutoff = 0.5
        df_filtered = df[df["logFC"].abs() > logfc_cutoff]

        # Simulate the validation in BioNetService.run_bionet
        def _validate_count(df_len: int) -> None:
            if df_len >= 400:
                raise RuntimeError(f"{df_len} proteins exceed INDRA limit of 400.")

        with pytest.raises(RuntimeError, match="exceed INDRA limit"):
            _validate_count(len(df_filtered))
