# 10 - Processing Pipeline (9 Steps)

**Purpose:** Detailed documentation of the 9-step data processing pipeline

---

## Pipeline Overview

```
Input: PSM CSV Files
    ↓
Step 1: Combine Replicates
    ↓
Step 2: Generate Unique PSM
    ↓
Step 3: Remove Razor (optional)
    ↓
Step 4: Remove Low Quality
    ↓
Step 5: Filter by Criteria
    ↓
Step 6: Protein Abundance (msqrob2)
    ↓
Step 7: Differential Expression (msqrob2)
    ↓
Step 8: QC Metrics
    ↓
Step 9: GSEA Analysis (gseapy)
    ↓
Output: Results, QC Plots, GSEA
```

---

## Step 1: Combine Replicates

**Function:** `combine_replicates()`  
**Package:** Python/Pandas  
**Output:** `PSM_Abundances.tsv`

### Input
Multiple PSM CSV files: `PSM_ExperimentName_Condition_ReplicateNumber.csv`

### Processing
```python
def combine_replicates(file_paths: List[Path]) -> pd.DataFrame:
    """Combine multiple PSM files into single TSV."""
    combined = []
    
    for file_path in file_paths:
        # Parse filename
        parsed = parse_psm_filename(file_path.name)
        
        # Read CSV
        df = pd.read_csv(file_path)
        
        # Extract required columns
        df = df[REQUIRED_COLUMNS]
        
        # Find abundance column (dynamic)
        abundance_col = find_abundance_column(df.columns)
        
        # Rename to unified column
        df = df.rename(columns={abundance_col: 'Abundance'})
        
        # Add sample origination
        df['Sample_Origination'] = f"{parsed.condition}_{parsed.replicate}"
        
        combined.append(df)
    
    return pd.concat(combined, ignore_index=True)
```

### Output Columns
- `Sequence`
- `Modifications`
- `Charge`
- `Contaminant`
- `Master_Protein_Accessions`
- `Quan_Info`
- `Abundance`
- `Sample_Origination`

---

## Step 2: Generate Unique PSM

**Function:** `generate_unique_psm()`  
**Package:** Python/Pandas  
**Output:** `PSM_Abundances.tsv` (updated)

### Processing
```python
def generate_unique_psm(df: pd.DataFrame) -> pd.DataFrame:
    """Generate unique PSM identifier."""
    df['Unique_PSM'] = (
        df['Sequence'] + '|' + 
        df['Modifications'] + '|' + 
        df['Charge'].astype(str)
    )
    return df
```

---

## Step 3: Remove Razor Information

**Function:** `remove_razor_peptides()`  
**Package:** Python  
**Output:** `PSM_Abundances.tsv` (updated)

### Logic
For peptides matching multiple proteins, select the best match:

```python
def remove_razor_peptides(df: pd.DataFrame, fasta_db: Dict) -> pd.DataFrame:
    """Resolve razor peptides to single protein."""
    resolved = []
    
    for (unique_psm, sample), group in df.groupby(['Unique_PSM', 'Sample_Origination']):
        if len(group) == 1:
            resolved.append(group.iloc[0])
            continue
        
        # Get all protein matches
        proteins = group['Master_Protein_Accessions'].iloc[0].split('; ')
        
        # Select best protein
        best_protein = select_best_protein(proteins, fasta_db)
        
        # Update group
        group['Master_Protein_Accessions'] = best_protein
        resolved.append(group.iloc[0])
    
    return pd.DataFrame(resolved)

def select_best_protein(proteins: List[str], fasta_db: Dict) -> str:
    """Select best protein based on:
    1. Most peptides matched
    2. Longest sequence (tie-breaker)
    3. First in list (final tie-breaker)
    """
    # Count peptides per protein
    peptide_counts = count_peptides_per_protein(proteins)
    max_count = max(peptide_counts.values())
    candidates = [p for p, c in peptide_counts.items() if c == max_count]
    
    if len(candidates) == 1:
        return candidates[0]
    
    # Tie-breaker: longest sequence
    lengths = {p: len(fasta_db.get(p, '')) for p in candidates}
    max_length = max(lengths.values())
    candidates = [p for p, l in lengths.items() if l == max_length]
    
    if len(candidates) == 1:
        return candidates[0]
    
    # Final tie-breaker: first in original list
    return proteins[0]
```

---

## Step 4: Remove Low Quality PSM

**Function:** `remove_low_quality()`  
**Package:** Python/Pandas  
**Output:** `PSM_Abundances.tsv` (updated)

