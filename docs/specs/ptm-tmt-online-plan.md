# PTM TMT Online Pipeline Plan

**Status:** Approved design; ready for implementation
**Date:** 2026-07-17
**Branch reviewed:** `ptm-tmt-pipeline-build` at current `main` (`9496471`)
**Reference implementation:** the current production TMT pipeline

## 1. Goal

Bring PTM analysis online for real Proteome Discoverer (PD) TMT PSM exports.
The workflow must accept one enriched PTM PSM TXT file and, optionally, one
matched protein-abundance PSM TXT file. It must produce site-centric PTM
results while preserving ambiguous localization evidence instead of deleting
or duplicating it.

The implementation is successful when a user can:

1. Create a PTM session and select the input files from the File Library.
2. Select one detected target modification for the session.
3. Map TMT channels with the existing TMT metadata and comparison workflow.
4. Run the PTM analysis with the agreed fixed quality rules.
5. Review PTM, protein, and protein-adjusted results when a protein file exists.
6. Inspect localization, abundance, peptidoform, mapping, and imputation evidence
   for a selected PTM site or site group.
7. Download processed result tables as separate TSV files in one ZIP.

## 2. Assumptions and scope

### 2.1 In scope

- PD-generated, tab-delimited TMT PSM TXT data only.
- Exactly one enriched PTM PSM file per session.
- Zero or one matched protein PSM file per session.
- Exactly one selected target modification per session and processing run.
- Any detected modification name can be selected, including TMT labeling.
- Human or mouse bundled FASTA, or one custom FASTA selected from the File
  Library.
- ptmRS and CHIMERYS localization data.
- The existing TMT channel metadata and comparison builder.
- Site-level MSstatsPTM analysis, optional protein analysis, and optional
  protein-adjusted PTM analysis.
- PTM-specific visualization and processed-result export.

### 2.2 Out of scope for version 1

- Direct file upload from the PTM wizard.
- LFQ or DIA PTM analysis.
- Multiple enriched PTM exports or multiple TMT plexes in one PTM session.
- Multiple target modifications in one session.
- Reusing one session to run another target modification.
- Automatic sample metadata inference from filename or `File ID`.
- Localization-based row removal.
- Duplicating one abundance measurement across alternative protein or site
  assignments.

### 2.3 Fixed scientific defaults

| Setting | PTM PSM file | Optional protein PSM file |
|---|---:|---:|
| Average Reporter S/N | `>= 5` | `>= 5` |
| Isolation Interference in Percent | `<= 50` | not used |
| Normalized CHIMERYS Coefficient | not used | `>= 0.8` |
| Contaminant | exclude | exclude |
| Empty master protein accession | exclude | exclude |
| Explicit reverse hit, when column exists | exclude | exclude |
| Reporter abundance | retain values `>= 1` | retain values `>= 1` |
| `Quan Info = ExcludedByMethod` | not a gate | not a gate |
| Confidence/rank/ambiguity fields | not gates or QC metrics | not gates or QC metrics |

The thresholds are fixed and displayed in the run summary. They are not
advanced user settings. Boundary values 5, 50, and 0.8 pass.

## 3. Current-state audit

### 3.1 Current PTM blockers

The existing PTM path is a placeholder and cannot process the supplied real
files end to end:

- `frontend/src/app/new/upload/page.tsx` accepts PTM CSV uploads, defaults to LF,
  and does not populate the detected-modification state.
- PTM sessions currently skip TMT metadata even though reporter channels are
  the only experimental sample identifiers.
- `SessionConfig` does not contain PTM configuration fields and forbids unknown
  fields.
- Processing start validation is centered on `session.files.proteomics`, not the
  PTM-specific file collections.
- `ptm_step1_prepare.py` requires CSV, recognizes an older modification syntax,
  scans only the first file, and requires an uploaded FASTA path.
- `ptm_summarization.R` relies on `PDtoMSstatsPTMFormat`, whose expected PD
  headers and annotation contract do not match the real exports. It also uses
  unmodified PTM-file peptides as a proxy protein layer when no protein file is
  supplied; that behavior is no longer wanted.
- The current R path disables the localization cutoff but removes unlocalized
  peptides, conflicting with the requirement to retain ambiguous and unscored
  evidence.
- `PTMVolcano.tsx` uses fixed thresholds, displays model layers side by side,
  and does not reuse the current volcano filter modes or information-panel
  layout.
