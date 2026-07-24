"""Tests for AbundanceRepository — cursor pagination, summary, detail, heatmap."""

import json

import pandas as pd
import pytest

duckdb = pytest.importorskip("duckdb")
from app.services.abundance_repository import (  # noqa: E402
    AbundanceRepository,
    _decode_cursor,
    _encode_cursor,
)

# ── Cursor helpers ─────────────────────────────────────────────────────


class TestCursorRoundTrip:
    def test_round_trips_zero(self):
        assert _decode_cursor(_encode_cursor(0)) == 0

    def test_round_trips_small(self):
        assert _decode_cursor(_encode_cursor(42)) == 42

    def test_round_trips_large(self):
        assert _decode_cursor(_encode_cursor(999_999)) == 999_999

    def test_decode_none_returns_zero(self):
        assert _decode_cursor(None) == 0

    def test_decode_empty_returns_zero(self):
        assert _decode_cursor("") == 0

    def test_decode_invalid_raises(self):
        with pytest.raises(ValueError, match="Invalid cursor"):
            _decode_cursor("!!not-base64!!")

    def test_decode_negative_raises(self):
        """Decoding a cursor that encodes a negative int must raise ValueError."""
        with pytest.raises(ValueError, match="Invalid cursor"):
            _decode_cursor(_encode_cursor(-5))

    def test_output_is_urlsafe(self):
        encoded = _encode_cursor(12345)
        assert "+" not in encoded
        assert "/" not in encoded
        assert "=" not in encoded  # stripped padding


# ── Shared test data helpers ───────────────────────────────────────────


def _make_manifest(results_dir):
    """Write a valid visualization_artifacts.json manifest."""
    manifest = {
        "schema_version": 1,
        "pipeline": "msqrob2",
        "normalization_method": "center.median",
        "imputation_method": "none",
        "abundance_scale": "log2",
        "artifacts": {
            "protein_abundance": "protein_abundance_long.parquet",
            "peptide_abundance": "peptide_abundance_long.parquet",
            "samples": "sample_catalog.parquet",
            "comparisons": "comparison_catalog.parquet",
            "differential_results": "differential_results.parquet",
        },
    }
    (results_dir / "visualization_artifacts.json").write_text(
        json.dumps(manifest), encoding="utf-8"
    )
    return manifest


def _make_comparison_catalog(results_dir):
    pd.DataFrame(
        {
            "comparison_id": ["A_vs_B", "C_vs_D"],
            "group1_label": ["A", "C"],
            "group2_label": ["B", "D"],
            "comparison_order": [0, 1],
        }
    ).to_parquet(results_dir / "comparison_catalog.parquet", index=False)


def _make_sample_catalog(results_dir):
    pd.DataFrame(
        {
            "sample_id": ["A_1", "A_2", "B_1", "B_2"],
            "condition": ["A", "A", "B", "B"],
            "replicate": [1, 2, 1, 2],
            "sample_order": [0, 1, 2, 3],
        }
    ).to_parquet(results_dir / "sample_catalog.parquet", index=False)


def _make_protein_abundance(results_dir):
    pd.DataFrame(
        {
            "protein_accession": ["P1", "P1", "P1", "P1", "P2", "P2"],
            "gene_name": ["GENE1", "GENE1", "GENE1", "GENE1", "GENE2", "GENE2"],
            "condition": ["A", "A", "B", "B", "A", "B"],
            "condition_order": [0, 0, 1, 1, 0, 1],
            "sample_id": ["A_1", "A_2", "B_1", "B_2", "A_1", "B_1"],
            "sample_order": [0, 1, 2, 3, 0, 2],
            "replicate": [1, 2, 1, 2, 1, 1],
            "batch": [None, None, None, None, None, None],
            "processed_log2_abundance": [10.0, 12.0, 8.0, 9.0, 15.0, 7.0],
            "provenance": [
                "observed", "observed", "observed", "imputed",
                "observed", "observed",
            ],
            "result_layer": ["protein"] * 6,
        }
    ).to_parquet(results_dir / "protein_abundance_long.parquet", index=False)


