# MSstatsPTM — Package Introduction

## Overview

**MSstatsPTM** (v2.15.0, Bioconductor) is an R package from the Vitek Lab at Northeastern University that provides statistical methods for quantitative characterization of post-translational modifications (PTMs) in mass spectrometry-based proteomics experiments. It is part of the broader MSstats ecosystem alongside MSstats (label-free protein-level), MSstatsTMT (TMT protein-level), and MSstatsBioNet (network analysis).

**Repository:** <https://github.com/Vitek-Lab/MSstatsPTM>
**Documentation:** <https://vitek-lab.github.io/MSstatsPTM/>
**License:** Artistic-2.0 (same as R itself)
**Bioconductor:** Standard `BiocManager::install("MSstatsPTM")` installation

## Two Operating Modes

MSstatsPTM supports **two input configurations**, making it flexible for different experimental designs:

### Mode A: PTM-Only (Single Dataset)

**Input:** PTM-enriched quantification data only. No global proteome profiling run required.

**Output:** `PTM.Model` — differential abundance of modified peptides/sites, using the same linear mixed effects statistical framework as MSstats. This gives you statistically rigorous PTM-level results (log2FC, p-values, adjusted p-values) summarized to the modification site level.

**When to use:** You only have PTM enrichment data and no matching global proteome run. This is the minimum viable input — you can always add protein data later.

### Mode B: PTM + Global Proteome (Dual Dataset)

**Input:** Both PTM-enriched data AND a separate global (unmodified) proteome profiling run.

**Output:** All three models — `PTM.Model`, `PROTEIN.Model`, and `ADJUSTED.Model`.

**Key insight:** When studying PTMs, a change in modified peptide abundance could mean either (a) the modification stoichiometry genuinely changed, or (b) the underlying protein abundance changed. Mode B **deconvolutes** these two effects by statistically adjusting the PTM fold change for changes in unmodified protein abundance:

```
adjusted_log2FC = log2FC(PTM) − log2FC(Protein)
```

This is the package's defining innovation — it answers "did the modification change beyond what's explained by protein-level changes?"

**When to use:** You ran both an enrichment (e.g., phospho-enriched) and a global profiling run from the same samples. This is the recommended design for publication-quality PTM analysis.

### Bridging Mode A → B

Most converters offer a `use_unmod_peptides=TRUE` option that extracts unmodified peptides from the enriched sample to serve as a rough proxy for protein-level data. This is **not a substitute** for a proper global profiling run but can provide preliminary adjustment when no separate run is available. The `ADJUSTED.Model` output flags which PTMs were successfully adjusted and which were not.

## Purpose

Post-translational modifications — phosphorylation, ubiquitination, acetylation, methylation, etc. — are critical regulators of protein function. MSstatsPTM provides a complete statistical workflow for PTM quantification: from raw search engine output through normalization, summarization, differential testing, and visualization. In its fullest form (Mode B), it solves the fundamental confounding problem in PTM analysis — **disentangling modification-level regulation from protein-level abundance changes.**

## Key Innovation: Protein-Level Adjustment

When both PTM and global proteome data are provided (Mode B), the package produces three statistical models:

| Model | Description |
|-------|-------------|
| **PTM.Model** | Direct differential abundance of modified peptides — what a naive PTM-only analysis would report |
| **PROTEIN.Model** | Differential abundance of the unmodified (global) proteins from the profiling run |
| **ADJUSTED.Model** | PTM fold change with the protein-level change subtracted: log2FC(PTM) − log2FC(Protein) |

In Mode A (PTM-only), only `PTM.Model` is returned — still a fully valid differential analysis, just without the protein-level deconvolution.

The adjustment (Mode B) uses a **linear mixed effects model** and is implemented via Rcpp (C++) for performance. For each comparison label, the function subtracts the protein log2FC from the PTM log2FC and propagates standard errors using the Welch-Satterthwaite approximation for degrees of freedom. PTMs without a matching protein in the global profiling run are flagged as unadjusted rather than silently dropped.

## Experimental Designs Supported

| Feature | Support |
|---------|---------|
| **Labeling** | Label-Free (LF), Tandem Mass Tags (TMT) |
| **Acquisition** | DDA, DIA, SRM, PRM |
| **PTM Types** | Phosphorylation (most tested), Ubiquitination, Acetylation, Methylation, and any other modification with a known mass shift |

## Supported Search/Processing Tools (10 Converters)

MSstatsPTM provides dedicated converter functions that ingest raw output from the most common proteomics search engines and spectral processing tools, perform **PTM site localization** via FASTA-guided mapping, and produce the standardized input format expected by the downstream pipeline:

