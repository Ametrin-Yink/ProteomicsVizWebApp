"""Services module.

This module provides various services for the proteomics analysis pipeline:
- report_generator: PDF report generation using Playwright
- compound_service: Compound structure handling with RDKit
- plot_generator: Static plot generation for PDF reports
- data_processor: PSM data processing (Steps 1-5)
- msqrob2_wrapper: R/msqrob2 integration (Steps 6-7)
- qc_calculator: QC metrics calculation (Step 8)
- session_manager: Session lifecycle management
"""

from app.services.report_generator import report_generator, ReportGenerator
from app.services.compound_service import compound_service, CompoundService
from app.services.plot_generator import plot_generator, PlotGenerator
from app.services.data_processor import DataProcessor, process_psm_files
from app.services.qc_calculator import QCCalculator
from app.services.session_manager import session_manager, SessionManager

__all__ = [
    "report_generator",
    "ReportGenerator",
    "compound_service",
    "CompoundService",
    "plot_generator",
    "PlotGenerator",
    "DataProcessor",
    "process_psm_files",
    "QCCalculator",
    "session_manager",
    "SessionManager",
]
