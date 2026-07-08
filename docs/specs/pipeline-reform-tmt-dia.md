# Spec: Pipeline Reform — TMT → MSstats, DIA → msqrob2

**Branch:** `pipeline-reform-tmt-dia`
**Status:** Draft
**Date:** 2026-07-08

---

## 1. Overview

### 1.1 Purpose

Restructure the analysis pipeline system so the statistical pipeline is determined by the user's data type selection rather than an independent user choice. In real-world proteomics:

- **TMT (Tandem Mass Tag)** data uses **MSstats** for statistical modeling
- **DIA (Data-Independent Acquisition)** data uses **msqrob2** for robust protein analysis

The current app presents msqrob2 and MSstats as equivalent choices unrelated to the actual data format. This reform aligns the app with real-world usage.

### 1.2 Scope

| In Scope | Out of Scope |
|---|---|
| TMT file upload & channel detection | PTM pipeline changes |
| DIA file upload & per-file metadata | New statistical methods |
| Analysis type selection UI | GSEA/BioNet/Compare changes |
| Channel-to-condition mapping UI | Visualization page changes |
| Metadata input (experiment, condition, replicate, batch) | Report generation changes |
| Pipeline auto-derivation from type | Backward compat with old PSM_*.csv |
| R script adaptation for new input format | CI/CD changes |
| Test suite updates | |

### 1.3 Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Wizard flow | User selects TMT/DIA before upload | Clear user intent, enables format-specific validation |
| File format support | `.txt` and `.csv`, auto-detect delimiter | Real PD exports are `.txt` tab-delimited |
| Metadata source | Manual user input (no filename parsing) | Real PD files have arbitrary names |
| TMT channel mapping | Inline dropdowns + CSV import/export | Both convenience and bulk-editing needs |
| DIA metadata | Editable table + CSV import/export | Same pattern as current ExperimentTable |
| PTM pipeline | Preserved as separate flow | Out of scope for this reform |
| Old PSM_*.csv format | Dropped | Real PD exports only |
| Summary step | Kept (6 wizard steps for protein, 5 for PTM) | Review before launching is valuable |
| R scripts | Investigate before implementation | Audit found column contracts are compatible; verify token matching in msqrob2 R scripts |
| TMT batch | No batch for TMT | Not applicable to TMT workflow |
| Min TMT files | 1 | Single PD export contains all channels |
| Min DIA files | 2 | Need multiple runs for comparison |
| File ID column | Ignored for metadata | Not needed for condition assignment |
| Multi-file TMT | Supported | Each file gets its own channel mapping; files can share experiment name + batch |
| Remove razor / Strict filtering | Available for BOTH msqrob2 and MSstats | Both R scripts support these; no change from current behavior |
| TMT plex sizes | Any detected channels | No hardcoded plex limits; 6, 10, 16, 18 — whatever PD exports |
| Upload validation | Column presence + numeric type check | Verify required columns exist AND abundance columns are numeric |
| DIA replicate requirement | Soft warning | Show "⚠ Recommended: ≥3" but allow continuing with fewer |
| DIA batch input | Manual text input per file | User types batch label; no auto-suggest |
| Quan Value rename order | Rename to Abundance BEFORE space→underscore pass | Prevents "Quan_Value" artifact |
| TMT experiment name | One per file, can be shared | Files with same experiment + different batch = multi-plex study |
| R script group name translation | Python translates user group names → `condition_N` for R config | R scripts require `^condition_` prefix; translation is transparent to user |
| Condition group ordering | UI column order (left to right) | Determines concatenation order in `Condition` and `Sample_Origination` |
| Multi-file TMT UI | Collapsible sections per file | Each file expands to show its own channel mapping table |
| Session migration | Remove `conditions` field + clean sessions directory | Break backward compat; no migration script needed |
| Auto-generate comparisons | Full string compare | Every unique condition string vs selected reference condition string |
| Replicate in metadata | Stored as string, converted to int at runtime | Current behavior preserved |
| Upload batch failure | Partial success | Valid files saved, invalid files rejected with error per file |
| CSV import collisions | Validate + reject | Reserved names (Channel, Replicate, filename, experiment, batch) blocked |
| Quan Value collision | Check + fallback name | If Abundance already exists, rename to Abundance_DIA with warning |
| Remove razor unification | Add Python step to msqrob2, remove from R script | Both pipelines use FASTA-based tie-breaking |
| PD column validation | Required columns only, extras OK | Different PD versions produce different column sets |
| Pipeline architecture | Composable step library | Input / Shared / Engine / Post sections; plain list composition |
| msqrob2 preprocessing | REMOVE_LOW_QUALITY + FILTER_CRITERIA added | Both pipelines now 8 steps, structurally symmetric |
| R script redundancy | Keep internal filtering as safety net | Python filtering is primary; R script catches edge cases |
| Shared step unification | Merge QC + unique_psm handlers | One file per step, no pipeline-specific variants |
| Step numbering | Positional from list index | Not hardcoded in step handlers

---

## 2. User Stories

### 2.1 TMT Analysis

**As a** proteomics researcher with a Proteome Discoverer TMT export,
**I want to** upload my file, map TMT channels to experimental conditions, configure MSstats parameters, and run the analysis,
**So that** I can get differential expression results for my TMT experiment without manually choosing a statistical method.

**Acceptance criteria:**
- I select "Protein Analysis" → "TMT" from the type selection page
- I upload a single `.txt` or `.csv` file from Proteome Discoverer
- The app detects my TMT channels (e.g., 16 channels: 126–134N)
- I assign each channel to a condition and replicate via dropdowns (or import a CSV mapping)
- I define comparisons between conditions
- I configure MSstats parameters
- I review the summary and start analysis
- The MSstats pipeline runs automatically

### 2.2 DIA Analysis

**As a** proteomics researcher with multiple Proteome Discoverer DIA exports,
**I want to** upload my files, assign experiment/condition/replicate/batch metadata to each file, configure msqrob2 parameters, and run the analysis,
**So that** I can get differential expression results for my DIA experiment without manually choosing a statistical method.

**Acceptance criteria:**
- I select "Protein Analysis" → "DIA" from the type selection page
- I upload multiple `.txt` or `.csv` files
- The app validates each file has the DIA-expected columns (Quan Value, no TMT channels)
- I fill in metadata per file: experiment name, condition, replicate number, batch
- I define comparisons between conditions
- I configure msqrob2 parameters including batch correction
- I review the summary and start analysis
- The msqrob2 pipeline runs automatically

### 2.3 PTM Analysis (Preserved)

**As a** PTM researcher,
**I want to** access the existing PTM analysis flow,
**So that** my workflow is not disrupted by the protein analysis reform.

**Acceptance criteria:**
- I select "PTM Analysis" from the type selection page
- The existing PTM upload flow is preserved (enrichment data, global proteome, FASTA)
- PTM uses DIA format (as currently supported)

---

## 3. Functional Requirements

### FR1: Analysis Type Selection

**FR1.1** — The home page SHALL have three quick-start buttons: "New TMT Analysis", "New DIA Analysis", "New PTM Analysis". Each SHALL create a session via `POST /api/sessions` with the type pre-selected, then navigate directly to the upload page (`/new/upload?session={id}&type={tmt|dia|ptm}`), skipping `/new/type`.

**FR1.2** — A "New Analysis" link SHALL also exist (for users who prefer the guided flow), navigating to `/new/type` showing two options: "Protein Analysis" and "PTM Analysis".

**FR1.3** — Selecting "Protein Analysis" on the type page SHALL reveal a second toggle: "TMT" or "DIA".

**FR1.4** — Selecting "PTM Analysis" SHALL auto-set to DIA (no second toggle needed).

**FR1.5** — TMT selection SHALL set `file_type = "tmt"` and derive `pipeline = "msstats"`.

**FR1.6** — DIA selection SHALL set `file_type = "dia"` and derive `pipeline = "msqrob2"`.

**FR1.7** — On continue, the session SHALL be created/updated with the selected type via `sessionsApi.updateConfig(sessionId, { file_type: selectedType })`. This transitions session state from CREATED to CONFIGURING.

