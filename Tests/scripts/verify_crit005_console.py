"""Verify CRIT-005 fix with console logging."""
from playwright.sync_api import sync_playwright
import time

session_id = "2c0f0cbb-2a3a-45e4-af50-681d923f1990"

def verify_heatmap_fix():
    console_logs = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        page = browser.new_page(viewport={'width': 1920, 'height': 1080})

        # Capture console logs
        page.on("console", lambda msg: console_logs.append(f"{msg.type}: {msg.text}"))

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
                page.wait_for_timeout(10000)  # Wait longer for GSEA to load

            # Take screenshot
            page.screenshot(path='Tests/screenshots/crit005_fixed_console.png', full_page=True)
            print("Screenshot saved: crit005_fixed_console.png")

            # Print console logs
            print("\n=== Console Logs ===")
            for log in console_logs:
                print(log)
            print("=== End Console Logs ===")

            # Check for errors
            errors = [log for log in console_logs if 'error' in log.lower()]
            if errors:
                print(f"\n❌ Found {len(errors)} errors in console")
                for err in errors[:5]:
                    print(f"  - {err}")
            else:
                print("\n✅ No errors found in console")

        except Exception as e:
            print(f"Error: {e}")
            import traceback
            traceback.print_exc()
        finally:
            browser.close()

if __name__ == "__main__":
    verify_heatmap_fix()
