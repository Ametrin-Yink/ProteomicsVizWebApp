"""Verify CRIT-005: GSEA heatmap display in bioinformatics page."""
from playwright.sync_api import sync_playwright
import time

session_id = "2c0f0cbb-2a3a-45e4-af50-681d923f1990"

def verify_heatmap():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        page = browser.new_page(viewport={'width': 1920, 'height': 1080})

        try:
            # Navigate to bioinformatics page
            print("Navigating to bioinformatics page...")
            page.goto(f'http://localhost:3000/analysis/visualization?session_id={session_id}')
            page.wait_for_load_state('networkidle')
            page.wait_for_timeout(3000)

            # Take initial screenshot
            page.screenshot(path='Tests/screenshots/crit005_01_initial.png', full_page=True)
            print("Screenshot saved: crit005_01_initial.png")

            # Click on Bioinformatics tab if available
            try:
                bio_tab = page.locator('text=Bioinformatics').first
                if bio_tab.is_visible():
                    bio_tab.click()
                    print("Clicked Bioinformatics tab")
                    # Wait for GSEA results to load (longer wait)
                    page.wait_for_timeout(10000)
                    page.screenshot(path='Tests/screenshots/crit005_02_bioinformatics.png', full_page=True)
                    print("Screenshot saved: crit005_02_bioinformatics.png")
            except Exception as e:
                print(f"Bioinformatics tab not found: {e}")

            # Wait for pathways to load
            page.wait_for_timeout(5000)

            # Look for pathway items and click on one
            try:
                # Try multiple selectors for pathway items
                selectors = [
                    '[data-testid="pathway-item"]',
                    '.pathway-item',
                    'li',
                    'button:has-text("GO:")',
                    'button:has-text("KEGG")',
                    'div[role="button"]',
                ]

                pathway_items = []
                for selector in selectors:
                    pathway_items = page.locator(selector).all()
                    if len(pathway_items) > 0:
                        print(f"Found {len(pathway_items)} items with selector: {selector}")
                        break

                if len(pathway_items) > 0:
                    # Click on first pathway
                    pathway_items[0].click()
                    print("Clicked on first pathway")
                    page.wait_for_timeout(5000)
                    page.screenshot(path='Tests/screenshots/crit005_03_pathway_selected.png', full_page=True)
                    print("Screenshot saved: crit005_03_pathway_selected.png")

                    # Check for heatmap in the DOM
                    heatmap = page.locator('.heatmap').first
                    print(f"Heatmap element found: {heatmap.is_visible() if heatmap.count() > 0 else False}")

                    # Look for Plotly heatmap trace
                    svg_heatmaps = page.locator('g.trace.heatmap').all()
                    print(f"SVG heatmap traces found: {len(svg_heatmaps)}")

                    # Check for any heatmap-related elements
                    heatmap_refs = page.locator('[class*="heatmap"]').all()
                    print(f"Elements with 'heatmap' in class: {len(heatmap_refs)}")

            except Exception as e:
                print(f"Error interacting with pathways: {e}")
                import traceback
                traceback.print_exc()

            # Final screenshot
            page.screenshot(path='Tests/screenshots/crit005_04_final.png', full_page=True)
            print("Screenshot saved: crit005_04_final.png")

            print("\nVerification complete!")
            print("Check screenshots in Tests/screenshots/ to see if heatmap is displayed")

        except Exception as e:
            print(f"Error: {e}")
            import traceback
            traceback.print_exc()
            page.screenshot(path='Tests/screenshots/crit005_error.png')
        finally:
            browser.close()

if __name__ == "__main__":
    verify_heatmap()
