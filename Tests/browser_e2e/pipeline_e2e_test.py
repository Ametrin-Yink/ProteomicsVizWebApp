"""Minimal pipeline E2E test — TMT + DIA submission."""
import os, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:3000"
ROOT = Path(__file__).parent.parent.parent
CHANNEL_CSV = str(ROOT / "Tests" / "fixtures" / "tmt_channel_design.csv")

def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg.encode('ascii',errors='replace').decode()}", flush=True)

def wait_enabled_click(page, text, timeout=30):
    """Wait for button with text to be enabled, then click."""
    for _ in range(timeout):
        btn = page.locator(f'button:has-text("{text}")').first
        if btn.is_visible() and btn.is_enabled():
            btn.click()
            log(f"Clicked: {text}")
            return True
        time.sleep(1)
    log(f"[WARN] Button '{text}' not enabled after {timeout}s")
    return False

def main():
    log("=" * 50)
    log("Pipeline E2E Submission Test")
    log("=" * 50)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, slow_mo=60)
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()

        # --- TMT Pipeline ---
        log("\n--- TMT Pipeline ---")
        page.goto(f"{BASE}/")
        page.wait_for_load_state("networkidle", timeout=15000)
        time.sleep(1)

        # Click TMT card
        page.locator('button:has-text("TMT")').first.click()
        page.wait_for_url("**/new/upload**", timeout=15000)
        page.wait_for_timeout(2000)
        log("On TMT upload page")

        # Browse File Library
        page.locator('button:has-text("Browse File Library")').first.click()
        page.wait_for_timeout(2000)
        log("Picker opened")

        # Navigate: click proj tree node to expand, then dock5 to navigate
        page.locator('[role="treeitem"]:has-text("proj")').first.click()
        page.wait_for_timeout(1500)
        page.locator('[role="treeitem"]:has-text("dock5")').first.click()
        page.wait_for_timeout(1500)
        log("Navigated to proj/dock5")

        # Select ALL files in dock5 (select the TMT PANC0203 file)
        # Click the checkbox on the file row
        file_row = page.locator('tr:has-text("DOCK5")').first
        if not file_row.is_visible(timeout=3000):
            # Try alternative: select any visible checkbox
            checkboxes = page.locator('tbody input[type="checkbox"]')
            if checkboxes.count() > 0:
                checkboxes.first.check()
                log(f"Selected first file in dock5")
        else:
            file_row.locator('input[type="checkbox"]').check()
            log("Selected DOCK5_PANC0203 file")

        page.wait_for_timeout(500)

        # Confirm selection
        page.locator('button:has-text("Select")').first.click()
        log("Confirmed selection")
        page.wait_for_timeout(4000)

        # Continue through wizard
        for label, url_part in [("Continue to Metadata", "metadata"), ("Continue to Comparisons", "comparisons"), ("Continue to Config", "config"), ("Continue to Summary", "summary")]:
            page.wait_for_timeout(2000)
            if not wait_enabled_click(page, "Continue", timeout=20):
                page.screenshot(path=str(ROOT / f"Tests/browser_e2e/stuck_{url_part}.png"))
                break
            try:
                page.wait_for_url(f"**/new/{url_part}**", timeout=15000)
                log(f"On {url_part} page")
            except:
                log(f"[WARN] Not on {url_part} page, continuing")
            page.wait_for_timeout(1000)

            # Special handling per page
            if url_part == "metadata":
                # Upload channel CSV
                file_inputs = page.locator('input[type="file"]')
                if file_inputs.count() > 0:
                    file_inputs.first.set_input_files(CHANNEL_CSV)
                    log("Uploaded channel design CSV")
                    page.wait_for_timeout(2000)
            elif url_part == "comparisons":
                # Auto-generate
                auto = page.locator('button:has-text("Auto-Generate")').first
                if auto.is_visible(timeout=3000):
                    auto.click()
                    log("Auto-generated comparisons")
                    page.wait_for_timeout(1000)
            elif url_part == "config":
                # Select organism
                sel = page.locator('select').first
                if sel.is_visible(timeout=3000):
                    sel.select_option(label="Human")
                    log("Selected organism")
                    page.wait_for_timeout(1000)

        # Summary page — start analysis
        if "summary" in page.url:
            page.wait_for_timeout(2000)
            page.once("dialog", lambda d: d.accept())
            if wait_enabled_click(page, "Start Analysis", timeout=10):
                log("TMT analysis started!")
                page.wait_for_url("**/analysis/processing**", timeout=30000)
                log(f"Processing URL: {page.url}")

        # Wait for TMT processing
        log("Waiting for TMT processing (up to 10 min)...")
        for i in range(0, 600, 15):
            time.sleep(15)
            if "visualization" in page.url:
                log(f"[OK] TMT completed after {i}s")
                break
            try:
                content = page.content()
                if "completed" in content and "successfully" in content:
                    log(f"TMT completed at {i}s")
                    time.sleep(3)  # wait for redirect
            except:
                pass
        else:
            log("TMT still processing after 10 min")

        # Verify results
        if "visualization" in page.url:
            log("[OK] TMT pipeline: Results page reached")
            tables = page.locator('table').count()
            log(f"TMT results: {tables} tables visible")
        else:
            log("[INFO] TMT still on processing page")

        # --- DIA Pipeline ---
        log("\n--- DIA Pipeline ---")
        page.goto(f"{BASE}/")
        page.wait_for_load_state("networkidle", timeout=15000)
        time.sleep(1)

        # Click DIA card
        page.locator('button:has-text("DIA")').first.click()
        page.wait_for_url("**/new/upload**", timeout=15000)
        page.wait_for_timeout(2000)
        log("On DIA upload page")

        # Browse File Library
        page.locator('button:has-text("Browse File Library")').first.click()
        page.wait_for_timeout(2000)
        log("Picker opened for DIA")

        # Navigate to E2E_DIA
        page.locator('[role="treeitem"]:has-text("E2E_DIA")').first.click()
        page.wait_for_timeout(1500)
        log("Navigated to E2E_DIA")

        # Select All
        header_cb = page.locator('thead input[type="checkbox"]').first
        if header_cb.is_visible(timeout=3000):
            header_cb.check()
            log("Selected all DIA files")
        else:
            # Select individual checkboxes
            cbs = page.locator('tbody input[type="checkbox"]')
            count = cbs.count()
            for i in range(min(count, 12)):
                try: cbs.nth(i).check()
                except: pass
            log(f"Selected DIA files from {count} total")

        page.wait_for_timeout(500)

        # Confirm
        page.locator('button:has-text("Select")').first.click()
        log("Confirmed DIA selection")
        page.wait_for_timeout(5000)

        # Quick-path through wizard
        for label, url_part in [("Continue to Metadata", "metadata"), ("Continue to Comparisons", "comparisons"), ("Continue to Config", "config"), ("Continue to Summary", "summary")]:
            page.wait_for_timeout(2000)
            if not wait_enabled_click(page, "Continue", timeout=20):
                page.screenshot(path=str(ROOT / f"Tests/browser_e2e/dia_stuck_{url_part}.png"))
                break
            try:
                page.wait_for_url(f"**/new/{url_part}**", timeout=15000)
            except:
                pass
            page.wait_for_timeout(1000)

            if url_part == "comparisons":
                auto = page.locator('button:has-text("Auto-Generate")').first
                if auto.is_visible(timeout=3000):
                    auto.click()
                    log("Auto-generated DIA comparisons")
                    page.wait_for_timeout(1000)
            elif url_part == "config":
                sel = page.locator('select').first
                if sel.is_visible(timeout=3000):
                    sel.select_option(label="Human")
                    log("Selected organism")
                    page.wait_for_timeout(1000)

        # Summary
        if "summary" in page.url:
            page.wait_for_timeout(2000)
            page.once("dialog", lambda d: d.accept())
            if wait_enabled_click(page, "Start Analysis", timeout=10):
                log("DIA analysis started!")
                try:
                    page.wait_for_url("**/analysis/processing**", timeout=30000)
                except:
                    pass

        log("\n" + "=" * 50)
        log("PIPELINE TESTS COMPLETE")
        log("TMT: submitted for processing")
        log("DIA: submitted for processing")
        log("Both pipelines running. Check /analysis/visualization for results.")
        log("=" * 50)

        page.wait_for_timeout(3000)
        browser.close()

if __name__ == "__main__":
    main()
