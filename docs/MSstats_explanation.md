# MSstats Package Deep Dive

## Overview

MSstats is an R/Bioconductor package for **statistical relative protein significance analysis** in mass spectrometry-based proteomics. It was developed by the Vitek Lab at Northeastern University and is the standard tool for differential abundance analysis in proteomics experiments.

- **Bioconductor page:** https://bioconductor.org/packages/release/bioc/html/MSstats.html
- **GitHub:** https://github.com/Vitek-Lab/MSstats
- **Current version:** 4.20.0 (Bioconductor 3.23)
- **License:** Artistic-2.0
- **Requires:** R >= 4.0
- **Authors:** Meena Choi, Mateusz Staniak, Tsung-Heng Tsai, Ting Huang, Olga Vitek

## What MSstats Does

MSstats takes raw peptide-level intensity measurements from an MS experiment and produces:

1. **Normalized, summarized protein abundances** — combining multiple peptides per protein into a single protein-level intensity per run
2. **Differential abundance testing** — statistical comparison between experimental conditions (logFC, p-values, adjusted p-values)
3. **Diagnostic visualizations** — QC plots, volcano plots, heatmaps, model validation plots
4. **Quantification output** — final tables suitable for downstream analysis

The key advantage over the current msqrob2+limma approach is that MSstats is a **complete end-to-end pipeline** designed for multi-condition experiments. It handles normalization, missing value imputation, protein summarization, and statistical testing all in one framework.

---

## Supported Experiment Types

### By Acquisition Method

| Type | Acronym | Description | Support |
|------|---------|-------------|---------|
| Data-Dependent Acquisition | DDA | Shotgun proteomics | Full |
| Selected Reaction Monitoring | SRM | Targeted MS | Full (Skyline) |
| Data-Independent Acquisition | DIA | SWATH-MS | Full (DIA-NN, Spectronaut, OpenSWATH, DIA-Umpire) |
| Tandem Mass Tag | TMT | Isobaric labeling | Full (dedicated TMT converters) |

### By Labeling Strategy

| Type | Description |
|------|-------------|
| Label-free | No isotopic labeling — most relevant for this app |
| Light/Heavy labeled | Reference peptide design (IsotopeLabelType = "L" and "H") |
| TMT/Multiplexed | Channel-based quantification |

Note: MSstats statistical analysis only supports label-free or light/heavy reference peptide designs. More than 2 isotope label levels triggers an error.

### By Experimental Design

| Design | Description |
|--------|-------------|
| Single-factor | Conditions with biological replicates |
| Time-course | Multiple time points |
| Repeated measures | Same subjects measured across conditions |
| Fractionated | Multiple fractions merged per sample |
| Technical replicates | Multiple MS runs per biological sample |

---

## Data Format Requirements

### The Standardized Long Format (Required Input)

After conversion from raw tool output, MSstats requires data in a **long-format data frame** with these columns:

| Column | Description | Example |
|--------|-------------|---------|
| **ProteinName** | Protein identifier | "P12345" |
| **PeptideSequence** | Peptide amino acid sequence | "ABCDEF" |
| **PrecursorCharge** | Charge state of precursor | 2, 3 |
| **FragmentIon** | Fragment ion identifier | "y3", NA for DDA |
| **ProductCharge** | Charge state of product ion | 1, NA for DDA |
| **Run** | MS run identifier — must match annotation exactly | "Sample_DMSO_1" |
| **Condition** | Experimental group/condition label | "DMSO", "Treatment" |
| **BioReplicate** | Unique biological sample ID | 1, 2, 3 |
| **Intensity** | Raw/untransformed abundance value | 12345.6 |
| **IsotopeLabelType** | Isotopic label designation | "L" (light/label-free) |

**Optional columns:** Channel (TMT), Fraction, TechReplicate, StandardType, PeptideModifiedSequence

**Feature definition:** A "feature" is the combination of PeptideSequence + PrecursorCharge + FragmentIon + ProductCharge. If any component doesn't apply (e.g., no fragment ion in DDA), set it to NA.

### Annotation File Structure

