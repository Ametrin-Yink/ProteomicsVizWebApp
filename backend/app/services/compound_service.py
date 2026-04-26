"""
Compound Service for structure visualization.

Handles compound CSV parsing, SMILES matching to conditions,
and 2D structure image generation using RDKit.
"""

import base64
import io
import logging
from pathlib import Path
from typing import Any, Optional
from dataclasses import dataclass

import pandas as pd
from rdkit import Chem
from rdkit.Chem import Draw, Descriptors, rdMolDescriptors
from rdkit.Chem.rdDepictor import Compute2DCoords

from app.core.exceptions import ValidationError

logger = logging.getLogger("proteomics")


@dataclass
class CompoundData:
    """Compound data structure."""
    corp_id: str
    smiles: str
    condition: Optional[str] = None
    molecular_weight: Optional[float] = None
    formula: Optional[str] = None
    structure_svg: Optional[str] = None
    structure_png: Optional[bytes] = None


class CompoundService:
    """
    Service for compound structure handling.
    
    Parses compound CSV files, matches Corp IDs to conditions,
    and generates 2D molecular structures using RDKit.
    """
    
    def __init__(self):
        """Initialize compound service."""
        self._compound_cache: dict[str, dict[str, CompoundData]] = {}
    
    def parse_compound_csv(self, file_path: Path) -> dict[str, CompoundData]:
        """
        Parse compound CSV file.
        
        Expected format:
        - Corp ID column (various names: 'Corp ID', 'CorpID', 'Compound ID', etc.)
        - SMILES column (various names: 'SMILES', 'Smiles', 'Structure', etc.)
        - Optional: Condition column to map Corp ID to condition name
        
        Args:
            file_path: Path to compound CSV file
            
        Returns:
            Dictionary mapping Corp ID to CompoundData
            
        Raises:
            FileNotFoundError: If file doesn't exist
            ValidationError: If file format is invalid
        """
        if not file_path.exists():
            raise FileNotFoundError(f"Compound file not found: {file_path}")
        
        try:
            df = pd.read_csv(file_path)
        except Exception as e:
            raise ValidationError(
                message=f"Failed to parse compound CSV: {str(e)}",
                details={"file": str(file_path)}
            )
        
        if df.empty:
            raise ValidationError(
                message="Compound CSV file is empty",
                details={"file": str(file_path)}
            )
        
        # Find Corp ID column
        corp_id_col = self._find_column(
            df.columns,
            ['corp id', 'corpid', 'compound id', 'compound_id', 'id', 'name']
        )
        if not corp_id_col:
            raise ValidationError(
                message="Could not find Corp ID column in compound file",
                details={
                    "available_columns": list(df.columns),
                    "expected": ['Corp ID', 'CorpID', 'Compound ID', 'ID', 'Name']
                }
            )
        
        # Find SMILES column
        smiles_col = self._find_column(
            df.columns,
            ['smiles', 'structure', 'mol', 'molecule']
        )
        if not smiles_col:
            raise ValidationError(
                message="Could not find SMILES column in compound file",
                details={
                    "available_columns": list(df.columns),
                    "expected": ['SMILES', 'Structure', 'Mol', 'Molecule']
                }
            )
        
        # Find optional Condition column
        condition_col = self._find_column(
            df.columns,
            ['condition', 'treatment', 'sample', 'group']
        )
        
        compounds = {}
        for _, row in df.iterrows():
            corp_id = str(row[corp_id_col]).strip()
            smiles = str(row[smiles_col]).strip()
            
            if not corp_id or pd.isna(corp_id):
                continue
            
            if not smiles or pd.isna(smiles) or smiles.lower() in ['nan', 'none', '']:
                logger.warning(f"Missing SMILES for Corp ID: {corp_id}")
                continue
            
            condition = None
            if condition_col:
                condition_val = row[condition_col]
                if not pd.isna(condition_val):
                    condition = str(condition_val).strip()
            
            # Calculate molecular properties
            mol = Chem.MolFromSmiles(smiles)
            if mol is None:
                logger.warning(f"Invalid SMILES for Corp ID {corp_id}: {smiles[:50]}...")
                continue
            
            mw = Descriptors.MolWt(mol)
            formula = rdMolDescriptors.CalcMolFormula(mol)
            
            compounds[corp_id] = CompoundData(
                corp_id=corp_id,
                smiles=smiles,
                condition=condition,
                molecular_weight=mw,
                formula=formula
            )
        
        logger.info(f"Parsed {len(compounds)} compounds from {file_path.name}")
        return compounds
    
    def _find_column(self, columns: list[str], possible_names: list[str]) -> Optional[str]:
        """
        Find column name matching any of the possible names (case-insensitive).
        
        Args:
            columns: List of column names
            possible_names: List of possible column names to match
            
        Returns:
            Matching column name or None
        """
        columns_lower = {col.lower().replace('_', ' ').replace('-', ' '): col
                        for col in columns}

        for name in possible_names:
            name_normalized = name.lower().replace('_', ' ').replace('-', ' ')
            if name_normalized in columns_lower:
                return columns_lower[name_normalized]

        return None
    
    def get_compound_for_condition(
        self,
        condition: str,
        compound_file: Path
    ) -> Optional[CompoundData]:
        """
        Get compound data for a specific condition.
        
        Matches condition name to Corp ID either by:
        1. Direct condition column match in CSV
        2. Condition name matching Corp ID
        
        Args:
            condition: Condition name to match
            compound_file: Path to compound CSV file
            
        Returns:
            CompoundData if found, None otherwise
        """
        # Parse compounds
        cache_key = str(compound_file)
        if cache_key not in self._compound_cache:
            self._compound_cache[cache_key] = self.parse_compound_csv(compound_file)
        
        compounds = self._compound_cache[cache_key]
        
        # Try to find by condition first
        for corp_id, compound in compounds.items():
            if compound.condition and compound.condition.lower() == condition.lower():
                return compound
        
        # Try direct Corp ID match
        if condition in compounds:
            return compounds[condition]
        
        # Try case-insensitive match
        condition_lower = condition.lower()
        for corp_id, compound in compounds.items():
            if corp_id.lower() == condition_lower:
                return compound
        
        logger.warning(f"No compound found for condition: {condition}")
        return None
    
    def generate_structure_image(
        self,
        smiles: str,
        format: str = 'svg',
        width: int = 300,
        height: int = 300
    ) -> Optional[str | bytes]:
        """
        Generate 2D structure image from SMILES.
        
        Args:
            smiles: SMILES string
            format: Output format ('svg' or 'png')
            width: Image width in pixels
            height: Image height in pixels
            
        Returns:
            SVG string or PNG bytes, or None if SMILES is invalid
        """
        mol = Chem.MolFromSmiles(smiles)
        if mol is None:
            logger.warning(f"Invalid SMILES: {smiles[:50]}...")
            return None
        
        # Compute 2D coordinates
        Compute2DCoords(mol)
        
        try:
            if format.lower() == 'svg':
                # Generate SVG
                svg = Draw.MolToSVG(mol, size=(width, height))
                return svg
            else:
                # Generate PNG
                img = Draw.MolToImage(mol, size=(width, height))
                
                # Convert to bytes
                img_bytes = io.BytesIO()
                img.save(img_bytes, format='PNG')
                return img_bytes.getvalue()
                
        except Exception as e:
            logger.error(f"Failed to generate structure image: {e}")
            return None
    
    def get_compound_with_structure(
        self,
        condition: str,
        compound_file: Path,
        format: str = 'svg'
    ) -> Optional[dict[str, Any]]:
        """
        Get compound data with generated structure image.
        
        Args:
            condition: Condition name
            compound_file: Path to compound CSV
            format: Image format ('svg' or 'png')
            
        Returns:
            Dictionary with compound info and structure image, or None
        """
        compound = self.get_compound_for_condition(condition, compound_file)
        if compound is None:
            return None
        
        # Generate structure image
        structure_image = self.generate_structure_image(
            compound.smiles,
            format=format
        )
        
        result = {
            "corp_id": compound.corp_id,
            "smiles": compound.smiles,
            "molecular_weight": compound.molecular_weight,
            "formula": compound.formula,
            "condition": compound.condition,
        }
        
        if format.lower() == 'svg':
            result["structure_svg"] = structure_image
        else:
            if structure_image:
                result["structure_png_base64"] = base64.b64encode(structure_image).decode('utf-8')
            else:
                result["structure_png_base64"] = None
        
        return result
    
    def get_all_compounds(
        self,
        compound_file: Path,
        include_structures: bool = False,
        format: str = 'svg'
    ) -> list[dict[str, Any]]:
        """
        Get all compounds from file.
        
        Args:
            compound_file: Path to compound CSV
            include_structures: Whether to include structure images
            format: Image format if including structures
            
        Returns:
            List of compound dictionaries
        """
        compounds = self.parse_compound_csv(compound_file)
        
        results = []
        for corp_id, compound in compounds.items():
            entry = {
                "corp_id": compound.corp_id,
                "smiles": compound.smiles,
                "molecular_weight": compound.molecular_weight,
                "formula": compound.formula,
                "condition": compound.condition,
            }
            
            if include_structures:
                structure_image = self.generate_structure_image(
                    compound.smiles,
                    format=format
                )
                
                if format.lower() == 'svg':
                    entry["structure_svg"] = structure_image
                else:
                    if structure_image:
                        entry["structure_png_base64"] = base64.b64encode(structure_image).decode('utf-8')
                    else:
                        entry["structure_png_base64"] = None
            
            results.append(entry)
        
        return results
    
    def validate_smiles(self, smiles: str) -> bool:
        """
        Validate SMILES string.
        
        Args:
            smiles: SMILES string to validate
            
        Returns:
            True if valid, False otherwise
        """
        mol = Chem.MolFromSmiles(smiles)
        return mol is not None
    
    def get_molecular_properties(self, smiles: str) -> Optional[dict[str, Any]]:
        """
        Calculate molecular properties from SMILES.
        
        Args:
            smiles: SMILES string
            
        Returns:
            Dictionary with molecular properties or None if invalid
        """
        mol = Chem.MolFromSmiles(smiles)
        if mol is None:
            return None
        
        return {
            "molecular_weight": Descriptors.MolWt(mol),
            "formula": rdMolDescriptors.CalcMolFormula(mol),
            "num_atoms": mol.GetNumAtoms(),
            "num_bonds": mol.GetNumBonds(),
            "num_heavy_atoms": mol.GetNumHeavyAtoms(),
            "logp": Descriptors.MolLogP(mol),
            "tpsa": Descriptors.TPSA(mol),
            "num_h_donors": Descriptors.NumHDonors(mol),
            "num_h_acceptors": Descriptors.NumHAcceptors(mol),
            "num_rotatable_bonds": Descriptors.NumRotatableBonds(mol),
        }
    
    def clear_cache(self) -> None:
        """Clear the compound cache."""
        self._compound_cache.clear()
        logger.info("Compound cache cleared")


# Global compound service instance
compound_service = CompoundService()
