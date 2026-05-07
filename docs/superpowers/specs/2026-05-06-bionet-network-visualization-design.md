# BioNet Network Visualization Module — Design Spec

**Date:** 2026-05-06  
**Status:** Design approved, awaiting implementation plan  
**Package:** MSstatsBioNet v1.0.0 (Bioconductor, installed)

---

## Overview

Add a new "BioNet" visualization module that maps differential abundance results onto protein-protein interaction networks using INDRA's literature-mined database. The frontend renders the network with Cytoscape.js, replacing the need for Cytoscape Desktop.

**User flow:** Select a comparison → configure parameters (or accept defaults) → click "Run" → see interactive network graph.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  FRONTEND                                                     │
│                                                               │
│  BioNet Page (single column, stacked cards, like GSEA)       │
│  ┌─────────────────┐  ┌────────────────────────────────────┐ │
│  │ Config Card      │  │ Network Viz Card (Cytoscape.js)    │ │
│  │                 │  │                                    │ │
│  │ Comparison ▼    │  │  ○ ──→ ○    [Layout ▼] [Export]  │ │
│  │ Adj. p-val: [0.05]│  │  │     │                           │ │
│  │ |logFC|: [0.5]  │  │  ○     ○                          │ │
│  │ Paper cnt: [1]  │  │                                    │ │
│  │ Evidence cnt:[1]│  │  Legend: ● Up  ● Down  ○ Not sig  │ │
│  │ Sources: ☑...   │  │                                    │ │
│  │ [Run BioNet]    │  │                                    │ │
│  └─────────────────┘  └────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
         POST /run          GET /status        GET /subnetwork
              │                  │                   │
              ▼                  ▼                   ▼