def _make_peptide_abundance(results_dir):
    pd.DataFrame(
        {
            "protein_accession": ["P1", "P1"],
            "gene_name": ["GENE1", "GENE1"],
            "peptide_id": ["PEP_A", "PEP_A"],
            "condition": ["A", "A"],
            "condition_order": [0, 0],
            "sample_id": ["A_1", "A_2"],
            "sample_order": [0, 1],
            "replicate": [1, 2],
            "batch": [None, None],
            "processed_log2_abundance": [10.0, 12.0],
            "provenance": ["observed", "observed"],
            "result_layer": ["protein"] * 2,
        }
    ).to_parquet(results_dir / "peptide_abundance_long.parquet", index=False)


def _make_differential_results(results_dir):
    pd.DataFrame(
        {
            "comparison_id": ["A_vs_B"],
            "protein_accession": ["P1"],
            "gene_name": ["GENE1"],
            "log2_fold_change": [2.0],
            "p_value": [0.01],
            "adjusted_p_value": [0.02],
            "standard_error": [0.1],
            "statistic": [5.0],
            "result_layer": ["protein"],
            "pipeline": ["msqrob2"],
        }
    ).to_parquet(results_dir / "differential_results.parquet", index=False)


def _setup_results_dir(tmp_path):
    """Create a fully-populated results_dir with all required artifacts."""
    results_dir = tmp_path / "results"
    results_dir.mkdir()
    _make_manifest(results_dir)
    _make_comparison_catalog(results_dir)
    _make_sample_catalog(results_dir)
    _make_protein_abundance(results_dir)
    _make_peptide_abundance(results_dir)
    _make_differential_results(results_dir)
    return results_dir


# ── Repository initialization ──────────────────────────────────────────


class TestAbundanceRepositoryInit:
    def test_init_with_valid_manifest(self, tmp_path):
        results_dir = _setup_results_dir(tmp_path)
        repo = AbundanceRepository(results_dir)
        assert repo.manifest is not None
        assert repo.manifest["pipeline"] == "msqrob2"

    def test_init_missing_manifest_raises(self, tmp_path):
        results_dir = tmp_path / "results"
        results_dir.mkdir()
        with pytest.raises(ValueError, match="reprocessing"):
            AbundanceRepository(results_dir)

    def test_init_corrupt_manifest_raises(self, tmp_path):
        results_dir = tmp_path / "results"
        results_dir.mkdir()
        (results_dir / "visualization_artifacts.json").write_text(
            "{not valid json", encoding="utf-8"
        )
        with pytest.raises(ValueError, match="reprocessing"):
            AbundanceRepository(results_dir)


# ── Comparison queries ─────────────────────────────────────────────────


class TestComparisonQueries:
    def test_first_comparison_id(self, tmp_path):
        repo = AbundanceRepository(_setup_results_dir(tmp_path))
        assert repo.first_comparison_id() == "A_vs_B"

    def test_first_comparison_id_empty_catalog(self, tmp_path):
        results_dir = tmp_path / "results"
        results_dir.mkdir()
        _make_manifest(results_dir)
        pd.DataFrame(
            columns=["comparison_id", "group1_label", "group2_label", "comparison_order"]
        ).to_parquet(results_dir / "comparison_catalog.parquet", index=False)
        # Need other required artifacts
        _make_sample_catalog(results_dir)
        _make_protein_abundance(results_dir)
        _make_peptide_abundance(results_dir)
        _make_differential_results(results_dir)

        with pytest.raises(ValueError, match="No comparisons"):
            AbundanceRepository(results_dir).first_comparison_id()

    def test_comparison_conditions_known(self, tmp_path):
        repo = AbundanceRepository(_setup_results_dir(tmp_path))
        import duckdb as db
        conn = db.connect()
        try:
            conditions = repo._comparison_conditions(conn, "A_vs_B")
            assert conditions == ["A", "B"]
        finally:
            conn.close()

    def test_comparison_conditions_unknown(self, tmp_path):
        repo = AbundanceRepository(_setup_results_dir(tmp_path))
        import duckdb as db
        conn = db.connect()
        try:
            with pytest.raises(ValueError, match="Unknown comparison"):
                repo._comparison_conditions(conn, "nonexistent")
        finally:
            conn.close()


# ── get_summary ────────────────────────────────────────────────────────


