# Test Execution Plan - Proteomics Visualization Web App

**Generated:** 2026-03-17  
**Status:** In Progress - Test Suite 1  
**Executor:** Sisyphus Agent

---

## Overview

This plan tracks the systematic execution of all test requirements from `ProjectDocs/test_requirements.md`. Tests are executed sequentially with visual confirmation via screenshots.

---

## Test Execution Rules

1. **Sequential Execution:** No parallel tests - each test must pass before starting the next
2. **Visual Confirmation:** Every test requires a screenshot for verification
3. **Bug Fix First:** If a test fails, fix the bug before continuing
4. **Backup:** Regular backups to `D:\CodingWorks\Backup`
5. **Documentation:** Update progress.md and AGENTS.md after each suite

---

## Network Constraints (China Mainland)

- Git is not available - use `D:\CodingWorks\Backup` as git server
- Package downloads must use China mirrors
- Be careful when killing processes - only kill backend/frontend, not the agent

---

## Test Suites Progress

### Test Suite 1: Welcome Page (01-welcome.spec.ts)
| Test | Description | Status | Screenshot |
|------|-------------|--------|------------|
| 1.1 | Page Load - Welcome page loads without errors, correct title, session manager visible | ✅ Passed | 01-welcome-loads-without-errors-final.png |
| 1.2 | Template Selection - Template visible, TBD tooltips, creates session, navigates to /analysis | ✅ Passed | Multiple screenshots captured |
| 1.3 | Session Persistence - Refresh preserves session, survives server restart | ✅ Passed | Multiple screenshots captured |

**Suite Status:** ✅ COMPLETE (12/12 tests passed, 100%)

---

### Test Suite 2: Data Input & Configuration (02-data-input.spec.ts)
| Test | Description | Status | Screenshot |
|------|-------------|--------|------------|
| 2.1 | File Upload - Proteomics Data (single + multiple) | ✅ Passed | Screenshots captured |
| 2.2 | File Upload - Compound Data | ✅ Passed | Screenshots captured |
| 2.3 | Experiment Structure Table | ✅ Passed | Screenshots captured |
| 2.4 | Validation Warnings (min replicates, same experiment, two conditions) | ✅ Passed | Screenshots captured |
| 2.5 | Compound Display | ✅ Passed | Screenshots captured |
| 2.6 | User Configuration - Treatment/Control | ✅ Passed | Screenshots captured |
| 2.7 | User Configuration - Organism | ✅ Passed | Screenshots captured |
| 2.8 | User Configuration - Remove Razor | ✅ Passed | Screenshots captured |
| 2.9 | User Configuration - Strict Filtering | ✅ Passed | Screenshots captured |
| 2.10 | Session Creation | ✅ Passed | Screenshots captured |
| Extra | File removal, progress indicator, invalid format, duplicates | ✅ Passed | Screenshots captured |
| Extra | Complete data input flow | ✅ Passed | Screenshots captured |

**Suite Status:** ✅ COMPLETE (15/15 tests passed, 100%)

---

### Test Suite 3: Processing Pipeline (03-processing.spec.ts) - REDESIGNED

**Status:** 🔄 Redesigning based on actual requirements

| Test | Description | Status | Screenshot |
|------|-------------|--------|------------|
| 3.1 | Real-time Progress Display - 9 steps visible with indicators | ✅ Passed | - |
| 3.2 | Step Status Transitions - not-started → in-progress → completed | 🔲 Redesigning | - |
| 3.3 | Step 1 Output - PSM_Abundances.tsv created | 🔲 Redesigning | - |
| 3.4 | Step 6 Output - Protein_Abundances.tsv via msqrob2 | 🔲 Redesigning | - |
| 3.5 | Step 7 Output - Diff_Expression.tsv via msqrob2 | 🔲 Redesigning | - |
| 3.6 | Step 8 Output - QC_Results.json created | 🔲 Redesigning | - |
| 3.7 | Step 9 Output - GSEA results files | 🔲 Redesigning | - |
| 3.8 | Processing Completion - "Data process complete" message | 🔲 Redesigning | - |
| 3.9 | Auto-redirect to visualization after 2s | 🔲 Redesigning | - |
| 3.10 | WebSocket Resilience - reconnect on disconnect | 🔲 Redesigning | - |
| 3.11 | WebSocket Resilience - progress resumes after reconnect | 🔲 Redesigning | - |
| 3.12 | Error Handling - network errors show messages | 🔲 Redesigning | - |
| 3.13 | Error Handling - retry functionality | 🔲 Redesigning | - |
| 3.14 | Cancel Processing - cancel button works | 🔲 Redesigning | - |
| 3.15 | Estimated Time Display - shows remaining time | 🔲 Redesigning | - |
| 3.16 | Log Panel - shows processing logs | 🔲 Redesigning | - |

**Suite Status:** 🔄 Redesigning (3/16 passed, need to fix backend processing first)

**Root Issues:**
1. Backend processing not executing (async task issue)
2. Tests checking wrong CSS classes
3. Missing output file verification
4. WebSocket not sending progress updates

