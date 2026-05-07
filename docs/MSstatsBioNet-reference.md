# MSstatsBioNet Reference

**Package:** MSstatsBioNet v1.0.0  
**Description:** Network Analysis for MS-based Proteomics Experiments  
**Bioconductor:** 3.21 | R ≥ 4.4.0  
**Authors:** Anthony Wu, Olga Vitek (Northeastern University)  
**URL:** https://vitek-lab.github.io/MSstatsBioNet/

---

## Overview

MSstatsBioNet takes the output of MSstats differential abundance analysis and maps the results onto protein-protein interaction networks using INDRA (Integrated Network and Dynamical Reasoning Assembler), a literature-mined database of biological interactions. It provides three main functions:

1. **annotateProteinInfoFromIndra** — Convert protein IDs to HGNC identifiers and annotate with functional info
2. **getSubnetworkFromIndra** — Query INDRA for a subnetwork of protein interactions around differentially abundant proteins
3. **visualizeNetworks** — Render the subnetwork in Cytoscape Desktop

---

## Upstream Dependencies (Workflow Context)

MSstatsBioNet sits at the END of an MSstats workflow. You must run these MSstats steps first:

```
Raw data → MSstatsConvert::*ToMSstatsFormat() → MSstats::dataProcess() → MSstats::groupComparison() → MSstatsBioNet
```

### Prerequisite 1: Raw data converted to MSstats format

Use the appropriate converter from `MSstatsConvert` (e.g., `FragPipeToMSstatsFormat`, `MaxQtoMSstatsFormat`, `MetamorpheusToMSstatsFormat`).

**Required columns after conversion:**

| Column | Description |
|--------|-------------|
| `ProteinName` | Protein identifier |
| `PeptideSequence` | Peptide sequence |
| `PrecursorCharge` | Precursor charge state |
| `FragmentIon` | Fragment ion |
| `ProductCharge` | Product charge state |
| `IsotopeLabelType` | Label type (e.g., "L") |
| `Condition` | Experimental condition |
| `BioReplicate` | Biological replicate number |
| `Run` | MS run identifier |
| `Intensity` | Measured intensity/abundance |

### Prerequisite 2: MSstats::dataProcess() output

`QuantData <- dataProcess(msstats_imported, use_log_file = FALSE)`

No special column requirements beyond standard MSstats format.

### Prerequisite 3: MSstats::groupComparison() output (CRITICAL)

`model <- groupComparison(contrast.matrix = "pairwise", data = QuantData, use_log_file = FALSE)`

The `model$ComparisonResult` table is the **primary input** to all MSstatsBioNet functions. It must contain:

| Column | Type | Description |
|--------|------|-------------|
| `Protein` | character | Protein identifier (Uniprot ID or Uniprot mnemonic) |
| `Label` | character | Comparison label (e.g., "NAT vs T") |
| `log2FC` | numeric | Log2 fold change |
| `SE` | numeric | Standard error |
| `Tvalue` | numeric | T-statistic |
| `DF` | numeric | Degrees of freedom |
| `pvalue` | numeric | P-value |
| `adj.pvalue` | numeric | Adjusted p-value |
| `issue` | logical/numeric | QC issue flag |
| `MissingPercentage` | numeric | % missing values |
| `ImputationPercentage` | numeric | % imputed values |

---

## Function 1: annotateProteinInfoFromIndra

### Purpose

Annotates proteins with HGNC identifiers, gene names, and functional classifications (kinase, phosphatase, transcription factor) by querying the INDRA database.

### Signature

```r
annotateProteinInfoFromIndra(df, proteinIdType)
```

### Input Parameters

| Parameter | Required | Type | Description |
|-----------|----------|------|-------------|
| `df` | Yes | data.frame | Output of `groupComparison()` `$ComparisonResult` table |
| `proteinIdType` | Yes | character | `"Uniprot"` for Uniprot accession IDs (e.g., P05023), or `"Uniprot_Mnemonic"` for Uniprot mnemonic IDs (e.g., CLH1_HUMAN) |

**Validation rules:**
- `df` must contain a `Protein` column
- `proteinIdType` must be exactly `"Uniprot"` or `"Uniprot_Mnemonic"`

