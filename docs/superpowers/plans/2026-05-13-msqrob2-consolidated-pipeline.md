# Consolidated msqrob2 Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the msqrob2 pipeline to use the v1.16.0 QFeatures-native API (msqrob() + makeContrast() + hypothesisTest()), consolidating from 8 steps to 5 by moving Python preprocessing into the R QFeatures pipeline.

**Architecture:** Steps 1-2 remain shared Python. Step 3 (R) runs the full QFeatures pipeline from raw PSM through aggregation, saving a QFeatures RDS with colData. Step 4 (R) loads QFeatures, uses msqrob(formula), makeContrast() + hypothesisTest() for DE. Step 5 (Python) runs QC. MSstats pipeline keeps its 8 steps, using its own QC handler (same logic, different step_outputs key).

**Critical decisions:**
- `step_qc_metrics` is split into two: `step_qc_metrics` (MSstats step 8) and `step_qc_metrics_msqrob2` (msqrob2 step 5), because each handler hardcodes its `step_outputs` key and StepContext doesn't expose the current step number
- `_helpers.get_psm_input()` step reference made parameterized (step=5 → optional step param)
- Session data for integration testing must be copied from main repo (`backend/sessions/` is not in git)
- `cond_to_coef` mapping: with `~ 0 + condition`, msqrob parameters ARE the condition level names — `makeContrast(contrast_str, c(cond_x, cond_y))` uses them directly

---

### Task 1: Split qc_metrics handler and update helpers

**Files:**
- Modify: `backend/app/services/steps/qc_metrics.py`
- Create: `backend/app/services/steps/qc_metrics_msqrob2.py` (copy of qc_metrics.py, step 5)
- Modify: `backend/app/services/steps/_helpers.py`
- Modify: `backend/app/services/steps/__init__.py`

**Context:** The current `step_qc_metrics` hardcodes `ctx.step_outputs[8]`. For msqrob2 step 5, we need `ctx.step_outputs[5]`. Create a separate handler rather than modifying the engine. Also fix `get_psm_input` step=5 reference.

- [ ] **Step 1: Make get_psm_input step parameter configurable**

In `backend/app/services/steps/_helpers.py`, change line 46:

```python
def get_psm_input(ctx, step: int = 5) -> Path:
    """Get the PSM input file path for R steps."""
    if not ctx.psm_file_path:
        raise ProcessingError("PSM file not saved", step=step)
    return ctx.psm_file_path
```

- [ ] **Step 2: Create msqrob2-specific QC handler**

Copy `qc_metrics.py` → `qc_metrics_msqrob2.py`, change:
- `ctx.step_outputs[8]` → `ctx.step_outputs[5]`
- Docstring: "Step 8" → "Step 5"
- `step=8` in any log references → `step=5`

```python
"""Step 5: QC metrics calculation (msqrob2 consolidated pipeline)."""

from app.services.pipeline_engine import StepContext
from app.services.qc_calculator import QCCalculator


async def step_qc_metrics_msqrob2(ctx: StepContext) -> None:
    qc_output = ctx.results_dir / "QC_Results.json"
    psm_qc_path = ctx.psm_file_path
    protein_output = ctx.results_dir / "Protein_Abundances.tsv"

    de_paths = sorted(ctx.results_dir.glob("Diff_Expression_*.tsv"))
    if not de_paths:
        legacy = ctx.results_dir / "Diff_Expression.tsv"
        if legacy.exists():
            de_paths = [legacy]
        else:
            raise FileNotFoundError(
                f"No Diff_Expression files found in {ctx.results_dir}"
            )

    qc_calc = QCCalculator()
    qc_data = await qc_calc.calculate_all_metrics(
        protein_abundances_path=protein_output,
        diff_expression_paths=de_paths,
        psm_abundances_path=psm_qc_path,
    )
    qc_calc.save_qc_data(qc_data, qc_output)
    ctx.result.qc_results_path = str(qc_output)
    ctx.step_outputs[5] = qc_output
```

- [ ] **Step 3: Update steps/__init__.py exports**

In `backend/app/services/steps/__init__.py`, add the new handler:

```python
from app.services.steps.qc_metrics_msqrob2 import step_qc_metrics_msqrob2
```

(Keep the existing `step_qc_metrics` import — used by MSstats pipeline.)

- [ ] **Step 4: Commit**

```bash
git add backend/app/services/steps/qc_metrics.py backend/app/services/steps/qc_metrics_msqrob2.py backend/app/services/steps/_helpers.py backend/app/services/steps/__init__.py
git commit -m "refactor: add msqrob2-specific QC handler (step 5), parameterize get_psm_input"
```

---

### Task 2: Rewrite pipeline_registry.py — 5-step msqrob2, 8-step MSstats

**Files:**
- Modify: `backend/app/services/pipeline_registry.py`

**Context:** The msqrob2 pipeline gets 5 steps. MSstats pipeline stays at 8 but now uses `step_qc_metrics` (unchanged) while msqrob2 uses `step_qc_metrics_msqrob2`.

- [ ] **Step 1: Update the register() calls**

Read the current file first, then replace BOTH register calls:

```python
"""Pipeline registry — maps template names to pipeline definitions."""

from app.models.analysis import PipelineTool
from app.services.pipeline_engine import PipelineDefinition, PipelineStep
from app.services.steps import (
    step_combine_replicates,
    step_generate_unique_psm,
    step_remove_razor,
    step_remove_low_quality_default,
    step_filter_criteria_default,
    step_protein_abundance_msqrob2,
    step_multi_condition_de,
    step_msstats_protein_abundance,
    step_msstats_group_comparison,
    step_qc_metrics,
    step_qc_metrics_msqrob2,
)

PIPELINES: dict[str, PipelineDefinition] = {}


def register(template: str, steps: list[PipelineStep]) -> None:
    PIPELINES[template] = PipelineDefinition(template, steps)


# Register msqrob2 consolidated pipeline (5 steps)
# Steps 1-2: Python preprocessing (shared)
# Step 3: R QFeatures → protein abundance
# Step 4: R msqrob() → differential expression
# Step 5: Python QC metrics
register(
    PipelineTool.MSQROB2,
    [
        PipelineStep(
            1, "combine_replicates", "Combining Replicates", step_combine_replicates
        ),
        PipelineStep(
            2, "generate_unique_psm", "Generate Unique PSM", step_generate_unique_psm
        ),
        PipelineStep(
            3,
            "protein_abundance",
            "Protein Abundance (msqrob2/QFeatures)",
            step_protein_abundance_msqrob2,
        ),
        PipelineStep(
            4,
            "differential_expression",
            "Differential Expression (msqrob2)",
            step_multi_condition_de,
        ),
        PipelineStep(5, "qc_metrics", "QC Metrics", step_qc_metrics_msqrob2),
    ],
)

# Register MSstats multi-condition pipeline (8 steps, unchanged)
# Steps 1-5: Python preprocessing
# Step 6: MSstats dataProcess
# Step 7: MSstats groupComparison
# Step 8: QC metrics
register(
    PipelineTool.MSSTATS,
    [
        PipelineStep(
            1, "combine_replicates", "Combining Replicates", step_combine_replicates
        ),
        PipelineStep(
            2, "generate_unique_psm", "Generate Unique PSM", step_generate_unique_psm
        ),
        PipelineStep(3, "remove_razor", "Remove Razor Peptides", step_remove_razor),
        PipelineStep(
            4,
            "remove_low_quality",
            "Remove Low Quality",
            step_remove_low_quality_default,
        ),
        PipelineStep(5, "filter", "Filter by Criteria", step_filter_criteria_default),
        PipelineStep(
            6,
            "protein_abundance",
            "Protein Abundance (MSstats)",
            step_msstats_protein_abundance,
        ),
        PipelineStep(
            7,
            "differential_expression",
            "Differential Expression (MSstats)",
            step_msstats_group_comparison,
        ),
        PipelineStep(8, "qc_metrics", "QC Metrics", step_qc_metrics),
    ],
)
```

