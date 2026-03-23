#!/usr/bin/env python3
"""
Test volcano plot selection
"""

from playwright.sync_api import sync_playwright
import time
import os

def test_volcano_plot():
    """Test volcano plot click selection"""
    print("\n=== Testing Volcano Plot Selection ===")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, slow_mo=100)
        context = browser.new_context(viewport={'width': 1920, 'height': 1080})
        page = context.new_page()

        errors = []
        page.on('console', lambda msg: errors.append(msg.text) if msg.type == 'error' else None)

        try:
            # Navigate to existing results page
            page.goto('http://localhost:3000/analysis/visualization')
            page.wait_for_load_state('networkidle')
            time.sleep(2)

            # Check if we're on results page
            if 'visualization' in page.url:
                print("On visualization page")

                # Look for volcano plot
                volcano = page.locator('[data-testid="volcano-plot"]')
                if volcano.is_visible():
                    print("Volcano plot found")

                    # Click on a point in the plot
                    # Try to find a scatter point
                    points = page.locator('.scatterlayer .trace .point').all()
                    if points:
                        print(f"Found {len(points)} plot points")
                        points[0].click()
                        time.sleep(1)
                        print("Clicked on a point")

                        # Check if protein info panel appears
                        protein_info = page.locator('[data-testid="protein-info-panel"]')
                        if protein_info.is_visible():
                            print("Protein info panel VISIBLE")
                        else:
                            print("Protein info panel NOT visible")
                    else:
                        print("No plot points found")
                else:
                    print("Volcano plot not found")

                page.screenshot(path='test-results/volcano-test.png', full_page=True)

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
    test_volcano_plot()
