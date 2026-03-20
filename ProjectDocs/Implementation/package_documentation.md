# Package Documentation - Key Functions Reference

> **Purpose**: Summarize key functions from msqrob2 (R) and GSEApy (Python) for proteomics analysis  
> **Created**: 2026-03-14  
> **Packages**: msqrob2 v1.12.0, gseapy v1.1.8

---

## Table of Contents

1. [msqrob2 (R Package)](#msqrob2-r-package)
   - [Step 6: Protein Abundance Calculation](#step-6-protein-abundance-calculation)
   - [Step 7: Differential Expression Analysis](#step-7-differential-expression-analysis)
2. [GSEApy (Python Package)](#gseapy-python-package)
   - [Step 9: GSEA Analysis](#step-9-gsea-analysis)
   - [Visualization Functions](#visualization-functions)
3. [Integration Mapping](#integration-mapping)

---

## msqrob2 (R Package)

**Package**: `msqrob2`  
**Version**: 1.12.0  
**Source**: Bioconductor  
**Documentation**: https://bioconductor.org/packages/msqrob2  
**GitHub**: https://github.com/statOmics/msqrob2

**Description**: Robust statistical inference for quantitative LC-MS proteomics. Provides robust linear mixed model framework for assessing differential abundance in MS-based quantitative proteomics experiments.

**Key Dependencies**:
- QFeatures (>= 1.1.2)
- SummarizedExperiment
- MultiAssayExperiment
- limma
- lme4

---

### Protein Abundance Calculation

**Function**: `aggregateFeatures()` (from QFeatures)

**Purpose**: Aggregate peptide-level data to protein-level abundances using robust summarization.

**Usage**:
```r
pe <- aggregateFeatures(
    object = pe,           # QFeatures object
    i = "peptide",         # Assay to aggregate from
    fcol = "Proteins",     # Column defining protein groups
    name = "protein",      # Name for new assay
    fun = MsCoreUtils::robustSummary  # Aggregation function
)
```

**Parameters**:
| Parameter | Type | Description |
|-----------|------|-------------|
| `object` | QFeatures | QFeatures object containing peptide data |
| `i` | character | Name of assay to aggregate from (e.g., "peptide") |
| `fcol` | character | Column in rowData defining protein groups |
| `name` | character | Name for the new aggregated assay |
| `fun` | function | Aggregation function (default: robustSummary) |

**Input**:
- QFeatures object with peptide-level assay
- Peptide abundances (log2 transformed)
- Protein grouping information in rowData

**Output**:
- QFeatures object with new protein-level assay
- Protein abundances calculated by robust summarization
- Aggregation counts (number of peptides per protein)

**Processing Steps**:
1. Log2 transformation of peptide abundances
2. Median centering normalization
3. Robust summarization (M-estimation) to protein level
4. Store results in new assay

---

### Differential Expression Analysis

**Function**: `msqrob()`

**Purpose**: Fit robust linear models and perform differential expression analysis.

**Usage**:
```r
pe <- msqrob(
    object = pe,              # QFeatures object
    i = "protein",            # Assay to model
    formula = ~ condition,    # Model formula
    modelColumnName = "rlm",  # Column name for model results
    robust = TRUE             # Use robust M-estimation
)
```

**Parameters**:
| Parameter | Type | Description |
|-----------|------|-------------|
| `object` | QFeatures | QFeatures object with protein-level data |
| `i` | character | Name of assay to model (e.g., "protein") |
| `formula` | formula | Model formula (e.g., ~ condition) |
| `modelColumnName` | character | Column name to store model results in rowData |
| `robust` | logical | Use robust M-estimation (default: TRUE) |

**Input**:
- QFeatures object with protein-level assay
- Experimental design information in colData
- Model formula defining comparisons

**Output**:
- QFeatures object with model results stored in rowData
- For each protein: fitted model, coefficients, standard errors

**Accessing Results**:
```r
# Get model for specific protein
model <- rowData(pe[["protein"]])$rlm[[1]]

# Extract coefficients
coefs <- getCoef(model)

# Get all results as data frame
results <- msqrob2::getResults(pe, i = "protein", modelColumnName = "rlm")
```

**Output Columns**:
| Column | Description |
|--------|-------------|
| `logFC` | Log2 fold change (Treatment/Control) |
| `pval` | Raw p-value from t-test |
| `adjPval` | Benjamini-Hochberg adjusted p-value |
| `se` | Standard error |
| `df` | Degrees of freedom |

---

### Supporting Functions

**`getCoef()`**
- Extract coefficients from fitted model
- Returns: Named vector of coefficients

**`getResults()`**
- Extract all model results as data frame
- Parameters: `object`, `i` (assay name), `modelColumnName`
- Returns: Data frame with logFC, pval, adjPval for all proteins

**`hypothesisTest()`** (from QFeatures)
- Perform hypothesis tests on model coefficients
- Used for generating differential expression statistics

---

## GSEApy (Python Package)

**Package**: `gseapy`  
**Version**: 1.1.8  
**Source**: PyPI / Bioconda  
**Documentation**: https://gseapy.readthedocs.io  
**GitHub**: https://github.com/zqfang/GSEApy

**Description**: Gene Set Enrichment Analysis in Python. Python/Rust implementation of GSEA and wrapper for Enrichr.

**Installation**:
```bash
pip install gseapy
# or
conda install -c bioconda gseapy
```

---

### Step 9: GSEA Analysis

**Function**: `gseapy.prerank()`

**Purpose**: Run Gene Set Enrichment Analysis with pre-ranked gene list (from differential expression results).

**Usage**:
```python
import gseapy as gp
import pandas as pd

# Prepare ranked list from DE results
rnk = pd.DataFrame({
    'gene': diff_results['gene_name'],
    'metric': -np.log10(diff_results['pval']) * np.sign(diff_results['logFC'])
})
rnk = rnk.sort_values('metric', ascending=False)

# Run prerank GSEA
pre_res = gp.prerank(
    rnk=rnk,                           # Pre-ranked gene list
    gene_sets='GO_Biological_Process_2021',  # Gene set database
    outdir='gsea_results',             # Output directory
    permutation_num=1000,              # Number of permutations
    min_size=15,                       # Minimum gene set size
    max_size=500,                      # Maximum gene set size
    weight=1.0,                        # Weight parameter
    ascending=False,                   # Sort order
    threads=4,                         # Number of threads
    seed=123,                          # Random seed
    verbose=True                       # Print progress
)
```

**Parameters**:
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `rnk` | DataFrame/Series/str | Required | Pre-ranked correlation table. Columns: gene name, ranking metric |
| `gene_sets` | str/list/dict | Required | Enrichr library name, .gmt file, or dict of gene sets |
| `outdir` | str | None | Results output directory. If None, nothing written to disk |
| `permutation_num` | int | 1000 | Number of permutations. Min p-value ≈ 1/nperm |
| `min_size` | int | 15 | Minimum allowed genes from gene set in data |
| `max_size` | int | 500 | Maximum allowed genes from gene set in data |
| `weight` | float | 1.0 | Weight parameter (0=classic, 1=weighted) |
| `ascending` | bool | False | Sorting order of rankings |
| `threads` | int | 4 | Number of threads to use |
| `figsize` | list | [6.5, 6] | Matplotlib figure size [width, height] |
| `format` | str | 'pdf' | Output figure format |
| `graph_num` | int | 20 | Plot graphs for top sets |
| `no_plot` | bool | False | If True, no figures generated |
| `seed` | int | 123 | Random seed for reproducibility |
| `verbose` | bool | False | Print progress |

**Input**:
- **rnk**: DataFrame with two columns:
  - Column 1: Gene names (gene symbols)
  - Column 2: Ranking metric (e.g., -log10(pval) * sign(logFC))
- **gene_sets**: One of:
  - Enrichr library name (e.g., 'GO_Biological_Process_2021')
  - Path to .gmt file
  - Dictionary of gene sets

**Available Gene Set Databases**:
| Database | Enrichr Name |
|----------|--------------|
| GO Biological Process | 'GO_Biological_Process_2021' |
| GO Molecular Function | 'GO_Molecular_Function_2021' |
| GO Cellular Component | 'GO_Cellular_Component_2021' |
| KEGG | 'KEGG_2021_Human' |
| Reactome | 'Reactome_2022' |

**Output**:
Returns `Prerank` object with attributes:

| Attribute | Type | Description |
|-----------|------|-------------|
| `results` | DataFrame | GSEA results for all gene sets |
| `res2d` | DataFrame | Top significant results (2D format) |

**Results DataFrame Columns**:
| Column | Description |
|--------|-------------|
| `term` | Gene set name / pathway |
| `es` | Enrichment Score |
| `nes` | Normalized Enrichment Score |
| `pval` | Nominal p-value |
| `fdr` | FDR q-value (adjusted) |
| `fwerp` | Family-wise error rate p-value |
| `tag %` | Percent of gene set before ES peak |
| `gene %` | Percent of gene list before ES peak |
| `lead_genes` | Leading edge genes (comma-separated) |
| `matched_genes` | Genes matched to data |

**Accessing Results**:
```python
# Get all results as DataFrame
results_df = pre_res.results

# Get top significant pathways
significant = results_df[results_df['fdr'] < 0.05]

# Get leading edge genes for specific pathway
pathway = results_df.loc['GO_BP_TERM', 'lead_genes']
leading_genes = pathway.split(';')

# Get NES and p-value
nes = results_df.loc['GO_BP_TERM', 'nes']
pval = results_df.loc['GO_BP_TERM', 'pval']
```

---

### Alternative: Using `ssgsea()` for Single-Sample GSEA

**Function**: `gseapy.ssgsea()`

**Purpose**: Single-sample GSEA for when you want enrichment scores per sample.

**Usage**:
```python
ssgsea_results = gp.ssgsea(
    data=expression_data,      # Expression matrix (genes x samples)
    gene_sets='KEGG_2021_Human',
    outdir='ssgsea_results',
    sample_norm_method='rank',  # 'rank', 'log', 'log_rank', None
    correl_norm_type='rank',    # 'rank', 'symrank', 'zscore', None
    weight=0.25,
    min_size=15,
    max_size=2000,
    threads=4
)
```

**Note**: For the proteomics pipeline, `prerank()` is preferred over `ssgsea()` because we have differential expression results (logFC, pval) rather than raw expression data.

---

### Visualization Functions

**`gseapy.plot.gseaplot()`**

**Purpose**: Generate GSEA enrichment plot for a specific pathway.

**Usage**:
```python
from gseapy.plot import gseaplot

# Generate GSEA plot
fig = gseaplot(
    term='GO_BP_TERM',           # Pathway name
    hits=pre_res.results.loc['GO_BP_TERM', 'lead_genes'].split(';'),
    nes=pre_res.results.loc['GO_BP_TERM', 'nes'],
    pval=pre_res.results.loc['GO_BP_TERM', 'pval'],
    fdr=pre_res.results.loc['GO_BP_TERM', 'fdr'],
    RES=running_es_vector,       # Running enrichment score
    pheno_pos='Treatment',
    pheno_neg='Control',
    gene_set_name='GO_BP_TERM',
    figsize=(6, 5)
)
```

**Parameters**:
| Parameter | Description |
|-----------|-------------|
| `term` | Pathway/gene set name |
| `hits` | List of leading edge genes |
| `nes` | Normalized enrichment score |
| `pval` | P-value |
| `fdr` | FDR value |
| `RES` | Running enrichment score vector |
| `pheno_pos` | Positive phenotype label |
| `pheno_neg` | Negative phenotype label |

---

**`gseapy.plot.barplot()`**

**Purpose**: Create bar plot of enriched terms.

**Usage**:
```python
from gseapy.plot import barplot

# Bar plot of top enriched pathways
barplot(
    results=pre_res.results,
    column='fdr',           # Column to color by
    title='GSEA Results',
    figsize=(6, 10),
    cutoff=0.05             # Only show terms with FDR < 0.05
)
```

---

### Utility Functions

**`gseapy.get_library_name()`**

**Purpose**: Get list of available gene set libraries.

**Usage**:
```python
import gseapy as gp

# Get all available libraries
libraries = gp.get_library_name()

# Get organism-specific libraries
human_libs = gp.get_library_name(organism='human')
```

---

**`gseapy.read_gmt()`**

**Purpose**: Read gene sets from GMT file.

**Usage**:
```python
from gseapy.parser import read_gmt

# Read custom GMT file
gene_sets = read_gmt('custom_gene_sets.gmt')
# Returns: dict {gene_set_name: [gene1, gene2, ...]}
```

---

## Integration Mapping

### Pipeline Step to Function Mapping

| Step | Description | Package | Function |
|------|-------------|---------|----------|
| 1 | Combine replicates | Python/Pandas | `pd.concat()`, `pd.merge()` |
| 2 | Generate Unique PSM | Python/Pandas | String concatenation |
| 3 | Remove razor info | Python | Custom logic |
| 4 | Remove low quality | Python/Pandas | Filtering |
| 5 | Filter by criteria | Python/Pandas | `df.dropna()`, percentage calc |
| **6** | **Protein abundance** | **R/msqrob2** | **`aggregateFeatures()`** |
| **7** | **Differential expression** | **R/msqrob2** | **`msqrob()`** |
| 8 | QC metrics | Python | `sklearn.decomposition.PCA`, etc. |
| **9** | **GSEA analysis** | **Python/gseapy** | **`gp.prerank()`** |

### Data Flow

```
Step 1-5 (Python):
  PSM_Abundances.tsv
       ↓
Step 6 (R/msqrob2):
  aggregateFeatures() → Protein_Abundances.tsv
       ↓
Step 7 (R/msqrob2):
  msqrob() → Diff_Expression.tsv
       ↓
Step 8 (Python):
  QC metrics calculation → QC data JSON
       ↓
Step 9 (Python/gseapy):
  gp.prerank() → GSEA results (5 databases)
```

### Input/Output File Formats

**Step 6 Input**: `PSM_Abundances.tsv`
```
Unique_PSM    Master_Protein_Accessions    Sample_Origination    Abundance
PEP1_MOD1_2   P12345                       DMSO_1                12345.6
...
```

**Step 6 Output**: `Protein_Abundances.tsv`
```
Master_Protein_Accessions    Gene_Name    DMSO_1    DMSO_2    ...    INCZ_1
P12345                       GENE1        10.2      10.5      ...    12.3
...
```

**Step 7 Output**: `Diff_Expression.tsv`
```
Master_Protein_Accessions    Gene_Name    logFC    pval    adjPval
P12345                       GENE1        2.1      0.001   0.005
...
```

**Step 9 Input**: Pre-ranked gene list
```python
rnk = pd.DataFrame({
    'gene': ['GENE1', 'GENE2', ...],
    'metric': [5.2, -3.1, ...]  # -log10(pval) * sign(logFC)
})
```

**Step 9 Output**: GSEA results
```
term                    es       nes      pval    fdr    lead_genes
GO:0001234            0.85     1.23     0.001   0.05   GENE1;GENE2;...
...
```

---

## Key Considerations

### msqrob2

1. **Data Format**: Requires QFeatures object with proper assay structure
2. **Missing Data**: Uses hurdle model to handle missing values without imputation
3. **Normalization**: Performs log2 transformation and median centering internally
4. **Robustness**: Uses M-estimation for outlier-resistant summarization
5. **Model Formula**: Must match experimental design (e.g., ~ condition)

### GSEApy

1. **Gene Identifiers**: Must use gene symbols (UPPERCASE for Enrichr libraries)
2. **Ranking Metric**: Use -log10(pval) * sign(logFC) or similar
3. **Gene Set Size**: Filter with min_size/max_size to avoid too small/large sets
4. **Permutations**: 1000 is standard; increase for more precise p-values
5. **Leading Edge**: Genes contributing most to enrichment (before peak ES)

---

## References

**msqrob2**:
- Goeminne et al. (2020). MSqRob takes the hurdle towards more accurate differential proteomics. *Bioinformatics*.
- Sticker et al. (2020). Robust summarization and inference in proteome-wide label-free quantitative mass spectrometry. *bioRxiv*.

**GSEApy**:
- Fang et al. (2022). GSEApy: a comprehensive package for performing gene set enrichment analysis in Python. *Bioinformatics*, btac757.
- Subramanian et al. (2005). Gene set enrichment analysis: a knowledge-based approach for interpreting genome-wide expression profiles. *PNAS*.

---

*Last updated: 2026-03-14*
