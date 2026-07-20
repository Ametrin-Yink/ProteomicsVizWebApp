"""PTM-specific visualization routes and result loaders."""

import asyncio
import logging
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import get_session_store
from app.api.routes.visualization_shared import create_response
from app.core.config import settings
from app.db.session_store import SessionStore
from app.utils.json_io import read_json_file, write_json_file

router = APIRouter()
logger = logging.getLogger("proteomics")

# ---- PTM-specific endpoints ----

_PTM_COMPARISONS_DIR = "ptm_comparisons"


def _json_safe_records(frame: pd.DataFrame) -> list[dict[str, Any]]:
    """Convert a result frame to records without non-JSON NaN/Infinity values."""
    clean = frame.replace([np.inf, -np.inf], np.nan).astype(object)
    return clean.where(pd.notna(clean), None).to_dict(orient="records")


async def load_ptm_results(
    results_dir: Path,
) -> list[dict[str, Any]]:
    """Load PTM differential expression results from the ptm_comparisons directory.

    Reads PTM_Model_{label}.tsv, PROTEIN_Model_{label}.tsv, and ADJUSTED_Model_{label}.tsv
    files and groups them by comparison label.

    Mode A comparisons only have the PTM model file; Mode B has all three.

    Args:
        results_dir: Path to session results directory

    Returns:
        List of comparison dicts with ptm_model, protein_model, adjusted_model entries
    """
    stable_paths = {
        "ptm_model": results_dir / "ptm_site_results.tsv",
        "protein_model": results_dir / "protein_results.tsv",
        "adjusted_model": results_dir / "adjusted_ptm_results.tsv",
    }
    if stable_paths["ptm_model"].exists():
        frames: dict[str, pd.DataFrame] = {}
        for layer, path in stable_paths.items():
            if path.exists():
                frames[layer] = await asyncio.to_thread(pd.read_csv, path, sep="\t")
        ptm_frame = frames["ptm_model"]
        if "Comparison" not in ptm_frame.columns:
            ptm_frame["Comparison"] = (
                ptm_frame["Label"].astype(str)
                if "Label" in ptm_frame.columns
                else "comparison"
            )
        comparisons = []
        for label in ptm_frame["Comparison"].dropna().astype(str).unique():
            comparison: dict[str, Any] = {"label": label}
            for layer in stable_paths:
                frame = frames.get(layer)
                if frame is None:
                    comparison[layer] = []
                    continue
                if "Comparison" in frame.columns:
                    subset = frame[frame["Comparison"].astype(str) == label]
                else:
                    subset = frame
                comparison[layer] = _json_safe_records(subset)
            comparisons.append(comparison)
        return comparisons

    ptm_dir = results_dir / _PTM_COMPARISONS_DIR
    if not ptm_dir.exists() or not ptm_dir.is_dir():
        return []

    # Find all PTM_Model_*.tsv files to discover available labels
    ptm_files = sorted(ptm_dir.glob("PTM_Model_*.tsv"))
    if not ptm_files:
        return []

    comparisons = []
    for ptm_file in ptm_files:
        label = ptm_file.stem[len("PTM_Model_") :]  # Extract label after "PTM_Model_"

        comparison: dict[str, Any] = {"label": label}

        # Load PTM model results
        try:
            df = await asyncio.to_thread(pd.read_csv, ptm_file, sep="\t")
            comparison["ptm_model"] = _json_safe_records(df)
        except Exception as e:
            logger.error(f"Error loading PTM model {ptm_file.name}: {e}")
            comparison["ptm_model"] = []

        # Load protein model results (may not exist in Mode A)
        protein_file = ptm_dir / f"PROTEIN_Model_{label}.tsv"
        if protein_file.exists():
            try:
                df = await asyncio.to_thread(pd.read_csv, protein_file, sep="\t")
                comparison["protein_model"] = _json_safe_records(df)
            except Exception as e:
                logger.error(f"Error loading protein model {protein_file.name}: {e}")
                comparison["protein_model"] = []
        else:
            comparison["protein_model"] = []

        # Load adjusted model results (may not exist in Mode A)
        adjusted_file = ptm_dir / f"ADJUSTED_Model_{label}.tsv"
        if adjusted_file.exists():
            try:
                df = await asyncio.to_thread(pd.read_csv, adjusted_file, sep="\t")
                comparison["adjusted_model"] = _json_safe_records(df)
            except Exception as e:
                logger.error(f"Error loading adjusted model {adjusted_file.name}: {e}")
                comparison["adjusted_model"] = []
        else:
            comparison["adjusted_model"] = []

        comparisons.append(comparison)

    return comparisons


