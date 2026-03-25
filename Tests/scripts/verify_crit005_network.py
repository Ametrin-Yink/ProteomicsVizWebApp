"""Verify CRIT-005 fix with network interception."""
from playwright.sync_api import sync_playwright
import json

session_id = "2c0f0cbb-2a3a-45e4-af50-681d923f1990"

def verify_heatmap_fix():
    api_responses = {}

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        page = browser.new_page(viewport={'width': 1920, 'height': 1080})

        # Capture API responses
        def handle_response(response):
            if '/api/sessions/' in response.url and 'gsea' in response.url:
                try:
                    body = response.json()
                    api_responses[response.url] = body
                    print(f"API Response from {response.url.split('/')[-1]}:")
                    if 'data' in body and 'results' in body['data']:
                        results = body['data']['results']
                        print(f"  Got {len(results)} pathways")
                        if results:
                            r = results[0]
                            has_heatmap = 'heatmap_data' in r and r['heatmap_data']
                            print(f"  First pathway has heatmap_data: {has_heatmap}")
                            if has_heatmap:
                                hm = r['heatmap_data']
                                print(f"    - Genes: {len(hm.get('genes', []))}")
                                print(f"    - Samples: {len(hm.get('samples', []))}")
                except Exception as e:
                    print(f"Error parsing response: {e}")

        page.on("response", handle_response)

        try:
            print("Navigating to bioinformatics page...")
            page.goto(f'http://localhost:3000/analysis/visualization?session_id={session_id}')
            page.wait_for_load_state('networkidle')
            page.wait_for_timeout(3000)

            # Click on Bioinformatics tab
            bio_tab = page.locator('text=Bioinformatics').first
            if bio_tab.is_visible():
                bio_tab.click()
                print("\nClicked Bioinformatics tab")
                page.wait_for_timeout(10000)  # Wait for GSEA to load

            # Take screenshot
            page.screenshot(path='Tests/screenshots/crit005_network.png', full_page=True)
            print("\nScreenshot saved: crit005_network.png")

            # Check the page state
            loading_indicator = page.locator('text=Loading GSEA results...')
            is_loading = loading_indicator.count() > 0 and loading_indicator.is_visible()
            print(f"\nPage still loading: {is_loading}")

            if not is_loading:
                print("✓ GSEA data loaded successfully!")
                # Look for pathway elements
                buttons = page.locator('button').all()
                print(f"Found {len(buttons)} buttons on page")
            else:
                print("✗ GSEA data is still loading - check API response above")

        except Exception as e:
            print(f"Error: {e}")
            import traceback
            traceback.print_exc()
        finally:
            browser.close()

if __name__ == "__main__":
    verify_heatmap_fix()