**FR1.8** — PTM analysis SHALL be accessible from the home page quick-start button or the `/new/type` page (selecting "PTM Analysis"). The subsequent wizard pages (Upload, Metadata, Comparisons, Config) SHALL use conditional rendering based on `analysisType === 'ptm'` to show PTM-specific sections, matching the existing `selectedTemplate` conditional pattern. No separate PTM routes are created — PTM shares the same page files with conditional content.

**FR1.9** — PTM wizard SHALL skip the Metadata step. PTM uses 5 steps: Type → Upload → Comparisons → Config → Summary. The Metadata page SHALL redirect PTM sessions to Comparisons. This is temporary — PTM will adopt the same input format as protein analysis (TMT-PTM and DIA-PTM paths) in a future implementation.

### FR2: File Upload

**FR2.1** — The upload page SHALL accept files with `.csv` and `.txt` extensions.

**FR2.2** — The upload page SHALL auto-detect delimiter (tab vs comma) by reading the first line.

**FR2.3** — The upload page SHALL validate file columns against the selected analysis type using the ORIGINAL PD column names (with spaces). After validation passes, Pipeline Step 1 renames spaces to underscores for internal consistency:
  - **TMT:** `Sequence, Modifications, Charge, Contaminant, Master Protein Accessions, Quan Info` + ≥2 columns matching `Abundance \d+[NC]?`
  - **DIA:** `Sequence, Modifications, Charge, Contaminant, Master Protein Accessions, Quan Info` + `Quan Value` column

**FR2.4** — The upload page SHALL NOT require any specific filename pattern.

**FR2.5** — The upload page SHALL NOT extract metadata from filenames.

**FR2.6** — For TMT, the upload response SHALL include detected TMT channel labels (e.g., `["126", "127N", ..., "134N"]`).

**FR2.7** — For DIA, the upload response SHALL confirm `Quan Value` column presence.

**FR2.8** — TMT uploads SHALL require a minimum of 1 file.

**FR2.9** — DIA uploads SHALL require a minimum of 2 files.

**FR2.10** — Uploading a file that does not match the selected type SHALL show a clear error.

**FR2.11** — For TMT files, empty string abundance values (`""`) SHALL be converted to `NaN` during preprocessing. Rows where the melted abundance is `NaN` SHALL be dropped (a PSM with no reporter ion intensity in a given channel is not meaningful).

**FR2.12** — The upload validation SHALL NOT use the old `Abundance F{code} Sample` pattern (which only matches mock CSV format, not real PD exports). Instead: TMT uses `Abundance \d+[NC]?` pattern; DIA detects `Quan Value` column directly.

**FR2.13** — Backend file-count validation SHALL be context-dependent: TMT requires ≥1 file (`MIN_PROTEOMICS_FILES=1`), DIA requires ≥2 files (`MIN_DIA_FILES=2`). The processing route SHALL check `session.config.file_type` to determine which minimum applies.

**FR2.14** — Column validation SHALL check only required columns exist. Extra columns from different PD versions or CHIMERYS configurations SHALL be allowed and carried through silently.

**FR2.15** — For DIA files, if both `Quan Value` and `Abundance` columns exist (edge case), `Quan Value` SHALL be renamed to `Abundance_DIA` and a warning logged. The existing `Abundance` column SHALL NOT be overwritten.

**FR2.16** — Upload batch failures SHALL use partial success semantics: valid files are saved, invalid files are rejected with per-file error messages. This preserves the current behavior (files are uploaded in batches of 5; a failed file does not roll back already-saved files in the batch).

**FR2.17** — Upload validation SHALL verify that abundance columns contain numeric data (not text). For TMT: all `Abundance \d+[NC]?` columns must be numeric or empty (empty→NaN at pipeline time). For DIA: the `Quan Value` column must be numeric. Non-numeric abundance data SHALL cause file rejection with a clear error.

### FR3: Metadata Input

**FR3.1** — A new metadata page at `/new/metadata` SHALL be the second wizard step after upload.

**FR3.2 — TMT Metadata:**

**FR3.2.1** — SHALL display the detected TMT channels as a table, one row per channel.

**FR3.2.2** — Each channel row SHALL have:
  - Channel label (read-only, e.g., "126", "127N")
  - Condition group columns (user-defined, ≥1 columns — e.g., "drug", "time")
  - Replicate number input

**FR3.2.3** — Users SHALL be able to add/remove/rename condition group columns (same as the current ExperimentTable "+ Add Column" pattern). Values are filled per channel.

**FR3.2.4** — SHALL support assigning multiple channels to the same condition-group-values + replicate combination (e.g., channels 127N and 127C both get drug=Treatment, time=24h, replicate=1).

**FR3.2.5** — SHALL provide "Import Mapping CSV" button that reads a CSV with columns: `Channel, <group1>, <group2>, ..., Replicate`.

**FR3.2.6** — SHALL provide "Export Mapping CSV" button that downloads the current mapping.

**FR3.2.7** — SHALL have an "Experiment Name" text input per uploaded TMT file. Multiple TMT files can share the same experiment name with different batch labels.

**FR3.2.8** — SHALL validate that at least 2 unique condition-group-value combinations (effectively ≥2 conditions) are assigned and all channels are mapped.

**FR3.2.9** — TMT channel mapping data model SHALL be: `dict[str, dict[str, str|int]]` — channel → `{group1: val1, group2: val2, ..., replicate: N}`. Example: `{"126": {"drug": "DMSO", "time": "24h", "replicate": 1}}`.

**FR3.2.10** — For multi-file TMT, each file SHALL appear as an expandable collapsible section in the metadata page. Expanding a file reveals its channel mapping table. Files with the same experiment name and different batch labels are treated as separate plexes.

**FR3.3 — DIA Metadata:**

**FR3.3.1** — SHALL display an editable table with one row per uploaded file.

**FR3.3.2** — Each row SHALL have editable fields:
  - **Experiment** (text, can be shared across files)
  - **Condition group columns** (user-defined, ≥1 — e.g., "drug", "time", "gender")
  - **Replicate** (number, with auto-increment suggestion)
  - **Batch** (manual text input, for batch correction grouping in msqrob2)

**FR3.3.3** — Users SHALL be able to add/remove/rename condition group columns via "+ Add Column" (same pattern as the current ExperimentTable). This replaces the old auto-created `condition_1`, `condition_2` from filename parsing.

**FR3.3.4** — SHALL provide "Import Metadata CSV" button that reads a CSV with columns: `filename, experiment, <group1>, <group2>, ..., replicate, batch`.

**FR3.3.5** — SHALL provide "Export Metadata CSV" button that downloads the current metadata.

**FR3.3.6** — SHALL validate: at least 2 unique condition-group-value combinations (effectively ≥2 conditions), all required fields filled. Replicate count per condition SHALL show a soft warning if <3 (does not block continuing).

