#!/usr/bin/env python3
"""
Compound structure display test
"""

from playwright.sync_api import sync_playwright
import time
import os

def test_compound_display():
    """Test compound structure display"""
    print("\n=== Testing Compound Display ===")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, slow_mo=100)
        context = browser.new_context(viewport={'width': 1920, 'height': 1080})
        page = context.new_page()

        errors = []
        page.on('console', lambda msg: errors.append(msg.text) if msg.type == 'error' else None)

        try:
            page.goto('http://localhost:3000/analysis')
            page.wait_for_load_state('networkidle')
            time.sleep(1)

            page.locator('button:has-text("New Analysis")').click()
            time.sleep(1)
            page.keyboard.press('Escape')
            time.sleep(0.5)
            page.locator('div:has(> h3:has-text("Protein Pair-wise"))').first.click()
            time.sleep(2)

            # Upload files
            file_input = page.locator('input[type="file"]').first
            test_files = [
                'D:/CodingWorks/ProteomicsVizWebApp/Tests/data/PSM_SampleData_DMSO_1.csv',
            ]
            file_input.set_input_files(test_files)
            time.sleep(3)

            # Select the file
            page.locator('input[type="checkbox"]').first.check()
            time.sleep(1)

            # Create compound CSV
            with open('Tests/data/compounds.csv', 'w') as f:
                f.write("compound_id,condition\nDMSO,DMSO\n")

            # Upload compound
            compound_input = page.locator('input[type="file"]').nth(1)
            compound_input.set_input_files('D:/CodingWorks/ProteomicsVizWebApp/Tests/data/compounds.csv')
            time.sleep(3)

            # Scroll to compound section
            page.locator('text=4. Compound Information').scroll_into_view_if_needed()
            time.sleep(1)

            # Check compound display
            compound_info = page.locator('text=DMSO').count()
            print(f"DMSO mentions: {compound_info}")

            # Check if compound structure visible
            compound_visible = page.locator('[data-testid="compound-info"]').is_visible()
            print(f"Compound structure visible: {compound_visible}")

            page.screenshot(path='test-results/compound-test.png', full_page=True)
            print("Screenshot saved")

            if errors:
                print(f"Errors: {len(errors)}")
                for e in errors[:3]:
                    print(f"  {e}")

            browser.close()
            print("Test completed!")

        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path='test-results/error.png')
            browser.close()

if __name__ == '__main__':
    os.makedirs('test-results', exist_ok=True)
    test_compound_display()