┌──────────────────────────────────────────────────────────────┐
│  BACKEND                                                      │
│                                                               │
│  Routes (visualization.py)                                    │
│    POST /{id}/bionet/run         → fire background asyncio.Task │
│    GET  /{id}/bionet/status       → poll bionet_status.json   │
│    GET  /{id}/bionet/subnetwork   → return { nodes, edges }   │
│                                                               │
│  bionet_service.py                                             │
│    1. Lock per-session (prevent concurrent runs)              │
│    2. Read Diff_Expression_{comparison}.tsv                   │
│    3. Pre-filter by |logFC| (Python-side)                       │
│    4. Write filtered TSV + config JSON to temp files          │
│    5. Spawn R subprocess → bionet_network.R                   │
│    6. Parse nodes.csv + edges.csv                             │
│    7. Cache to bionet_subnetwork.json, update status          │
│                                                               │
│  bionet_network.R (new script)                                │
│    args[1]=input_tsv, args[2]=config_json,                    │
│    args[3]=output_nodes_csv, args[4]=output_edges_csv         │
│    1. Rename: Protein←Master_Protein_Accessions,               │
│       log2FC←logFC, adj.pvalue←adjPval, inject issue=NA      │
│    2. annotateProteinInfoFromIndra(df, "Uniprot")             │
│    3. getSubnetworkFromIndra(annotated, ...user params)       │
│    4. write.csv(nodes), write.csv(edges)                      │
└──────────────────────────────────────────────────────────────┘
```

### Key decisions

- **Single comparison only** — `getSubnetworkFromIndra` requires exactly one row per HGNC ID; it crashes on duplicates from multi-comparison input
- **One R subprocess call** — column rename, annotation, and subnetwork query happen in one script
- **Python-side pre-filtering** — apply |logFC| cutoff before handing to R (since `getSubnetworkFromIndra` does not have a logFC parameter). P-value filtering is handled by `getSubnetworkFromIndra`'s built-in `pvalueCutoff` parameter
- **Status file on disk** — `sessions/{id}/bionet/bionet_status.json`, matching the GSEA pattern

---

## Frontend

### Route & Module Registration

New entry in `frontend/src/config/visualization-modules.ts`:

```typescript
{
  id: 'bionet',
  label: 'BioNet',
  href: '/analysis/visualization/bionet',
  icon: GitNetwork,
  supportedTemplates: ['multi_condition_comparison'],
}
```

New page at `frontend/src/app/analysis/visualization/bionet/page.tsx`.

### Config Panel — Parameters

All parameters are exposed before starting. Defaults allow clicking "Run" immediately.

| Parameter | Default | Type | Description |
|-----------|---------|------|-------------|
| Comparison | First available | string (dropdown) | Which DE comparison to analyze |
| Adjusted p-value cutoff | 0.05 | number | Proteins with adjusted p-value < cutoff are included. Internally `getSubnetworkFromIndra` filters on `adj.pvalue`, not raw p-value |
| \|Log2FC\| cutoff | 0.5 | number | Proteins with \|fold change\| > cutoff are used |
| Statement types | ["IncreaseAmount", "DecreaseAmount"] | multi-select | INDRA interaction types to include |
| Paper count cutoff | 1 | number | Min distinct papers supporting an interaction |
| Evidence count cutoff | 1 | number | Min evidence sentences per paper |
| Correlation cutoff | — | number (optional) | Min abs Pearson correlation. Disabled/hidden in v1 — requires `dataProcess()` ProteinLevelData, which the msqrob2 pipeline does not produce. Included in the parameter type for future use with MSstats pipeline |
| Sources filter | All selected | checkboxes (11 sources) | INDRA knowledge sources: reach, medscan, sparser, trips, rlimsp, geneways, tees, isi, eidos, hume, sofia |

### Network Viz Card — Cytoscape.js

**Node styling:**
- Color: red (upregulated), blue (downregulated), grey (not significant)
- Based on logFC sign, with p-value and logFC thresholds from config
- Shape: circle (default), diamond for user-specified "key targets"
- Size proportional to |logFC|

**Edge styling:**
- Color by interaction type: green (IncreaseAmount), red (DecreaseAmount)
- Width proportional to evidenceCount
- Arrow on target end for direction

**Interactions:**
- Click node → highlight first neighbors, show tooltip (hgncName as title, UniProt id, logFC, p-value)
- Click edge → show interaction details + evidence link (opens INDRA in new tab)
- Hover node/edge → highlight and show brief tooltip (hgncName + logFC for nodes)
- Pan, zoom, drag nodes (standard Cytoscape.js behavior)

**Node labels:** Display `hgncName` (gene name) on nodes, not the UniProt accession `id`

**Toolbar:**
- Layout selector: force-directed (cose-bilkent), concentric, grid, circle
- Export PNG button
- Legend toggle
- Key targets input: comma-separated gene names (e.g., "TP53, AKT1"); matching nodes get diamond shape

**npm dependencies to add:** `cytoscape`, `cytoscape-cose-bilkent`, `@types/cytoscape`

### State Management

Following the GSEA page pattern exactly:

| State | Type | Purpose |
|-------|------|---------|
| `selectedComparison` | string | Current comparison from dropdown |
| `config` | BioNetConfig | All user-editable parameters |
| `runStatus` | BioNetRunStatus | `idle` / `running` / `completed` / `error` |
| `subnetwork` | BioNetSubnetwork \| null | nodes + edges from API |
| `loading` | boolean | True during data fetch |
| `runError` | string \| null | Error from POST /run |

**Polling:** After POST /run, poll GET /status every 2 seconds. Stop on `completed` or `error`. Resume polling on page mount if status is `running`.

### UI Layout

Single-column vertical, following GSEA page structure:

```
[Page Header] "BioNet Network Analysis"
[Config Card] — comparison selector, parameter inputs, "Run BioNet" button
  OR [Run Status] — spinner with "Querying INDRA..." message during running
[Network Viz Card] — Cytoscape.js canvas + toolbar (visible after run completes)
```

### TypeScript Types

In `frontend/src/types/api.ts`:

```typescript
export interface BioNetRunRequest {
  comparison: string;
  pvalue_cutoff: number;       // NOTE: filters on adjusted p-value (adj.pvalue), not raw p-value
  logfc_cutoff: number;
  statement_types: string[];
  paper_count_cutoff: number;
  evidence_count_cutoff: number;
  correlation_cutoff: number | null;
  sources_filter: string[] | null;
}

export interface BioNetRunStatus {
  status: 'idle' | 'running' | 'completed' | 'error';
  comparison?: string;
  error?: string;
  started_at?: string;
  completed_at?: string;
}

export interface BioNetNode {
  id: string;         // UniProt accession (e.g., "P05023"), set from Protein column
  logFC: number;
  pvalue: number;     // NOTE: this is the adjusted p-value (from adj.pvalue)
  hgncName: string;   // HGNC gene name (e.g., "ATP1A1"), use for display labels
}