### Filters
```python
def remove_low_quality(df: pd.DataFrame) -> pd.DataFrame:
    """Remove low quality PSMs."""
    initial_count = len(df)
    
    # Remove contaminants
    df = df[~df['Contaminant']]
    
    # Remove "No Value" quantification
    df = df[df['Quan_Info'] != 'No Value']
    
    # Remove low abundance
    df = df[df['Abundance'] >= 1]
    
    removed = initial_count - len(df)
    logger.info(f"Removed {removed} low quality PSMs")
    
    return df
```

---

## Step 5: Filter by Criteria

**Function:** `filter_by_criteria()`  
**Package:** Python/Pandas  
**Output:** `PSM_Abundances.tsv` (updated)

### Strict vs Lenient Filtering
```python
def filter_by_criteria(df: pd.DataFrame, strict: bool) -> pd.DataFrame:
    """Filter PSMs based on criteria."""
    # Missing value threshold
    threshold = 0.2 if strict else 0.4  # 20% or 40%
    
    # Calculate missing values per condition
    for condition in df['Condition'].unique():
        condition_df = df[df['Condition'] == condition]
        replicates = condition_df['Replicate'].nunique()
        max_missing = int(replicates * threshold)
        
        # Remove PSMs with too many missing values
        df = df.groupby('Unique_PSM').filter(
            lambda x: x['Abundance'].isna().sum() <= max_missing
        )
    
    # Strict only: Remove proteins with only 1 PSM
    if strict:
        psm_counts = df.groupby('Master_Protein_Accessions').size()
        valid_proteins = psm_counts[psm_counts > 1].index
        df = df[df['Master_Protein_Accessions'].isin(valid_proteins)]
    
    return df
```

---

## Step 6: Protein Abundance (msqrob2)

**Function:** `aggregateFeatures()`  
**Package:** R/msqrob2  
**Output:** `Protein_Abundances.tsv`

### R Script
```r
# scripts/msqrob2_protein.R
library(msqrob2)
library(QFeatures)
library(limma)

args <- commandArgs(trailingOnly = TRUE)
input_file <- args[1]
output_file <- args[2]

# Read PSM data
psm_data <- read.delim(input_file, sep="\t", stringsAsFactors=FALSE)

# Create QFeatures object
pe <- readQFeatures(
    table = psm_data,
    fnames = "Unique_PSM",
    ecol = grep("Abundance", colnames(psm_data)),
    name = "peptide"
)

# Add protein annotations
rowData(pe[["peptide"]])$Proteins <- psm_data$Master_Protein_Accessions

# Aggregate to protein level
pe <- aggregateFeatures(
    object = pe,
    i = "peptide",
    fcol = "Proteins",
    name = "protein",
    fun = MsCoreUtils::robustSummary
)

# Extract protein abundances
protein_data <- assay(pe[["protein"]])

# Add gene names
gene_names <- map_proteins_to_genes(rownames(protein_data))
protein_data$Gene_Name <- gene_names

# Write output
write.table(
    protein_data,
    file = output_file,
    sep = "\t",
    row.names = TRUE,
    quote = FALSE
)
```

---

## Step 7: Differential Expression (msqrob2)

**Function:** `msqrob()`  
**Package:** R/msqrob2  
**Output:** `Diff_Expression.tsv`

### R Script
```r
# scripts/msqrob2_de.R
library(msqrob2)
library(QFeatures)
library(limma)

args <- commandArgs(trailingOnly = TRUE)
input_file <- args[1]
output_file <- args[2]
treatment <- args[3]
control <- args[4]

# Read protein abundances
pe <- readQFeatures(
    table = read.delim(input_file, sep="\t"),
    ecol = 2:ncol(read.delim(input_file, sep="\t")),
    name = "protein"
)

# Create design matrix
colData(pe)$condition <- factor(
    ifelse(grepl(treatment, colnames(pe)), "Treatment", "Control"),
    levels = c("Control", "Treatment")
)

# Fit robust linear model
pe <- msqrob(
    object = pe,
    i = "protein",
    formula = ~ condition,
    modelColumnName = "rlm",
    robust = TRUE
)

# Extract results
results <- getResults(pe, i = "protein", modelColumnName = "rlm")

# Write output
write.table(
    results,
    file = output_file,
    sep = "\t",
    row.names = FALSE,
    quote = FALSE
)
```

### Output Columns
- `Master_Protein_Accessions`
- `Gene_Name`
- `logFC` - Log2 fold change
- `pval` - Raw p-value
- `adjPval` - Adjusted p-value (BH)
- `se` - Standard error
- `df` - Degrees of freedom