- The File Library indexes only TXT/CSV and its selection endpoint only fills
  the generic proteomics file collection. It cannot yet select PTM roles or a
  custom FASTA.

### 3.2 TMT behavior to reuse

The updated TMT pipeline is the source of truth for:

- PD TXT parsing and reporter-channel detection.
- Inclusive protein PSM filters: Average Reporter S/N `>= 5` and Normalized
  CHIMERYS Coefficient `>= 0.8`.
- Contaminant, reverse, accession, no-value, and reporter-abundance handling.
- TMT channel metadata, sample/reference roles, and explicit reference
  normalization.
- Shared-peptide resolution.
- Coverage validation.
- Comparison construction.
- MSstats protein processing.

PTM processing should reuse these functions or extract their narrowly scoped
shared logic. It should not copy a second version of the protein TMT rules.

## 4. Reference-data profile and acceptance design

### 4.1 Enriched PTM file

`SampleData/real_PD_files/20241024_BottomUp_VRK_ABPP_Trail2_EnrichedPeptide_PSMs.txt`

- 30,344 PSM rows and 43 columns.
- Reporter channels: 126, 127, 128, 129, 130, 131.
- Sequence field: `Annotated Sequence`.
- PTM localization field: `ptmRS Best Site Probabilities`.
- Quality field: `Isolation Interference in Percent`.
- No Normalized CHIMERYS Coefficient field.
- Detected modification rows/occurrences:

| Modification | Rows containing modification | Occurrences |
|---|---:|---:|
| TMT6plex | 30,344 | 48,845 |
| DBIA | 25,664 | 30,698 |
| Carbamidomethyl | 3,954 | 4,546 |
| Oxidation | 2,169 | 2,257 |

The DBIA data contains one-, two-, and three-site PSMs and repeated PSMs across
`File ID`, which exercises repeated-PSM summation and combined-site features.

### 4.2 Optional protein file

`SampleData/real_PD_files/20241024_BottomUp_VRK_ABPP_Trail2_Protein_PSMs.txt`

- 85,208 PSM rows and 51 columns.
- The same six reporter channels.
- Sequence field: `Annotated Sequence`.
- CHIMERYS localization fields are present.
- `Normalized CHIMERYS Coefficient` and `Contaminant` are present.
- 1,417 rows are marked as contaminants.
- The isolation-interference column is empty and must not be used for protein
  filtering.

### 4.3 Metadata for the full acceptance run

| Channel | Condition | Biological replicate | Role |
|---|---|---:|---|
| 126 | Drug | 1 | Sample |
| 127 | Drug | 2 | Sample |
| 128 | Drug | 3 | Sample |
| 129 | DMSO | 1 | Sample |
| 130 | DMSO | 2 | Sample |
| 131 | DMSO | 3 | Sample |

`File ID` is retained as provenance but is never treated as sample metadata.

## 5. User workflow

### 5.1 Session and file selection

1. The user creates a PTM session. The session fixes `file_type = tmt` and the
   PTM pipeline.
2. The Upload and Setup page contains only File Library selectors:
   - required enriched PTM PSM TXT;
   - optional protein PSM TXT;
   - optional custom FASTA when Custom is selected.
3. Direct drag/drop and file input controls are absent from the PTM workflow.
4. Human and Mouse select the existing bundled FASTA files without copying a
   user file.
5. Each role accepts exactly one file. Selecting a replacement replaces the
   prior pre-processing selection while the session is configurable.
6. The selected enriched file is parsed immediately to detect reporter channels
   and every modification name. The user selects exactly one target
   modification. TMT labels remain visible and selectable.
7. The selected target and input roles become immutable when processing starts.
   A different target requires a new session.

### 5.2 Metadata and comparisons

1. PTM sessions use the existing TMT Metadata page instead of skipping it.
2. Each reporter channel defaults to role `Sample`.
3. A channel can be explicitly marked `Reference/bridge`; the pipeline never
   guesses a reference channel.
4. The user assigns condition and biological replicate metadata using the same
   TMT controls and optional metadata-CSV import already used by protein TMT.
5. If an optional protein file exists, its detected reporter channels must match
   the enriched file exactly. Both files use the same channel metadata object.
6. A channel or metadata mismatch blocks processing. The pipeline never uses an
   overlapping subset silently.
7. The existing TMT comparison builder is reused. Only user-selected
   comparisons run.