| Converter | Labeling | Key Input Files |
|-----------|----------|-----------------|
| `MaxQtoMSstatsPTMFormat` | LF, TMT | `evidence.txt`, annotation, FASTA |
| `FragPipetoMSstatsPTMFormat` | LF, TMT | `msstats.csv`, annotation, optional protein input |
| `PDtoMSstatsPTMFormat` | LF, TMT | PD PSM report, annotation, FASTA |
| `SpectronauttoMSstatsPTMFormat` | LF | Spectronaut PSM export, annotation, FASTA |
| `SkylinetoMSstatsPTMFormat` | LF | Skyline report, annotation, FASTA |
| `DIANNtoMSstatsPTMFormat` | LF | `report.tsv`, annotation, FASTA |
| `ProgenesistoMSstatsPTMFormat` | LF | Progenesis peptide export, annotation |
| `PStoMSstatsPTMFormat` | LF | PEAKS Studio PTM export, annotation |
| `MetamorpheusToMSstatsPTMFormat` | LF | `AllQuantifiedPeaks.tsv`, annotation, FASTA |
| `ProteinProspectortoMSstatsPTMFormat` | TMT | Protein Prospector txt report, annotation |

All converters accept optional **global profiling data** (separate unmodified protein input with its own annotation). If a separate profiling run is unavailable, most converters offer a `use_unmod_peptides=TRUE` option to extract unmodified peptides from the enriched sample as a proxy (not recommended for rigorous analysis).

### The FASTA Requirement

A FASTA file is required by most converters because search tools typically report modification positions relative to the peptide, not the full protein. MSstatsPTM uses `MSstatsPTMSiteLocator()` (a core internal function) to map the peptide-level modification back to the full protein sequence via the FASTA file, producing a canonical site annotation (e.g., "Q9UQ80_K376" for lysine 376 of protein Q9UQ80). This ensures consistent site naming across the analysis.

## Complete Analysis Workflow

### Step 1: Data Conversion

```r
# Example with MaxQuant label-free data
msstats_format = MaxQtoMSstatsPTMFormat(
    evidence = maxq_evidence,
    annotation = annotation,
    fasta_path = "uniprot.fasta",
    mod_id = "\\(Phospho \\(STY\\)\\)",
    use_unmod_peptides = TRUE,
    labeling_type = "LF"
)
# Returns list(PTM = data.table, PROTEIN = data.table)
```

### Step 2: Summarization

```r
# Label-Free
summarized = dataSummarizationPTM(
    msstats_format,
    normalization = "equalizeMedians",    # or "quantile", "globalStandards", FALSE
    summaryMethod = "TMP",                # Tukey's median polish (default) or "linear"
    MBimpute = TRUE,                      # Accelerated failure model for missing values
    censoredInt = "NA"                    # Treat NAs as censored below detection limit
)
# Returns list(PTM = ..., PROTEIN = ...) with $FeatureLevelData and $ProteinLevelData

# TMT
summarized = dataSummarizationPTM_TMT(
    msstats_format,
    method = "msstats",                   # or "MedianPolish", "Median", "LogSum"
    global_norm = TRUE,                   # Global median normalization
    reference_norm = TRUE                 # Reference channel normalization
)
```

Key summarization features:
- **Normalization:** equalizeMedians, quantile, global standards, or none
- **Missing value imputation:** Accelerated failure time model (MBimpute) or minimum value
- **Feature selection:** all features, top3, topN, or highQuality (with outlier removal)
- **Run-level summarization:** Tukey's median polish (robust) or linear mixed model

### Step 3: Group Comparison (Statistical Testing)

```r
model = groupComparisonPTM(
    summarized,
    ptm_label_type = "LF",
    protein_label_type = "LF",
    contrast.matrix = "pairwise",         # or a custom matrix
    moderated = FALSE,                    # TRUE for empirical Bayes moderation (TMT)
    adj.method = "BH",                    # Benjamini-Hochberg multiple testing correction
    save_fitted_models = TRUE
)
# Returns list(
#   PTM.Model,           # Unadjusted PTM results
#   PROTEIN.Model,        # Global protein results
#   ADJUSTED.Model,       # Protein-adjusted PTM results ← KEY OUTPUT
#   Model.Details         # Fitted model objects (PTM + PROTEIN)
# )
```

