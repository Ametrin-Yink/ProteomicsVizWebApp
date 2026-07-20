"""Protein and peptide abundance visualization routes."""

import asyncio
import logging
from pathlib import Path
from typing import Any

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.deps import get_session_store
from app.api.routes.visualization_shared import (
    build_sample_filter as _build_sample_filter,
)
from app.api.routes.visualization_shared import (
    cache_key as _cache_key,
)
from app.api.routes.visualization_shared import (
    create_response,
)
from app.api.routes.visualization_shared import (
    visualization_cache as viz_cache,
)
from app.core.config import settings
from app.db.session_store import SessionStore
from app.services.compare_service import accession_matches

router = APIRouter()
logger = logging.getLogger("proteomics")


async def load_protein_abundance(
    results_dir: Path,
    protein_id: str,
    session_id: str = "",
    control: str = "",
    treatment: str = "",
    sample_filter: list[str] | None = None,
) -> dict[str, Any]:
    """Load protein abundance data from TSV file.

    Args:
        results_dir: Path to session results directory
        protein_id: Protein accession ID
        session_id: Session ID for cache keying
        control: Control condition name for label matching
        treatment: Treatment condition name for label matching
        sample_filter: Optional list of condition name prefixes to filter samples by.
                       Only sample columns starting with any of these prefixes are included.

    Returns:
        Protein abundance data dictionary matching frontend ProteinAbundance interface
    """
    filter_tag = ",".join(sorted(sample_filter)) if sample_filter else ""
    cache_key = _cache_key(session_id, "protein_v2", protein_id, filter_tag)
    cached = viz_cache.get(cache_key)
    if cached is not None:
        return cached

    abundance_file = results_dir / "Protein_Abundances.tsv"

    if not abundance_file.exists():
        return {"samples": [], "abundances": [], "conditions": []}

    try:
        df = await asyncio.to_thread(pd.read_csv, abundance_file, sep="\t")

        # Find the protein row (handle multiple accessions separated by ;)
        protein_row = df[
            df["Master_Protein_Accessions"].map(
                lambda value: accession_matches(value, protein_id)
            )
        ]

        if protein_row.empty:
            return {"samples": [], "abundances": [], "conditions": []}

        # Get abundance columns (all columns except metadata)
        metadata_cols = [
            "Master_Protein_Accessions",
            "Gene_Name",
            "PSM_Count",
            "psm_count",
            "Protein",
        ]
        abundance_cols = [col for col in df.columns if col not in metadata_cols]

        # Filter to comparison-relevant samples when sample_filter is provided
        if sample_filter:
            abundance_cols = [
                col
                for col in abundance_cols
                if any(col.startswith(prefix) for prefix in sample_filter)
            ]

        # Build arrays for frontend format - include ALL samples, even with NA/0 values
        samples = []
        abundances = []
        conditions = []

        for col in abundance_cols:
            samples.append(col)
            value = protein_row.iloc[0].get(col)
            # Convert NA to 0, otherwise reverse log2 transform
            if pd.isna(value):
                abundances.append(0.0)
            else:
                abundances.append(2.0 ** float(value))
            # Infer condition from sample name using session config
            condition = "Unknown"
            if control and control.lower() in col.lower():
                condition = "Control"
            elif treatment and treatment.lower() in col.lower():
                condition = "Treatment"
            elif "DMSO" in col.upper() or "VEHICLE" in col.upper():
                condition = "Control"
            conditions.append(condition)

        result = {
            "samples": samples,
            "abundances": abundances,
            "conditions": conditions,
        }
        viz_cache.set(cache_key, result)
        return result
    except Exception as e:
        logger.error(f"Error loading protein abundance: {e}")
        return {"samples": [], "abundances": [], "conditions": []}


@router.get("/{session_id}/protein/{protein_id}/abundance")
async def get_protein_abundance(
    session_id: str,
    protein_id: str,
    comparison: str = Query("", description="Comparison name to filter samples"),
    store: SessionStore = Depends(get_session_store),
):
    """Get protein abundance data, optionally filtered by comparison."""
    session = await store.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found",
        )

    # Get results directory
    results_dir = settings.sessions_dir / session_id / "results"

    # Extract control/treatment from session config for condition labeling
    control = session.config.control if session.config else ""
    treatment = session.config.treatment if session.config else ""

    # Build sample filter from comparison config
    sample_filter = _build_sample_filter(session, comparison)

    # Load protein abundance from file
    abundance_data = await load_protein_abundance(
        results_dir,
        protein_id,
        session_id,
        control=control,
        treatment=treatment,
        sample_filter=sample_filter,
    )

    return create_response(abundance_data)


