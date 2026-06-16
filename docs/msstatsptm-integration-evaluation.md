# MSstatsPTM Integration Evaluation

## Should We Build a PTM Analysis Workflow Based on MSstatsPTM?

**Date:** 2026-06-16
**Evaluator:** Claude (DeepSeek v4 Pro)
**Package Evaluated:** MSstatsPTM v2.15.0 (Vitek Lab, Northeastern University)
**Current State:** PTM exists as a disabled frontend stub — a "PTM Analysis" toggle with a "Soon" badge, no backend implementation. The wizard has been reordered to **pipeline-first** (Pipeline → Upload → Comparisons → Config → Summary) to support pipeline-aware upload pages. The upload page already has conditional scaffolding: a `selectedTemplate === 'protein'` branch (current single-zone) and a `'ptm'` branch (placeholder for multi-zone PTM upload). This reduces the frontend work needed for PTM integration.

---

## Executive Summary

**Recommendation: PROCEED with integration, phased approach. Phase 1: Label-Free only, MaxQuant converter only, core pipeline. Phase 2: TMT support, additional converters, advanced visualization.**

MSstatsPTM is a mature, well-architected Bioconductor package from the same Vitek Lab that produces MSstats and MSstatsTMT — packages we already integrate. It follows the same design patterns, shares the same dependency chain, and addresses a genuine gap in our application. The integration is technically feasible with moderate effort (~3-4 weeks for Phase 1), aligns with our existing subprocess-based R integration architecture, and would transform a dead frontend stub into a meaningful differentiator.

---

## 1. Package Quality Assessment

### 1.1 Code Quality

| Criterion | Assessment | Notes |
|-----------|-----------|-------|
| **Code organization** | ★★★★★ | Clean separation: converters → summarization → modeling → visualization. Each in its own file. |
| **Error handling** | ★★★★☆ | checkmate assertions on all public functions. Informative stop() messages. Could be more granular. |
| **Logging** | ★★★★★ | Comprehensive MSstatsConvert logging with session info capture, timestamps, and append mode. |
| **Test coverage** | ★★★★☆ | Tinytest-based. Covers converters, both summarization paths, and group comparison. Not exhaustive but hits the critical paths. |
| **Documentation** | ★★★★★ | Full Rd documentation for every exported function. Two vignettes (LF + TMT). Pkgdown website. Worked examples in every help page. |
| **Rcpp usage** | ★★★★☆ | Minimal C++ only where performance matters (protein name matching). Falls back to R gracefully. |

### 1.2 Dependency Chain Compatibility

MSstatsPTM's dependency chain overlaps significantly with packages we already have installed:

```
Our existing stack:        MSstatsPTM additionally requires:
├── MSstats ✓              ├── Biostrings (Bioconductor, for FASTA reading)
├── MSstatsTMT ✓           ├── checkmate (CRAN, lightweight assertions)
├── MSstatsConvert ✓       ├── ggrepel (CRAN, for volcano plot labels)
├── data.table ✓           └── The MSstatsPTM package itself
├── ggplot2 ✓
├── plotly ✓
└── Rcpp ✓
```

**Impact:** We would need to install `MSstatsPTM` and `Biostrings` from Bioconductor, plus `ggrepel` and `checkmate` from CRAN. All are lightweight. The `install_r_packages.R` script would need one new entry. Estimated additional install time: ~2-3 minutes.

### 1.3 Package Maturity

- On Bioconductor since Release 3.13 (2021) — 4+ years of stable releases
- Active GitHub repository with ongoing development (`devel` branch)
- Part of the Vitek Lab ecosystem, which has strong academic credibility in computational proteomics
- Published methodology behind it (the MSstats family has multiple papers in MCP, JPR, etc.)
- Version 2.15.0 indicates substantial iteration

**Verdict:** The package is production-ready and does not present dependency risk.

---

## 2. Technical Feasibility Assessment