### 5.3 PTM configuration

The PTM configuration page exposes only these processing choices:

| Option | Default | Behavior |
|---|---:|---|
| Resolve Shared Peptides | On | Reuse the TMT resolver and FASTA |
| Normalization method | Background peptides | Choose background peptides, centered median, or none |
| Maximum missing fraction per condition | 0.40 | Requires at least 2 of 3 values in the reference design |
| MSstatsPTM imputation | On | Runs only after coverage filtering |

The fixed quality thresholds are displayed but not editable.

## 6. File Library and session contract

### 6.1 Library-only selection

Extend the existing File Library selection request with an explicit role:

```json
{
  "session_id": "...",
  "role": "ptm_enrichment",
  "paths": ["Project/enriched_PSMs.txt"]
}
```

Supported roles are `ptm_enrichment`, `global_proteome`, and `custom_fasta` in
addition to the current generic protein-analysis selection. PTM role selection
must use the existing safe path resolution, collision-safe session copy, and
request-atomic behavior.

- `ptm_enrichment` and `global_proteome` accept one `.txt` file.
- `custom_fasta` accepts one `.fasta`, `.fa`, or `.faa` file.
- Extend the library index, Files-page library ingestion, API types, and picker
  filters for FASTA extensions.
- Remove the PTM wizard's direct-upload client calls and controls. The older PTM
  upload routes should be removed with their now-unused client methods and
  tests, while TMT/DIA direct-upload behavior remains unchanged.

### 6.2 Session configuration

Add a typed PTM configuration model rather than allowing arbitrary fields:

```text
ptm.target_modification: string
ptm.fasta_source: human | mouse | custom
ptm.resolve_shared_peptides: true
ptm.normalization_method: background_peptide | centered_median | none
ptm.imputation: true
ptm.max_missing_fraction_per_condition: 0.40
```

Continue using the existing `tmt_channel_mapping` and `comparisons` fields so
PTM and protein TMT share one metadata contract. The target modification is a
modification name, not a modification/residue pair; all residues and termini
reported by PD for that name are included. Residue remains a results filter.

The session start guard must verify:

- exactly one enriched PTM file;
- zero or one protein file;
- one FASTA source;
- one selected target modification detected in the enriched file;
- complete TMT metadata for every channel;
- exact enriched/protein channel equality when protein is present;
- at least one valid comparison;
- no post-start input or target mutation.

## 7. PD input adapters

### 7.1 Header normalization

PD version differences are normalized once in Python. Accept extra columns and
map recognized aliases into a canonical contract. In particular,
`Annotated Sequence` must satisfy the sequence requirement currently called
`Sequence` in the TMT parser.

The enriched PTM adapter requires:

- `Annotated Sequence` or accepted sequence alias;
- `Modifications`;
- `Charge`;
- `Master Protein Accessions`;
- `Contaminant`;
- `Quan Info`;
- `Average Reporter SN`;
- `Isolation Interference in Percent`;
- at least two numeric columns matching `Abundance <channel>`.

Localization columns are optional because unscored PSMs are retained. `File ID`
is optional provenance.

The optional protein adapter uses the current TMT protein contract after adding
the same sequence alias. It requires Average Reporter S/N and Normalized
CHIMERYS Coefficient, not isolation interference.

### 7.2 Modification detection

Parse the real PD form, for example:

```text
N-Term(TMT6plex); C10(DBIA); C13(DBIA); K15(TMT6plex)
```

Return each exact modification name with:

- PSM-row count;
- occurrence count;
- observed residues/termini;
- whether a compatible localization field is present.

Detection is informational and never hides TMT, fixed, or incidental
modifications. Only the selected modification defines target-positive PSMs.
All other modifications remain part of the peptidoform identity.

## 8. Processing pipeline

Implement the PTM pipeline as six explicit stages in `pipeline_registry.py`:

1. Prepare and filter PTM TMT data.
2. Resolve shared peptides.
3. Build PTM site features and normalize channels.
4. Summarize PTM/protein abundance with MSstatsPTM/MSstats.
5. Fit selected comparisons and build the three result layers.
6. Build PTM QC and processed-result exports.

### 8.1 Stage 1: prepare and filter

Read with the same streaming/DuckDB strategy as the updated TMT input handler.
Do not load the full PD export into browser state.

For the enriched PTM file:

