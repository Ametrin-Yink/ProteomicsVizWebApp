"""
Compound structure API routes.

Provides endpoints for compound structure visualization using RDKit.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response

from app.core.exceptions import SessionNotFoundError, ValidationError
from app.services.compound_service import compound_service
from app.services.session_manager import SessionManager

logger = logging.getLogger("proteomics")

router = APIRouter()


def get_session_manager(request: Request) -> SessionManager:
    """Get session manager from app state."""
    return request.app.state.session_manager


@router.get("/{session_id}/compounds/{condition}")
async def get_compound_structure(
    session_id: str,
    condition: str,
    format: str = Query(default="svg", pattern="^(svg|png)$"),
    width: int = Query(default=300, ge=100, le=800),
    height: int = Query(default=300, ge=100, le=800),
    session_manager: SessionManager = Depends(get_session_manager),
):
    """
    Get compound structure for a specific condition.

    Args:
        session_id: Session ID
        condition: Condition name (matches Corp ID or condition column)
        format: Output format ('svg' or 'png')
        width: Image width in pixels
        height: Image height in pixels
        session_manager: Session manager instance

    Returns:
        Compound structure data with image
    """
    try:
        # Get session
        session = await session_manager.get_session(session_id)

        # Check if compound file exists
        if not session.files or not session.files.compound:
            raise HTTPException(
                status_code=404, detail="No compound file uploaded for this session"
            )

        # Get uploads directory
        uploads_dir = await session_manager.get_uploads_dir(session_id)
        compound_filename = session.files.compound.filename
        compound_file = uploads_dir / compound_filename

        if not compound_file.exists():
            raise HTTPException(status_code=404, detail="Compound file not found")

        # Get compound data with structure
        compound_data = compound_service.get_compound_with_structure(
            condition=condition, compound_file=compound_file, format=format
        )

        if compound_data is None:
            raise HTTPException(
                status_code=404, detail=f"No compound found for condition: {condition}"
            )

        return compound_data

    except SessionNotFoundError:
        raise HTTPException(status_code=404, detail="Session not found")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting compound structure: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{session_id}/compounds/{condition}/image")
async def get_compound_image(
    session_id: str,
    condition: str,
    format: str = Query(default="svg", pattern="^(svg|png)$"),
    width: int = Query(default=300, ge=100, le=800),
    height: int = Query(default=300, ge=100, le=800),
    session_manager: SessionManager = Depends(get_session_manager),
):
    """
    Get compound structure image directly.

    Args:
        session_id: Session ID
        condition: Condition name
        format: Output format ('svg' or 'png')
        width: Image width in pixels
        height: Image height in pixels
        session_manager: Session manager instance

    Returns:
        Image response (SVG or PNG)
    """
    try:
        # Get session
        session = await session_manager.get_session(session_id)

        # Check if compound file exists
        if not session.files or not session.files.compound:
            raise HTTPException(
                status_code=404, detail="No compound file uploaded for this session"
            )

        # Get uploads directory
        uploads_dir = await session_manager.get_uploads_dir(session_id)
        compound_filename = session.files.compound.filename
        compound_file = uploads_dir / compound_filename

        if not compound_file.exists():
            raise HTTPException(status_code=404, detail="Compound file not found")

        # Get compound data
        compound = compound_service.get_compound_for_condition(condition, compound_file)

        if compound is None:
            raise HTTPException(
                status_code=404, detail=f"No compound found for condition: {condition}"
            )

        # Generate structure image
        structure_image = compound_service.generate_structure_image(
            smiles=compound.smiles, format=format, width=width, height=height
        )

        if structure_image is None:
            raise HTTPException(
                status_code=500, detail="Failed to generate structure image"
            )

        # Return appropriate response
        if format.lower() == "svg":
            return Response(content=structure_image, media_type="image/svg+xml")
        else:
            return Response(content=structure_image, media_type="image/png")

    except SessionNotFoundError:
        raise HTTPException(status_code=404, detail="Session not found")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting compound image: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{session_id}/compounds")
async def list_compounds(
    session_id: str,
    include_structures: bool = Query(default=False),
    session_manager: SessionManager = Depends(get_session_manager),
):
    """
    List all compounds in the session.

    Args:
        session_id: Session ID
        include_structures: Whether to include structure images
        session_manager: Session manager instance

    Returns:
        List of compounds
    """
    try:
        # Get session
        session = await session_manager.get_session(session_id)

        # Check if compound file exists
        if not session.files or not session.files.compound:
            return {"compounds": []}

        # Get uploads directory
        uploads_dir = await session_manager.get_uploads_dir(session_id)
        compound_filename = session.files.compound.filename
        compound_file = uploads_dir / compound_filename

        if not compound_file.exists():
            return {"compounds": []}

        # Get all compounds
        compounds = compound_service.get_all_compounds(
            compound_file=compound_file,
            include_structures=include_structures,
            format="svg",
        )

        return {"compounds": compounds}

    except SessionNotFoundError:
        raise HTTPException(status_code=404, detail="Session not found")
    except Exception as e:
        logger.error(f"Error listing compounds: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{session_id}/compounds/validate")
async def validate_compound_file(
    session_id: str, session_manager: SessionManager = Depends(get_session_manager)
):
    """
    Validate the compound file for a session.

    Args:
        session_id: Session ID
        session_manager: Session manager instance

    Returns:
        Validation results
    """
    try:
        # Get session
        session = await session_manager.get_session(session_id)

        # Check if compound file exists
        if not session.files or not session.files.compound:
            return {
                "valid": False,
                "error": "No compound file uploaded for this session",
                "compounds": [],
            }

        # Get uploads directory
        uploads_dir = await session_manager.get_uploads_dir(session_id)
        compound_filename = session.files.compound.filename
        compound_file = uploads_dir / compound_filename

        if not compound_file.exists():
            return {"valid": False, "error": "Compound file not found", "compounds": []}

        # Parse and validate
        try:
            compounds = compound_service.parse_compound_csv(compound_file)

            # Validate SMILES
            valid_count = 0
            invalid_count = 0

            for corp_id, compound in compounds.items():
                if compound_service.validate_smiles(compound.smiles):
                    valid_count += 1
                else:
                    invalid_count += 1

            return {
                "valid": True,
                "total_compounds": len(compounds),
                "valid_smiles": valid_count,
                "invalid_smiles": invalid_count,
                "compounds": [
                    {
                        "corp_id": c.corp_id,
                        "condition": c.condition,
                        "molecular_weight": c.molecular_weight,
                        "formula": c.formula,
                    }
                    for c in compounds.values()
                ],
            }

        except ValidationError as e:
            return {
                "valid": False,
                "error": e.message,
                "details": e.details,
                "compounds": [],
            }

    except SessionNotFoundError:
        raise HTTPException(status_code=404, detail="Session not found")
    except Exception as e:
        logger.error(f"Error validating compound file: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{session_id}/compounds/{condition}/properties")
async def get_compound_properties(
    session_id: str,
    condition: str,
    session_manager: SessionManager = Depends(get_session_manager),
):
    """
    Get molecular properties for a compound.

    Args:
        session_id: Session ID
        condition: Condition name
        session_manager: Session manager instance

    Returns:
        Molecular properties
    """
    try:
        # Get session
        session = await session_manager.get_session(session_id)

        # Check if compound file exists
        if not session.files or not session.files.compound:
            raise HTTPException(
                status_code=404, detail="No compound file uploaded for this session"
            )

        # Get uploads directory
        uploads_dir = await session_manager.get_uploads_dir(session_id)
        compound_filename = session.files.compound.filename
        compound_file = uploads_dir / compound_filename

        if not compound_file.exists():
            raise HTTPException(status_code=404, detail="Compound file not found")

        # Get compound data
        compound = compound_service.get_compound_for_condition(condition, compound_file)

        if compound is None:
            raise HTTPException(
                status_code=404, detail=f"No compound found for condition: {condition}"
            )

        # Get properties
        properties = compound_service.get_molecular_properties(compound.smiles)

        if properties is None:
            raise HTTPException(
                status_code=500, detail="Failed to calculate molecular properties"
            )

        return {
            "corp_id": compound.corp_id,
            "condition": compound.condition,
            "smiles": compound.smiles,
            "properties": properties,
        }

    except SessionNotFoundError:
        raise HTTPException(status_code=404, detail="Session not found")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting compound properties: {e}")
        raise HTTPException(status_code=500, detail=str(e))
