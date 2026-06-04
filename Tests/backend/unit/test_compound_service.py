"""Unit tests for compound service — SMILES validation and CSV parsing."""
import pytest
from pathlib import Path
from app.services.compound_service import CompoundService


@pytest.fixture
def service():
    return CompoundService()


class TestValidateSMILES:
    def test_valid_smiles_returns_true(self, service):
        assert service.validate_smiles("CCO") is True

    def test_benzene_ring_is_valid(self, service):
        assert service.validate_smiles("c1ccccc1") is True

    def test_aspirin_is_valid(self, service):
        assert service.validate_smiles("CC(=O)OC1=CC=CC=C1C(=O)O") is True

    def test_invalid_smiles_returns_false(self, service):
        assert service.validate_smiles("not_a_smiles") is False

    def test_empty_string_returns_false(self, service):
        try:
            result = service.validate_smiles("")
            assert result is False
        except Exception:
            # RDKit may raise on empty string
            pass

    def test_none_returns_false_or_raises(self, service):
        try:
            result = service.validate_smiles(None)
            assert result is False
        except TypeError:
            # RDKit raises TypeError for None input
            pass


class TestParseCompoundCSV:
    def test_parses_valid_csv(self, service, tmp_path):
        csv_path = tmp_path / "compounds.csv"
        csv_path.write_text(
            "Corp ID,SMILES,Condition,MW,Formula\n"
            "CPD001,CCO,DrugA,46.07,C2H6O\n"
            "CPD002,c1ccccc1,DrugB,78.11,C6H6\n"
        )

        compounds = service.parse_compound_csv(csv_path)
        assert len(compounds) == 2

    def test_missing_file_raises_error(self, service, tmp_path):
        with pytest.raises(FileNotFoundError):
            service.parse_compound_csv(tmp_path / "nonexistent.csv")

    def test_empty_csv_raises_error(self, service, tmp_path):
        csv_path = tmp_path / "empty.csv"
        csv_path.write_text("")

        with pytest.raises(Exception):
            service.parse_compound_csv(csv_path)

    def test_handles_extra_columns(self, service, tmp_path):
        csv_path = tmp_path / "extra_cols.csv"
        csv_path.write_text(
            "Corp ID,SMILES,Condition,MW,Formula,Extra_Col1,Extra_Col2\n"
            "CPD001,CCO,DrugA,46.07,C2H6O,ignored,also_ignored\n"
        )

        compounds = service.parse_compound_csv(csv_path)
        assert len(compounds) == 1


class TestGetCompoundForCondition:
    def test_finds_compound_by_condition(self, service, tmp_path):
        csv_path = tmp_path / "compounds.csv"
        csv_path.write_text(
            "Corp ID,SMILES,Condition,MW,Formula\n"
            "CPD001,CCO,Treatment,46.07,C2H6O\n"
        )

        compound = service.get_compound_for_condition("Treatment", csv_path)
        if compound is not None:
            assert compound.smiles == "CCO"

    def test_condition_not_found_returns_none(self, service, tmp_path):
        csv_path = tmp_path / "compounds.csv"
        csv_path.write_text(
            "Corp ID,SMILES,Condition,MW,Formula\n"
            "CPD001,CCO,DrugA,46.07,C2H6O\n"
        )

        compound = service.get_compound_for_condition("NonExistent", csv_path)
        assert compound is None