export interface BioNetEdge {
  source: string;     // UniProt accession of source node
  target: string;     // UniProt accession of target node
  interaction: string;
  evidenceCount: number;
  paperCount: number;
  evidenceLink: string;
  sourceCounts: Record<string, number>;
}

export interface BioNetSubnetwork {
  nodes: BioNetNode[];
  edges: BioNetEdge[];
}
```

In `frontend/src/lib/api.ts`:

```typescript
runBioNet(sessionId: string, body: BioNetRunRequest): Promise<{ status: string }>
getBioNetStatus(sessionId: string): Promise<BioNetRunStatus>
getBioNetSubnetwork(sessionId: string): Promise<BioNetSubnetwork>
```

---

## Backend

### API Routes

All in `backend/app/api/routes/visualization.py`. Three endpoints:

#### POST `/api/sessions/{session_id}/bionet/run`

- Request body: `BioNetRunRequest` (Pydantic model)
- Validates session exists, comparison file exists
- Acquires per-session `asyncio.Lock` (prevents concurrent BioNet runs)
- Creates background `asyncio.Task` running `_background_bionet_run`
- Returns `{ status: "started" }` immediately

#### GET `/api/sessions/{session_id}/bionet/status`

- Returns contents of `sessions/{id}/bionet/bionet_status.json`
- Returns `{ status: "idle" }` if no status file exists

#### GET `/api/sessions/{session_id}/bionet/subnetwork`

- Returns contents of `sessions/{id}/bionet/bionet_subnetwork.json`
- 404 if no subnetwork has been computed yet

### Pydantic Models

In `backend/app/models/analysis.py` or a new models file:

```python
class BioNetRunRequest(BaseModel):
    comparison: str
    pvalue_cutoff: float = 0.05    # NOTE: getSubnetworkFromIndra filters on adj.pvalue, not raw p-value
    logfc_cutoff: float = 0.5
    statement_types: list[str] = ["IncreaseAmount", "DecreaseAmount"]
    paper_count_cutoff: int = 1
    evidence_count_cutoff: int = 1
    correlation_cutoff: float | None = None
    sources_filter: list[str] | None = None

class BioNetNode(BaseModel):
    id: str            # UniProt accession (set from Protein column, e.g. "P05023")
    logFC: float
    pvalue: float      # NOTE: this is the adjusted p-value (from adj.pvalue)
    hgncName: str      # HGNC gene name for display labels

class BioNetEdge(BaseModel):
    source: str        # UniProt accession of source node
    target: str        # UniProt accession of target node
    interaction: str
    evidenceCount: int
    paperCount: int
    evidenceLink: str
    sourceCounts: dict[str, int]

class BioNetSubnetwork(BaseModel):
    nodes: list[BioNetNode]
    edges: list[BioNetEdge]
```

### Service: `bionet_service.py`

```python
class BioNetService:
    async def run_bionet(
        session_id: str,
        config: BioNetRunRequest,
        status_dir: Path,
        results_dir: Path,
    ) -> None:
        """
        1. Read Diff_Expression_{comparison}.tsv
        2. Pre-filter by |logFC| > logfc_cutoff (only |logFC|; p-value
           filtering is done by getSubnetworkFromIndra internally)
        3. Write filtered TSV + config JSON to temp files
        4. Run R script via subprocess (asyncio.to_thread)
        5. Parse nodes.csv + edges.csv
        6. Write bionet_subnetwork.json
        7. Update bionet_status.json at each step
        """
```

### R Script: `backend/scripts/bionet_network.R`

```r
# Usage: Rscript bionet_network.R <input_tsv> <config_json> <nodes_csv> <edges_csv>
args <- commandArgs(trailingOnly = TRUE)

library(MSstatsBioNet)
library(jsonlite)

# Read input
df <- read.delim(args[1], stringsAsFactors = FALSE)
config <- fromJSON(args[2])

# Rename columns to match MSstatsBioNet expectations
# NOTE: getSubnetworkFromIndra filters on adj.pvalue (not pvalue) and requires
# an "issue" column (all NAs = no issues). We must satisfy both.
colnames(df)[colnames(df) == "Master_Protein_Accessions"] <- "Protein"
colnames(df)[colnames(df) == "logFC"] <- "log2FC"
colnames(df)[colnames(df) == "adjPval"] <- "adj.pvalue"
df$issue <- NA  # required by .filterGetSubnetworkFromIndraInput

