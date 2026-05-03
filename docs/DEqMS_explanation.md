# DEqMS Package Deep Dive

## Overview

DEqMS (Differential Expression analysis for Quantitative Mass Spectrometry) is an R/Bioconductor package for **statistical differential protein expression analysis** in quantitative proteomics. It was developed by Yafeng Zhu at Karolinska Institutet and addresses a fundamental limitation of applying gene-level tools (like limma) directly to proteomics data: **proteins quantified by more peptides/PSMs have more precise abundance estimates, and this should inform variance estimation**.

- **Bioconductor page:** https://bioconductor.org/packages/release/bioc/html/DEqMS.html
- **GitHub:** https://github.com/yafeng/DEqMS
- **Current version:** 1.26.0 (Bioconductor 3.21)
- **License:** LGPL
- **Requires:** R >= 3.5
- **Author:** Yafeng Zhu
- **Citation:** Zhu et al., "DEqMS: A Method for Accurate Variance Estimation in Differential Protein Expression Analysis," Molecular & Cellular Proteomics, 2020 (PMID: 32205417)

## What DEqMS Does

DEqMS takes a **protein-level expression matrix** (proteins x samples) along with **PSM/peptide counts per protein** and produces:

1. **Normalized, summarized protein abundances** — via median sweeping or Tukey median polish
2. **Differential expression testing** — limma-based linear modeling with **spectral-count-aware variance moderation**
3. **Diagnostic visualizations** — variance vs. count plots, residual plots, peptide profile plots

The key innovation over standard limma: DEqMS estimates **protein-specific prior variances** as a function of the number of peptides or PSMs used to quantify each protein. Proteins with more spectral evidence naturally get tighter prior variance estimates, leading to more accurate statistical inference.

---

## Statistical Model

### The Core Problem

Standard limma assumes all genes/proteins share the **same prior variance** distribution. In proteomics this is wrong: a protein identified by 15 peptides has a much more reliable abundance estimate than one identified by 1 peptide. Applying uniform variance shrinkage over-shrinks well-quantified proteins and under-shrinks poorly-quantified ones.

### DEqMS Solution

