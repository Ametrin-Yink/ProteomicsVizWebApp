#!/usr/bin/env python3
"""
Comprehensive browser automation test for ProteomicsViz WebApp
Tests all reported bugs and fixes
"""

from playwright.sync_api import sync_playwright, expect
import time
import os

def test_data_input_page():
    """Test Data Input & Configuration page fixes"""
    print("\n=== Testing Data Input & Configuration Page ===")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, slow_mo=100)
        context = browser.new_context(viewport={'width': 1920, 'height': 1080})
        page = context.new_page()

        # Capture console errors
        page.on('console', lambda msg: print(f"Console: {msg.text}") if msg.type == 'error' else None)
        page.on('pageerror', lambda err: print(f"Page Error: {err}"))

        try:
            # Navigate to data input page
            print("Navigating to data input page...")
            page.goto('http://localhost:3000/analysis')
            page.wait_for_load_state('networkidle')
            time.sleep(2)

            # Test 1: Multiple file upload
            print("\n1. Testing multiple file upload...")
            # Create session first
            page.click('button:has-text("Create New Session")')
            time.sleep(1)

            # Upload multiple files
            file_input = page.locator('input[type="file"]').first
            test_files = [
                'D:/CodingWorks/ProteomicsVizWebApp/test-data/PSM_SampleData_DMSO_1.csv',
                'D:/CodingWorks/ProteomicsVizWebApp/test-data/PSM_SampleData_DMSO_2.csv',
                'D:/CodingWorks/ProteomicsVizWebApp/test-data/PSM_SampleData_INCZ123456_1.csv'
            ]

            # Check if test files exist
            existing_files = [f for f in test_files if os.path.exists(f)]
            if existing_files:
                file_input.set_input_files(existing_files)
                print(f"   Uploaded {len(existing_files)} files")
                time.sleep(3)

                # Verify files appear in list
                file_items = page.locator('[data-testid="file-item"]').count()
                print(f"   Files in list: {file_items}")

                # Take screenshot
                page.screenshot(path='test-results/01-multiple-upload.png', full_page=True)
            else:
                print("   Test files not found, skipping upload test")

            # Test 2: Compound structure display
            print("\n2. Testing compound structure display...")
            # Upload compound file if available
            compound_file = 'D:/CodingWorks/ProteomicsVizWebApp/test-data/compounds.csv'
            if os.path.exists(compound_file):
                compound_input = page.locator('input[type="file"]').nth(1)
                compound_input.set_input_files(compound_file)
                time.sleep(2)

                # Check if compound display appears
                compound_display = page.locator('[data-testid="compound-info"]').is_visible()
                print(f"   Compound display visible: {compound_display}")
                page.screenshot(path='test-results/02-compound-display.png', full_page=True)
            else:
                print("   Compound file not found, skipping")

            browser.close()
            print("Data Input tests completed")

        except Exception as e:
            print(f"Error in data input test: {e}")
            page.screenshot(path='test-results/error-data-input.png', full_page=True)
            browser.close()
            raise

def test_processing_page():
    """Test Processing Data page fixes"""
    print("\n=== Testing Processing Data Page ===")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, slow_mo=100)
        context = browser.new_context(viewport={'width': 1920, 'height': 1080})
        page = context.new_page()

        page.on('console', lambda msg: print(f"Console: {msg.text}") if msg.type == 'error' else None)

        try:
            # Navigate to processing page with a session
            print("Navigating to processing page...")
            page.goto('http://localhost:3000/analysis/processing?session_id=test-session-123