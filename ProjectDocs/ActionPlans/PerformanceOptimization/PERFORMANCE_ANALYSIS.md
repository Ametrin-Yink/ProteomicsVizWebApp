# Performance Analysis

## Date: 2026-03-26
## Status: Phase 1 Complete - Implemented

**Phase 1 Optimizations:**
- ✅ Parallel GSEA execution with asyncio.gather
- ✅ GSEA result caching with LRU eviction

**Expected Savings:** 2-3 minutes (parallel) + up to 4 minutes (caching for repeats)

---

## Executive Summary

Based on code analysis, the processing pipeline has **3 primary bottlenecks**:

1. **Step 6: Protein Aggregation (R)** - Estimated 5-20 minutes for large datasets
2. **R Script Cold Start** - Package loading overhead on each R invocation
3. **Step 9: GSEA Analysis** - Multiple databases × 1000 permutations each

---

## Pipeline Step Analysis

### Steps 1-5: Python Data Processing (Fast)

**Location:** `backend/app/services/data_processor.py`

| Step | Operation | Estimated Time | Bottleneck? |
|------|-----------|----------------|-------------|
| 1 | Combine replicates (CSV read) | ~5-10s | No |
| 2 | Generate unique PSM IDs | ~1-2s | No |
| 3 | Remove razor (optional) | ~5-30s | No |
| 4 | Remove low quality | ~2-5s | No |
| 5 | Filter by criteria | ~5-10s | No |

**Total Python processing:** ~20-60 seconds

**Notes:**
- Uses pandas DataFrame operations
- File I/O is async-wrapped (`asyncio.to_thread`)
- Step 3 (razor removal) has O(n²) potential with groupby

---

### Step 6: Protein Abundance (R) - **MAJOR BOTTLENECK**

**Location:** `backend/scripts/msqrob2_protein.R`

**Operations:**
1. Package loading (msqrob2, QFeatures, limma, SummarizedExperiment)
2. Data reshape (long → wide format)
3. Log2 transformation
4. Median centering normalization
5. **aggregateFeatures with robustSummary** ← SLOWEST PART

**Time Estimates (from R script comments):**
| Dataset Size | Time Estimate |
|--------------|---------------|
| Small (<20k peptides) | <5 minutes |
| Medium (20-50k peptides) | 5-10 minutes |
| Large (>50k peptides) | 10-20 minutes |

**Why it's slow:**
- `MsCoreUtils::robustSummary` computes robust statistics (median polish)
- R is single-threaded for this operation
- Large matrix operations in R are memory-intensive

---

### Step 7: Differential Expression (R) - Moderate

**Location:** `backend/scripts/msqrob2_de.R`

**Operations:**
1. Package loading (same packages)
2. Create SummarizedExperiment
3. `lmFit` - linear model fitting
4. `contrasts.fit` - contrast fitting
5. `eBayes` - empirical Bayes moderation
6. `topTable` - result extraction

**Estimated Time:** 30-120 seconds

**Notes:**
- limma is well-optimized
- Step 7 is faster than Step 6 because it works on protein-level data (fewer rows)

---

### Step 8: QC Metrics (Python) - Fast

**Location:** `backend/app/services/qc_calculator.py`

**Operations:**
- PCA (sklearn)
- CV calculation
- P-value distribution
- Intensity distributions
- Data completeness

**Estimated Time:** 5-15 seconds

**Notes:**
- Uses sklearn's PCA (fast C++ implementation)
- Properly async-wrapped file I/O
- Vectorized pandas operations

---

### Step 9: GSEA Analysis (Python) - **BOTTLENECK**

**Location:** `backend/app/services/gsea_service.py`

**Operations per database:**
- `gp.prerank` with 1000 permutations
- Running ES curve generation
- Heatmap data generation

**Configuration:**
```python
permutation_num=1000
threads=4
min_size=15
max_size=500
```

**Time Estimate:**
| Database | Time |
|----------|------|
| GO_Biological_Process_2021 | 30-60s |
| KEGG_2021_Human | 20-40s |
| Reactome_2022 | 30-60s |
| WikiPathway_2023 | 20-40s |
| MSigDB_Hallmark_2020 | 10-20s |

**Total for 5 databases:** ~2-4 minutes

---

## WebSocket & Communication Overhead

**Current Implementation:**
- Progress updates sent at step boundaries (9 steps = ~9 updates)
- Log messages streamed from R scripts via threading
- Each update triggers WebSocket send + file I/O (pipeline_state.json)

**Assessment:** WebSocket overhead is minimal - not a primary bottleneck.

---

## Identified Bottlenecks (Ranked)

### 1. Step 6: Protein Aggregation in R (Highest Impact)
- **Impact:** 5-20 minutes
- **Difficulty to Optimize:** Medium
- **Potential Solutions:**
  - Keep R process warm (connection pooling)
  - Use faster aggregation method (mean instead of robust summary)
  - Parallel processing (if possible in R)

### 2. R Script Cold Start (Medium Impact)
- **Impact:** 5-10 seconds per invocation × 2 = ~10-20s
- **Difficulty to Optimize:** High
- **Potential Solutions:**
  - Keep R process warm with persistent process
  - Use Rserve or similar
  - Batch steps 6+7 into single R script

### 3. Step 9: GSEA Multiple Databases (Medium Impact)
- **Impact:** 2-4 minutes
- **Difficulty to Optimize:** Low
- **Potential Solutions:**
  - Run databases in parallel
  - Reduce permutation count for faster results
  - Cache results for identical inputs

### 4. File I/O Operations (Low Impact)
- **Impact:** ~5-10 seconds total
- **Difficulty to Optimize:** Low
- **Potential Solutions:**
  - Already async-wrapped where appropriate
  - Minimize redundant reads

---

## Timing Summary (End-to-End Estimate)

| Component | Time Range |
|-----------|------------|
| Steps 1-5 (Python) | 20-60s |
| Step 6 (R - Protein) | 5-20 min |
| Step 7 (R - DE) | 30-120s |
| Step 8 (QC) | 5-15s |
| Step 9 (GSEA) | 2-4 min |
| **Total** | **8-27 minutes** |

**Typical real-world:** ~10-15 minutes for medium dataset

---

## Recommendations for Phase 2 (Design)

### Quick Wins (Low Effort, Medium Impact)
1. **Parallel GSEA databases** - Run 5 databases concurrently
2. **Batch R steps** - Combine steps 6+7 into single R script to eliminate cold start

### Medium Effort (High Impact)
3. **R Process Pool** - Keep persistent R processes warm
4. **Progressive WebSocket updates** - Send updates during long R operations (not just at end)

### High Effort (Uncertain Impact)
5. **Rewrite Step 6 in Python** - Replace R aggregation with pandas/numba implementation
6. **Database caching** - Cache GSEA results for identical protein sets

---

## Next Steps

Proceed to **Phase 2: Design & Plan** using `superpowers:brainstorming` skill to design optimization approaches.

Focus areas:
1. R process warming strategy
2. Parallel GSEA implementation
3. Step 6 optimization options