- [ ] **Step 2: Verify pipeline registry**

```bash
cd C:/Users/IncyteProteomics/Desktop/Dev/ProteomicsVizWebApp && backend/.venv/Scripts/python.exe -c "
from app.services.pipeline_registry import PIPELINES
for name, p in PIPELINES.items():
    print(f'{name}: {len(p.steps)} steps')
    for s in p.steps:
        print(f'  {s.number}: {s.name} → {s.handler.__name__}')
"
```
Expected: msqrob2 5 steps (handler ends with step_qc_metrics_msqrob2), MSstats 8 steps (handler ends with step_qc_metrics).

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/pipeline_registry.py
git commit -m "refactor: consolidate msqrob2 pipeline to 5 steps, separate QC handlers"
```

---

### Task 3: Update step 1 — save PSM_Combined.parquet

**Files:**
- Modify: `backend/app/services/steps/combine_replicates.py`

- [ ] **Step 1: Rewrite handler to save parquet**

Read the current file, then replace entirely:

```python
"""Step 1: Combine replicates — concatenate PSM CSV files, save to parquet."""

import asyncio
from app.core.config import settings
from app.services.data_processor import DataProcessor, ProcessingConfig
from app.services.pipeline_engine import StepContext


async def step_combine_replicates(ctx: StepContext) -> None:
    processor = DataProcessor(
        ProcessingConfig(
            remove_razor=ctx.config.remove_razor,
            strict_filtering=ctx.config.strict_filtering,
        )
    )
    ctx.df = await asyncio.to_thread(processor.step1_combine_replicates, ctx.file_paths)
    ctx.result.total_psms = len(ctx.df)

    # Save combined PSM file for downstream steps
    psm_path = ctx.results_dir / "PSM_Combined.parquet"
    await asyncio.to_thread(
        ctx.df.to_parquet,
        psm_path,
        engine="pyarrow",
        compression=settings.parquet_compression,
        index=False,
    )
    ctx.psm_file_path = psm_path
    ctx.step_outputs[1] = psm_path
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/services/steps/combine_replicates.py
git commit -m "feat: step 1 saves PSM_Combined.parquet to disk"
```

---

### Task 4: Update step 2 — add Unique_PSM and re-save

**Files:**
- Modify: `backend/app/services/steps/unique_psm.py`

- [ ] **Step 1: Rewrite handler to save with Unique_PSM**

```python
"""Step 2: Generate unique PSM identifiers, re-save to parquet."""

import asyncio
import gc
from app.services.data_processor import DataProcessor, ProcessingConfig
from app.services.pipeline_engine import StepContext


async def step_generate_unique_psm(ctx: StepContext) -> None:
    processor = DataProcessor(
        ProcessingConfig(
            remove_razor=ctx.config.remove_razor,
            strict_filtering=ctx.config.strict_filtering,
        )
    )
    ctx.df = await asyncio.to_thread(processor.step2_generate_unique_psm, ctx.df)

    # Re-save with Unique_PSM column for step 3 (R QFeatures pipeline)
    psm_path = ctx.psm_file_path
    await asyncio.to_thread(
        ctx.df.to_parquet,
        psm_path,
        engine="pyarrow",
        compression="snappy",
        index=False,
    )
    ctx.step_outputs[2] = psm_path

    # Free in-memory DataFrame before R steps
    del ctx.df
    ctx.df = None
    await asyncio.to_thread(gc.collect)
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/services/steps/unique_psm.py
git commit -m "feat: step 2 saves PSM data with Unique_PSM for R step 3"
```

---

### Task 5: Update msqrob2_wrapper.py — new config builders

**Files:**
- Modify: `backend/app/services/msqrob2_wrapper.py`

- [ ] **Step 1: Rewrite both config builder methods**

Read the current file, replace `_build_data_process_config` and `_build_gc_config`:

```python
def _build_data_process_config(self, config: AnalysisConfig, n_cores: int) -> dict:
    """Build config JSON for step 3 (protein abundance via QFeatures)."""
    return {
        "normalization": config.msqrob2_normalization,
        "imputation": config.msqrob2_imputation,
        "aggregation": config.msqrob2_aggregation,
        "min_peptides": config.msqrob2_min_peptides,
        "remove_razor": config.remove_razor,
        "strict_filtering": config.strict_filtering,
        "numberOfCores": n_cores,
        "batch_column": config.msqrob2_batch_column,
        "metadata": config.metadata,
    }

def _build_gc_config(self, config: AnalysisConfig, n_cores: int, **extra) -> dict:
    """Build config JSON for step 4 (differential expression via msqrob v1.16 API)."""
    return {
        "ridge": config.msqrob2_ridge,
        "maxitRob": 10,
        "adjust_method": config.msqrob2_adjust_method,
        "numberOfCores": n_cores,
        "batch_column": config.msqrob2_batch_column,
        "metadata": config.metadata,
    }
```

Note: `model` and `robust` removed — msqrob() always uses robust regression; no msqrobGlm equivalent exists. The `logfc_threshold` and `pvalue_threshold` fields remain in AnalysisConfig unchanged; they are consumed by frontend visualization (volcano, venn) and QC sig-protein counting — no R script or wrapper changes needed.

- [ ] **Step 2: Commit**

```bash
git add backend/app/services/msqrob2_wrapper.py
git commit -m "refactor: update msqrob2 config builders for v1.16 API (no model/robust)"
```

---

### Task 6: Update step 3 handler (protein_abundance.py)

**Files:**
- Modify: `backend/app/services/steps/protein_abundance.py`

**Context:** Step number changes from 6 to 3. `get_psm_input` now receives step=3 parameter. Checkpoint RDS unchanged (`MSqRob2_Processed.rds`).

- [ ] **Step 1: Rewrite handler for step 3**

Read the current file, replace entirely:

```python
"""Step 3: Protein abundance via QFeatures aggregation (msqrob2 consolidated)."""

import asyncio
import logging

import pandas as pd

from app.services.msqrob2_wrapper import msqrob2_wrapper
from app.services.pipeline_engine import StepContext
from app.services.steps._helpers import (
    create_log_callback,
    get_gene_mapping,
    get_psm_input,
)

logger = logging.getLogger("proteomics")


