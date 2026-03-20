# Test Requirements - Proteomics Visualization Web App

**Generated:** 2026-03-16
**Status:** MUST be fulfilled before webapp is considered built
**Test Framework:** Playwright E2E + Pytest (backend) + Vitest (frontend)

---

## Overview

This document defines comprehensive test requirements that MUST pass before the webapp is considered complete. Tests are organized by workflow phase and feature area. 

---

## Test Must Do
* Test must be conducted by browser automation with sample data, mimic user operation. Never 
* To confirm a test pass for each test, a screenshot from browser automation is required. Visual confirmation mimic user behavior is needed.
* No paralle test allowed. A test can be initiate only when the previous test is passed by visual confirmation.
* All test related files must be in ./Tests folder.

---

## Test Organization

```
tests/
├── e2e/                          # Playwright E2E tests
│   ├── 01-welcome.spec.ts        # Welcome page tests
│   ├── 02-data-input.spec.ts     # Data input & config tests
│   ├── 03-processing.spec.ts     # Processing pipeline tests
│   ├── 04-results.spec.ts        # Results visualization tests
│   ├── 05-qc-plots.spec.ts       # QC plots tests
│   ├── 06-bioinformatics.spec.ts # Bioinformatics tests
│   ├── 07-pdf-export.spec.ts     # PDF export tests
│   └── 08-session-manager.spec.ts # Session management tests
├── integration/                  # Integration tests
│   ├── test_api.py
│   ├── test_processing.py
│   └── test_r_integration.py
└── unit/                         # Unit tests
    ├── test_file_parser.py
    ├── test_validators.py
    └── test_data_processor.py
```

---

## E2E Test Requirements

### Test Suite 1: Welcome Page (01-welcome.spec.ts)

**Test 1.1: Page Load**
- [ ] Welcome page loads without errors
- [ ] Page title is correct
- [ ] Session manager panel visible on left

**Test 1.2: Template Selection**
- [ ] "Protein Pair-wise Comparison Analysis" template is visible
- [ ] Other templates show "TBD" tooltip when hovered
- [ ] Clicking template creates new session
- [ ] Session appears in session manager panel
- [ ] URL navigates to `/analysis`

**Test 1.3: Session Persistence**
- [ ] Refreshing page preserves session list
- [ ] Sessions survive server restart (verify by stopping/starting backend)

---

### Test Suite 2: Data Input & Configuration (02-data-input.spec.ts)

**Test 2.1: File Upload - Proteomics Data**
- [ ] Can upload PSM CSV files via drag-and-drop
- [ ] Can upload PSM CSV files via file picker
- [ ] Upload progress indicator shows
- [ ] File size validation: rejects files > 500MB
- [ ] CSV column validation: rejects files missing required columns
- [ ] Filename parsing extracts ExperimentName, Condition, Replicate correctly
- [ ] Upload from database button shows "TBD"

**Test 2.2: File Upload - Compound Data (Optional)**
- [ ] Can upload compound CSV file
- [ ] Validates "Corp ID" and "SMILES" columns exist
- [ ] Shows "No available compound" if no match to conditions

**Test 2.3: Experiment Structure Table**
- [ ] Table displays all uploaded files
- [ ] Columns: Filename, Experiment, Condition, Replicate
- [ ] Checkboxes for file selection work
- [ ] Select All / Deselect All functionality works

**Test 2.4: Validation Warnings**
- [ ] Warning shown when selecting files from >1 ExperimentName: "Samples must be from the same experiment!"
- [ ] Warning shown when selecting >2 conditions: "Sample must be from 2 conditions for paired comparison!"
- [ ] Warning shown when <3 replicates per condition: "At least 3 replicates per condition required!"
- [ ] "Start Analysis" button disabled until all validations pass

**Test 2.5: Compound Display**
- [ ] When Corp ID matches Condition name, displays compound 2D structure
- [ ] Structure rendered using RDKit
- [ ] Shows "No available compound" if no match

**Test 2.6: User Configuration - Treatment/Control**
- [ ] Two dropdowns populated with selected conditions
- [ ] Dropdowns contain different values
- [ ] Validation: cannot select same condition for both
- [ ] Selection persists in session

**Test 2.7: User Configuration - Organism**
- [ ] Dropdown populated from scanned organism database
- [ ] Only shows organisms with both .fasta and _uniprot_gene.tsv files
- [ ] Default selection is valid