### Output

Returns a data.frame with the **original columns plus** these additional columns:

| Column | Type | Description |
|--------|------|-------------|
| `UniprotId` | character | Canonical Uniprot accession ID |
| `HgncId` | character | HGNC (HUGO Gene Nomenclature Committee) ID |
| `HgncName` | character | HGNC gene symbol/name |
| `IsTranscriptionFactor` | logical | TRUE if protein is a known transcription factor |
| `IsKinase` | logical | TRUE if protein is a known kinase |
| `IsPhosphatase` | logical | TRUE if protein is a known phosphatase |

### Example

```r
annotated_df <- annotateProteinInfoFromIndra(model$ComparisonResult, "Uniprot")
```

---

## Function 2: getSubnetworkFromIndra

### Purpose

Retrieves a protein-protein interaction subnetwork from the INDRA database based on differentially abundant proteins. The network is derived from literature-mined interactions.

### Signature

```r
getSubnetworkFromIndra(
  input,
  protein_level_data = NULL,
  pvalueCutoff = NULL,
  statement_types = c("IncreaseAmount", "DecreaseAmount"),
  paper_count_cutoff = 1,
  evidence_count_cutoff = 1,
  correlation_cutoff = 0.3,
  sources_filter = NULL
)
```

### Input Parameters

| Parameter | Required | Type | Default | Description |
|-----------|----------|------|---------|-------------|
| `input` | Yes | data.frame | — | Output of `annotateProteinInfoFromIndra()` (must have HgncId and HgncName columns) |
| `protein_level_data` | No | data.frame | `NULL` | Output of `dataProcess()` `$ProteinLevelData`. If provided, enables correlation-based filtering |
| `pvalueCutoff` | No | numeric | `NULL` | P-value threshold for filtering significant proteins. `NULL` = no filtering |
| `statement_types` | No | character vector | `c("IncreaseAmount", "DecreaseAmount")` | INDRA interaction/statement types to include |
| `paper_count_cutoff` | No | numeric | `1` | Minimum number of distinct papers supporting an interaction |
| `evidence_count_cutoff` | No | numeric | `1` | Minimum number of evidence sentences per paper |
| `correlation_cutoff` | No | numeric | `0.3` | Minimum absolute Pearson correlation for edges (only used when `protein_level_data` is provided) |
| `sources_filter` | No | character vector | `NULL` | Restrict to specific INDRA knowledge sources. Options include `"reach"`, `"medscan"`, `"sparser"`, `"trips"`, `"rlimsp"`, `"geneways"`, `"tees"`, `"isi"`, `"eidos"`, `"hume"`, `"sofia"`. `NULL` = all sources |

**Input must include these columns** (provided by `annotateProteinInfoFromIndra`):
- `HgncId` — HGNC ID for INDRA lookup
- `HgncName` — HGNC gene name
- `pvalue` — for significance filtering
- `log2FC` / `logFC` — for direction filtering

### Output

Returns a **named list** with two data.frames:

#### `$nodes`

| Column | Type | Description |
|--------|------|-------------|
| `id` | character | Protein/gene identifier (HGNC name) |
| `pvalue` | numeric | P-value from differential abundance analysis |
| `log2FC` (or `logFC`) | numeric | Log2 fold change |
| `hgncName` | character | HGNC gene name |
| *(other protein annotation columns from input)* | | |

#### `$edges`

| Column | Type | Description |
|--------|------|-------------|
| `source` | character | Source node identifier (HGNC name) |
| `target` | character | Target node identifier (HGNC name) |
| `interaction` | character | Type of interaction (e.g., "IncreaseAmount", "DecreaseAmount") |
| `evidenceCount` | numeric | Number of evidence items supporting the interaction |
| `evidenceLink` | character | URL linking to INDRA evidence page |
| *(additional evidence metadata)* | | |

### Example

```r
subnetwork <- getSubnetworkFromIndra(
    annotated_df,
    pvalueCutoff = 0.05,
    statement_types = c("IncreaseAmount", "DecreaseAmount"),
    paper_count_cutoff = 1,
    evidence_count_cutoff = 1
)
head(subnetwork$nodes)
head(subnetwork$edges)
```

---

## Function 3: visualizeNetworks