async def load_peptide_abundance(
    results_dir: Path,
    protein_id: str,
    session_id: str = "",
    sample_filter: list[str] | None = None,
) -> dict[str, Any]:
    """Load peptide abundance data from Parquet or TSV file.

    Aggregates PSMs into peptides by summing abundances for each unique
    peptide sequence across samples. Applies normalization coefficients
    from Step 6 so peptide abundances are on the same scale as protein abundances.

    Args:
        results_dir: Path to session results directory
        protein_id: Protein accession ID
        session_id: Session ID for cache keying
        sample_filter: Optional list of condition name prefixes to filter samples by.

    Returns:
        Peptide abundance data dictionary matching frontend PeptideAbundanceData interface
    """
    filter_tag = ",".join(sorted(sample_filter)) if sample_filter else ""
    cache_key = _cache_key(session_id, "peptide", protein_id, filter_tag)
    cached = viz_cache.get(cache_key)
    if cached is not None:
        return cached

    # Load normalization coefficients from Step 6
    norm_coeff_file = results_dir / "normalization_coefficients.tsv"
    norm_factors = {}
    if norm_coeff_file.exists():
        try:
            coeff_df = await asyncio.to_thread(pd.read_csv, norm_coeff_file, sep="\t")
            for _, row in coeff_df.iterrows():
                norm_factors[row["Sample"]] = float(row["LinearFactor"])
            logger.debug(
                f"Loaded normalization coefficients for {len(norm_factors)} samples"
            )
        except Exception as e:
            logger.warning(f"Could not load normalization coefficients: {e}")

    # Pipeline uses Parquet for performance, fall back to TSV for compatibility.
    # MSstats saves PSM_Abundances.parquet; msqrob2 saves PSM_Combined.parquet.
    psm_files = [
        results_dir / "PSM_Abundances.parquet",
        results_dir / "PSM_Combined.parquet",
        results_dir / "PSM_Abundances.tsv",
    ]

    df = None
    for psm_path in psm_files:
        if not psm_path.exists():
            continue
        try:
            if psm_path.suffix == ".parquet":
                df = await asyncio.to_thread(pd.read_parquet, psm_path)
            else:
                df = await asyncio.to_thread(pd.read_csv, psm_path, sep="\t")
            break
        except Exception as e:
            logger.error(f"Error reading {psm_path.name}: {e}")

    if df is None:
        return {"peptides": []}

    try:
        # Filter rows for this protein
        protein_rows = df[
            df["Master_Protein_Accessions"].map(
                lambda value: accession_matches(value, protein_id)
            )
        ]

        if protein_rows.empty:
            return {"peptides": []}

        # Get unique samples
        all_samples = sorted(protein_rows["Sample_Origination"].dropna().unique())

        # Filter to comparison-relevant samples when sample_filter is provided
        if sample_filter:
            all_samples = [
                s
                for s in all_samples
                if any(str(s).startswith(prefix) for prefix in sample_filter)
            ]

        # Group by Sequence to aggregate PSMs into peptides
        peptides = []
        for sequence, group in protein_rows.groupby("Sequence"):
            # Sum abundances per sample for this peptide
            sample_sums = {}
            for _, row in group.iterrows():
                sample = str(row.get("Sample_Origination", ""))
                abundance = row.get("Abundance")
                if pd.notna(abundance) and sample:
                    sample_sums[sample] = sample_sums.get(sample, 0) + float(abundance)

            samples = []
            abundances = []
            for s in all_samples:
                if s in sample_sums:
                    samples.append(s)
                    # Apply normalization coefficient if available
                    val = sample_sums[s]
                    if s in norm_factors:
                        val *= norm_factors[s]
                    abundances.append(val)

            if samples:
                peptides.append(
                    {
                        "peptide_id": sequence,
                        "sequence": sequence,
                        "abundances": abundances,
                        "samples": samples,
                    }
                )

        result = {"peptides": peptides}
        viz_cache.set(cache_key, result)
        return result
    except Exception as e:
        logger.error(f"Error loading peptide abundance: {e}")
        return {"peptides": []}


@router.get("/{session_id}/protein/{protein_id}/peptide")
async def get_protein_peptide(
    session_id: str,
    protein_id: str,
    comparison: str = Query("", description="Comparison name to filter samples"),
    store: SessionStore = Depends(get_session_store),
):
    """Get peptide abundance data for a protein, optionally filtered by comparison."""
    session = await store.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found",
        )

    # Get results directory
    results_dir = settings.sessions_dir / session_id / "results"

    # Build sample filter from comparison config
    sample_filter = _build_sample_filter(session, comparison)

    # Load peptide data from file
    peptide_data = await load_peptide_abundance(
        results_dir, protein_id, session_id, sample_filter=sample_filter
    )

    return create_response(peptide_data)