1. Apply contaminant, optional reverse, and non-empty-accession rules.
2. Require Average Reporter S/N `>= 5`.
3. Require Isolation Interference in Percent `<= 50`.
4. Do not require Normalized CHIMERYS Coefficient.
5. Do not independently reject `ExcludedByMethod`; the explicit quality rules
   are authoritative.
6. Exclude explicit no-value rows and, after melting, missing or `< 1` reporter
   abundances using current TMT semantics.
7. Do not filter or report QC for Confidence, Rank, Search Engine Rank, or PSM
   Ambiguity.

For the protein file, invoke the shared TMT protein filter implementation. Do
not reproduce those predicates in PTM-specific code.

Both datasets are melted with channel identity intact and joined to the same
saved TMT metadata. `File ID` remains a provenance column only.

### 8.2 Stage 2: resolve shared peptides

`Resolve Shared Peptides` defaults on and reuses the current TMT resolver with
the selected bundled/custom FASTA.

When enabled, assign a shared peptide to the resolver's single selected protein
without duplicating reporter intensity.

When disabled:

- retain the unresolved protein group as one feature;
- never copy its abundance to each candidate protein;
- allow unadjusted PTM analysis;
- mark protein adjustment unavailable because there is no single protein match.

### 8.3 Stage 3A: localization and FASTA mapping

Supported localization sources:

1. `ptmRS Best Site Probabilities` for ptmRS exports.
2. `CHIMERYS Best Site Probabilities` for CHIMERYS per-site evidence.
3. `CHIMERYS PTM Localization Score` only when per-site CHIMERYS values are
   unavailable; mark this as lower-resolution evidence.

The display-only localization threshold is 75%. It never removes a PSM.

- Confident evidence: usable target-site probability `>= 75`.
- Ambiguous evidence: lower score or unresolved alternative positions.
- Unscored evidence: no usable probability.
- FASTA-unmapped: peptide-local position retained but protein coordinate absent.

At the aggregated feature level, any supporting PSM at or above 75% makes the
localization badge Confident. Lower-scoring supporting PSMs remain visible in
the tooltip and information panel with their exact scores and counts.

Site mapping rules:

- Unique protein position: `P12345 · C120`.
- Alternative candidate positions: `P12345 · candidate positions C120|C347`.
- Multiple confidently co-modified sites: `P12345 · C120+C347`.
- No FASTA match: `P12345 · peptide C4 · FASTA-unmapped`.
- Multiple FASTA positions remain one candidate-position feature; abundance is
  never duplicated.
- A combined confident feature is a separate volcano entry from either
  individual site.
- `+` means jointly modified sites; `|` means alternative candidate sites.

### 8.4 Stage 3B: PSM and peptidoform aggregation

Define a peptidoform by unflanked peptide sequence, the complete modification
pattern (including incidental modifications), charge, resolved protein/protein
group, and site/site-group identity.

Sum repeated reporter measurements using this key plus channel. This implements
the agreed repeated-PSM behavior without summing biologically distinct
peptidoforms.

Distinct peptidoforms or charges that map to the same site remain separate
feature rows for MSstatsPTM robust site summarization. They are not summed
together before modeling, preventing one highly abundant peptidoform from
dominating the site estimate.

### 8.5 Stage 3C: PTM normalization

Normalization is independent of the optional protein file. Background peptides
remain the compatibility default, while each run explicitly stores one of
three methods:

- `background_peptide`: use complete target-negative peptide/charge features;
- `centered_median`: equalize reporter-channel medians from target PTM feature
  abundances;
- `none`: retain raw target-PTM reporter abundance.

The centered-median method is appropriate when the background pool has a
condition-dependent shift that would bias most target-site fold changes. It
computes each Sample channel's median log2 target-feature abundance, centers
those medians, applies the channel factors, and records the factors in QC.

For background-peptide normalization:

1. Build the background pool from all quality-filtered enriched-file PSMs that
   lack the selected target modification. Incidental oxidation,
   carbamidomethyl, TMT, and other non-target modifications are allowed.
2. Sum repeated background PSMs per peptide sequence, charge, and channel.
   Incidental non-target modifications do not split the background feature.
3. Retain background features quantified across all included Sample channels.
   Explicit Reference/bridge channels are handled by reference normalization,
   not by guessing their role.
4. Compute the median log2 abundance for each channel.
5. Center channel medians and apply the resulting offsets to target-PTM
   abundance.
