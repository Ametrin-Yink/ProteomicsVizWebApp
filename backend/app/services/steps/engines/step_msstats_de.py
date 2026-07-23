"""Step 7 (MSstats): Multi-condition DE via MSstats groupComparison.

Moved from steps/group_comparison_multi.py (step_msstats_group_comparison).
"""

import asyncio
import logging

from app.core.config import settings
from app.services.msstats_wrapper import msstats_wrapper
from app.services.pipeline_engine import StepContext
from app.services.steps._helpers import (
    count_significant_differential,
    create_log_callback,
    differential_output_paths,
    get_gene_mapping,
    primary_differential_output,
)

logger = logging.getLogger("proteomics")


async def step_msstats_group_comparison(ctx: StepContext) -> None:
    """Step 7 (MSstats): Multi-condition DE via MSstats groupComparison.

    Loads MSstats_Processed.rds from step 6, runs groupComparison for all
    contrasts, and writes consolidated differential-result TSV shards.
    """
    current_step = ctx.current_step_number or 7
    rds_input = ctx.results_dir / "MSstats_Processed.rds"
    if not rds_input.exists():
        raise FileNotFoundError(
            f"MSstats_Processed.rds not found at {rds_input}. "
            "Step 6 (dataProcess) must complete first."
        )

    comparisons = ctx.config.comparisons if ctx.config.comparisons else []
    if not comparisons:
        if ctx.config.treatment and ctx.config.control:
            comparisons = [
                {"treatment": ctx.config.treatment, "control": ctx.config.control}
            ]
        else:
            raise ValueError("No comparisons specified for multi-condition analysis")

    logger.info(
        f"Step {current_step} (MSstats groupComparison): Running {len(comparisons)} comparisons"
    )

    # Only pass covariates when explicitly selected by the user.
    covariate_data = {}
    covariate_cols = getattr(ctx.config, "covariate_columns", None)
    if covariate_cols:
        full_meta = ctx.config.metadata or {}
        selected_cols = set(covariate_cols)
        covariate_data = {
            fn: {k: v for k, v in cols.items() if k in selected_cols}
            for fn, cols in full_meta.items()
        }

    gene_mapping = get_gene_mapping(ctx.config.organism)
    log_base = ctx.config.msstats_log_base or 2
    save_fitted_models = ctx.config.msstats_save_fitted_models
    log_cb = create_log_callback(ctx, step=current_step)

    common = dict(
        rds_file=rds_input,
        output_dir=ctx.results_dir,
        comparisons=comparisons,
        gene_mapping_file=gene_mapping,
        covariates=covariate_data,
        log_base=log_base,
        save_fitted_models=save_fitted_models,
        log_callback=log_cb,
        timeout_multiplier=ctx.timeout_multiplier,
    )

    is_batched = len(comparisons) > settings.msstats_batch_size
    if is_batched:
        await msstats_wrapper.group_comparison_batched(
            **common,
            batch_size=settings.msstats_batch_size,
            max_workers=settings.msstats_max_workers,
            n_cores_cap=settings.msstats_n_cores_cap,
        )
    else:
        await msstats_wrapper.group_comparison_multi(
            **common,
            config=ctx.config,
        )

    ctx.result.diff_expression_path = str(
        primary_differential_output(ctx.results_dir, batched=is_batched)
    )
    de_paths = differential_output_paths(ctx.results_dir)
    ctx.result.significant_proteins = await asyncio.to_thread(
        count_significant_differential,
        de_paths,
        ctx.config.pvalue_threshold,
    )
    ctx.step_outputs[current_step] = ctx.results_dir