**FR3.4** — Metadata state (TMT channel mappings, DIA per-file metadata) SHALL be auto-saved to the backend via `sessionsApi.updateConfig()` with an 800ms debounce (same pattern as the current Upload page's auto-save). For TMT: saves `tmt_channel_mapping`. For DIA: saves `metadata_columns`. This ensures metadata survives page refresh. The Metadata page SHALL also restore state from the backend on mount.

**FR3.5 — Group Name Translation:** When building R config JSON for msqrob2 R scripts, Python SHALL translate user-defined condition group names (e.g., `drug`, `time`) to `condition_1`, `condition_2`, etc. The order follows the UI column order (left to right). This translation is transparent to the user — they never see `condition_N` in the UI. Translation happens in BOTH `msqrob2_wrapper._build_data_process_config()` (Step 6) and `_build_gc_config()` (Step 7), since both R scripts use `config$metadata`. Example: `{drug: "DMSO", time: "24h"}` → `{condition_1: "DMSO", condition_2: "24h"}` in the R config.

**FR3.6 — Condition Group Ordering:** When concatenating condition group values into `Condition` and `Sample_Origination` strings, values SHALL be joined in UI column order (left to right). This order is deterministic and user-controlled. Example: columns [drug, time] → `"DMSO_24h_1"`, NOT `"24h_DMSO_1"`.

**FR3.7 — CSV Import Reserved Names:** Imported CSV column headers SHALL be validated against reserved names. For TMT mapping CSVs, reserved names are `Channel` and `Replicate`. For DIA metadata CSVs, reserved names are `filename`, `experiment`, `replicate`, and `batch`. CSVs with reserved-name columns SHALL be rejected with a clear error message.

**FR3.8 — Replicate Type:** Replicate values SHALL be stored as strings in `metadata_columns` (current behavior). Conversion to integer SHALL happen at pipeline runtime when building the DataFrame for step execution.

### FR4: Comparisons

**FR4.1** — The comparisons page SHALL derive condition cards from metadata. For TMT: unique condition-group-value combinations across all channels in `tmt_channel_mapping`. For DIA: unique condition-group-value combinations across all files in `metadata_columns`. Each card represents a `group:value` pair (e.g., "drug:DMSO", "time:24h"). This preserves the current col:val pair model.

**FR4.2** — The drag-and-drop comparison builder SHALL work as before. Users drag condition cards into Group A and Group B. Each comparison is stored as `{group1: {col: val, ...}, group2: {col: val, ...}}`.

**FR4.3** — SHALL add an "Auto-generate comparisons" section above the manual builder. Users select a reference condition from a dropdown. Clicking "Generate" creates all pairwise comparisons: every unique condition vs the reference. Generated pairs populate the same comparison list and can be reviewed/deleted individually.

**FR4.4** — Covariates selection SHALL be available for TMT (MSstats) only.

**FR4.5 — Auto-Generate Comparisons:** The auto-generate feature SHALL use full-string comparison. When the user selects a reference condition (e.g., `"DMSO_24h"`), it SHALL generate one comparison per unique condition string vs the reference. No dimension matching is attempted — each condition string is treated as atomic. Users who need dimension-specific comparisons (e.g., match on time, vary drug) SHALL use the manual drag-and-drop builder.

### FR5: Configuration

**FR5.1** — The config page SHALL render MSstats-specific parameters when `file_type = "tmt"`.

**FR5.2** — The config page SHALL render msqrob2-specific parameters when `file_type = "dia"`.

**FR5.3** — Shared parameters (organism, p-value/logFC thresholds, single-peptide exclusion) SHALL render for both.

**FR5.4** — The "Remove Razor Peptides" and "Strict Filtering" toggles SHALL appear for BOTH TMT (MSstats) and DIA (msqrob2).

**FR5.5 — Pipeline Architecture:** Both pipelines SHALL use the composable step library architecture. Steps 2-5 and 8 are shared across all pipelines. Steps 1 (input) and 6-7 (engine) are pipeline-specific. Pipeline definitions use plain list composition in `pipeline_registry.py`. Step numbering is positional (list index + 1), not hardcoded.

**FR5.6 — Shared Preprocessing:** REMOVE_LOW_QUALITY and FILTER_CRITERIA SHALL run for BOTH TMT and DIA pipelines. These steps operate on the unified column contract and are input-format-agnostic. The msqrob2 R script's internal contaminant/reverse filtering SHALL be kept as a safety net (Python filtering is primary).

**FR5.7 — Remove Razor Unification:** Both pipelines SHALL use identical FASTA-based tie-breaking logic via the shared `REMOVE_RAZOR` step. The `smallestUniqueGroups()` call SHALL be removed from `msqrob2_data_process.R`.

**FR5.8 — Step Handler Unification:** `QC_METRICS` and `UNIQUE_PSM` SHALL each have a single unified step handler (no pipeline-specific variants). Currently these are 100% duplicate code in separate files.

**FR5.9 — Step Numbering:** The `PipelineEngine` SHALL set `ctx.current_step_number = step.number` before calling each step handler. Step handlers SHALL use `ctx.current_step_number` (not hardcoded integers) when writing to `ctx.step_outputs[ctx.current_step_number]`.

**FR5.10 — Column Contract Test:** An automated test SHALL verify that Pipeline Step 1+2 output for BOTH TMT and DIA produces a DataFrame with the exact required columns (Section 8.1). This test SHALL run as part of `test_pipeline_chains.py` and fail the build if the contract breaks.

**FR5.11 — Reserved Column Names:** User-defined condition group names SHALL be validated against system column names. Reserved names: `Sequence, Modifications, Charge, Contaminant, Master_Protein_Accessions, Quan_Info, Abundance, Sample_Origination, Condition, Replicate, Unique_PSM`. If a user tries to name a group with a reserved name, the UI SHALL reject it with a clear error.

### FR6: Pipeline Derivation

**FR6.1** — `_derive_pipeline()` SHALL return `PipelineTool.MSSTATS` when `file_type = "tmt"`.

**FR6.2** — `_derive_pipeline()` SHALL return `PipelineTool.MSQROB2` when `file_type = "dia"`.

**FR6.3** — The session's `pipeline` field SHALL be automatically set, not user-selected.

**FR6.4** — `_derive_pipeline()` SHALL include a legacy fallback for old sessions that lack `file_type`: check `session.pipeline` string field as a secondary source.

**FR6.5** — The `config_forward_fields` list in `processing.py` SHALL include `"file_type"` and `"tmt_channel_mapping"` so they are forwarded from `SessionConfig` to `AnalysisConfig` when the pipeline starts.

**FR6.6** — Implementation reference (backend/app/api/routes/processing.py):
```python
def _derive_pipeline(session: Session) -> PipelineTool:
    ft = getattr(session.config, "file_type", None) if session.config else None
    if ft == "tmt":
        return PipelineTool.MSSTATS
    if ft == "dia":
        return PipelineTool.MSQROB2
    # Legacy fallback for old sessions without file_type
    raw = getattr(session, "pipeline", None)
    if raw in ("msqrob2", "msstats"):
        return PipelineTool(raw)
    return PipelineTool.MSQROB2
```

### FR7: Summary & Launch

**FR7.1** — The summary page SHALL display the derived pipeline name (not a user choice).

**FR7.2** — The summary page SHALL display file info, metadata, comparisons, and configuration in collapsible sections.

**FR7.3** — "Start Analysis" SHALL trigger the correct pipeline based on `file_type`.

---

## 4. Data Model Changes

### 4.1 `ProteomicsFileInfo` (backend/app/models/session.py)

```python
class ProteomicsFileInfo(FileInfo):
    """CHANGED: metadata is now user-provided, not filename-parsed."""
    experiment: str = ""          # User input (was: parsed from filename)
    replicate: int = 0            # User input (was: parsed from filename)
    batch: str | None = None      # NEW: for DIA batch correction
    file_type: str | None = None  # NEW: "tmt" | "dia"
    
    # REMOVED: conditions: list[str]
    # REMOVED: filename-parsing logic in model_validator
    # NOTE: condition groups (drug, time, gender, etc.) are stored in 
    #       SessionConfig.metadata_columns, NOT in ProteomicsFileInfo
```

### 4.2 `SessionConfig` (backend/app/models/session.py)

```python
class SessionConfig(BaseModel):
    # ... existing fields ...
    
    # NEW fields:
    file_type: str | None = None              # "tmt" | "dia"
    tmt_channel_mapping: dict[str, dict[str, str|int]] | None = None  
    # Channel → {group1: val1, group2: val2, ..., replicate: N}
    # Example: {"126": {"drug": "DMSO", "time": "24h", "replicate": 1}}
    
    # EXISTING field (unchanged structure, user-populated instead of filename-parsed):
    metadata_columns: dict[str, dict[str, str]] | None = None
    # {filename: {group1: val1, group2: val2, experiment: "...", replicate: "N", batch: "..."}}
    # Condition groups are now user-defined columns, not auto-created condition_1, condition_2
    
    # NOTE: pipeline field still exists but is now derived, not user-set
```

### 4.3 `AnalysisConfig` (backend/app/models/analysis.py)

```python
class AnalysisConfig(BaseModel):
    # ... existing fields ...
    
    # NEW fields:
    file_type: str | None = None
    tmt_channel_mapping: dict[str, dict[str, str | int]] | None = None
    # Channel → {group1: val1, group2: val2, ..., replicate: N}
```

### 4.4 `Session` (backend/app/models/session.py)

```python
class Session(BaseModel):
    # CHANGED default:
    pipeline: str = ""  # Was: "msqrob2". Now derived from file_type.
```

### 4.5 Frontend Types (frontend/src/types/index.ts)

```typescript
// RENAMED from ParsedFilename
interface UploadedFileInfo {
  filename: string;
  size: number;
  columns?: string[];
  experiment: string;          // user input, default ""
  replicate: number;           // user input, default 0
  batch: string;               // user input, default ""
  file_type: 'tmt' | 'dia' | null;  // auto-detected
  tmt_channels?: string[];     // TMT only
}

// NEW
interface FileDetectionResult {
  file_type: 'tmt' | 'dia';
  columns: string[];
  tmt_channels?: string[];
  warnings: string[];
}

// NEW
type AnalysisType = 'tmt' | 'dia' | 'ptm';

// UPDATED SessionConfig
interface SessionConfig {
  // ... existing ...
  file_type?: 'tmt' | 'dia';
  tmt_channel_mapping?: Record<string, Record<string, string | number>>;
  // {channel: {group1: val1, group2: val2, ..., replicate: N}}
}
```

### 4.6 Frontend Store (frontend/src/stores/analysis-store.ts)

```typescript
// CHANGED state:
analysisType: 'tmt' | 'dia' | 'ptm' | null;  // replaces selectedTemplate + selectedPipeline
uploadedFiles: UploadedFileInfo[];             // was ParsedFilename[]
tmtChannelMapping: Record<string, Record<string, string | number>>;
// {channel: {drug: "DMSO", time: "24h", replicate: 1}}

// REMOVED:
// selectedTemplate: 'protein' | 'ptm'
// selectedPipeline: 'msqrob2' | 'msstats' | 'ptm' | null

// NEW actions:
setAnalysisType(type: AnalysisType): void;
updateChannelMapping(channel: string, groups: Record<string, string | number>): void;
importChannelMapping(csvData: string): void;
```

---

## 5. API Changes

### 5.1 Upload Response (changed)

```json
// POST /api/sessions/{id}/upload/proteomics — response changed
{
  "files": [
    {
      "filename": "20260424_DOCK5_PANC0203_PSMs.txt",
      "size": 280941552,
      "columns": ["Checked", "Tags", ..., "Abundance 126", ..., "SVM Score"],
      "file_type": "tmt",
      "tmt_channels": ["126", "127N", "127C", ..., "134N"]
    }
  ]
}
```

### 5.2 Session Config (changed)

```json
// PUT /api/sessions/{id}/config — new fields accepted
{
  "file_type": "tmt",
  "tmt_channel_mapping": {
    "126": {"drug": "DMSO", "time": "24h", "replicate": 1},
    "127N": {"drug": "Treatment", "time": "24h", "replicate": 1},
    "127C": {"drug": "Treatment", "time": "24h", "replicate": 2}
  },
  "metadata_columns": {
    "MGL251001P01C02_01_PSMs.txt": {
      "experiment": "MGL2510",
      "drug": "DMSO",
      "time": "24h",
      "replicate": "1",
      "batch": "A"
    }
  },
  "comparisons": [
    {"group1": {"drug": "Treatment"}, "group2": {"drug": "DMSO"}}
  ]
}
```

### 5.3 Pipeline Derivation (changed)

```
POST /api/sessions/{id}/process
→ server reads session.config.file_type
→ "tmt" → PipelineTool.MSSTATS (8 steps)
→ "dia" → PipelineTool.MSQROB2 (8 steps, symmetric with MSstats)
```

### 5.4 Removed Endpoints

None. All existing endpoints remain; their behavior may change as documented above.

---

## 6. UI/UX Specifications

### 6.1 Wizard Steps

**Protein Analysis (TMT/DIA) — 6 steps:**

| Step | Route | Label | Purpose |
|---|---|---|---|
| 1 | `/new/type` | Type | Protein (TMT/DIA) or PTM selection |
| 2 | `/new/upload` | Upload | File upload with format validation |
| 3 | `/new/metadata` | Metadata | Per-file/channel metadata input |
| 4 | `/new/comparisons` | Comparisons | Drag-and-drop comparison builder + auto-generate |
| 5 | `/new/config` | Configure | Pipeline-specific parameters |
| 6 | `/new/summary` | Summary | Review and launch |

**PTM Analysis — 5 steps (skips Metadata):**

| Step | Route | Label | Purpose |
|---|---|---|---|
| 1 | `/new/type` | Type | PTM selection |
| 2 | `/new/upload` | Upload | PTM enrichment + global proteome + FASTA |
| 3 | `/new/comparisons` | Comparisons | Comparison builder |
| 4 | `/new/config` | Configure | PTM-specific parameters |
| 5 | `/new/summary` | Summary | Review and launch |

### 6.2 Type Selection Page (`/new/type`)

```
┌─────────────────────────────────────────────┐
│  New Analysis                                │
│                                              │
│  Analysis Type:                              │
│  [Protein Analysis]  [PTM Analysis]           │
│                                              │
│  ── If Protein Analysis selected: ──         │
│  Data Type:                                  │
│  [TMT]  [DIA]                                │
│                                              │
│  TMT: Uses MSstats for statistical modeling  │
│  of TMT multiplexed quantitative data.        │
│  Supports TMTpro 16-plex, TMT 10-plex, etc.  │
│                                              │
│  DIA: Uses msqrob2 for robust protein        │
│  analysis of data-independent acquisition     │
│  data with batch correction.                  │
│                                              │
│  [Continue to Upload]                        │
└─────────────────────────────────────────────┘
```

### 6.3 Metadata Page — TMT (`/new/metadata?type=tmt`)

```
┌──────────────────────────────────────────────────────────────┐
│  Experiment Metadata                                          │
│                                                               │
│  File: 20260424_DOCK5_PANC0203_PSMs.txt (281 MB)              │
│  Detected: 16 TMT channels (126–134N)                         │
│                                                               │
│  Experiment Name: [DOCK5_PANC0203_____________________]       │
│                                                               │
│  Condition Groups:  [+ Add Group]                             │
│  ┌──────────┬──────────┬──────────┬───────────┐              │
│  │ Channel  │ drug     │ time     │ Replicate │              │
│  ├──────────┼──────────┼──────────┼───────────┤              │
│  │ 126      │ [DMSO_▾] │ [24h__▾] │ [1______] │              │
│  │ 127N     │ [Treat_▾]│ [24h__▾] │ [1______] │              │
│  │ 127C     │ [Treat_▾]│ [24h__▾] │ [2______] │              │
│  │ ...      │ ...      │ ...      │ ...       │              │
│  └──────────┴──────────┴──────────┴───────────┘              │
│                                                               │
│  [Import Mapping CSV]  [Export Mapping CSV]                   │
│                                                               │
│  Validation: ✓ 2 unique condition combos (DMSO_24h, Treat_24h)│
│              ✓ All 16 channels mapped                         │
│              ⚠ Treat_24h has 2 reps (soft warning)            │
│                                                               │
│  [Continue to Comparisons]                                    │
└──────────────────────────────────────────────────────────────┘
```

### 6.4 Metadata Page — DIA (`/new/metadata?type=dia`)

```
┌──────────────────────────────────────────────────────────────────────┐
│  Experiment Metadata                                                  │
│                                                                       │
│  2 DIA files uploaded                                                 │
│                                                                       │
│  Condition Groups:  [+ Add Group]                                     │
│  ┌────────────┬────────────┬──────────┬──────┬───────────┬───────┐    │
│  │ Filename   │ Experiment │ drug     │ time │ Replicate │ Batch │    │
│  ├────────────┼────────────┼──────────┼──────┼───────────┼───────┤    │
│  │ MGL2510... │ [MGL2510_] │ [DMSO___]│[24h_]│ [1______] │ [A___]│    │
│  │ MGL2510... │ [MGL2510_] │ [Treat__]│[24h_]│ [1______] │ [A___]│    │
│  └────────────┴────────────┴──────────┴──────┴───────────┴───────┘    │
│                                                                       │
│  [Import Metadata CSV]  [Export Metadata CSV]                         │
│                                                                       │
│  Validation: ✓ 2 unique condition combos (DMSO_24h, Treatment_24h)    │
│              ⚠ DMSO_24h has 1 replicate (min 3 recommended)           │
│                                                                       │
│  [Continue to Comparisons]                                            │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 7. File Format Specifications

### 7.1 TMT Format (Proteome Discoverer Export)

**Expected columns (78 total):**

Required:
```
Checked, Tags, Confidence, Identifying Node Type, Identifying Node,
Search ID, Identifying Node No, PSM Ambiguity, Sequence,
Annotated Sequence, Modifications, Contaminant, Number of Proteins,
Master Protein Accessions, Master Protein Descriptions,
Protein Accessions, Protein Descriptions, ...
Charge, mz in Da, MHplus in Da, Intensity, MS Order,
RT in min, First Scan, Last Scan, File ID,
Abundance 126, Abundance 127N, Abundance 127C, ..., Abundance 134N,
Quan Info, Number of Protein Groups, q-Value, PEP, SVM Score
```

**TMT channel detection pattern:** `^"?Abundance\s+(\d+)([NC])?"?$`

**Supported plex sizes:** Any detected channels — no hardcoded plex validation. Supports 6-plex (126–131), 10-plex (126–131N/C), 16-plex (126–134N), 18-plex, or any other PD export configuration.

**Delimiter:** Tab (`\t`), all fields double-quoted

### 7.2 DIA Format (Proteome Discoverer Export)

**Expected columns (61 total):**

Same as TMT through `File ID`, then:
```
Number of Protein Groups, q-Value, PEP, SVM Score, Quan Value
```

**Key differences from TMT:**
- NO `Abundance` columns
- NO `Average Reporter SN`
- NO `Isolation Interference in Percent`
- HAS `Quan Value` column (single quantification value per PSM)

**Delimiter:** Tab (`\t`), all fields double-quoted

### 7.3 Channel Mapping Import CSV (TMT)

```csv
Channel,drug,time,Replicate
126,DMSO,24h,1
127N,Treatment,24h,1
127C,Treatment,24h,2
128N,DMSO,48h,1
128C,DMSO,48h,2
129N,Treatment,48h,1
...
```
Columns after `Channel` are user-defined condition groups plus a required `Replicate` column. Group names are taken from column headers. Number of group columns is arbitrary (≥1).

### 7.4 Metadata Import CSV (DIA)

```csv
filename,experiment,drug,time,replicate,batch
MGL251001P01C02_01_PSMs.txt,MGL2510,DMSO,24h,1,A
MGL251001P01C02_02_PSMs.txt,MGL2510,Treatment,24h,1,A
```
Columns after `filename` and `experiment` are user-defined condition groups plus `replicate` and `batch`. Group names are taken from column headers.

---

## 8. Pipeline Behavior — Composable Architecture

Both pipelines are 8 steps with structurally symmetric layouts. Steps 1 differs (input handler). Steps 6-7 differ (engine R scripts). Steps 2-5 and 8 are shared.

### 8.0 Shared Step Library

```
                    TMT Pipeline          DIA Pipeline
                    ────────────          ────────────
Step 1 (Input):     INPUT_TMT             INPUT_DIA
Step 2 (Shared):    UNIQUE_PSM            UNIQUE_PSM
Step 3 (Shared):    REMOVE_RAZOR          REMOVE_RAZOR
Step 4 (Shared):    REMOVE_LOW_QUALITY    REMOVE_LOW_QUALITY
Step 5 (Shared):    FILTER_CRITERIA       FILTER_CRITERIA
Step 6 (Engine):    MSSTATS_ABUNDANCE     MSQROB2_ABUNDANCE
Step 7 (Engine):    MSSTATS_DE            MSQROB2_DE
Step 8 (Post):      QC_METRICS            QC_METRICS
```

Steps in **bold** are input- or engine-specific. All others are shared step functions, imported from organized modules:
- `backend/app/services/steps/inputs/` — `step_input_tmt`, `step_input_dia`
- `backend/app/services/steps/shared/` — `step_unique_psm`, `step_remove_razor`, `step_remove_low_quality`, `step_filter_criteria`, `step_qc_metrics`
- `backend/app/services/steps/engines/` — `step_msqrob2_abundance`, `step_msqrob2_de`, `step_msstats_abundance`, `step_msstats_de`

Pipeline definitions use plain list composition:
```python
TMT_PROTEIN = [
    step_input_tmt, step_unique_psm, step_remove_razor,
    step_remove_low_quality, step_filter_criteria,
    step_msstats_abundance, step_msstats_de, step_qc_metrics,
]
DIA_PROTEIN = [
    step_input_dia, step_unique_psm, step_remove_razor,
    step_remove_low_quality, step_filter_criteria,
    step_msqrob2_abundance, step_msqrob2_de, step_qc_metrics,
]
```

Step numbering is positional (list index + 1). No step number is hardcoded in any handler — `ctx.step_outputs[current_step]` is computed by the engine. This enables trivial composition of future pipelines:
```python
DIA_TIME_SERIES = [
    step_input_dia, step_unique_psm, step_remove_razor,
    step_remove_low_quality, step_filter_criteria,
    step_msqrob2_time_series, step_qc_metrics,  # 7 steps
]
```

### 8.1 Column Contract (both pipelines)

**Produced by Step 1+2:**
```
Sequence, Modifications, Charge, Contaminant, Master_Protein_Accessions,
Quan_Info, Abundance, Sample_Origination, Condition, Replicate, Unique_PSM,
<group1>, <group2>, ...  (user-defined condition group columns)
```

**Format guarantees (both pipelines):**
- `Sample_Origination = "{group1_val}_{group2_val}_..._{replicate}"` (e.g., `"DMSO_24h_1"`)
- `Condition = "{group1_val}_{group2_val}_..."` (e.g., `"DMSO_24h"`) — concatenation of all group values in UI column order
- `Replicate` is an integer (converted from string at runtime, FR3.8)
- `Abundance` is numeric (empty strings → NaN → dropped for TMT, direct numeric from Quan_Value for DIA)
- Condition group columns and `Replicate` are carried through all steps. The QC calculator (Step 8) requires `Abundance, Condition, Replicate, Unique_PSM`.

**Memory management:** `ctx.df` is freed after Step 5 (last Python step before R). Both pipelines free at the same point because they share Steps 1-5.

### 8.2 TMT Input Handler — `INPUT_TMT` (Step 1)

Read TMT file(s) (tab-delimited .txt, auto-detect delimiter). Detect columns matching `Abundance \d+[NC]?`. **Melt with channel identity preserved:** use `pd.melt(id_vars=[all non-abundance columns], value_vars=[abundance columns], var_name='Channel', value_name='Abundance')`. The `Channel` column contains values like `"126"`, `"127N"`, etc. Map channel→groups via `ctx.config.tmt_channel_mapping` by joining on the `Channel` column. Drop the `Channel` column after mapping. Convert empty abundance strings to NaN, then drop NaN rows (PSM with no reporter intensity in that channel). Also drop rows where `Abundance == 0` (zero TMT reporter intensity = no peptide detected). Build `Condition` by joining all group values with `_` in UI column order. Build `Sample_Origination = "{Condition}_{replicate}"`. Rename spaces→underscores in other columns. **Save to `PSM_Combined.parquet`.** Supports multiple files (separate plexes) — concatenate after melting. Sets `ctx.psm_file_path`.

### 8.3 DIA Input Handler — `INPUT_DIA` (Step 1)

Read N DIA files (tab-delimited .txt, auto-detect delimiter). For each file, look up metadata from `ctx.config.metadata_columns`. **CRITICAL:** `metadata_columns` is keyed by ORIGINAL filename (as returned by upload response). `ctx.file_paths` contains sanitized filenames. Match by iterating `metadata_columns` keys and comparing against `file_path.name` with sanitization tolerance (strip special chars, compare case-insensitively). Per-file fields: experiment, condition groups, replicate, batch. **Rename `Quan Value` → `Abundance` FIRST** (if `Abundance` already exists, rename to `Abundance_DIA` with warning), then rename spaces→underscores in all other columns. Build `Condition` by joining all group values with `_` in UI column order. Build `Sample_Origination = "{Condition}_{replicate}"`. **Save to `PSM_Combined.parquet`.** Sets `ctx.psm_file_path`.

### 8.4 Shared: Unique PSM — `UNIQUE_PSM` (Step 2)

Single unified handler. Adds `Unique_PSM = "{Sequence}|{Modifications}|{Charge}"`. Re-saves parquet. Does NOT free `ctx.df` (managed by pipeline engine after last Python step).

### 8.5 Shared: Remove Razor — `REMOVE_RAZOR` (Step 3)

Single unified handler. FASTA-based tie-breaking for razor peptides. Modifies `Master_Protein_Accessions` in-place. Uses `ctx.config.remove_razor`. Skip if disabled.

### 8.6 Shared: Remove Low Quality — `REMOVE_LOW_QUALITY` (Step 4)

Single unified handler. Filters: `Contaminant != "true"`, `Quan_Info != "No Value"`, `Abundance >= 1`. No new columns. Reduces row count.

### 8.7 Shared: Filter by Criteria — `FILTER_CRITERIA` (Step 5)

Single unified handler. Filters by missing-value rate per condition (threshold: 0.2 strict, 0.4 lenient). In strict mode, removes single-peptide proteins. **Saves to `PSM_Abundances.parquet`.** Frees `ctx.df` and updates `ctx.psm_file_path`.

### 8.8 Engine: MSstats — `MSSTATS_ABUNDANCE` + `MSSTATS_DE` (Steps 6-7)

Step 6: `msstats_data_process.R` reads parquet. Maps: `Run←Sample_Origination, Intensity←Abundance, BioReplicate←Replicate, Condition←Condition, PeptideSequence←paste0(Sequence,"_",Charge)`. Transforms to DDARawData → `OpenMStoMSstatsFormat()` → `dataProcess()`. Output: `Protein_Abundances.tsv` + RDS.

Step 7: `msstats_group_comparison_multi.R` reads RDS. Builds contrast matrix from comparisons JSON. Calls `groupComparison()`. Output: `Diff_Expression_*.tsv` per comparison.

### 8.9 Engine: msqrob2 — `MSQROB2_ABUNDANCE` + `MSQROB2_DE` (Steps 6-7)

Step 6: `msqrob2_data_process.R` reads parquet. Detects long format (`Sample_Origination` column). dcasts to wide: `Unique_PSM + Master_Protein_Accessions ~ Sample_Origination`. Creates QFeatures object. Runs normalization, imputation, aggregation, batch correction (if `batch_column` set). Applies `strict_filtering` if configured. R script's internal contaminant/reverse filtering is KEPT as safety net (Python Steps 4-5 are primary). **REMOVED:** `remove_razor` block and `smallestUniqueGroups()` call (moved to shared Python Step 3). Output: `Protein_Abundances.tsv` + QFeatures RDS.

Step 7: `msqrob2_group_comparison_multi.R` reads QFeatures RDS. Assigns conditions from `config$metadata`. Builds contrasts from comparisons JSON. Calls `msqrob()` + `makeContrast()` + `hypothesisTest()`. Output: `Diff_Expression_*.tsv` per comparison.

### 8.10 Shared: QC Metrics — `QC_METRICS` (Step 8)

Single unified handler (merges `step_qc_metrics` + `step_qc_metrics_msqrob2`). Reads `Protein_Abundances.tsv` and `Diff_Expression_*.tsv` files from `ctx.results_dir`. Calculates CV, completeness, intensity distributions via `QCCalculator`. Expects `Abundance, Condition, Replicate, Unique_PSM` columns in the PSM parquet.

---

## 9. R Script Changes — CONFIRMED (post-audit)

### 9.1 Column Contracts (verified by code review)

**`msqrob2_data_process.R` — Pipeline Step 6 (DIA protein abundance):**
- **Long format path** (activated by `Sample_Origination` column presence):
  - REQUIRED: `Unique_PSM`, `Master_Protein_Accessions`, `Sample_Origination`, `Abundance`
  - OPTIONAL: `Contaminant` (filtered), `Reverse` (filtered)
  - Internally reshapes via `dcast(Unique_PSM + Master_Protein_Accessions ~ Sample_Origination, value.var="Abundance")`
  - `Sample_Origination` values become column names (e.g., `DMSO_1`)
- **Wide format path** (fallback, no `Sample_Origination`): Looks for `Abundance F{code} Sample` columns — NOT used in reform (always produce long format)
- Uses `config$metadata` for batch/correction assignment and condition labeling
- Uses `config$batch_column` for `removeBatchEffect()` from limma

**`msqrob2_group_comparison_multi.R` — Pipeline Step 7 (DIA DE):**
- Reads QFeatures RDS from Pipeline Step 6
- Assigns conditions by matching `Sample_Origination` values against `config$metadata` entries
- Builds contrasts from `comparisons_json` using `{group1: {Condition: "val"}, group2: {Condition: "val"}}` format
- Output: `Diff_Expression_{group1}_vs_{group2}.tsv` with columns `Master_Protein_Accessions, Gene_Name, PSM_Count, logFC, pval, adjPval, se, df`

**`msstats_data_process.R` — Pipeline Step 6 (TMT protein abundance):**
- REQUIRED columns: `Master_Protein_Accessions`, `Sequence`, `Charge`, `Sample_Origination`, `Condition`, `Replicate`, `Abundance`
- Maps: `Run ← Sample_Origination`, `Intensity ← Abundance`, `BioReplicate ← Replicate`, `Condition ← Condition`, `PeptideSequence ← paste0(Sequence, "_", Charge)`
- Does NOT use `Unique_PSM` — reconstructs peptide ID from `Sequence` + `Charge`
- Uses `IsotopeLabelType = "L"` (hardcoded; compatible with TMT)
- Transforms to DDARawData → `OpenMStoMSstatsFormat()` → `dataProcess()`

**`msstats_group_comparison_multi.R` — Pipeline Step 7 (TMT DE):**
- Reads RDS `list(converted, processed)` from Step 6
- Supports covariates via `covariates_json`
- Builds contrasts from `comparisons_json` matching against `ProteinLevelData$GROUP`
- Output: `Diff_Expression_{label}.tsv`

### 9.2 R Script Investigation (pre-implementation task)

**Investigate before writing any code.** Run each script with the real PD sample data to verify:

1. **`msqrob2_data_process.R` — Pipeline Step 6:** Verify `config$metadata` token matching works with `Sample_Origination = "DMSO_24h_1"` (multi-group concatenation from Python Steps 1-5). Test `build_batch_vector()` with translated metadata format `{filename: {condition_1: "DMSO", condition_2: "24h", batch: "A"}}`. Confirm `strict_filtering` behaves correctly. Verify internal contaminant/reverse filtering is compatible with Python-preprocessed data. **CRITICAL:** Confirm `remove_razor` block and `smallestUniqueGroups()` call are removed (moved to Python Step 3).
2. **`msqrob2_group_comparison_multi.R` — Pipeline Step 7:** Verify condition assignment from `config$metadata` works with multi-group condition strings after the pipeline changes.
3. **`msstats_data_process.R` — Pipeline Step 6:** Verify the DDARawData transformation works with TMT-melted data (N rows per PSM, where N = number of channels with valid abundance). Confirm `Condition` column (concatenation of group values) maps correctly to MSstats GROUP.
4. **`msstats_group_comparison_multi.R` — Pipeline Step 7:** Verify comparisons format `{group1: {drug: "Treatment"}, group2: {drug: "DMSO"}}` resolves correctly against `ProteinLevelData$GROUP`.

**Investigation command (uses TRANSLATED metadata format — condition_1, condition_2 — matching what Python sends to R):**
```bash
# Test msqrob2 with DIA sample data (metadata already translated to condition_N format)
Rscript backend/scripts/msqrob2_data_process.R <test_input> <test_output> <test_rds> "" \
  '{"normalization":"center.median","metadata":{"MGL251001P01C02_01_PSMs.txt":{"condition_1":"DMSO","condition_2":"24h","batch":"A"}}}'

# Test MSstats with TMT sample data (first verify TMT melting in Python produces correct columns)
# The TMT test requires Python preprocessing first — verify the melted parquet has the 7 required columns
```

### 9.3 Required R Script Changes (post-investigation)

Expected changes (based on code audit) — confirm with investigation:

1. **`msqrob2_data_process.R`:** May need minor `build_batch_vector()` adjustment for multi-group condition tokens. The current token matching uses `(^|_)value($|_)` regex — verify this works with multi-group values.
2. **`msqrob2_group_comparison_multi.R`:** May need condition level extraction adjustment if `colData$condition` format changes.
3. **`msstats_data_process.R`:** No changes expected — column contract is unchanged.
4. **`msstats_group_comparison_multi.R`:** No changes expected — comparisons format is unchanged.

### 9.4 Metadata Format for R Config

Both msqrob2 R scripts receive `config$metadata` as a dict. User-defined groups are translated to `condition_N` keys by Python (per FR3.5):
```json
{
  "filename1.txt": {
    "condition_1": "DMSO",
    "condition_2": "24h",
    "experiment": "MyExp",
    "batch": "A"
  },
  "filename2.txt": {
    "condition_1": "Treatment",
    "condition_2": "24h",
    "experiment": "MyExp",
    "batch": "A"
  }
}
```

The Python `_build_data_process_config()` must serialize per-file metadata from `SessionConfig.metadata_columns` into this format. User sees group names (`drug`, `time`) in the UI; the R config receives `condition_1`, `condition_2`. The R scripts match `Sample_Origination` values (e.g., `"DMSO_24h_1"`) against condition tokens using `match_token()` regex `(^|_)value($|_)`.

---

## 10. Migration Notes

### 10.1 Breaking Changes

- Old `PSM_Experiment_Condition_Replicate.csv` format is **no longer supported**
- Filename-based metadata extraction is **removed**
- Pipeline is **no longer user-selectable** — derived from analysis type
- `ProteomicsFileInfo.conditions: list[str]` field is **removed** (condition groups stored in `metadata_columns`)
- `Session.pipeline` default changes from `"msqrob2"` to `""`
- **Session directory cleanup required:** Remove all existing sessions from `backend/sessions/` before deployment. Old session JSON files with the `conditions` field will fail to deserialize.
- **msqrob2 pipeline restructured:** 5 steps → 8 steps. Added shared Steps 3-5 (remove_razor, remove_low_quality, filter_criteria) to match MSstats structure. R steps shift to 6-7, QC to 8. Both pipelines are now structurally symmetric.

### 10.2 Preserved

- PTM pipeline and all its routes/models/components
- GSEA, BioNet, Compare on-demand features
- WebSocket progress updates
- Session state lifecycle (CREATED → CONFIGURING → QUEUED → PROCESSING → …)
- Pipeline engine (PipelineEngine, PipelineState, StepContext)
- All R scripts (adapted, not rewritten)
- Visualization page and all results display

### 10.3 New Artifacts

- `frontend/src/app/new/type/page.tsx` — Analysis type selection
- `frontend/src/app/new/metadata/page.tsx` — Metadata input
- `frontend/src/components/analysis/TmtChannelMapping.tsx` — Channel mapping table
- `frontend/src/components/analysis/DiaMetadataTable.tsx` — Per-file metadata table

### 10.4 Deleted Artifacts

- `frontend/src/app/new/pipeline/page.tsx` — Old pipeline selection page
- `parse_psm_filename()` — Backend filename parsing function
- `parsePsmFilename()` / `parseFilename()` — Frontend filename parsing functions
- `find_abundance_column()` — Old single abundance column pattern
- `PSM_FILENAME_PATTERN` regex

---

## 11. Acceptance Criteria

### AC1: TMT End-to-End
1. User creates new analysis, selects "Protein Analysis" → "TMT"
2. User uploads `20260424_DOCK5_PANC0203_PSMs.txt`
3. App detects 16 TMT channels
4. User assigns channels to conditions via dropdowns
5. User defines comparisons (e.g., DMSO vs Treatment)
6. User configures MSstats parameters
7. User reviews summary and starts analysis
8. MSstats 8-step pipeline runs to completion
9. Results are viewable on the visualization page

### AC2: DIA End-to-End
1. User creates new analysis, selects "Protein Analysis" → "DIA"
2. User uploads `MGL251001P01C02_01_PSMs.txt` and `MGL251001P01C02_02_PSMs.txt`
3. App validates DIA format for both files
4. User fills in experiment/condition/replicate/batch per file
5. User defines comparisons
6. User configures msqrob2 parameters including batch correction
7. User reviews summary and starts analysis
8. msqrob2 8-step pipeline runs to completion (symmetric with MSstats)
9. Results are viewable on the visualization page

### AC3: PTM Flow Preserved
1. User creates new analysis, selects "PTM Analysis"
2. Existing PTM upload flow works unchanged (enrichment + global proteome + FASTA)
3. PTM pipeline runs to completion

### AC4: Error Handling
1. Uploading a DIA file when TMT is selected → clear error, file rejected
2. Uploading a TMT file when DIA is selected → clear error, file rejected
3. Invalid file (neither TMT nor DIA) → clear error with column expectations
4. Incomplete channel mapping → validation prevents continuing
5. Missing metadata fields → validation prevents continuing
6. Fewer than 2 DIA files → validation prevents continuing

### AC5: Test Suite
1. All backend unit tests pass (`pytest Tests/backend/unit/ -v`)
2. All backend integration tests pass (`pytest Tests/backend/integration/ -v`)
3. All E2E tests pass (`npx playwright test`)
4. Frontend type check passes (`npx tsc --noEmit`)

### AC6: Session Persistence
1. Refreshing the page at any wizard step restores the correct state
2. Previously uploaded files and metadata are preserved
3. Session can be resumed after closing and reopening the browser

### AC7: Column Contract
1. TMT pipeline Step 1+2 output has all columns listed in Section 8.1 (contract test passes)
2. DIA pipeline Step 1+2 output has all columns listed in Section 8.1 (contract test passes)
3. Both output DataFrames have identical column sets (shared contract, symmetric pipelines)

---

## 12. File Manifest

### Backend (18 files)

**Step library reorganization:**
| File | Change |
|---|---|
| `backend/app/services/steps/inputs/step_input_tmt.py` | **NEW** — melt TMT channels, map groups, save parquet |
| `backend/app/services/steps/inputs/step_input_dia.py` | **NEW** — rename Quan_Value→Abundance, per-file metadata, save parquet |
| `backend/app/services/steps/shared/step_unique_psm.py` | **UNIFIED** (was 2 files: `unique_psm_msqrob2.py` + `unique_psm_msstats.py`) |
| `backend/app/services/steps/shared/step_remove_razor.py` | Existing (`remove_razor.py`), unchanged |
| `backend/app/services/steps/shared/step_remove_low_quality.py` | Existing (`remove_low_quality.py`), unchanged |
| `backend/app/services/steps/shared/step_filter_criteria.py` | Existing (`filter_criteria.py`), unchanged |
| `backend/app/services/steps/shared/step_qc_metrics.py` | **UNIFIED** (was 2 files: `qc_metrics.py` + `qc_metrics_msqrob2.py`) |
| `backend/app/services/steps/engines/step_msqrob2_abundance.py` | Existing (`protein_abundance.py`), renamed |
| `backend/app/services/steps/engines/step_msqrob2_de.py` | Existing (`multi_condition_de.py`), renamed |
| `backend/app/services/steps/engines/step_msstats_abundance.py` | Existing (`protein_abundance.py` for MSstats — separate from msqrob2), renamed |
| `backend/app/services/steps/engines/step_msstats_de.py` | Existing (`group_comparison_multi.py`), renamed |

**Pipeline registry:**
| File | Change |
|---|---|
| `backend/app/services/pipeline_registry.py` | **Rewritten** — plain list composition; maps pipeline keys to ordered lists of step functions; step numbering is positional |

**Core files:**
| File | Change |
|---|---|
| `backend/app/utils/file_parser.py` | Major rewrite: `detect_tmt_channels()`, `validate_tmt_columns()`, `validate_dia_columns()`, `detect_delimiter()`; remove `parse_psm_filename()`, `find_abundance_column()`, `PSM_FILENAME_PATTERN` |
| `backend/app/models/session.py` | ProteomicsFileInfo (remove `conditions` field), SessionConfig (+`file_type`, +`tmt_channel_mapping`) |
| `backend/app/models/analysis.py` | AnalysisConfig (+`file_type`, +`tmt_channel_mapping`) |
| `backend/app/api/routes/upload.py` | Accept .txt, new validation, detection response |
| `backend/app/api/routes/processing.py` | `_derive_pipeline()` uses `file_type`; add fields to `config_forward_fields` |
| `backend/app/core/config.py` | `MIN_PROTEOMICS_FILES=1`, add `MIN_DIA_FILES=2` |
| `backend/app/services/session_manager.py` | Default `pipeline=""` |

**R scripts:**
| File | Change |
|---|---|
| `backend/scripts/msqrob2_data_process.R` | Verify metadata compatibility; remove `remove_razor` + `smallestUniqueGroups()` block (moved to Python); keep contaminant/reverse filtering as safety net |
| `backend/scripts/msstats_data_process.R` | No changes expected |

**Deleted files (5):**
| File | Reason |
|---|---|
| `backend/app/services/steps/qc_metrics_msqrob2.py` | Unified into `shared/step_qc_metrics.py` |
| `backend/app/services/steps/unique_psm_msqrob2.py` | Unified into `shared/step_unique_psm.py` |
| `backend/app/services/steps/unique_psm_msstats.py` | Unified into `shared/step_unique_psm.py` |
| `backend/app/services/steps/combine_replicates_msqrob2.py` | Replaced by `inputs/step_input_dia.py` |
| `backend/app/services/steps/combine_replicates_msstats.py` | Replaced by `inputs/step_input_tmt.py` |

**Modified (not deleted):**
| File | Change |
|---|---|
| `backend/app/services/data_processor.py` | Remove `parse_psm_filename()`, `find_abundance_column()`. Keep `step2_generate_unique_psm()`, `step3_remove_razor()`, `step4_remove_low_quality()`, `step5_filter_by_criteria()` — these are called by shared step handlers. Add `step1_combine_replicates_tmt()` and `step1_combine_replicates_dia()`. |
| `backend/app/services/steps/_helpers.py` | Move `get_psm_input()` and `create_log_callback()` to `backend/app/services/steps/shared/_utils.py`. Update imports in engine step handlers. |

### Frontend (16 files)
| File | Change |
|---|---|
| `frontend/src/app/new/type/page.tsx` | **NEW** |
| `frontend/src/app/new/metadata/page.tsx` | **NEW** |
| `frontend/src/components/analysis/TmtChannelMapping.tsx` | **NEW** |
| `frontend/src/components/analysis/DiaMetadataTable.tsx` | **NEW** |
| `frontend/src/app/new/pipeline/page.tsx` | **DELETE** |
| `frontend/src/app/new/upload/page.tsx` | Major rewrite |
| `frontend/src/app/new/comparisons/page.tsx` | Minor |
| `frontend/src/app/new/config/page.tsx` | Conditional form |
| `frontend/src/app/new/summary/page.tsx` | Minor |
| `frontend/src/app/new/layout.tsx` | Step routing |
| `frontend/src/components/analysis/WizardProgress.tsx` | Step labels |
| `frontend/src/components/analysis/FileUploadZone.tsx` | Remove filename parsing |
| `frontend/src/components/analysis/ExperimentTable.tsx` | Adapt |
| `frontend/src/components/analysis/ValidationPanel.tsx` | Update |
| `frontend/src/stores/analysis-store.ts` | State reshape |
| `frontend/src/types/index.ts` | Type reshape |
| `frontend/src/lib/api-client.ts` | API shape |

### Tests (9+ files)
| File | Change |
|---|---|
| `Tests/fixtures/tmt_sample_1000rows.txt` | **NEW** — first 1000 rows from real TMT PD file |
| `Tests/fixtures/dia_sample_1000rows.txt` | **NEW** — first 1000 rows from real DIA PD file |
| `Tests/conftest.py` | TMT/DIA fixtures using extracted test data; update `pipeline_test_files` to remove filename dependency |
| `Tests/backend/unit/test_file_parser.py` | Rewrite for detection functions; remove filename parsing tests |
| `Tests/backend/unit/test_data_processor.py` | Add TMT melt + DIA rename tests; update step1 tests |
| `Tests/backend/unit/test_pipeline_chains.py` | TMT and DIA full-chain tests; **column contract test** (FR5.10); verify 8-step pipeline for both |
| `Tests/backend/unit/test_pipeline_registry.py` | **NEW** — verify composition, step ordering, positional numbering |
| `Tests/backend/unit/test_processing_routes.py` | `_derive_pipeline()` tests with file_type |
| `Tests/e2e/*.spec.ts` | Updated wizard flows (TMT 6-step, DIA 6-step, PTM 5-step) |

---

## 13. Implementation Order

### Phase A: Foundation (no user-facing changes)
0. **Create test fixtures** — extract first 1000 rows from `20260424_DOCK5_PANC0203_PSMs.txt` (TMT) and `MGL251001P01C02_01_PSMs.txt` (DIA) into `Tests/fixtures/`. Use these for all downstream tests.
1. **R script investigation** — verify Section 9.2 with test fixtures before any code changes
2. **Data model changes** — `ProteomicsFileInfo`, `SessionConfig`, `AnalysisConfig`, `Session` (Section 4)
3. **File parser rewrite** — `detect_tmt_channels()`, `validate_tmt_columns()`, `validate_dia_columns()`, `detect_delimiter()` (Section 12, Backend)
4. **Config changes** — `MIN_PROTEOMICS_FILES=1`, `MIN_DIA_FILES=2`, `_derive_pipeline()` update, `config_forward_fields` additions
5. **Tests for Phase A** — `test_file_parser.py`, `test_processing_routes.py`

### Phase B: Step Library & Pipeline Composition
6. **Create directory structure** — `steps/inputs/`, `steps/shared/`, `steps/engines/`
7. **Unified step handlers** — merge QC + unique_psm into shared; create input handlers (Section 8)
8. **Rewrite pipeline registry** — plain list composition, positional step numbering
9. **Remove R script remove_razor** — delete `smallestUniqueGroups()` block from `msqrob2_data_process.R`
10. **Data processor updates** — add `step1_combine_replicates_tmt()` and `step1_combine_replicates_dia()`; remove `parse_psm_filename()`, `find_abundance_column()`
11. **Tests for Phase B** — `test_pipeline_registry.py`, `test_pipeline_chains.py`, `test_data_processor.py`

### Phase C: Frontend — Type Selection & Upload
12. **Home page** — three quick-start buttons (FR1.1)
13. **Type selection page** — `/new/type` with Protein/PTM toggle and TMT/DIA selection (FR1.2-1.6)
14. **Upload page rewrite** — accept .txt/.csv, auto-detect delimiter, column validation per type, detection response (FR2.1-2.17)
15. **Upload route** — new validation, detection response, .txt support
16. **Delete old pipeline selection page** — `/new/pipeline`
17. **Tests for Phase C** — E2E wizard tests for type selection + upload

### Phase D: Frontend — Metadata & Comparisons
18. **Metadata page** — `/new/metadata` with TMT channel mapping table and DIA per-file table (FR3.1-3.8)
19. **TMT channel mapping component** — `TmtChannelMapping.tsx` with collapsible multi-file sections
20. **DIA metadata table component** — `DiaMetadataTable.tsx`
21. **Comparisons page** — auto-generate section (FR4.3, FR4.5), derive conditions from new metadata sources (FR4.1)
22. **Metadata auto-save** — 800ms debounced save + restore on mount (FR3.4)
23. **Tests for Phase D** — metadata input E2E, comparison auto-generate tests

### Phase E: Frontend — Config, Summary, Wizard
24. **Config page** — conditional form rendering based on `file_type` (FR5.1-5.8)
25. **Summary page** — display derived pipeline name (FR7.1)
26. **Wizard progress** — 6-step (protein) / 5-step (PTM) indicator (Section 6.1)
27. **Layout & routing** — step guards, PTM redirect for Metadata step (FR1.9)
28. **Store reshape** — `analysisType`, `tmtChannelMapping`, remove `selectedTemplate`/`selectedPipeline`
29. **API client** — remove `parsePsmFilename`, update types
30. **Tests for Phase E** — full wizard E2E (TMT + DIA + PTM)

### Phase F: Cleanup & Final Verification
31. **Delete old artifacts** — 5 files (Section 12, Deleted files)
32. **Clean sessions directory** — `rm -rf backend/sessions/*`
33. **R script changes** — apply any findings from Phase A investigation
34. **Full test suite** — all unit + integration + E2E pass
35. **Manual verification** — TMT E2E with real PD file, DIA E2E with real PD files
