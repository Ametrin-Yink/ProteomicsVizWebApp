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
from datetime import datetime, timezone
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

router = APIRouter()  # Session-scoped:  mounted at /api/sessions
global_router = APIRouter()  # Global:          mounted at /api


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
    """Return report metadata and session data in a shape compatible with
    getDataSource on the frontend (config, markers, etc. at top level)."""
    _get_report_dir_or_404(report_id)
    meta = get_report_metadata(report_id) or {}
    session = get_report_session(report_id) or {}
    return {
        "_report": meta,
        "id": report_id,
        "name": meta.get("session_name") or session.get("name", ""),
        "config": session.get("config"),
        "files": session.get("files"),
        "markers": session.get("markers"),
        "volcano_filters": session.get("volcano_filters"),
    }


@global_router.patch("/reports/{report_id}")
async def rename_report(report_id: str, request: Request):
    """Rename a report."""
    body = await request.json()
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")
    report_dir = _get_report_dir_or_404(report_id)
    meta = get_report_metadata(report_id) or {}
    meta["name"] = name
    (report_dir / "report.json").write_text(
        json.dumps(meta, indent=2), encoding="utf-8"
    )
    return {"message": "Renamed", "name": name}


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

    from app.api.routes.visualization import (
        create_response,
        load_diff_expression_results,
    )

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

    return create_response(
        {
            "results": all_results[start:end],
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": (total + page_size - 1) // page_size if total else 0,
            "total_proteins": total,
            "significant_proteins": sum(
                1 for r in all_results if r.get("significant", False)
            ),
            "upregulated": sum(
                1
                for r in all_results
                if r.get("significant", False) and r.get("log_fc", 0) > 0
            ),
            "downregulated": sum(
                1
                for r in all_results
                if r.get("significant", False) and r.get("log_fc", 0) < 0
            ),
        }
    )


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


# Per-report locks for preventing concurrent compute runs
_report_gsea_locks: dict[str, asyncio.Lock] = {}
_report_bionet_locks: dict[str, asyncio.Lock] = {}
_report_compare_locks: dict[str, asyncio.Lock] = {}
_report_background_tasks: set[asyncio.Task] = set()


def _report_gsea_status_file(report_dir: Path) -> Path:
    return report_dir / "gsea_run_status.json"


async def _report_write_gsea_status(report_dir: Path, data: dict) -> None:
    p = _report_gsea_status_file(report_dir)
    p.parent.mkdir(parents=True, exist_ok=True)
    await asyncio.to_thread(
        lambda: p.write_text(json.dumps(data, indent=2, default=str), encoding="utf-8")
    )


async def _report_background_gsea_run(
    report_dir: Path,
    comparison: str,
    databases: list[str],
    min_size: int,
    max_size: int,
    permutations: int,
    lock: asyncio.Lock,
) -> None:
    from app.api.routes.visualization import VALID_GSEA_DATABASES
    from app.services.gsea_service import gsea_service

    results_dir = report_dir / "results"
    de_file = results_dir / f"Diff_Expression_{comparison}.tsv"
    protein_file = results_dir / "Protein_Abundances.tsv"
    gsea_output_dir = results_dir / "gsea" / comparison

    status_data: dict = {
        "status": "running",
        "comparison": comparison,
        "databases": {db: "running" for db in databases if db in VALID_GSEA_DATABASES},
        "started_at": datetime.now(timezone.utc).isoformat(),
        "error": None,
    }
    gsea_output_dir.mkdir(parents=True, exist_ok=True)
    await _report_write_gsea_status(report_dir, status_data)

    try:

        async def on_db_done(db_name: str, success: bool) -> None:
            status_data["databases"][db_name] = "completed" if success else "error"
            await _report_write_gsea_status(report_dir, status_data)

        gsea_results = await gsea_service.run_gsea_for_comparison(
            diff_expression_path=de_file,
            comparison_name=comparison,
            output_dir=gsea_output_dir,
            databases=databases,
            protein_abundance_path=protein_file if protein_file.exists() else None,
            min_size=min_size,
            max_size=max_size,
            permutations=permutations,
            on_db_complete=on_db_done,
        )

        status_data["status"] = "completed"
        await _report_write_gsea_status(report_dir, status_data)

        results_file = gsea_output_dir / "GSEA_Results.json"
        await asyncio.to_thread(gsea_service.save_results, gsea_results, results_file)

    except Exception as e:
        logger.error(f"Report GSEA background run failed: {e}")
        status_data["status"] = "error"
        status_data["error"] = str(e)
        await _report_write_gsea_status(report_dir, status_data)
    finally:
        lock.release()
        _report_gsea_locks.pop(str(report_dir), None)