The `ADJUSTED.Model` contains:
- `Protein`: The PTM site identifier (e.g., "Q9UQ80_K376")
- `GlobalProtein`: The unmodified protein name
- `Label`: Comparison pair (e.g., "Treatment-Control")
- `log2FC`: **Adjusted** log2 fold change (PTM − Protein)
- `SE`, `Tvalue`, `DF`, `pvalue`: Standard error, t-statistic, degrees of freedom, p-value
- `adj.pvalue`: Benjamini-Hochberg adjusted p-value
- `Adjusted`: TRUE/FALSE flag indicating whether protein-level adjustment was possible
- Issue/`MissingPercentage`/`ImputationPercentage`: Data quality flags

### Step 4: Visualization

**Before modeling (QC/EDA):**
```r
# Quality control boxplots
dataProcessPlotsPTM(summarized, type = "QCPlot", which.PTM = "allonly")

# Per-protein profile plots (log-intensity across runs)
dataProcessPlotsPTM(summarized, type = "ProfilePlot",
                    which.Protein = "Q9Y6C9")
```

**After modeling (results visualization):**
```r
# Volcano plot (3 panels: PTM, Protein, Adjusted)
groupComparisonPlotsPTM(model, type = "VolcanoPlot",
                        FCcutoff = 2, logBase.pvalue = 2)

# Heatmap of significant changes
groupComparisonPlotsPTM(model, type = "Heatmap",
                        which.PTM = 1:30)
```

Both visualization functions support Plotly interactivity (`isPlotly = TRUE`) and can save output as PDF (ggplot2) or HTML (Plotly).

### Step 5: Sample Size Calculation

```r
sample_size = designSampleSizePTM(model, desiredFC = c(2.0, 2.75),
                                   FDR = 0.05, power = 0.8)
MSstats::designSampleSizePlots(sample_size)
```

## Architecture & Dependencies

### Core Dependencies

| Package | Role |
|---------|------|
| **MSstats** (≥ 4.0) | Label-free data processing (`dataProcess`), group comparison (`groupComparison`), contrast matrix construction |
| **MSstatsTMT** | TMT data processing (`proteinSummarization`), TMT group comparison (`groupComparisonTMT`) |
| **MSstatsConvert** (≥ 1.19.1) | Converter base classes (`DIANNtoMSstatsFormat`, `FragPipetoMSstatsFormat`, etc.), balanced design, logging |
| **Rcpp** | C++ integration for the protein name extraction algorithm |
| **Biostrings** | FASTA file reading (`readAAStringSet`) |
| **data.table** | High-performance data manipulation throughout |
| **ggplot2** + **plotly** + **ggrepel** | Static and interactive visualization |
| **checkmate** | Input validation |

### Internal Architecture

```
User Input (raw tool output)
    │
    ▼
┌─────────────────────────────┐
│  Converter Functions (10)   │  ← MSstatsPTMSiteLocator (FASTA mapping)
│  e.g., MaxQtoMSstatsPTMFormat│     .checkAnnotation, .checkDataProcessParams
└──────────────┬──────────────┘
               │ list(PTM, PROTEIN)
               ▼
┌─────────────────────────────┐
│  dataSummarizationPTM /     │  ← MSstats::dataProcess (LF)
│  dataSummarizationPTM_TMT   │  ← MSstatsTMT::proteinSummarization (TMT)
└──────────────┬──────────────┘
               │ list(PTM = summarized, PROTEIN = summarized)
               ▼
┌─────────────────────────────┐
│  groupComparisonPTM         │  ← MSstats::groupComparison (LF)
│                             │  ← MSstatsTMT::groupComparisonTMT (TMT)
│  ┌───────────────────────┐  │
│  │ .extractProtein       │  │  ← Rcpp C++: extract_protein_name()
│  │ .applyPtmAdjustment   │  │  ← .adjustProteinLevel:
│  │   per comparison:     │  │      log2FC_adj = log2FC_PTM - log2FC_Prot
│  │   Welch-Satterthwaite │  │      SE_adj = sqrt(SE_PTM² + SE_Prot²)
│  │   DF approximation    │  │      DF_adj = (s²_PTM + s²_Prot)² /
│  │                       │  │               (s⁴_PTM/DF_PTM + s⁴_Prot/DF_Prot)
│  └───────────────────────┘  │
└──────────────┬──────────────┘
               │ list(PTM.Model, PROTEIN.Model, ADJUSTED.Model, Model.Details)
               ▼
┌─────────────────────────────┐
│  groupComparisonPlotsPTM    │  ← Volcano, Heatmap per model type
│  dataProcessPlotsPTM        │  ← QC Plot, Profile Plot (pre-modeling)
│  designSampleSizePTM        │  ← Power analysis
└─────────────────────────────┘
```

