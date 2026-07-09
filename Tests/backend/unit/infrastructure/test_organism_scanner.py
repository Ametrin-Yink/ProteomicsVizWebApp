"""Unit tests for organism scanner."""
from pathlib import Path

from app.services.organism_scanner import OrganismScanner


class TestOrganismScanner:
    """Tests for OrganismScanner."""

    def test_scan_returns_empty_list_for_empty_directory(self, tmp_path: Path):
        """scan() returns empty list when directory is empty."""
        scanner = OrganismScanner(tmp_path)
        assert scanner.scan() == []

    def test_scan_excludes_fasta_without_gene_mapping(self, tmp_path: Path):
        """scan() excludes FASTA files that have no matching gene mapping file."""
        (tmp_path / "human.fasta").write_text(">protein\nSEQVENCE")
        scanner = OrganismScanner(tmp_path)
        assert scanner.scan() == []

    def test_scan_includes_organism_v1(self, tmp_path: Path):
        """scan() includes organism when .fasta and _uniprot_gene.tsv exist (v1)."""
        (tmp_path / "human.fasta").write_text(">protein\nSEQVENCE")
        (tmp_path / "human_uniprot_gene.tsv").write_text("gene\tid\n")
        scanner = OrganismScanner(tmp_path)
        result = scanner.scan()
        assert len(result) == 1
        assert result[0] == {"id": "human", "name": "Human"}

    def test_scan_includes_organism_v2(self, tmp_path: Path):
        """scan() includes organism with _Sequence.fasta and _GeneName.tsv (v2)."""
        (tmp_path / "Human_Sequence.fasta").write_text(">protein\nSEQVENCE")
        (tmp_path / "Human_GeneName.tsv").write_text("gene\tid\n")
        scanner = OrganismScanner(tmp_path)
        result = scanner.scan()
        assert len(result) == 1
        assert result[0] == {"id": "human", "name": "Human"}

    def test_scan_returns_sorted_by_name(self, tmp_path: Path):
        """scan() returns organisms sorted by name."""
        for name in ["mouse", "zebrafish", "human"]:
            (tmp_path / f"{name}.fasta").write_text(">protein\nSEQVENCE")
            (tmp_path / f"{name}_uniprot_gene.tsv").write_text("gene\tid\n")
        scanner = OrganismScanner(tmp_path)
        result = scanner.scan()
        names = [org["name"] for org in result]
        assert names == sorted(names)
        # Verify order: Human, Mouse, Zebrafish
        assert names == ["Human", "Mouse", "Zebrafish"]

    def test_organism_exists_returns_true_when_files_exist(self, tmp_path: Path):
        """organism_exists() returns True when both files exist."""
        (tmp_path / "human.fasta").write_text(">protein\nSEQVENCE")
        (tmp_path / "human_uniprot_gene.tsv").write_text("gene\tid\n")
        scanner = OrganismScanner(tmp_path)
        assert scanner.organism_exists("human") is True

    def test_organism_exists_returns_false_when_files_missing(self, tmp_path: Path):
        """organism_exists() returns False when files do not exist."""
        scanner = OrganismScanner(tmp_path)
        assert scanner.organism_exists("nonexistent") is False

    def test_get_organism_path_returns_v2_paths(self, tmp_path: Path):
        """get_organism_path() returns v2 paths for naming convention v2."""
        fasta_path = tmp_path / "Human_Sequence.fasta"
        gene_path = tmp_path / "Human_GeneName.tsv"
        fasta_path.write_text(">protein\nSEQVENCE")
        gene_path.write_text("gene\tid\n")
        scanner = OrganismScanner(tmp_path)
        paths = scanner.get_organism_path("human")
        assert paths["fasta"] == fasta_path
        assert paths["gene_mapping"] == gene_path

    def test_get_organism_path_returns_v1_paths(self, tmp_path: Path):
        """get_organism_path() returns v1 paths as fallback."""
        scanner = OrganismScanner(tmp_path)
        paths = scanner.get_organism_path("human")
        expected_fasta = tmp_path / "human.fasta"
        expected_gene = tmp_path / "human_uniprot_gene.tsv"
        assert paths["fasta"] == expected_fasta
        assert paths["gene_mapping"] == expected_gene