6. Record pool size, channel scaling factors, and before/after distributions.

Show the eligible background-pool size before processing. If fewer than 50
complete background peptide/charge features exist, skip background
normalization, run the raw PTM data, and show a prominent warning. Do not fail
the analysis.

Selecting `none` uses raw target-PTM reporter abundance.
The later result-page Raw/Normalized switch changes only the displayed site
abundance chart; it never refits statistics. Changing preprocessing requires a
new session/run.

### 8.6 Stage 3D: coverage and missingness

Apply coverage after aggregation/normalization and before imputation. A feature
must be observed in at least:

```text
ceil((1 - max_missing_fraction) * biological_replicates)
```

in every condition participating in a comparison. With the default 0.40 and
three replicates, this requires 2 of 3 values in Drug and 2 of 3 in DMSO.

Features failing coverage are excluded from that comparison and are never
imputed. Features passing coverage are sent to MSstatsPTM with imputation on by
default. Capture an imputation mask so site-abundance plots and QC can identify
imputed values.

### 8.7 Stage 4: summarization

Keep PD parsing, filtering, localization, and site-key construction in Python.
Replace the current dependence on `PDtoMSstatsPTMFormat` with an explicit,
version-tested boundary table for MSstatsPTM 2.14.0.

- Reuse MSstatsPTM robust summarization for distinct peptidoforms contributing
  to the same site/site group.
- When a protein file exists, prepare its protein layer with the current TMT
  MSstats behavior and pass the summarized protein data to MSstatsPTM.
- When no protein file exists, do not synthesize a proxy protein layer from
  background peptides. Protein and adjusted results remain unavailable.
- Reference normalization runs only when metadata explicitly marks a reference
  channel.

The R contract needs a focused integration test that validates input/output
columns against the installed package version. R should not reinterpret PD
headers or localization strings.

### 8.8 Stage 5: comparisons and result layers

Run only the comparisons selected in the shared TMT comparison builder.

The result layers are:

1. **PTM:** unadjusted PTM site/site-group changes using the configured PTM
   normalization.
2. **Protein:** protein abundance changes from the optional protein PSM file.
3. **Protein-adjusted PTM:** PTM change adjusted by the matched protein change,
   including the model's uncertainty and p-value.

Protein matching for adjustment is:

1. exact accession/isoform;
2. canonical accession after stripping a UniProt isoform suffix, marked as a
   fallback;
3. never gene-symbol-only.

If no valid, quantified protein match exists, retain the PTM result in the PTM
layer and mark adjustment unavailable. Do not create an adjusted result for
that feature, and therefore do not show it in the protein-adjusted volcano or
protein-adjusted result table. If shared-peptide resolution is off and the PTM
feature has a protein group rather than one accession, adjustment is likewise
unavailable.

Apply BH correction separately for each comparison and each result layer. The
default adjusted-p threshold is 0.05.

If a coverage-passing feature cannot be estimated, retain it with `NA`
statistics and status `Unestimable`. It cannot be classified as significant.

### 8.9 Stage 6: QC and processed results

PTM QC contains only actionable pipeline information:

- the same summary-and-plot layout used by protein QC, calculated from the
  normalized PTM site-by-channel and PTM PSM-by-channel matrices;
- PTM-site PCA and per-comparison p-value distributions;
- condition-level PTM-site and PTM-PSM CV distributions;
- PTM-site and PTM-PSM intensity distributions;
- PTM-site and PTM-PSM completeness by TMT channel;
- active-filter attrition for S/N, interference or CHIMERYS coefficient,
  contaminant, accession, reverse, and reporter abundance;
- channel reporter distributions;
- background-pool size, scaling factors, and before/after distributions;
- site coverage and missingness;
- imputed-value counts;
- localization status/evidence counts;
- unique, candidate, and FASTA-unmapped site counts;
- exact, canonical-fallback, and unavailable protein-adjustment matches.

Do not add Confidence, Rank, Search Engine Rank, or PSM Ambiguity gates or QC
panels.

## 9. Results and visualization

### 9.1 Page layout

Use the current protein volcano page as the layout template:

- comparison selector and model tabs at the top;
- volcano, filter controls, and result table in the main column;
- persistent selected-item information panel in the right column;
- responsive stacking at narrow widths.

The model tabs are PTM, Protein, and Protein-adjusted PTM. With no optional
protein file, Protein and Protein-adjusted PTM remain visible but disabled.

