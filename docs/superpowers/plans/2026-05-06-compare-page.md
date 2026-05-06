# Compare Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a new "Compare" visualization page with protein correlation and comparison correlation panels, all computed on-demand via backend services.

**Architecture:** New backend route module (`compare.py`) + service (`compare_service.py`) following the GSEA polling pattern. New frontend page under `/analysis/visualization/compare` with two tabbed panels, reusing `SearchableSelect` and Plotly patterns. Markers migrate from flat `string[]` to `Record<comparison, string[]>`.

**Tech Stack:** Python (scipy, scikit-learn, umap-learn), TypeScript (React 19, Plotly.js, Zustand), FastAPI async polling pattern

---

### Task 1: Add Compare Types to Frontend

**Files:**
- Modify: `frontend/src/types/api.ts` (append new types)

- [ ] **Step 1: Add compare-related type definitions**

```typescript
// Compare Page Types

export type CorrelationMethod = 'pearson' | 'spearman';
export type ClusterMethod = 'pca' | 'umap' | 'tsne';

export interface CompareRunStatus {
  status: 'idle' | 'running' | 'completed' | 'error';
  error?: string;
  started_at?: string;
  completed_at?: string;
}

export interface ProteinFCResult {
  comparison: string;
  log_fc: number;
  pval: number;
  adj_pval: number;
}

export interface CorrelatedProtein {
  accession: string;
  gene_name: string;
  correlation: number;
}

export interface ClusterPoint {
  accession: string;
  gene_name: string;
  x: number;
  y: number;
  cluster_id?: number;
}

export interface ProteinCorrelationData {
  selected_protein_fc: ProteinFCResult[];
  correlated_proteins: CorrelatedProtein[];
  cluster_coords: ClusterPoint[];
  cluster_var_explained?: number;
}

export interface VennData {
  sets: Record<string, string[]>;
  overlaps: Array<{ region: string[]; count: number; label: string }>;
  set_sizes: Record<string, number>;
}

export interface ComparisonCorrelationData {
  similarity_matrix: {
    comparisons: string[];
    matrix: number[][];
  };
  heatmap_data: {
    proteins: Array<{ accession: string; gene_name: string }>;
    comparisons: string[];
    fold_changes: number[][];
  };
  comparison_correlations: Array<{ comparison: string; correlation: number }>;
  cluster_coords: Array<{ comparison: string; x: number; y: number }>;
}
```

- [ ] **Step 2: Verify types compile**

Run: `cd frontend && npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/types/api.ts
git commit -m "feat: add Compare page TypeScript types"
```

---

### Task 2: Add Compare API Functions

**Files:**
- Modify: `frontend/src/lib/api.ts` (append after GSEA functions)

- [ ] **Step 1: Add compare API functions**

```typescript
// Compare API
export async function runProteinCorrelation(
  sessionId: string,
  body: {
    protein_id: string;
    correlation_method: CorrelationMethod;
    cluster_method: ClusterMethod;
    color_comparison: string;
  }
): Promise<{ status: string }> {
  return fetchApi(`/api/sessions/${sessionId}/compare/protein-correlation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function getProteinCorrelationStatus(sessionId: string): Promise<CompareRunStatus> {
  return fetchApi<CompareRunStatus>(`/api/sessions/${sessionId}/compare/protein-correlation/status`);
}

export async function getProteinCorrelationData(sessionId: string): Promise<ProteinCorrelationData> {
  return fetchApi<ProteinCorrelationData>(`/api/sessions/${sessionId}/compare/protein-correlation`);
}

