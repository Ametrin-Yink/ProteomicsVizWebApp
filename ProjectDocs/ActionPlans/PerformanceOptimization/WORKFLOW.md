# Performance Optimization Workflow

## Overview

This document outlines the workflow for the Performance Optimization phase of the ProteomicsViz WebApp project.

**Status:** In Progress - Phase 2: Vectorized Operations + Batch WebSocket

---

## Phase 1: Parallel GSEA + Caching ✅ COMPLETE

**Goal:** Implement parallel GSEA execution and result caching.

**Completed:**
- ✅ GSEA Cache Service (`backend/app/services/gsea_cache_service.py`)
- ✅ Parallel GSEA Execution (`backend/app/services/gsea_service.py`)
- ✅ Unit tests for cache service

**Commits:**
- `1d8a700` - feat: add GSEA caching service with LRU eviction
- `a9c7f59` - feat: parallel GSEA execution with caching

**Expected Savings:** 2-3 minutes (parallel) + up to 4 minutes (caching for repeats)

---

## Phase 2: Vectorized Operations + Batch WebSocket ✅ COMPLETE

**Goal:** Optimize Python data processing and reduce WebSocket overhead.

**Completed:**
- ✅ Vectorized Step 3 Razor Removal (`backend/app/services/data_processor.py`)
- ✅ Batch WebSocket Updates (`backend/app/services/processing_orchestrator.py`)

**Commits:**
- `94aa1d3` - perf: vectorize Step 3 razor removal
- `4a3c3dc` - perf: batch WebSocket progress updates

**Expected Savings:** ~1-5 seconds (Step 3) + reduced WebSocket overhead

---

## Phase 3: Combined R Script (Next)

**Goal:** Eliminate R cold start overhead by combining Steps 6+7.

**Planned Tasks:**
1. Create combined R script (`backend/scripts/msqrob2_combined.R`)
2. Add wrapper support (`backend/app/services/msqrob2_wrapper.py`)
3. Integration tests

**Expected Savings:** 10-15 seconds (one less R cold start)

---

## Phase 2: Design & Plan

**Goal:** Design optimization approaches based on profiling data.

### Steps:

1. **Brainstorm optimization approaches**
   - Use `superpowers:brainstorming` skill
   - Consider: R process warming, batch WebSocket updates, async I/O improvements, data transformation optimizations

2. **Write implementation plan**
   - Use `superpowers:writing-plans` skill
   - Document specific optimizations with file paths and expected improvements

3. **Review trade-offs**
   - R process warming vs implementation complexity
   - Batch updates vs UI responsiveness
   - Memory usage vs speed

---

## Phase 3: Implement & Verify

**Goal:** Execute optimizations and verify improvements.

### Steps:

1. **Execute the plan**
   - Use `superpowers:executing-plans` or `superpowers:subagent-driven-development`
   - Follow TDD approach where applicable

2. **Measure before/after**
   - Quantify performance improvements
   - Document in `PERFORMANCE_ANALYSIS.md`

3. **Ensure correctness**
   - Run full test suite
   - Verify no regressions in functionality

---

## Skills Reference

| Skill | When to Use |
|-------|-------------|
| `superpowers:systematic-debugging` | If unexpected behavior discovered during profiling |
| `superpowers:brainstorming` | Design optimization approaches |
| `superpowers:writing-plans` | Create detailed implementation plan |
| `superpowers:executing-plans` | Batch execution with checkpoints |
| `superpowers:subagent-driven-development` | Task-by-task execution with review |
| `superpowers:test-driven-development` | Regression tests for performance-critical code |

---

## Expected Outcomes

1. **PERFORMANCE_ANALYSIS.md** - Documented bottlenecks with timing data
2. **Optimized processing pipeline** - Faster execution with maintained correctness
3. **Performance regression tests** - Prevent future performance degradation