### 2.1 Fit with Existing Architecture

Our backend uses a **plugin-based pipeline engine** (`pipeline_engine.py`) with step handlers registered in `pipeline_registry.py`. Both existing pipelines (msqrob2, MSstats) follow the same pattern:

```
Step 1: Python pre-processing (Combine Replicates)
Step 2: Python pre-processing (Generate Unique PSM)
Step 3-N: R subprocess (protein abundance / DE)
Step N+1: Python post-processing (QC metrics)
```

A PTM pipeline would follow the same architecture but with key differences:

| Dimension | Existing Protein Pipelines | PTM Pipeline (Proposed) |
|-----------|---------------------------|------------------------|
| **Input** | Single PSM CSV file | PTM PSM CSV + optional Global Protein PSM CSV + FASTA file |
| **Converter** | Python (DataProcessor) reads filename | R (MSstatsPTM converter) for site localization |
| **Summarization** | R calls MSstats::dataProcess | R calls MSstatsPTM::dataSummarizationPTM |
| **Statistical Model** | Single model per comparison | **Three models**: PTM, Protein, Adjusted ← new pattern |
| **Output** | Column-based DE results | Column-based DE results × 3 models |
| **Visualization** | Volcano, Profile Plot, QC Plot | Volcano (3-panel), Heatmap, Profile Plot, QC Plot |

### 2.2 R Integration Feasibility

We already integrate with R via subprocess — the exact same mechanism MSstatsPTM requires. Our `base_r_wrapper.py` Template Method pattern can be extended to a PTM wrapper:

```python
# Proposed: backend/app/services/ptm_wrapper.py
class PTMWrapper(BaseRWrapper):
    """R subprocess wrapper for MSstatsPTM operations."""
    
    def run_summarization(self, ptm_data_path, protein_data_path, ...):
        """Run dataSummarizationPTM R function."""
        # Same pattern as msqrob2_data_process.R but calls MSstatsPTM
```

**The R script approach would follow our established pattern:**
- `backend/scripts/ptm_summarization.R` — calls `MSstatsPTM::dataSummarizationPTM()` or `MSstatsPTM::dataSummarizationPTM_TMT()`
- `backend/scripts/ptm_group_comparison.R` — calls `MSstatsPTM::groupComparisonPTM()`

### 2.3 Data Model Impact

The biggest architectural challenge is the **three-model output**. Our current results schema assumes one comparison result per protein:

```python
# Existing model (backend/app/models/data.py)
class DifferentialExpressionResult(BaseModel):
    protein: str
    log2fc: float
    pvalue: float
    adj_pvalue: float
    ...
```

The PTM pipeline produces results for three models per comparison. We would need:

```python
# Proposed addition
class PTMDifferentialExpressionResult(BaseModel):
    site: str                      # e.g., "Q9UQ80_K376"
    global_protein: str            # e.g., "Q9UQ80"
    comparison: str
    # PTM model (unadjusted)
    ptm_log2fc: float
    ptm_pvalue: float
    ptm_adj_pvalue: float
    # Protein model
    protein_log2fc: float
    protein_pvalue: float
    protein_adj_pvalue: float
    # Adjusted model (THE key result)
    adjusted_log2fc: float
    adjusted_se: float
    adjusted_pvalue: float
    adjusted_adj_pvalue: float
    is_adjusted: bool              # Whether protein-level adjustment was possible
    ...
```

This is a **non-trivial but manageable** change. It affects:
- `backend/app/models/data.py` — new model
- `backend/app/api/routes/visualization.py` — new response format for PTM-specific queries
- `backend/app/api/routes/results.py` — the results endpoint must handle the 3-model output
- Frontend types in `frontend/src/types/api.ts`

### 2.4 FASTA File Handling

A FASTA file is **required** for PTM site localization. This is a new file type for our application. Options:

| Option | Pros | Cons |
|--------|------|------|
| **A: User uploads FASTA** | Accurate, user knows their proteome | Extra upload step, potential user friction |
| **B: Pre-bundle common FASTA files** | Convenient for human/mouse/yeast | Maintenance burden, version drift |
| **C: Fetch from UniProt on demand** | Always up-to-date | Network dependency, rate limiting, latency |

**Recommendation: Options A + B combined.** Allow upload, but pre-bundle reviewed human (UP000005640) and mouse (UP000000589) proteomes. These cover ~90% of use cases. The FASTA is small (~50MB for human proteome, ~25MB compressed).

### 2.5 Converter Strategy

MSstatsPTM offers 10 converters. Building all 10 would take months. A phased approach:

**Phase 1 (MVP):** MaxQuant only (covers ~60% of the field, supports both LF and TMT)
**Phase 2:** FragPipe + Spectronaut (another ~25%)
**Phase 3:** DIA-NN, Skyline, PD, PE-AKS, Progenesis, Metamorpheus, Protein Prospector

The converter code is 1,700+ lines in `converters.R`. For Phase 1, we only need to expose `MaxQtoMSstatsPTMFormat` as an R subprocess call.

---

## 3. Effort Estimation

### Phase 1: Label-Free MVP (MaxQuant only)

| Component | Files to Create/Modify | Est. Effort | Notes |
|-----------|----------------------|-------------|-------|
| **R scripts** | `backend/scripts/ptm_summarization.R`, `ptm_group_comparison.R` | 2-3 days | |
| **PTM wrapper service** | `backend/app/services/ptm_wrapper.py` | 1-2 days | |
| **PTM step handlers** | `backend/app/services/steps/ptm_steps.py` (3-5 handlers) | 2-3 days | |
| **Pipeline definition** | `backend/app/services/pipeline_registry.py` (add PTM pipeline) | 0.5 day | |
| **Data models** | `backend/app/models/data.py` (add PTM DE model) | 1 day | |
| **API routes** | Extend `visualization.py`, `results.py`, add `upload.py` FASTA handling | 2-3 days | |
| **Upload handling** | FASTA file upload + dual-dataset upload | 1-2 days | Upload page already has PTM scaffolding (multi-zone placeholder) |
| **Task manager** | Register PTM task kind | 0.5 day | |
| **Frontend: enable pipeline** | `pipeline/page.tsx` — remove "Soon" badge, wire up PTM template; `analysis-store.ts` — add PTM pipeline option | 1 day | Wizard is already pipeline-first; template toggle and store types already exist |
| **Frontend: PTM results** | New visualization components (3-panel volcano, etc.) | 3-5 days | |
| **Frontend: upload UI** | Replace PTM placeholder with actual multi-zone upload (PTM + Protein + FASTA drop zones) | 1-2 days | Upload page already has conditional `selectedTemplate` rendering |
| **Testing** | Backend unit + integration, frontend E2E | 3-4 days | |
| **R package installation** | `install_r_packages.R` update, verification script | 0.5 day | |
| **Documentation** | Update CLAUDE.md, pipeline docs, API contract | 1 day | |

**Phase 1 total: ~17-26 working days (3.5-5 weeks for one developer)** *(reduced from 18-28 due to completed wizard reorder and upload scaffolding)*

### Phase 2: TMT + Additional Converters

| Component | Est. Effort |
|-----------|-------------|
| TMT pipeline (`dataSummarizationPTM_TMT`) | 2-3 days |
| FragPipe converter | 1-2 days |
| Spectronaut converter | 1-2 days |
| Frontend TMT-specific visualization | 2-3 days |
| Testing | 2-3 days |

**Phase 2 total: ~8-13 working days**

### Phase 3: Full Converter Coverage

Remaining converters (DIA-NN, Skyline, PD, PEAKS, Progenesis, Metamorpheus, Protein Prospector) and sample size calculation. **Estimated: ~8-12 working days.**

---