async def step_protein_abundance_msqrob2(ctx: StepContext) -> None:
    """Step 3: Protein abundance via QFeatures aggregation.

    Reads PSM_Combined.parquet (with Unique_PSM from step 2), runs the full
    QFeatures pipeline: filter, log2, normalize, impute, aggregate, gene map,
    batch correct. Saves QFeatures RDS for step 4.
    """
    gene_mapping = get_gene_mapping(ctx.config.organism)
    psm_input = get_psm_input(ctx, step=3)

    protein_output = ctx.results_dir / "Protein_Abundances.tsv"
    rds_output = ctx.results_dir / "MSqRob2_Processed.rds"

    # Checkpoint: skip if valid RDS exists (newer than PSM input)
    if rds_output.exists() and psm_input.exists():
        rds_mtime = rds_output.stat().st_mtime
        psm_mtime = psm_input.stat().st_mtime
        if rds_mtime > psm_mtime:
            logger.info("RDS checkpoint found (newer than input), skipping data_process")
            ctx.state.add_log("info", "Checkpoint found — skipping protein abundance", step=3)
            if protein_output.exists():
                protein_df = await asyncio.to_thread(pd.read_csv, protein_output, sep="\t")
                ctx.result.total_proteins = len(protein_df)
            ctx.result.protein_abundances_path = str(protein_output)
            ctx.step_outputs[3] = rds_output
            return

    logger.info("Step 3: Running protein abundance via QFeatures")

    await msqrob2_wrapper.data_process(
        input_file=psm_input,
        output_file=protein_output,
        rds_output=rds_output,
        gene_mapping_file=gene_mapping,
        config=ctx.config,
        log_callback=create_log_callback(ctx, step=3),
        timeout_multiplier=ctx.timeout_multiplier,
    )

    ctx.result.protein_abundances_path = str(protein_output)
    ctx.step_outputs[3] = rds_output

    protein_df = await asyncio.to_thread(pd.read_csv, protein_output, sep="\t")
    ctx.result.total_proteins = len(protein_df)
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/services/steps/protein_abundance.py
git commit -m "refactor: update step 3 protein abundance handler for consolidated pipeline"
```

---

### Task 7: Update step 4 handler (multi_condition_de.py)

**Files:**
- Modify: `backend/app/services/steps/multi_condition_de.py`

**Context:** Step number changes from 7 to 4. RDS input is now the QFeatures object (same filename). The handler is otherwise unchanged — the new R script handles the API differences.

- [ ] **Step 1: Rewrite handler for step 4**

Read the current file, replace entirely:

```python
"""Step 4: Differential expression analysis (msqrob2 v1.16 API)."""

import asyncio
import logging

import pandas as pd

from app.services.msqrob2_wrapper import msqrob2_wrapper
from app.services.pipeline_engine import StepContext
from app.services.steps._helpers import (
    create_log_callback,
    get_gene_mapping,
)

logger = logging.getLogger("proteomics")


async def step_multi_condition_de(ctx: StepContext) -> None:
    """Step 4: Multi-condition DE using msqrob2 native QFeatures API.

    Loads MSqRob2_Processed.rds (QFeatures object) from step 3, runs
    msqrob() + makeContrast() + hypothesisTest() for all contrasts,
    writes per-comparison Diff_Expression_*.tsv files.
    """
    rds_input = ctx.results_dir / "MSqRob2_Processed.rds"
    if not rds_input.exists():
        raise FileNotFoundError(
            f"MSqRob2_Processed.rds not found at {rds_input}. "
            "Step 3 (protein abundance) must complete first."
        )

    comparisons = ctx.config.comparisons if ctx.config.comparisons else []
    if not comparisons:
        raise ValueError("No comparisons specified for multi-condition analysis")

    logger.info(f"Step 4 (msqrob2 DE): Running {len(comparisons)} comparisons")

    gene_mapping = get_gene_mapping(ctx.config.organism)

    await msqrob2_wrapper.group_comparison_multi(
        rds_file=rds_input,
        output_dir=ctx.results_dir,
        comparisons=comparisons,
        gene_mapping_file=gene_mapping,
        config=ctx.config,
        log_callback=create_log_callback(ctx, step=4),
        timeout_multiplier=ctx.timeout_multiplier,
    )

    if comparisons:
        first = comparisons[0]
        label = _build_label(first["group1"]) + "_vs_" + _build_label(first["group2"])
        ctx.result.diff_expression_path = str(
            ctx.results_dir / f"Diff_Expression_{label}.tsv"
        )

    ctx.step_outputs[4] = ctx.results_dir

    total_sig = 0
    for comp in comparisons:
        label = _build_label(comp["group1"]) + "_vs_" + _build_label(comp["group2"])
        de_file = ctx.results_dir / f"Diff_Expression_{label}.tsv"
        if de_file.exists():
            de_df = await asyncio.to_thread(pd.read_csv, de_file, sep="\t")
            sig_count = len(de_df[de_df["adjPval"] < ctx.config.pvalue_threshold])
            total_sig += sig_count

    ctx.result.significant_proteins = total_sig


def _build_label(group: dict) -> str:
    return "+".join(str(v) for v in group.values())
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/services/steps/multi_condition_de.py
git commit -m "refactor: update step 4 DE handler for consolidated msqrob2 pipeline"
```

---

### Task 8: R Script — msqrob2_data_process.R (step 3)

**Files:**
- Rewrite: `backend/scripts/msqrob2_data_process.R`

**Context:** The step 3 R script now receives `PSM_Combined.parquet` (with Unique_PSM column), runs the full QFeatures pipeline, and saves the QFeatures object as RDS (not a flat list). Critical: set `colData(pe)$sample` for step 4's formula validation.

This is a large rewrite. The plan specifies the complete function flow and critical sections. The full script (~400 lines) follows the current script's structure, adapted for the new API.

- [ ] **Step 1: Write the new R script header and config parsing**

```r
#!/usr/bin/env Rscript
#
# msqrob2 Data Process (Step 3 — consolidated pipeline)
#
# Reads PSM data (parquet/TSV), runs full QFeatures preprocessing pipeline,
# saves QFeatures RDS with colData for step 4 DE analysis.
#
# Usage: Rscript msqrob2_data_process.R <input_file> <output_file> <rds_output>
#        <gene_mapping_file> <config_json>
#
# Config fields:
#   normalization, imputation, aggregation, min_peptides,
#   remove_razor, strict_filtering, numberOfCores, batch_column, metadata

cat("Step 3: msqrob2 data process (QFeatures pipeline)\n")
cat("Loading R packages...\n")
suppressPackageStartupMessages({
    library(data.table)
    library(msqrob2)
    library(QFeatures)
    library(limma)
    library(SummarizedExperiment)
    library(matrixStats)
    library(BiocParallel)
    library(jsonlite)
})
cat("R packages loaded\n")
flush.console()

# Parse command line arguments
args <- commandArgs(trailingOnly = TRUE)
if (length(args) < 5) {
    stop("Usage: Rscript msqrob2_data_process.R <input_file> <output_file> <rds_output> <gene_mapping_file> <config_json>")
}

input_file       <- args[1]
output_file      <- args[2]
rds_output       <- args[3]
gene_mapping_file <- if (nzchar(args[4])) args[4] else NULL
config_json      <- args[5]

config <- fromJSON(config_json, simplifyVector = FALSE)

# Set defaults
if (is.null(config$normalization))  config$normalization  <- "center.median"
if (is.null(config$imputation))     config$imputation     <- "none"
if (is.null(config$aggregation))    config$aggregation    <- "robustSummary"
if (is.null(config$min_peptides))   config$min_peptides   <- 1
if (is.null(config$numberOfCores))  config$numberOfCores  <- 1
if (is.null(config$remove_razor))   config$remove_razor   <- FALSE
if (is.null(config$strict_filtering)) config$strict_filtering <- FALSE

