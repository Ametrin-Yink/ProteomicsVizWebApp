"""Session visualization capability manifest routes."""

from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import get_session_store
from app.api.routes.visualization_shared import create_response
from app.core.config import settings
from app.db.session_store import SessionStore
from app.models.session import Session

router = APIRouter()


def build_visualization_manifest(session: Session, results_dir: Path) -> dict[str, Any]:
    """Describe which visualization modules and data scopes a session supports."""
    if session.pipeline != "ptm":
        return {
            "pipeline": session.pipeline,
            "default_module": "volcano",
            "modules": [
                {
                    "id": module_id,
                    "visible": True,
                    "enabled": True,
                    "disabled_reason": None,
                    "data_scopes": ["protein"],
                }
                for module_id in ("volcano", "qc", "gsea", "compare", "bionet")
            ],
        }

    has_ptm = (results_dir / "ptm_site_results.tsv").exists()
    has_protein = (results_dir / "protein_results.tsv").exists()
    has_adjusted_ptm = (results_dir / "adjusted_ptm_results.tsv").exists()
    comparison_count = len(session.config.comparisons or []) if session.config else 0

    ptm_scopes = ["ptm"] if has_ptm else []
    protein_scopes = ["protein"] if has_protein else []
    adjusted_scopes = ["adjusted_ptm"] if has_adjusted_ptm else []
    volcano_scopes = ptm_scopes + protein_scopes + adjusted_scopes
    compare_enabled = has_ptm and comparison_count >= 2
    if not has_ptm:
        compare_reason = "PTM results are not available"
    elif comparison_count < 2:
        compare_reason = "At least two comparisons are required"
    else:
        compare_reason = None

    return {
        "pipeline": "ptm",
        "default_module": "volcano",
        "modules": [
            {
                "id": "volcano",
                "visible": True,
                "enabled": has_ptm,
                "disabled_reason": None if has_ptm else "PTM results are not available",
                "data_scopes": volcano_scopes,
            },
            {
                "id": "qc",
                "visible": True,
                "enabled": has_ptm,
                "disabled_reason": None if has_ptm else "PTM results are not available",
                "data_scopes": ptm_scopes + protein_scopes,
            },
            {
                "id": "compare",
                "visible": True,
                "enabled": compare_enabled,
                "disabled_reason": compare_reason,
                "data_scopes": volcano_scopes,
            },
            {
                "id": "gsea",
                "visible": has_protein,
                "enabled": has_protein,
                "disabled_reason": None,
                "data_scopes": protein_scopes,
            },
            {
                "id": "bionet",
                "visible": has_protein,
                "enabled": has_protein,
                "disabled_reason": None,
                "data_scopes": protein_scopes,
            },
        ],
    }


@router.get("/{session_id}/visualization/manifest")
async def get_visualization_manifest(
    session_id: str,
    store: SessionStore = Depends(get_session_store),
):
    session = await store.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found",
        )
    results_dir = settings.sessions_dir / session_id / "results"
    return create_response(build_visualization_manifest(session, results_dir))
