#!/usr/bin/env python3
"""
Quick browser automation test for ProteomicsViz WebApp
Tests key fixes
"""

from playwright.sync_api import sync_playwright
import time
import os

def test_multiple_upload():
    """Test multiple file upload"""
    print("\n=== Testing Multiple File Upload ===")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, slow_mo=50)
        context = browser.new_context(viewport={'width': 1920, 'height': 1080})
        page = context.new_page()

        # Capture console errors
        errors = []
        page.on('console', lambda msg: errors.append(msg.text) if msg.type == 'error' else None)

        try:
            page.goto('http://localhost:3000/analysis')
            page.wait_for_load_state('networkidle')
            time.sleep(1)

            # Click "New Analysis" button
            page.click('button:has-text("New Analysis")')
            time.sleep(1)

            # Click "Protein Pair-wise Comparison Analysis"
            page.click('text=Protein Pair-wise Comparison Analysis')
            time.sleep(2)

            # Upload multiple files
            file_input = page.locator('input[type="file"]').first
            test_files = [
                'D:/CodingWorks/ProteomicsVizWebApp/Tests/data/PSM_SampleData_DMSO_1.csv',
                'D:/CodingWorks/ProteomicsVizWebApp/Tests/data/PSM_SampleData_DMSO_2.csv',
                'D:/CodingWorks/ProteomicsVizWebApp/Tests/data/PSM_SampleData_INCZ123456_1.csv'
            ]

            file_input.set_input_files(test_files)
            print(f"Uploaded {len(test_files)} files")
            time.sleep(3)

            # Count file items
            file_items = page.locator('[data-testid="file-item"]').count()
            print(f"Files in list: {file_items}")

            page.screenshot(path='test-results/01-multiple-upload.png', full_page=True)

            # Test compound file upload
            print("\n=== Testing Compound File Upload ===")
            compound_file = 'D:/CodingWorks/ProteomicsVizWebApp/Tests/data/compounds.csv'
            if os.path.exists(compound_file):
                # Select all proteomics files first
                checkboxes = page.locator('[data-testid="file-item"] input[type="checkbox"]').all()
                for cb in checkboxes:
                    cb.check()
                time.sleep(1)

                # Upload compound file
                compound_input = page.locator('input[type="file"]').nth(1)
                compound_input.set_input_files(compound_file)
                time.sleep(3)

                # Check if compound display appears
                compound_info = page.locator('[data-testid="compound-info"]')
                if compound_info.is_visible():
                    print("Compound display visible!")
                    # Get compound names
                    names = compound_info.locator('text=DMSO').count()
                    print(f"Found {names} DMSO compounds")
                else:
                    print("Compound display NOT visible")

                page.screenshot(path='test-results/02-compound-display.png', full_page=True)
            else:
                print(f"Compound file not found at {compound_file}")

            if errors:
                print(f"\nConsole errors: {len(errors)}")
                for e in errors[:5]:
                    print(f"  - {e}")

            browser.close()
            print("\nTests completed!")

        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path='test-results/error.png', full_page=True)
            browser.close()
            raise

if __name__ == '__main__':
    os.makedirs('test-results', exist_ok=True)
    test_multiple_upload()