batch_column <- if (!is.null(config$batch_column) && nzchar(config$batch_column)) config$batch_column else NULL
metadata     <- if (!is.null(config$metadata)) config$metadata else list()

cat("Configuration:\n")
cat("  normalization:", config$normalization, "\n")
cat("  imputation:", config$imputation, "\n")
cat("  aggregation:", config$aggregation, "\n")
cat("  min_peptides:", config$min_peptides, "\n")
cat("  remove_razor:", config$remove_razor, "\n")
cat("  strict_filtering:", config$strict_filtering, "\n")
cat("  numberOfCores:", config$numberOfCores, "\n")
cat("  batch_column:", ifelse(is.null(batch_column), "(none)", batch_column), "\n")
flush.console()
```

- [ ] **Step 2: Read and filter PSM data**

```r
# Read input data (auto-detect Parquet vs TSV)
cat("Reading PSM data...\n")
if (grepl("\\.parquet$", input_file, ignore.case = TRUE)) {
    library(arrow)
    psm_data <- as.data.table(read_parquet(input_file))
    cat("Loaded", nrow(psm_data), "PSMs from Parquet\n")
} else {
    psm_data <- fread(input_file, sep = "\t", header = TRUE,
                      stringsAsFactors = FALSE, data.table = TRUE)
    cat("Loaded", nrow(psm_data), "PSMs from TSV\n")
}

# Filter empty Master_Protein_Accessions
cat("Filtering empty accessions...\n")
psm_data <- psm_data[Master_Protein_Accessions != "" & !is.na(Master_Protein_Accessions)]
cat("Filtered to", nrow(psm_data), "PSMs with valid accessions\n")
if (nrow(psm_data) == 0) stop("No PSMs with valid protein accessions")

# Remove contaminants and reverse sequences (if remove_razor configured and columns exist)
if (isTRUE(config$remove_razor)) {
    if ("Contaminant" %in% names(psm_data)) {
        psm_data <- psm_data[is.na(Contaminant) | Contaminant != "+"]
        cat("After contaminant filter:", nrow(psm_data), "PSMs\n")
    }
    if ("Reverse" %in% names(psm_data)) {
        psm_data <- psm_data[is.na(Reverse) | Reverse != "+"]
        cat("After reverse filter:", nrow(psm_data), "PSMs\n")
    }
}
flush.console()
```

- [ ] **Step 3: Reshape and create QFeatures (same dual-path as current)**

```r
# Reshape long→wide or detect wide format
if ("Sample_Origination" %in% names(psm_data)) {
    # Long format: aggregate + dcast
    cat("Data is in long format, reshaping to wide...\n")
    setDT(psm_data)
    psm_dt_agg <- psm_data[, .(Abundance = sum(Abundance, na.rm = TRUE)),
                           by = .(Unique_PSM, Master_Protein_Accessions, Sample_Origination)]
    cat("Aggregated to", nrow(psm_dt_agg), "rows\n")

    psm_wide <- dcast(psm_dt_agg,
                      Unique_PSM + Master_Protein_Accessions ~ Sample_Origination,
                      value.var = "Abundance", fun.aggregate = sum)
    setnames(psm_wide, names(psm_wide), gsub("^Abundance\\.", "", names(psm_wide)))
    cat("Wide format:", nrow(psm_wide), "rows x", ncol(psm_wide), "columns\n")

    sample_cols <- setdiff(names(psm_wide), c("Unique_PSM", "Master_Protein_Accessions"))
    for (col in sample_cols) {
        set(psm_wide, i = which(psm_wide[[col]] == 0), j = col, value = NA_real_)
    }

    all_na_mask <- rowSums(is.na(psm_wide[, ..sample_cols])) == length(sample_cols)
    if (sum(all_na_mask) > 0) psm_wide <- psm_wide[!all_na_mask]

    quant_col_indices <- which(!names(psm_wide) %in% c("Unique_PSM", "Master_Protein_Accessions"))
    pe <- readQFeatures(assayData = psm_wide, quantCols = quant_col_indices, name = "peptide")
    rowData(pe[["peptide"]])$Proteins <- psm_wide$Master_Protein_Accessions
} else {
    # Wide format (TMT)
    cat("Data is in wide format...\n")
    abundance_cols <- grep("^Abundance F[0-9A-Za-z]+ Sample$", names(psm_data), value = TRUE)
    if (length(abundance_cols) == 0) stop("No abundance columns found")

    for (col in abundance_cols) {
        if (!is.numeric(psm_data[[col]]))
            set(psm_data, j = col, value = suppressWarnings(as.numeric(psm_data[[col]])))
    }
    abundance_cols <- abundance_cols[vapply(psm_data[, ..abundance_cols], is.numeric, logical(1))]

    all_na_mask <- rowSums(is.na(psm_data[, ..abundance_cols])) == length(abundance_cols)
    if (sum(all_na_mask) > 0) psm_data <- psm_data[!all_na_mask]

    quant_col_indices <- which(names(psm_data) %in% abundance_cols)
    pe <- readQFeatures(assayData = psm_data, quantCols = quant_col_indices, name = "peptide")
    rowData(pe[["peptide"]])$Proteins <- psm_data$Master_Protein_Accessions
}

cat("Created QFeatures object:", nrow(pe[["peptide"]]), "peptides,", ncol(pe[["peptide"]]), "samples\n")
flush.console()
```

- [ ] **Step 4: Log2, normalize, impute, filter, aggregate**

```r
# Handle overlapping protein groups (if remove_razor configured)
if (isTRUE(config$remove_razor)) {
    cat("Removing overlapping protein groups...\n")
    protein_filter <- rowData(pe[["peptide"]])$Proteins %in%
        smallestUniqueGroups(rowData(pe[["peptide"]])$Proteins)
    pe <- pe[protein_filter, , ]
    cat("  After razor filter:", nrow(pe[["peptide"]]), "peptides\n")
}

# Calculate nNonZero per peptide
rowData(pe[["peptide"]])$nNonZero <- rowSums(assay(pe[["peptide"]]) > 0, na.rm = TRUE)

# Log2 transform
cat("Log2 transforming...\n")
pe <- logTransform(pe, base = 2, i = "peptide", name = "peptideLog")
flush.console()

# Normalize (or skip)
agg_input <- "peptideLog"
if (tolower(config$normalization) != "none") {
    cat("Normalizing:", config$normalization, "\n")
    pe <- normalize(pe, i = "peptideLog", name = "peptideNorm", method = config$normalization)
    agg_input <- "peptideNorm"
} else {
    cat("Normalization: none (skipping)\n")
}
flush.console()

# Impute (or skip)
if (tolower(config$imputation) != "none") {
    cat("Imputing:", config$imputation, "\n")
    pe <- impute(pe, i = agg_input, name = "peptideImputed", method = config$imputation)
    agg_input <- "peptideImputed"
} else {
    cat("Imputation: none (skipping)\n")
}
flush.console()

# Filter peptides by observation count
min_obs <- if (isTRUE(config$strict_filtering)) 2L else 1L
pe <- filterFeatures(pe, ~ nNonZero >= min_obs)
cat("After nNonZero filter (>=", min_obs, "):", nrow(pe[[agg_input]]), "peptides\n")

# Aggregate peptides to protein
agg_fun <- switch(config$aggregation,
    "robustSummary" = MsCoreUtils::robustSummary,
    "medianPolish"  = MsCoreUtils::medianPolish,
    "sum"           = colSums,
    "mean"          = colMeans,
    MsCoreUtils::robustSummary
)

