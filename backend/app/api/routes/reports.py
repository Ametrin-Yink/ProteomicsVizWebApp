"""Management and capability-scoped APIs for self-contained reports."""

import asyncio
import json
import logging
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field, field_validator, model_validator

from app.services.report_generator import generate_report
from app.services.report_store import (
    create_report,
    delete_report,
    discard_staged_report,
    get_report_by_share_token,
    get_report_dir,
    get_report_metadata,
    get_report_session,
    get_report_staging_dir,
    list_reports,
    publish_report,
    rotate_share_token,
)
from app.services.task_manager import (
    TaskCancelledError,
    TaskKind,
    TaskTimeoutError,
    task_manager,
)
from app.utils.json_io import read_json_file, write_json_file

logger = logging.getLogger("proteomics")

router = APIRouter()  # Session-scoped:  mounted at /api/sessions
management_router = APIRouter()  # Private report administration
shared_router = APIRouter()  # Capability-scoped report viewing and computation

VALID_GSEA_DATABASES = {"go_bp", "go_mf", "go_cc", "kegg", "reactome"}
ComparisonName = Annotated[str, Field(min_length=1, max_length=200)]
ProteinIdentifier = Annotated[str, Field(min_length=1, max_length=500)]
AnalysisOption = Annotated[str, Field(min_length=1, max_length=100)]


class ReportNameRequest(BaseModel):
    """Validated report name payload."""

    name: str = Field(min_length=1, max_length=200)

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Report name is required")
        return value


class ReportGseaRunRequest(BaseModel):
    """Bounded GSEA request available to a shared report recipient."""

    comparison: ComparisonName
    databases: list[AnalysisOption] = Field(min_length=1, max_length=5)
    min_size: int = Field(default=15, ge=1, le=5000)
    max_size: int = Field(default=500, ge=1, le=5000)
    permutations: int = Field(default=1000, ge=100, le=10000)

    @model_validator(mode="after")
    def validate_request(self):
        if self.min_size > self.max_size:
            raise ValueError("min_size must not exceed max_size")
        invalid = set(self.databases) - VALID_GSEA_DATABASES
        if invalid:
            raise ValueError(f"Unsupported GSEA databases: {sorted(invalid)}")
        if len(set(self.databases)) != len(self.databases):
            raise ValueError("GSEA databases must be unique")
        return self


class ReportBioNetRunRequest(BaseModel):
    """Bounded BioNet request available to a shared report recipient."""

    comparison: ComparisonName
    pvalue_cutoff: float = Field(default=0.05, ge=0, le=1)
    logfc_cutoff: float = Field(default=0.5, ge=0, le=100)
    statement_types: list[AnalysisOption] = Field(
        default_factory=lambda: ["IncreaseAmount", "DecreaseAmount"],
        max_length=50,
    )
    paper_count_cutoff: int = Field(default=1, ge=0, le=1_000_000)
    evidence_count_cutoff: int = Field(default=1, ge=0, le=1_000_000)
    correlation_cutoff: float | None = Field(default=None, ge=-1, le=1)
    sources_filter: list[AnalysisOption] | None = Field(default=None, max_length=50)


class ReportProteinCorrelationRequest(BaseModel):
    protein_id: ProteinIdentifier
    cluster_method: Literal["pca", "umap", "tsne"] = "pca"
    color_comparison: ComparisonName


class ReportComparisonCorrelationRequest(BaseModel):
    primary_comparison: ComparisonName
    selected_comparisons: list[ComparisonName] = Field(min_length=1, max_length=100)
    marked_proteins: dict[ComparisonName, list[ProteinIdentifier]] = Field(
        default_factory=dict, max_length=100
    )
    cluster_method: Literal["pca", "umap", "tsne"] = "pca"

    @model_validator(mode="after")
    def validate_markers(self):
        marker_count = sum(len(values) for values in self.marked_proteins.values())
        if marker_count > 10_000:
            raise ValueError("At most 10000 marked proteins may be submitted")
        return self


class ReportComparisonDetailRequest(BaseModel):
    comparisons: list[ComparisonName] = Field(min_length=1, max_length=50)
    proteins: list[ProteinIdentifier] = Field(default_factory=list, max_length=500)
    max_proteins: int = Field(default=100, ge=1, le=500)


class ReportVennRequest(BaseModel):
    comparisons: list[ComparisonName] = Field(min_length=2, max_length=3)
    pvalue_threshold: float = Field(default=0.05, ge=0, le=1)
    logfc_threshold: float = Field(default=1.0, ge=0, le=100)

    @field_validator("comparisons")
    @classmethod
    def validate_unique_comparisons(cls, value: list[str]) -> list[str]:
        if len(set(value)) != len(value):
            raise ValueError("Venn comparisons must be unique")
        return value


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _get_report_dir_or_404(report_id: str) -> Path:
    """Return the report directory or raise 404."""
    d = get_report_dir(report_id)
    if d is None:
        raise HTTPException(status_code=404, detail="Report not found")
    return d


def _get_shared_report_or_404(share_token: str) -> tuple[str, Path, dict]:
    """Resolve one report capability without revealing why lookup failed."""
    resolved = get_report_by_share_token(share_token)
    if resolved is None:
        raise HTTPException(status_code=404, detail="Report not found")
    return resolved


def _report_task_key(report_id: str) -> str:
    return f"report:{report_id}"


def _report_pipeline(report_dir: Path) -> str:
    """Resolve the snapshotted pipeline without consulting the source session."""
    session_path = report_dir / "session.json"
    if session_path.is_file():
        try:
            pipeline = json.loads(session_path.read_text(encoding="utf-8")).get(
                "pipeline"
            )
            if pipeline:
                return str(pipeline)
        except (OSError, json.JSONDecodeError):
            pass
    manifest_path = report_dir / "results" / "visualization_artifacts.json"
    if manifest_path.is_file():
        try:
            pipeline = json.loads(manifest_path.read_text(encoding="utf-8")).get(
                "pipeline"
            )
            if pipeline:
                return str(pipeline)
        except (OSError, json.JSONDecodeError):
            pass
    return ""


def _report_task_recently_started(data: dict, grace_seconds: int = 10) -> bool:
    """Avoid declaring a just-scheduled task stale before TaskManager sees it."""
    started_at = data.get("started_at")
    if not isinstance(started_at, str):
        return False
    try:
        started = datetime.fromisoformat(started_at)
        return (datetime.now(UTC) - started).total_seconds() < grace_seconds
    except (TypeError, ValueError):
        return False