@global_router.post("/reports/{report_id}/gsea/run")
async def run_report_gsea(report_id: str, request: Request):
    """Run GSEA on report data."""
    report_dir = _get_report_dir_or_404(report_id)
    body = await request.json()
    comparison = body.get("comparison", "")
    databases = body.get("databases", [])
    min_size = int(body.get("min_size", 15))
    max_size = int(body.get("max_size", 500))
    permutations = int(body.get("permutations", 1000))

    if not comparison or not databases:
        raise HTTPException(
            status_code=400, detail="comparison and databases are required"
        )

    results_dir = report_dir / "results"
    de_file = results_dir / f"Diff_Expression_{comparison}.tsv"
    if not de_file.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Differential expression file not found: {de_file.name}",
        )

    lock_key = str(report_dir)
    if lock_key not in _report_gsea_locks:
        _report_gsea_locks[lock_key] = asyncio.Lock()

    run_lock = _report_gsea_locks[lock_key]
    if run_lock.locked():
        raise HTTPException(
            status_code=409,
            detail="A GSEA run is already in progress for this report",
        )

    await run_lock.acquire()

    task = asyncio.create_task(
        _report_background_gsea_run(
            report_dir=report_dir,
            comparison=comparison,
            databases=databases,
            min_size=min_size,
            max_size=max_size,
            permutations=permutations,
            lock=run_lock,
        )
    )
    _report_background_tasks.add(task)
    task.add_done_callback(_report_background_tasks.discard)

    return {"status": "started", "comparison": comparison, "databases": databases}


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
    results_dir = (
        base_results_dir / "gsea" / comparison if comparison else base_results_dir
    )

    from app.api.routes.visualization import (
        create_response,
        load_gsea_results,
        VALID_GSEA_DATABASES,
    )

    if database not in VALID_GSEA_DATABASES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid GSEA database: {database}",
        )

    gsea_data = await asyncio.to_thread(
        load_gsea_results, results_dir, database, report_id
    )
    if not gsea_data.get("results") and comparison:
        gsea_data = await asyncio.to_thread(
            load_gsea_results, base_results_dir, database, report_id
        )

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
    results_dir = (
        base_results_dir / "gsea" / comparison if comparison else base_results_dir
    )

    from app.api.routes.visualization import (
        create_response,
        load_gsea_results,
        VALID_GSEA_DATABASES,
    )

    if database not in VALID_GSEA_DATABASES:
        raise HTTPException(
            status_code=400, detail=f"Invalid GSEA database: {database}"
        )

    gsea_data = await asyncio.to_thread(
        load_gsea_results, results_dir, database, report_id
    )
    if not gsea_data.get("results") and comparison:
        gsea_data = await asyncio.to_thread(
            load_gsea_results, base_results_dir, database, report_id
        )

    pathway = next(
        (r for r in gsea_data.get("results", []) if r.get("term") == term),
        None,
    )
    if pathway is None:
        raise HTTPException(
            status_code=404, detail=f"Pathway '{term}' not found in {database}"
        )

    return create_response(
        {
            "term": term,
            "es": pathway.get("es", 0),
            "nes": pathway.get("nes", 0),
        }
    )


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
    results_dir = (
        base_results_dir / "gsea" / comparison if comparison else base_results_dir
    )

    from app.api.routes.visualization import (
        create_response,
        load_gsea_results,
        VALID_GSEA_DATABASES,
        gsea_service,
    )

    if database not in VALID_GSEA_DATABASES:
        raise HTTPException(
            status_code=400, detail=f"Invalid GSEA database: {database}"
        )

    gsea_data = await asyncio.to_thread(
        load_gsea_results, results_dir, database, report_id
    )
    if not gsea_data.get("results") and comparison:
        gsea_data = await asyncio.to_thread(
            load_gsea_results, base_results_dir, database, report_id
        )

    pathway = next(
        (r for r in gsea_data.get("results", []) if r.get("term") == term),
        None,
    )
    if pathway is None:
        raise HTTPException(
            status_code=404, detail=f"Pathway '{term}' not found in {database}"
        )

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


