"""Final targeted pipeline test — headless, precise selectors."""
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:3000"
ROOT = Path(__file__).parent.parent.parent
CHANNEL_CSV = str(ROOT / "Tests" / "fixtures" / "tmt_channel_design.csv")

def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg.encode('ascii',errors='replace').decode()}", flush=True)

def main():
    log("Pipeline test (headless)")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()
        page.set_default_timeout(15000)

        # Verify fixes first
        page.goto(f"{BASE}/files", wait_until="networkidle")
        time.sleep(1)

        # Check fixes
        fixes = {
            "tree ARIA": page.locator('[role="tree"]').count(),
            "aria-labels": page.locator('[aria-label="Create new folder"]').count(),
            "aria-sort": page.locator('[aria-sort]').count(),
            "tooltips": page.locator('span[title]').count(),
            "min-h-44": page.locator('[class*="min-h-\\[44px\\]"]').count(),
            "dialog ARIA": 0,  # check later
            "wizard stepper": 0,
        }
        for name, count in fixes.items():
            log(f"  {name}: {'OK' if count > 0 else 'CHECK'} ({count})")

        # TMT Pipeline
        log("\nTMT Pipeline:")
        page.goto(f"{BASE}/", wait_until="networkidle")
        time.sleep(1)

        # Click DIA card (use DIA since files are .txt)
        page.locator('button:has-text("DIA Analysis")').first.click()
        page.wait_for_url("**/new/upload**")
        time.sleep(2)

        # Browse library
        page.locator('button:has-text("Browse File Library")').first.click()
        time.sleep(2)

        # Navigate to E2E_DIA
        page.locator('[role="treeitem"]:has-text("E2E_DIA")').first.click()
        time.sleep(1.5)

        # Check file visibility in E2E_DIA (these are .txt files)
        file_rows = page.locator('tbody tr')
        row_count = file_rows.count()
        log(f"  Files in E2E_DIA: {row_count}")

        if row_count > 0:
            # Select all files
            page.locator('thead input[type="checkbox"]').first.check()
            log(f"  Selected {row_count} DIA files")
            time.sleep(0.5)
            # Click confirm
            page.locator('[data-testid="file-picker"] button:has-text("Select")').first.click()
            log("  Files selected, proceeding through wizard...")
            time.sleep(5)

            # Wait for files to be processed and Continue to become enabled
            for wait_i in range(30):
                btn = page.locator('button:has-text("Continue")').first
                if btn.is_visible() and btn.is_enabled():
                    btn.click()
                    log(f"  Continue step 1: upload -> after {wait_i}s wait")
                    break
                time.sleep(2)
            else:
                log("  [WARN] Continue not enabled after 60s")

            # Wait for metadata/comparisons/config/summary pages
            for step_name, url_part in [("metadata", "metadata"), ("comparisons", "comparisons"), ("config", "config"), ("summary", "summary")]:
                try:
                    page.wait_for_url(f"**/new/{url_part}**", timeout=30000)
                    log(f"  On {url_part} page")
                except:
                    log(f"  [WARN] Not on {url_part} page, trying Continue")
                time.sleep(2)

                if url_part == "metadata":
                    # Verify DiaMetadataTable has files
                    rows = page.locator('table tr').count()
                    log(f"  Metadata table: {rows} rows")

                if url_part == "comparisons":
                    auto = page.locator('button:has-text("Auto-Generate")').first
                    if auto.is_visible(timeout=3000):
                        auto.click()
                        log("  Auto-generated comparisons")
                        time.sleep(1)

                if url_part == "config":
                    sel = page.locator('select').first
                    if sel.is_visible(timeout=3000):
                        sel.select_option(label="Human")
                        log("  Selected organism")
                        time.sleep(1)

                # Click Continue for next step
                for w in range(20):
                    btn = page.locator('button:has-text("Continue")').first
                    if btn.is_visible() and btn.is_enabled():
                        btn.click()
                        log(f"  Continue: {url_part} -> next")
                        break
                    time.sleep(2)

            # Summary page — start analysis
            time.sleep(2)
            log(f"  Final URL: {page.url}")
            page.once("dialog", lambda d: d.accept())
            start = page.locator('button:has-text("Start Analysis")').first
            if start.is_visible() and start.is_enabled():
                start.click()
                log("  [OK] DIA analysis started!")
                try:
                    page.wait_for_url("**/analysis/processing**", timeout=30000)
                    log(f"  On processing page: {page.url}")
                except:
                    log(f"  Processing page not reached, at: {page.url}")
        else:
            log("  [WARN] No files visible in E2E_DIA - checking filter")
            # Check what filter is active
            all_btn = page.locator('button:has-text("All Files")').first
            if all_btn.is_visible():
                all_btn.click()
                time.sleep(1)
                file_rows = page.locator('tbody tr')
                log(f"  After All Files filter: {file_rows.count()} files")

        browser.close()
        log("\nDone")

if __name__ == "__main__":
    main()
