"""Verify GSEA results page - capture screenshot of CRIT-004 and CRIT-005 fixes."""
from playwright.sync_api import sync_playwright
import time
import os

def main():
    session_id = "787c43f6-d8a2-47db-8564-c06074036a42"
    url = f"http://localhost:3000/analysis/visualization?session_id={session_id}"

    # Ensure screenshots directory exists
    os.makedirs("screenshots/bug-fixes", exist_ok=True)

    with sync_playwright() as p:
        # Launch browser with specific args to avoid "existing session" issue
        browser = p.chromium.launch(
            headless=True,
            args=['--no-sandbox', '--disable-setuid-sandbox']
        )
        page = browser.new_page(viewport={'width': 1920, 'height': 1080})

        print(f"Navigating to {url}...")
        page.goto(url)

        # Wait for page to load
        print("Waiting for page to load...")
        page.wait_for_load_state('networkidle')
        time.sleep(3)  # Extra time for plots to render

        # Take initial screenshot
        screenshot_path = "screenshots/bug-fixes/gsea_results_overview.png"
        page.screenshot(path=screenshot_path, full_page=True)
        print(f"Saved overview screenshot: {screenshot_path}")

        # Look for GSEA section/tab and click it
        print("Looking for GSEA section...")
        time.sleep(2)  # Wait for page to fully render

        # Try to find and click Bioinformatics tab
        try:
            bioinformatics_locators = [
                'text=Bioinformatics',
                'button:has-text("Bioinformatics")',
                '[role="tab"]:has-text("Bioinformatics")',
                'a:has-text("Bioinformatics")'
            ]
            for locator in bioinformatics_locators:
                try:
                    if page.locator(locator).first.is_visible(timeout=3000):
                        page.locator(locator).first.click()
                        print(f"Clicked Bioinformatics element: {locator}")
                        time.sleep(3)
                        break
                except:
                    continue
        except Exception as e:
            print(f"Could not find Bioinformatics tab: {e}")

        # Take screenshot of bioinformatics page
        screenshot_path2 = "screenshots/bug-fixes/gsea_bioinformatics_tab.png"
        page.screenshot(path=screenshot_path2, full_page=True)
        print(f"Saved bioinformatics screenshot: {screenshot_path2}")

        # Now look for GSEA section within bioinformatics
        print("Looking for GSEA plots...")
        time.sleep(5)  # Wait longer for GSEA to load

        # Take screenshot after GSEA loads
        screenshot_path3 = "screenshots/bug-fixes/gsea_loaded.png"
        page.screenshot(path=screenshot_path3, full_page=True)
        print(f"Saved GSEA loaded screenshot: {screenshot_path3}")

        # Click on first pathway to see detailed GSEA plot
        print("Clicking on first pathway to see detailed GSEA plot...")
        try:
            # Try to find pathway row or link
            pathway_locators = [
                'table tbody tr:first-child td:first-child',
                '.enriched-pathways tbody tr:first-child',
                'text=KEGG',
                '[role="row"]:nth-child(2)',  # First data row (after header)
            ]
            for locator in pathway_locators:
                try:
                    if page.locator(locator).first.is_visible(timeout=3000):
                        page.locator(locator).first.click()
                        print(f"Clicked pathway element: {locator}")
                        time.sleep(3)
                        break
                except Exception as e:
                    print(f"  Locator {locator} failed: {e}")
                    continue
        except Exception as e:
            print(f"Could not find pathway to click: {e}")

        # Take screenshot of detailed GSEA plot
        time.sleep(3)
        screenshot_path4 = "screenshots/bug-fixes/gsea_detail_plot.png"
        page.screenshot(path=screenshot_path4, full_page=True)
        print(f"Saved GSEA detail plot screenshot: {screenshot_path4}")

        # Check if GSEA plots are visible

        # Check if GSEA plots are visible
        print("\nChecking for GSEA plot elements...")
        plot_selectors = [
            '.js-plotly-plot',
            '[class*="plotly"]',
            'svg',
            'canvas'
        ]

        for selector in plot_selectors:
            count = page.locator(selector).count()
            if count > 0:
                print(f"  Found {count} elements matching: {selector}")

        browser.close()
        print("\nVerification complete!")

if __name__ == "__main__":
    main()
