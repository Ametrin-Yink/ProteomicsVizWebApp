#!/usr/bin/env python3
"""
Quick browser automation test for ProteomicsViz WebApp
"""

from playwright.sync_api import sync_playwright
import time
import os

def test_upload():
    """Test file upload"""
    print("\n=== Testing Multiple File Upload ===")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, slow_mo=100)
        context = browser.new_context(viewport={'width': 1920, 'height': 1080})
        page = context.new_page()

        errors = []
        page.on('console', lambda msg: errors.append(msg.text) if msg.type == 'error' else None)
        page.on('pageerror', lambda err: errors.append(str(err)))

        try:
            # Navigate to analysis page
            page.goto('http://localhost:3000/analysis')
            page.wait_for_load_state('networkidle')
            time.sleep(2)

            # Click "New Analysis" button
            page.locator('button:has-text("New Analysis")').click()
            time.sleep(1)

            # Press Escape to close any modal
            page.keyboard.press('Escape')
            time.sleep(0.5)

            # Click on the card
            page.locator('div:has(> h3:has-text("Protein Pair-wise"))').first.click()
            time.sleep(2)

            # Upload 3 files at once
            file_input = page.locator('input[type="file"]').first
            test_files = [
                'D:/CodingWorks/ProteomicsVizWebApp/Tests/data/PSM_SampleData_DMSO_1.csv',
                'D:/CodingWorks/ProteomicsVizWebApp/Tests/data/PSM_SampleData_DMSO_2.csv',
                'D:/CodingWorks/ProteomicsVizWebApp/Tests/data/PSM_SampleData_INCZ123456_1.csv',
            ]

            file_input.set_input_files(test_files)
            print(f"Uploaded {len(test_files)} files")
            time.sleep(4)

            # Check file count
            items = page.locator('[data-testid="file-item"]').count()
            print(f"Files visible: {items}")

            # Check conditions
            conditions = page.locator('text=/Condition: (DMSO|INCZ)/i').count()
            print(f"Condition labels found: {conditions}")

            page.screenshot(path='test-results/upload-test.png', full_page=True)
            print("Screenshot saved to test-results/upload-test.png")

            if errors:
                print(f"\nErrors: {len(errors)}")
                for e in errors[:5]:
                    print(f"  {e}")

            browser.close()
            print("\nTest completed!")

        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path='test-results/error.png')
            browser.close()

if __name__ == '__main__':
    os.makedirs('test-results', exist_ok=True)
    test_upload()