## 4. Architecture Diagram (Proposed Integration)

```
User Uploads:
├── PTM PSM CSV (required)     ─┐
├── Protein PSM CSV (optional)  ─┤ Python: filename parsing, validation
├── FASTA file (required)       ─┘        (existing DataProcessor pattern)
│
▼
┌─────────────────────────────────────────────────────┐
│  Pipeline Engine (existing)                          │
│  PTM Pipeline Steps:                                 │
│                                                      │
│  Step 1: Combine Replicates (Python, ptm-specific)   │
│  Step 2: Generate Unique PSM (Python, ptm-specific)  │
│  Step 3: PTM Summarization (R: MSstatsPTM)           │
│          └─ Rscript ptm_summarization.R              │
│             ├─ MSstatsPTM::dataSummarizationPTM()    │
│             │  ├─ Normalization (equalizeMedians)    │
│             │  ├─ Missing value imputation (MBimpute) │
│             │  └─ Run-level summarization (TMP)      │
│             └─ Saves: PTM + Protein .rds files       │
│                                                      │
│  Step 4: PTM Group Comparison (R: MSstatsPTM)        │
│          └─ Rscript ptm_group_comparison.R           │
│             ├─ MSstatsPTM::groupComparisonPTM()      │
│             │  ├─ PTM Model (linear mixed effects)   │
│             │  ├─ PROTEIN Model (if protein data)    │
│             │  └─ ADJUSTED Model                     │
│             │     log2FC_adj = PTM_FC - Protein_FC   │
│             └─ Saves: 3 model outputs as JSON        │
│                                                      │
│  Step 5: QC Metrics (Python, ptm-specific)           │
└─────────────────────────────────────────────────────┘
│
▼
Results (stored in sessions/{id}/results/):
├── ptm_model.json        ← PTM.Model results
├── protein_model.json    ← PROTEIN.Model results
├── adjusted_model.json   ← ADJUSTED.Model results (primary)
└── ptm_qc.json           ← QC metrics
│
▼
Frontend Visualization:
├── 3-panel Volcano Plot (PTM | Protein | Adjusted)
├── Per-site abundance profile plots
├── QC boxplots (modified + unmodified)
├── Heatmap of significant PTM sites
└── Protein-level adjustment summary
```

---

## 5. Risk Analysis

### 5.1 Technical Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| **R package installation failure** | Medium | High | Add to `install_r_packages.R` with explicit Bioconductor dependency chain. Test on our R 4.5.1 environment before committing. |
| **MSstatsPTM API breaking changes** | Low | Medium | Pin to Bioconductor release version, not GitHub devel. Track Bioconductor release schedule (May/October). |
| **FASTA parsing performance** | Low | Medium | The FASTA is only read once during conversion, not in the hot path. `Biostrings::readAAStringSet` is optimized C code. |
| **3-model output breaking existing API consumers** | Medium | Medium | Add PTM-specific endpoints (`/api/sessions/{id}/ptm/results`) rather than overloading existing protein endpoints. |
| **Site localization memory usage** | Medium | Low | `MSstatsPTMSiteLocator` processes one protein at a time. For proteome-scale data, memory could spike. Test with realistic datasets before release. |
| **Dual dataset upload confusion** | High | Low | Clear UI with separate drop zones for "PTM (Modified) Data" and "Global Proteome (Optional)" + FASTA. Validation to prevent swapped uploads. |

### 5.2 UX Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Users don't have a FASTA file** | High | Pre-bundle human and mouse FASTA. Provide clear instructions + UniProt link for custom organisms. |
| **Users don't have a global profiling run** | Medium | Support `use_unmod_peptides=TRUE` mode. Make it clear this is a compromise with a warning in the UI. |
| **The 3-model concept is confusing** | Medium | Default to showing the ADJUSTED model. Make PTM-only and Protein-only models available under "Advanced." Add tooltips explaining the adjustment. |
| **"PTM Analysis" has been "coming soon" for a while** | Low | Positive — users have been waiting. Launch with a blog post / changelog entry. |