class TestGetSummary:
    def test_rejects_negative_point_budget(self, tmp_path):
        repo = AbundanceRepository(_setup_results_dir(tmp_path))
        with pytest.raises(ValueError, match="point_budget"):
            repo.get_summary(
                entity="protein",
                protein_accession="P1",
                comparison_id="A_vs_B",
                point_budget=-1,
            )

    def test_returns_group_stats(self, tmp_path):
        repo = AbundanceRepository(_setup_results_dir(tmp_path))
        summary = repo.get_summary(
            entity="protein",
            protein_accession="P1",
            comparison_id="A_vs_B",
            point_budget=0,
        )
        assert summary["protein_accession"] == "P1"
        assert summary["comparison_id"] == "A_vs_B"
        assert summary["scale"] == "log2"
        assert summary["points_truncated"] is True
        assert summary["point_count"] > 0
        groups = {g["condition"]: g for g in summary["groups"]}
        assert "A" in groups
        assert "B" in groups
        # Check group stats exist
        for key in ("median", "q1", "q3", "lower_fence", "upper_fence",
                     "observed_count", "imputed_count"):
            assert key in groups["A"], f"Missing {key}"

    def test_returns_points_when_under_budget(self, tmp_path):
        repo = AbundanceRepository(_setup_results_dir(tmp_path))
        summary = repo.get_summary(
            entity="protein",
            protein_accession="P1",
            comparison_id="A_vs_B",
            point_budget=100_000,
        )
        assert summary["points_truncated"] is False
        assert len(summary["points"]) == summary["point_count"]

    def test_peptide_entity_includes_peptide_id(self, tmp_path):
        repo = AbundanceRepository(_setup_results_dir(tmp_path))
        summary = repo.get_summary(
            entity="peptide",
            protein_accession="P1",
            comparison_id="A_vs_B",
            point_budget=100_000,
        )
        assert summary["points_truncated"] is False
        if summary["points"]:
            assert "peptide_id" in summary["points"][0]

    def test_unknown_protein_returns_empty(self, tmp_path):
        repo = AbundanceRepository(_setup_results_dir(tmp_path))
        summary = repo.get_summary(
            entity="protein",
            protein_accession="Z999",
            comparison_id="A_vs_B",
        )
        assert summary["point_count"] == 0
        assert summary["groups"] == []
        assert summary["points"] == []


# ── get_detail ─────────────────────────────────────────────────────────


class TestGetDetail:
    def test_rejects_invalid_limit(self, tmp_path):
        repo = AbundanceRepository(_setup_results_dir(tmp_path))
        with pytest.raises(ValueError, match="limit"):
            repo.get_detail(
                entity="protein",
                protein_accession="P1",
                comparison_id="A_vs_B",
                cursor=None,
                limit=0,
            )
        with pytest.raises(ValueError, match="limit"):
            repo.get_detail(
                entity="protein",
                protein_accession="P1",
                comparison_id="A_vs_B",
                cursor=None,
                limit=10001,
            )

    def test_first_page(self, tmp_path):
        repo = AbundanceRepository(_setup_results_dir(tmp_path))
        result = repo.get_detail(
            entity="protein",
            protein_accession="P1",
            comparison_id="A_vs_B",
            cursor=None,
            limit=3,
        )
        assert len(result["items"]) == 3
        assert result["next_cursor"] is not None  # P1 has 4 rows, limit 3

    def test_last_page_has_no_next_cursor(self, tmp_path):
        repo = AbundanceRepository(_setup_results_dir(tmp_path))
        result = repo.get_detail(
            entity="protein",
            protein_accession="P1",
            comparison_id="A_vs_B",
            cursor=None,
            limit=100,
        )
        assert result["next_cursor"] is None

    def test_cursor_continuation(self, tmp_path):
        repo = AbundanceRepository(_setup_results_dir(tmp_path))
        page1 = repo.get_detail(
            entity="protein",
            protein_accession="P1",
            comparison_id="A_vs_B",
            cursor=None,
            limit=2,
        )
        assert page1["next_cursor"] is not None
        page2 = repo.get_detail(
            entity="protein",
            protein_accession="P1",
            comparison_id="A_vs_B",
            cursor=page1["next_cursor"],
            limit=2,
        )
        assert len(page2["items"]) <= 2
        # All items in page2 should be different from page1
        p1_ids = {i["sample_id"] for i in page1["items"]}
        p2_ids = {i["sample_id"] for i in page2["items"]}
        assert p1_ids.isdisjoint(p2_ids)

    def test_invalid_cursor_raises(self, tmp_path):
        repo = AbundanceRepository(_setup_results_dir(tmp_path))
        with pytest.raises(ValueError, match="Invalid cursor"):
            repo.get_detail(
                entity="protein",
                protein_accession="P1",
                comparison_id="A_vs_B",
                cursor="!!invalid!!",
                limit=10,
            )

    def test_empty_result(self, tmp_path):
        repo = AbundanceRepository(_setup_results_dir(tmp_path))
        result = repo.get_detail(
            entity="protein",
            protein_accession="Z999",
            comparison_id="A_vs_B",
            cursor=None,
            limit=10,
        )
        assert result["items"] == []
        assert result["next_cursor"] is None