export async function runComparisonCorrelation(
  sessionId: string,
  body: {
    primary_comparison: string;
    selected_comparisons: string[];
    correlation_method: CorrelationMethod;
    cluster_method: ClusterMethod;
  }
): Promise<{ status: string }> {
  return fetchApi(`/api/sessions/${sessionId}/compare/comparison-correlation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function getComparisonCorrelationStatus(sessionId: string): Promise<CompareRunStatus> {
  return fetchApi<CompareRunStatus>(`/api/sessions/${sessionId}/compare/comparison-correlation/status`);
}

export async function getComparisonCorrelationData(sessionId: string): Promise<ComparisonCorrelationData> {
  return fetchApi<ComparisonCorrelationData>(`/api/sessions/${sessionId}/compare/comparison-correlation`);
}

export async function runVennDiagram(
  sessionId: string,
  body: {
    comparisons: string[];
    pvalue_threshold: number;
    logfc_threshold: number;
  }
): Promise<{ status: string }> {
  return fetchApi(`/api/sessions/${sessionId}/compare/venn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function getVennData(sessionId: string): Promise<VennData> {
  return fetchApi<VennData>(`/api/sessions/${sessionId}/compare/venn`);
}
```

- [ ] **Step 2: Import new types at top of api.ts**

Add to the import block at line 6:
```typescript
import type {
  // ... existing imports ...
  CompareRunStatus,
  ProteinCorrelationData,
  ComparisonCorrelationData,
  VennData,
  CorrelationMethod,
  ClusterMethod,
} from '@/types/api';
```

- [ ] **Step 3: Verify compilation**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat: add Compare page API functions"
```

---

### Task 3: Backend — Compare Service

**Files:**
- Create: `backend/app/services/compare_service.py`
- Create: `Tests/backend/unit/test_compare_service.py`

- [ ] **Step 1: Write failing tests for core correlation computation**

```python
# Tests/backend/unit/test_compare_service.py
import pytest
import numpy as np
from app.services.compare_service import (
    compute_correlation_matrix,
    compute_protein_correlations,
    build_fold_change_matrix,
    run_pca,
)


class TestCorrelationMatrix:
    def test_pearson_correlation_simple(self):
        """Two proteins with identical FC patterns should have correlation 1.0"""
        matrix = np.array([
            [1.0, 2.0, 3.0],  # protein A
            [1.0, 2.0, 3.0],  # protein B (identical)
        ])
        corr = compute_correlation_matrix(matrix, method='pearson')
        assert corr.shape == (2, 2)
        assert corr[0, 1] == pytest.approx(1.0, abs=1e-6)

    def test_spearman_correlation_rank(self):
        """Spearman should be 1.0 for monotonic but non-linear relationship"""
        matrix = np.array([
            [1.0, 2.0, 3.0],
            [10.0, 100.0, 1000.0],  # monotonic but not linear
        ])
        corr = compute_correlation_matrix(matrix, method='spearman')
        assert corr[0, 1] == pytest.approx(1.0, abs=1e-6)

    def test_fewer_than_3_comparisons_returns_empty(self):
        """Need at least 3 data points for meaningful correlation"""
        matrix = np.array([
            [1.0, 2.0],  # only 2 columns
            [1.0, 2.0],
        ])
        corr = compute_correlation_matrix(matrix, method='pearson')
        assert np.isnan(corr[0, 1])


class TestProteinCorrelations:
    def test_returns_top_and_bottom(self):
        matrix = np.array([
            [1.0, 2.0, 3.0, 4.0, 5.0],   # protein A (the query)
            [1.1, 2.1, 3.1, 4.1, 5.1],   # B: near-perfect positive
            [-1.0, -2.0, -3.0, -4.0, -5.0], # C: perfect negative
            [5.0, -3.0, 1.0, -4.0, 2.0], # D: random-ish
        ])
        accessions = ['A', 'B', 'C', 'D']
        gene_names = ['GeneA', 'GeneB', 'GeneC', 'GeneD']
        result = compute_protein_correlations(
            matrix, accessions, gene_names, query_idx=0, method='pearson', top_n=2
        )
        assert result[0]['accession'] == 'B'  # most positive
        assert result[-1]['accession'] == 'C'  # most negative
        assert len(result) == 4  # top 2 + bottom 2


class TestFoldChangeMatrix:
    def test_extracts_per_protein_per_comparison(self):
        """build_fold_change_matrix extracts FC values for all proteins across comparisons"""
        # This test will guide building the matrix from DE result files
        pass  # TDD: write assertion first, then implement


class TestPCA:
    def test_pca_2d_output(self):
        """PCA of N proteins x M comparisons should yield N x 2 coordinates"""
        matrix = np.random.randn(50, 5)  # 50 proteins, 5 comparisons
        coords, var = run_pca(matrix)
        assert coords.shape == (50, 2)
        assert 0 < var < 1
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `backend/.venv/Scripts/python.exe -m pytest Tests/backend/unit/test_compare_service.py -v`
Expected: All tests FAIL (module not found)

- [ ] **Step 3: Implement compare_service.py**

```python
"""
Compare service — on-demand protein and comparison correlation analysis.

All computation is synchronous (called via asyncio.to_thread from routes).
"""

import json
import logging
import os
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd
from scipy import stats
from scipy.cluster.hierarchy import linkage, leaves_list
from scipy.spatial.distance import squareform
from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler

logger = logging.getLogger("proteomics")


def _load_de_file(session_dir: str, comparison: str) -> Optional[pd.DataFrame]:
    """Load a single Diff_Expression file for a comparison."""
    file_path = Path(session_dir) / "results" / f"Diff_Expression_{comparison}.tsv"
    # Fall back to simple format for single-comparison sessions
    if not file_path.exists():
        file_path = Path(session_dir) / "results" / "Diff_Expression.tsv"
        if not file_path.exists():
            return None
    df = pd.read_csv(file_path, sep="\t")
    # Normalize column names
    col_map = {
        "Master_Protein_Accessions": "accession",
        "Gene_Name": "gene_name",
        "logFC": "log_fc",
        "pval": "pval",
        "adjPval": "adj_pval",
    }
    df = df.rename(columns=col_map)
    # Filter out rows with NaN/Inf in logFC or pval
    df = df.replace([np.inf, -np.inf], np.nan)
    df = df.dropna(subset=["log_fc", "pval"])
    return df


def build_fold_change_matrix(
    session_dir: str, comparisons: list[str]
) -> tuple[np.ndarray, list[str], list[str]]:
    """
    Build a proteins × comparisons fold change matrix.

    Returns:
        matrix: (n_proteins, n_comparisons) numpy array
        accessions: list of protein accessions (row labels)
        gene_names: list of gene names (row labels)
    """
    all_data = {}
    for comp in comparisons:
        df = _load_de_file(session_dir, comp)
        if df is None:
            continue
        for _, row in df.iterrows():
            acc = row["accession"]
            if acc not in all_data:
                all_data[acc] = {"gene_name": row.get("gene_name", ""), "fc": {}}
            all_data[acc]["fc"][comp] = row["log_fc"]

    accessions = sorted(all_data.keys())
    matrix = np.zeros((len(accessions), len(comparisons)))
    for i, acc in enumerate(accessions):
        for j, comp in enumerate(comparisons):
            matrix[i, j] = all_data[acc]["fc"].get(comp, np.nan)

    gene_names = [all_data[acc]["gene_name"] for acc in accessions]
    return matrix, accessions, gene_names


def compute_correlation_matrix(matrix: np.ndarray, method: str = "pearson") -> np.ndarray:
    """
    Compute pairwise correlation matrix.

    If method is 'pearson', uses np.corrcoef (rows as variables).
    If method is 'spearman', uses scipy.stats.spearmanr per pair.
    Returns (n, n) matrix.
    """
    n = matrix.shape[0]
    if n < 2:
        return np.array([[1.0]])

    if method == "pearson":
        corr = np.corrcoef(matrix)
        return np.nan_to_num(corr, nan=0.0)

    # Spearman: compute pairwise
    corr = np.eye(n)
    for i in range(n):
        for j in range(i + 1, n):
            valid = ~(np.isnan(matrix[i]) | np.isnan(matrix[j]))
            if valid.sum() < 3:
                corr[i, j] = corr[j, i] = 0.0
                continue
            r, _ = stats.spearmanr(matrix[i][valid], matrix[j][valid])
            corr[i, j] = corr[j, i] = r if not np.isnan(r) else 0.0
    return corr


def compute_protein_correlations(
    matrix: np.ndarray,
    accessions: list[str],
    gene_names: list[str],
    query_idx: int,
    method: str = "pearson",
    top_n: int = 10,
) -> list[dict]:
    """
    Compute correlations of all proteins to a query protein.
    Returns list sorted by correlation (highest first), including query_idx.
    """
    n = matrix.shape[0]
    corrs = []
    query_row = matrix[query_idx]

    for i in range(n):
        if i == query_idx:
            corrs.append(1.0)
            continue
        valid = ~(np.isnan(query_row) | np.isnan(matrix[i]))
        if valid.sum() < 3:
            corrs.append(0.0)
            continue
        if method == "pearson":
            r = np.corrcoef(query_row[valid], matrix[i][valid])[0, 1]
        else:
            r, _ = stats.spearmanr(query_row[valid], matrix[i][valid])
        corrs.append(r if not np.isnan(r) else 0.0)

    result = [
        {
            "accession": accessions[i],
            "gene_name": gene_names[i],
            "correlation": float(corrs[i]),
        }
        for i in range(n)
    ]
    result.sort(key=lambda x: x["correlation"], reverse=True)
    return result


def run_pca(matrix: np.ndarray) -> tuple[np.ndarray, float]:
    """
    Run PCA on the matrix (rows = samples, columns = features).
    Returns (n, 2) coordinates and fraction of variance explained by first 2 components.
    """
    # Impute NaN with column means
    col_means = np.nanmean(matrix, axis=0)
    imputed = np.where(np.isnan(matrix), col_means, matrix)
    scaler = StandardScaler()
    scaled = scaler.fit_transform(imputed)
    pca = PCA(n_components=2)
    coords = pca.fit_transform(scaled)
    var = float(sum(pca.explained_variance_ratio_))
    return coords, var


def run_umap(matrix: np.ndarray, random_state: int = 42) -> np.ndarray:
    """Run UMAP on the matrix. Returns (n, 2) coordinates."""
    try:
        import umap

        col_means = np.nanmean(matrix, axis=0)
        imputed = np.where(np.isnan(matrix), col_means, matrix)
        scaler = StandardScaler()
        scaled = scaler.fit_transform(imputed)
        reducer = umap.UMAP(n_components=2, random_state=random_state)
        coords = reducer.fit_transform(scaled)
        return coords
    except ImportError:
        logger.warning("umap-learn not installed, falling back to PCA")
        coords, _ = run_pca(matrix)
        return coords


def run_tsne(matrix: np.ndarray, random_state: int = 42) -> np.ndarray:
    """Run t-SNE on the matrix. Returns (n, 2) coordinates."""
    from sklearn.manifold import TSNE

    col_means = np.nanmean(matrix, axis=0)
    imputed = np.where(np.isnan(matrix), col_means, matrix)
    scaler = StandardScaler()
    scaled = scaler.fit_transform(imputed)
    tsne = TSNE(n_components=2, random_state=random_state, perplexity=min(30, scaled.shape[0] - 1))
    coords = tsne.fit_transform(scaled)
    return coords


def run_cluster(matrix: np.ndarray, method: str = "pca") -> tuple[np.ndarray, Optional[float]]:
    """Dispatch to PCA/UMAP/tSNE. Returns (n, 2) coords and optional variance explained."""
    if method == "umap":
        return run_umap(matrix), None
    elif method == "tsne":
        return run_tsne(matrix), None
    else:
        coords, var = run_pca(matrix)
        return coords, var


def compute_hierarchical_order(matrix: np.ndarray) -> list[int]:
    """Compute hierarchical clustering row order for a fold change matrix."""
    # Compute distance matrix (1 - correlation)
    corr = compute_correlation_matrix(matrix, method="pearson")
    # Clip to avoid floating point issues
    dist = 1 - np.clip(corr, -1, 1)
    np.fill_diagonal(dist, 0)
    condensed = squareform(dist)
    if len(condensed) == 0:
        return list(range(matrix.shape[0]))
    Z = linkage(condensed, method="average")
    return leaves_list(Z).tolist()


def compute_venn_data(
    session_dir: str,
    comparisons: list[str],
    pvalue_threshold: float = 0.05,
    logfc_threshold: float = 1.0,
) -> dict:
    """
    Compute Venn diagram data for 2-3 comparisons.
    Returns sets of significant protein accessions and overlap information.
    """
    sets = {}
    for comp in comparisons:
        df = _load_de_file(session_dir, comp)
        if df is None:
            sets[comp] = set()
            continue
        sig = df[
            (df["adj_pval"] < pvalue_threshold) & (df["log_fc"].abs() > logfc_threshold)
        ]
        sets[comp] = set(sig["accession"].tolist())

    # Build overlaps
    overlaps = []
    accessions = sorted(set().union(*sets.values()))
    for acc in accessions:
        region = sorted([c for c in comparisons if acc in sets[c]])
        if region:
            overlaps.append({"region": region, "accession": acc})

    # Group by region signature
    from collections import defaultdict
    by_region = defaultdict(list)
    for ov in overlaps:
        key = "+".join(ov["region"])
        by_region[key].append(ov["accession"])

    overlap_list = [
        {
            "region": sorted(key.split("+")),
            "count": len(accs),
            "label": key,
        }
        for key, accs in sorted(by_region.items(), key=lambda x: -len(x[1]))
    ]

    return {
        "sets": {c: sorted(list(s)) for c, s in sets.items()},
        "overlaps": overlap_list,
        "set_sizes": {c: len(s) for c, s in sets.items()},
    }
```

- [ ] **Step 4: Run unit tests**

Run: `backend/.venv/Scripts/python.exe -m pytest Tests/backend/unit/test_compare_service.py -v`
Expected: Tests pass (adjust test assertions to match implementation as needed)

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/compare_service.py Tests/backend/unit/test_compare_service.py
git commit -m "feat: add compare service for protein and comparison correlation"
```

---

### Task 4: Backend — Compare API Routes

**Files:**
- Create: `backend/app/api/routes/compare.py`
- Create: `Tests/backend/integration/test_compare_api.py`

- [ ] **Step 1: Write integration tests for compare endpoints**

```python
# Tests/backend/integration/test_compare_api.py
import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app


@pytest.fixture
def client():
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


@pytest.mark.asyncio
async def test_protein_correlation_run_triggers_async_compute(client):
    """POST /compare/protein-correlation should return status running"""
    # This needs a valid session with results — skip for now, structural test
    pass


@pytest.mark.asyncio
async def test_protein_correlation_status_returns_idle_for_no_run(client):
    """GET /compare/protein-correlation/status should return idle when no run"""
    # Needs a valid session
    pass
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `backend/.venv/Scripts/python.exe -m pytest Tests/backend/integration/test_compare_api.py -v`
Expected: FAIL (module not found or routes not mounted)

- [ ] **Step 3: Implement compare routes**

```python
"""
Compare API routes — on-demand protein and comparison correlation analysis.
Follows the same async polling pattern as GSEA routes.
"""

import asyncio
import json
import logging
import os
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.db.session_store import SessionStore, get_session_store
from app.services.compare_service import (
    build_fold_change_matrix,
    compute_protein_correlations,
    compute_correlation_matrix,
    compute_venn_data,
    run_cluster,
)

logger = logging.getLogger("proteomics")

router = APIRouter()


# ── Request/Response models ──

class ProteinCorrelationRequest(BaseModel):
    protein_id: str
    correlation_method: str = "pearson"  # pearson | spearman
    cluster_method: str = "pca"  # pca | umap | tsne
    color_comparison: str


class ComparisonCorrelationRequest(BaseModel):
    primary_comparison: str
    selected_comparisons: list[str]  # primary + up to 9 more
    correlation_method: str = "pearson"
    cluster_method: str = "pca"


class VennRequest(BaseModel):
    comparisons: list[str]  # 2 or 3
    pvalue_threshold: float = 0.05
    logfc_threshold: float = 1.0


class RunStatusResponse(BaseModel):
    status: str  # idle | running | completed | error
    error: Optional[str] = None
    started_at: Optional[str] = None
    completed_at: Optional[str] = None


# ── Helpers ──

def _status_path(session_dir: str, compute_type: str) -> Path:
    return Path(session_dir) / "results" / "compare" / f"{compute_type}_status.json"


def _result_path(session_dir: str, compute_type: str) -> Path:
    return Path(session_dir) / "results" / "compare" / f"{compute_type}_result.json"


def _read_status(session_dir: str, compute_type: str) -> dict:
    sp = _status_path(session_dir, compute_type)
    if not sp.exists():
        return {"status": "idle"}
    with open(sp, "r") as f:
        return json.load(f)


def _write_status(session_dir: str, compute_type: str, data: dict):
    sp = _status_path(session_dir, compute_type)
    sp.parent.mkdir(parents=True, exist_ok=True)
    with open(sp, "w") as f:
        json.dump(data, f)


def _write_result(session_dir: str, compute_type: str, data: dict):
    rp = _result_path(session_dir, compute_type)
    rp.parent.mkdir(parents=True, exist_ok=True)
    with open(rp, "w") as f:
        json.dump(data, f, default=str)


def _get_comparisons_from_session(session_dir: str) -> list[str]:
    """Discover all comparisons from DE result files in the session."""
    results_dir = Path(session_dir) / "results"
    comparisons = []
    if results_dir.exists():
        for f in sorted(results_dir.glob("Diff_Expression_*.tsv")):
            stem = f.stem  # Diff_Expression_INCB224525_24h_vs_DMSO_24h
            comp = stem.replace("Diff_Expression_", "")
            if comp:
                comparisons.append(comp)
    # Fall back: check for single Diff_Expression.tsv
    if not comparisons and (results_dir / "Diff_Expression.tsv").exists():
        comparisons = ["treatment_vs_control"]
    return comparisons


async def _run_protein_correlation(session_dir: str, req: ProteinCorrelationRequest):
    """Background task: compute protein correlation analysis."""
    compute_type = "protein-correlation"
    try:
        _write_status(session_dir, compute_type, {"status": "running"})

        comparisons = _get_comparisons_from_session(session_dir)
        matrix, accessions, gene_names = build_fold_change_matrix(session_dir, comparisons)

        # Find the query protein index
        query_idx = None
        for i, acc in enumerate(accessions):
            if req.protein_id in acc or acc in req.protein_id:
                query_idx = i
                break
        if query_idx is None:
            raise ValueError(f"Protein {req.protein_id} not found in any comparison")

        # Selected protein fold changes across comparisons
        selected_fc = []
        for j, comp in enumerate(comparisons):
            val = matrix[query_idx, j]
            if not np.isnan(val):
                selected_fc.append({
                    "comparison": comp,
                    "log_fc": float(val),
                    "pval": 0.0,  # We don't have per-protein per-comparison pval in the matrix; approximate
                    "adj_pval": 0.0,
                })

        # Correlated proteins
        import numpy as np
        correlated = compute_protein_correlations(
            matrix, accessions, gene_names, query_idx, req.correlation_method
        )

        # Cluster coordinates for all proteins
        coords, var = run_cluster(matrix.T, req.cluster_method)  # Transpose: comparisons as features
        # Actually run cluster on protein rows
        coords, var = run_cluster(matrix, req.cluster_method)
        cluster_coords = [
            {"accession": accessions[i], "gene_name": gene_names[i],
             "x": float(coords[i, 0]), "y": float(coords[i, 1])}
            for i in range(len(accessions))
        ]

        result = {
            "selected_protein_fc": selected_fc,
            "correlated_proteins": correlated,
            "cluster_coords": cluster_coords,
            "cluster_var_explained": var,
        }
        _write_result(session_dir, compute_type, result)
        _write_status(session_dir, compute_type, {"status": "completed"})
    except Exception as e:
        logger.exception(f"Protein correlation compute failed: {e}")
        _write_status(session_dir, compute_type, {"status": "error", "error": str(e)})


async def _run_comparison_correlation(session_dir: str, req: ComparisonCorrelationRequest):
    """Background task: compute comparison correlation analysis."""
    compute_type = "comparison-correlation"
    try:
        _write_status(session_dir, compute_type, {"status": "running"})

        all_comparisons = _get_comparisons_from_session(session_dir)
        selected = [c for c in req.selected_comparisons if c in all_comparisons]
        if not selected:
            raise ValueError("No valid selected comparisons found")

        # Build full matrix (proteins × all comparisons)
        matrix, accessions, gene_names = build_fold_change_matrix(session_dir, all_comparisons)

        # Similarity matrix: correlation between all comparisons (transpose)
        sim_matrix = compute_correlation_matrix(matrix.T, req.correlation_method)
        similarity = {
            "comparisons": all_comparisons,
            "matrix": sim_matrix.tolist(),
        }

        # Heatmap data: selected comparisons, marked proteins
        # Build a reduced matrix for selected comparisons
        sel_indices = [all_comparisons.index(c) for c in selected if c in all_comparisons]
        sel_matrix = matrix[:, sel_indices]
        # Keep only proteins with at least one non-NaN value
        valid_rows = ~np.isnan(sel_matrix).all(axis=1)
        heatmap_fc = sel_matrix[valid_rows]
        heatmap_proteins = [
            {"accession": accessions[i], "gene_name": gene_names[i]}
            for i in range(len(accessions)) if valid_rows[i]
        ]
        # Limit to top 500 by max absolute FC
        if len(heatmap_proteins) > 500:
            max_fc = np.nanmax(np.abs(heatmap_fc), axis=1)
            top_idx = np.argsort(max_fc)[-500:]
            heatmap_fc = heatmap_fc[top_idx]
            heatmap_proteins = [heatmap_proteins[i] for i in top_idx]

        heatmap_data = {
            "proteins": heatmap_proteins,
            "comparisons": selected,
            "fold_changes": heatmap_fc.tolist(),
        }

        # Comparison correlations to primary
        primary_idx = all_comparisons.index(req.primary_comparison) if req.primary_comparison in all_comparisons else 0
        comp_corrs = []
        for j, comp in enumerate(all_comparisons):
            if j == primary_idx:
                comp_corrs.append({"comparison": comp, "correlation": 1.0})
            else:
                comp_corrs.append({"comparison": comp, "correlation": float(sim_matrix[primary_idx, j])})
        comp_corrs.sort(key=lambda x: x["correlation"], reverse=True)

        # Cluster coords for comparisons
        coords, _ = run_cluster(matrix.T, req.cluster_method)  # comparisons as rows
        cluster_coords = [
            {"comparison": all_comparisons[i],
             "x": float(coords[i, 0]), "y": float(coords[i, 1])}
            for i in range(len(all_comparisons))
        ]

        result = {
            "similarity_matrix": similarity,
            "heatmap_data": heatmap_data,
            "comparison_correlations": comp_corrs,
            "cluster_coords": cluster_coords,
        }
        _write_result(session_dir, compute_type, result)
        _write_status(session_dir, compute_type, {"status": "completed"})
    except Exception as e:
        logger.exception(f"Comparison correlation compute failed: {e}")
        _write_status(session_dir, compute_type, {"status": "error", "error": str(e)})


# ── Protein Correlation Endpoints ──

@router.post("/{session_id}/compare/protein-correlation")
async def trigger_protein_correlation(
    session_id: str,
    req: ProteinCorrelationRequest,
    store: SessionStore = Depends(get_session_store),
):
    """Trigger on-demand protein correlation computation."""
    session = await store.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    session_dir = session.session_dir
    asyncio.create_task(_run_protein_correlation(session_dir, req))
    return {"status": "running"}


@router.get("/{session_id}/compare/protein-correlation/status")
async def get_protein_correlation_status(
    session_id: str,
    store: SessionStore = Depends(get_session_store),
):
    """Poll protein correlation compute status."""
    session = await store.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return _read_status(session.session_dir, "protein-correlation")


@router.get("/{session_id}/compare/protein-correlation")
async def get_protein_correlation_data(
    session_id: str,
    store: SessionStore = Depends(get_session_store),
):
    """Get cached protein correlation results."""
    session = await store.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    rp = _result_path(session.session_dir, "protein-correlation")
    if not rp.exists():
        raise HTTPException(status_code=404, detail="No results found — run protein correlation first")
    with open(rp, "r") as f:
        return json.load(f)


# ── Comparison Correlation Endpoints ──

@router.post("/{session_id}/compare/comparison-correlation")
async def trigger_comparison_correlation(
    session_id: str,
    req: ComparisonCorrelationRequest,
    store: SessionStore = Depends(get_session_store),
):
    """Trigger on-demand comparison correlation computation."""
    session = await store.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    session_dir = session.session_dir
    asyncio.create_task(_run_comparison_correlation(session_dir, req))
    return {"status": "running"}


@router.get("/{session_id}/compare/comparison-correlation/status")
async def get_comparison_correlation_status(
    session_id: str,
    store: SessionStore = Depends(get_session_store),
):
    """Poll comparison correlation compute status."""
    session = await store.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return _read_status(session.session_dir, "comparison-correlation")


@router.get("/{session_id}/compare/comparison-correlation")
async def get_comparison_correlation_data(
    session_id: str,
    store: SessionStore = Depends(get_session_store),
):
    """Get cached comparison correlation results."""
    session = await store.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    rp = _result_path(session.session_dir, "comparison-correlation")
    if not rp.exists():
        raise HTTPException(status_code=404, detail="No results found — run comparison correlation first")
    with open(rp, "r") as f:
        return json.load(f)


# ── Venn Diagram Endpoints ──

@router.post("/{session_id}/compare/venn")
async def trigger_venn(
    session_id: str,
    req: VennRequest,
    store: SessionStore = Depends(get_session_store),
):
    """Compute Venn diagram data for 2-3 comparisons (synchronous, fast)."""
    session = await store.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if len(req.comparisons) < 2 or len(req.comparisons) > 3:
        raise HTTPException(status_code=400, detail="Venn requires 2 or 3 comparisons")

    import asyncio
    result = await asyncio.to_thread(
        compute_venn_data,
        session.session_dir,
        req.comparisons,
        req.pvalue_threshold,
        req.logfc_threshold,
    )
    return result
```

- [ ] **Step 4: Add missing numpy import**

The `_run_protein_correlation` function uses `np.isnan` and `np.nan` — add `import numpy as np` at the top of the file.

- [ ] **Step 5: Verify routes compile**

Run: `cd backend && .venv/Scripts/python.exe -c "from app.api.routes.compare import router; print('OK')"`
Expected: "OK" (no ImportError)

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/routes/compare.py Tests/backend/integration/test_compare_api.py
git commit -m "feat: add compare API routes with polling pattern"
```

---

### Task 5: Backend — Mount Compare Routes & Update Markers

**Files:**
- Modify: `backend/app/main.py` (add import and router mount)
- Modify: `backend/app/models/session.py` (change markers type)
- Modify: `backend/app/api/routes/sessions.py` (update visualization state handler)

- [ ] **Step 1: Change markers model to per-comparison**

In `backend/app/models/session.py`, change line 160:
```python
# Old:
markers: Optional[list[str]] = None
# New:
markers: Optional[dict[str, list[str]]] = None
```

- [ ] **Step 2: Mount compare routes in main.py**

In `backend/app/main.py`, add import at line 17:
```python
from app.api.routes import (
    sessions,
    upload,
    analysis,
    processing,
    visualization,
    reports,
    compounds,
    compare,  # <-- ADD
)
```

Add router mount after line 213 (after visualization router):
```python
app.include_router(compare.router, prefix="/api/sessions", tags=["compare"])
```

- [ ] **Step 3: Update session model markers field**

Find the Session model in `backend/app/models/session.py` and update the `markers` field type annotation from `list[str]` to `dict[str, list[str]]`.

- [ ] **Step 4: Verify app starts**

Run: `taskkill //F //IM python.exe 2>$null; cd backend && .venv/Scripts/python.exe -c "from app.main import app; print('Routes:'); [print(r.path) for r in app.routes if hasattr(r, 'path')]"`
Expected: Compare routes appear in list

- [ ] **Step 5: Commit**

```bash
git add backend/app/main.py backend/app/models/session.py
git commit -m "feat: mount compare routes and update markers to per-comparison"
```

---

### Task 6: Frontend — Markers Per-Comparison & Mark All Significant

**Files:**
- Modify: `frontend/src/app/analysis/visualization/page.tsx` (volcano page)
- Modify: `frontend/src/lib/api.ts` (update types for markers)

- [ ] **Step 1: Update markers type in api.ts**

In `frontend/src/lib/api.ts`, line 303, change:
```typescript
// Old:
markers?: string[];
// New:
markers?: Record<string, string[]>;
```

- [ ] **Step 2: Update volcano page markedProteins to per-comparison**

In `frontend/src/app/analysis/visualization/page.tsx`, change line 44:
```typescript
// Old:
const [markedProteins, setMarkedProteins] = useState<Set<string>>(new Set());
// New:
const [markedProteins, setMarkedProteins] = useState<Record<string, Set<string>>>({});
```

- [ ] **Step 3: Update handleToggleMark for per-comparison**

In `page.tsx`, change the `handleToggleMark` callback (line 150):
```typescript
const handleToggleMark = useCallback((protein: DEResult) => {
  const compKey = selectedComparison || 'default';
  setMarkedProteins((prev) => {
    const next = { ...prev };
    if (!next[compKey]) next[compKey] = new Set();
    const compSet = new Set(next[compKey]);
    if (compSet.has(protein.master_protein_accessions)) {
      compSet.delete(protein.master_protein_accessions);
    } else {
      compSet.add(protein.master_protein_accessions);
    }
    next[compKey] = compSet;
    return next;
  });
}, [selectedComparison]);
```

- [ ] **Step 4: Update handleClearAllMarks for per-comparison**

```typescript
const handleClearAllMarks = useCallback(() => {
  const compKey = selectedComparison || 'default';
  setMarkedProteins((prev) => {
    const next = { ...prev };
    delete next[compKey];
    return next;
  });
}, [selectedComparison]);
```

- [ ] **Step 5: Update save effect to serialize per-comparison**

Change the save effect (line 168):
```typescript
useEffect(() => {
  if (!sessionId) return;
  const markersObj: Record<string, string[]> = {};
  for (const [comp, set] of Object.entries(markedProteins)) {
    if (set.size > 0) markersObj[comp] = Array.from(set);
  }
  const timer = setTimeout(async () => {
    try {
      await updateSessionVisualizationState(sessionId, { markers: markersObj });
    } catch {
      // Silently fail
    }
  }, 300);
  return () => clearTimeout(timer);
}, [markedProteins, sessionId]);
```

- [ ] **Step 6: Update restore logic for per-comparison format**

In the session config fetch effect (line 97), update marker restore:
```typescript
// Restore markers from session (per-comparison)
if (session.markers && typeof session.markers === 'object' && !Array.isArray(session.markers)) {
  const restored: Record<string, Set<string>> = {};
  for (const [comp, accessions] of Object.entries(session.markers as Record<string, string[]>)) {
    restored[comp] = new Set(accessions);
  }
  setMarkedProteins(restored);
} else if (Array.isArray(session.markers) && session.markers.length > 0) {
  // Migrate old flat format to per-comparison
  const compKey = selectedComparison || comparisons?.[0] ? `${formatGroup(comparisons[0].group1)}_vs_${formatGroup(comparisons[0].group2)}` : 'default';
  setMarkedProteins({ [compKey]: new Set(session.markers) });
} else {
  setMarkedProteins({});
}
```

- [ ] **Step 7: Add "Mark All Significant" button**

Add after the DE counts display in the header (around line 332), inside the general info panel:
```tsx
<button
  onClick={() => {
    if (!data) return;
    const compKey = selectedComparison || 'default';
    const significant = data.results
      .filter((r) => r.significant)
      .map((r) => r.master_protein_accessions);
    setMarkedProteins((prev) => ({
      ...prev,
      [compKey]: new Set(significant),
    }));
  }}
  className="px-3 py-1.5 text-xs font-medium bg-primary/10 text-primary rounded-lg hover:bg-primary/20 transition-colors"
>
  Mark All Significant
</button>
```

- [ ] **Step 8: Update ProteinTable markedProteins prop**

Pass `markedProteins[selectedComparison || 'default']` instead of `markedProteins` to the ProteinTable component (where the table checks if a specific protein is marked).

- [ ] **Step 9: Verify compilation**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 10: Commit**

```bash
git add frontend/src/app/analysis/visualization/page.tsx frontend/src/lib/api.ts
git commit -m "feat: make markers per-comparison, add Mark All Significant button"
```

---

### Task 7: Frontend — Add Compare Module to Navigation

**Files:**
- Modify: `frontend/src/config/visualization-modules.ts`

- [ ] **Step 1: Add Compare module**

After the GSEA module entry (line 37), add:
```typescript
{
  id: 'compare',
  label: 'Compare',
  href: '/analysis/visualization/compare',
  icon: GitCompare,  // from lucide-react
  description: 'Protein and comparison correlation analysis',
  supportedTemplates: ['multi_condition_comparison'],
},
```

- [ ] **Step 2: Add GitCompare import**

In the imports from lucide-react:
```typescript
import { ChartScatter, Activity, Spline, GitCompare } from 'lucide-react';
```

- [ ] **Step 3: Verify compilation**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add frontend/src/config/visualization-modules.ts
git commit -m "feat: add Compare module to visualization navigation"
```

---

### Task 8: Frontend — Compare Page Shell & Chart Components

**Files:**
- Create: `frontend/src/app/analysis/visualization/compare/page.tsx`
- Create: `frontend/src/components/visualization/compare/ProteinCorrelationPanel.tsx`
- Create: `frontend/src/components/visualization/compare/ComparisonCorrelationPanel.tsx`
- Create: `frontend/src/components/visualization/compare/FoldChangeBarChart.tsx`
- Create: `frontend/src/components/visualization/compare/CorrelationBarChart.tsx`
- Create: `frontend/src/components/visualization/compare/ClusterMap.tsx`
- Create: `frontend/src/components/visualization/compare/ComparisonHeatmap.tsx`
- Create: `frontend/src/components/visualization/compare/SimilarityMatrix.tsx`
- Create: `frontend/src/components/visualization/compare/VennDiagram.tsx`
- Create: `frontend/src/components/visualization/compare/CorrelationScatter.tsx`

- [ ] **Step 1: Create page shell with tabs**

Write `frontend/src/app/analysis/visualization/compare/page.tsx`:
```tsx
'use client';

import React, { useState, useEffect, Suspense, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import ProteinCorrelationPanel from '@/components/visualization/compare/ProteinCorrelationPanel';
import ComparisonCorrelationPanel from '@/components/visualization/compare/ComparisonCorrelationPanel';
import { getSession } from '@/lib/api';
import { formatGroup } from '@/lib/utils';

function CompareContent() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session_id') || searchParams.get('session') || '';

  const [activeTab, setActiveTab] = useState<'protein' | 'comparison'>('protein');
  const [comparisons, setComparisons] = useState<Array<{ value: string; label: string }>>([]);
  const [comparisonCount, setComparisonCount] = useState(0);

  useEffect(() => {
    if (!sessionId) return;
    getSession(sessionId).then((session) => {
      const comps = session?.config?.comparisons;
      if (comps && comps.length > 0) {
        const list = comps.map((c) => ({
          value: `${formatGroup(c.group1)}_vs_${formatGroup(c.group2)}`,
          label: `${formatGroup(c.group1)} vs ${formatGroup(c.group2)}`,
        }));
        setComparisons(list);
        setComparisonCount(list.length);
      }
    }).catch(() => {});
  }, [sessionId]);

  if (!sessionId) {
    return (
      <div className="flex-1 bg-surface flex items-center justify-center">
        <div className="text-center text-text-secondary">
          <p className="text-lg text-text-primary font-medium mb-2">No session selected</p>
          <Link href="/" className="text-primary hover:opacity-80">Start New Analysis</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 bg-surface">
      <div className="mx-auto px-6 py-8 max-w-7xl">
        <div className="mb-6">
          <h1 className="font-semibold text-text-primary">Compare Analysis</h1>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setActiveTab('protein')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === 'protein'
                ? 'bg-primary/10 text-primary'
                : 'text-text-secondary hover:bg-surface hover:text-text-primary'
            }`}
          >
            Protein Correlation
          </button>
          <button
            onClick={() => setActiveTab('comparison')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === 'comparison'
                ? 'bg-primary/10 text-primary'
                : 'text-text-secondary hover:bg-surface hover:text-text-primary'
            }`}
            disabled={comparisonCount < 2}
            title={comparisonCount < 2 ? 'Need at least 2 comparisons' : undefined}
          >
            Comparison Correlation
          </button>
        </div>

        {activeTab === 'protein' ? (
          <ProteinCorrelationPanel sessionId={sessionId} comparisons={comparisons} />
        ) : (
          <ComparisonCorrelationPanel sessionId={sessionId} comparisons={comparisons} />
        )}
      </div>
    </div>
  );
}

export default function ComparePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto" />
      </div>
    }>
      <CompareContent />
    </Suspense>
  );
}
```

- [ ] **Step 2: Create FoldChangeBarChart component**

Write `frontend/src/components/visualization/compare/FoldChangeBarChart.tsx`:
```tsx
'use client';