DEqMS models the relationship between **log-variance** (from limma's residual variance σ²) and **spectral count** (PSM/peptide count per protein):

```
log(σ²_g) ~ f(log₂(count_g))
```

Where f() is a smooth function fitted via one of three methods:
- **loess** (default, span=0.75) — flexible local regression
- **nls** — parametric nonlinear model: σ² = a + b/count
- **spline** — smoothing spline with cross-validation

### Prior Variance Estimation

For each protein g with count c_g and residual variance σ²_g:

1. **Predicted log-variance:** eg_pred = f(log₂(c_g)) from the smooth fit
2. **Prior degrees of freedom (d₀):** Solved numerically by minimizing |mean((eg - eg_pred)²) - trigamma(d₀/2)|
3. **Prior variance (s₀²):** s₀² = exp(eg_pred + digamma(d₀/2) - log(d₀/2))
4. **Posterior variance:** post_var = (d₀ × s₀² + df × σ²) / (d₀ + df)
5. **Moderated t-statistic:** t = coefficient / (stdev_unscaled × sqrt(post_var))
6. **Moderated p-value:** p = 2 × pt(|t|, post_df, lower.tail=FALSE)

This is the limma empirical Bayes framework, but with **protein-specific** s₀² and d₀ instead of global values.

---

## Data Format Requirements

### Input Data Format (PSM-level)

DEqMS expects data at the **PSM level** — each row is a peptide-spectrum match:

| Column 1 (ID) | Column 2 (Gene/Protein) | Sample_1 | Sample_2 | Sample_3 | ... |
|---------------|------------------------|----------|----------|----------|-----|
| PSM_001 | PROTEIN_A | 20.5 | 21.0 | 20.8 | ... |
| PSM_002 | PROTEIN_A | 19.8 | 20.2 | 20.0 | ... |
| PSM_003 | PROTEIN_B | 18.5 | 19.0 | 18.8 | ... |

- **Column 1:** PSM or peptide identifier
- **Column 2:** Gene or protein identifier (the `group_col`)
- **Columns 3+:** Log2-transformed intensity values per sample

**Critical:** Intensity values must be **log2-transformed** before analysis, because systematic effects operate additively on this scale.

### Annotation / Sample Table

A separate table maps each sample column to experimental conditions:

| SampleName | Condition |
|------------|-----------|
| Sample_1 | Control |
| Sample_2 | Control |
| Sample_3 | Treatment |
| Sample_4 | Treatment |

### PSM Count

PSM counts per protein are derived from the input data by counting rows per protein identifier:

```r
psm_counts <- table(dat[, group_col])
```

These counts are attached to the limma fit object before calling `spectraCounteBayes()`.

---

## The Complete Workflow

```
Step 1: Load data           →  Read PSM-level intensity matrix (log2)
Step 2: Normalize           →  medianSweeping() or equalMedianNormalization()
Step 3: Fit linear model    →  limma::lmFit()
Step 4: DEqMS moderation    →  spectraCounteBayes()
Step 5: Extract results     →  outputResult()
Step 6: Diagnostic plots    →  VarianceScatterplot(), VarianceBoxplot(), Residualplot()
```

### Step 1: Data Preparation

Input data must be log2-transformed intensities at the PSM level. PSM counts per protein are computed from the raw data:

```r
library(DEqMS)

# dat: data.frame with columns [PSM_ID, Protein, Sample1, Sample2, ...]
psm_counts <- table(dat$Protein)
```

### Step 2: Normalization and Summarization

DEqMS provides two summarization strategies to collapse PSM-level data to protein-level:

#### `medianSweeping(dat, group_col = 2)` — Recommended

Two-stage normalization:
1. **Row centering:** For each PSM, subtract the median intensity across all samples (removes PSM-specific effects)
2. **Protein summarization:** For each protein, take the column-wise median across all its PSMs (collapses to protein-level)
3. **Equal median normalization:** Apply equalMedianNormalization to center all samples at zero

```r
dat.norm <- medianSweeping(dat, group_col = 2)
# Returns: protein-level matrix, proteins as rows, samples as columns
```

#### `medpolishSummary(dat, group_col = 2)` — Alternative

Uses Tukey median polish (iterative two-way decomposition) for summarization:

```r
dat.norm <- medpolishSummary(dat, group_col = 2)
# Returns: protein-level matrix
```

#### `equalMedianNormalization(dat)` — Standalone Normalization

Shifts each sample's median to the grand median across all samples:

```r
dat.norm <- equalMedianNormalization(dat)
# Input: protein-level matrix (already summarized)
```

#### `medianSummary(dat, group_col = 2, ref_col)` — Reference-based

Similar to medianSweeping but subtracts a reference column (e.g., control condition) before summarizing:

```r
dat.norm <- medianSummary(dat, group_col = 2, ref_col = 3)
# ref_col: column index of the reference sample to subtract
```

### Step 3: Fit Linear Model (limma)

DEqMS uses limma's linear modeling framework. First define the experimental design, then fit:

```r
# Create design matrix from annotation
design <- model.matrix(~0 + Condition, data = sampleTable)
colnames(design) <- levels(sampleTable$Condition)

# Fit ordinary linear model
fit <- limma::lmFit(dat.norm, design)

# Define contrasts (e.g., Treatment vs Control)
contrast.matrix <- limma::makeContrasts(Treatment - Control, levels = design)
fit2 <- limma::contrasts.fit(fit, contrast.matrix)

# Attach PSM counts
fit2$count <- psm_counts[rownames(fit2$coefficients)]
```

At this point you could run standard `limma::eBayes(fit2)`, but DEqMS replaces this step.

### Step 4: `spectraCounteBayes()` — DEqMS Variance Moderation

This is the **core DEqMS function**. It replaces limma's `eBayes()` with spectral-count-aware variance estimation.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `fit` | MArrayLM object | Yes | Output from limma::lmFit/contrasts.fit, must have `$count` attached |
| `fit.method` | Character | No | "loess" (default), "nls", or "spline" |
| `coef_col` | Integer | Yes | Which contrast column to compute moderated t-statistics for |

**What it does internally:**

1. Extracts residual variances (σ²) and degrees of freedom from the fit
2. Computes log-variance: `logVAR = log(σ²)`
3. Fits the variance-count relationship using the chosen method
4. Estimates prior degrees of freedom (d₀) numerically via trigamma minimization
5. Computes protein-specific prior variance (s₀²)
6. Calculates posterior variance by combining prior and observed variance
7. Returns moderated t-statistics, p-values, posterior variance, prior variance, and prior df

**Output:** The input fit object augmented with:

| Field | Description |
|-------|-------------|
| `fit$sca.t` | DEqMS-moderated t-statistics (matrix: proteins x contrasts) |
| `fit$sca.p` | DEqMS-moderated raw p-values |
| `fit$sca.postvar` | Posterior variance estimates |
| `fit$sca.priorvar` | Prior variance estimates (s₀²) |
| `fit$sca.dfprior` | Prior degrees of freedom (d₀) |
| `fit$fit.method` | The fitting method used |

**Fitting method comparison:**

| Method | Formula | Pros | Cons |
|--------|---------|------|------|
| **loess** (default) | loess(logVAR ~ log₂(count), span=0.75) | Flexible, no parametric assumptions | May overfit with few proteins |
| **nls** | σ² = a + b/count | Interpretable params, asymptotic behavior | Requires starting values, may not converge |
| **spline** | smooth.spline(log₂(count), logVAR, cv=FALSE) | Smooth, automatic complexity control | Less interpretable |

### Step 5: `outputResult()` — Extract Results Table

Convenience function to extract a ranked results table with both limma and DEqMS statistics.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `fit` | MArrayLM object | Output from spectraCounteBayes |
| `coef_col` | Integer | Which contrast to report (default 1) |

**Output columns:**

| Column | Source | Description |
|--------|--------|-------------|
| `logFC` | limma::topTable | Log2 fold change |
| `AveExpr` | limma::topTable | Average expression |
| `t` | limma::topTable | Original limma t-statistic |
| `P.Value` | limma::topTable | Original limma raw p-value |
| `adj.P.Val` | limma::topTable | Original limma BH-adjusted p-value |
| `B` | limma::topTable | B-statistic (log-odds) |
| `gene` | — | Gene/protein identifier |
| `count` | fit$count | PSM/peptide count |
| `sca.t` | DEqMS | DEqMS-moderated t-statistic |
| `sca.P.Value` | DEqMS | DEqMS-moderated raw p-value |
| `sca.adj.pval` | DEqMS | DEqMS-moderated BH-adjusted p-value |

Results are sorted by DEqMS p-value (ascending).

### Step 6: Diagnostic Plots

#### `VarianceScatterplot(fit, xlab, ylab, main)`

Scatter plot of **log₂(count) vs log(variance)** with fitted curve overlay. Shows the global trend of decreasing variance with increasing spectral count.

```r
VarianceScatterplot(fit, xlab = "log2(count)", ylab = "log(Variance)")
```

#### `VarianceBoxplot(fit, n = 20, xlab, ylab, main)`

Boxplots of log(variance) stratified by spectral count (1 to n), with fitted curve overlay. Useful for visualizing the distribution of variances at each count level.

```r
VarianceBoxplot(fit, n = 20, xlab = "count", ylab = "log(Variance)")
```

#### `Residualplot(fit, xlab, ylab, main)`

Plot of model **residuals vs log₂(count)**. Checks whether the variance-count relationship is adequately captured by the fit.

```r
Residualplot(fit, xlab = "log2(count)", ylab = "Variance(fitted - observed)")
```

#### `peptideProfilePlot(dat, col = 2, gene)`

Line plot showing **individual PSM intensity profiles** across samples for a single protein. Useful for QC — checks whether PSMs for the same protein behave consistently.

```r
peptideProfilePlot(dat, col = 2, gene = "P12345")
```

---

## Complete End-to-End Example

```r
library(DEqMS)
library(limma)

# 1. Load PSM-level data (log2 intensities)
# dat columns: [PSM_ID, Protein, Sample_1, Sample_2, ..., Sample_N]
dat <- read.csv("psm_intensities.csv", stringsAsFactors = FALSE)

# 2. Count PSMs per protein
psm_counts <- table(dat$Protein)

# 3. Normalize and summarize to protein level
dat.norm <- medianSweeping(dat, group_col = 2)

# 4. Build design matrix
sampleTable <- data.frame(
  SampleName = colnames(dat.norm),
  Condition = c("Control", "Control", "Control", "Treatment", "Treatment", "Treatment")
)
design <- model.matrix(~0 + Condition, data = sampleTable)
colnames(design) <- levels(sampleTable$Condition)

# 5. Fit linear model
fit <- lmFit(dat.norm, design)
contrast.matrix <- makeContrasts(Treatment - Control, levels = design)
fit2 <- contrasts.fit(fit, contrast.matrix)

# 6. Attach PSM counts
fit2$count <- psm_counts[rownames(fit2$coefficients)]

# 7. DEqMS moderation (replace limma::eBayes)
fit_deqms <- spectraCounteBayes(fit2, fit.method = "loess", coef_col = 1)

# 8. Extract results
results <- outputResult(fit_deqms, coef_col = 1)

# 9. Diagnostic plots
VarianceScatterplot(fit_deqms)
VarianceBoxplot(fit_deqms, n = 20)
Residualplot(fit_deqms)
peptideProfilePlot(dat, col = 2, gene = "P12345")
```

---

## Function Reference

| Function | Signature | Purpose |
|----------|-----------|---------|
| `medianSweeping` | `(dat, group_col = 2)` | Row-center PSMs + median summarize + normalize |
| `medpolishSummary` | `(dat, group_col = 2)` | Tukey median polish summarization |
| `medianSummary` | `(dat, group_col = 2, ref_col)` | Reference-subtracted median summarization |
| `equalMedianNormalization` | `(dat)` | Shift sample medians to grand median |
| `spectraCounteBayes` | `(fit, fit.method = "loess", coef_col)` | DEqMS variance moderation (core function) |
| `outputResult` | `(fit, coef_col = 1)` | Extract ranked results table |
| `VarianceScatterplot` | `(fit, xlab, ylab, main)` | Scatter: count vs variance |
| `VarianceBoxplot` | `(fit, n = 20, xlab, ylab, main)` | Boxplot: variance by count |
| `Residualplot` | `(fit, xlab, ylab, main)` | Residuals vs count |
| `peptideProfilePlot` | `(dat, col = 2, gene)` | PSM intensity profiles per protein |

---

## Package Dependencies

| Package | Use |
|---------|-----|
| **limma** (>= 3.34) | Linear modeling, contrasts, topTable |
| **ggplot2** | Diagnostic and results visualization |
| **matrixStats** | Row/column medians for summarization |
| **dplyr** | Data manipulation |
| **plyr** | ddply for group-wise summarization |
| **reshape2** | Data melting for peptide profile plots |
| **MASS** | Implicitly via limma |

---

## How Our Data Maps to DEqMS Format

Our pipeline's `PSM_Abundances.tsv` (output of Step 5) is in **wide format** at the peptide level:

| Master_Protein_Accessions | Gene_Name | Unique_PSM | Sequence | Modifications | Charge | DMSO_1 | DMSO_2 | DMSO_3 | INCZ_1 | INCZ_2 | INCZ_3 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| P12345 | GENE1 | ... | ABCDEF | ... | 2 | 1000 | 1100 | 1050 | 2000 | 2100 | 2050 |

This needs to be transformed to DEqMS input:

1. **Create unique PSM IDs:** Combine Sequence + Modifications + Charge (or use row index)
2. **Keep columns:** PSM_ID, Protein (group_col), then sample columns
3. **Log2 transform:** `log2(intensity)` for all sample columns
4. **PSM counts:** Count rows per protein from the original data

The transformation is straightforward since our data is already at the PSM/peptide level:

```r
# Assuming wide PSM table already loaded
dat <- psm_wide[, c("PSM_ID", "Master_Protein_Accessions", sample_cols)]
dat[, sample_cols] <- log2(dat[, sample_cols] + 1)  # if not already logged
psm_counts <- table(dat$Master_Protein_Accessions)
```

---

## Key Differences: DEqMS vs Standard limma

| Aspect | Standard limma | DEqMS |
|--------|---------------|-------|
| **Prior variance** | Single global value for all proteins | Protein-specific, function of PSM/peptide count |
| **Prior degrees of freedom** | Single global d₀ | Protein-specific, derived from count-variance relationship |
| **Input level** | Protein-level matrix | PSM-level matrix (with summarization built-in) |
| **Normalization** | External (e.g., normalizeBetweenArrays) | Built-in (medianSweeping, equalMedianNormalization) |
| **Missing value handling** | Via lmFit's na handling | No imputation — relies on sufficient PSM counts |
| **Variance trend modeling** | Optional (trend=TRUE in eBayes) | Core feature — explicit count-variance modeling |
| **Diagnostic plots** | MD plots, volcano plots | Variance-count plots, residual plots, peptide profiles |

The biggest advantage: **DEqMS corrects a known bias** where proteins with few peptides are systematically over-called as significant by limma (because their high residual variance gets over-shrunk by a global prior) and proteins with many peptides are under-called (because their low variance gets under-shrunk). By making the prior variance a function of spectral count, DEqMS produces more accurate p-values.

---

## Limitations

1. **No missing value imputation** — DEqMS does not impute missing values. Proteins with too few PSMs across conditions may have unreliable variance estimates.
2. **Requires PSM-level data** — Cannot work with already-summarized protein-level data unless PSM counts are available externally.
3. **Single-factor designs only** — The vignette demonstrates single-factor comparisons. Complex designs (time-course, repeated measures) require manual design matrix construction.
4. **No built-in volcano/heatmap plots** — Diagnostic plots focus on variance modeling; volcano plots and heatmaps must be created separately (e.g., using ggplot2 with outputResult output).
5. **Count dependency** — The variance-count relationship must be meaningful. Experiments with uniformly low or uniformly high PSM counts per protein may not benefit from DEqMS moderation.