@router.get("/{session_id}/ptm/results")
async def get_ptm_results(
    session_id: str,
    store: SessionStore = Depends(get_session_store),
):
    """Get PTM differential expression results with three-model output.

    Returns grouped data for each comparison label, containing the PTM model,
    protein model, and adjusted model results where available.
    Mode A comparisons only have the PTM model; Mode B has all three.
    """
    session = await store.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found",
        )

    results_dir = settings.sessions_dir / session_id / "results"

    comparisons = await load_ptm_results(results_dir)

    return create_response({"comparisons": comparisons})


@router.get("/{session_id}/ptm/site/{site_id}/abundance")
async def get_ptm_site_abundance(
    session_id: str,
    site_id: str,
    store: SessionStore = Depends(get_session_store),
):
    """Get summarized per-channel abundance for one PTM site."""
    session = await store.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found",
        )

    results_dir = settings.sessions_dir / session_id / "results"
    summarized_path = results_dir / "ptm_site_summarized.tsv"
    if summarized_path.exists():
        frame = await asyncio.to_thread(pd.read_csv, summarized_path, sep="\t")
        protein_column = "Protein" if "Protein" in frame.columns else "ProteinName"
        frame = frame[frame[protein_column].astype(str) == site_id].copy()
        records = _json_safe_records(frame)
    else:
        abundance_path = results_dir / "ptm_site_abundance.tsv"
        if not abundance_path.exists():
            records = []
        else:
            frame = await asyncio.to_thread(pd.read_csv, abundance_path, sep="\t")
            frame = frame[frame["ProteinName"].astype(str) == site_id]
            if not frame.empty:
                frame = frame.groupby(
                    ["Channel", "Condition", "Replicate"], as_index=False
                )["NormalizedAbundance"].sum()
                abundance = pd.to_numeric(frame["NormalizedAbundance"], errors="coerce")
                frame["Abundance"] = np.where(abundance > 0, np.log2(abundance), np.nan)
            records = _json_safe_records(frame)
    return create_response({"site": site_id, "samples": records})


@router.get("/{session_id}/ptm/site/{site_id}")
async def get_ptm_site_details(
    session_id: str,
    site_id: str,
    store: SessionStore = Depends(get_session_store),
):
    """Return localization, peptidoform, and supporting-PSM evidence for a site."""
    session = await store.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found",
        )
    results_dir = settings.sessions_dir / session_id / "results"

    async def load_matching(path: Path) -> list[dict[str, Any]]:
        if not path.exists():
            return []
        frame = await asyncio.to_thread(pd.read_csv, path, sep="\t")
        protein_column = "ProteinName" if "ProteinName" in frame.columns else "Protein"
        frame = frame[frame[protein_column].astype(str) == site_id]
        return _json_safe_records(frame)

    metadata, evidence, peptidoforms = await asyncio.gather(
        load_matching(results_dir / "ptm_site_metadata.tsv"),
        load_matching(results_dir / "ptm_localization_evidence.tsv"),
        load_matching(results_dir / "ptm_peptidoforms.tsv"),
    )
    if not metadata:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"PTM site {site_id} not found",
        )
    return create_response(
        {
            "site": metadata[0],
            "evidence": evidence,
            "peptidoforms": peptidoforms,
        }
    )


@router.get("/{session_id}/ptm/qc/plots")
async def get_ptm_qc_plots(
    session_id: str,
    store: SessionStore = Depends(get_session_store),
):
    """Get PTM-specific QC data."""
    session = await store.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found",
        )

    results_dir = settings.sessions_dir / session_id / "results"
    qc_file = results_dir / "ptm_qc.json"

    default_result: dict[str, Any] = {
        "total_sites": 0,
        "significant_hits": 0,
        "up_regulated": 0,
        "down_regulated": 0,
        "comparisons": [],
    }

    if not qc_file.exists():
        return create_response(default_result)

    try:
        data = await read_json_file(qc_file)
        needs_ptm_plots = not data.get("plots")
        needs_protein_plots = bool(
            data.get("results", {}).get("protein_layer_available")
        ) and not data.get("protein_plots")
        if needs_ptm_plots or needs_protein_plots:
            from app.services.ptm_qc_calculator import (
                calculate_protein_qc_plots,
                calculate_ptm_qc_plots,
            )

            plot_data, protein_plot_data = await asyncio.gather(
                calculate_ptm_qc_plots(results_dir)
                if needs_ptm_plots
                else asyncio.sleep(0, result=None),
                calculate_protein_qc_plots(results_dir)
                if needs_protein_plots
                else asyncio.sleep(0, result=None),
            )
            if plot_data is not None:
                data["plots"] = plot_data
            if protein_plot_data is not None:
                data["protein_plots"] = protein_plot_data
            await write_json_file(qc_file, data, indent=2)
        return create_response(data)
    except Exception as e:
        logger.error(f"Error loading PTM QC data: {e}")
        return create_response(default_result)
