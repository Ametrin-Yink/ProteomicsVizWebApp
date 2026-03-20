#!/usr/bin/env python3
"""Test script to verify processing pipeline works."""

import asyncio
import sys
sys.path.insert(0, 'backend')

from app.services.processing_orchestrator import processing_orchestrator
from app.models.analysis import AnalysisConfig
from app.models.session import SessionState

async def test_processing():
    """Test the processing pipeline."""
    print("Testing processing pipeline...")
    
    # Create a test config
    config = AnalysisConfig(
        treatment="INCZ123456",
        control="DMSO",
        organism="human",
        remove_razor=True,
        strict_filtering=True,
    )
    
    # Create a simple callback
    async def test_callback(progress):
        print(f"Progress: Step {progress.step} - {progress.status} - {progress.progress}%")
    
    # Test with a session that has files
    session_id = "test-session-123"
    
    print(f"Config: {config}")
    print("Starting process_session...")
    
    try:
        result = await processing_orchestrator.process_session(
            session_id=session_id,
            config=config,
            websocket_callback=test_callback
        )
        print(f"Processing completed! Result: {result}")
    except Exception as e:
        print(f"Processing failed: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(test_processing())