The annotation file maps runs to experimental conditions. **For non-TMT experiments**, minimum 3 columns:

| Column | Description |
|--------|-------------|
| **Run** | Must exactly match Run values in quantification data |
| **Condition** | Experimental condition label |
| **BioReplicate** | Biological replicate identifier |

Key constraint: Each MS run can have only ONE condition and ONE BioReplicate (one-to-one mapping enforced). If metadata columns are already in the quantification data, `annotation=NULL` is acceptable — MSstats extracts them automatically.

### Input Validation (What MSstats Checks)

- Minimum 10 required columns must be present
- RUN, BIOREPLICATE, and CONDITION cannot contain NA values
- At most 2 isotope label levels (light + heavy)
- Intensity values below 1 are floored to 1 (with warning)
- logTrans must be 2 or 10
- summaryMethod must be "TMP" or "linear"
- normalization must be "equalizeMedians", "quantile", "globalStandards", or FALSE

---

## The Complete Workflow

```
Step 1: Convert raw output  →  *toMSstatsFormat()
Step 2: Normalize & impute  →  dataProcess()
Step 3: Check QC            →  dataProcessPlots()
Step 4: Define contrasts    →  groupComparison()
Step 5: Visualize results   →  groupComparisonPlots()
Step 6: Validate models     →  modelBasedQCPlots()
Step 7: Power calculation   →  designSampleSize()
Step 8: Export abundances   →  quantification()
```

### Step 1: Data Conversion (`MSstatsConvert`)

MSstatsConvert is a sister package (v1.23.0) that provides tool-specific converters. The conversion pipeline has 4 stages:

1. **Import** — Loads raw files into an `MSstatsInputFiles` object
2. **Clean** — Tool-specific cleaning (remove decoys, filter Q-values, etc.)
3. **MakeAnnotation** — Creates or uses provided annotation table
4. **Preprocess** — Unified preprocessing: filtering, shared peptide removal, annotation merging

**Supported converters:**

| Converter | Input Tool | Types |
|-----------|-----------|-------|
| `SkylinetoMSstatsFormat` | Skyline | SRM, DDA, DIA |
| `MaxQtoMSstatsFormat` | MaxQuant | DDA |
| `MaxQtoMSstatsTMTFormat` | MaxQuant | TMT |
| `DIANNtoMSstatsFormat` | DIA-NN | DIA |
| `SpectronauttoMSstatsFormat` | Spectronaut | DIA, DDA |
| `FragPipetoMSstatsFormat` | FragPipe | DDA |
| `OpenMStoMSstatsFormat` | OpenMS | DDA |
| `PDtoMSstatsFormat` | Proteome Discoverer | DDA |
| `ProgenesistoMSstatsFormat` | Progenesis QI | DDA |
| `DIANNtoMSstatsFormat` | DIA-NN | DIA |

**Common converter parameters:**
- `useUniquePeptide` (default TRUE) — remove shared peptides
- `removeFewMeasurements` (default TRUE) — remove features with few measurements
- `summaryforMultipleRows` (default "max") — aggregate multiple PSMs (max or sum)
- `removeProtein_with1Feature` / `removeProtein_with1Peptide` (default FALSE)

### Step 2: `dataProcess()` — Preprocessing, Normalization, and Summarization

This is the central processing function. It takes long-format data and produces processed, normalized, and summarized output.

**Key parameters:**

| Parameter | Options | Default | Description |
|-----------|---------|---------|-------------|
| `logTrans` | 2 or 10 | 2 | Log transformation base |
| `normalization` | "equalizeMedians", "quantile", "globalStandards", FALSE | "equalizeMedians" | Run-to-run normalization |
| `nameStandards` | Vector of peptide/protein names | NULL | Required for globalStandards |
| `featureSubset` | "all", "top3", "topN", "highQuality" | "all" | Feature selection strategy |
| `remove_uninformative_feature_outlier` | TRUE/FALSE | FALSE | Remove flagged outliers |
| `min_feature_count` | Integer | 2 | Min informative features per protein |
| `n_top_feature` | Integer | 3 | For topN feature selection |
| `summaryMethod` | "TMP" (Tukey median polish) or "linear" (mixed model) | "TMP" | Protein summarization |
| `equalFeatureVar` | TRUE/FALSE | TRUE | Equal variance assumption (linear method) |
| `censoredInt` | "NA", "0", or NULL | "NA" | How missing values are treated |
| `MBimpute` | TRUE/FALSE | TRUE | Accelerated failure model imputation |
| `remove50missing` | TRUE/FALSE | FALSE | Remove runs with >50% missing |
| `maxQuantileforCensored` | Numeric (0-1) | 0.999 | Max quantile for censoring decision |