async def _report_background_bionet_run(
    report_dir: Path,
    request_body: dict,
    de_file: Path,
    lock: asyncio.Lock,
) -> None:
    from app.services.bionet_service import bionet_service

    bionet_dir = report_dir / "bionet"
    bionet_dir.mkdir(parents=True, exist_ok=True)

    status_data: dict = {
        "status": "running",
        "comparison": request_body.get("comparison", ""),
        "started_at": datetime.now(timezone.utc).isoformat(),
        "error": None,
    }
    status_file = bionet_dir / "bionet_status.json"
    await asyncio.to_thread(
        lambda: status_file.write_text(
            json.dumps(status_data, indent=2, default=str), encoding="utf-8"
        )
    )

    try:
        nodes_csv = bionet_dir / "nodes.csv"
        edges_csv = bionet_dir / "edges.csv"

        node_count, edge_count = await asyncio.to_thread(
            bionet_service.run_bionet,
            de_file=de_file,
            config=request_body,
            nodes_csv=nodes_csv,
            edges_csv=edges_csv,
        )

        import pandas as pd

        nodes_df = pd.read_csv(nodes_csv)
        edges_df = pd.read_csv(edges_csv)
        subnetwork = {
            "nodes": nodes_df.to_dict(orient="records"),
            "edges": edges_df.to_dict(orient="records"),
        }
        subnetwork_path = bionet_dir / "bionet_subnetwork.json"
        await asyncio.to_thread(
            lambda: subnetwork_path.write_text(
                json.dumps(subnetwork, indent=2, default=str), encoding="utf-8"
            )
        )

        status_data["status"] = "completed"
        status_data["node_count"] = node_count
        status_data["edge_count"] = edge_count
        status_data["completed_at"] = datetime.now(timezone.utc).isoformat()
        await asyncio.to_thread(
            lambda: status_file.write_text(
                json.dumps(status_data, indent=2, default=str), encoding="utf-8"
            )
        )
    except Exception as e:
        logger.error(f"Report BioNet background run failed: {e}")
        status_data["status"] = "error"
        status_data["error"] = str(e)
        await asyncio.to_thread(
            lambda: status_file.write_text(
                json.dumps(status_data, indent=2, default=str), encoding="utf-8"
            )
        )
    finally:
        lock.release()
        _report_bionet_locks.pop(str(report_dir), None)


@global_router.post("/reports/{report_id}/bionet/run")
async def run_report_bionet(report_id: str, request: Request):
    """Run BioNet on report data."""
    report_dir = _get_report_dir_or_404(report_id)
    body = await request.json()

    comparison = body.get("comparison", "")
    if not comparison:
        raise HTTPException(status_code=400, detail="comparison is required")

    results_dir = report_dir / "results"
    de_file = results_dir / f"Diff_Expression_{comparison}.tsv"
    if not de_file.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Differential expression file not found: {de_file.name}",
        )

    lock_key = str(report_dir)
    if lock_key not in _report_bionet_locks:
        _report_bionet_locks[lock_key] = asyncio.Lock()

    run_lock = _report_bionet_locks[lock_key]
    if run_lock.locked():
        raise HTTPException(
            status_code=409,
            detail="A BioNet analysis is already running for this report",
        )

    await run_lock.acquire()

    task = asyncio.create_task(
        _report_background_bionet_run(
            report_dir=report_dir,
            request_body=body,
            de_file=de_file,
            lock=run_lock,
        )
    )
    _report_background_tasks.add(task)
    task.add_done_callback(_report_background_tasks.discard)

    return {"status": "started", "comparison": comparison}


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