### 5.3 Scientific Risks

| Risk | Mitigation |
|------|------------|
| **Protein-level adjustment is only meaningful with a proper global profiling run** | The `Adjusted` column in the output flags which PTMs were adjusted. Make this visible in the UI. Warn when `use_unmod_peptides` is used. |
| **Multiple modifications per peptide confound results** | Default to `mod_num='Single'` (only single-modification peptides). Expose as an advanced option. |

---

## 6. Comparison: Build vs. Alternatives

### Alternative A: Build on MSstatsPTM (Recommended)

**Pros:**
- Leverages an existing, peer-reviewed, Bioconductor-vetted statistical framework
- Same Vitek Lab methodology as our existing MSstats pipeline (consistency)
- Active maintenance by a dedicated academic lab
- 10 converters already written and tested
- C++ performance for protein name matching
- Built-in visualization (we can reimplement in Plotly.js or reuse the R plots)

**Cons:**
- New R package dependency (MSstatsPTM + Biostrings)
- The 3-model output is architecturally different from our current 1-model pattern
- FASTA file requirement adds UX complexity
- Converter functions are monolithic — hard to expose as granular pipeline steps

### Alternative B: Build Our Own PTM Pipeline

**Pros:**
- Full control over the architecture
- Could design for granular step-by-step progress display
- No R dependency beyond what we already have
- Could use Python-native tools (scipy, statsmodels)

**Cons:**
- **Enormous effort.** Reimplementing the statistical methodology (linear mixed effects, Welch-Satterthwaite adjustment, site localization from FASTA, normalization, imputation) would take 6-12 months.
- **Scientific risk.** Getting the statistics right is hard. The Vitek Lab has published methodology. Getting the adjustment wrong (subtracting log2FC without proper error propagation) would produce scientifically invalid results.
- **No converters.** Each of the 10 converters handles tool-specific quirks (MaxQuant's modification notation, FragPipe's localization scores, etc.). Writing these from scratch would be a year+ of work.
- **No community validation.** MSstatsPTM's methodology has been peer-reviewed and cited.

**Verdict:** Building our own is not viable. The MSstatsPTM package encapsulates years of domain expertise.

### Alternative C: Skip PTM Analysis Entirely

**Pros:**
- No development effort
- No new dependencies

**Cons:**
- PTM analysis is a major use case in proteomics — phosphorylation alone represents ~30% of published proteomics studies
- The "Soon" badge has been there for a while (user expectation)
- Competitor platforms (Perseus, Spectronaut, Skyline) offer PTM analysis
- Our BioNet network visualization already shows PTM interaction types (Phosphorylation, Ubiquitination, etc.) — having PTM quantification would create a complete PTM story from quantification to network

**Verdict:** Skipping PTM leaves a significant gap.

---

## 7. Implementation Phases (Detailed)

### Phase 1: Label-Free MVP (Recommended First Step)

**Scope:**
- MaxQuant label-free PTM pipeline only
- FASTA file upload (human/mouse pre-bundled + custom upload)
- PTM-only mode (no global profiling run) for initial release
- Core pipeline: Converter → Summarization → Group Comparison → QC
- `ADJUSTED.Model` only if protein data is provided
- Basic visualization: 3-panel volcano, per-site profile plot, QC boxplot
- Protein data optional — can use `use_unmod_peptides=TRUE` or upload separate global profiling data

**Deliverables:**
1. `backend/scripts/ptm_summarization.R` — calls `MSstatsPTM::dataSummarizationPTM()`
2. `backend/scripts/ptm_group_comparison.R` — calls `MSstatsPTM::groupComparisonPTM()`
3. `backend/app/services/ptm_wrapper.py` — R subprocess management
4. `backend/app/services/steps/ptm_steps.py` — pipeline step handlers
5. Updated `pipeline_registry.py` — PTM pipeline definition
6. Updated `data.py` — PTM-specific Pydantic models
7. Extended visualization routes for PTM data
8. FASTA upload handling in `upload.py`
9. Frontend: enable PTM template, upload UI modifications, new PTM result views
10. Tests: unit (Python steps with mocked R), integration (R subprocess), E2E (Playwright)

