"""
GSEA analysis service (Step 9).

Performs Gene Set Enrichment Analysis using gseapy.
"""

import os
import asyncio
import json
import logging
from pathlib import Path
from typing import Optional

import pandas as pd
import numpy as np
import gseapy as gp

from app.core.exceptions import ProcessingError
from app.models.data import GSEAResults, GSEAResult
from app.models.analysis import DatabaseType, DATABASE_NAMES
from app.services.gsea_cache_service import gsea_cache_service, GSEACacheKey

logger = logging.getLogger("proteomics")

# Enrichr API base URL
ENRICHR_API_URL = "https://maayanlab.cloud/Enrichr/geneSetLibrary"


def _validate_and_repair_gmt_cache() -> None:
    """Validate cached GMT files exist and are non-empty.

    gseapy downloads GMT files from Enrichr on first use. We only check
    local file existence — no network calls here. gseapy handles
    downloading on its own if files are missing.

    If files are empty (from a prior failed download), log a warning
    so the operator can investigate, but don't block on network I/O.
    """
    cache_dir = Path.home() / ".cache" / "gseapy"
    cache_dir.mkdir(parents=True, exist_ok=True)

    required_files = [
        "Enrichr.GO_Biological_Process_2021.gmt",
        "Enrichr.GO_Molecular_Function_2021.gmt",
        "Enrichr.GO_Cellular_Component_2021.gmt",
        "Enrichr.KEGG_2021_Human.gmt",
        "Enrichr.Reactome_2022.gmt",
    ]

    for filename in required_files:
        gmt_path = cache_dir / filename
        if not gmt_path.exists():
            logger.info(f"GMT cache missing for {filename}, gseapy will download on first use")
        elif gmt_path.stat().st_size == 0:
            logger.warning(f"GMT cache file is empty: {gmt_path}. Remove it and gseapy will re-download")