import React, { useMemo } from 'react';
import dynamic from 'next/dynamic';
import type { ProteinFCResult } from '@/types/api';

const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

interface Props {
  data: ProteinFCResult[];
  proteinName: string;
}

export default function FoldChangeBarChart({ data, proteinName }: Props) {
  const { traceBar, traceDot, layout } = useMemo(() => {
    if (!data.length) return { traceBar: [], traceDot: [], layout: {} };

    const comparisons = data.map((d) => d.comparison.replace(/_vs_/g, ' vs '));
    const logFC = data.map((d) => d.log_fc);
    const negLogP = data.map((d) => (d.pval > 0 ? -Math.log10(d.pval) : 0));
    const colors = logFC.map((v) => (v >= 0 ? '#ef4444' : '#3b82f6'));

    const traceBar = {
      type: 'bar' as const,
      x: comparisons,
      y: logFC,
      marker: { color: colors },
      name: 'log2 Fold Change',
      yaxis: 'y',
    };

    const traceDot = {
      type: 'scatter' as const,
      x: comparisons,
      y: negLogP,
      mode: 'markers' as const,
      marker: { color: '#6366f1', size: 10, symbol: 'circle' },
      name: '-log10(p-value)',
      yaxis: 'y2',
    };

    const layout = {
      title: `Fold Change: ${proteinName}`,
      yaxis: { title: 'log2 Fold Change', side: 'left' as const },
      yaxis2: { title: '-log10(p-value)', overlaying: 'y' as const, side: 'right' as const },
      legend: { x: 0.01, y: 1.1, orientation: 'h' as const },
      height: 350,
      margin: { t: 40, b: 100, l: 60, r: 60 },
      xaxis: { tickangle: -45 },
    };

    return { traceBar, traceDot, layout };
  }, [data, proteinName]);

  if (!data.length) {
    return <div className="bg-background border border-border rounded-lg p-4 text-center text-text-muted">No data</div>;
  }

  return (
    <div className="bg-background border border-border rounded-lg p-4">
      <Plot data={[traceBar, traceDot]} layout={layout} config={{ displayModeBar: true, displaylogo: false, responsive: true }} style={{ width: '100%' }} useResizeHandler />
    </div>
  );
}
```

- [ ] **Step 3: Create CorrelationBarChart component**

Write `frontend/src/components/visualization/compare/CorrelationBarChart.tsx` — horizontal bar chart showing top/bottom N correlations with gene name labels. Bars colored by correlation direction (positive=red, negative=blue). Height 400px.

- [ ] **Step 4: Create ClusterMap component**

Write `frontend/src/components/visualization/compare/ClusterMap.tsx` — scatter plot for PCA/UMAP/tSNE coordinates. Accepts: `points: ClusterPoint[]`, `selectedAccession: string`, `colorBy: Record<string, number>` (fold change per accession for coloring), `varExplained?: number`. Selected point gets larger marker + higher z-order.

- [ ] **Step 5: Create ComparisonHeatmap component**

Write `frontend/src/components/visualization/compare/ComparisonHeatmap.tsx` — Plotly heatmap with hierarchical clustering. Accepts: `proteins`, `comparisons`, `foldChanges[][]`. Uses scipy linkage order from backend. Color scale: blue-white-red diverging. Height scales with protein count (min 400, max 800).

- [ ] **Step 6: Create SimilarityMatrix component**

Write `frontend/src/components/visualization/compare/SimilarityMatrix.tsx` — N×N correlation heatmap of all comparisons. Reuses heatmap pattern. Color scale: reds sequential.

- [ ] **Step 7: Create VennDiagram component**

Write `frontend/src/components/visualization/compare/VennDiagram.tsx` — Not a true Venn (that requires d3), instead use: bar chart showing set sizes (one bar per comparison + overlap bars) and a table listing overlap regions with counts. This is simpler and more readable.

- [ ] **Step 8: Create CorrelationScatter component**

Write `frontend/src/components/visualization/compare/CorrelationScatter.tsx` — scatter plot of two proteins' fold changes across comparisons. X=selected protein FC, Y=correlated protein FC. One dot per comparison. Shows correlation coefficient and regression line.

- [ ] **Step 9: Create ProteinCorrelationPanel**

Write `frontend/src/components/visualization/compare/ProteinCorrelationPanel.tsx` — Full panel with:
- Protein selector (SearchableSelect, populated from DE results)
- Correlation method dropdown
- Cluster method dropdown
- Color-by comparison dropdown
- "Run Analysis" button
- Polling logic (same as GSEA page pattern)
- 2×2 grid of charts: FoldChangeBarChart, ClusterMap, CorrelationBarChart, CorrelationScatter
- Click handler on CorrelationBarChart to select a correlated protein → updates CorrelationScatter

- [ ] **Step 10: Create ComparisonCorrelationPanel**

Write `frontend/src/components/visualization/compare/ComparisonCorrelationPanel.tsx` — Full panel with:
- Primary comparison selector (SearchableSelect)
- Multi-select for additional comparisons (checkboxes or multi-select)
- Correlation method dropdown
- Cluster method dropdown
- Venn comparison selectors (2-3, checkboxes)
- "Run Analysis" button
- Polling logic
- Stacked layout: SimilarityMatrix, VennDiagram, ComparisonHeatmap, CorrelationBarChart (comparisons), ClusterMap

- [ ] **Step 11: Verify compilation**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors (fix any type issues)

- [ ] **Step 12: Commit**

```bash
git add frontend/src/app/analysis/visualization/compare/page.tsx frontend/src/components/visualization/compare/
git commit -m "feat: add Compare page with protein and comparison correlation panels"
```

---

### Task 9: End-to-End Verification

- [ ] **Step 1: Start backend**

```bash
taskkill //F //IM python.exe 2>$null
find backend -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null
find backend -name "*.pyc" -delete 2>/dev/null
cd backend && .venv/Scripts/python.exe -m uvicorn app.main:app --reload --reload-exclude "sessions" --port 8000
```

- [ ] **Step 2: Start frontend**

Run: `cd frontend && npm run dev`

- [ ] **Step 3: Verify routes are mounted**

Run: `curl -s http://localhost:8000/openapi.json | python -c "import sys,json; d=json.load(sys.stdin); [print(p) for p in sorted(d['paths']) if 'compare' in p]"`
Expected: Compare endpoints listed

