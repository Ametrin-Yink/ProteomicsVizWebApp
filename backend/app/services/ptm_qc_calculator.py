"""PTM equivalents of the standard protein QC metrics."""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from app.services.qc_calculator import QCCalculator


def _completeness_by_sample(
    data: pd.DataFrame,
    *,
    feature_column: str,
    sample_column: str,
    present_mask: pd.Series,
) -> dict[str, dict[str, int]]:
    all_features = set(data[feature_column].dropna().astype(str))
    result: dict[str, dict[str, int]] = {}
    for sample, sample_data in data.groupby(sample_column):
        sample_present = set(
            sample_data.loc[present_mask.loc[sample_data.index], feature_column]
            .dropna()
            .astype(str)
        )
        result[str(sample)] = {
            "present": len(sample_present),
            "missing": len(all_features - sample_present),
        }
    return result


def _average_present(completeness: dict[str, dict[str, int]]) -> float | None:
    if not completeness:
        return None
    return round(
        sum(item["present"] for item in completeness.values()) / len(completeness),
        1,
    )


def _completeness_rate(completeness: dict[str, dict[str, int]]) -> float | None:
    present = sum(item["present"] for item in completeness.values())
    missing = sum(item["missing"] for item in completeness.values())
    return round(present / (present + missing) * 100, 1) if present + missing else None


def _calculate(
    site_abundance: pd.DataFrame,
    psm_abundance: pd.DataFrame,
    site_results: pd.DataFrame,
) -> dict[str, Any]:
    calculator = QCCalculator()

    sites = site_abundance.copy()
    sites["Sample"] = (
        sites["Condition"].astype(str)
        + "_"
        + sites["Replicate"].astype(str).str.replace(r"\.0$", "", regex=True)
    )
    normalized = pd.to_numeric(sites["NormalizedAbundance"], errors="coerce")
    sites["log2_abundance"] = np.where(normalized > 0, np.log2(normalized), np.nan)
    site_matrix = sites.pivot_table(
        index="ProteinName",
        columns="Sample",
        values="log2_abundance",
        aggfunc="mean",
    ).reset_index()
    site_matrix = site_matrix.rename(columns={"ProteinName": "Protein"})

    psms = psm_abundance.rename(
        columns={"PSM": "Unique_PSM", "Intensity": "Abundance"}
    ).copy()
    replicate_source = psms.get("BioReplicate", psms.get("Channel", "1"))
    psms["Replicate"] = replicate_source.astype(str).str.rsplit("_", n=1).str[-1]
    psms["Abundance"] = pd.to_numeric(psms["Abundance"], errors="coerce")

    imputed = sites.get("Imputed", False)
    if isinstance(imputed, pd.Series):
        imputed = imputed.astype(str).str.lower().isin({"true", "1", "yes"})
    else:
        imputed = pd.Series(False, index=sites.index)
    site_completeness = _completeness_by_sample(
        sites,
        feature_column="ProteinName",
        sample_column="Sample",
        present_mask=(~imputed) & normalized.notna() & (normalized > 0),
    )
    psm_sample = psms["Condition"].astype(str) + "_" + psms["Replicate"].astype(str)
    psms["Sample"] = psm_sample
    psm_completeness = _completeness_by_sample(
        psms,
        feature_column="Unique_PSM",
        sample_column="Sample",
        present_mask=psms["Abundance"].notna() & (psms["Abundance"] > 0),
    )

    site_cv = calculator._calculate_protein_cv(site_matrix)
    psm_cv = calculator._calculate_cv(psms)
    pca = calculator._calculate_pca(site_matrix)
    intensity = calculator._calculate_intensity_distributions(site_matrix, psms)

    pvalue_distributions: dict[str, dict[str, list[float] | list[int]]] = {}
    if "Comparison" in site_results:
        result_groups = site_results.groupby("Comparison")
    else:
        result_groups = [("PTM", site_results)]
    for comparison, comparison_data in result_groups:
        distribution = calculator._calculate_pvalue_distribution(comparison_data)
        pvalue_distributions[str(comparison)] = distribution.model_dump()

    first_distribution = next(
        iter(pvalue_distributions.values()), {"bins": [], "counts": []}
    )
    return {
        "pca": pca.model_dump(),
        "pvalue_distribution": first_distribution,
        "pvalue_distributions": pvalue_distributions,
        "psm_cv": psm_cv,
        "protein_cv": site_cv,
        "intensity_distributions": intensity,
        "data_completeness": site_completeness,
        "psm_completeness": psm_completeness,
        "total_psms": int(psms["Unique_PSM"].nunique()),
        "avg_psms_per_sample": _average_present(psm_completeness),
        "total_proteins": int(site_matrix["Protein"].nunique()),
        "avg_proteins_per_sample": _average_present(site_completeness),
        "average_cv": calculator._calculate_average_cv(site_cv),
        "average_protein_cv": calculator._calculate_average_cv(site_cv),
        "average_psm_cv": calculator._calculate_average_cv(psm_cv),
        "completeness_rate": _completeness_rate(site_completeness),
    }


async def calculate_ptm_qc_plots(results_dir: Path) -> dict[str, Any] | None:
    """Calculate standard QC plots from PTM site and PSM channel matrices."""
    site_path = results_dir / "ptm_site_abundance.tsv"
    psm_path = results_dir / "ptm_msstats_input.tsv"
    result_path = results_dir / "ptm_site_results.tsv"
    if not all(path.exists() for path in (site_path, psm_path, result_path)):
        return None

    site_abundance, psm_abundance, site_results = await asyncio.gather(
        asyncio.to_thread(pd.read_csv, site_path, sep="\t"),
        asyncio.to_thread(pd.read_csv, psm_path, sep="\t"),
        asyncio.to_thread(pd.read_csv, result_path, sep="\t"),
    )
    return await asyncio.to_thread(
        _calculate, site_abundance, psm_abundance, site_results
    )


async def calculate_protein_qc_plots(results_dir: Path) -> dict[str, Any] | None:
    """Calculate matching QC plots when an optional protein matrix exists."""
    summary_path = results_dir / "protein_summarized.tsv"
    psm_path = results_dir / "protein_msstats_input.tsv"
    result_path = results_dir / "protein_results.tsv"
    if not all(path.exists() for path in (summary_path, psm_path, result_path)):
        return None

    summary, psm_abundance, protein_results = await asyncio.gather(
        asyncio.to_thread(pd.read_csv, summary_path, sep="\t"),
        asyncio.to_thread(pd.read_csv, psm_path, sep="\t"),
        asyncio.to_thread(pd.read_csv, result_path, sep="\t"),
    )
    protein_abundance = pd.DataFrame(
        {
            "ProteinName": summary["Protein"],
            "Condition": summary["Condition"],
            "Replicate": summary["BioReplicate"]
            .astype(str)
            .str.rsplit("_", n=1)
            .str[-1],
            "NormalizedAbundance": np.exp2(
                pd.to_numeric(summary["Abundance"], errors="coerce")
            ),
            "Imputed": False,
        }
    )
    return await asyncio.to_thread(
        _calculate, protein_abundance, psm_abundance, protein_results
    )