**Redesign Goals:**
1. Fix backend to actually run processing pipeline
2. Verify output files are created (PSM_Abundances.tsv, Protein_Abundances.tsv, etc.)
3. Proper WebSocket progress updates
4. Test actual functionality, not just UI

---

### Test Suite 4: Results Visualization (04-results.spec.ts)
| Test | Description | Status | Screenshot |
|------|-------------|--------|------------|
| 4.1 | General Info Panel | 🔲 Not Started | - |
| 4.2 | Differential Expression Count | 🔲 Not Started | - |
| 4.3 | Volcano Plot - Display | 🔲 Not Started | - |
| 4.4 | Volcano Plot - Filters | 🔲 Not Started | - |
| 4.5 | Volcano Plot - Selection Modes | 🔲 Not Started | - |
| 4.6 | Volcano Plot - Selected Proteins | 🔲 Not Started | - |
| 4.7 | Protein Info Panel - No Selection | 🔲 Not Started | - |
| 4.8 | Protein Info Panel - Single Selection | 🔲 Not Started | - |
| 4.9 | Protein Abundance Plot | 🔲 Not Started | - |
| 4.10 | PSM Abundance Plot | 🔲 Not Started | - |
| 4.11 | Protein Results Table | 🔲 Not Started | - |

**Suite Status:** 🔲 Not Started

---

### Test Suite 5: QC Plots (05-qc-plots.spec.ts)
| Test | Description | Status | Screenshot |
|------|-------------|--------|------------|
| 5.1 | All Plots Display | 🔲 Not Started | - |
| 5.2 | PCA Plot | 🔲 Not Started | - |
| 5.3 | P-value Distribution | 🔲 Not Started | - |
| 5.4 | PSM CV Variance | 🔲 Not Started | - |
| 5.5 | Intensity Distributions | 🔲 Not Started | - |
| 5.6 | Data Completeness | 🔲 Not Started | - |

**Suite Status:** 🔲 Not Started

---

### Test Suite 6: Bioinformatics (06-bioinformatics.spec.ts)
| Test | Description | Status | Screenshot |
|------|-------------|--------|------------|
| 6.1 | Database Selection | 🔲 Not Started | - |
| 6.2 | Overview Panel | 🔲 Not Started | - |
| 6.3 | Top Enriched Pathways Chart | 🔲 Not Started | - |
| 6.4 | Enriched Pathways Table | 🔲 Not Started | - |
| 6.5 | Pathway Details Panel | 🔲 Not Started | - |
| 6.6 | GSEA Plot | 🔲 Not Started | - |
| 6.7 | Biomart Fallback | 🔲 Not Started | - |

**Suite Status:** 🔲 Not Started

---

### Test Suite 7: PDF Export (07-pdf-export.spec.ts)
| Test | Description | Status | Screenshot |
|------|-------------|--------|------------|
| 7.1 | PDF Generation | 🔲 Not Started | - |
| 7.2 | PDF Content | 🔲 Not Started | - |
| 7.3 | PDF Quality | 🔲 Not Started | - |

**Suite Status:** 🔲 Not Started

---

### Test Suite 8: Session Manager (08-session-manager.spec.ts)
| Test | Description | Status | Screenshot |
|------|-------------|--------|------------|
| 8.1 | Session List | 🔲 Not Started | - |
| 8.2 | Session Resume | 🔲 Not Started | - |
| 8.3 | Session Delete | 🔲 Not Started | - |
| 8.4 | New Session | 🔲 Not Started | - |

**Suite Status:** 🔲 Not Started

---

## Backend Tests

### Integration Tests
| Test | Description | Status |
|------|-------------|--------|
| I.1 | Session API | 🔲 Not Started |
| I.2 | File Upload API | 🔲 Not Started |
| I.3 | Processing API | 🔲 Not Started |
| I.4 | Results API | 🔲 Not Started |
| I.5 | 9-Step Pipeline | 🔲 Not Started |
| I.6 | Data Format Conversion | 🔲 Not Started |
| I.7 | R Package Availability | 🔲 Not Started |
| I.8 | R Script Execution | 🔲 Not Started |
| I.9 | GSEA Integration | 🔲 Not Started |

### Unit Tests
| Test | Description | Status |
|------|-------------|--------|
| U.1 | Filename Parsing | 🔲 Not Started |
| U.2 | CSV Validation | 🔲 Not Started |
| U.3 | Column Extraction | 🔲 Not Started |
| U.4 | Experiment Validation | 🔲 Not Started |
| U.5 | Configuration Validation | 🔲 Not Started |
| U.6 | Step 1-5 Logic | 🔲 Not Started |
| U.7 | QC Calculations | 🔲 Not Started |

---

## Current Phase

**Phase:** Test Suite 1 - Welcome Page  
**Current Test:** 1.1 Page Load  
**Next Action:** Start backend and frontend servers, then run Test 1.1

---

## Errors Encountered

| Error | Test | Resolution |
|-------|------|------------|
| None yet | - | - |

---

## Backup Log

| Date | Backup Location | Notes |
|------|-----------------|-------|
| - | - | - |