The PTM and adjusted tabs are site-centric:

- one volcano point and table row per site, candidate-site group, or combined
  site feature;
- the right panel is `PTM Site Information`.

The Protein tab is protein-centric:

- one point and row per protein;
- the table and right panel switch to the existing Protein Information context.

### 9.2 Volcano behavior

Preserve the current volcano point colors and current significance behavior.
Localization does not change point color or shape; it appears in the hover
tooltip and selected-item information panel.

Preserve both existing significance modes exactly:

- `s0 = 0`: fold-change threshold plus raw-p threshold plus BH-FDR threshold.
- `s0 > 0`: the existing hyperbolic raw-p/fold-change curve; adjusted p remains
  visible but is not a point-color criterion.

Make the active mode explicit. Filters are saved per comparison. Within one
comparison, PTM, Protein, and adjusted tabs share the same filter settings.
Filters are not shared between different comparisons.

Markers remain per comparison, preserving current behavior.

### 9.2.1 PTM session navigation and protein-only analyses

Completed PTM sessions open directly on the PTM Volcano page instead of the
generic protein visualization page. PTM sessions always provide Volcano, QC,
and Results. Protein GSEA and Protein BioNet appear only when the session has
an optional global-proteome PSM file, and both consume the protein comparison
layer rather than PTM-site statistics. The protein layer is adapted to the
existing downstream protein-analysis schema, including FASTA-derived gene
symbols.

PTM Compare is layer-aware. It correlates log2 fold changes across comparisons
using matched feature IDs and provides PTM-site, protein, and protein-adjusted
layers. Pairwise matched-feature counts are reported with each Pearson
correlation. The tab is visible but disabled until at least two comparisons
exist.

### 9.3 PTM Site Information panel

Clicking a PTM/adjusted volcano point or site-table row selects the same feature
and updates the right panel with:

- site/site-group label, protein accession, and gene;
- target modification;
- localization and FASTA-mapping badges using existing theme tokens and
  accessible labels;
- log2 fold change, raw p, and BH FDR for the active layer;
- raw/normalized per-channel and per-condition abundance;
- imputed-value markers;
- exact localization evidence and source, including mixed evidence such as
  `1 confident; 2 ambiguous: 50%, 60%`;
- contributing peptidoforms, charges, and summed PSM counts;
- mapping status and candidate positions;
- PTM, protein, and adjusted estimates when available;
- exact/canonical-fallback/unavailable protein-match status.

When a protein file was supplied but the selected PTM feature's protein was not
quantified, the PTM panel shows `Adjustment unavailable`; the feature remains
in the PTM view but is absent from the adjusted view.

The Raw/Normalized abundance switch is display-only. The plot and statistics
always reflect the processing configuration saved with the run.

### 9.4 Result downloads

Provide one ZIP containing separate processed-result TSVs:

- `ptm_site_results.tsv`;
- `protein_results.tsv` when available;
- `adjusted_ptm_results.tsv` when available;
- `ptm_peptidoforms.tsv`;
- `ptm_localization_evidence.tsv`;
- `ptm_site_abundance.tsv`, including raw/normalized values and imputation flags;
- `ptm_qc.tsv`;
- `run_parameters.tsv`.

Tables contain all comparisons with an explicit comparison column. Do not
include a raw or excluded-PSM audit table. Preserve existing plot-image export
behavior.

## 10. Implementation map

### 10.1 Backend

| Area | Required change |
|---|---|
| `backend/app/services/file_index_service.py` | Index FASTA extensions in addition to TXT/CSV |
| `backend/app/api/routes/files.py` | Add role-aware PTM/custom-FASTA selection and FASTA library support |
| `backend/app/utils/file_parser.py` | Add PTM PD adapter, sequence aliasing, modification detection, and role-specific validation |
| `backend/app/models/session.py` | Add typed PTM config and per-comparison PTM visualization state |
| processing start/session validation | Validate PTM file cardinality, target, FASTA, channels, metadata, and comparisons |
| `backend/app/services/steps/inputs/step_input_ptm_tmt.py` | New streaming PTM/protein adapter using shared TMT rules |
| shared-peptide step | Allow the PTM file role and optional protein file role without intensity duplication |
| PTM site-preparation step | Localization parsing, FASTA mapping, site keys, aggregation, normalization, and coverage |
| `backend/scripts/ptm_summarization.R` | Consume the explicit Python contract; no PD parsing or proxy protein layer |
| `backend/scripts/ptm_group_comparison.R` | Produce per-comparison PTM/protein/adjusted tables and unestimable rows |
| `backend/app/services/steps/ptm_step4_qc.py` | Replace placeholder QC with the agreed PTM metrics |
| `backend/app/services/pipeline_registry.py` | Register the six-stage online PTM TMT pipeline |
| visualization/result routes | Serve layer-aware site/protein results, detail data, abundance, QC, and ZIP export |