**Internal Processing Order:**
1. `MSstatsPrepareForDataProcess()` — Log-transform intensities, create factor columns
2. `MSstatsNormalize()` — Apply normalization (median, quantile, or global standards)
3. `MSstatsMergeFractions()` — Merge fractionated runs
4. `MSstatsHandleMissing()` — Handle missing values (imputation or censoring)
5. `MSstatsSelectFeatures()` — Feature selection (top3, topN, highQuality)
6. `MSstatsSummarize()` — Protein-level summarization (TMP or linear)
7. `MSstatsSummarizationOutput()` — Format final output

**Normalization Methods:**
- **equalizeMedians** (default): Shifts median of each run to the grand median across all runs. Simple, robust, widely used in proteomics.
- **quantile**: Forces all runs to have the same intensity distribution. More aggressive.
- **globalStandards**: Uses spike-in standard peptides for normalization. Requires `nameStandards` parameter.
- **FALSE**: Skip normalization (not recommended).

**Protein Summarization Methods:**

**Tukey Median Polish (TMP)** — Default, robust method:
- Uses `median_polish_summary()` from MASS package
- Fits a two-way additive model: Abundance = Protein effect + Run effect + Feature effect + Error
- For labeled experiments, adjusts heavy channel based on median
- Missing value imputation via **Accelerated Failure Model** (survreg from survival package, Gaussian distribution, left-censored)
- Survival model formula: `Surv(newABUNDANCE, cen, type='left') ~ FEATURE + RUN + ref` (labeled) or `~ FEATURE + RUN` (unlabeled)

**Linear Model:**
- Uses `lm()` for single-feature proteins or `lmer()` from lme4 for multi-feature
- Model: `ABUNDANCE ~ FEATURE + RUN` (unlabeled) or `ABUNDANCE ~ FEATURE + RUN + ref` (labeled)
- Optionally handles heterogeneous variance via iterative weighted least squares (loess-based)

**Missing Value Imputation:**
When `MBimpute=TRUE`, MSstats uses an **Accelerated Failure Model** from the `survival` package. Missing values below a censoring threshold are treated as left-censored observations. The model estimates the missing values based on feature and run effects. This is more principled than simple mean/median imputation.

The censoring threshold is determined by `maxQuantileforCensored` (default 0.999) — values below this quantile are considered potentially censored.

**Feature Selection:**
- **"all"**: Use all features
- **"top3"**: Use the 3 most abundant features per protein
- **"topN"**: Use the N most abundant features (set via `n_top_feature`)
- **"highQuality"**: Remove uninformative features and outliers (requires `remove_uninformative_feature_outlier=TRUE`)

### Step 3: `dataProcessPlots()` — Diagnostic Visualization

Three plot types:

1. **"ProfilePlot"** — Transition-level intensities across runs per protein, with option for run-level summary overlay. Shows censored missing data points.
2. **"QCPlot"** — Boxplots of log-intensities across runs to check systematic bias pre/post normalization. Generated for all proteins and per protein.
3. **"ConditionPlot"** — Mean intensities per condition with error bars (95% CI or SD).

Output: PDF files (via ggplot2) or HTML files (via plotly).

### Step 4: `groupComparison()` — Differential Abundance Testing

This is the core statistical testing function. It fits **linear models** (for single-feature proteins) or **linear mixed-effects models** (for multi-feature proteins) to compare conditions.

**Parameters:**

| Parameter | Description |
|-----------|-------------|
| `contrast_matrix` | Matrix specifying comparisons using 1/-1 coefficients |
| `data` | Output from `dataProcess()` |
| `save_fitted_models` | If TRUE, fitted models included in output (default TRUE) |
| `log_base` | Base of logarithm (default 2) |