n_cores <- as.integer(config$numberOfCores)
if (n_cores < 1) n_cores <- 1
if (n_cores > 1) {
    param <- tryCatch(SnowParam(workers = n_cores, progressbar = TRUE),
                      error = function(e) SerialParam())
} else {
    param <- SerialParam()
}

cat("Aggregating peptides to protein (", config$aggregation, ")...\n", sep = "")
flush.console()

pe <- tryCatch({
    aggregateFeatures(pe, i = agg_input, fcol = "Proteins", name = "protein",
                      fun = agg_fun, BPPARAM = param)
}, error = function(e) {
    if (inherits(param, "SnowParam")) {
        message("Parallel aggregation failed, retrying serial: ", conditionMessage(e))
        aggregateFeatures(pe, i = agg_input, fcol = "Proteins", name = "protein",
                          fun = agg_fun, BPPARAM = SerialParam())
    } else stop(e)
})

cat("Aggregation complete:", nrow(pe[["protein"]]), "proteins\n")
flush.console()
```

- [ ] **Step 5: Gene mapping, PSM counts, min peptides, colData**

```r
# Extract protein data
protein_ids  <- rownames(pe[["protein"]])
sample_names <- colnames(assay(pe[["protein"]]))

# Gene mapping (same logic as current script)
gene_names <- rep(NA_character_, length(protein_ids))
if (!is.null(gene_mapping_file) && file.exists(gene_mapping_file)) {
    gene_map <- read.delim(gene_mapping_file, sep = "\t", stringsAsFactors = FALSE, check.names = TRUE)
    entry_col <- if ("Entry" %in% names(gene_map)) "Entry" else NULL
    gene_col <- if ("Gene.Names" %in% names(gene_map)) "Gene.Names" else
                if ("Gene_Names" %in% names(gene_map)) "Gene_Names" else
                if ("GeneNames" %in% names(gene_map)) "GeneNames" else NULL
    if ("Gene Names" %in% names(gene_map)) gene_col <- "Gene Names"

    if (!is.null(entry_col) && !is.null(gene_col)) {
        first_gene <- sapply(gene_map[[gene_col]], function(x) {
            if (is.na(x) || x == "" || x == " ") return(NA_character_)
            gsub(";.*$", "", gsub(" .*$", "", x))
        })
        mapping <- setNames(first_gene, gene_map[[entry_col]])
        all_ids <- strsplit(protein_ids, ";")
        flat_ids <- trimws(unlist(all_ids))
        flat_ids_base <- sub("-[0-9]+$", "", flat_ids)
        flat_mapped <- mapping[flat_ids_base]
        group_idx <- rep(seq_along(protein_ids), lengths(all_ids))
        gene_names <- tapply(flat_mapped, group_idx, function(x) {
            non_na <- x[!is.na(x)]
            if (length(non_na) > 0) paste(unique(non_na), collapse = ";") else NA_character_
        })
    }
}
na_mask <- is.na(gene_names)
if (any(na_mask)) gene_names[na_mask] <- sub("-[0-9]+$", "", protein_ids[na_mask])

# PSM counts (using peptide-level table from QFeatures creation)
peptide_proteins <- rowData(pe[["peptide"]])$Proteins
protein_psm_counts <- table(peptide_proteins)
first_accessions <- vapply(strsplit(protein_ids, ";", fixed = TRUE), function(x) x[1], character(1))
psm_counts <- as.integer(protein_psm_counts[first_accessions])
psm_counts[is.na(psm_counts)] <- 0L

# Store gene names and PSM counts in rowData
rowData(pe[["protein"]])$Gene_Name <- gene_names
rowData(pe[["protein"]])$PSM_Count <- psm_counts

# Min peptides filter
if (config$min_peptides > 1) {
    keep_mask <- psm_counts >= config$min_peptides
    keep_mask[is.na(keep_mask)] <- FALSE
    pe <- pe[keep_mask, , ]
    protein_ids <- rownames(pe[["protein"]])
    gene_names <- gene_names[keep_mask]
    psm_counts <- psm_counts[keep_mask]
    cat("Filtered to", sum(keep_mask), "proteins with >=", config$min_peptides, "peptides\n")
}

# Set colData — CRITICAL for step 4 (msqrob formula variables must be in colData)
colData(pe)$sample <- sample_names

cat("colData set with", length(sample_names), "samples\n")
flush.console()
```

- [ ] **Step 6: Batch correction and output**

```r
# Build batch_vector helper (same as current)
build_batch_vector <- function(sample_names, metadata, batch_col) {
  batch_values <- rep(NA_character_, length(sample_names))
  for (i in seq_along(sample_names)) {
    sname <- sample_names[i]
    matched <- FALSE
    for (fname in names(metadata)) {
      entry <- metadata[[fname]]
      cond_keys <- grep("^condition_", names(entry), value = TRUE)
      if (length(cond_keys) == 0) next
      cond_vals <- as.character(unlist(entry[cond_keys]))
      cond_vals <- cond_vals[nzchar(cond_vals)]
      if (length(cond_vals) > 0 &&
          all(vapply(cond_vals, function(v) grepl(v, sname, fixed = TRUE), logical(1)))) {
        bv <- entry[[batch_col]]
        if (!is.null(bv) && nzchar(bv)) { batch_values[i] <- bv; matched <- TRUE }
        break
      }
    }
    if (!matched) {
      for (fname in names(metadata)) {
        entry <- metadata[[fname]]
        exp_val <- entry[["experiment"]]
        if (!is.null(exp_val) && nzchar(exp_val) && grepl(exp_val, sname, fixed = TRUE)) {
          bv <- entry[[batch_col]]
          if (!is.null(bv) && nzchar(bv)) { batch_values[i] <- bv; matched <- TRUE }
          break
        }
      }
    }
  }
  if (any(is.na(batch_values)))
    stop("Could not assign batch for: ", paste(sample_names[is.na(batch_values)], collapse=", "))
  as.factor(batch_values)
}

# Batch correction for visualization
protein_matrix <- assay(pe[["protein"]])
protein_matrix_batch_corrected <- NULL
if (!is.null(batch_column) && length(metadata) > 0) {
    cat("Applying removeBatchEffect for visualization...\n")
    batch_factor <- build_batch_vector(sample_names, metadata, batch_column)
    unique_conditions <- unique(vapply(sample_names, function(sname) {
        for (fname in names(metadata)) {
            entry <- metadata[[fname]]
            cond_keys <- grep("^condition_", names(entry), value = TRUE)
            cond_vals <- as.character(unlist(entry[cond_keys]))
            cond_vals <- cond_vals[nzchar(cond_vals)]
            if (length(cond_vals) > 0 &&
                all(vapply(cond_vals, function(v) grepl(v, sname, fixed = TRUE), logical(1))))
                return(paste(cond_vals, collapse = "+"))
        }
        return(NA_character_)
    }, character(1)))
    col_data_batch <- data.frame(sample = sample_names, condition = factor(unique_conditions))
    batch_design <- model.matrix(~ 0 + condition, data = col_data_batch)
    protein_matrix_batch_corrected <- removeBatchEffect(protein_matrix, batch = batch_factor, design = batch_design)
    cat("  Batch correction applied\n")

    # Store batch-corrected matrix as a QFeatures assay for visualization
    se_bc <- SummarizedExperiment(
        assays = list(abundance = protein_matrix_batch_corrected),
        colData = colData(pe)
    )
    rownames(se_bc) <- rownames(pe[["protein"]])
    pe <- addAssay(pe, se_bc, name = "proteinBatchCorrected")
    cat("  Batch-corrected assay saved as 'proteinBatchCorrected'\n")
}