# ── get_gene_heatmap ───────────────────────────────────────────────────


class TestGetGeneHeatmap:
    def test_returns_structure_for_valid_genes(self, tmp_path):
        repo = AbundanceRepository(_setup_results_dir(tmp_path))
        result = repo.get_gene_heatmap(
            genes=["GENE1", "GENE2"],
            comparison_id="A_vs_B",
        )
        assert "genes" in result
        assert "samples" in result
        assert "z_scores" in result
        assert "log2_abundances" in result
        assert "conditions" in result

    def test_empty_gene_list(self, tmp_path):
        repo = AbundanceRepository(_setup_results_dir(tmp_path))
        result = repo.get_gene_heatmap(genes=[], comparison_id="A_vs_B")
        assert result["genes"] == []
        assert result["z_scores"] == []

    def test_deduplicates_and_caps_at_50(self, tmp_path):
        repo = AbundanceRepository(_setup_results_dir(tmp_path))
        many_genes = ["GENE1"] * 60
        result = repo.get_gene_heatmap(
            genes=many_genes, comparison_id="A_vs_B"
        )
        assert len(result["genes"]) <= 1  # only unique: GENE1

    def test_unknown_genes_return_empty(self, tmp_path):
        repo = AbundanceRepository(_setup_results_dir(tmp_path))
        result = repo.get_gene_heatmap(
            genes=["NONEXISTENT"], comparison_id="A_vs_B"
        )
        assert result["genes"] == []
        assert result["z_scores"] == []

    def test_whitespace_gene_names_skipped(self, tmp_path):
        repo = AbundanceRepository(_setup_results_dir(tmp_path))
        result = repo.get_gene_heatmap(
            genes=["   ", "GENE1"], comparison_id="A_vs_B"
        )
        assert result["genes"] == ["GENE1"]

    def test_semicolon_multi_gene_tokens(self, tmp_path):
        """Genes with semicolon-delimited names should be tokenized."""
        results_dir = _setup_results_dir(tmp_path)
        # Add a row with semicolon gene name
        df = pd.read_parquet(results_dir / "protein_abundance_long.parquet")
        extra = df.iloc[[0]].copy()
        extra["protein_accession"] = "P3"
        extra["gene_name"] = "GENE3;ALIAS"
        combined = pd.concat([df, extra], ignore_index=True)
        combined.to_parquet(
            results_dir / "protein_abundance_long.parquet", index=False
        )
        repo = AbundanceRepository(results_dir)
        result = repo.get_gene_heatmap(
            genes=["ALIAS"], comparison_id="A_vs_B"
        )
        assert "ALIAS" in result["genes"]


# ── _accession_predicate ───────────────────────────────────────────────


class TestAccessionPredicate:
    def test_matches_exact_accession(self, tmp_path):
        results_dir = _setup_results_dir(tmp_path)
        repo = AbundanceRepository(results_dir)
        predicate = repo._accession_predicate()
        assert "protein_accession" in predicate
        assert "list_contains" in predicate

    def test_predicate_is_static(self):
        pred1 = AbundanceRepository._accession_predicate()
        pred2 = AbundanceRepository._accession_predicate()
        assert pred1 == pred2