def _report_compare_result_path(report_dir: Path, compute_type: str) -> Path:
    return report_dir / "results" / "compare" / f"{compute_type}_result.json"


def _report_compare_status_path(report_dir: Path, compute_type: str) -> Path:
    return report_dir / "results" / "compare" / f"{compute_type}_status.json"


def _report_compare_read_status(report_dir: Path, compute_type: str) -> dict:
    sp = _report_compare_status_path(report_dir, compute_type)
    if not sp.exists():
        return {"status": "idle"}
    with open(sp, "r", encoding="utf-8") as f:
        return json.load(f)


def _report_compare_write_status(
    report_dir: Path, compute_type: str, data: dict
) -> None:
    sp = _report_compare_status_path(report_dir, compute_type)
    sp.parent.mkdir(parents=True, exist_ok=True)
    with open(sp, "w", encoding="utf-8") as f:
        json.dump(data, f)


def _report_compare_write_result(
    report_dir: Path, compute_type: str, data: dict
) -> None:
    rp = _report_compare_result_path(report_dir, compute_type)
    rp.parent.mkdir(parents=True, exist_ok=True)
    with open(rp, "w", encoding="utf-8") as f:
        json.dump(data, f, default=str)


def _get_report_comparisons_from_dir(report_dir: Path) -> list[str]:
    """Discover all comparisons from DE result files in the report directory."""
    results_dir = report_dir / "results"
    comparisons = []
    if results_dir.exists():
        for f in sorted(results_dir.glob("Diff_Expression_*.tsv")):
            stem = f.stem
            comp = stem.replace("Diff_Expression_", "")
            if comp:
                comparisons.append(comp)
    return comparisons


def _run_report_protein_correlation(report_dir: Path, body: dict) -> None:
    """Background task: compute protein correlation analysis for a report."""
    import numpy as np
    from app.services.compare_service import (
        build_fold_change_matrix,
        compute_protein_similarities,
        load_pvalues_for_protein,
        run_cluster,
    )

    compute_type = "protein-correlation"
    report_dir_str = str(report_dir)
    try:
        comparisons = _get_report_comparisons_from_dir(report_dir)
        matrix, accessions, gene_names = build_fold_change_matrix(
            report_dir_str, comparisons
        )

        protein_id = body.get("protein_id", "")
        query_idx = None
        for i, acc in enumerate(accessions):
            if protein_id in acc or acc in protein_id:
                query_idx = i
                break
        if query_idx is None:
            raise ValueError(f"Protein {protein_id} not found in any comparison")

        pvals = load_pvalues_for_protein(
            report_dir_str, comparisons, protein_id, accessions
        )
        selected_fc = []
        for j, comp in enumerate(comparisons):
            val = matrix[query_idx, j]
            if not np.isnan(val):
                pv = pvals.get(comp, {})
                selected_fc.append(
                    {
                        "comparison": comp,
                        "log_fc": float(val),
                        "pval": pv.get("pval", 1.0),
                        "adj_pval": pv.get("adj_pval", 1.0),
                    }
                )

        similar = compute_protein_similarities(
            matrix, accessions, gene_names, comparisons, query_idx
        )

        cluster_method = body.get("cluster_method", "pca")
        coords, variance = run_cluster(matrix, cluster_method)
        cluster_coords = [
            {
                "accession": accessions[i],
                "gene_name": gene_names[i],
                "x": float(coords[i, 0]),
                "y": float(coords[i, 1]),
            }
            for i in range(len(accessions))
        ]

        color_comparison = body.get("color_comparison", "")
        color_comp_idx = (
            comparisons.index(color_comparison)
            if color_comparison in comparisons
            else 0
        )
        color_fc_map = {
            accessions[i]: float(matrix[i, color_comp_idx])
            if not np.isnan(matrix[i, color_comp_idx])
            else 0.0
            for i in range(len(accessions))
        }

        result = {
            "selected_protein_fc": selected_fc,
            "similar_proteins": similar,
            "cluster_coords": cluster_coords,
            "cluster_var_explained": variance,
            "color_fc_map": color_fc_map,
        }
        current_status = _report_compare_read_status(report_dir, compute_type)
        _report_compare_write_result(report_dir, compute_type, result)
        _report_compare_write_status(
            report_dir,
            compute_type,
            {
                "status": "completed",
                "started_at": current_status.get("started_at"),
                "completed_at": datetime.now(timezone.utc).isoformat(),
            },
        )
    except Exception as e:
        logger.exception(f"Report protein correlation compute failed: {e}")
        current_status = _report_compare_read_status(report_dir, compute_type)
        _report_compare_write_status(
            report_dir,
            compute_type,
            {
                "status": "error",
                "error": str(e),
                "started_at": current_status.get("started_at"),
                "completed_at": datetime.now(timezone.utc).isoformat(),
            },
        )