# Write Protein_Abundances.tsv
output_matrix <- if (!is.null(protein_matrix_batch_corrected)) protein_matrix_batch_corrected else protein_matrix
protein_df <- as.data.frame(output_matrix, stringsAsFactors = FALSE)
protein_df$Master_Protein_Accessions <- protein_ids
protein_df$Gene_Name  <- gene_names
protein_df$PSM_Count  <- psm_counts
id_cols <- c("Master_Protein_Accessions", "Gene_Name", "PSM_Count")
data_cols <- setdiff(names(protein_df), id_cols)
protein_df <- protein_df[, c(id_cols, data_cols)]

cat("Writing Protein_Abundances.tsv...\n")
write.table(protein_df, file = output_file, sep = "\t", row.names = FALSE, quote = FALSE)

# Save QFeatures RDS for step 4
cat("Saving QFeatures RDS...\n")
saveRDS(pe, file = rds_output)

cat("Step 3 complete\n")
flush.console()
```

- [ ] **Step 7: Verify R script syntax**

```bash
"C:/Program Files/R/R-4.5.1/bin/x64/Rscript.exe" --no-save backend/scripts/msqrob2_data_process.R --args 2>&1 | head -5
```
Expected: "Step 3: msqrob2 data process..." then "Usage:" error.

- [ ] **Step 8: Commit**

```bash
git add backend/scripts/msqrob2_data_process.R
git commit -m "refactor: rewrite step 3 R script — QFeatures pipeline with colData"
```

---

### Task 9: R Script — msqrob2_group_comparison_multi.R (step 4)

**Files:**
- Rewrite: `backend/scripts/msqrob2_group_comparison_multi.R`

**Context:** The DE script now loads a QFeatures RDS and uses the msqrob v1.16 API. No more msqrobLm(y=matrix), hypothesisTest(fit, contrast=c(...)), topFeatures(), or SnowParam/bplapply.

- [ ] **Step 1: Write header, config parsing, QFeatures loading**

```r
#!/usr/bin/env Rscript
#
# msqrob2 Group Comparison (Step 4 — consolidated pipeline, v1.16 API)
#
# Loads QFeatures RDS from step 3, runs msqrob() for model fitting,
# makeContrast() + hypothesisTest() for differential expression.
#
# Usage: Rscript msqrob2_group_comparison_multi.R <qfeatures_rds> <output_dir>
#        <comparisons_json> <gene_mapping_file> <config_json>
#
# Config fields: ridge, maxitRob, adjust_method, numberOfCores, batch_column, metadata

suppressPackageStartupMessages({
    library(data.table)
    library(msqrob2)
    library(QFeatures)
    library(limma)
    library(matrixStats)
    library(jsonlite)
    library(BiocParallel)
})

# Parse args
args <- commandArgs(trailingOnly = TRUE)
if (length(args) < 5) {
    stop("Usage: Rscript msqrob2_group_comparison_multi.R <qfeatures_rds> <output_dir> <comparisons_json> <gene_mapping_file> <config_json>")
}

rds_file          <- args[1]
output_dir        <- args[2]
comparisons_json  <- args[3]
gene_mapping_file <- if (nzchar(args[4])) args[4] else NULL
config_json       <- if (nzchar(args[5])) args[5] else "{}"

cat("Step 4 (msqrob2): Differential expression analysis\n")
cat("RDS file:", rds_file, "\n")
flush.console()

# Parse config
config <- tryCatch(fromJSON(config_json, simplifyVector = FALSE),
                   error = function(e) { cat("Warning: Could not parse config JSON\n"); list() })

ridge        <- if (!is.null(config$ridge)) isTRUE(as.logical(config$ridge)) else FALSE
maxitRob     <- if (!is.null(config$maxitRob)) as.integer(config$maxitRob) else 10L
adjust_method <- if (!is.null(config$adjust_method)) as.character(config$adjust_method) else "BH"
n_cores      <- if (!is.null(config$numberOfCores)) as.integer(config$numberOfCores) else 1L
batch_column <- if (!is.null(config$batch_column) && nzchar(config$batch_column)) config$batch_column else NULL
metadata     <- if (!is.null(config$metadata)) config$metadata else list()

if (is.na(n_cores) || n_cores < 1L) n_cores <- 1L

cat("Config: ridge=", ridge, " maxitRob=", maxitRob, " adjust=", adjust_method,
    " n_cores=", n_cores, " batch=", ifelse(is.null(batch_column), "none", batch_column), "\n")
flush.console()

# Load QFeatures RDS from step 3
if (!file.exists(rds_file)) stop(paste("RDS file not found:", rds_file))
pe <- readRDS(rds_file)
cat("Loaded QFeatures:", nrow(pe[["protein"]]), "proteins,", ncol(pe[["protein"]]), "samples\n")
flush.console()

# Extract data from QFeatures
protein_matrix <- assay(pe[["protein"]])
sample_names   <- colnames(pe)
if (is.null(sample_names) || length(sample_names) == 0) {
    sample_names <- colnames(protein_matrix)
}
sample_names <- as.character(sample_names)
dir.create(output_dir, showWarnings = FALSE, recursive = TRUE)
```

- [ ] **Step 2: Parse comparisons and assign conditions**

```r
# Parse comparisons
cat("\nParsing comparisons...\n")
comparisons <- tryCatch(fromJSON(comparisons_json, simplifyVector = FALSE),
                        error = function(e) stop("Failed to parse comparisons JSON: ", conditionMessage(e)))
if (length(comparisons) == 0) stop("No comparisons provided")

# Collect all unique condition values
all_condition_values <- character(0)
comparison_labels <- character(length(comparisons))
for (i in seq_along(comparisons)) {
    comp <- comparisons[[i]]
    if (is.null(comp$group1) || is.null(comp$group2))
        stop(paste("Comparison", i, "missing group1 or group2"))
    g1_values <- as.character(unlist(comp$group1))
    g2_values <- as.character(unlist(comp$group2))
    g1_label <- paste(g1_values, collapse = "+")
    g2_label <- paste(g2_values, collapse = "+")
    comparison_labels[i] <- paste0(g1_label, "_vs_", g2_label)
    all_condition_values <- c(all_condition_values, g1_values, g2_values)
    cat("  Comparison", i, ":", comparison_labels[i], "\n")
}
flush.console()

# Assign conditions to samples (grepl matching, same logic as current)
unique_conditions <- unique(all_condition_values)
unique_conditions <- unique_conditions[order(-nchar(unique_conditions))]
cat("Unique conditions:", paste(unique_conditions, collapse = ", "), "\n")

col_data <- data.frame(sample = sample_names, stringsAsFactors = FALSE)
col_data$condition <- vapply(sample_names, function(sname) {
    for (cond in unique_conditions) {
        if (grepl(cond, sname, ignore.case = TRUE, fixed = TRUE)) return(cond)
    }
    return(NA_character_)
}, character(1), USE.NAMES = FALSE)

if (any(is.na(col_data$condition)))
    stop("Could not assign condition for: ", paste(sample_names[is.na(col_data$condition)], collapse = ", "))

