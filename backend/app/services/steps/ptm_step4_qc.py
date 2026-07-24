"""PTM stage 6: QC summaries and processed-result ZIP."""

import asyncio
import json
import zipfile
from pathlib import Path

import pandas as pd

from app.services.canonical_qc import generate_canonical_qc
from app.services.pipeline_engine import StepContext
from app.services.visualization_artifacts import (
    COMPARISON_CATALOG,
    DIFFERENTIAL_ARTIFACT,
    PEPTIDE_ARTIFACT,
    PROTEIN_ARTIFACT,
    QC_COMPARISON_METRICS,
    QC_GROUP_METRICS,
    QC_PCA,
    QC_PSM_COMPLETENESS,
    QC_PSM_INTENSITY,
    QC_SAMPLE_METRICS,
    SAMPLE_CATALOG,
    VISUALIZATION_MANIFEST,
    materialize_visualization_artifacts,
)


def _load_json(path: Path | None) -> dict:
    if path is None or not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


async def step_ptm_qc_metrics(ctx: StepContext) -> None:
    ptm_results_path = ctx.step_outputs.get("ptm_results_path")
    if ptm_results_path is None or not ptm_results_path.exists():
        raise ValueError("No PTM result table from stage 5")

    filter_metrics = _load_json(ctx.step_outputs.get("filter_metrics_path"))
    preprocessing = _load_json(ctx.step_outputs.get("qc_path"))
    ptm_results = await asyncio.to_thread(pd.read_csv, ptm_results_path, sep="\t")
    adj_column = "adj.pvalue" if "adj.pvalue" in ptm_results else "adjPval"
    qc = {
        "filters": filter_metrics,
        "preprocessing": preprocessing,
        "results": {
            "ptm_rows": len(ptm_results),
            "ptm_estimated": int(
                (ptm_results.get("Status", "Estimated") == "Estimated").sum()
            )
            if "Status" in ptm_results
            else len(ptm_results),
            "ptm_significant_bh_0_05": int(
                (pd.to_numeric(ptm_results[adj_column], errors="coerce") < 0.05).sum()
            ),
            "protein_layer_available": ctx.step_outputs.get("protein_results_path")
            is not None,
            "adjusted_layer_available": ctx.step_outputs.get("adjusted_results_path")
            is not None,
        },
    }
    qc_json = ctx.results_dir / "ptm_qc.json"
    qc_json.write_text(json.dumps(qc, indent=2), encoding="utf-8")

    qc_rows = []
    for role, metrics in filter_metrics.items():
        if not metrics:
            continue
        for metric, value in metrics.items():
            qc_rows.append(
                {"Section": f"filter_{role}", "Metric": metric, "Value": value}
            )
    normalization = preprocessing.get("normalization", {})
    for metric, value in normalization.items():
        qc_rows.append(
            {
                "Section": "normalization",
                "Metric": metric,
                "Value": json.dumps(value) if isinstance(value, dict) else value,
            }
        )
    for metric, value in qc["results"].items():
        qc_rows.append({"Section": "results", "Metric": metric, "Value": value})
    qc_tsv = ctx.results_dir / "ptm_qc.tsv"
    pd.DataFrame(qc_rows).to_csv(qc_tsv, sep="\t", index=False)

    parameters = {
        "target_modification": ctx.config.ptm_target_modification,
        "resolve_shared_peptides": ctx.config.resolve_shared_peptides,
        "normalization_method": ctx.config.ptm_normalization_method,
        "imputation": ctx.config.ptm_imputation,
        "max_missing_fraction_per_condition": ctx.config.max_missing_fraction_per_condition,
        "average_reporter_sn_min": 5,
        "ptm_isolation_interference_max": 50,
        "protein_chimerys_coefficient_min": 0.8,
        "localization_display_cutoff": 75,
        "comparisons": json.dumps(ctx.config.comparisons),
    }
    parameters_tsv = ctx.results_dir / "run_parameters.tsv"
    pd.DataFrame(
        [{"Parameter": key, "Value": value} for key, value in parameters.items()]
    ).to_csv(parameters_tsv, sep="\t", index=False)

    await asyncio.to_thread(
        materialize_visualization_artifacts,
        ctx.results_dir,
        config=ctx.config,
        pipeline=ctx.config.pipeline.value,
    )
    # Generate canonical QC_Results.json so PTM sessions are visible
    # to the /visualization/qc/* endpoints (Parquet artifacts already exist).
    await asyncio.to_thread(
        generate_canonical_qc,
        ctx.results_dir,
        psm_path=None,  # PTM PSM columns differ; counts come from ptm_qc.json
    )

    candidates = [
        ctx.step_outputs.get("ptm_results_path"),
        ctx.step_outputs.get("protein_results_path"),
        ctx.step_outputs.get("adjusted_results_path"),
        ctx.step_outputs.get("site_metadata_path"),
        ctx.step_outputs.get("peptidoforms_path"),
        ctx.step_outputs.get("evidence_path"),
        ctx.step_outputs.get("abundance_path"),
        ctx.results_dir / "ptm_site_summarized.tsv",
        ctx.results_dir / "protein_summarized.tsv",
        ctx.results_dir / PROTEIN_ARTIFACT,
        ctx.results_dir / PEPTIDE_ARTIFACT,
        ctx.results_dir / SAMPLE_CATALOG,
        ctx.results_dir / COMPARISON_CATALOG,
        ctx.results_dir / DIFFERENTIAL_ARTIFACT,
        ctx.results_dir / QC_SAMPLE_METRICS,
        ctx.results_dir / QC_GROUP_METRICS,
        ctx.results_dir / QC_COMPARISON_METRICS,
        ctx.results_dir / QC_PCA,
        ctx.results_dir / QC_PSM_COMPLETENESS,
        ctx.results_dir / QC_PSM_INTENSITY,
        ctx.results_dir / VISUALIZATION_MANIFEST,
        qc_tsv,
        parameters_tsv,
    ]
    archive = ctx.results_dir / "ptm_results.zip"

    def _write_archive() -> None:
        with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as handle:
            for path in candidates:
                if path is not None and Path(path).exists():
                    handle.write(path, arcname=Path(path).name)

    await asyncio.to_thread(_write_archive)
    ctx.result.qc_results_path = str(qc_json)
    ctx.step_outputs.update(
        {
            "qc_path": qc_json,
            "qc_tsv_path": qc_tsv,
            "run_parameters_path": parameters_tsv,
            "results_zip_path": archive,
            ctx.current_step_number: archive,
        }
    )
    ctx.state.add_log(
        "info", "PTM QC metrics and result ZIP complete", step=ctx.current_step_number
    )
