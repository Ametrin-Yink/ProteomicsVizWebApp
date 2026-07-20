"""PTM-specific visualization routes and result loaders."""

import asyncio
import logging
from pathlib import Path
from typing import Any, Literal

import numpy as np
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse

from app.api.deps import get_session_store
from app.api.routes.visualization_shared import create_response
from app.core.config import settings
from app.db.session_store import SessionStore
from app.utils.json_io import read_json_file, write_json_file

router = APIRouter()
logger = logging.getLogger("proteomics")

# ---- PTM-specific endpoints ----

PTMResultLayer = Literal["ptm", "protein", "adjusted"]
_LAYER_MODELS = {
    "ptm": "ptm_model",
    "protein": "protein_model",
    "adjusted": "adjusted_model",
}
_RESULT_FILENAMES = {
    "ptm_model": "ptm_site_results.tsv",
    "protein_model": "protein_results.tsv",
    "adjusted_model": "adjusted_ptm_results.tsv",
}
_VISUALIZATION_RESULT_COLUMNS = {
    "Comparison",
    "Protein",
    "ProteinName",
    "SiteLabel",
    "ProteinAccession",
    "GlobalProtein",
    "Gene",
    "Gene_Name",
    "LocalizationStatus",
    "MappingStatus",
    "log2FC",
    "pvalue",
    "adj.pvalue",
    "Status",
    "issue",
}


def _json_safe_records(frame: pd.DataFrame) -> list[dict[str, Any]]:
    """Convert a result frame to records without non-JSON NaN/Infinity values."""
    clean = frame.replace([np.inf, -np.inf], np.nan).astype(object)
    return clean.where(pd.notna(clean), None).to_dict(orient="records")


async def load_ptm_results(
    results_dir: Path,
    *,
    comparison: str | None = None,
    layer: PTMResultLayer | None = None,
) -> list[dict[str, Any]]:
    """Load requested PTM result rows, preserving the existing grouped response."""
    stable_paths = {
        model: results_dir / filename for model, filename in _RESULT_FILENAMES.items()
    }
    requested_models = [_LAYER_MODELS[layer]] if layer else list(stable_paths)
    if stable_paths["ptm_model"].exists():
        frames: dict[str, pd.DataFrame] = {}
        for model in requested_models:
            path = stable_paths[model]
            if path.exists():
                read_options: dict[str, Any] = {"sep": "\t"}
                if layer is not None:
                    read_options["usecols"] = lambda column: (
                        column in _VISUALIZATION_RESULT_COLUMNS
                    )
                frames[model] = await asyncio.to_thread(
                    pd.read_csv,
                    path,
                    **read_options,
                )
        discovery = frames.get("ptm_model")
        if discovery is None and frames:
            discovery = next(iter(frames.values()))
        if discovery is None:
            return []
        if "Comparison" not in discovery.columns:
            discovery = discovery.copy()
            discovery["Comparison"] = (
                discovery["Label"].astype(str)
                if "Label" in discovery.columns
                else "comparison"
            )
        labels = (
            [comparison]
            if comparison is not None
            else discovery["Comparison"].dropna().astype(str).unique().tolist()
        )
        comparisons: list[dict[str, Any]] = []
        for label in labels:
            item: dict[str, Any] = {
                "label": label,
                "ptm_model": [],
                "protein_model": [],
                "adjusted_model": [],
            }
            for model in requested_models:
                frame = frames.get(model)
                if frame is None:
                    continue
                if "Comparison" in frame.columns:
                    subset = frame[frame["Comparison"].astype(str) == label]
                else:
                    subset = frame
                if comparison is not None and "Comparison" in subset.columns:
                    subset = subset.drop(columns="Comparison")
                item[model] = _json_safe_records(subset)
            if any(item[model] for model in requested_models):
                comparisons.append(item)
        return comparisons

    return []