**Test 2.8: User Configuration - Remove Razor**
- [ ] Toggle Yes/No (default: No)
- [ ] Warning shown: "Bioinformatics analysis will be disabled if No"
- [ ] Selection persists in session

**Test 2.9: User Configuration - Strict Filtering**
- [ ] Toggle Yes/No (default: No)
- [ ] Tooltip explains reliability vs coverage trade-off
- [ ] Selection persists in session

**Test 2.10: Session Creation**
- [ ] Clicking "Start Analysis" creates session with all configurations
- [ ] Session metadata saved to backend
- [ ] Navigates to processing page

---

### Test Suite 3: Processing Pipeline (03-processing.spec.ts)

**Test 3.1: Real-time Progress Display**
- [ ] All 9 steps displayed with status indicators
- [ ] Step status updates: Not Started → In Progress → Completed
- [ ] Overall progress bar shows percentage
- [ ] Progress updates via WebSocket in real-time

**Test 3.2: Step-by-Step Verification**
For each step, verify:
- [ ] Step 1: Combine Replicates - PSM_Abundances.tsv created
- [ ] Step 2: Generate Unique PSM - Unique PSM column created
- [ ] Step 3: Remove Razor (conditional) - razor peptides removed if Yes
- [ ] Step 4: Remove Low Quality - contaminants filtered
- [ ] Step 5: Filter - strict/lenient filtering applied
- [ ] Step 6: Protein Abundance - Protein_Abundances.tsv created via msqrob2
- [ ] Step 7: Differential Expression - Diff_Expression.tsv created via msqrob2
- [ ] Step 8: QC Metrics - QC_Results.json created
- [ ] Step 9: GSEA - GSEA results files created

**Test 3.3: Processing Completion**
- [ ] "Data process complete" message shown
- [ ] Auto-redirect to visualization page after 2 seconds
- [ ] All output files exist in session directory

**Test 3.4: Error Handling**
- [ ] Processing errors show clear error messages
- [ ] Failed step can be retried
- [ ] Session state reflects error status

**Test 3.5: WebSocket Resilience**
- [ ] Processing continues if WebSocket disconnects
- [ ] Reconnection handled gracefully
- [ ] Progress updates resume after reconnection

---

### Test Suite 4: Results Visualization (04-results.spec.ts)

**Test 4.1: General Info Panel**
- [ ] Shows correct number of proteins identified (from Diff_Expression.tsv)
- [ ] Example: "2239 proteins identified"

**Test 4.2: Differential Expression Count**
- [ ] Shows dynamic count: "total DE protein: 300; 180 (up)/120(down)"
- [ ] Updates when volcano plot filters change