def _run_report_comparison_correlation(report_dir: Path, body: dict) -> None:
    """Background task: compute comparison correlation analysis for a report."""
    import numpy as np
    from app.services.compare_service import (
        build_fold_change_matrix,
        compute_similarity_matrix,
        compute_hierarchical_order,
        run_cluster,
        _load_de_file,
    )

    compute_type = "comparison-correlation"
    report_dir_str = str(report_dir)
    try:
        all_comparisons = _get_report_comparisons_from_dir(report_dir)
        selected = [
            c for c in body.get("selected_comparisons", []) if c in all_comparisons
        ]
        if not selected:
            raise ValueError("No valid selected comparisons found")

        matrix, accessions, gene_names = build_fold_change_matrix(
            report_dir_str, all_comparisons
        )

        sim_matrix = compute_similarity_matrix(matrix.T)
        similarity = {
            "comparisons": all_comparisons,
            "matrix": sim_matrix.tolist(),
        }

        marked_proteins = body.get("marked_proteins", {})
        marked_set = set()
        for acc_list in marked_proteins.values():
            marked_set.update(acc_list)

        if not marked_set:
            for comp in selected:
                df = _load_de_file(report_dir_str, comp)
                if df is not None:
                    sig = df[(df["adj_pval"] < 0.05) & (df["log_fc"].abs() >= 1)]
                    marked_set.update(sig["accession"].tolist())
            if not marked_set:
                sel_indices = [
                    all_comparisons.index(c) for c in selected if c in all_comparisons
                ]
                sel_matrix_for_fallback = matrix[:, sel_indices]
                max_fc = np.nanmax(np.abs(sel_matrix_for_fallback), axis=1)
                top_100 = np.argsort(max_fc)[-100:]
                for i in top_100:
                    if not np.isnan(sel_matrix_for_fallback[i]).all():
                        marked_set.add(accessions[i])

        marked_list = sorted(marked_set)
        acc_to_idx = {acc: i for i, acc in enumerate(accessions)}
        row_indices = [acc_to_idx[acc] for acc in marked_list if acc in acc_to_idx]
        sel_indices = [
            all_comparisons.index(c) for c in selected if c in all_comparisons
        ]
        heatmap_fc = matrix[np.array(row_indices)][:, sel_indices]
        heatmap_proteins = [
            {"accession": accessions[i], "gene_name": gene_names[i]}
            for i in row_indices
        ]
        if len(heatmap_proteins) > 500:
            max_fc = np.nanmax(np.abs(heatmap_fc), axis=1)
            top_idx = np.argsort(max_fc)[-500:]
            heatmap_fc = heatmap_fc[top_idx]
            heatmap_proteins = [heatmap_proteins[i] for i in top_idx]

        if heatmap_fc.shape[0] > 1:
            row_order = compute_hierarchical_order(heatmap_fc)
            heatmap_fc = heatmap_fc[row_order]
            heatmap_proteins = [heatmap_proteins[i] for i in row_order]

        if heatmap_fc.shape[1] > 1:
            col_order = compute_hierarchical_order(heatmap_fc.T)
            heatmap_fc = heatmap_fc[:, col_order]
            selected_ordered = [selected[i] for i in col_order]
        else:
            selected_ordered = selected

        heatmap_data = {
            "proteins": heatmap_proteins,
            "comparisons": selected_ordered,
            "fold_changes": heatmap_fc.tolist(),
        }

        primary_comparison = body.get("primary_comparison", "")
        primary_idx = (
            all_comparisons.index(primary_comparison)
            if primary_comparison in all_comparisons
            else 0
        )
        comp_dists = []
        for j, comp in enumerate(all_comparisons):
            d = (
                float(sim_matrix[primary_idx, j])
                if not np.isnan(sim_matrix[primary_idx, j])
                else float("inf")
            )
            comp_dists.append({"comparison": comp, "similarity": d})
        comp_dists.sort(key=lambda x: x["similarity"])

        cluster_method = body.get("cluster_method", "pca")
        coords, variance = run_cluster(matrix.T, cluster_method)
        cluster_coords = [
            {
                "comparison": all_comparisons[i],
                "x": float(coords[i, 0]),
                "y": float(coords[i, 1]),
            }
            for i in range(len(all_comparisons))
        ]

        result = {
            "similarity_matrix": similarity,
            "heatmap_data": heatmap_data,
            "comparison_similarities": comp_dists,
            "cluster_coords": cluster_coords,
            "cluster_var_explained": variance,
        }
        current_status = _report_compare_read_status(report_dir, compute_type)
        _report_compare_write_result(report_dir, compute_type, result)
        _report_compare_write_status(
            report_dir,
            compute_type,
            {
                "status": "completed",
                "started_at": current_status.get("started_at"),
                "completed_at": datetime.now(timezone.utc).isoformat(),
            },
        )
    except Exception as e:
        logger.exception(f"Report comparison correlation compute failed: {e}")
        current_status = _report_compare_read_status(report_dir, compute_type)
        _report_compare_write_status(
            report_dir,
            compute_type,
            {
                "status": "error",
                "error": str(e),
                "started_at": current_status.get("started_at"),
                "completed_at": datetime.now(timezone.utc).isoformat(),
            },
        )