async def load_ptm_comparison_summary(
    results_dir: Path,
    layer: PTMResultLayer,
) -> dict[str, Any]:
    """Calculate matched-feature correlations without returning full result rows."""
    ptm_path = results_dir / _RESULT_FILENAMES["ptm_model"]
    result_path = results_dir / _RESULT_FILENAMES[_LAYER_MODELS[layer]]
    if not ptm_path.exists():
        return {
            "comparisons": [],
            "matrix": [],
            "pairs": [],
            "available_for_all": False,
        }

    label_frame = await asyncio.to_thread(
        pd.read_csv,
        ptm_path,
        sep="\t",
        usecols=lambda column: column in {"Comparison", "Label"},
    )
    label_column = "Comparison" if "Comparison" in label_frame else "Label"
    comparisons = label_frame[label_column].dropna().astype(str).unique().tolist()
    feature_maps: dict[str, dict[str, float]] = {label: {} for label in comparisons}

    if result_path.exists():
        frame = await asyncio.to_thread(
            pd.read_csv,
            result_path,
            sep="\t",
            usecols=lambda column: (
                column in {"Comparison", "Label", "Protein", "ProteinName", "log2FC"}
            ),
        )
        comparison_column = "Comparison" if "Comparison" in frame else "Label"
        feature_column = "Protein" if "Protein" in frame else "ProteinName"
        frame["log2FC"] = pd.to_numeric(frame["log2FC"], errors="coerce")
        frame = frame.dropna(subset=[comparison_column, feature_column, "log2FC"])
        frame = frame.drop_duplicates([comparison_column, feature_column], keep="last")
        for label, group in frame.groupby(comparison_column, sort=False):
            if str(label) in feature_maps:
                feature_maps[str(label)] = dict(
                    zip(
                        group[feature_column].astype(str),
                        group["log2FC"].astype(float),
                        strict=True,
                    )
                )

    def correlation(left: str, right: str) -> tuple[int, float | None]:
        shared = sorted(feature_maps[left].keys() & feature_maps[right].keys())
        if len(shared) < 2:
            return len(shared), None
        left_values = np.array([feature_maps[left][key] for key in shared])
        right_values = np.array([feature_maps[right][key] for key in shared])
        if np.std(left_values) == 0 or np.std(right_values) == 0:
            return len(shared), None
        return len(shared), float(np.corrcoef(left_values, right_values)[0, 1])

    matrix: list[list[float | None]] = []
    for row, left in enumerate(comparisons):
        values: list[float | None] = []
        for column, right in enumerate(comparisons):
            values.append(1.0 if row == column else correlation(left, right)[1])
        matrix.append(values)

    pairs = []
    for left_index, left in enumerate(comparisons):
        for right in comparisons[left_index + 1 :]:
            matched, value = correlation(left, right)
            pairs.append(
                {
                    "left": left,
                    "right": right,
                    "matched": matched,
                    "correlation": value,
                }
            )
    return {
        "comparisons": comparisons,
        "matrix": matrix,
        "pairs": pairs,
        "available_for_all": bool(comparisons)
        and all(feature_maps[label] for label in comparisons),
    }


@router.get("/{session_id}/ptm/results")
async def get_ptm_results(
    session_id: str,
    comparison: str | None = Query(default=None),
    layer: PTMResultLayer | None = Query(default=None),
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

    comparisons = await load_ptm_results(
        results_dir,
        comparison=comparison,
        layer=layer,
    )

    return create_response({"comparisons": comparisons})


@router.get("/{session_id}/ptm/results/download")
async def download_ptm_results(
    session_id: str,
    store: SessionStore = Depends(get_session_store),
):
    """Download the immutable PTM result archive produced by the pipeline."""
    session = await store.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found",
        )
    archive = settings.sessions_dir / session_id / "results" / "ptm_results.zip"
    if not archive.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="PTM result archive was not found",
        )
    return FileResponse(
        archive,
        media_type="application/zip",
        filename="ptm_results.zip",
    )


@router.get("/{session_id}/ptm/compare")
async def get_ptm_comparison_summary(
    session_id: str,
    layer: PTMResultLayer = Query(default="ptm"),
    store: SessionStore = Depends(get_session_store),
):
    """Return compact, layer-specific comparison correlations."""
    session = await store.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found",
        )
    results_dir = settings.sessions_dir / session_id / "results"
    return create_response(await load_ptm_comparison_summary(results_dir, layer))


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
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="PTM QC data could not be loaded",
        ) from e