### Phase 2: TMT + Protein Adjustment + Additional Converters

**Scope:**
- TMT pipeline (`dataSummarizationPTM_TMT` + `groupComparisonPTM` with TMT)
- Full protein-level adjustment for both LF and TMT
- FragPipe and Spectronaut converters
- Advanced visualization: heatmap, sample size calculation, Plotly interactivity
- Global profiling run as a first-class input

### Phase 3: Full Coverage

**Scope:**
- All 10 converters
- Sample size calculation via `designSampleSizePTM`
- Protein-level adjustment quality reporting
- Custom contrast matrix UI (beyond pairwise)
- Export of adjusted results

---

## 8. Key Architectural Decisions Required

### Decision 1: R Script Granularity

**Option A:** One monolithic R script that does summarization + modeling + adjustment (like `dataProcessPTM()`)
**Option B:** Separate R scripts for summarization and modeling (matching the step-by-step pipeline UI)

**Recommendation: Option B.** Our pipeline UI shows step-by-step progress. Separate scripts allow us to report progress between summarization and modeling, and allow retry of individual steps.

### Decision 2: Results Storage Format

**Option A:** Store all 3 models in a single JSON file
**Option B:** Store each model separately (`ptm.json`, `protein.json`, `adjusted.json`)

**Recommendation: Option B.** Allows the frontend to load only the model it needs. The ADJUSTED model is the primary output; the other two are supporting. Separate files make the data flow clearer and enable lazy loading.

### Decision 3: Converter Strategy

**Option A:** Run converter in R (calling `MaxQtoMSstatsPTMFormat` via R subprocess)
**Option B:** Run converter in Python (reimplement the conversion logic)

**Recommendation: Option A.** The converters include PTM site localization (`MSstatsPTMSiteLocator`) which maps peptide-level modifications to full protein positions using FASTA. Reimplementing this in Python would be a significant effort and risk. Running the converter as an R subprocess is the safer path.

**Important caveat:** Our existing protein pipelines do file parsing and initial processing in Python (DataProcessor), then call R for statistical steps. For the PTM pipeline, we may want to shift the boundary: do minimal validation in Python (file format, required columns), then hand off to R for the full conversion + site localization + summarization chain. This is architecturally different but justified by the complexity of site localization.

### Decision 4: FASTA Storage

**Option A:** Store FASTA in each session directory
**Option B:** Global FASTA cache shared across sessions

**Recommendation: Option B.** A global `protein_database/` directory already exists. Add a `fasta/` subdirectory. Pre-bundled human and mouse FASTA files. User-uploaded FASTA files are cached here. This avoids duplicating a 50MB FASTA file in every session.

---

## 9. Dependencies to Add

### R Packages (add to `install_r_packages.R`)

```r
# New: MSstatsPTM and its unique dependencies
BiocManager::install("MSstatsPTM")     # pulls MSstats, MSstatsTMT, MSstatsConvert
BiocManager::install("Biostrings")     # FASTA reading (may already be installed)
install.packages("ggrepel")            # volcano plot labels
install.packages("checkmate")          # assertions (lightweight)
```

### Verification Script

Add to `backend/scripts/verify_r_packages.R`:
```r
library(MSstatsPTM)
library(Biostrings)
cat("MSstatsPTM packages OK\n")
```

---

## 10. Frontend Changes Summary

The wizard was reordered to **pipeline-first** (Pipeline → Upload → Comparisons → Config → Summary) on 2026-06-16. The upload page now has conditional rendering based on `selectedTemplate`: a `'protein'` branch (existing single-zone) and a `'ptm'` branch (placeholder text). This scaffolding reduces the remaining frontend work:

| Page/Component | Current State | Remaining PTM Work |
|----------------|--------------|-------------------|
| `pipeline/page.tsx` | Template toggle exists (Protein/PTM); PTM shows "Soon" badge and placeholder; PTM template clears pipeline selection | Remove "Soon" badge; add PTM pipeline card(s); allow continue when PTM template + pipeline selected |
| `analysis-store.ts` | `selectedTemplate: 'protein' \| 'ptm'` type exists; `setTemplate('ptm')` clears pipeline to null | Add PTM pipeline option; stop clearing pipeline for PTM template |
| Upload page (`upload/page.tsx`) | Pipeline-first order; conditional `selectedTemplate` rendering with PTM placeholder; back button, pipeline badge | Replace PTM placeholder with multi-zone upload: PTM data zone, optional Protein data zone, FASTA zone + organism selector |
| `comparisons/page.tsx` | Back→Upload, no-files guard | Unchanged for PTM (same comparison-building UI) |
| `config/page.tsx` | Pipeline-specific config forms | Add PTM-specific config options (adjustment toggle, mod type selector) |
| Results view | Protein-only (volcano, QC, abundance) | New PTM-specific views: 3-panel volcano (PTM \| Protein \| Adjusted), site-level data table, protein adjustment status |
| Visualization | Existing protein visualizations | Extend with PTM modes: per-site profile plots, adjusted fold-change heatmaps |
| Types (`api.ts`) | Protein-only API response types | PTM-specific types for 3-model results, site-level queries |

---

## 11. Success Criteria

1. User selects "PTM Analysis" template on the pipeline page (step 1), selects a PTM pipeline, and continues to upload — **wizard infrastructure ready; needs PTM pipeline cards**
2. Upload page (step 2) shows multi-zone PTM upload: PTM enrichment data zone, optional global proteome zone, FASTA file zone with organism selector — **scaffolding ready; needs multi-zone implementation**
3. User can upload a MaxQuant LF PTM dataset (evidence.txt) + annotation + FASTA
4. Pipeline completes through summarization → group comparison → QC
5. Results display the ADJUSTED model as the primary output when protein data is available; PTM.Model only when no protein data
6. Volcano plot shows 3 panels (PTM, Protein, Adjusted) when protein data is available, 1 panel (PTM only) otherwise
7. All existing protein pipelines continue to work without regression
8. All new code has test coverage following existing patterns
9. R package installation works on our R 4.5.1 environment

---

## 12. Final Recommendation

**Proceed with Phase 1.**

MSstatsPTM is the right foundation. It's from the same lab as the tools we already trust, it addresses a genuine scientific need, and the integration effort is moderate. The key architectural challenge — the 3-model output — is manageable with careful API design. The FASTA requirement adds some UX complexity but can be mitigated with pre-bundled files for common organisms.

**Do not** attempt to build a custom PTM pipeline from scratch — the statistical methodology and converter surface area make that a multi-year effort.

**Start with MaxQuant LF only.** This covers the most common use case, keeps scope manageable, and allows us to validate the architecture before expanding to TMT and other converters.

---

## Appendix A: Files That Would Need Changes

### Backend (new files marked with ★)

