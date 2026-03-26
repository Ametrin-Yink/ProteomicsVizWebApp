"""Verify CRIT-004 fix: GSEA plot shows mountain curve instead of straight line"""
from playwright.sync_api import sync_playwright
import time

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={'width': 1400, 'height': 900})

        try:
            # Navigate to the visualization page with an existing session
            page.goto('http://localhost:3000/analysis/visualization?session=456e356b-0de4-4f6d-b219-89bd50d14688')
            page.wait_for_load_state('networkidle')
            print("Page loaded successfully")

            # Navigate to Bioinformatics tab to see GSEA
            bioinformatics_tab = page.locator('text=Bioinformatics')
            if bioinformatics_tab.count() > 0:
                bioinformatics_tab.first.click()
                print("Clicked Bioinformatics tab")
                # Wait for loading to complete (GSEA results are large)
                page.wait_for_timeout(10000)
            else:
                print("Bioinformatics tab not found")

            # Take screenshot of the GSEA plot (after waiting for load)
            page.screenshot(path='D:\\CodingWorks\\ProteomicsVizWebApp\\Tests\\screenshots\\bug-fixes\\crit004_gsea_verification.png')
            print("Saved screenshot: crit004_gsea_verification.png")

            # Check if GSEA plot is present
            gsea_elements = page.locator('text=Gene Set Enrichment Analysis').all()
            print(f"Found {len(gsea_elements)} GSEA section(s)")

            # Check for pathway cards
            pathway_cards = page.locator('[class*="card"], [class*="Pathway"]').all()
            print(f"Found {len(pathway_cards)} pathway card(s)")

            # Check for "No GSEA data available" message
            no_data_msg = page.locator('text=No GSEA data available')
            if no_data_msg.count() > 0:
                print("WARNING: 'No GSEA data available' message is showing!")
                # Try to check the API response
                print("\nChecking API response...")
                # The API should be available at localhost:8000
                import requests
                try:
                    resp = requests.get('http://localhost:8000/api/sessions/456e356b-0de4-4f6d-b219-89bd50d14688/gsea/go_bp', timeout=10)
                    print(f"API Status: {resp.status_code}")
                    if resp.status_code == 200:
                        data = resp.json()
                        if 'data' in data:
                            gsea_data = data['data']
                            print(f"Results count: {len(gsea_data.get('results', []))}")
                            print(f"Total pathways: {gsea_data.get('total_pathways', 0)}")
                            print(f"Significant pathways: {gsea_data.get('significant_pathways', 0)}")
                        else:
                            print(f"Response keys: {list(data.keys())}")
                    else:
                        print(f"API Error: {resp.text[:200]}")
                except Exception as e:
                    print(f"API request failed: {e}")
            else:
                print("GSEA data is displaying")

                # Scroll down to see the pathway table
                print("\nScrolling down to see pathway table...")
                page.evaluate('window.scrollTo(0, 800)')
                page.wait_for_timeout(2000)

                # Take screenshot showing the pathway table
                page.screenshot(path='D:\\CodingWorks\\ProteomicsVizWebApp\\Tests\\screenshots\\bug-fixes\\crit004_gsea_table.png')
                print("Saved screenshot: crit004_gsea_table.png")

                # Try to click on a table row (pathway)
                table_rows = page.locator('table tbody tr, [class*="row"], [class*="pathway"]').all()
                print(f"Found {len(table_rows)} table rows")
                if len(table_rows) > 0:
                    # Click on the first row
                    table_rows[0].click(force=True)
                    print("Clicked on first table row")
                    page.wait_for_timeout(3000)

                    # Take screenshot of the GSEA curve plot
                    page.screenshot(path='D:\\CodingWorks\\ProteomicsVizWebApp\\Tests\\screenshots\\bug-fixes\\crit004_gsea_curve.png')
                    print("Saved screenshot: crit004_gsea_curve.png")

            print("\nCRIT-004 Verification Complete!")
            print("Check the screenshot to verify GSEA curve shows mountain shape (not straight line)")

        except Exception as e:
            print(f"Error during verification: {e}")
            page.screenshot(path='D:\\CodingWorks\\ProteomicsVizWebApp\\Tests\\screenshots\\bug-fixes\\crit004_error.png')
            print("Saved error screenshot: crit004_error.png")

        finally:
            browser.close()

if __name__ == '__main__':
    main()
