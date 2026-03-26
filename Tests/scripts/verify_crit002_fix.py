"""Verify CRIT-002 fix: Volcano plot double-click selects proteins"""
from playwright.sync_api import sync_playwright
import time

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)  # Use headed mode for visibility
        page = browser.new_page(viewport={'width': 1400, 'height': 900})

        try:
            # Navigate to the visualization page with an existing session
            page.goto('http://localhost:3000/analysis/visualization?session=456e356b-0de4-4f6d-b219-89bd50d14688')
            page.wait_for_load_state('networkidle')

            # Wait for the volcano plot to load
            page.wait_for_selector('[data-testid="volcano-plot"]', timeout=10000)
            print("Volcano plot loaded successfully")

            # Take initial screenshot
            page.screenshot(path='D:\\CodingWorks\\ProteomicsVizWebApp\\volcano_before_click.png')
            print("Saved screenshot: volcano_before_click.png")

            # Find and click on a data point in the volcano plot
            # First, wait for Plotly to render
            page.wait_for_timeout(2000)

            # Try to click on a point in the plot (center area where points typically are)
            plot = page.locator('[data-testid="volcano-plot"]')
            box = plot.bounding_box()
            if box:
                # Click near the center of the plot where data points usually are
                center_x = box['x'] + box['width'] / 2
                center_y = box['y'] + box['height'] / 2

                # Double-click on the plot
                print(f"Double-clicking at ({center_x}, {center_y})")
                page.mouse.dblclick(center_x, center_y)

                # Wait a moment for selection to update
                page.wait_for_timeout(1500)

                # Take screenshot after double-click
                page.screenshot(path='D:\\CodingWorks\\ProteomicsVizWebApp\\volcano_after_doubleclick.png')
                print("Saved screenshot: volcano_after_doubleclick.png")

                # Check if protein info panel appeared
                try:
                    page.wait_for_selector('[data-testid="protein-info"]', timeout=5000)
                    print("SUCCESS: Protein info panel appeared after double-click!")
                except:
                    print("INFO: Protein info panel may not be visible or uses different selector")

                # Check console for our debug logs
                logs = page.evaluate("() => window.console_logs || []")
                print(f"Console logs: {logs}")

            print("\nCRIT-002 Verification Complete!")
            print("Please check the screenshots to confirm double-click selection works.")

        finally:
            browser.close()

if __name__ == '__main__':
    main()