**Test 4.3: Volcano Plot - Display**
- [ ] Plot renders with all protein dots by default
- [ ] X-axis: log2(Treatment/Control)
- [ ] Y-axis: -log10(p-value)
- [ ] Upregulated proteins: pink (#E73564)
- [ ] Downregulated proteins: blue (#00ADEF)
- [ ] Other proteins: grey (#6B7280)
- [ ] Dashed threshold lines visible

**Test 4.4: Volcano Plot - Filters**
- [ ] Fold change filter: 1-5 (default: 2)
- [ ] P-value filter: 0-1 (default: 0.05)
- [ ] Adj P-value filter: 0-1 (default: 1)
- [ ] Manual input accepts typed numbers
- [ ] Filter changes update plot in real-time
- [ ] Filter changes update protein table

**Test 4.5: Volcano Plot - Selection Modes**

*Click Mode:*
- [ ] Single click selects one protein
- [ ] Cannot select more than one protein in click mode
- [ ] Clicking empty space deselects (pan mode)
- [ ] Dragging pans the plot

*Box Mode:*
- [ ] Can select multiple proteins via box selection
- [ ] Selection count shown in panel

*Lasso Mode:*
- [ ] Can select multiple proteins via lasso
- [ ] Selection count shown in panel

**Test 4.6: Volcano Plot - Selected Proteins**
- [ ] Selected proteins highlighted with darker color
- [ ] Selected proteins have black border
- [ ] Selected proteins have no transparency
- [ ] Selected proteins are larger
- [ ] Selected proteins render on top
- [ ] "Clear Selection" button removes all selections

**Test 4.7: Protein Info Panel - No Selection**
- [ ] Shows "select one protein to see detail" when no protein selected
- [ ] Shows same message when multiple proteins selected

**Test 4.8: Protein Info Panel - Single Selection**
- [ ] Master Protein Accessions displayed
- [ ] Each UniProt ID is clickable link to uniprot.org
- [ ] Gene names displayed correctly (not uniprot id), and in correct order
- [ ] Fold change (non-log) displayed
- [ ] Log2 fold change displayed
- [ ] P-value displayed
- [ ] Adj P-value displayed
- [ ] Number of PSMs displayed
- [ ] Significance displayed

**Test 4.9: Protein Abundance Plot**
- [ ] Column plot shows protein abundances per sample
- [ ] Y-axis is log2 transformed
- [ ] Order: treatment_1, treatment_2... control_1, control_2...
- [ ] Plot updates when different protein selected

**Test 4.10: PSM Abundance Plot**
- [ ] Dot-line plot shows PSM abundances
- [ ] Different PSMs have different colors
- [ ] Y-axis is original abundance (not log2)
- [ ] Order: treatment_1, treatment_2... control_1, control_2...
- [ ] Plot updates when different protein selected

**Test 4.11: Protein Results Table**
- [ ] Columns: Protein, Gene Name, Log2FC, P-value, Adj P-value, Significance
- [ ] Default sort: Adj P-value ascending
- [ ] Clicking header sorts by that column
- [ ] Shows 25 proteins per page
- [ ] Pagination works correctly
- [ ] When proteins selected in volcano plot, table filters to show only selected
- [ ] When no selection, shows all significant proteins
- [ ] Clicking protein row shows info in protein info panel
- [ ] CSV export button downloads current table view

---

### Test Suite 5: QC Plots (05-qc-plots.spec.ts)

**Test 5.1: All Plots Display**
- [ ] PCA analysis plot visible with data points
- [ ] P-value distribution plot visible (20 bins)
- [ ] PSM CV variance violin plot visible
- [ ] PSM intensity distribution plots visible (2 conditions)
- [ ] Protein intensity distribution plots visible
- [ ] Data completeness stacked bar chart visible
- [ ] **NO EMPTY PLOTS** - all plots show actual data

**Test 5.2: PCA Plot**
- [ ] Shows sample clustering
- [ ] Displays % variance for PC1 and PC2
- [ ] Samples colored by condition
- [ ] Interactive (zoom, pan)

**Test 5.3: P-value Distribution**
- [ ] Histogram with 20 bins from 0-1
- [ ] Shows actual distribution shape
- [ ] Not flat/empty

**Test 5.4: PSM CV Variance**
- [ ] Violin plot for each condition
- [ ] Shows distribution of CV values
- [ ] Both conditions displayed

**Test 5.5: Intensity Distributions**
- [ ] PSM intensity: separate plots per condition
- [ ] Protein intensity: separate plots per condition
- [ ] Log2 transformed on x-axis
- [ ] Shows distribution curves

**Test 5.6: Data Completeness**
- [ ] Stacked bar chart per replicate
- [ ] Shows missing vs non-missing counts
- [ ] Percentages or counts labeled

---

### Test Suite 6: Bioinformatics (06-bioinformatics.spec.ts)

**Test 6.1: Database Selection**
- [ ] Dropdown shows: GO BP, GO MF, GO CC, Reactome, KEGG
- [ ] Default: GO Biological Processes
- [ ] Switching databases shows "processing" indicator
- [ ] Results update after loading

**Test 6.2: Overview Panel**
- [ ] Shows total significant pathways (adjPval ≤ 0.05)
- [ ] Shows overrepresented pathway count
- [ ] Shows underrepresented pathway count

**Test 6.3: Top Enriched Pathways Chart**
- [ ] Bar chart shows top 5 highest NES
- [ ] Bar chart shows top 5 lowest NES
- [ ] X-axis is NES value
- [ ] Clicking pathway selects it
- [ ] Only one pathway can be selected at a time

**Test 6.4: Enriched Pathways Table**
- [ ] Columns: Pathway Name, NES, P-value, Adj P-value, Gene Count
- [ ] Filter: |NES| ≥ 1
- [ ] Sortable headers
- [ ] 25 pathways per page
- [ ] Pagination works
- [ ] Clicking row selects pathway
- [ ] CSV export button works

**Test 6.5: Pathway Details Panel**
- [ ] Shows when pathway selected
- [ ] Pathway name displayed
- [ ] NES displayed
- [ ] P-value displayed
- [ ] Adj P-value displayed
- [ ] Gene count displayed
- [ ] Leading edge genes: shows 10 by default
- [ ] "Show More" button reveals full list

**Test 6.6: GSEA Plot**
- [ ] GSEA plot displayed for selected pathway
- [ ] Uses gseapy gseaplot function
- [ ] Shows enrichment profile
- [ ] Shows gene hits
- [ ] Shows ranking metric

**Test 6.7: Biomart Fallback**
- [ ] When offline, shows warning message
- [ ] Falls back to using UniProt IDs
- [ ] Analysis completes without error

---

### Test Suite 7: PDF Export (07-pdf-export.spec.ts)

**Test 7.1: PDF Generation**
- [ ] "Export Reports" button visible on visualization page
- [ ] Clicking button generates PDF
- [ ] Progress indicator shown during generation
- [ ] PDF downloads automatically

**Test 7.2: PDF Content**
- [ ] Sample Information section present
- [ ] User Configuration section present
- [ ] Results section present (volcano plot, protein table)
- [ ] QC Plots section present (all 6 plots)
- [ ] Bioinformatics section present
- [ ] All content well-organized
- [ ] Page breaks appropriate
- [ ] Text readable
- [ ] Plots visible and clear

**Test 7.3: PDF Quality**
- [ ] File size reasonable (<10MB for typical report)
- [ ] Opens in standard PDF viewers
- [ ] No missing images or content

---

### Test Suite 8: Session Manager (08-session-manager.spec.ts)

**Test 8.1: Session List**
- [ ] Panel visible on left side
- [ ] Lists all existing sessions on startup
- [ ] Sessions scanned from backend
- [ ] Session info: name, created date, status

**Test 8.2: Session Resume**
- [ ] Clicking session loads it
- [ ] Returns to appropriate page based on session state
- [ ] All session data restored

**Test 8.3: Session Delete**
- [ ] Delete button visible for each session
- [ ] Confirmation dialog shown
- [ ] Session removed from list
- [ ] Session directory deleted from backend
- [ ] No orphaned files remain

**Test 8.4: New Session**
- [ ] "New Analysis" button on welcome page
- [ ] Creates new session with unique ID
- [ ] Navigates to data input page

---

## Integration Test Requirements

### API Integration Tests (test_api.py)

**Test I.1: Session API**
- [ ] POST /sessions - creates session
- [ ] GET /sessions - lists all sessions
- [ ] GET /sessions/{id} - retrieves session
- [ ] DELETE /sessions/{id} - deletes session
- [ ] PUT /sessions/{id}/config - updates configuration

**Test I.2: File Upload API**
- [ ] POST /sessions/{id}/upload - uploads proteomics files
- [ ] Validates CSV columns
- [ ] Rejects files > 500MB
- [ ] Parses filename correctly

**Test I.3: Processing API**
- [ ] POST /sessions/{id}/process - starts processing
- [ ] WebSocket /ws/sessions/{id} - real-time updates
- [ ] GET /sessions/{id}/status - processing status

**Test I.4: Results API**
- [ ] GET /sessions/{id}/results - differential expression data
- [ ] GET /sessions/{id}/qc/plots - QC plot data
- [ ] GET /sessions/{id}/gsea/{database} - GSEA results

### Processing Integration Tests (test_processing.py)

**Test I.5: 9-Step Pipeline**
- [ ] Each step produces expected output
- [ ] Step outputs feed correctly to next step
- [ ] Intermediate files saved correctly
- [ ] Error in one step stops pipeline

**Test I.6: Data Format Conversion**
- [ ] CSV → TSV conversion works
- [ ] TSV → CSV conversion works
- [ ] Special characters handled correctly

### R Integration Tests (test_r_integration.py)

**Test I.7: R Package Availability**
- [ ] msqrob2 installed and loadable
- [ ] QFeatures installed and loadable
- [ ] limma installed and loadable

**Test I.8: R Script Execution**
- [ ] Protein abundance script runs successfully
- [ ] Differential expression script runs successfully
- [ ] Output format matches expected structure
- [ ] Encoding handled correctly (UTF-8 → latin-1)

**Test I.9: GSEA Integration**
- [ ] gseapy runs successfully
- [ ] Biomart fallback works when offline
- [ ] Results saved in correct format

---

## Unit Test Requirements

### File Parser Tests (test_file_parser.py)

**Test U.1: Filename Parsing**
- [ ] Correctly extracts ExperimentName
- [ ] Correctly extracts Condition
- [ ] Correctly extracts ReplicateNumber
- [ ] Handles various filename formats

**Test U.2: CSV Validation**
- [ ] Validates required columns present
- [ ] Rejects files with missing columns
- [ ] Handles quoted fields correctly
- [ ] Handles different line endings

**Test U.3: Column Extraction**
- [ ] Extracts dynamic abundance columns correctly
- [ ] Maps to unified Abundance column
- [ ] Creates Sample Origination column

### Validator Tests (test_validators.py)

**Test U.4: Experiment Validation**
- [ ] Rejects multiple experiments
- [ ] Rejects >2 conditions
- [ ] Rejects <3 replicates per condition
- [ ] Accepts valid configurations

**Test U.5: Configuration Validation**
- [ ] Treatment != Control
- [ ] Valid organism selected
- [ ] All required fields present

### Data Processor Tests (test_data_processor.py)

**Test U.6: Step 1-5 Logic**
- [ ] Combine replicates correctly
- [ ] Generate unique PSM correctly
- [ ] Remove razor peptides correctly
- [ ] Filter low quality correctly
- [ ] Apply strict/lenient filtering correctly

**Test U.7: QC Calculations**
- [ ] PCA calculation correct
- [ ] P-value distribution correct
- [ ] CV calculation correct
- [ ] Data completeness correct

---

## Performance Test Requirements

**Test P.1: File Upload**
- [ ] 10MB file uploads in <5 seconds
- [ ] 100MB file uploads in <30 seconds
- [ ] 500MB file uploads in <2 minutes

**Test P.2: Processing Time**
- [ ] Steps 1-5 complete in <10 seconds
- [ ] Step 6 (msqrob2) completes in <2 minutes
- [ ] Step 7 (msqrob2) completes in <30 seconds
- [ ] Step 8 (QC) completes in <5 seconds
- [ ] Step 9 (GSEA) completes in <2 minutes per database

**Test P.3: Page Load**
- [ ] Welcome page loads in <2 seconds
- [ ] Data input page loads in <2 seconds
- [ ] Visualization page loads in <3 seconds
- [ ] QC plots render in <3 seconds

**Test P.4: Concurrent Users**
- [ ] System handles 5 concurrent sessions
- [ ] System handles 10 concurrent sessions
- [ ] Memory usage stays <2GB per session

---

## Success Criteria

### E2E Tests
- [ ] All 8 test suites pass (100%)
- [ ] No flaky tests
- [ ] Screenshots captured for verification

### Integration Tests
- [ ] All API endpoints tested
- [ ] All processing steps tested
- [ ] R integration fully tested

### Unit Tests
- [ ] Code coverage >80%
- [ ] All critical paths covered
- [ ] Edge cases covered

### Performance Tests
- [ ] All performance benchmarks met
- [ ] No memory leaks
- [ ] No timeout errors

---

## Test Data Requirements

### Sample Data
- **Proteomics:** PSM_SampleData_DMSO_1.csv through _5.csv + PSM_SampleData_INCZ123456_1.csv through _5.csv
- **Compound:** compound id.csv
- **Organism:** human.fasta + human_uniprot_gene.tsv

### Test Configuration
- Treatment: INCZ123456
- Control: DMSO
- Organism: human
- Remove Razor: Yes
- Strict Filtering: No

### Expected Results
- ~2,000 proteins identified
- ~300 differentially expressed proteins
- All QC plots show data
- GSEA shows enriched pathways

---

## Test Execution Commands

```bash
# Backend tests
cd backend && pytest

# Frontend unit tests
cd frontend && npm run test

# E2E tests
cd frontend && npx playwright test

# All tests (from root)
npm run test:all
```

---

## Notes

1. **Test Isolation:** Each test must be independent
2. **Test Data:** Use SampleData/ files for consistency
3. **Cleanup:** Tests must clean up created sessions
4. **Screenshots:** E2E tests must capture screenshots on failure
5. **Reporting:** Generate HTML report after test run

