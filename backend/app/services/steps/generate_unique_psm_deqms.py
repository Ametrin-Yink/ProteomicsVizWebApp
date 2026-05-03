"""DEqMS-specific Step 2: Generate Unique_PSM with PSM count deduplication."""

import logging
import math

from app.services.pipeline_engine import StepContext

logger = logging.getLogger("proteomics")


def _round_half_up(x: float) -> int:
    """Round to nearest integer, with 0.5 rounding up (1.5 -> 2)."""
    return int(math.floor(x + 0.5))


async def step_generate_unique_psm_deqms(ctx: StepContext) -> None:
    """Generate Unique_PSM identifiers.

    If 'Total # PSMs' column exists (from instrument software), deduplicate
    by (Unique_PSM, Sample_Origination), averaging PSM counts and taking
    median of Abundance for duplicate rows.

    If no PSM column, fall back to simple Unique_PSM creation (no deduplication).
    """
    logger.info("Step 2 (DEqMS): Generating unique PSM identifiers")

    # Create unique PSM identifier (same as standard Step 2)
    ctx.df['Unique_PSM'] = (
        ctx.df['Sequence'].astype(str) + '|' +
        ctx.df['Modifications'].astype(str) + '|' +
        ctx.df['Charge'].astype(str)
    )

    # If Total_#_PSMs exists (renamed from 'Total # PSMs' by Step 1), deduplicate and aggregate
    psm_col = 'Total_#_PSMs'
    if psm_col in ctx.df.columns:
        logger.info("  Total_#_PSMs column detected — deduplicating by (Unique_PSM, Sample_Origination)")
        initial_rows = len(ctx.df)

        agg_dict = {
            'Sequence': 'first',
            'Modifications': 'first',
            'Master_Protein_Accessions': 'first',
            'Charge': 'first',
            'Contaminant': 'first',
            'Quan_Info': 'first',
            'Abundance': 'median',
            'Sample_Origination': 'first',
            'Condition': 'first',
            'Replicate': 'first',
            psm_col: 'mean',
        }
        ctx.df = ctx.df.groupby(
            ['Unique_PSM', 'Sample_Origination'], as_index=False
        ).agg(agg_dict)

        # Round PSM counts to nearest integer (<1.5 -> 1, >=1.5 -> 2)
        ctx.df[psm_col] = ctx.df[psm_col].apply(_round_half_up)

        logger.info(
            f"  Deduplicated: {initial_rows} -> {len(ctx.df)} rows, "
            f"{ctx.df['Unique_PSM'].nunique()} unique PSMs"
        )
    else:
        unique_count = ctx.df['Unique_PSM'].nunique()
        logger.info(f"  No PSM count column — {unique_count} unique PSMs")