Keep target parsing/localization logic in one tested PTM preparation module. Do
not build a generic modification framework beyond the formats required here.

### 10.2 Frontend

| Area | Required change |
|---|---|
| `frontend/src/components/files/FileLibraryPicker.tsx` | Add role/extension filters and single-selection PTM mode |
| `frontend/src/app/new/upload/page.tsx` | Replace PTM upload zones with three File Library selectors, detect channels/modifications, select one target, select FASTA source |
| `frontend/src/app/new/metadata/page.tsx` | Enable the current TMT channel mapping UI for PTM sessions |
| comparison/config/summary pages | Reuse TMT comparisons and persist the four PTM options plus fixed-threshold summary |
| `frontend/src/types/session.ts` and API client | Add the typed PTM and role-selection contracts |
| PTM results route | Replace the placeholder with the approved two-column volcano/info-panel layout |
| `PTMVolcano.tsx` | Reuse current volcano significance/filter behavior and model tabs |
| `PTMResultsTable.tsx` | Make the primary table site-centric and layer-aware |
| `ProteinInfo.tsx` | Reuse unchanged when the Protein tab is active |
| PTM site-info component | Add abundance, localization, peptidoform, mapping, imputation, and adjustment details |
| visualization state | Persist filters per comparison and share them only across model tabs in that comparison |

## 11. Test plan

### 11.1 Unit and contract tests

1. **PD headers:** `Annotated Sequence` is accepted; the enriched file does not
   require CHIMERYS coefficient; the protein file does.
2. **Library roles:** PTM/protein/FASTA role cardinality, allowed extensions,
   safe paths, atomic copy, and replacement behavior.
3. **Modification parsing:** real `N-Term(TMT6plex); C4(DBIA)` syntax, multiple
   sites, all modification names displayed, and incidental modifications
   preserved.
4. **Inclusive quality boundaries:** S/N 5, interference 50, and CHIMERYS 0.8
   pass. Values outside the boundary fail.
5. **No obsolete gates:** Confidence, Rank, Search Engine Rank, PSM Ambiguity,
   and `ExcludedByMethod` do not independently remove a passing PSM.
6. **Aggregation:** repeated PSMs sum; charge and incidental-modification
   differences remain distinct; distinct peptidoforms remain separate model
   features.
7. **Localization:** ptmRS, CHIMERYS per-site, lower-resolution fallback,
   confident/ambiguous/unscored, mixed evidence classified Confident when any
   support is `>= 75`, and no row removal.
8. **Site keys:** single `C120`, alternative `C120|C347`, combined
   `C120+C347`, non-unique FASTA, and FASTA-unmapped.
9. **Shared peptides:** resolver-on single assignment and resolver-off retained
   group with unavailable adjustment.
10. **Normalization:** background complete-feature pool and `< 50` fallback,
    centered-median target-feature factors, raw/none behavior, and reported
    before/after channel distributions.
11. **Coverage/imputation:** 2-of-3 in every compared condition, no imputation
    before coverage, and exported imputation mask.
12. **Protein matching:** exact isoform, canonical fallback, no gene-only match,
    and unmatched/unquantified proteins absent from adjusted results while
    remaining in PTM results.
13. **Statistics:** BH correction per comparison/layer and retained
    `Unestimable` rows with `NA` statistics.
14. **Visualization state:** filters shared across layers within one comparison
    and isolated between comparisons.

### 11.2 Frontend tests

- PTM page has no direct file input or upload action.
- Each input role opens the File Library picker with single selection.
- Detected modifications include TMT and exactly one can be selected.
- Protein channel mismatch prevents continuing.
- PTM sessions visit Metadata and reuse TMT mapping/comparison controls.
- Without protein input, Protein and adjusted tabs are disabled.
- With protein input, all three tabs are enabled.
- Protein tab switches to protein table/info; PTM and adjusted tabs use site
  table/info.
