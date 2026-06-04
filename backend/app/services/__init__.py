"""Services module.

This module provides various services for the proteomics analysis pipeline:
- compound_service: Compound structure handling with RDKit
- data_processor: PSM data processing (Steps 1-5)
- msqrob2_wrapper: R/msqrob2 integration (Steps 6-7)
- qc_calculator: QC metrics calculation (Step 8)
- session_manager: Session lifecycle management
"""

from app.services.compound_service import CompoundService, compound_service
from app.services.data_processor import DataProcessor
from app.services.qc_calculator import QCCalculator
from app.services.session_manager import SessionManager, session_manager

__all__ = [
    "CompoundService",
    "DataProcessor",
    "QCCalculator",
    "SessionManager",
    "compound_service",
    "session_manager",
]