# Annotate UniProt → HGNC
annotated <- annotateProteinInfoFromIndra(df, "Uniprot")

# Get subnetwork from INDRA
subnetwork <- getSubnetworkFromIndra(
    annotated,
    pvalueCutoff = config$pvalue_cutoff,
    statement_types = config$statement_types,
    paper_count_cutoff = config$paper_count_cutoff,
    evidence_count_cutoff = config$evidence_count_cutoff,
    correlation_cutoff = config$correlation_cutoff,
    sources_filter = config$sources_filter
)

# Write output
write.csv(subnetwork$nodes, args[3], row.names = FALSE)
write.csv(subnetwork$edges, args[4], row.names = FALSE)
```

### Disk Layout

```
sessions/{session_id}/
  results/
    Diff_Expression_{comparison}.tsv    ← input (already exists)
  bionet/
    bionet_status.json                  ← { status, comparison, error?, started_at?, completed_at? }
    bionet_subnetwork.json              ← { nodes: [...], edges: [...] }
```

---

## Files Changed / Created

### New files

| File | Purpose |
|------|---------|
| `frontend/src/app/analysis/visualization/bionet/page.tsx` | BioNet page component |
| `frontend/src/components/visualization/BioNetNetwork.tsx` | Cytoscape.js network viz component |
| `backend/app/services/bionet_service.py` | BioNet service (R subprocess orchestration) |
| `backend/scripts/bionet_network.R` | R script (calls MSstatsBioNet) |

### Modified files

| File | Change |
|------|--------|
| `frontend/src/config/visualization-modules.ts` | Add BioNet module entry |
| `frontend/src/types/api.ts` | Add BioNet types |
| `frontend/src/lib/api.ts` | Add BioNet API functions |
| `backend/app/api/routes/visualization.py` | Add 3 BioNet endpoints + Pydantic models |
| `frontend/package.json` | Add cytoscape, cytoscape-cose-bilkent, @types/cytoscape |

---

## Key Constraints

1. **Single comparison only** — `getSubnetworkFromIndra` requires exactly one row per HGNC ID; multi-comparison merge would require pre-aggregation logic that the package does not provide
2. **Internet required for INDRA** — `getSubnetworkFromIndra` calls the INDRA REST API; it will fail offline
3. **Cytoscape.js for web** — Replaces Cytoscape Desktop; no RCy3 dependency needed at runtime (only for the `visualizeNetworks` function which we don't use)
4. **Follows GSEA on-demand pattern** — POST/status polling/GET results, per-session lock, background asyncio.Task
5. **P-value = adjusted p-value** — `getSubnetworkFromIndra` internally filters on `adj.pvalue` (column `adj.pvalue`), not raw `pvalue`. The R script must rename `adjPval` → `adj.pvalue`, not `pval` → `pvalue`. Output nodes' `pvalue` field also contains the adjusted p-value
6. **`issue` column required** — `.filterGetSubnetworkFromIndraInput` access the `issue` column. If absent, R returns 0 rows silently and the call fails. The R script must inject `df$issue <- NA`
7. **Only nodes with edges appear in output** — `.constructNodesDataFrame` drops nodes that have no interactions in INDRA. Proteins that pass the p-value cutoff but have no known interacting partners will not appear
8. **Max 400 proteins** — `getSubnetworkFromIndra` throws an error if the input has ≥ 400 proteins. Pre-filtering by p-value and |logFC| must reduce the count below this threshold
9. **Node `id` is UniProt accession** — `.constructNodesDataFrame` sets `id = input$Protein` (e.g., "P05023"), not the gene name. Use `hgncName` for display labels

---

## Out of Scope

- Cytoscape Desktop integration (replaced by Cytoscape.js)
- Multi-comparison merged networks
- STRING or other network database sources (INDRA only, as MSstatsBioNet provides)
- Correlation-based edge filtering via INDRA (requires `dataProcess()` ProteinLevelData; the msqrob2 pipeline does not produce this, and piping it through would require significant plumbing. The parameter is in the type for future wiring to the MSstats pipeline)
- Export to Cytoscape session file
