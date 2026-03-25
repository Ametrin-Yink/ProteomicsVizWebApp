# Phase 1: BugFix

## Goal
Systematically inventory and fix all bugs before proceeding to other phases.

## Process
Follow [systematic debugging](../../AGENTS/):
1. **Inventory** - Catalog all known bugs
2. **Triage** - Categorize by severity (critical/major/minor)
3. **Root Cause** - Trace each bug to its source
4. **Fix** - Address root causes, not symptoms
5. **Verify** - Confirm fix with browser test + LOOK AT screenshot (see [bug-inventory.md](bug-inventory.md) for details)
6. **Log** - Record bug fix updates in relevent files  

## Severity Levels

- **Critical** - Blocks usage, data corruption, crashes
- **Major** - Significant functionality broken
- **Minor** - UI glitches, annoyances, edge cases

## Current Status (2026-03-25)

| Severity | Total | Fixed | Open |
|----------|-------|-------|------|
| Critical | 7 | **6** | **1** |
| Major | 13 | **13** | **0** |
| Minor | 10 | 10 | 0 |
| **Total** | **30** | **29** | **1** |

**Note:** Only CRIT-002 remains open. All blocking issues (CRIT-007) and GSEA issues (CRIT-004, CRIT-005) have been fixed and verified.

### Critical Bugs (1 Open)

| ID | Description | Status |
|----|-------------|--------|
| CRIT-001 | setComplete is not defined error when starting analysis | **Fixed** |
| CRIT-002 | Volcano plot double-click not selecting proteins | Open |
| CRIT-003 | CV calculation showing wrong values (~600%) | **Fixed** |
| CRIT-004 | GSEA plot shows straight line curve (calculation wrong) | **Fixed** |
| CRIT-005 | GSEA plot missing heat map on right side | **Fixed** |
| CRIT-008 | Protein abundance distribution incorrect after CRIT-006 normalization fix | **Fixed** |
| CRIT-009 | QC plot: PSM CVs and Protein CVs showing identical data | **Cannot Reproduce** |
| CRIT-007 | Processing stuck at 0% - WebSocket error prevents analysis from starting | **Fixed** |

### Major Bugs (0 Open - All Fixed)

| ID | Description | Status |
|----|-------------|--------|
| MAJ-001 | About and Documentation buttons in top nav are non-functional | **Fixed** |
| MAJ-002 | Cannot rename session name in session manager | **Fixed** |
| MAJ-003 | Protein Abundance plot showing partial/random samples | **Fixed** |
| MAJ-004 | QC Total PSMs should be Total Unique PSMs | **Fixed** |
| MAJ-005 | QC PSM Data Completeness showing wrong count | **Fixed** |
| MAJ-006 | PCA plot has extra 'PSM_Count' dot | **Fixed** |
| MAJ-007 | PSM Intensity should be log2 transformed with distinct colors | **Fixed** |
| MAJ-008 | Protein Intensity showing wrong curves (conditions vs samples) | **Fixed** |
| MAJ-009 | Processing steps not updating in real-time | **Fixed** |
| MAJ-010 | Activity log not displaying any logs | **Fixed** |

### Minor Bugs (0 Open - All Fixed)

| ID | Description | Status |
|----|-------------|--------|
| MIN-001 | Analysis template logos should be unique per template | **Fixed** |
| MIN-002 | Session manager logo differs from welcome page templates | **Fixed** |
| MIN-003 | Configuration panel doesn't scroll with Data Input panels | **Fixed** |
| MIN-004 | Duplicate 'Clear Selection' button in filter panel | **Fixed** |
| MIN-005 | Protein Abundance plot x-axis label overlapped by legend | **Fixed** |
| MIN-006 | PSM Abundance plot connects first and last point | **Fixed** |
| MIN-007 | PSM Abundance plot x-axis label overlapped by legend | **Fixed** |
| MIN-008 | Pathway Details showing full info in both columns | **Fixed** |
| MIN-009 | CV plot names should be 'Protein CVs' and 'PSM CVs' | **Fixed** |

---

## File Storage Guidelines

**All bug fix test files MUST be stored in the `Tests/` folder.**

When working on bug fixes, temporary files such as screenshots, test data, and verification notes should be organized as follows:

| File Type | Location |
|-----------|----------|
| Verification screenshots | `Tests/screenshots/bug-fixes/` |
| Test notes & temp data | `Tests/notes/` |
| E2E test scripts | `Tests/e2e/` |
| Test fixtures | `Tests/fixtures/` |

**Do NOT leave temporary files in the project root directory.** After verification is complete, move all bug fix artifacts to the appropriate Tests subfolder to keep the repository clean.

## Files

- [bug-inventory.md](bug-inventory.md) - Master list of all bugs with full details and verification process
- [fixed-bugs.md](fixed-bugs.md) - Record of fixed bugs with root causes and lessons learned