def _validate_comparisons(report_dir: Path, comparisons: list[str]) -> None:
    from app.services.differential_repository import DifferentialRepository

    try:
        repository = DifferentialRepository(report_dir / "results")
        invalid = repository.validate_comparisons(comparisons)
    except ValueError as error:
        raise HTTPException(
            status_code=409,
            detail="Visualization data must be reprocessed for this report",
        ) from error
    if invalid:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown report comparisons: {sorted(set(invalid))}",
        )


def _get_comparisons(results_dir: Path) -> list[str]:
    """Read comparison identifiers from canonical differential Parquet."""
    from app.services.differential_repository import DifferentialRepository

    return DifferentialRepository(results_dir).list_comparison_ids()


# ---------------------------------------------------------------------------
# Session-scoped:  POST /api/sessions/{session_id}/reports/generate
# ---------------------------------------------------------------------------


@router.post("/{session_id}/reports/generate")
async def generate_report_endpoint(session_id: str, request: ReportNameRequest):
    """Generate a self-contained report from a completed session."""
    metadata = await asyncio.to_thread(
        create_report,
        name=request.name.strip(),
        session_id=session_id,
        session_name="",
    )
    try:
        await asyncio.to_thread(generate_report, session_id, metadata["report_id"])
        report_dir = get_report_staging_dir(metadata["report_id"])
        session_json_path = report_dir / "session.json"
        if session_json_path.exists():
            session_data = await read_json_file(session_json_path)
            metadata["session_name"] = session_data.get("name", "")
            await write_json_file(
                report_dir / "report.json",
                metadata,
                indent=2,
            )
        await asyncio.to_thread(publish_report, metadata["report_id"])
    except ValueError as e:
        await asyncio.to_thread(discard_staged_report, metadata["report_id"])
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception:
        await asyncio.to_thread(discard_staged_report, metadata["report_id"])
        raise

    return {
        "report_id": metadata["report_id"],
        "share_token": metadata["share_token"],
        "name": metadata["name"],
        "weblink": f"/reports/{metadata['share_token']}",
        "created_at": metadata["created_at"],
    }


# ---------------------------------------------------------------------------
# Global list / get / delete
# ---------------------------------------------------------------------------


@management_router.get("/reports")
async def get_reports():
    """List all reports."""
    return {"reports": await asyncio.to_thread(list_reports)}


@shared_router.get("/shared-reports/{share_token}")
async def get_report_meta(share_token: str):
    """Return report metadata and session data in a shape compatible with
    getDataSource on the frontend (config, markers, etc. at top level)."""
    report_id, _report_dir, meta = _get_shared_report_or_404(share_token)
    session = await asyncio.to_thread(get_report_session, report_id)
    session = session or {}
    return {
        "_report": {
            "name": meta.get("name", ""),
            "session_name": meta.get("session_name", ""),
            "created_at": meta.get("created_at", ""),
        },
        "id": share_token,
        "name": meta.get("session_name") or session.get("name", ""),
        "template": session.get("template"),
        "pipeline": session.get("pipeline"),
        "config": session.get("config"),
        "files": session.get("files"),
        "markers": session.get("markers"),
        "volcano_filters": session.get("volcano_filters"),
        "ptm_volcano_filters": session.get("ptm_volcano_filters"),
    }


@shared_router.get("/shared-reports/{share_token}/visualization/manifest")
async def get_report_visualization_manifest(share_token: str):
    """Return visualization capabilities for a self-contained report."""
    report_id, report_dir, _meta = _get_shared_report_or_404(share_token)
    session_data = await asyncio.to_thread(get_report_session, report_id)
    if not session_data:
        raise HTTPException(status_code=404, detail="Report session not found")

    from types import SimpleNamespace

    from app.api.routes.visualization_manifest import build_visualization_manifest
    from app.api.routes.visualization_shared import create_response

    session = SimpleNamespace(pipeline=session_data.get("pipeline", ""))
    manifest = build_visualization_manifest(session, report_dir / "results")
    return create_response(manifest)


@shared_router.get("/shared-reports/{share_token}/visualization/comparisons")
async def get_report_visualization_comparisons(
    share_token: str,
    search: str | None = Query(None, max_length=200),
    cursor: str | None = Query(None),
    limit: int = Query(50, ge=1, le=100),
):
    """Capability-scoped, cursor-paginated comparison catalog."""
    _report_id, report_dir, _meta = _get_shared_report_or_404(share_token)
    from app.api.routes.visualization_shared import create_response
    from app.services.visualization_repository import VisualizationRepository

    try:
        repository = await asyncio.to_thread(
            VisualizationRepository, report_dir / "results"
        )
        data = await asyncio.to_thread(
            repository.list_comparisons,
            search=search,
            cursor=cursor,
            limit=limit,
        )
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    return create_response(data)


@shared_router.get("/shared-reports/{share_token}/visualization/qc/overview")
async def get_report_visualization_qc_overview(
    share_token: str,
    group_by: str = Query("condition"),
    search: str | None = Query(None, max_length=200),
    cursor: str | None = Query(None),
    limit: int = Query(50, ge=1, le=50),
):
    """Capability-scoped bounded QC overview."""
    _report_id, report_dir, _meta = _get_shared_report_or_404(share_token)
    from app.api.routes.visualization_shared import create_response
    from app.services.visualization_repository import VisualizationRepository

    try:
        repository = await asyncio.to_thread(
            VisualizationRepository, report_dir / "results"
        )
        data = await asyncio.to_thread(
            repository.get_qc_overview,
            group_by=group_by,
            search=search,
            cursor=cursor,
            limit=limit,
        )
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    return create_response(data)


@shared_router.get("/shared-reports/{share_token}/visualization/samples")
async def get_report_visualization_samples(
    share_token: str,
    search: str | None = Query(None, max_length=200),
    cursor: str | None = Query(None),
    limit: int = Query(100, ge=1, le=500),
):
    """Capability-scoped, cursor-paginated sample catalog."""
    _report_id, report_dir, _meta = _get_shared_report_or_404(share_token)
    from app.api.routes.visualization_shared import create_response
    from app.services.visualization_repository import VisualizationRepository

    try:
        repository = await asyncio.to_thread(
            VisualizationRepository, report_dir / "results"
        )
        data = await asyncio.to_thread(
            repository.list_samples,
            search=search,
            cursor=cursor,
            limit=limit,
        )
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    return create_response(data)


