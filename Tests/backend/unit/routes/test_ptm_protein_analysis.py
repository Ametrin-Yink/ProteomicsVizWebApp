"""Tests for the PTM optional-protein downstream analysis adapter."""

import asyncio
from datetime import UTC, datetime

import pandas as pd
import pytest
from app.api.routes.visualization import _resolve_protein_analysis_file
from app.core.config import settings
from app.models.session import (
    ProteomicsFileInfo,
    Session,
    SessionConfig,
    SessionFiles,
)
from fastapi import HTTPException


def _ptm_session(*, with_protein: bool) -> Session:
    protein_files = []
    if with_protein:
        protein_files.append(
            ProteomicsFileInfo(
                filename="protein_psms.txt",
                size=1,
                uploaded_at=datetime.now(UTC),
            )
        )
    return Session(
        id="550e8400-e29b-41d4-a716-446655440000",
        name="PTM",
        pipeline="ptm",
        config=SessionConfig(ptm_fasta_source="human"),
        files=SessionFiles(global_proteome=protein_files),
    )


def test_builds_protein_analysis_table_for_requested_comparison(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "protein_database_dir", tmp_path)
    (tmp_path / "Human_Sequence.fasta").write_text(
        ">sp|P1|PROTEIN_ONE GN=GENE1\nMPEPTIDE\n"
        ">sp|P2|PROTEIN_TWO GN=GENE2\nMPEPTIDE\n",
        encoding="utf-8",
    )
    results_dir = tmp_path / "results"
    results_dir.mkdir()
    pd.DataFrame(
        {
            "Protein": ["P1", "P2"],
            "ProteinAccession": ["P1", "P2"],
            "Comparison": ["Drug_vs_DMSO", "Other_vs_DMSO"],
            "log2FC": [1.2, -0.4],
            "pvalue": [0.01, 0.2],
            "adj.pvalue": [0.02, 0.3],
        }
    ).to_csv(results_dir / "protein_results.tsv", sep="\t", index=False)

    output_path = asyncio.run(
        _resolve_protein_analysis_file(
            _ptm_session(with_protein=True),
            "550e8400-e29b-41d4-a716-446655440000",
            results_dir,
            "Drug_vs_DMSO",
        )
    )

    output = pd.read_csv(output_path, sep="\t")
    assert output["Master_Protein_Accessions"].tolist() == ["P1"]
    assert output["Gene_Name"].tolist() == ["GENE1"]
    assert output["logFC"].tolist() == [1.2]
    assert output["pval"].tolist() == [0.01]
    assert output["adjPval"].tolist() == [0.02]


def test_rejects_ptm_protein_analysis_without_optional_protein(tmp_path):
    with pytest.raises(HTTPException) as error:
        asyncio.run(
            _resolve_protein_analysis_file(
                _ptm_session(with_protein=False),
                "550e8400-e29b-41d4-a716-446655440000",
                tmp_path,
                "Drug_vs_DMSO",
            )
        )

    assert error.value.status_code == 400