async def _schedule_report_background(coro) -> asyncio.Task:
    task = asyncio.create_task(coro)
    _report_background_tasks.add(task)
    task.add_done_callback(_report_background_tasks.discard)
    return task


@global_router.post("/reports/{report_id}/compare/protein-correlation")
async def run_report_protein_correlation(report_id: str, request: Request):
    """Run protein-correlation analysis on report data."""
    report_dir = _get_report_dir_or_404(report_id)
    body = await request.json()

    compare_dir = report_dir / "results" / "compare"
    compare_dir.mkdir(parents=True, exist_ok=True)

    lock_key = str(report_dir) + ":protein-correlation"
    if lock_key not in _report_compare_locks:
        _report_compare_locks[lock_key] = asyncio.Lock()

    lock = _report_compare_locks[lock_key]
    async with lock:
        status = _report_compare_read_status(report_dir, "protein-correlation")
        if status.get("status") == "running":
            raise HTTPException(
                status_code=409, detail="Computation already in progress"
            )
        _report_compare_write_status(
            report_dir,
            "protein-correlation",
            {
                "status": "running",
                "started_at": datetime.now(timezone.utc).isoformat(),
            },
        )

    await _schedule_report_background(
        asyncio.to_thread(_run_report_protein_correlation, report_dir, body)
    )
    return {"status": "running"}