col_data$condition <- factor(col_data$condition, levels = unique_conditions)
cat("Condition distribution:\n")
print(table(col_data$condition))
flush.console()
```

- [ ] **Step 3: Assign batch and set colData**

```r
# Build batch vector helper
build_batch_vector <- function(sample_names, metadata, batch_col) {
  batch_values <- rep(NA_character_, length(sample_names))
  for (i in seq_along(sample_names)) {
    sname <- sample_names[i]
    matched <- FALSE
    for (fname in names(metadata)) {
      entry <- metadata[[fname]]
      cond_keys <- grep("^condition_", names(entry), value = TRUE)
      if (length(cond_keys) == 0) next
      cond_vals <- as.character(unlist(entry[cond_keys]))
      cond_vals <- cond_vals[nzchar(cond_vals)]
      if (length(cond_vals) > 0 &&
          all(vapply(cond_vals, function(v) grepl(v, sname, fixed = TRUE), logical(1)))) {
        bv <- entry[[batch_col]]
        if (!is.null(bv) && nzchar(bv)) { batch_values[i] <- bv; matched <- TRUE }
        break
      }
    }
    if (!matched) {
      for (fname in names(metadata)) {
        exp_val <- entry[["experiment"]]
        if (!is.null(exp_val) && nzchar(exp_val) && grepl(exp_val, sname, fixed = TRUE)) {
          bv <- entry[[batch_col]]
          if (!is.null(bv) && nzchar(bv)) { batch_values[i] <- bv; matched <- TRUE }
          break
        }
      }
    }
  }
  if (any(is.na(batch_values)))
    stop("Could not assign batch for: ", paste(sample_names[is.na(batch_values)], collapse=", "))
  as.factor(batch_values)
}

# Assign batch if configured
has_batch <- !is.null(batch_column) && length(metadata) > 0
if (has_batch) {
    cat("\nAssigning batch from column '", batch_column, "'...\n", sep = "")
    col_data$batch <- build_batch_vector(sample_names, metadata, batch_column)
    cat("Batch distribution:\n")
    print(table(col_data$batch))
}

# Set colData on QFeatures object — REQUIRED for msqrob formula variables
colData(pe) <- DataFrame(col_data, row.names = colnames(pe))
cat("colData set with columns:", paste(colnames(colData(pe)), collapse = ", "), "\n")
flush.console()
```

- [ ] **Step 4: Build formula, fit model with msqrob()**

```r
# Build formula
model_formula <- if (has_batch) {
    as.formula("~ 0 + condition + batch")
} else {
    as.formula("~ 0 + condition")
}
cat("Formula:", deparse(model_formula), "\n")

# Register BiocParallel
if (n_cores > 1L) {
    BPPARAM <- tryCatch(SnowParam(workers = n_cores, progressbar = TRUE),
                        error = function(e) { message("SnowParam failed, using SerialParam"); SerialParam() })
} else {
    BPPARAM <- SerialParam()
}
register(BPPARAM)

# Fit model via msqrob (stores per-protein models in rowData$msqrobModels)
cat("\nFitting msqrob model...\n")
flush.console()

pe <- msqrob(object = pe, i = "protein", formula = model_formula,
             robust = TRUE, ridge = ridge, maxitRob = maxitRob)

cat("Model fitted. rowData columns:", paste(colnames(rowData(pe[["protein"]])), collapse = ", "), "\n")
flush.console()
```

- [ ] **Step 5: Run comparisons (makeContrast + hypothesisTest)**

```r
# Run each comparison
cat("\nRunning comparisons...\n")
flush.console()

# Pre-identify zero-variance proteins
protein_vars <- rowVars(assay(pe[["protein"]]), na.rm = TRUE)
zero_var_mask <- (!is.na(protein_vars) & protein_vars < 1e-10)
zero_var_ids <- if (any(zero_var_mask)) rownames(pe[["protein"]])[zero_var_mask] else character(0)
cat("Zero-variance proteins:", length(zero_var_ids), "\n")

for (i in seq_along(comparisons)) {
    comp <- comparisons[[i]]
    g1_values <- as.character(unlist(comp$group1))
    g2_values <- as.character(unlist(comp$group2))
    g1_label <- paste(g1_values, collapse = "+")
    g2_label <- paste(g2_values, collapse = "+")
    label <- comparison_labels[i]

    # Find condition factor levels matching group values
    # With ~ 0 + condition, msqrob parameters = condition level names
    cond_levels <- levels(colData(pe)$condition)
    cond_x <- cond_levels[vapply(cond_levels, function(lv) {
        all(vapply(g1_values, function(v) grepl(v, lv, fixed = TRUE), logical(1)))
    }, logical(1))]
    cond_y <- cond_levels[vapply(cond_levels, function(lv) {
        all(vapply(g2_values, function(v) grepl(v, lv, fixed = TRUE), logical(1)))
    }, logical(1))]

    # For multi-condition, match the combined condition string
    if (length(cond_x) == 0) {
        cond_x <- cond_levels[vapply(cond_levels, function(lv) {
            all(vapply(g1_values, function(v) grepl(v, lv, fixed = TRUE), logical(1)))
        }, logical(1))]
    }
    if (length(cond_x) == 0) cond_x <- g1_label
    if (length(cond_y) == 0) cond_y <- g2_label
    cond_x <- cond_x[1]
    cond_y <- cond_y[1]

    contrast_str <- paste0(cond_x, " - ", cond_y, " = 0")
    cat("  Comparison", i, ":", contrast_str, "\n")

    L <- makeContrast(contrast_str, c(cond_x, cond_y))

    pe <- hypothesisTest(pe, i = "protein", contrast = L,
                         adjust.method = adjust_method, overwrite = TRUE)

    # Extract results from rowData
    result_col <- colnames(L)[1]  # e.g. "condX - condY"
    results <- as.data.frame(rowData(pe[["protein"]])[[result_col]])

    # Map to output contract
    results$Master_Protein_Accessions <- rownames(results)
    results$Gene_Name <- rowData(pe[["protein"]])$Gene_Name
    results$PSM_Count <- rowData(pe[["protein"]])$PSM_Count

    # Select standard columns
    out_cols <- c("Master_Protein_Accessions", "Gene_Name", "PSM_Count",
                  "logFC", "pval", "adjPval", "se", "df")
    results_out <- results[, out_cols, drop = FALSE]

    # Overwrite zero-variance protein rows with NA p-values
    # (msqrob may compute values for them; we reset to contract: logFC=0, pval=NA)
    if (length(zero_var_ids) > 0) {
        zv_in_results <- intersect(zero_var_ids, results_out$Master_Protein_Accessions)
        if (length(zv_in_results) > 0) {
            idx <- match(zv_in_results, results_out$Master_Protein_Accessions)
            results_out$logFC[idx] <- 0
            results_out$pval[idx] <- NA_real_
            results_out$adjPval[idx] <- NA_real_
            results_out$se[idx] <- NA_real_
            results_out$df[idx] <- NA_integer_
        }
    }

    output_file <- file.path(output_dir, paste0("Diff_Expression_", label, ".tsv"))
    write.table(results_out, file = output_file, sep = "\t", row.names = FALSE, quote = FALSE, na = "NA")

    sig_count <- sum(results_out$adjPval < 0.05, na.rm = TRUE)
    cat("    ", label, ":", nrow(results_out), "proteins,", sig_count, "significant\n")
}

