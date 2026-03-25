"""Verify CRIT-005 fix: GSEA heatmap display."""
from playwright.sync_api import sync_playwright
import time

session_id = "2c0f0cbb-2a3a-45e4-af50-681d923f1990"

def verify_heatmap_fix():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        page = browser.new_page(viewport={'width': 1920, 'height': 1080})

        try:
            print("Navigating to bioinformatics page...")
            page.goto(f'http://localhost:3000/analysis/visualization?session_id={session_id}')
            page.wait_for_load_state('networkidle')
            page.wait_for_timeout(3000)

            # Click on Bioinformatics tab
            bio_tab = page.locator('text=Bioinformatics').first
            if bio_tab.is_visible():
                bio_tab.click()
                print("Clicked Bioinformatics tab")
                page.wait_for_timeout(5000)  # Wait for GSEA to load

            # Take screenshot
            page.screenshot(path='Tests/screenshots/crit005_fixed_01_bioinformatics.png', full_page=True)
            print("Screenshot saved: crit005_fixed_01_bioinformatics.png")

            # Look for pathway buttons and click on first one
            buttons = page.locator('button').all()
            print(f"Found {len(buttons)} buttons")

            # Find a button that looks like a pathway
            pathway_button = None
            for btn in buttons:
                text = btn.inner_text()
                if any(x in text for x in ['GO:', 'KEGG', 'Reactome']):
                    pathway_button = btn
                    print(f"Found pathway button: {text[:50]}")
                    break

            if pathway_button:
                pathway_button.click()
                print("Clicked on pathway")
                page.wait_for_timeout(5000)  # Wait for plot to render

                # Take screenshot
                page.screenshot(path='Tests/screenshots/crit005_fixed_02_pathway_selected.png', full_page=True)
                print("Screenshot saved: crit005_fixed_02_pathway_selected.png")

                # Check for heatmap in the page
                page_content = page.content()
                has_heatmap = 'heatmap' in page_content.lower()
                print(f"Page contains 'heatmap': {has_heatmap}")

                # Check for z-score colorbar
                has_zscore = 'z-score' in page_content.lower() or 'zscore' in page_content.lower()
                print(f"Page contains 'z-score': {has_zscore}")

                # Count Plotly traces
                svg_elements = page.locator('g.trace').all()
                print(f"Found {len(svg_elements)} Plotly trace elements")

                if has_heatmap:
                    print("\n✅ SUCCESS: Heatmap appears to be present!")
                else:
                    print("\n❌ ISSUE: Heatmap may not be displaying")

            print("\nVerification complete!")
            print("Check screenshots in Tests/screenshots/")

        except Exception as e:
            print(f"Error: {e}")
            import traceback
            traceback.print_exc()
        finally:
            browser.close()

if __name__ == "__main__":
    verify_heatmap_fix()