@global_router.get("/reports/{report_id}/compare/protein-correlation/status")
async def get_report_protein_correlation_status(report_id: str):
    """Read protein-correlation run status."""
    report_dir = _get_report_dir_or_404(report_id)
    return _report_compare_read_status(report_dir, "protein-correlation")


@global_router.get("/reports/{report_id}/compare/protein-correlation")
async def get_report_protein_correlation_results(report_id: str):
    """Return protein-correlation results."""
    report_dir = _get_report_dir_or_404(report_id)
    rp = _report_compare_result_path(report_dir, "protein-correlation")
    if not rp.exists():
        raise HTTPException(
            status_code=404, detail="No protein correlation results available"
        )
    return json.loads(rp.read_text(encoding="utf-8"))


@global_router.post("/reports/{report_id}/compare/comparison-correlation")
async def run_report_comparison_correlation(report_id: str, request: Request):
    """Run comparison-correlation analysis on report data."""
    report_dir = _get_report_dir_or_404(report_id)
    body = await request.json()

    compare_dir = report_dir / "results" / "compare"
    compare_dir.mkdir(parents=True, exist_ok=True)

    lock_key = str(report_dir) + ":comparison-correlation"
    if lock_key not in _report_compare_locks:
        _report_compare_locks[lock_key] = asyncio.Lock()

    lock = _report_compare_locks[lock_key]
    async with lock:
        status = _report_compare_read_status(report_dir, "comparison-correlation")
        if status.get("status") == "running":
            raise HTTPException(
                status_code=409, detail="Computation already in progress"
            )
        _report_compare_write_status(
            report_dir,
            "comparison-correlation",
            {
                "status": "running",
                "started_at": datetime.now(timezone.utc).isoformat(),
            },
        )

    await _schedule_report_background(
        asyncio.to_thread(_run_report_comparison_correlation, report_dir, body)
    )
    return {"status": "running"}


@global_router.get("/reports/{report_id}/compare/comparison-correlation/status")
async def get_report_comparison_correlation_status(report_id: str):
    """Read comparison-correlation run status."""
    report_dir = _get_report_dir_or_404(report_id)
    return _report_compare_read_status(report_dir, "comparison-correlation")


@global_router.get("/reports/{report_id}/compare/comparison-correlation")
async def get_report_comparison_correlation_results(report_id: str):
    """Return comparison-correlation results."""
    report_dir = _get_report_dir_or_404(report_id)
    rp = _report_compare_result_path(report_dir, "comparison-correlation")
    if not rp.exists():
        raise HTTPException(
            status_code=404, detail="No comparison correlation results available"
        )
    return json.loads(rp.read_text(encoding="utf-8"))


@global_router.post("/reports/{report_id}/compare/venn")
async def run_report_venn(report_id: str, request: Request):
    """Compute Venn diagram data for report comparisons."""
    report_dir = _get_report_dir_or_404(report_id)
    body = await request.json()
    comparisons = body.get("comparisons", [])
    pvalue_threshold = body.get("pvalue_threshold", 0.05)
    logfc_threshold = body.get("logfc_threshold", 1.0)

    if len(comparisons) < 2 or len(comparisons) > 3:
        raise HTTPException(status_code=400, detail="Venn requires 2 or 3 comparisons")

    from app.services.compare_service import compute_venn_data

    result = await asyncio.to_thread(
        compute_venn_data,
        str(report_dir),
        comparisons,
        pvalue_threshold,
        logfc_threshold,
    )
    return result


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

    if not patch_report_state(
        report_id, markers=markers, volcano_filters=volcano_filters
    ):
        raise HTTPException(status_code=404, detail="Report not found")

    return {"message": "Visualization state updated"}