class GSEAService:
    """
    GSEA analysis service.

    Implements step 9 of the pipeline: GSEA analysis on multiple databases.
    """

    def __init__(self):
        """Initialize GSEA service."""
        pass

    async def run_gsea_analysis(
        self,
        diff_expression_path: Path,
        output_dir: Path,
        databases: Optional[list[DatabaseType]] = None,
        protein_abundance_path: Optional[Path] = None
    ) -> dict[str, GSEAResults]:
        """
        Run GSEA analysis on all databases in parallel with caching.

        Args:
            diff_expression_path: Path to Diff_Expression.tsv
            output_dir: Directory for GSEA output
            databases: List of databases to analyze (defaults to all)
            protein_abundance_path: Optional path to protein abundances for heatmap

        Returns:
            Dictionary mapping database name to GSEAResults
        """
        logger.info("Step 9: Running GSEA analysis (parallel with caching)")

        # Validate and repair GMT cache before running analysis
        _validate_and_repair_gmt_cache()

        # Load differential expression data
        diff_df = await asyncio.to_thread(pd.read_csv, diff_expression_path, sep='\t')

        # Load protein abundance data for heatmap (if available)
        protein_df = None
        if protein_abundance_path and protein_abundance_path.exists():
            try:
                protein_df = await asyncio.to_thread(pd.read_csv, protein_abundance_path, sep='\t')
                logger.info(f"Loaded protein abundance data: {len(protein_df)} proteins")
            except Exception as e:
                logger.warning(f"Could not load protein abundance data: {e}")

        # Prepare ranked list
        rnk = self._prepare_ranked_list(diff_df)

        if rnk is None or len(rnk) == 0:
            logger.warning("No valid data for GSEA analysis")
            return {}

        # Extract cache key components
        protein_ids = diff_df['Master_Protein_Accessions'].tolist() if 'Master_Protein_Accessions' in diff_df.columns else []
        gene_names = diff_df['Gene_Name'].tolist() if 'Gene_Name' in diff_df.columns else []

        # Create output directory
        output_dir.mkdir(parents=True, exist_ok=True)

        # Determine databases to analyze
        if databases is None:
            databases = list(DatabaseType)

        # Run GSEA for each database in parallel
        results: dict[str, GSEAResults] = {}

        # Determine threads per database — gseapy's prerank is CPU-bound in its
        # permutation loop, so each database benefits from parallelism.
        # Cap at 4 threads per database to avoid severe oversubscription when
        # running multiple databases in parallel.
        n_cores = os.cpu_count() or 4
        threads_per_db = min(4, n_cores)
        logger.info(f"Allocating {threads_per_db} threads per database ({n_cores} cores available)")

        async def run_single_db(db_type: DatabaseType) -> tuple[str, GSEAResults]:
            """Run GSEA for a single database with caching."""
            db_name = DATABASE_NAMES.get(db_type, db_type.value)

            # Check cache first
            cache_key = GSEACacheKey.create(protein_ids, gene_names, ("Treatment", "Control"), db_type.value)
            cached_result = gsea_cache_service.get(cache_key)

            if cached_result is not None:
                logger.info(f"GSEA cache HIT for {db_name}")
                return (db_type.value, cached_result)

            # Run analysis
            try:
                logger.info(f"Running GSEA for {db_name}")

                result = await self._run_single_gsea(
                    rnk=rnk,
                    gene_set=db_name,
                    output_dir=output_dir / db_type.value,
                    protein_df=protein_df,
                    threads=threads_per_db
                )

                # Cache result
                gsea_cache_service.store(cache_key, result)

                logger.info(f"GSEA complete for {db_name}: {result.significant_pathways} significant pathways")

                return (db_type.value, result)

            except Exception as e:
                logger.error(f"GSEA failed for {db_name}: {e}")
                result = GSEAResults(
                    database=db_name,
                    total_pathways=0,
                    significant_pathways=0,
                    overrepresented=0,
                    underrepresented=0,
                    results=[]
                )
                return (db_type.value, result)

        # Run all databases in parallel
        tasks = [run_single_db(db) for db in databases]
        results_list = await asyncio.gather(*tasks)

        # Combine results
        results = dict(results_list)

        total_pathways = sum(r.significant_pathways for r in results.values())
        logger.info(f"Step 9 complete: GSEA analysis finished, {total_pathways} total significant pathways")

        return results
    
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

        # Clean gene names: strip isoform suffixes (e.g. P48729-2 -> P48729)
        # and take first gene from multi-ID entries (e.g. "Q9BXS6-6; Q9BXS6-7" -> Q9BXS6)
        df['gene'] = df['gene'].str.split('[;]').str[0].str.strip()
        df['gene'] = df['gene'].str.replace(r'-\d+$', '', regex=True)

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
        output_dir: Path,
        protein_df: Optional[pd.DataFrame] = None,
        threads: int = 4
    ) -> GSEAResults:
        """
        Run GSEA for a single database.

        Args:
            rnk: Ranked gene list
            gene_set: Gene set database name
            output_dir: Output directory
            protein_df: Optional protein abundance data for heatmap
            threads: Number of threads for gseapy

        Returns:
            GSEAResults object
        """
        output_dir.mkdir(parents=True, exist_ok=True)

        try:
            # Run prerank GSEA (CPU-intensive, offload to thread)
            def _run_prerank():
                return gp.prerank(
                    rnk=rnk,
                    gene_sets=gene_set,
                    outdir=str(output_dir),
                    permutation_num=1000,
                    min_size=15,
                    max_size=500,
                    threads=threads,
                    seed=123,
                    verbose=False
                )

            pre_res = await asyncio.to_thread(_run_prerank)

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
                    # gseapy output uses semicolons to separate genes
                    lead_genes = [g.strip() for g in lead_genes_str.split(';') if g.strip()]

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

    def generate_running_es_curve(
        self,
        ranked_genes: list[str],
        lead_genes: list[str],
        nes: float,
        ranked_metrics: Optional[list[float]] = None
    ) -> list[tuple[int, float]]:
        """
        Generate the running enrichment score curve using the classic GSEA algorithm.

        This implements the standard GSEA running sum statistic:
        - For hits (genes in pathway): increment by |r|^p / sum(|r|^p for hits)
        - For misses (genes not in pathway): decrement by 1/(N-n)

        Where:
        - N = total number of genes
        - n = number of hits (genes in pathway)
        - r = ranking metric value
        - p = exponent (usually 1 for preranked)

        Args:
            ranked_genes: Full list of genes in ranked order
            lead_genes: Genes belonging to the pathway
            nes: Normalized enrichment score (used to scale the curve)
            ranked_metrics: Optional ranking metric values for weighted calculation

        Returns:
            List of (rank, es) tuples representing the curve
        """
        if not ranked_genes or not lead_genes:
            return []

        # Create a set for faster lookup
        lead_gene_set = set(lead_genes)

        N = len(ranked_genes)
        n = len(lead_genes)

        if n == 0 or N == 0 or n >= N:
            return []

        # Classic GSEA running sum calculation
        # For preranked analysis with equal weights (p=0), each hit contributes 1/n
        # For weighted analysis (p=1), hits are weighted by |metric|

        # Use equal weights if no metrics provided
        if ranked_metrics is None or len(ranked_metrics) != N:
            # Equal weighting: each hit = 1/n, each miss = -1/(N-n)
            hit_weight = 1.0 / n
            miss_weight = -1.0 / (N - n)

            running_sum = 0.0
            curve = []
            max_es = 0.0
            max_es_sign = 1

            for i, gene in enumerate(ranked_genes):
                if gene in lead_gene_set:
                    running_sum += hit_weight
                else:
                    running_sum += miss_weight

                curve.append((i, running_sum))

                # Track maximum deviation
                if abs(running_sum) > abs(max_es):
                    max_es = running_sum
                    max_es_sign = 1 if running_sum >= 0 else -1
        else:
            # Weighted by ranking metric
            # Calculate sum of |metric| for all hits
            hit_metrics_sum = 0.0
            for i, gene in enumerate(ranked_genes):
                if gene in lead_gene_set:
                    hit_metrics_sum += abs(ranked_metrics[i])

            if hit_metrics_sum == 0:
                hit_metrics_sum = 1.0  # Avoid division by zero

            running_sum = 0.0
            curve = []
            max_es = 0.0
            max_es_sign = 1

            for i, gene in enumerate(ranked_genes):
                if gene in lead_gene_set:
                    # Weighted hit increment
                    running_sum += abs(ranked_metrics[i]) / hit_metrics_sum
                else:
                    # Miss decrement
                    running_sum -= 1.0 / (N - n)

                curve.append((i, running_sum))

                # Track maximum deviation
                if abs(running_sum) > abs(max_es):
                    max_es = running_sum
                    max_es_sign = 1 if running_sum >= 0 else -1

        # Normalize to match the actual ES from gseapy
        # The maximum deviation should equal the reported ES
        if max_es != 0 and nes != 0:
            scale_factor = abs(nes) / abs(max_es)
            target_sign = 1 if nes > 0 else -1
            sign_correction = target_sign * max_es_sign
            curve = [(rank, es * scale_factor * sign_correction) for rank, es in curve]

        return curve

    def generate_heatmap_data(
        self,
        protein_df: pd.DataFrame,
        lead_genes: list[str]
    ) -> Optional[dict]:
        """
        Generate heatmap data for leading edge genes.

        Creates z-score transformed protein abundance matrix for heatmap visualization.

        Args:
            protein_df: Protein abundance DataFrame
            lead_genes: List of leading edge gene names

        Returns:
            Dictionary with genes, samples, and z_score matrix, or None if data unavailable
        """
        try:
            # Identify gene column and abundance columns
            gene_id_cols = ['Master Protein Accessions', 'Gene_Name', 'Gene', 'Protein', 'Master_Protein_Accessions']
            exclude_cols = set(gene_id_cols + ['PSM_Count', 'psm_count'])

            gene_col = None
            for col in gene_id_cols:
                if col in protein_df.columns:
                    gene_col = col
                    break

            if gene_col is None:
                # Try first column as gene column
                gene_col = protein_df.columns[0]

            # Get abundance columns (numeric columns excluding metadata)
            abundance_cols = [
                col for col in protein_df.columns
                if col not in exclude_cols and protein_df[col].dtype in ['float64', 'float32', 'int64']
            ]

            if len(abundance_cols) == 0:
                return None

            # Filter to pathway genes that are in the protein data
            available_genes = protein_df[gene_col].astype(str).str.upper().tolist()
            lead_genes_upper = [g.upper() for g in lead_genes]

            # Build a lookup: uppercase gene name -> index
            gene_index_map: dict[str, int] = {}
            for i, gene in enumerate(available_genes):
                # Split multi-gene entries and strip isoform suffixes
                parts = gene.replace('[;]', ';').split(';')
                for part in parts:
                    clean = part.strip().upper()
                    if clean and clean not in gene_index_map:
                        gene_index_map[clean] = i

            # Exact match against cleaned gene names
            matched_genes = []
            matched_indices = []
            for lead_gene in lead_genes_upper:
                if lead_gene in gene_index_map:
                    idx = gene_index_map[lead_gene]
                    matched_genes.append(protein_df.iloc[idx][gene_col])
                    matched_indices.append(idx)

            if len(matched_genes) == 0:
                return None

            # Extract abundance data for matched genes
            heatmap_df = protein_df.iloc[matched_indices][abundance_cols].copy()

            # Calculate z-scores for each gene (row) across samples
            z_scores = []
            for _, row in heatmap_df.iterrows():
                values = row.dropna().values
                if len(values) > 1:
                    mean = np.mean(values)
                    std = np.std(values)
                    if std > 0:
                        z_row = [(v - mean) / std if not np.isnan(v) else 0 for v in row.values]
                    else:
                        z_row = [0] * len(row)
                else:
                    z_row = [0] * len(row)
                z_scores.append(z_row)

            return {
                'genes': matched_genes[:50],  # Limit to top 50 genes for display
                'samples': abundance_cols,
                'z_scores': z_scores[:50]
            }

        except Exception as e:
            logger.warning(f"Could not generate heatmap data: {e}")
            return None

    def get_results(self, results: dict[str, GSEAResults], database: Optional[str] = None) -> Optional[GSEAResults]:
        """
        Get GSEA results.

        Args:
            results: GSEA results dictionary
            database: Database name (returns all if None)

        Returns:
            GSEAResults or dictionary of results
        """
        if database:
            return results.get(database)
        return results

    def save_results(self, results: dict[str, GSEAResults], output_path: Path) -> None:
        """
        Save GSEA results to JSON.

        Args:
            results: GSEA results dictionary
            output_path: Path to save JSON
        """
        import json

        results_dict = {
            db: result.model_dump() for db, result in results.items()
        }

        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(results_dict, f, indent=2, default=str)


# Global service instance
gsea_service = GSEAService()