cat("\nStep 4 complete\n")
flush.console()
```

- [ ] **Step 6: Verify R script syntax**

```bash
"C:/Program Files/R/R-4.5.1/bin/x64/Rscript.exe" --no-save backend/scripts/msqrob2_group_comparison_multi.R --args 2>&1 | head -5
```
Expected: package loading messages, then "Usage:" error.

- [ ] **Step 7: Commit**

```bash
git add backend/scripts/msqrob2_group_comparison_multi.R
git commit -m "refactor: rewrite step 4 R script — msqrob v1.16 makeContrast hypothesisTest API"
```

---

### Task 10: Model update — deprecate msqrob2_model and msqrob2_robust

**Files:**
- Modify: `backend/app/models/analysis.py`

- [ ] **Step 1: Update field descriptions**

```python
msqrob2_model: str = Field(
    default="msqrobLm",
    description="[DEPRECATED in v1.16] msqrob() replaces msqrobLm; no msqrobGlm. Value ignored.",
)
msqrob2_robust: bool = Field(
    default=True,
    description="[DEPRECATED in v1.16] msqrob() always uses robust regression. Value ignored.",
)
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/models/analysis.py
git commit -m "docs: deprecate msqrob2_model and msqrob2_robust (no-op in v1.16 API)"
```

---

### Task 11: Integration test with session data

**Context:** The worktree doesn't have the test session data (`backend/sessions/` is gitignored). Copy it from the main repo for testing.

- [ ] **Step 1: Copy session data from main repo**

```bash
cp -r C:/Users/IncyteProteomics/Desktop/Dev/ProteomicsVizWebApp/backend/sessions/99b2de1b-f049-4730-a7fa-fbd5e08925a3 \
     C:/Users/IncyteProteomics/Desktop/Dev/ProteomicsVizWebApp/.claude/worktrees/msqrob2-consolidated-rewrite/backend/sessions/99b2de1b-f049-4730-a7fa-fbd5e08925a3

# Verify session exists in worktree
ls C:/Users/IncyteProteomics/Desktop/Dev/ProteomicsVizWebApp/.claude/worktrees/msqrob2-consolidated-rewrite/backend/sessions/99b2de1b-f049-4730-a7fa-fbd5e08925a3/results/
```

- [ ] **Step 2: Clean old results, kill Python, clear cache**

```bash
rm -f C:/Users/IncyteProteomics/Desktop/Dev/ProteomicsVizWebApp/.claude/worktrees/msqrob2-consolidated-rewrite/backend/sessions/99b2de1b-f049-4730-a7fa-fbd5e08925a3/results/MSqRob2_Processed.rds
rm -f C:/Users/IncyteProteomics/Desktop/Dev/ProteomicsVizWebApp/.claude/worktrees/msqrob2-consolidated-rewrite/backend/sessions/99b2de1b-f049-4730-a7fa-fbd5e08925a3/results/.msqrob2_fit.rds
rm -f "C:/Users/IncyteProteomics/Desktop/Dev/ProteomicsVizWebApp/.claude/worktrees/msqrob2-consolidated-rewrite/backend/sessions/99b2de1b-f049-4730-a7fa-fbd5e08925a3/results/Diff_Expression_"*
rm -f C:/Users/IncyteProteomics/Desktop/Dev/ProteomicsVizWebApp/.claude/worktrees/msqrob2-consolidated-rewrite/backend/sessions/99b2de1b-f049-4730-a7fa-fbd5e08925a3/results/PSM_Combined.parquet

taskkill //F //IM python.exe 2>&1
find C:/Users/IncyteProteomics/Desktop/Dev/ProteomicsVizWebApp/.claude/worktrees/msqrob2-consolidated-rewrite/backend -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null
```

- [ ] **Step 3: Start backend and retry**

```bash
cd C:/Users/IncyteProteomics/Desktop/Dev/ProteomicsVizWebApp/.claude/worktrees/msqrob2-consolidated-rewrite/backend && \
  .venv/Scripts/python.exe -m uvicorn app.main:app --reload --reload-exclude "sessions" --port 8000 &

sleep 8 && curl -s -X POST http://localhost:8000/api/sessions/99b2de1b-f049-4730-a7fa-fbd5e08925a3/retry
```
Expected: `{"data":{"status":"started"}}`

- [ ] **Step 4: Monitor until completion**

```bash
while true; do
  state=$(curl -s http://localhost:8000/api/sessions/99b2de1b-f049-4730-a7fa-fbd5e08925a3 | python -c "import sys,json;print(json.load(sys.stdin)['data']['state'])")
  echo "[$(date +%H:%M:%S)] State=$state"
  [ "$state" = "completed" ] || [ "$state" = "error" ] && break
  sleep 60
done
```

- [ ] **Step 5: Verify output files**

```bash
ls -1 C:/Users/IncyteProteomics/Desktop/Dev/ProteomicsVizWebApp/.claude/worktrees/msqrob2-consolidated-rewrite/backend/sessions/99b2de1b-f049-4730-a7fa-fbd5e08925a3/results/Diff_Expression_*.tsv | wc -l
# Expected: 8

head -q -n1 C:/Users/IncyteProteomics/Desktop/Dev/ProteomicsVizWebApp/.claude/worktrees/msqrob2-consolidated-rewrite/backend/sessions/99b2de1b-f049-4730-a7fa-fbd5e08925a3/results/Diff_Expression_*_vs_*.tsv | head -1
# Expected: Master_Protein_Accessions	Gene_Name	PSM_Count	logFC	pval	adjPval	se	df
```

- [ ] **Step 6: Commit any fixes**

---

### Task 12: Verify MSstats pipeline and run tests

**Files:**
- Test: `backend/.venv/Scripts/python.exe -m pytest Tests/backend/unit -v`

- [ ] **Step 1: Verify MSstats pipeline definition**

```bash
cd C:/Users/IncyteProteomics/Desktop/Dev/ProteomicsVizWebApp/.claude/worktrees/msqrob2-consolidated-rewrite && \
  backend/.venv/Scripts/python.exe -c "
from app.services.pipeline_registry import PIPELINES
from app.models.analysis import PipelineTool
p = PIPELINES[PipelineTool.MSSTATS]
print('MSstats steps:')
for s in p.steps:
    print(f'  {s.number}: {s.name} → {s.handler.__name__}')
"
```
Expected: 8 steps, step_remove_razor at step 3, step_msstats_protein_abundance at step 6, step_qc_metrics at step 8.

- [ ] **Step 2: Run all backend unit tests**

```bash
cd C:/Users/IncyteProteomics/Desktop/Dev/ProteomicsVizWebApp/.claude/worktrees/msqrob2-consolidated-rewrite && \
  backend/.venv/Scripts/python.exe -m pytest Tests/backend/unit -v \
  --ignore=Tests/backend/unit/test_compare_service.py -q
```
Expected: 107 passed (no regressions).

- [ ] **Step 3: Frontend build**

```bash
cd C:/Users/IncyteProteomics/Desktop/Dev/ProteomicsVizWebApp/.claude/worktrees/msqrob2-consolidated-rewrite/frontend && npm run build 2>&1 | tail -5
```
Expected: `✓ Compiled successfully`

- [ ] **Step 4: Commit**

```bash
git commit -m "test: MSstats pipeline intact, all tests pass after msqrob2 consolidation" --allow-empty
```