---

## Step 8: QC Metrics

**Function:** `calculate_qc_metrics()`  
**Package:** Python (sklearn, scipy)  
**Output:** `QC_Results.json`

### Metrics Calculated
```python
def calculate_qc_metrics(
    protein_abundances: pd.DataFrame,
    diff_expression: pd.DataFrame
) -> dict:
    """Calculate all QC metrics."""
    return {
        'pca': calculate_pca(protein_abundances),
        'pvalue_distribution': calculate_pvalue_dist(diff_expression),
        'psm_cv': calculate_cv(psm_abundances),
        'intensity_distributions': calculate_intensities(protein_abundances),
        'data_completeness': calculate_completeness(protein_abundances),
    }

def calculate_pca(df: pd.DataFrame) -> dict:
    """PCA on protein abundances."""
    from sklearn.decomposition import PCA
    from sklearn.preprocessing import StandardScaler
    
    # Prepare data
    data = df.dropna()
    scaler = StandardScaler()
    scaled = scaler.fit_transform(data.T)
    
    # PCA
    pca = PCA(n_components=2)
    components = pca.fit_transform(scaled)
    
    return {
        'samples': list(data.columns),
        'pc1': components[:, 0].tolist(),
        'pc2': components[:, 1].tolist(),
        'conditions': extract_conditions(data.columns),
        'pc1_variance': pca.explained_variance_ratio_[0] * 100,
        'pc2_variance': pca.explained_variance_ratio_[1] * 100,
    }
```

---

## Step 9: GSEA Analysis (gseapy)

**Function:** `gp.prerank()`  
**Package:** Python/gseapy  
**Output:** GSEA results (5 databases)

### Python Code
```python
import gseapy as gp
import pandas as pd
import numpy as np

def run_gsea_analysis(
    diff_expression: pd.DataFrame,
    output_dir: Path
) -> dict:
    """Run GSEA on all databases."""
    
    # Prepare ranked list
    rnk = pd.DataFrame({
        'gene': diff_expression['Gene_Name'],
        'metric': -np.log10(diff_expression['pval']) * np.sign(diff_expression['logFC'])
    }).sort_values('metric', ascending=False)
    
    databases = {
        'go_bp': 'GO_Biological_Process_2021',
        'go_mf': 'GO_Molecular_Function_2021',
        'go_cc': 'GO_Cellular_Component_2021',
        'kegg': 'KEGG_2021_Human',
        'reactome': 'Reactome_2022',
    }
    
    results = {}
    for name, gene_set in databases.items():
        try:
            pre_res = gp.prerank(
                rnk=rnk,
                gene_sets=gene_set,
                outdir=str(output_dir / name),
                permutation_num=1000,
                min_size=15,
                max_size=500,
                threads=4,
                seed=123,
            )
            results[name] = pre_res.results
        except Exception as e:
            logger.error(f"GSEA failed for {name}: {e}")
            results[name] = None
    
    return results
```

---

## Pipeline State Management

### State Persistence
```python
class PipelineState:
    """Track pipeline execution state."""
    
    def __init__(self, session_id: str):
        self.session_id = session_id
        self.state_file = SESSIONS_DIR / session_id / 'pipeline_state.json'
        self.load()
    
    def load(self):
        """Load state from disk."""
        if self.state_file.exists():
            with open(self.state_file) as f:
                self.data = json.load(f)
        else:
            self.data = {
                'current_step': 0,
                'completed_steps': [],
                'failed_step': None,
                'outputs': {},
            }
    
    def save(self):
        """Save state to disk."""
        with open(self.state_file, 'w') as f:
            json.dump(self.data, f)
    
    def mark_completed(self, step: int, output: Path):
        self.data['completed_steps'].append(step)
        self.data['outputs'][f'step_{step}'] = str(output)
        self.save()
    
    def mark_failed(self, step: int, error: str):
        self.data['failed_step'] = step
        self.data['error'] = error
        self.save()
```

---

## Recovery Procedures

### Resume from Failed Step
```python
async def resume_processing(session_id: str):
    """Resume processing from last failed step."""
    state = PipelineState(session_id)
    
    if state.data['failed_step'] is None:
        raise ValueError("No failed step to resume from")
    
    failed_step = state.data['failed_step']
    
    # Retry from failed step
    pipeline = ProcessingPipeline(session_id)
    await pipeline.run(start_from_step=failed_step)
```

---

## Next Steps

See [11-websocket-protocol.md](11-websocket-protocol.md) for real-time updates.