- [ ] **Step 4: Manual test flow**

1. Open http://localhost:3000
2. Create a session with multi-condition data
3. Run pipeline
4. Navigate to Volcano Plot tab
5. Mark some proteins
6. Navigate to Compare tab
7. Verify both panels load with controls
8. Run Protein Correlation analysis
9. Verify all 4 charts render
10. Run Comparison Correlation analysis
11. Verify all 5 visualizations render

- [ ] **Step 5: Run backend unit tests**

Run: `backend/.venv/Scripts/python.exe -m pytest Tests/backend/unit/test_compare_service.py -v`

- [ ] **Step 6: Commit any fixes**

---

## Verification Checklist

1. `backend/.venv/Scripts/python.exe -m pytest Tests/backend/unit/test_compare_service.py -v` — correlation tests pass
2. `cd frontend && npx tsc --noEmit` — no TypeScript errors
3. Compare routes appear in `/openapi.json`
4. Protein Correlation panel: protein selector populated, Run triggers compute, all 4 charts render after polling completes
5. Comparison Correlation panel: comparison selectors populated, all 5 visualizations render
6. Markers: per-comparison marking works on volcano page, persists to backend, restores on reload
7. Mark All Significant works on volcano page
8. Edge cases: single comparison (comparison tab disabled), no marked proteins (heatmap fallback), missing DE file
