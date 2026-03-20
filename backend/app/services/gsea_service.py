"""
GSEA analysis service (Step 9).

Performs Gene Set Enrichment Analysis using gseapy.
"""

import logging
from pathlib import Path
from typing import Optional

import pandas as pd
import numpy as np
import gseapy as gp

from app.core.exceptions import ProcessingError
from app.models.data import GSEAResults, GSEAResult
from app.models.analysis import DatabaseType, DATABASE_NAMES

logger = logging.getLogger("proteomics")


class GSEAService:
    """
    GSEA analysis service.
    
    Implements step 9 of the pipeline: GSEA analysis on multiple databases.
    """
    
    def __init__(self):
        """Initialize GSEA service."""
        self.results: dict[str, GSEAResults] = {}
    
    async def run_gsea_analysis(
        self,
        diff_expression_path: Path,
        output_dir: Path,
        databases: Optional[list[DatabaseType]] = None
    ) -> dict[str, GSEAResults]:
        """
        Run GSEA analysis on all databases.
        
        Args:
            diff_expression_path: Path to Diff_Expression.tsv
            output_dir: Directory for GSEA output
            databases: List of databases to analyze (defaults to all)
            
        Returns:
            Dictionary mapping database name to GSEAResults
        """
        logger.info("Step 9: Running GSEA analysis")
        
        # Load differential expression data
        diff_df = pd.read_csv(diff_expression_path, sep='\t')
        
        # Prepare ranked list
        rnk = self._prepare_ranked_list(diff_df)
        
        if rnk is None or len(rnk) == 0:
            logger.warning("No valid data for GSEA analysis")
            return {}
        
        # Create output directory
        output_dir.mkdir(parents=True, exist_ok=True)
        
        # Determine databases to analyze
        if databases is None:
            databases = list(DatabaseType)
        
        # Run GSEA for each database
        self.results = {}
        
        for db_type in databases:
            db_name = DATABASE_NAMES.get(db_type, db_type.value)
            
            try:
                logger.info(f"Running GSEA for {db_name}")
                
                result = await self._run_single_gsea(
                    rnk=rnk,
                    gene_set=db_name,
                    output_dir=output_dir / db_type.value
                )
                
                self.results[db_type.value] = result
                
                logger.info(
                    f"GSEA complete for {db_name}: "
                    f"{result.significant_pathways} significant pathways"
                )
                
            except Exception as e:
                logger.error(f"GSEA failed for {db_name}: {e}")
                # Continue with other databases
                self.results[db_type.value] = GSEAResults(
                    database=db_name,
                    total_pathways=0,
                    significant_pathways=0,
                    overrepresented=0,
                    underrepresented=0,
                    results=[]
                )
        
        logger.info("Step 9 complete: GSEA analysis finished")
        
        return self.results
    
    def _prepare_ranked_list(self, diff_df: pd.DataFrame) -> Optional[pd.DataFrame]:
        """
        Prepare ranked gene list for GSEA.
        
        Ranking metric: -log10(p-value) * sign(logFC)
        
        Args:
            diff_df: Differential expression DataFrame
            
        Returns:
            Ranked DataFrame with columns: gene, metric
        """
        # Find required columns
        gene_col = None
        pval_col = None
        logfc_col = None
        
        for col in diff_df.columns:
            col_lower = col.lower()
            if 'gene' in col_lower or 'symbol' in col_lower:
                gene_col = col
            elif 'pval' in col_lower and 'adj' not in col_lower:
                pval_col = col
            elif 'logfc' in col_lower or 'log2fc' in col_lower:
                logfc_col = col
        
        if gene_col is None or pval_col is None or logfc_col is None:
            logger.error(
                f"Required columns not found. "
                f"Gene: {gene_col}, Pval: {pval_col}, LogFC: {logfc_col}"
            )
            return None
        
        # Prepare data
        df = diff_df[[gene_col, pval_col, logfc_col]].copy()
        df.columns = ['gene', 'pval', 'logfc']
        
        # Remove invalid values
        df = df.dropna()
        df = df[df['pval'] > 0]
        df = df[df['pval'] <= 1]
        
        if len(df) == 0:
            return None
        
        # Calculate ranking metric
        df['metric'] = -np.log10(df['pval']) * np.sign(df['logfc'])
        
        # Sort by metric descending
        df = df.sort_values('metric', ascending=False)
        
        # Return only gene and metric columns
        return df[['gene', 'metric']]
    
    async def _run_single_gsea(
        self,
        rnk: pd.DataFrame,
        gene_set: str,
        output_dir: Path
    ) -> GSEAResults:
        """
        Run GSEA for a single database.
        
        Args:
            rnk: Ranked gene list
            gene_set: Gene set database name
            output_dir: Output directory
            
        Returns:
            GSEAResults object
        """
        output_dir.mkdir(parents=True, exist_ok=True)
        
        try:
            # Run prerank GSEA
            pre_res = gp.prerank(
                rnk=rnk,
                gene_sets=gene_set,
                outdir=str(output_dir),
                permutation_num=1000,
                min_size=15,
                max_size=500,
                threads=4,
                seed=123,
                verbose=False
            )
            
            # Parse results
            results_df = pre_res.res2d
            
            if results_df is None or len(results_df) == 0:
                return GSEAResults(
                    database=gene_set,
                    total_pathways=0,
                    significant_pathways=0,
                    overrepresented=0,
                    underrepresented=0,
                    results=[]
                )
            
            # Convert to GSEAResult objects
            gsea_results = []
            overrepresented = 0
            underrepresented = 0
            significant = 0
            
            for _, row in results_df.iterrows():
                # Handle different column name formats
                term = str(row.get('Term', row.get('term', '')))
                nes = float(row.get('NES', row.get('nes', 0)))
                pval = float(row.get('NOM p-val', row.get('pval', 1)))
                fdr = float(row.get('FDR q-val', row.get('fdr', 1)))
                es = float(row.get('ES', row.get('es', 0)))
                
                # Get lead genes if available
                lead_genes = []
                if 'Lead_genes' in row:
                    lead_genes_str = str(row['Lead_genes'])
                    lead_genes = [g.strip() for g in lead_genes_str.split(',') if g.strip()]
                
                # Count matched genes
                matched_genes = int(row.get('Tag %', '0').split('/')[0]) if 'Tag %' in row else 0
                
                result = GSEAResult(
                    term=term,
                    name=term,
                    es=es,
                    nes=nes,
                    pval=pval,
                    fdr=fdr,
                    lead_genes=lead_genes,
                    matched_genes=matched_genes
                )
                
                gsea_results.append(result)
                
                if result.significant:
                    significant += 1
                    if nes > 0:
                        overrepresented += 1
                    else:
                        underrepresented += 1
            
            return GSEAResults(
                database=gene_set,
                total_pathways=len(gsea_results),
                significant_pathways=significant,
                overrepresented=overrepresented,
                underrepresented=underrepresented,
                results=gsea_results
            )
            
        except Exception as e:
            logger.error(f"GSEA analysis failed for {gene_set}: {e}")
            return GSEAResults(
                database=gene_set,
                total_pathways=0,
                significant_pathways=0,
                overrepresented=0,
                underrepresented=0,
                results=[]
            )
    
    def get_results(self, database: Optional[str] = None) -> Optional[GSEAResults]:
        """
        Get GSEA results.
        
        Args:
            database: Database name (returns all if None)
            
        Returns:
            GSEAResults or dictionary of results
        """
        if database:
            return self.results.get(database)
        return self.results
    
    def save_results(self, output_path: Path) -> None:
        """
        Save GSEA results to JSON.
        
        Args:
            output_path: Path to save JSON
        """
        import json
        
        results_dict = {
            db: result.model_dump() for db, result in self.results.items()
        }
        
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(results_dict, f, indent=2)


# Global service instance
gsea_service = GSEAService()
