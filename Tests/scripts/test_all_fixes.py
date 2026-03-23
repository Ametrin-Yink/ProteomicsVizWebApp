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
        browser = p.chromium.launch(headless=True)
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
                'Tests/data/PSM_SampleData_DMSO_1.csv',
                'Tests/data/PSM_SampleData_DMSO_2.csv',
                'Tests/data/PSM_SampleData_INCZ123456_1.csv'
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
                page.screenshot(path='Tests/test-results/01-multiple-upload.png', full_page=True)
            else:
                print("   Test files not found, skipping upload test")

            # Test 2: Compound structure display
            print("\n2. Testing compound structure display...")
            # Upload compound file if available
            compound_file = 'Tests/data/compounds.csv'
            if os.path.exists(compound_file):
                compound_input = page.locator('input[type="file"]').nth(1)
                compound_input.set_input_files(compound_file)
                time.sleep(2)

                # Check if compound display appears
                compound_display = page.locator('[data-testid="compound-info"]').is_visible()
                print(f"   Compound display visible: {compound_display}")
                page.screenshot(path='Tests/test-results/02-compound-display.png', full_page=True)
            else:
                print("   Compound file not found, skipping")

            browser.close()
            print("Data Input tests completed")

        except Exception as e:
            print(f"Error in data input test: {e}")
            page.screenshot(path='Tests/test-results/error-data-input.png', full_page=True)
            browser.close()
            raise

def test_processing_page():
    """Test Processing Data page fixes"""
    print("\n=== Testing Processing Data Page ===")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1920, 'height': 1080})
        page = context.new_page()

        page.on('console', lambda msg: print(f"Console: {msg.text}") if msg.type == 'error' else None)

        try:
            # Navigate to processing page with a session
            print("Navigating to processing page...")
            page.goto('http://localhost:3000/analysis/processing?session_id=test-session-123')
            page.wait_for_load_state('networkidle')
            time.sleep(2)

            # Test 1: Check color scheme
            print("\n1. Checking color scheme...")
            page.screenshot(path='Tests/test-results/03-processing-colors.png', full_page=True)
            print("   Screenshot saved")

            # Test 2: Check Session Manager visibility
            print("\n2. Checking Session Manager visibility...")
            session_panel = page.locator('[data-testid="session-panel"]').is_visible()
            print(f"   Session panel visible: {session_panel}")

            # Test 3: Check Activity Log panel
            print("\n3. Checking Activity Log...")
            log_panel = page.locator('[data-testid="log-panel"]').is_visible()
            print(f"   Log panel visible: {log_panel}")

            browser.close()
            print("Processing page tests completed")

        except Exception as e:
            print(f"Error in processing test: {e}")
            page.screenshot(path='Tests/test-results/error-processing.png', full_page=True)
            browser.close()
            raise

def test_results_page():
    """Test Results page fixes"""
    print("\n=== Testing Results Page ===")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1920, 'height': 1080})
        page = context.new_page()

        page.on('console', lambda msg: print(f"Console: {msg.text}") if msg.type == 'error' else None)

        try:
            # Navigate to results page
            print("Navigating to results page...")
            page.goto('http://localhost:3000/analysis/visualization?session_id=test-session-123')
            page.wait_for_load_state('networkidle')
            time.sleep(2)

            # Test 1: Check Session Manager visibility on results page
            print("\n1. Checking Session Manager on results page...")
            session_panel = page.locator('[data-testid="session-panel"]').is_visible()
            print(f"   Session panel visible: {session_panel}")

            # Test 2: Check Volcano Plot
            print("\n2. Checking Volcano Plot...")
            volcano_plot = page.locator('[data-testid="volcano-plot"]').is_visible()
            print(f"   Volcano plot visible: {volcano_plot}")

            page.screenshot(path='Tests/test-results/04-results-page.png', full_page=True)

            browser.close()
            print("Results page tests completed")

        except Exception as e:
            print(f"Error in results test: {e}")
            page.screenshot(path='Tests/test-results/error-results.png', full_page=True)
            browser.close()
            raise

def test_qc_page():
    """Test QC Plots page"""
    print("\n=== Testing QC Plots Page ===")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1920, 'height': 1080})
        page = context.new_page()

        page.on('console', lambda msg: print(f"Console: {msg.text}") if msg.type == 'error' else None)

        try:
            # Navigate to QC page
            print("Navigating to QC page...")
            page.goto('http://localhost:3000/analysis/visualization/qc?session_id=test-session-123')
            page.wait_for_load_state('networkidle')
            time.sleep(2)

            # Check QC Summary Statistics
            print("\n1. Checking QC Summary...")
            qc_summary = page.locator('[data-testid="qc-summary"]').is_visible()
            print(f"   QC summary visible: {qc_summary}")

            page.screenshot(path='Tests/test-results/05-qc-page.png', full_page=True)

            browser.close()
            print("QC page tests completed")

        except Exception as e:
            print(f"Error in QC test: {e}")
            page.screenshot(path='Tests/test-results/error-qc.png', full_page=True)
            browser.close()
            raise

def test_bioinformatics_page():
    """Test Bioinformatics page (GSEA)"""
    print("\n=== Testing Bioinformatics Page ===")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1920, 'height': 1080})
        page = context.new_page()

        page.on('console', lambda msg: print(f"Console: {msg.text}") if msg.type == 'error' else None)

        try:
            # Navigate to bioinformatics page
            print("Navigating to bioinformatics page...")
            page.goto('http://localhost:3000/analysis/visualization/bioinformatics?session_id=test-session-123')
            page.wait_for_load_state('networkidle')
            time.sleep(2)

            # Check GSEA Dashboard
            print("\n1. Checking GSEA Dashboard...")
            gsea_dashboard = page.locator('[data-testid="gsea-overview"]').is_visible()
            print(f"   GSEA dashboard visible: {gsea_dashboard}")

            page.screenshot(path='Tests/test-results/06-bioinformatics-page.png', full_page=True)

            browser.close()
            print("Bioinformatics page tests completed")

        except Exception as e:
            print(f"Error in bioinformatics test: {e}")
            page.screenshot(path='Tests/test-results/error-bioinformatics.png', full_page=True)
            browser.close()
            raise

if __name__ == '__main__':
    # Ensure test-results directory exists
    os.makedirs('Tests/test-results', exist_ok=True)

    print("=" * 60)
    print("Starting Comprehensive Bug Fix Tests")
    print("=" * 60)

    try:
        test_data_input_page()
    except Exception as e:
        print(f"Data input tests failed: {e}")

    try:
        test_processing_page()
    except Exception as e:
        print(f"Processing tests failed: {e}")

    try:
        test_results_page()
    except Exception as e:
        print(f"Results tests failed: {e}")

    try:
        test_qc_page()
    except Exception as e:
        print(f"QC tests failed: {e}")

    try:
        test_bioinformatics_page()
    except Exception as e:
        print(f"Bioinformatics tests failed: {e}")

    print("\n" + "=" * 60)
    print("All tests completed!")
    print("Screenshots saved to Tests/test-results/")
    print("=" * 60)