@shared_router.get("/shared-reports/{share_token}/visualization/qc/differential")
async def get_report_visualization_qc_differential(
    share_token: str,
    comparison: ComparisonName,
):
    """Capability-scoped differential QC for one comparison."""
    _report_id, report_dir, _meta = _get_shared_report_or_404(share_token)
    _validate_comparisons(report_dir, [comparison])
    from app.api.routes.visualization_shared import create_response
    from app.services.visualization_repository import VisualizationRepository

    try:
        repository = await asyncio.to_thread(
            VisualizationRepository, report_dir / "results"
        )
        data = await asyncio.to_thread(repository.get_qc_differential, comparison)
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    return create_response(data)


@shared_router.get("/shared-reports/{share_token}/visualization/qc/samples")
async def get_report_visualization_qc_samples(
    share_token: str,
    search: str | None = Query(None, max_length=200),
    cursor: str | None = Query(None),
    limit: int = Query(100, ge=1, le=500),
):
    """Capability-scoped, bounded per-sample QC table."""
    _report_id, report_dir, _meta = _get_shared_report_or_404(share_token)
    from app.api.routes.visualization_shared import create_response
    from app.services.visualization_repository import VisualizationRepository

    try:
        repository = await asyncio.to_thread(
            VisualizationRepository, report_dir / "results"
        )
        data = await asyncio.to_thread(
            repository.list_qc_samples,
            search=search,
            cursor=cursor,
            limit=limit,
        )
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    return create_response(data)


@shared_router.get("/shared-reports/{share_token}/ptm/results")
async def get_report_ptm_results(
    share_token: str,
    comparison: str | None = Query(default=None),
    layer: Literal["ptm", "protein", "adjusted"] | None = Query(default=None),
):
    """Return PTM result layers from an exported report."""
    _report_id, report_dir, _meta = _get_shared_report_or_404(share_token)
    from app.api.routes.visualization_ptm import load_ptm_results
    from app.api.routes.visualization_shared import create_response

    comparisons = await load_ptm_results(
        report_dir / "results",
        comparison=comparison,
        layer=layer,
    )
    return create_response({"comparisons": comparisons})


@shared_router.get("/shared-reports/{share_token}/ptm/results/download")
async def download_report_ptm_results(share_token: str):
    """Download the immutable PTM result archive from an exported report."""
    _report_id, report_dir, _meta = _get_shared_report_or_404(share_token)
    archive = report_dir / "results" / "ptm_results.zip"
    if not archive.exists():
        raise HTTPException(status_code=404, detail="PTM result archive was not found")

    from fastapi.responses import FileResponse

    return FileResponse(
        archive,
        media_type="application/zip",
        filename="ptm_results.zip",
    )


@shared_router.get("/shared-reports/{share_token}/ptm/compare")
async def get_report_ptm_comparison_summary(
    share_token: str,
    layer: Literal["ptm", "protein", "adjusted"] = Query(default="ptm"),
):
    """Return compact PTM comparison data from an exported report."""
    _report_id, report_dir, _meta = _get_shared_report_or_404(share_token)
    from app.api.routes.visualization_ptm import load_ptm_comparison_summary
    from app.api.routes.visualization_shared import create_response

    return create_response(
        await load_ptm_comparison_summary(report_dir / "results", layer)
    )


@shared_router.get("/shared-reports/{share_token}/ptm/site/{site_id}/abundance")
async def get_report_ptm_site_abundance(share_token: str, site_id: str):
    """Return summarized PTM site abundance from an exported report."""
    _report_id, report_dir, _meta = _get_shared_report_or_404(share_token)
    from app.api.routes.visualization_ptm import load_ptm_site_abundance
    from app.api.routes.visualization_shared import create_response

    samples = await load_ptm_site_abundance(report_dir / "results", site_id)
    return create_response({"site": site_id, "samples": samples})


@shared_router.get("/shared-reports/{share_token}/ptm/site/{site_id}")
async def get_report_ptm_site_details(share_token: str, site_id: str):
    """Return PTM site evidence from an exported report."""
    _report_id, report_dir, _meta = _get_shared_report_or_404(share_token)
    from app.api.routes.visualization_ptm import load_ptm_site_details
    from app.api.routes.visualization_shared import create_response

    details = await load_ptm_site_details(report_dir / "results", site_id)
    if details is None:
        raise HTTPException(status_code=404, detail=f"PTM site {site_id} not found")
    return create_response(details)


@shared_router.get("/shared-reports/{share_token}/ptm/qc/plots")
async def get_report_ptm_qc_plots(share_token: str):
    """Return PTM QC data from an exported report."""
    _report_id, report_dir, _meta = _get_shared_report_or_404(share_token)
    from app.api.routes.visualization_ptm import load_ptm_qc_data
    from app.api.routes.visualization_shared import create_response

    data = await load_ptm_qc_data(report_dir / "results")
    return create_response(data)


@management_router.patch("/reports/{report_id}")
async def rename_report(report_id: str, request: ReportNameRequest):
    """Rename a report."""
    report_dir = _get_report_dir_or_404(report_id)
    meta = await asyncio.to_thread(get_report_metadata, report_id) or {}
    meta["name"] = request.name.strip()
    await write_json_file(report_dir / "report.json", meta, indent=2)
    return {"message": "Renamed", "name": request.name.strip()}


@management_router.delete("/reports/{report_id}")
async def delete_report_endpoint(report_id: str):
    """Delete a report."""
    if not await asyncio.to_thread(delete_report, report_id):
        raise HTTPException(status_code=404, detail="Report not found")
    return {"message": "Report deleted"}


@management_router.post("/reports/{report_id}/share-token/rotate")
async def rotate_report_share_token(report_id: str):
    """Revoke the old shared link and return a replacement."""
    share_token = await asyncio.to_thread(rotate_share_token, report_id)
    if share_token is None:
        raise HTTPException(status_code=404, detail="Report not found")
    return {
        "share_token": share_token,
        "weblink": f"/reports/{share_token}",
    }


# ---------------------------------------------------------------------------
# Differential expression results
# ---------------------------------------------------------------------------


