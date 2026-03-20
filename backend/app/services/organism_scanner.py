"""
Organism scanner for protein database.

Scans the protein database directory for available organisms.
"""

from pathlib import Path
from typing import List, Dict


class OrganismScanner:
    """Scans protein database for available organisms."""
    
    def __init__(self, protein_database_dir: Path):
        self.protein_database_dir = Path(protein_database_dir)
    
    def scan(self) -> List[Dict[str, str]]:
        """
        Scan for available organisms.
        
        An organism is valid if it has both:
        - {organism}.fasta or {organism}_Sequence.fasta
        - {organism}_uniprot_gene.tsv or {organism}_GeneName.tsv
        
        Returns:
            List of organism dictionaries with id and name
        """
        organisms = []
        
        if not self.protein_database_dir.exists():
            return organisms
        
        # Find all .fasta files (support both naming conventions)
        fasta_files = list(self.protein_database_dir.glob("*.fasta"))
        
        for fasta_file in fasta_files:
            # Handle both naming conventions:
            # 1. {organism}.fasta (e.g., human.fasta)
            # 2. {organism}_Sequence.fasta (e.g., Human_Sequence.fasta)
            
            filename = fasta_file.stem  # e.g., "human" or "Human_Sequence"
            
            # Check for _Sequence suffix
            if filename.endswith("_Sequence"):
                organism_id = filename[:-9].lower()  # Remove _Sequence and lowercase
                organism_name = filename[:-9]  # Keep original case for display
            else:
                organism_id = filename.lower()
                organism_name = filename.capitalize()
            
            # Check for gene mapping file (both naming conventions)
            # 1. {organism}_uniprot_gene.tsv
            # 2. {organism}_GeneName.tsv
            gene_mapping_file_v1 = self.protein_database_dir / f"{organism_id}_uniprot_gene.tsv"
            gene_mapping_file_v2 = self.protein_database_dir / f"{organism_name}_GeneName.tsv"
            
            # Check if gene mapping file exists (either format)
            if gene_mapping_file_v1.exists() or gene_mapping_file_v2.exists():
                organisms.append({
                    "id": organism_id,
                    "name": organism_name
                })
        
        # Sort by name
        organisms.sort(key=lambda x: x["name"])
        
        return organisms
    
    def get_organism_path(self, organism_id: str) -> Dict[str, Path]:
        """
        Get paths for an organism.
        
        Args:
            organism_id: Organism identifier
            
        Returns:
            Dictionary with fasta and gene_mapping paths
        """
        # Try both naming conventions
        organism_capitalized = organism_id.capitalize()
        
        # Check for {organism}_Sequence.fasta format first
        fasta_v2 = self.protein_database_dir / f"{organism_capitalized}_Sequence.fasta"
        gene_v2 = self.protein_database_dir / f"{organism_capitalized}_GeneName.tsv"
        
        if fasta_v2.exists() and gene_v2.exists():
            return {
                "fasta": fasta_v2,
                "gene_mapping": gene_v2
            }
        
        # Fall back to original naming convention
        return {
            "fasta": self.protein_database_dir / f"{organism_id}.fasta",
            "gene_mapping": self.protein_database_dir / f"{organism_id}_uniprot_gene.tsv"
        }
    
    def organism_exists(self, organism_id: str) -> bool:
        """
        Check if an organism exists in the database.
        
        Args:
            organism_id: Organism identifier
            
        Returns:
            True if organism exists
        """
        # Check both naming conventions
        organism_capitalized = organism_id.capitalize()
        
        # New naming convention: {Organism}_Sequence.fasta and {Organism}_GeneName.tsv
        fasta_v2 = self.protein_database_dir / f"{organism_capitalized}_Sequence.fasta"
        gene_v2 = self.protein_database_dir / f"{organism_capitalized}_GeneName.tsv"
        
        if fasta_v2.exists() and gene_v2.exists():
            return True
        
        # Original naming convention: {organism}.fasta and {organism}_uniprot_gene.tsv
        paths = self.get_organism_path(organism_id)
        return paths["fasta"].exists() and paths["gene_mapping"].exists()