### Rcpp C++ Bridge

The package uses C++ (via Rcpp) for one specific operation: `extract_protein_name()`. Given a vector of PTM site identifiers (e.g., "Q9UQ80_K376") and a vector of global protein names (e.g., "Q9UQ80"), it matches each PTM site to its parent protein. This is a string-matching operation that benefits from C++ performance when processing thousands of PTM sites.

## Input Data Format Requirements

### Label-Free (MSstats Format)

Required columns in the converted PTM/PROTEIN data.tables:
- `ProteinName` — For PTM data: combined protein + site (e.g., "Q9UQ80_K376"). For Protein data: protein accession.
- `PeptideSequence` — Amino acid sequence
- `PrecursorCharge` — Charge state of precursor
- `FragmentIon` — Fragment ion identifier
- `ProductCharge` — Product ion charge
- `IsotopeLabelType` — "L" for light, "H" for heavy
- `Condition` — Experimental condition (e.g., "Treatment", "Control")
- `BioReplicate` — Biological replicate number
- `Run` — MS run identifier
- `Intensity` — Quantitative intensity value
- `Fraction` — (optional) fraction number for 2D-LC

### TMT (MSstatsTMT Format)

Required columns:
- `ProteinName` — Same as LF
- `PeptideSequence` — Same as LF
- `Charge` — Precursor charge
- `PSM` — PSM identifier
- `Mixture` — TMT mixture number
- `TechRepMixture` — Technical replicate within mixture
- `Run` — MS run
- `Channel` — TMT channel (e.g., "126", "127N")
- `Condition` — Experimental condition
- `BioReplicate` — Biological replicate
- `Intensity` — Reporter ion intensity

## Data Provenance & Logging

The package includes comprehensive logging via `MSstatsConvert::MSstatsLogsSettings`:
- Automatic creation of timestamped log files
- Append mode for chaining operations
- Configurable verbosity
- Session info capture via `MSstatsSaveSessionInfo`
- Package-specific log channels (MSstats, MSstatsTMT)

## Test Coverage

The package includes tests using the **tinytest** framework (with testthat as a suggested alternative):

| Test File | Focus |
|-----------|-------|
| `test_converters.R` | All 10 converter functions with real input data |
| `test_dataSummarizationPTM.R` | Label-free summarization |
| `test_dataSummarizationPTM_TMT.R` | TMT summarization |
| `test_groupComparisonPTM.R` | Group comparison modeling |
| `test_utils_checks.R` | Input validation helpers |

## Companion Convenience Wrapper: `dataProcessPTM`

For users who want a single-call workflow, `dataProcessPTM()` wraps the converter output through both the summarization and modeling steps in one call:

```r
result = dataProcessPTM(
    data = msstats_format,
    ptm_label_type = "LF",
    protein_label_type = "LF",
    MBimpute_ptm = FALSE,
    MBimpute_protein = TRUE
)
```

This is essentially a convenience wrapper — the underlying `dataSummarizationPTM` → `groupComparisonPTM` pipeline is the canonical workflow.

## Version & Maturity

- **Current version:** 2.15.0 (2024-11-25)
- **Bioconductor since:** Release 3.13 (2021)
- **Active development:** The `devel` branch on GitHub receives regular updates. The package has undergone multiple Bioconductor review cycles.
- **Citation:** Use `citation("MSstatsPTM")` in R for the proper citation format (includes a `inst/CITATION` file).
- **Bug reports:** <https://github.com/Vitek-Lab/MSstatsPTM/issues>

## Key Differences from MSstats (Protein-Level)

| Feature | MSstats | MSstatsPTM |
|---------|---------|------------|
| Summarization level | Protein | PTM site / peptide |
| Input data | Single dataset | List of PTM + optional PROTEIN |
| Statistical models | 1 model per comparison | 3 models (PTM, Protein, Adjusted) |
| FASTA requirement | No | Yes (for site localization) |
| Site localization | N/A | Core feature via MSstatsPTMSiteLocator |
| Protein adjustment | N/A | log2FC(PTM) − log2FC(Protein) |
| Converter count | ~10 | ~10 (PTM-specific wrappers) |

## Summary

MSstatsPTM is a mature, well-documented Bioconductor package that extends the MSstats statistical framework to the PTM domain. Its key contribution is the **protein-level adjustment** that deconvolutes PTM fold changes from changes in underlying protein abundance — addressing a fundamental confounding problem in PTM analysis. The package supports the full workflow from raw tool output to publication-ready visualizations, handles both label-free and TMT experiments, and integrates with 10+ common proteomics search tools through dedicated converters.