@shared_router.get("/shared-reports/{share_token}/results")
async def get_report_results(
    share_token: str,
    comparison: str = Query(""),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100000),
    sort_by: str = Query("adj_pvalue"),
    sort_order: str = Query("asc"),
    significant_only: bool = Query(False),
    search: str = Query(""),
):
    """Get paginated DE results from a report."""
    _report_id, report_dir, _meta = _get_shared_report_or_404(share_token)
    if comparison:
        _validate_comparisons(report_dir, [comparison])
    results_dir = report_dir / "results"

    from app.api.routes.visualization_shared import create_response
    from app.services.differential_repository import DifferentialRepository

    try:
        repository = await asyncio.to_thread(DifferentialRepository, results_dir)
    except ValueError as error:
        raise HTTPException(
            status_code=409,
            detail="Visualization data must be reprocessed for this report",
        ) from error
    try:
        payload = await asyncio.to_thread(
            repository.list_results,
            comparison,
            page=page,
            page_size=page_size,
            sort_by=sort_by,
            sort_order=sort_order,
            significant_only=significant_only,
            search=search,
        )
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return create_response(payload)


# ---------------------------------------------------------------------------
# QC plots
# ---------------------------------------------------------------------------


@shared_router.get("/shared-reports/{share_token}/qc/plots")
async def get_report_qc_plots(share_token: str):
    """Get the compact experiment-wide QC summary."""
    _report_id, report_dir, _meta = _get_shared_report_or_404(share_token)
    results_dir = report_dir / "results"

    from app.api.routes.visualization import create_response, load_qc_summary

    try:
        qc_data = await asyncio.to_thread(load_qc_summary, results_dir)
    except ValueError as error:
        raise HTTPException(
            status_code=409,
            detail="Visualization data must be reprocessed for this report",
        ) from error
    return create_response(qc_data)


# ---------------------------------------------------------------------------
# GSEA -- status / run / data / plot / heatmap
# ---------------------------------------------------------------------------


@shared_router.get("/shared-reports/{share_token}/gsea/status")
async def get_report_gsea_status(share_token: str):
    """Read GSEA run status from the report's gsea_run_status.json."""
    report_id, report_dir, _meta = _get_shared_report_or_404(share_token)
    p = report_dir / "gsea_run_status.json"
    if not p.exists():
        return {"status": "idle"}
    data = await read_json_file(p)
    if (
        data.get("status") == "running"
        and not _report_task_recently_started(data)
        and not task_manager.has_active_task(_report_task_key(report_id), TaskKind.GSEA)
    ):
        data["status"] = "error"
        data["error"] = "server_restarted"
        await write_json_file(p, data, indent=2, default=str)
    return data


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
    await write_json_file(p, data, indent=2, default=str)


async def _report_background_gsea_run(
    report_id: str,
    report_dir: Path,
    comparison: str,
    databases: list[str],
    min_size: int,
    max_size: int,
    permutations: int,
    de_file: Path,
    temporary_input: bool,
    lock: asyncio.Lock,
) -> None:
    from app.api.routes.visualization import VALID_GSEA_DATABASES
    from app.services.gsea_service import gsea_service

    results_dir = report_dir / "results"
    gsea_output_dir = results_dir / "gsea" / comparison

    status_data: dict = {
        "status": "running",
        "comparison": comparison,
        "databases": {db: "running" for db in databases if db in VALID_GSEA_DATABASES},
        "started_at": datetime.now(UTC).isoformat(),
        "error": None,
    }
    gsea_output_dir.mkdir(parents=True, exist_ok=True)
    await _report_write_gsea_status(report_dir, status_data)

    try:

        async def on_db_done(db_name: str, success: bool) -> None:
            status_data["databases"][db_name] = "completed" if success else "error"
            await _report_write_gsea_status(report_dir, status_data)

        def run_gsea_sync():
            return asyncio.run(
                gsea_service.run_gsea_for_comparison(
                    diff_expression_path=de_file,
                    comparison_name=comparison,
                    output_dir=gsea_output_dir,
                    databases=databases,
                    protein_abundance_path=None,
                    min_size=min_size,
                    max_size=max_size,
                    permutations=permutations,
                    on_db_complete=on_db_done,
                )
            )

        gsea_results = await task_manager.submit(
            _report_task_key(report_id),
            TaskKind.GSEA,
            run_gsea_sync,
            label=f"Shared report GSEA: {comparison}",
            timeout_seconds=30 * 60,
        )

        status_data["status"] = "completed"
        await _report_write_gsea_status(report_dir, status_data)

        results_file = gsea_output_dir / "GSEA_Results.json"
        await asyncio.to_thread(gsea_service.save_results, gsea_results, results_file)
        from app.api.routes.visualization import _gsea_file_cache

        _gsea_file_cache.remove(str(results_file))

    except TaskCancelledError:
        status_data["status"] = "error"
        status_data["error"] = "Task cancelled"
        await _report_write_gsea_status(report_dir, status_data)
    except TaskTimeoutError:
        status_data["status"] = "error"
        status_data["error"] = "Task timed out after 30 minutes"
        await _report_write_gsea_status(report_dir, status_data)
    except Exception as e:
        logger.error(f"Report GSEA background run failed: {e}")
        status_data["status"] = "error"
        status_data["error"] = str(e)
        await _report_write_gsea_status(report_dir, status_data)
    finally:
        if temporary_input:
            de_file.unlink(missing_ok=True)
        lock.release()
        _report_gsea_locks.pop(str(report_dir), None)


@shared_router.post("/shared-reports/{share_token}/gsea/run")
async def run_report_gsea(share_token: str, request: ReportGseaRunRequest):
    """Run GSEA on report data."""
    report_id, report_dir, _meta = _get_shared_report_or_404(share_token)
    comparison = request.comparison
    databases = request.databases
    min_size = request.min_size
    max_size = request.max_size
    permutations = request.permutations
    _validate_comparisons(report_dir, [comparison])

    lock_key = str(report_dir)
    if lock_key not in _report_gsea_locks:
        _report_gsea_locks[lock_key] = asyncio.Lock()

    run_lock = _report_gsea_locks[lock_key]
    if run_lock.locked():
        raise HTTPException(
            status_code=409,
            detail="A GSEA run is already in progress for this report",
        )

    results_dir = report_dir / "results"
    gsea_output_dir = results_dir / "gsea" / comparison
    from app.services.differential_repository import DifferentialRepository

    try:
        repository = await asyncio.to_thread(DifferentialRepository, results_dir)
        de_file = await asyncio.to_thread(
            repository.export_comparison_tsv,
            comparison,
            gsea_output_dir / ".differential_input.tsv",
        )
        temporary_input = True
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error

    await run_lock.acquire()

    task = asyncio.create_task(
        _report_background_gsea_run(
            report_id=report_id,
            report_dir=report_dir,
            comparison=comparison,
            databases=databases,
            min_size=min_size,
            max_size=max_size,
            permutations=permutations,
            de_file=de_file,
            temporary_input=temporary_input,
            lock=run_lock,
        )
    )
    _report_background_tasks.add(task)
    task.add_done_callback(_report_background_tasks.discard)

    return {"status": "started", "comparison": comparison, "databases": databases}


