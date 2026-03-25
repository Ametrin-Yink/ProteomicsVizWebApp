"""Verify CRIT-004 and CRIT-005 GSEA plot fixes."""
from playwright.sync_api import sync_playwright
import json
from pathlib import Path

def check_existing_sessions():
    """Check for existing sessions with GSEA results."""
    sessions_dir = Path("backend/sessions")
    if not sessions_dir.exists():
        return []

    sessions_with_gsea = []
    for session_dir in sessions_dir.iterdir():
        if session_dir.is_dir():
            gsea_file = session_dir / "results" / "GSEA_Results.json"
            if gsea_file.exists():
                sessions_with_gsea.append(session_dir.name)
    return sessions_with_gsea

def verify_gsea_plots():
    """Navigate to GSEA plot and verify fixes."""
    # Check for existing sessions first
    existing_sessions = check_existing_sessions()

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)  # Headed for visual verification
        page = browser.new_page(viewport={'width': 1920, 'height': 1080})

        try:
            # Navigate to app
            page.goto('http://localhost:3000')
            page.wait_for_load_state('networkidle')

            # Take screenshot of welcome page
            page.screenshot(path='Tests/screenshots/bug-fixes/01_welcome_page.png')

            if existing_sessions:
                # Use existing session
                session_id = existing_sessions[0]
                print(f"Using existing session: {session_id}")

                # Navigate to results page with GSEA
                page.goto(f'http://localhost:3000/analysis/results?id={session_id}')
                page.wait_for_load_state('networkidle')
                page.wait_for_timeout(3000)

                # Screenshot of results page
                page.screenshot(path='Tests/screenshots/bug-fixes/02_results_page.png', full_page=True)

                # Try to navigate to GSEA tab if available
                try:
                    gsea_tab = page.locator('text=GSEA').first
                    if gsea_tab.is_visible():
                        gsea_tab.click()
                        page.wait_for_timeout(2000)
                        page.screenshot(path='Tests/screenshots/bug-fixes/03_gsea_page.png', full_page=True)
                        print("GSEA tab found and clicked")
                except Exception as e:
                    print(f"Could not find GSEA tab: {e}")

                # Check Bioinformatics section
                try:
                    bio_section = page.locator('text=Bioinformatics').first
                    if bio_section.is_visible():
                        bio_section.click()
                        page.wait_for_timeout(2000)
                        page.screenshot(path='Tests/screenshots/bug-fixes/04_bioinformatics_page.png', full_page=True)
                        print("Bioinformatics section found")
                except Exception as e:
                    print(f"Could not find Bioinformatics section: {e}")

            else:
                print("No existing sessions with GSEA results found.")
                print("Need to run a new analysis to verify GSEA fixes.")

            print("\nScreenshots saved to Tests/screenshots/bug-fixes/")
            print("Check these files to verify:")
            print("- CRIT-004: GSEA curve should be mountain-shaped (not straight line)")
            print("- CRIT-005: Heatmap should be visible on right side of GSEA plot")

        except Exception as e:
            print(f"Error during verification: {e}")
            page.screenshot(path='Tests/screenshots/bug-fixes/error_screenshot.png')
        finally:
            browser.close()

if __name__ == "__main__":
    verify_gsea_plots()