```
★ backend/scripts/ptm_summarization.R
★ backend/scripts/ptm_group_comparison.R
★ backend/scripts/verify_msstatsptm.R
★ backend/app/services/steps/ptm_step1_combine.py
★ backend/app/services/steps/ptm_step2_unique.py
★ backend/app/services/steps/ptm_step3_summarization.py
★ backend/app/services/steps/ptm_step4_group_comparison.py
★ backend/app/services/steps/ptm_step5_qc.py
★ backend/app/services/ptm_wrapper.py
  backend/app/services/pipeline_registry.py         (modify: add PTM pipeline)
  backend/app/services/pipeline_engine.py             (likely no changes)
  backend/app/services/task_manager.py                (modify: add PTM task kind)
  backend/app/models/data.py                          (modify: add PTM DE model)
  backend/app/models/analysis.py                      (modify: add PTM config)
  backend/app/api/routes/upload.py                    (modify: FASTA upload)
  backend/app/api/routes/visualization.py             (modify: PTM endpoints)
  backend/app/api/routes/results.py                   (modify: PTM results)
  backend/scripts/install_r_packages.R                (modify: add MSstatsPTM)
  backend/scripts/verify_r_packages.R                 (modify: add verification)
```

### Frontend

```
  frontend/src/app/new/pipeline/page.tsx              (modify: enable PTM — "Soon" badge removal, PTM pipeline cards)
  frontend/src/app/new/upload/page.tsx                (modify: replace PTM placeholder with multi-zone upload)
  frontend/src/stores/analysis-store.ts               (modify: add PTM pipeline option, stop clearing pipeline for PTM)
  frontend/src/stores/processing-store.ts             (may need changes)
  frontend/src/types/api.ts                           (modify: PTM types)
★ frontend/src/components/visualization/PTMVolcano.tsx
★ frontend/src/components/visualization/PTMResults.tsx
  frontend/src/app/sessions/[id]/page.tsx             (may need PTM tab)
```

> **Already done (2026-06-16):** Wizard reordered to pipeline-first. Upload page has `selectedTemplate` conditional rendering with PTM placeholder. `selectedTemplate` type includes `'ptm'`. Template toggle on pipeline page exists. Comparisons page back button and no-files guard updated. These changes are committed on `main`.

### Tests

```
★ Tests/backend/unit/test_ptm_pipeline.py
★ Tests/backend/unit/test_ptm_wrapper.py
★ Tests/backend/integration/test_ptm_integration.py
★ Tests/e2e/ptm-workflow.spec.ts
  Tests/conftest.py                                   (modify: PTM fixtures)
```

---

## Appendix B: Key MSstatsPTM Functions Reference

| Function | Input | Output | Our Equivalent Pattern |
|----------|-------|--------|------------------------|
| `MaxQtoMSstatsPTMFormat()` | evidence.txt, annotation, FASTA | list(PTM, PROTEIN) | Python DataProcessor (but R subprocess for PTM) |
| `MSstatsPTMSiteLocator()` | peptide data, FASTA | data with site annotations | New — no equivalent |
| `dataSummarizationPTM()` | MSstatsPTM formatted data | list(PTM, PROTEIN) with FeatureLevelData, ProteinLevelData | `msqrob2_data_process.R` |
| `dataSummarizationPTM_TMT()` | MSstatsPTM TMT formatted data | same as above | `msstats_data_process.R` |
| `groupComparisonPTM()` | summarized data | list(PTM.Model, PROTEIN.Model, ADJUSTED.Model) | `msqrob2_group_comparison_multi.R` |
| `groupComparisonPlotsPTM()` | model results | ggplot2/plotly objects | Python/Plotly.js in frontend |
| `dataProcessPlotsPTM()` | summarized data | ggplot2/plotly objects | Python/Plotly.js in frontend |
| `designSampleSizePTM()` | model results | sample size table | New — could be on-demand task |
| `locatePTM()` | peptide, uniprot, FASTA | site annotation | Internal to converters |
| `tidyFasta()` | FASTA path | data.table | Could pre-process in Python |

## Appendix C: About the Vendored Package in docs/

The `docs/msstatsptm-package/` directory was a shallow clone of the MSstatsPTM GitHub repository, downloaded for the purpose of this evaluation. It has been **removed and gitignored** — the actual integration uses `BiocManager::install("MSstatsPTM")` to install the package into the system R library, not a vendored copy. The package introduction and this evaluation document remain in `docs/` as reference.