**Statistical approach:**
- For each protein, either `lm()` or `lmer()` is fitted
- The `limma` package is imported for additional statistical machinery
- P-values adjusted via **Benjamini-Hochberg (BH)** method within each comparison
- Handles repeated measures designs via mixed-effects models with `SUBJECT.(Intercept)` random effects
- Handles single-subject designs

**Model selection logic:**
- Single feature → `lm()`
- Labeled (heavy/light) → expands scope of biological replication
- Repeated measures → `lmer()` with random effect for subject
- Technical replicates → models them appropriately

**Contrast Matrix:**
The contrast matrix defines which conditions to compare. Each row is a comparison, each column is a condition level. Values are 1 (treatment), -1 (control), 0 (not involved).

Example for 3 conditions (A, B, C) comparing B vs A and C vs A:

```
       A   B   C
BvsA  -1   1   0
CvsA  -1   0   1
```

**Output (`ComparisonResult` dataframe):**

| Column | Description |
|--------|-------------|
| Protein | Protein identifier |
| Label | Comparison name (from contrast matrix row name) |
| log2FC (or log10FC) | Log-fold change |
| SE | Standard error |
| Tvalue | T-statistic |
| DF | Degrees of freedom |
| pvalue | Raw p-value |
| adj.pvalue | BH-adjusted p-value |
| issue | Any model fitting issues |
| MissingPercentage | % of missing measurements |
| ImputationPercentage | % of imputed values |

### Step 5: `groupComparisonPlots()` — Results Visualization

Three plot types:

1. **"VolcanoPlot"** — Log-fold change vs. -log10(adj.p-value) per comparison. Significant proteins colored red (up) or blue (down). Options: FCcutoff, ProteinName labels, logBase.pvalue (2 or 10).
2. **"Heatmap"** — Significance matrix (color-coded by adjusted p-value × sign of logFC) across multiple comparisons. Hierarchical clustering with Ward method. Color key: red=up-regulated, blue=down-regulated, gold=not significant.
3. **"ComparisonPlot"** — Per-protein log-fold change trajectories with 95% CI error bars across multiple comparisons.

### Step 6: `modelBasedQCPlots()` — Model Validation

Two types:

1. **"QQPlots"** — Normal quantile-quantile plots for each protein's residuals. Checks normality assumption of measurement errors.
2. **"ResidualPlots"** — Residuals vs. fitted values. Checks homoscedasticity assumption.

### Step 7: `designSampleSize()` — Power and Sample Size Calculation

Uses fitted model variance components to estimate:
- **Minimum number of biological replicates** per condition (given desired FC, FDR, power)
- **Statistical power** (given sample size, desired FC, FDR)

Uses variance decomposition from fitted models:
- `Error` variance (residual variance from lm/lmer)
- `Subject` variance (random intercept variance from lmer)
- `GroupBySubject` variance (interaction random effect)

Power calculation uses normal approximation with BH-adjusted significance levels.

### Step 8: `quantification()` — Final Output

Two types and two formats:
- **type:** "Sample" (individual biological replicate) or "Group" (condition median)
- **format:** "long" (long-format data.frame) or "matrix" (Protein × Condition matrix)

Uses median aggregation across runs/subjects.

---

## Output Structures

### `dataProcess()` Output — A list with:

| Key | Type | Description |
|-----|------|-------------|
| `FeatureLevelData` | data.frame | Processed feature-level data (PROTEIN, PEPTIDE, TRANSITION, FEATURE, LABEL, RUN, GROUP, SUBJECT, FRACTION, INTENSITY, ABUNDANCE, newABUNDANCE) |
| `ProteinLevelData` | data.frame | Protein-level summarized data (Protein, RUN, GROUP, SUBJECT, LogIntensities, optionally NumImputedFeature) |
| `ProcessQC` | | Quality control information from processing |

### `groupComparison()` Output — A list with:

| Key | Type | Description |
|-----|------|-------------|
| `ComparisonResult` | data.frame | Per-protein comparison results (Protein, Label, log2FC, SE, Tvalue, DF, pvalue, adj.pvalue, issue, MissingPercentage, ImputationPercentage) |
| `ModelQC` | data.frame | Data used to fit models |
| `FittedModel` | list | Fitted model objects (lm or lmerMod) |

### `quantification()` Output — data.frame:

- **Long format:** Protein, Group_Subject (or Group), LogIntensity
- **Matrix format:** Protein as rows, Group_Subject (or Group) as columns, LogIntensity values

---

## Package Dependencies

### MSstats (core):
data.table, checkmate, MASS, htmltools, limma, lme4, preprocessCore, survival, Rcpp, ggplot2 (>= 3.4.0), ggrepel, gplots, plotly, marray, statmod, rlang, plus standard R utilities

### MSstatsConvert (sister package):
data.table, log4r, methods, checkmate, utils, stringi, Rcpp, parallel

### Key external packages used:
- **limma** — Empirical Bayes moderation for differential expression
- **lme4** — Linear mixed-effects models
- **survival** — Accelerated failure model for missing value imputation
- **MASS** — Tukey median polish (robust summarization)
- **preprocessCore** — Quantile normalization
- **ggplot2** — Diagnostic and results visualization
- **plotly** — Interactive HTML plots

---

## How Our Data Maps to MSstats Format

Our pipeline's `PSM_Abundances.tsv` (output of Step 5) is in **wide format**:

| Master_Protein_Accessions | Gene_Name | Unique_PSM | Sequence | Modifications | Charge | DMSO_1 | DMSO_2 | DMSO_3 | INCZ_1 | INCZ_2 | INCZ_3 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| P12345 | GENE1 | ... | ABCDEF | ... | 2 | 1000 | 1100 | 1050 | 2000 | 2100 | 2050 |

This needs to be reshaped to MSstats **long format**:

| ProteinName | PeptideSequence | PrecursorCharge | FragmentIon | ProductCharge | Run | Condition | BioReplicate | Intensity | IsotopeLabelType |
|---|---|---|---|---|---|---|---|---|---|
| P12345 | ABCDEF | 2 | NA | NA | DMSO_1 | DMSO | 1 | 1000 | L |
| P12345 | ABCDEF | 2 | NA | NA | DMSO_2 | DMSO | 2 | 1100 | L |
| P12345 | ABCDEF | 2 | NA | NA | DMSO_3 | DMSO | 3 | 1050 | L |
| P12345 | ABCDEF | 2 | NA | NA | INCZ_1 | INCZ | 1 | 2000 | L |
| ... | ... | ... | ... | ... | ... | ... | ... | ... | ... |

The reshape is done by parsing column names: `ExperimentName_Condition_Replicate` → split to extract Condition and BioReplicate (right-to-left: last segment = replicate, second-to-last = condition). This is done efficiently in R using `data.table::melt()`.

---

## Key Differences: MSstats vs Current msqrob2+limma Approach

| Aspect | Current (msqrob2+limma) | MSstats |
|--------|------------------------|---------|
| **Normalization** | Median centering (custom R code) | Built-in (equalizeMedians, quantile, globalStandards) |
| **Missing value handling** | Filtering only | Accelerated failure model imputation (survreg) |
| **Protein summarization** | MsCoreUtils::robustSummary (aggregateFeatures) | Tukey median polish or linear mixed model |
| **Statistical testing** | limma (multi-condition via contrast matrix) | limma/lme4 (multiple comparisons via contrast matrix) |
| **Experimental design** | Multi-condition (all pairwise contrasts) | Multi-condition, time-course, repeated measures |
| **Diagnostic plots** | Separate QC pipeline | Built-in (dataProcessPlots, groupComparisonPlots, modelBasedQCPlots) |
| **Power analysis** | Not available | Built-in (designSampleSize) |

The biggest differences are:
1. **Missing value imputation** — MSstats uses a principled statistical model rather than just filtering
2. **Multi-condition support** — MSstats handles any number of conditions in a single model
3. **Contrast matrix** — User defines exactly which comparisons to test, with full control
