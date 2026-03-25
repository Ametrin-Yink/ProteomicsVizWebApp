"""
Full workflow test to verify CRIT-004 and CRIT-005 GSEA plot fixes.
This creates a new session, uploads data, runs analysis, and checks GSEA results.
"""
from playwright.sync_api import sync_playwright, expect
import time

def run_full_analysis():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)  # Headed for visual verification
        page = browser.new_page(viewport={'width': 1920, 'height': 1080})

        try:
            print("Step 1: Navigate to welcome page")
            page.goto('http://localhost:3000')
            page.wait_for_load_state('networkidle')
            page.screenshot(path='Tests/screenshots/bug-fixes/gsea_01_welcome.png')

            print("Step 2: Create new analysis session")
            # Click on first template (Protein Pair-wise)
            template = page.locator('text=Protein Pair-wise').first
            template.click()
            page.wait_for_timeout(1000)

            # Click Start Analysis
            start_btn = page.locator('button:has-text("Start Analysis")').first
            start_btn.click()
            page.wait_for_timeout(2000)
            page.screenshot(path='Tests/screenshots/bug-fixes/gsea_02_data_input.png')

            print("Step 3: Upload sample files")
            # Find file input
            file_input = page.locator('input[type="file"]').first

            # Upload sample PSM files
            sample_files = [
                "SampleData/PSM_Incucabib10_DMSO_1.csv",
                "SampleData/PSM_Incucabib10_DMSO_2.csv",
                "SampleData/PSM_Incucabib10_DMSO_3.csv",
                "SampleData/PSM_Incucabib10_INCZ123456_1.csv",
                "SampleData/PSM_Incucabib10_INCZ123456_2.csv",
                "SampleData/PSM_Incucabib10_INCZ123456_3.csv",
            ]

            # Convert to absolute paths
            import os
            base_dir = "D:/CodingWorks/ProteomicsVizWebApp"
            abs_files = [os.path.join(base_dir, f) for f in sample_files]
            existing_files = [f for f in abs_files if os.path.exists(f)]

            if len(existing_files) < 6:
                print(f"WARNING: Only found {len(existing_files)} sample files")
                print("Need all 6 files for proper analysis")

            file_input.set_input_files(existing_files[:6])
            page.wait_for_timeout(3000)
            page.screenshot(path='Tests/screenshots/bug-fixes/gsea_03_files_uploaded.png')

            print("Step 4: Configure analysis")
            # Scroll to configuration panel
            page.evaluate('window.scrollTo(0, document.body.scrollHeight)')
            page.wait_for_timeout(1000)

            # Set comparison groups if needed
            page.screenshot(path='Tests/screenshots/bug-fixes/gsea_04_configured.png')

            print("Step 5: Start processing")
            # Click Start Analysis button
            start_analysis_btn = page.locator('button:has-text("Start Analysis")').first
            start_analysis_btn.click()
            page.wait_for_timeout(5000)
            page.screenshot(path='Tests/screenshots/bug-fixes/gsea_05_processing.png')

            print("Step 6: Wait for processing to complete (this may take several minutes)...")
            # Wait for processing to complete - check for results page or completion indicator
            max_wait = 300  # 5 minutes max
            for i in range(max_wait):
                time.sleep(1)
                if '/analysis/results' in page.url:
                    print(f"Processing completed after {i} seconds")
                    break
                # Take periodic screenshots
                if i % 30 == 0:
                    page.screenshot(path=f'Tests/screenshots/bug-fixes/gsea_05_processing_{i}s.png')

            page.wait_for_timeout(3000)
            page.screenshot(path='Tests/screenshots/bug-fixes/gsea_06_results.png', full_page=True)

            print("Step 7: Navigate to Bioinformatics/GSEA section")
            # Try to find and click Bioinformatics section
            try:
                bio_links = page.locator('a:has-text("Bioinformatics"), button:has-text("Bioinformatics"), text=Bioinformatics')
                if bio_links.count() > 0:
                    bio_links.first.click()
                    page.wait_for_timeout(2000)
                    page.screenshot(path='Tests/screenshots/bug-fixes/gsea_07_bioinformatics.png', full_page=True)
            except:
                print("Could not find Bioinformatics link, may already be on results page")

            # Look for GSEA tab/link
            try:
                gsea_links = page.locator('a:has-text("GSEA"), button:has-text("GSEA"), text=GSEA')
                if gsea_links.count() > 0:
                    gsea_links.first.click()
                    page.wait_for_timeout(3000)
                    page.screenshot(path='Tests/screenshots/bug-fixes/gsea_08_gsea_page.png', full_page=True)
                    print("GSEA page captured")
            except:
                print("Could not find GSEA section")

            # Take final screenshot of any GSEA plots
            page.screenshot(path='Tests/screenshots/bug-fixes/gsea_09_final.png', full_page=True)

            print("\n=== VERIFICATION RESULTS ===")
            print("Check the following screenshots:")
            print("1. gsea_08_gsea_page.png - GSEA plot page")
            print("2. gsea_09_final.png - Final state")
            print("\nCRIT-004: GSEA curve should be mountain-shaped (not straight diagonal line)")
            print("CRIT-005: Heatmap should be visible on right side of GSEA plot")

        except Exception as e:
            print(f"Error during test: {e}")
            import traceback
            traceback.print_exc()
            page.screenshot(path='Tests/screenshots/bug-fixes/gsea_error.png')
        finally:
            browser.close()

if __name__ == "__main__":
    run_full_analysis()