### Purpose

Pushes the subnetwork from `getSubnetworkFromIndra` to Cytoscape Desktop for interactive visualization. **Cytoscape Desktop must be running** for this function to work.

### Signature

```r
visualizeNetworks(
  nodes,
  edges,
  pvalueCutoff = 0.05,
  logfcCutoff = 0.5,
  node_label_column = "id",
  main_targets = c()
)
```

### Input Parameters

| Parameter | Required | Type | Default | Description |
|-----------|----------|------|---------|-------------|
| `nodes` | Yes | data.frame | — | `subnetwork$nodes` from `getSubnetworkFromIndra()` |
| `edges` | Yes | data.frame | — | `subnetwork$edges` from `getSubnetworkFromIndra()` |
| `pvalueCutoff` | No | numeric | `0.05` | P-value threshold for coloring significant nodes |
| `logfcCutoff` | No | numeric | `0.5` | Log2 fold change threshold for coloring significant nodes |
| `node_label_column` | No | character | `"id"` | Column in nodes to use as display label (use `"hgncName"` for gene names) |
| `main_targets` | No | character vector | `c()` | IDs of proteins to highlight with a distinct node shape |

**Nodes must contain:**
- `id` (character)
- `pvalue` (numeric)
- `log2FC` or `logFC` (numeric)

**Edges must contain:**
- `source` (character)
- `target` (character)
- `interaction` (character)
- `evidenceCount` (numeric)
- `evidenceLink` (character)

### Output

Returns `NULL` (invisibly). Side effect: creates a network visualization in Cytoscape Desktop with:
- Significant nodes (p < pvalueCutoff AND |log2FC| > logfcCutoff) colored distinctively
- Interaction arrows between connected proteins
- Clickable evidence links for each interaction
- Highlighted main_target nodes with different shape

### Example

```r
visualizeNetworks(
    subnetwork$nodes,
    subnetwork$edges,
    pvalueCutoff = 0.05,
    logfcCutoff = 0.5,
    node_label_column = "id",
    main_targets = c("ATP1A1", "NDUFS8")
)
```

---

## Complete Workflow Summary

```r
# 1. Convert raw data to MSstats format
library(MSstatsConvert)
msstats_input <- FragPipetoMSstatsFormat(raw_data, use_log_file = FALSE)

# 2. Process and normalize
library(MSstats)
QuantData <- dataProcess(msstats_input, use_log_file = FALSE)

# 3. Differential abundance analysis
model <- groupComparison(contrast.matrix = "pairwise", data = QuantData, use_log_file = FALSE)

# 4. Annotate proteins with HGNC IDs and functional info
library(MSstatsBioNet)
annotated_df <- annotateProteinInfoFromIndra(model$ComparisonResult, "Uniprot")

# 5. Get interaction subnetwork from INDRA
subnetwork <- getSubnetworkFromIndra(
    annotated_df,
    protein_level_data = QuantData$ProteinLevelData,
    pvalueCutoff = 0.05,
    correlation_cutoff = 0.3
)

# 6. Visualize in Cytoscape (Cytoscape Desktop must be open)
visualizeNetworks(subnetwork$nodes, subnetwork$edges)
```

---

## Dependencies

- **Required:** MSstats (≥ 4.4.0), RCy3, httr, jsonlite, r2r, tidyr
- **External:** INDRA database (queried via HTTP API), Cytoscape Desktop (for visualization)
- **License:** Artistic-2.0 (package), BSD 2-Clause (INDRA). Individual INDRA knowledge sources may have different licenses for commercial use.

---

## Notes

1. **Cytoscape required:** `visualizeNetworks()` requires Cytoscape Desktop to be running. The function communicates with it via the RCy3 package.
2. **Network query:** `getSubnetworkFromIndra()` makes HTTP calls to the INDRA REST API — an internet connection is required.
3. **Protein ID types:** The annotation function only accepts `"Uniprot"` or `"Uniprot_Mnemonic"`. If your data uses other ID types, convert them upstream.
4. **Correlation filtering:** Passing `protein_level_data` to `getSubnetworkFromIndra()` enables correlation-based edge filtering, which removes interactions where protein abundances don't correlate across samples.