- Current volcano colors and both significance modes are preserved.
- Hover tooltip contains localization status; localization does not restyle the
  point.
- Selecting a point or row updates the site panel.
- Raw/Normalized chart switching does not change statistical values.
- Mark-all-significant, marker clearing, pagination, sorting, export, selection,
  and up/down DE counts match the protein Volcano page behavior.
- PTM Compare correlates matched IDs within the selected result layer and is
  disabled for sessions with fewer than two comparisons.

### 11.3 Full reference-data run

Add an opt-in scientific integration/E2E test that:

1. Places both supplied real TXT files in an isolated File Library test folder.
2. Selects them through the library API, not upload endpoints.
3. Selects DBIA, bundled Human FASTA, shared-peptide resolution on, centered
   median normalization, maximum missing fraction 0.40, and imputation on.
4. Applies the exact 126-131 Drug/DMSO mapping in Section 4.3.
5. Runs Drug vs DMSO.
6. Verifies the four detected modification names and six reporter channels.
7. Verifies PTM, protein, and adjusted result layers are produced.
8. Verifies at least one single site, combined site, ambiguous candidate group,
   and localization-evidence record.
9. Verifies centered-median normalization factors are reported and the median
   site log2FC is centered near zero.
10. Verifies the ZIP contains the expected TSVs and no PSM audit table.

Use small real-header fixtures for ordinary unit tests; keep the full files for
the scientific integration lane so routine tests remain fast.

## 12. Implementation sequence and release gates

### Phase 1: contracts and library selection

- Add typed PTM session configuration and role-aware File Library selection.
- Extend the library for FASTA.
- Add PTM start validation and parser/modification-detection tests.
- Verify the PTM wizard contains no direct upload path.

### Phase 2: Python preprocessing

- Implement the enriched/protein adapters and fixed filters.
- Reuse shared-peptide resolution.
- Implement localization, FASTA mapping, site keys, repeated-PSM aggregation,
  background normalization, and coverage.
- Verify all corresponding unit contracts before R integration.

### Phase 3: MSstatsPTM and protein adjustment

- Replace the legacy PD converter boundary.
- Add robust site summarization, optional protein input, comparisons, three
  result layers, per-layer BH correction, and unestimable rows.
- Verify with an isolated R contract test using MSstatsPTM 2.14.0.

### Phase 4: results, QC, and ZIP

- Add stable result schemas, detail endpoints, QC, and processed TSV ZIP.
- Verify PTM-only and PTM-plus-protein output contracts.

### Phase 5: PTM visualization

- Implement the approved volcano/table/information-panel layout.
- Reuse current volcano colors and significance helpers.
- Add per-comparison filter persistence and layer-aware panels.
- Verify responsive and accessible behavior.

### Phase 6: full scientific acceptance

- Run the supplied files through the File Library with the agreed channel
  metadata.
- Run existing TMT and DIA regression suites unchanged.
- Add PTM to the scientific release gate only after the full reference run and
  R integration checks pass.

## 13. Final acceptance criteria

The feature is ready when all of the following are true:

- The real enriched PTM TXT is accepted without a CHIMERYS coefficient column.
- The updated protein TXT is accepted and filtered by the current TMT rules.
- No PTM direct-upload control or processing path is exposed.
- All inputs, including custom FASTA, are selected from the File Library.
- The files' channels and saved channel metadata must match before processing.
- Every detected modification, including TMT, can be selected as the one target.
- Ambiguous, unscored, multi-position, combined-site, and FASTA-unmapped
  evidence is retained without abundance duplication.
- Repeated PSMs are summed, while distinct peptidoforms use robust site
  summarization.
- Background normalization defaults on, reports its evidence, and safely falls
  back to raw PTM below 50 complete background features.
- PTM-only sessions never create proxy protein or adjusted results.
- PTM-plus-protein sessions produce all three model layers and obey the exact
  protein matching policy.
- PTM sites without a quantified protein remain in PTM results but are absent
  from the protein-adjusted volcano and table.
- BH correction, unestimable-row behavior, coverage, and imputation match this
  specification.
- The result page uses the approved PTM site information layout while preserving
  current volcano significance modes and colors.
- The ZIP contains processed result TSVs and no excluded-PSM audit.
- The supplied Drug vs DMSO reference run passes, as do all existing TMT/DIA
  regression tests.
