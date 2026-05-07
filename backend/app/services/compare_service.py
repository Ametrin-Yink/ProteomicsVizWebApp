"""
Compare service -- on-demand protein and comparison correlation analysis.

All computation is synchronous (called via asyncio.to_thread from routes).
"""

import json
import logging
import re
from collections import defaultdict
from pathlib import Path
from typing import Optional

from app.core.config import settings

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


def _status_path(session_id: str, compute_type: str) -> Path:
    return settings.sessions_dir / session_id / "results" / "compare" / f"{compute_type}_status.json"


def _result_path(session_id: str, compute_type: str) -> Path:
    return settings.sessions_dir / session_id / "results" / "compare" / f"{compute_type}_result.json"


def _read_status(session_id: str, compute_type: str) -> dict:
    sp = _status_path(session_id, compute_type)
    if not sp.exists():
        return {"status": "idle"}
    with open(sp, "r") as f:
        return json.load(f)


def _write_status(session_id: str, compute_type: str, data: dict):
    sp = _status_path(session_id, compute_type)
    sp.parent.mkdir(parents=True, exist_ok=True)
    with open(sp, "w") as f:
        json.dump(data, f)


def _write_result(session_id: str, compute_type: str, data: dict):
    rp = _result_path(session_id, compute_type)
    rp.parent.mkdir(parents=True, exist_ok=True)
    with open(rp, "w") as f:
        json.dump(data, f, default=str)


def load_pvalues_for_protein(
    session_dir: str, comparisons: list[str], protein_id: str, accessions: list[str]
) -> dict[str, dict[str, float]]:
    """
    Load pval and adj_pval for a specific protein across all comparisons.
    Returns dict keyed by comparison with 'pval' and 'adj_pval'.
    """
    result = {}
    for comp in comparisons:
        df = _load_de_file(session_dir, comp)
        if df is None:
            continue
        # Match protein_id against accessions (handles multi-ID like "P00367; P49448")
        match = df[df["accession"].str.contains(re.escape(protein_id), na=False, regex=True)]
        if len(match) > 0:
            result[comp] = {
                "pval": float(match.iloc[0]["pval"]),
                "adj_pval": float(match.iloc[0].get("adj_pval", 1.0)),
            }
    return result


def build_fold_change_matrix(
    session_dir: str, comparisons: list[str]
) -> tuple[np.ndarray, list[str], list[str]]:
    """
    Build a proteins x comparisons fold change matrix.

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


def compute_similarity_matrix(matrix: np.ndarray) -> np.ndarray:
    """
    Compute pairwise Euclidean distance matrix (n x n).
    Entry (i,j) = RMSD between protein i and protein j.
    Lower = more similar.
    """
    n = matrix.shape[0]
    if n < 2:
        return np.array([[0.0]])
    if matrix.shape[1] < 3:
        return np.full((n, n), np.nan)

    dist = np.zeros((n, n))
    for i in range(n):
        for j in range(i + 1, n):
            valid = ~(np.isnan(matrix[i]) | np.isnan(matrix[j]))
            if valid.sum() < 3:
                dist[i, j] = dist[j, i] = np.nan
            else:
                diff = matrix[i][valid] - matrix[j][valid]
                d = np.sqrt(np.mean(diff ** 2))
                dist[i, j] = dist[j, i] = d
    return dist


def compute_protein_similarities(
    matrix: np.ndarray,
    accessions: list[str],
    gene_names: list[str],
    comparisons: list[str],
    query_idx: int,
    top_n: int = 10,
) -> list[dict]:
    """
    Compute fold-change similarity (Euclidean distance) to a query protein.
    Lower distance = more similar. Returns top_n most similar + top_n most dissimilar.
    Each entry includes fold_changes for the scatter plot.
    """
    n = matrix.shape[0]
    query_row = matrix[query_idx]
    distances = []

    for i in range(n):
        if i == query_idx:
            distances.append(0.0)
            continue
        valid = ~(np.isnan(query_row) | np.isnan(matrix[i]))
        if valid.sum() < 3:
            distances.append(np.inf)
            continue
        diff = query_row[valid] - matrix[i][valid]
        rmsd = float(np.sqrt(np.mean(diff ** 2)))
        distances.append(rmsd)

    # Build light entries, sort, then enrich only the top/bottom N with fold_changes
    result = [
        {"idx": i, "accession": accessions[i], "gene_name": gene_names[i], "similarity": distances[i]}
        for i in range(n)
    ]
    result.sort(key=lambda x: x["similarity"])
    result = [r for r in result if r["similarity"] != float('inf')]
    most_similar = result[:top_n + 1]
    most_dissimilar = result[-top_n:] if len(result) > top_n + 1 else []
    candidates = most_similar + most_dissimilar

    for entry in candidates:
        i = entry.pop("idx")
        entry["fold_changes"] = [
            {"comparison": comp, "log_fc": float(matrix[i, j]) if not np.isnan(matrix[i, j]) else None}
            for j, comp in enumerate(comparisons)
        ]

    return candidates


def run_pca(matrix: np.ndarray) -> tuple[np.ndarray, list[float]]:
    """Run PCA, returns (n, 2) coords and per-component variance ratios."""
    col_means = np.nanmean(matrix, axis=0)
    imputed = np.where(np.isnan(matrix), col_means, matrix)
    scaler = StandardScaler()
    scaled = scaler.fit_transform(imputed)
    pca = PCA(n_components=2)
    coords = pca.fit_transform(scaled)
    var = [float(v) for v in pca.explained_variance_ratio_]
    return coords, var


def run_umap(matrix: np.ndarray, random_state: int = 42) -> np.ndarray:
    """Run UMAP. Falls back to PCA if umap-learn not installed."""
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
    """Run t-SNE."""
    from sklearn.manifold import TSNE
    col_means = np.nanmean(matrix, axis=0)
    imputed = np.where(np.isnan(matrix), col_means, matrix)
    scaler = StandardScaler()
    scaled = scaler.fit_transform(imputed)
    tsne = TSNE(n_components=2, random_state=random_state, perplexity=min(30, scaled.shape[0] - 1))
    coords = tsne.fit_transform(scaled)
    return coords


def run_cluster(matrix: np.ndarray, method: str = "pca") -> tuple[np.ndarray, Optional[list[float]]]:
    """Dispatch to PCA/UMAP/tSNE. Returns coords and per-component variance (PCA only)."""
    if method == "umap":
        return run_umap(matrix), None
    elif method == "tsne":
        return run_tsne(matrix), None
    else:
        coords, var = run_pca(matrix)
        return coords, var


def compute_hierarchical_order(matrix: np.ndarray) -> list[int]:
    """Compute hierarchical clustering row order for a fold change matrix using Euclidean distance."""
    dist = compute_similarity_matrix(matrix)
    dist = np.nan_to_num(dist, nan=np.nanmax(dist[~np.isnan(dist)]) * 2 if np.any(~np.isnan(dist)) else 1.0)
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
    """Compute Venn diagram data for 2-3 comparisons."""
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

    overlaps = []
    accessions = sorted(set().union(*sets.values()))
    for acc in accessions:
        region = sorted([c for c in comparisons if acc in sets[c]])
        if region:
            overlaps.append({"region": region, "accession": acc})

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
