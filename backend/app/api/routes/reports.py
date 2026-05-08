"""
Report API routes -- self-contained report viewing endpoints.

Replaces the old ZIP-based export flow with read-only endpoints that
serve data directly from report directories.  The session-scoped
``router`` (mounted at ``/api/sessions``) is used for the generate
endpoint; the ``global_router`` (mounted at ``/api``) serves all
/reports/{report_id}/... endpoints.

Key pattern: every endpoint validates the report exists via
``get_report_dir()``, then reads data from the report directory.
On-demand compute features (GSEA run, BioNet run, compare run) are
stubs for now.
"""

import asyncio
import json
import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, Request

from app.services.report_store import (
    create_report,
    list_reports,
    get_report_dir,
    get_report_metadata,
    get_report_session,
    patch_report_state,
    delete_report,
)
from app.services.report_generator import generate_report

logger = logging.getLogger("proteomics")

router = APIRouter()          # Session-scoped:  mounted at /api/sessions
global_router = APIRouter()   # Global:          mounted at /api


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_report_dir_or_404(report_id: str) -> Path:
    """Return the report directory or raise 404."""
    d = get_report_dir(report_id)
    if d is None:
        raise HTTPException(status_code=404, detail="Report not found")
    return d


def _get_comparisons(results_dir: Path) -> list[str]:
    """Discover comparisons from per-comparison DE result files."""
    comps: list[str] = []
    if results_dir.is_dir():
        for f in sorted(results_dir.glob("Diff_Expression_*.tsv")):
            stem = f.stem
            c = stem.replace("Diff_Expression_", "")
            if c:
                comps.append(c)
    return comps


def _build_sample_filter_from_session(
    session_data: dict | None, comparison: str
) -> list[str] | None:
    """Replicate visualization._build_sample_filter logic."""
    if not session_data or not comparison:
        return None
    comparisons = (session_data.get("config") or {}).get("comparisons", [])
    for comp in comparisons:
        g1 = comp.get("group1", {})
        g2 = comp.get("group2", {})
        g1_str = "+".join(g1.values())
        g2_str = "+".join(g2.values())
        if f"{g1_str}_vs_{g2_str}" == comparison:
            return list(g1.values()) + list(g2.values())
    return None


# ---------------------------------------------------------------------------
# Session-scoped:  POST /api/sessions/{session_id}/reports/generate
# ---------------------------------------------------------------------------

@router.post("/{session_id}/reports/generate")
async def generate_report_endpoint(session_id: str, request: Request):
    """Generate a self-contained report from a completed session."""
    body = await request.json()
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Report name is required")

    metadata = create_report(name=name, session_id=session_id, session_name="")
    try:
        generate_report(session_id, metadata["report_id"])
    except ValueError as e:
        delete_report(metadata["report_id"])
        raise HTTPException(status_code=400, detail=str(e))

    # Update session_name from the session.json that was just copied in
    report_dir = get_report_dir(metadata["report_id"])
    if report_dir is not None:
        session_json_path = report_dir / "session.json"
        if session_json_path.exists():
            session_data = json.loads(session_json_path.read_text(encoding="utf-8"))
            metadata["session_name"] = session_data.get("name", "")
            (report_dir / "report.json").write_text(
                json.dumps(metadata, indent=2), encoding="utf-8"
            )

    return {
        "report_id": metadata["report_id"],
        "name": metadata["name"],
        "weblink": f"/reports/{metadata['report_id']}",
        "created_at": metadata["created_at"],
    }


# ---------------------------------------------------------------------------
# Global list / get / delete
# ---------------------------------------------------------------------------

@global_router.get("/reports")
async def get_reports():
    """List all reports."""
    return {"reports": list_reports()}


@global_router.get("/reports/{report_id}")
async def get_report_meta(report_id: str):
    """Return report metadata and the embedded session.json."""
    _get_report_dir_or_404(report_id)
    return {
        "report": get_report_metadata(report_id) or {},
        "session": get_report_session(report_id) or {},
    }


@global_router.delete("/reports/{report_id}")
async def delete_report_endpoint(report_id: str):
    """Delete a report."""
    if not delete_report(report_id):
        raise HTTPException(status_code=404, detail="Report not found")
    return {"message": "Report deleted"}


# ---------------------------------------------------------------------------
# Differential expression results
# ---------------------------------------------------------------------------

