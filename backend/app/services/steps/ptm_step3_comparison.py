"""PTM stage 5: fit requested comparisons and write stable result tables."""

import asyncio
from pathlib import Path

import numpy as np
import pandas as pd

from app.services.pipeline_engine import StepContext
from app.services.ptm_wrapper import ptm_wrapper
from app.services.steps._helpers import build_comparison_pair_label, create_log_callback


def _add_unestimable_sites(
    frame: pd.DataFrame,
    metadata: pd.DataFrame,
    label: str,
) -> pd.DataFrame:
    protein_column = "Protein" if "Protein" in frame.columns else "ProteinName"
    present = (
        set(frame[protein_column].dropna().astype(str))
        if protein_column in frame
        else set()
    )
    missing = metadata[~metadata["ProteinName"].astype(str).isin(present)].copy()
    if missing.empty:
        frame["Status"] = np.where(
            frame.get("pvalue", pd.Series(index=frame.index)).isna(),
            "Unestimable",
            "Estimated",
        )
        return frame
    rows = pd.DataFrame(
        {
            "Protein": missing["ProteinName"],
            "Label": label,
            "log2FC": np.nan,
            "SE": np.nan,
            "pvalue": np.nan,
            "adj.pvalue": np.nan,
            "Status": "Unestimable",
        }
    )
    frame = frame.copy()
    frame["Status"] = np.where(
        frame.get("pvalue", pd.Series(index=frame.index)).isna(),
        "Unestimable",
        "Estimated",
    )
    return pd.concat([frame, rows], ignore_index=True, sort=False)


def _merge_site_metadata(frame: pd.DataFrame, metadata: pd.DataFrame) -> pd.DataFrame:
    protein_column = "Protein" if "Protein" in frame.columns else "ProteinName"
    return frame.merge(
        metadata,
        left_on=protein_column,
        right_on="ProteinName",
        how="left",
        suffixes=("", "_metadata"),
    )


def _filter_adjusted_results(
    frame: pd.DataFrame,
    metadata: pd.DataFrame,
    quantified_proteins: set[str],
) -> pd.DataFrame:
    adjusted = _merge_site_metadata(frame, metadata)
    if "Adjusted" in adjusted.columns:
        adjusted = adjusted[adjusted["Adjusted"].fillna(False).astype(bool)].copy()
    if "GlobalProtein" not in adjusted.columns or not quantified_proteins:
        return adjusted.iloc[0:0].copy()

    global_protein = adjusted["GlobalProtein"].fillna("").astype(str)
    site_accession = adjusted["ProteinAccession"].fillna("").astype(str)
    exact = global_protein.eq(site_accession)
    canonical = (
        global_protein.str.split("-").str[0].eq(site_accession.str.split("-").str[0])
    )
    quantified = global_protein.isin(quantified_proteins)
    adjusted = adjusted[quantified & canonical].copy()
    adjusted["ProteinMatch"] = np.where(
        exact[quantified & canonical], "exact", "canonical_fallback"
    )
    return adjusted


async def step_ptm_group_comparison(ctx: StepContext) -> None:
    rds_file = ctx.step_outputs.get("rds_file")
    if rds_file is None:
        raise ValueError("No summarized PTM data from stage 4")
    comparisons = ctx.config.comparisons or []
    if not comparisons:
        raise ValueError("No comparisons specified for PTM analysis")

    output_dir = ctx.results_dir / "ptm_comparisons"
    output_dir.mkdir(parents=True, exist_ok=True)
    await ptm_wrapper.group_comparison_multi(
        rds_file=rds_file,
        output_dir=output_dir,
        comparisons=comparisons,
        log_callback=create_log_callback(ctx, step=ctx.current_step_number),
        timeout_multiplier=ctx.timeout_multiplier,
        config=ctx.config,
        ptm_label_type="TMT",
        protein_label_type="TMT",
        adj_method="BH",
    )

    metadata = pd.read_csv(ctx.step_outputs["site_metadata_path"], sep="\t")
    layer_frames: dict[str, list[pd.DataFrame]] = {
        "ptm": [],
        "protein": [],
        "adjusted": [],
    }
    prefixes = {
        "ptm": "PTM_Model_",
        "protein": "PROTEIN_Model_",
        "adjusted": "ADJUSTED_Model_",
    }
    for comparison in comparisons:
        label = build_comparison_pair_label(comparison)
        protein_path = output_dir / f"PROTEIN_Model_{label}.tsv"
        quantified_proteins: set[str] = set()
        if protein_path.exists():
            protein_model = await asyncio.to_thread(pd.read_csv, protein_path, sep="\t")
            if "Protein" in protein_model.columns:
                quantified_proteins = set(protein_model["Protein"].dropna().astype(str))
        for layer, prefix in prefixes.items():
            path = output_dir / f"{prefix}{label}.tsv"
            if not path.exists():
                continue
            frame = await asyncio.to_thread(pd.read_csv, path, sep="\t")
            if layer == "ptm":
                frame = _add_unestimable_sites(frame, metadata, label)
                frame = _merge_site_metadata(frame, metadata)
            elif layer == "adjusted":
                frame = _filter_adjusted_results(
                    frame,
                    metadata,
                    quantified_proteins,
                )
            else:
                frame["ProteinAccession"] = frame.get("Protein", "")
            frame["Comparison"] = label
            frame["Layer"] = layer
            layer_frames[layer].append(frame)

    output_names = {
        "ptm": "ptm_site_results.tsv",
        "protein": "protein_results.tsv",
        "adjusted": "adjusted_ptm_results.tsv",
    }
    result_paths: dict[str, Path | None] = {}
    for layer, frames in layer_frames.items():
        if not frames:
            result_paths[layer] = None
            continue
        combined = pd.concat(frames, ignore_index=True, sort=False)
        path = ctx.results_dir / output_names[layer]
        combined.to_csv(path, sep="\t", index=False, na_rep="NA")
        result_paths[layer] = path

    if result_paths["ptm"] is None:
        raise ValueError("MSstatsPTM produced no PTM comparison results")
    ptm_results = pd.read_csv(result_paths["ptm"], sep="\t")
    adj_column = "adj.pvalue" if "adj.pvalue" in ptm_results else "adjPval"
    ctx.result.significant_proteins = int(
        (pd.to_numeric(ptm_results[adj_column], errors="coerce") < 0.05).sum()
    )
    ctx.result.diff_expression_path = str(result_paths["ptm"])
    ctx.step_outputs.update(
        {
            "ptm_results_path": result_paths["ptm"],
            "protein_results_path": result_paths["protein"],
            "adjusted_results_path": result_paths["adjusted"],
            "comparison_dir": output_dir,
            "de_paths": [result_paths["ptm"]],
            ctx.current_step_number: result_paths["ptm"],
        }
    )
    ctx.state.add_log(
        "info", "PTM group comparison complete", step=ctx.current_step_number
    )
