"""Unit tests for BioNet service."""

import json
from pathlib import Path

import pandas as pd
import pytest


class TestBioNetService:
    def test_config_serialization(self):
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
        assert len(df_filtered) == 1
        assert df_filtered.iloc[0]["Master_Protein_Accessions"] == "P1"

    def test_over_400_proteins_raises(self, tmp_path: Path):
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

        def _validate_count(df_len: int) -> None:
            if df_len >= 400:
                raise RuntimeError(f"{df_len} proteins exceed INDRA limit of 400.")

        with pytest.raises(RuntimeError, match="exceed INDRA limit"):
            _validate_count(len(df_filtered))


# ── Real BioNetService.run_bionet with mocked R ─────────────────────────


class TestBioNetServiceRun:
    def test_no_logfc_column_skips_filter(self, tmp_path):
        """DE file without logFC column should skip pre-filter."""
        from unittest.mock import patch
        from app.services.bionet_service import BioNetService

        de_file = tmp_path / "test.tsv"
        pd.DataFrame({
            "Master_Protein_Accessions": ["P1", "P2"],
            "Gene_Name": ["G1", "G2"],
        }).to_csv(de_file, sep="\t", index=False)

        nodes_csv = tmp_path / "nodes.csv"
        edges_csv = tmp_path / "edges.csv"
        pd.DataFrame({"id": ["n1"]}).to_csv(nodes_csv, index=False)
        pd.DataFrame({"source": ["n1"], "target": ["n2"]}).to_csv(edges_csv, index=False)

        svc = BioNetService()

        with patch("subprocess.run") as mock_run:
            mock_run.return_value.returncode = 0
            mock_run.return_value.stdout = ""
            nodes, edges = svc.run_bionet(
                de_file, {}, nodes_csv, edges_csv
            )
            assert isinstance(nodes, int)
            assert isinstance(edges, int)

    def test_zero_proteins_after_filter_raises(self, tmp_path):
        from app.services.bionet_service import BioNetService

        de_file = tmp_path / "test.tsv"
        pd.DataFrame({
            "Master_Protein_Accessions": ["P1"],
            "Gene_Name": ["G1"],
            "logFC": [0.1],  # below default cutoff of 0.5
        }).to_csv(de_file, sep="\t", index=False)

        svc = BioNetService()
        with pytest.raises(RuntimeError, match="No proteins pass"):
            svc.run_bionet(
                de_file, {}, tmp_path / "nodes.csv", tmp_path / "edges.csv"
            )

    def test_over_400_raises(self, tmp_path):
        from app.services.bionet_service import BioNetService

        de_file = tmp_path / "test.tsv"
        rows = [{"Master_Protein_Accessions": f"P{i}",
                 "Gene_Name": f"G{i}", "logFC": 2.0}
                for i in range(400)]
        pd.DataFrame(rows).to_csv(de_file, sep="\t", index=False)

        svc = BioNetService()
        with pytest.raises(RuntimeError, match="exceed INDRA limit"):
            svc.run_bionet(
                de_file, {}, tmp_path / "nodes.csv", tmp_path / "edges.csv"
            )

    def test_init_uses_settings_executable(self):
        from app.services.bionet_service import BioNetService
        from app.core.config import settings
        svc = BioNetService()
        assert svc._rscript == (settings.r_executable or "Rscript")