@global_router.get("/reports/{report_id}/results")
async def get_report_results(
    report_id: str,
    comparison: str = Query(""),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=20000),
    sort_by: str = Query("adj_pvalue"),
    sort_order: str = Query("asc"),
    significant_only: bool = Query(False),
    search: str = Query(""),
):
    """Get paginated DE results from a report."""
    report_dir = _get_report_dir_or_404(report_id)
    results_dir = report_dir / "results"

    from app.api.routes.visualization import create_response, load_diff_expression_results

    all_results = await load_diff_expression_results(results_dir, report_id, comparison)

    if significant_only:
        all_results = [r for r in all_results if r["significant"]]

    if search:
        q = search.lower()
        all_results = [
            r
            for r in all_results
            if q in r.get("master_protein_accessions", "").lower()
            or q in r.get("gene_name", "").lower()
        ]

    reverse = sort_order.lower() == "desc"
    all_results.sort(key=lambda x: x.get(sort_by, 0) or 0, reverse=reverse)

    total = len(all_results)
    start = (page - 1) * page_size
    end = start + page_size

    return create_response({
        "results": all_results[start:end],
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size if total else 0,
        "total_proteins": total,
        "significant_proteins": sum(1 for r in all_results if r.get("significant", False)),
        "upregulated": sum(1 for r in all_results if r.get("significant", False) and r.get("log_fc", 0) > 0),
        "downregulated": sum(1 for r in all_results if r.get("significant", False) and r.get("log_fc", 0) < 0),
    })


# ---------------------------------------------------------------------------
# QC plots
# ---------------------------------------------------------------------------

@global_router.get("/reports/{report_id}/qc/plots")
async def get_report_qc_plots(report_id: str):
    """Get QC plot data."""
    report_dir = _get_report_dir_or_404(report_id)
    results_dir = report_dir / "results"

    from app.api.routes.visualization import create_response, load_qc_results

    qc_data = await asyncio.to_thread(load_qc_results, results_dir)
    return create_response(qc_data)


# ---------------------------------------------------------------------------
# GSEA -- status / run / data / plot / heatmap
# ---------------------------------------------------------------------------

@global_router.get("/reports/{report_id}/gsea/status")
async def get_report_gsea_status(report_id: str):
    """Read GSEA run status from the report's gsea_run_status.json."""
    report_dir = _get_report_dir_or_404(report_id)
    p = report_dir / "gsea_run_status.json"
    if not p.exists():
        return {"status": "idle"}
    return json.loads(p.read_text(encoding="utf-8"))


@global_router.post("/reports/{report_id}/gsea/run")
async def run_report_gsea(report_id: str):
    """Run GSEA on report data (stub -- not yet implemented)."""
    raise HTTPException(status_code=501, detail="Not yet implemented")


@global_router.get("/reports/{report_id}/gsea/{database}")
async def get_report_gsea_results(
    report_id: str,
    database: str,
    comparison: str = Query(""),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=1000),
    sort_by: str = Query("nes"),
    sort_order: str = Query("desc"),
    significant_only: bool = Query(False),
    search: str = Query(""),
):
    """Get paginated GSEA results for a database."""
    report_dir = _get_report_dir_or_404(report_id)
    base_results_dir = report_dir / "results"
    results_dir = base_results_dir / "gsea" / comparison if comparison else base_results_dir

    from app.api.routes.visualization import create_response, load_gsea_results, VALID_GSEA_DATABASES

    if database not in VALID_GSEA_DATABASES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid GSEA database: {database}",
        )

    gsea_data = await asyncio.to_thread(load_gsea_results, results_dir, database, report_id)
    if not gsea_data.get("results") and comparison:
        gsea_data = await asyncio.to_thread(load_gsea_results, base_results_dir, database, report_id)

    results = gsea_data.pop("results")

    if significant_only:
        results = [r for r in results if r.get("significant", False)]

    if search:
        q = search.lower()
        results = [
            r
            for r in results
            if q in r.get("name", "").lower() or q in r.get("term", "").lower()
        ]

    reverse = sort_order.lower() == "desc"
    sort_key = sort_by if sort_by in ("nes", "pval", "fdr", "matched_genes") else "nes"
    results.sort(key=lambda x: x.get(sort_key, 0) or 0, reverse=reverse)

    total = len(results)
    start = (page - 1) * page_size
    end = start + page_size

    gsea_data["results"] = results[start:end]
    gsea_data["page"] = page
    gsea_data["page_size"] = page_size
    gsea_data["total"] = total

    return create_response(gsea_data)