@shared_router.get("/shared-reports/{share_token}/gsea/{database}")
async def get_report_gsea_results(
    share_token: str,
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
    report_id, report_dir, _meta = _get_shared_report_or_404(share_token)
    if comparison:
        _validate_comparisons(report_dir, [comparison])
    base_results_dir = report_dir / "results"
    results_dir = (
        base_results_dir / "gsea" / comparison if comparison else base_results_dir
    )

    from app.api.routes.visualization import (
        VALID_GSEA_DATABASES,
        create_response,
        load_gsea_results,
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


@shared_router.get("/shared-reports/{share_token}/gsea/{database}/plot")
async def get_report_gsea_plot(
    share_token: str,
    database: str,
    term: str = Query(...),
    comparison: str = Query(""),
):
    """Get GSEA enrichment plot data for a specific pathway."""
    report_id, report_dir, _meta = _get_shared_report_or_404(share_token)
    if comparison:
        _validate_comparisons(report_dir, [comparison])
    base_results_dir = report_dir / "results"
    results_dir = (
        base_results_dir / "gsea" / comparison if comparison else base_results_dir
    )

    from app.api.routes.visualization import (
        VALID_GSEA_DATABASES,
        create_response,
        load_gsea_results,
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


@shared_router.get("/shared-reports/{share_token}/gsea/{database}/heatmap")
async def get_report_gsea_heatmap(
    share_token: str,
    database: str,
    term: str = Query(...),
    comparison: str = Query(""),
):
    """Get GSEA heatmap data (z-scores for leading-edge genes)."""
    report_id, report_dir, _meta = _get_shared_report_or_404(share_token)
    if comparison:
        _validate_comparisons(report_dir, [comparison])
    base_results_dir = report_dir / "results"
    results_dir = (
        base_results_dir / "gsea" / comparison if comparison else base_results_dir
    )

    from app.api.routes.visualization import (
        VALID_GSEA_DATABASES,
        create_response,
        load_gsea_results,
    )
    from app.services.abundance_repository import AbundanceRepository

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
        return create_response(
            {
                "genes": [],
                "protein_accessions": [],
                "samples": [],
                "conditions": [],
                "replicates": [],
                "z_scores": [],
                "log2_abundances": [],
            }
        )

    try:
        repository = await asyncio.to_thread(AbundanceRepository, base_results_dir)
        effective_comparison = comparison or await asyncio.to_thread(
            repository.first_comparison_id
        )
        heatmap_data = await asyncio.to_thread(
            repository.get_gene_heatmap,
            genes=lead_genes,
            comparison_id=effective_comparison,
        )
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error

    return create_response(heatmap_data)


# ---------------------------------------------------------------------------
# BioNet -- run / status / subnetwork
# ---------------------------------------------------------------------------


async def _report_background_bionet_run(
    report_id: str,
    report_dir: Path,
    request_body: dict,
    de_file: Path,
    temporary_input: bool,
    lock: asyncio.Lock,
) -> None:
    from app.services.bionet_service import bionet_service

    bionet_dir = report_dir / "bionet"
    bionet_dir.mkdir(parents=True, exist_ok=True)

    status_data: dict = {
        "status": "running",
        "comparison": request_body.get("comparison", ""),
        "started_at": datetime.now(UTC).isoformat(),
        "error": None,
    }
    status_file = bionet_dir / "bionet_status.json"
    await write_json_file(status_file, status_data, indent=2, default=str)

    try:
        nodes_csv = bionet_dir / "nodes.csv"
        edges_csv = bionet_dir / "edges.csv"

        node_count, edge_count = await task_manager.submit(
            _report_task_key(report_id),
            TaskKind.BIONET,
            bionet_service.run_bionet,
            de_file,
            request_body,
            nodes_csv,
            edges_csv,
            label=f"Shared report BioNet: {request_body['comparison']}",
            timeout_seconds=30 * 60,
        )

        import pandas as pd

        nodes_df, edges_df = await asyncio.gather(
            asyncio.to_thread(pd.read_csv, nodes_csv),
            asyncio.to_thread(pd.read_csv, edges_csv),
        )
        subnetwork = {
            "nodes": nodes_df.to_dict(orient="records"),
            "edges": edges_df.to_dict(orient="records"),
        }
        subnetwork_path = bionet_dir / "bionet_subnetwork.json"
        await write_json_file(subnetwork_path, subnetwork, indent=2, default=str)

        status_data["status"] = "completed"
        status_data["node_count"] = node_count
        status_data["edge_count"] = edge_count
        status_data["completed_at"] = datetime.now(UTC).isoformat()
        await write_json_file(status_file, status_data, indent=2, default=str)
    except TaskCancelledError:
        status_data["status"] = "error"
        status_data["error"] = "Task cancelled"
        await write_json_file(status_file, status_data, indent=2, default=str)
    except TaskTimeoutError:
        status_data["status"] = "error"
        status_data["error"] = "Task timed out after 30 minutes"
        await write_json_file(status_file, status_data, indent=2, default=str)
    except Exception as e:
        logger.error(f"Report BioNet background run failed: {e}")
        status_data["status"] = "error"
        status_data["error"] = str(e)
        await write_json_file(status_file, status_data, indent=2, default=str)
    finally:
        if temporary_input:
            de_file.unlink(missing_ok=True)
        lock.release()
        _report_bionet_locks.pop(str(report_dir), None)


@shared_router.post("/shared-reports/{share_token}/bionet/run")
async def run_report_bionet(share_token: str, request: ReportBioNetRunRequest):
    """Run BioNet on report data."""
    report_id, report_dir, _meta = _get_shared_report_or_404(share_token)
    body = request.model_dump()
    comparison = request.comparison
    _validate_comparisons(report_dir, [comparison])

    lock_key = str(report_dir)
    if lock_key not in _report_bionet_locks:
        _report_bionet_locks[lock_key] = asyncio.Lock()

    run_lock = _report_bionet_locks[lock_key]
    if run_lock.locked():
        raise HTTPException(
            status_code=409,
            detail="A BioNet analysis is already running for this report",
        )

    results_dir = report_dir / "results"
    from app.services.differential_repository import DifferentialRepository

    try:
        repository = await asyncio.to_thread(DifferentialRepository, results_dir)
        de_file = await asyncio.to_thread(
            repository.export_comparison_tsv,
            comparison,
            report_dir / "bionet" / ".differential_input.tsv",
        )
        temporary_input = True
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error

    await run_lock.acquire()

    task = asyncio.create_task(
        _report_background_bionet_run(
            report_id=report_id,
            report_dir=report_dir,
            request_body=body,
            de_file=de_file,
            temporary_input=temporary_input,
            lock=run_lock,
        )
    )
    _report_background_tasks.add(task)
    task.add_done_callback(_report_background_tasks.discard)

    return {"status": "started", "comparison": comparison}


@shared_router.get("/shared-reports/{share_token}/bionet/status")
async def get_report_bionet_status(share_token: str):
    """Read BioNet run status from the report."""
    report_id, report_dir, _meta = _get_shared_report_or_404(share_token)
    p = report_dir / "bionet" / "bionet_status.json"
    if not p.exists():
        return {"status": "idle"}
    data = await read_json_file(p)
    if (
        data.get("status") == "running"
        and not _report_task_recently_started(data)
        and not task_manager.has_active_task(
            _report_task_key(report_id), TaskKind.BIONET
        )
    ):
        data["status"] = "error"
        data["error"] = "server_restarted"
        await write_json_file(p, data, indent=2, default=str)
    return data


@shared_router.get("/shared-reports/{share_token}/bionet/subnetwork")
async def get_report_bionet_subnetwork(share_token: str):
    """Return the BioNet subnetwork JSON."""
    _report_id, report_dir, _meta = _get_shared_report_or_404(share_token)
    p = report_dir / "bionet" / "bionet_subnetwork.json"
    if not p.exists():
        raise HTTPException(status_code=404, detail="No BioNet subnetwork available")
    return await read_json_file(p)


# ---------------------------------------------------------------------------
# Protein abundance / peptide
# ---------------------------------------------------------------------------


@shared_router.get("/shared-reports/{share_token}/protein/{protein_id}/abundance")
async def get_report_protein_abundance(
    share_token: str,
    protein_id: str,
    comparison: str = Query(""),
    layer: str = Query("protein"),
    point_budget: int = Query(100_000, ge=0, le=500_000),
):
    """Get protein abundance data, optionally filtered by comparison."""
    _report_id, report_dir, _meta = _get_shared_report_or_404(share_token)
    if comparison:
        _validate_comparisons(report_dir, [comparison])
    results_dir = report_dir / "results"
    from app.api.routes.visualization import create_response
    from app.services.abundance_repository import AbundanceRepository

    try:
        repository = await asyncio.to_thread(AbundanceRepository, results_dir)
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    effective_comparison = comparison or await asyncio.to_thread(
        repository.first_comparison_id
    )
    try:
        data = await asyncio.to_thread(
            repository.get_summary,
            entity="protein",
            protein_accession=protein_id,
            comparison_id=effective_comparison,
            result_layer=layer,
            point_budget=point_budget,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return create_response(data)


@shared_router.get("/shared-reports/{share_token}/protein/{protein_id}/peptide")
async def get_report_protein_peptide(
    share_token: str,
    protein_id: str,
    comparison: str = Query(""),
    layer: str = Query("protein"),
    point_budget: int = Query(100_000, ge=0, le=500_000),
):
    """Get peptide abundance data for a protein."""
    _report_id, report_dir, _meta = _get_shared_report_or_404(share_token)
    if comparison:
        _validate_comparisons(report_dir, [comparison])
    results_dir = report_dir / "results"
    from app.api.routes.visualization import create_response
    from app.services.abundance_repository import AbundanceRepository

    try:
        repository = await asyncio.to_thread(AbundanceRepository, results_dir)
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    effective_comparison = comparison or await asyncio.to_thread(
        repository.first_comparison_id
    )
    try:
        data = await asyncio.to_thread(
            repository.get_summary,
            entity="peptide",
            protein_accession=protein_id,
            comparison_id=effective_comparison,
            result_layer=layer,
            point_budget=point_budget,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
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
    with open(sp, encoding="utf-8") as f:
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
        accession_matches,
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
            if accession_matches(acc, protein_id):
                query_idx = i
                break
        if query_idx is None:
            raise ValueError(f"Protein {protein_id} not found in any comparison")

        pvals = load_pvalues_for_protein(report_dir_str, comparisons, protein_id)
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
                "completed_at": datetime.now(UTC).isoformat(),
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
                "completed_at": datetime.now(UTC).isoformat(),
            },
        )


def _run_report_comparison_correlation(report_dir: Path, body: dict) -> None:
    """Background task: compute comparison correlation analysis for a report."""
    import numpy as np

    from app.services.compare_service import (
        _load_de_file,
        build_fold_change_matrix,
        compute_hierarchical_order,
        compute_similarity_matrix,
        run_cluster,
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
                "completed_at": datetime.now(UTC).isoformat(),
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
                "completed_at": datetime.now(UTC).isoformat(),
            },
        )


def _run_report_scalable_comparison_correlation(
    report_id: str, report_dir: Path, _body: dict
) -> None:
    """Build the report snapshot's complete resumable Pearson artifact."""
    from app.services.comparison_correlation import (
        build_comparison_correlation_artifact,
    )

    compute_type = "comparison-correlation"
    started_at = _report_compare_read_status(report_dir, compute_type).get("started_at")

    def update_progress(completed: int, total: int) -> None:
        _report_compare_write_status(
            report_dir,
            compute_type,
            {
                "status": "running",
                "method": "pearson",
                "started_at": started_at,
                "progress": {"completed": completed, "total": total},
            },
        )

    metadata = build_comparison_correlation_artifact(
        report_dir / "results",
        progress_callback=update_progress,
        cancel_requested=lambda: task_manager.is_cancel_requested(
            _report_task_key(report_id)
        ),
    )
    _report_compare_write_status(
        report_dir,
        compute_type,
        {
            "status": "completed",
            "method": "pearson",
            "comparison_count": metadata["comparison_count"],
            "feature_count": metadata["feature_count"],
            "started_at": started_at,
            "completed_at": datetime.now(UTC).isoformat(),
        },
    )


async def _schedule_report_background(coro) -> asyncio.Task:
    task = asyncio.create_task(coro)
    _report_background_tasks.add(task)
    task.add_done_callback(_report_background_tasks.discard)
    return task


async def _run_report_compute_task(
    report_id: str,
    report_dir: Path,
    compute_type: str,
    body: dict,
) -> None:
    """Run one report comparison job through the global compute queue."""
    scalable = (
        compute_type == "comparison-correlation"
        and _report_pipeline(report_dir) in {"msstats", "msqrob2"}
        and (report_dir / "results" / "differential_results.parquet").is_file()
        and (report_dir / "results" / "comparison_catalog.parquet").is_file()
    )
    if scalable:
        runner = _run_report_scalable_comparison_correlation
        runner_args = (report_id, report_dir, body)
    elif compute_type == "protein-correlation":
        runner = _run_report_protein_correlation
        runner_args = (report_dir, body)
    else:
        runner = _run_report_comparison_correlation
        runner_args = (report_dir, body)
    try:
        await task_manager.submit(
            _report_task_key(report_id),
            TaskKind.COMPUTE,
            runner,
            *runner_args,
            label=f"Shared report: {compute_type}",
            timeout_seconds=24 * 60 * 60 if scalable else 10 * 60,
        )
    except TaskCancelledError:
        await asyncio.to_thread(
            _report_compare_write_status,
            report_dir,
            compute_type,
            {"status": "error", "error": "Task cancelled"},
        )
    except TaskTimeoutError:
        await asyncio.to_thread(
            _report_compare_write_status,
            report_dir,
            compute_type,
            {"status": "error", "error": "Task timed out after 10 minutes"},
        )
    except Exception:
        logger.exception("Shared report comparison task failed")


@shared_router.post("/shared-reports/{share_token}/compare/protein-correlation")
async def run_report_protein_correlation(
    share_token: str, request: ReportProteinCorrelationRequest
):
    """Run protein-correlation analysis on report data."""
    report_id, report_dir, _meta = _get_shared_report_or_404(share_token)
    body = request.model_dump()
    _validate_comparisons(report_dir, [request.color_comparison])

    if task_manager.has_active_task(_report_task_key(report_id), TaskKind.COMPUTE):
        raise HTTPException(status_code=409, detail="Computation already in progress")

    compare_dir = report_dir / "results" / "compare"
    await asyncio.to_thread(compare_dir.mkdir, parents=True, exist_ok=True)

    lock_key = str(report_dir) + ":protein-correlation"
    if lock_key not in _report_compare_locks:
        _report_compare_locks[lock_key] = asyncio.Lock()

    lock = _report_compare_locks[lock_key]
    async with lock:
        status = await asyncio.to_thread(
            _report_compare_read_status, report_dir, "protein-correlation"
        )
        if status.get("status") == "running":
            raise HTTPException(
                status_code=409, detail="Computation already in progress"
            )
        await asyncio.to_thread(
            _report_compare_write_status,
            report_dir,
            "protein-correlation",
            {
                "status": "running",
                "started_at": datetime.now(UTC).isoformat(),
            },
        )

    await _schedule_report_background(
        _run_report_compute_task(report_id, report_dir, "protein-correlation", body)
    )
    return {"status": "running"}


@shared_router.get("/shared-reports/{share_token}/compare/protein-correlation/status")
async def get_report_protein_correlation_status(share_token: str):
    """Read protein-correlation run status."""
    report_id, report_dir, _meta = _get_shared_report_or_404(share_token)
    data = await asyncio.to_thread(
        _report_compare_read_status, report_dir, "protein-correlation"
    )
    if (
        data.get("status") == "running"
        and not _report_task_recently_started(data)
        and not task_manager.has_active_task(
            _report_task_key(report_id), TaskKind.COMPUTE
        )
    ):
        data = {"status": "error", "error": "server_restarted"}
        await asyncio.to_thread(
            _report_compare_write_status,
            report_dir,
            "protein-correlation",
            data,
        )
    return data


@shared_router.get("/shared-reports/{share_token}/compare/protein-correlation")
async def get_report_protein_correlation_results(share_token: str):
    """Return protein-correlation results."""
    _report_id, report_dir, _meta = _get_shared_report_or_404(share_token)
    rp = _report_compare_result_path(report_dir, "protein-correlation")
    if not rp.exists():
        raise HTTPException(
            status_code=404, detail="No protein correlation results available"
        )
    return await read_json_file(rp)


@shared_router.post("/shared-reports/{share_token}/compare/comparison-correlation")
async def run_report_comparison_correlation(
    share_token: str, request: ReportComparisonCorrelationRequest
):
    """Run comparison-correlation analysis on report data."""
    report_id, report_dir, _meta = _get_shared_report_or_404(share_token)
    body = request.model_dump()
    _validate_comparisons(
        report_dir,
        [request.primary_comparison, *request.selected_comparisons],
    )

    if task_manager.has_active_task(_report_task_key(report_id), TaskKind.COMPUTE):
        raise HTTPException(status_code=409, detail="Computation already in progress")

    compare_dir = report_dir / "results" / "compare"
    await asyncio.to_thread(compare_dir.mkdir, parents=True, exist_ok=True)

    lock_key = str(report_dir) + ":comparison-correlation"
    if lock_key not in _report_compare_locks:
        _report_compare_locks[lock_key] = asyncio.Lock()

    lock = _report_compare_locks[lock_key]
    async with lock:
        status = await asyncio.to_thread(
            _report_compare_read_status, report_dir, "comparison-correlation"
        )
        if status.get("status") == "running":
            raise HTTPException(
                status_code=409, detail="Computation already in progress"
            )
        await asyncio.to_thread(
            _report_compare_write_status,
            report_dir,
            "comparison-correlation",
            {
                "status": "running",
                "started_at": datetime.now(UTC).isoformat(),
            },
        )

    await _schedule_report_background(
        _run_report_compute_task(report_id, report_dir, "comparison-correlation", body)
    )
    return {"status": "running"}


@shared_router.get(
    "/shared-reports/{share_token}/compare/comparison-correlation/status"
)
async def get_report_comparison_correlation_status(share_token: str):
    """Read comparison-correlation run status."""
    report_id, report_dir, _meta = _get_shared_report_or_404(share_token)
    data = await asyncio.to_thread(
        _report_compare_read_status, report_dir, "comparison-correlation"
    )
    if (
        data.get("status") == "running"
        and not _report_task_recently_started(data)
        and not task_manager.has_active_task(
            _report_task_key(report_id), TaskKind.COMPUTE
        )
    ):
        data = {"status": "error", "error": "server_restarted"}
        await asyncio.to_thread(
            _report_compare_write_status,
            report_dir,
            "comparison-correlation",
            data,
        )
    return data


@shared_router.get("/shared-reports/{share_token}/compare/comparison-correlation")
async def get_report_comparison_correlation_results(share_token: str):
    """Return comparison-correlation results."""
    _report_id, report_dir, _meta = _get_shared_report_or_404(share_token)
    pipeline = _report_pipeline(report_dir)
    if pipeline == "ptm":
        rp = _report_compare_result_path(report_dir, "comparison-correlation")
        if not rp.exists():
            raise HTTPException(
                status_code=404,
                detail="No comparison correlation results available",
            )
        return await read_json_file(rp)
    if pipeline not in {"msstats", "msqrob2"}:
        raise HTTPException(
            status_code=409,
            detail="Visualization data must be reprocessed for this report",
        )
    from app.services.comparison_correlation import ComparisonCorrelationArtifact

    try:
        artifact = await asyncio.to_thread(
            ComparisonCorrelationArtifact, report_dir / "results"
        )
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return artifact.public_metadata()


async def _report_correlation_artifact_or_404(
    share_token: str,
):
    _report_id, report_dir, _meta = _get_shared_report_or_404(share_token)
    if _report_pipeline(report_dir) == "ptm":
        raise HTTPException(
            status_code=404,
            detail="PTM Compare uses its existing workflow",
        )
    from app.services.comparison_correlation import ComparisonCorrelationArtifact

    try:
        return await asyncio.to_thread(
            ComparisonCorrelationArtifact, report_dir / "results"
        )
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@shared_router.get("/shared-reports/{share_token}/compare/comparison-correlation/tile")
async def get_report_comparison_correlation_tile(
    share_token: str,
    level: int = Query(..., ge=0),
    row: int = Query(..., ge=0),
    column: int = Query(..., ge=0),
):
    artifact = await _report_correlation_artifact_or_404(share_token)
    try:
        return await asyncio.to_thread(
            artifact.get_tile, level=level, row=row, column=column
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@shared_router.get("/shared-reports/{share_token}/compare/comparison-correlation/cell")
async def get_report_comparison_correlation_cell(
    share_token: str,
    row: int = Query(..., ge=0),
    column: int = Query(..., ge=0),
):
    artifact = await _report_correlation_artifact_or_404(share_token)
    try:
        return await asyncio.to_thread(artifact.get_cell, row, column)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@shared_router.get(
    "/shared-reports/{share_token}/compare/comparison-correlation/lookup"
)
async def lookup_report_comparison_correlation(
    share_token: str,
    comparison: ComparisonName,
    limit: int = Query(20, ge=1, le=100),
):
    _report_id, report_dir, _meta = _get_shared_report_or_404(share_token)
    _validate_comparisons(report_dir, [comparison])
    artifact = await _report_correlation_artifact_or_404(share_token)
    try:
        return await asyncio.to_thread(
            artifact.lookup_reference, comparison, limit=limit
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@shared_router.get(
    "/shared-reports/{share_token}/compare/comparison-correlation/spearman"
)
async def get_report_comparison_spearman(
    share_token: str,
    left: ComparisonName,
    right: ComparisonName,
):
    _report_id, report_dir, _meta = _get_shared_report_or_404(share_token)
    _validate_comparisons(report_dir, [left, right])
    artifact = await _report_correlation_artifact_or_404(share_token)
    try:
        return await asyncio.to_thread(artifact.get_spearman, left, right)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@shared_router.post(
    "/shared-reports/{share_token}/compare/comparison-correlation/detail"
)
async def get_report_comparison_fold_change_detail(
    share_token: str, request: ReportComparisonDetailRequest
):
    _report_id, report_dir, _meta = _get_shared_report_or_404(share_token)
    _validate_comparisons(report_dir, request.comparisons)
    artifact = await _report_correlation_artifact_or_404(share_token)
    try:
        return await asyncio.to_thread(
            artifact.get_fold_change_detail,
            request.comparisons,
            protein_ids=request.proteins,
            max_proteins=request.max_proteins,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@shared_router.post("/shared-reports/{share_token}/compare/venn")
async def run_report_venn(share_token: str, request: ReportVennRequest):
    """Compute Venn diagram data for report comparisons."""
    report_id, report_dir, _meta = _get_shared_report_or_404(share_token)
    comparisons = request.comparisons
    _validate_comparisons(report_dir, comparisons)

    from app.services.compare_service import compute_venn_data

    result = await task_manager.submit(
        _report_task_key(report_id),
        TaskKind.COMPUTE,
        compute_venn_data,
        str(report_dir),
        comparisons,
        request.pvalue_threshold,
        request.logfc_threshold,
        label=f"Shared report Venn: {'+'.join(comparisons)}",
        timeout_seconds=5 * 60,
    )
    return result


@shared_router.get("/shared-reports/{share_token}/compare/proteins")
async def get_report_compare_proteins(share_token: str):
    """List all proteins across all comparisons."""
    _report_id, report_dir, _meta = _get_shared_report_or_404(share_token)
    results_dir = report_dir / "results"
    comparisons = _get_comparisons(results_dir)
    if not comparisons:
        return []

    from app.services.compare_service import build_fold_change_matrix

    def _load():
        _matrix, accessions, gene_names = build_fold_change_matrix(
            str(report_dir), comparisons
        )
        return [
            {"accession": acc, "gene_name": gn}
            for acc, gn in zip(accessions, gene_names, strict=False)
        ]

    return await asyncio.to_thread(_load)