@global_router.get("/reports/{report_id}/gsea/{database}/plot")
async def get_report_gsea_plot(
    report_id: str,
    database: str,
    term: str = Query(...),
    comparison: str = Query(""),
):
    """Get GSEA enrichment plot data for a specific pathway."""
    report_dir = _get_report_dir_or_404(report_id)
    base_results_dir = report_dir / "results"
    results_dir = base_results_dir / "gsea" / comparison if comparison else base_results_dir

    from app.api.routes.visualization import create_response, load_gsea_results, VALID_GSEA_DATABASES

    if database not in VALID_GSEA_DATABASES:
        raise HTTPException(status_code=400, detail=f"Invalid GSEA database: {database}")

    gsea_data = await asyncio.to_thread(load_gsea_results, results_dir, database, report_id)
    if not gsea_data.get("results") and comparison:
        gsea_data = await asyncio.to_thread(load_gsea_results, base_results_dir, database, report_id)

    pathway = next(
        (r for r in gsea_data.get("results", []) if r.get("term") == term),
        None,
    )
    if pathway is None:
        raise HTTPException(status_code=404, detail=f"Pathway '{term}' not found in {database}")

    return create_response({
        "term": term,
        "es": pathway.get("es", 0),
        "nes": pathway.get("nes", 0),
    })


@global_router.get("/reports/{report_id}/gsea/{database}/heatmap")
async def get_report_gsea_heatmap(
    report_id: str,
    database: str,
    term: str = Query(...),
    comparison: str = Query(""),
):
    """Get GSEA heatmap data (z-scores for leading-edge genes)."""
    report_dir = _get_report_dir_or_404(report_id)
    base_results_dir = report_dir / "results"
    results_dir = base_results_dir / "gsea" / comparison if comparison else base_results_dir

    from app.api.routes.visualization import (
        create_response,
        load_gsea_results,
        VALID_GSEA_DATABASES,
        gsea_service,
    )

    if database not in VALID_GSEA_DATABASES:
        raise HTTPException(status_code=400, detail=f"Invalid GSEA database: {database}")

    gsea_data = await asyncio.to_thread(load_gsea_results, results_dir, database, report_id)
    if not gsea_data.get("results") and comparison:
        gsea_data = await asyncio.to_thread(load_gsea_results, base_results_dir, database, report_id)

    pathway = next(
        (r for r in gsea_data.get("results", []) if r.get("term") == term),
        None,
    )
    if pathway is None:
        raise HTTPException(status_code=404, detail=f"Pathway '{term}' not found in {database}")

    lead_genes = pathway.get("lead_genes", [])
    if not lead_genes:
        return create_response({"genes": [], "samples": [], "z_scores": []})

    import pandas as pd

    protein_file = base_results_dir / "Protein_Abundances.tsv"
    if not protein_file.exists():
        return create_response({"genes": [], "samples": [], "z_scores": []})

    try:
        protein_df = await asyncio.to_thread(pd.read_csv, protein_file, sep="\t")
    except Exception:
        return create_response({"genes": [], "samples": [], "z_scores": []})

    heatmap_data = gsea_service.generate_heatmap_data(protein_df, lead_genes)
    if heatmap_data is None:
        return create_response({"genes": [], "samples": [], "z_scores": []})

    return create_response(heatmap_data)


# ---------------------------------------------------------------------------
# BioNet -- run / status / subnetwork
# ---------------------------------------------------------------------------

@global_router.post("/reports/{report_id}/bionet/run")
async def run_report_bionet(report_id: str):
    """Run BioNet on report data (stub -- not yet implemented)."""
    raise HTTPException(status_code=501, detail="Not yet implemented")


@global_router.get("/reports/{report_id}/bionet/status")
async def get_report_bionet_status(report_id: str):
    """Read BioNet run status from the report."""
    report_dir = _get_report_dir_or_404(report_id)
    p = report_dir / "bionet" / "bionet_status.json"
    if not p.exists():
        return {"status": "idle"}
    return json.loads(p.read_text(encoding="utf-8"))


@global_router.get("/reports/{report_id}/bionet/subnetwork")
async def get_report_bionet_subnetwork(report_id: str):
    """Return the BioNet subnetwork JSON."""
    report_dir = _get_report_dir_or_404(report_id)
    p = report_dir / "bionet" / "bionet_subnetwork.json"
    if not p.exists():
        raise HTTPException(status_code=404, detail="No BioNet subnetwork available")
    return json.loads(p.read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# Protein abundance / peptide
# ---------------------------------------------------------------------------

@global_router.get("/reports/{report_id}/protein/{protein_id}/abundance")
async def get_report_protein_abundance(
    report_id: str,
    protein_id: str,
    comparison: str = Query(""),
):
    """Get protein abundance data, optionally filtered by comparison."""
    report_dir = _get_report_dir_or_404(report_id)
    results_dir = report_dir / "results"
    session_data = get_report_session(report_id)
    sample_filter = _build_sample_filter_from_session(session_data, comparison)

    from app.api.routes.visualization import create_response, load_protein_abundance

    data = await load_protein_abundance(
        results_dir,
        protein_id,
        report_id,
        sample_filter=sample_filter,
    )
    return create_response(data)


@global_router.get("/reports/{report_id}/protein/{protein_id}/peptide")
async def get_report_protein_peptide(
    report_id: str,
    protein_id: str,
    comparison: str = Query(""),
):
    """Get peptide abundance data for a protein."""
    report_dir = _get_report_dir_or_404(report_id)
    results_dir = report_dir / "results"
    session_data = get_report_session(report_id)
    sample_filter = _build_sample_filter_from_session(session_data, comparison)

    from app.api.routes.visualization import create_response, load_peptide_abundance

    data = await load_peptide_abundance(
        results_dir,
        protein_id,
        report_id,
        sample_filter=sample_filter,
    )
    return create_response(data)


# ---------------------------------------------------------------------------
# Compare -- protein-correlation / comparison-correlation / venn / proteins
# ---------------------------------------------------------------------------

@global_router.post("/reports/{report_id}/compare/protein-correlation")
async def run_report_protein_correlation(report_id: str):
    """Run protein-correlation analysis (stub -- not yet implemented)."""
    raise HTTPException(status_code=501, detail="Not yet implemented")


@global_router.get("/reports/{report_id}/compare/protein-correlation/status")
async def get_report_protein_correlation_status(report_id: str):
    """Read protein-correlation run status."""
    report_dir = _get_report_dir_or_404(report_id)
    p = report_dir / "results" / "compare" / "protein-correlation_status.json"
    if not p.exists():
        return {"status": "idle"}
    return json.loads(p.read_text(encoding="utf-8"))


@global_router.get("/reports/{report_id}/compare/protein-correlation")
async def get_report_protein_correlation_results(report_id: str):
    """Return protein-correlation results."""
    report_dir = _get_report_dir_or_404(report_id)
    p = report_dir / "results" / "compare" / "protein-correlation_result.json"
    if not p.exists():
        raise HTTPException(status_code=404, detail="No protein correlation results available")
    return json.loads(p.read_text(encoding="utf-8"))


@global_router.post("/reports/{report_id}/compare/comparison-correlation")
async def run_report_comparison_correlation(report_id: str):
    """Run comparison-correlation analysis (stub -- not yet implemented)."""
    raise HTTPException(status_code=501, detail="Not yet implemented")


@global_router.get("/reports/{report_id}/compare/comparison-correlation/status")
async def get_report_comparison_correlation_status(report_id: str):
    """Read comparison-correlation run status."""
    report_dir = _get_report_dir_or_404(report_id)
    p = report_dir / "results" / "compare" / "comparison-correlation_status.json"
    if not p.exists():
        return {"status": "idle"}
    return json.loads(p.read_text(encoding="utf-8"))


@global_router.get("/reports/{report_id}/compare/comparison-correlation")
async def get_report_comparison_correlation_results(report_id: str):
    """Return comparison-correlation results."""
    report_dir = _get_report_dir_or_404(report_id)
    p = report_dir / "results" / "compare" / "comparison-correlation_result.json"
    if not p.exists():
        raise HTTPException(status_code=404, detail="No comparison correlation results available")
    return json.loads(p.read_text(encoding="utf-8"))


@global_router.post("/reports/{report_id}/compare/venn")
async def run_report_venn(report_id: str):
    """Compute Venn diagram data (stub -- not yet implemented)."""
    raise HTTPException(status_code=501, detail="Not yet implemented")


@global_router.get("/reports/{report_id}/compare/proteins")
async def get_report_compare_proteins(report_id: str):
    """List all proteins across all comparisons."""
    report_dir = _get_report_dir_or_404(report_id)
    results_dir = report_dir / "results"
    comparisons = _get_comparisons(results_dir)
    if not comparisons:
        return []

    from app.services.compare_service import build_fold_change_matrix

    def _load():
        matrix, accessions, gene_names = build_fold_change_matrix(
            str(report_dir), comparisons
        )
        return [
            {"accession": acc, "gene_name": gn}
            for acc, gn in zip(accessions, gene_names)
        ]

    return await asyncio.to_thread(_load)


# ---------------------------------------------------------------------------
# Visualization state
# ---------------------------------------------------------------------------

@global_router.patch("/reports/{report_id}/visualization-state")
async def patch_report_visualization_state(report_id: str, request: Request):
    """Update markers and/or volcano filters in the report's session.json."""
    body = await request.json()
    markers = body.get("markers")
    volcano_filters = body.get("volcano_filters")

    if not patch_report_state(report_id, markers=markers, volcano_filters=volcano_filters):
        raise HTTPException(status_code=404, detail="Report not found")

    return {"message": "Visualization state updated"}
