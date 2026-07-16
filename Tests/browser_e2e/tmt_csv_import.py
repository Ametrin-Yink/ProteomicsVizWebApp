"""Upload TMT channel CSV and complete TMT pipeline."""
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:3000"
ROOT = Path(__file__).parent.parent.parent
TMT_CSV = str(ROOT / "SampleData" / "real_PD_files" / "TMT-Channel-design.csv")

def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg.encode('ascii',errors='replace').decode()}", flush=True)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    page = ctx.new_page()
    page.set_default_timeout(30000)

    # TMT Pipeline
    page.goto(f"{BASE}/", wait_until="networkidle")
    time.sleep(1)
    page.locator('button:has-text("TMT")').first.click()
    page.wait_for_url("**/new/upload**")
    time.sleep(3)

    # Select file
    page.locator('button:has-text("Browse File Library")').first.click()
    time.sleep(2)
    page.locator('[role="treeitem"]:has-text("E2E_TMT")').first.click()
    time.sleep(2)
    for i in range(page.locator('tbody tr').count()):
        row = page.locator('tbody tr').nth(i)
        if "tmt_sample" in (row.text_content() or "").lower():
            row.locator('input[type="checkbox"]').check()
            log("Selected TMT file")
            break
    time.sleep(0.5)
    page.locator('button:has-text("Select")').last.click(timeout=10000)
    time.sleep(5)

    # Continue to metadata
    for i in range(30):
        btn = page.locator('button:has-text("Continue")').first
        if btn.is_visible() and btn.is_enabled():
            btn.click()
            log(f"-> metadata ({i}s)")
            break
        time.sleep(2)
    time.sleep(3)

    # === METADATA PAGE ===
    page.wait_for_load_state("networkidle")
    time.sleep(5)

    # Wait for channel table
    for w in range(15):
        rows = page.locator('table tr').count()
        if rows > 2:
            log(f"Channel table: {rows} rows after {w*2}s")
            break
        time.sleep(2)

    # Upload CSV via the file input with accept=.csv
    # Click "Import Mapping CSV" button first to ensure the file input is ready
    import_btn = page.locator('button:has-text("Import Mapping CSV")').first
    if import_btn.is_visible(timeout=5000):
        import_btn.click()
        log("Clicked Import Mapping CSV")
        time.sleep(1)

    # Find and use the CSV file input
    csv_input = page.locator('input[type="file"][accept=".csv"]').first
    csv_input.set_input_files(TMT_CSV)
    log(f"Uploaded: {Path(TMT_CSV).name}")
    time.sleep(5)

    # Verify mapping was loaded
    table_rows = page.locator('table tr').count()
    log(f"After CSV import: {table_rows} rows")

    # Continue through wizard
    for url_part in ["comparisons", "config", "summary"]:
        for i in range(120):
            btn = page.locator('button:has-text("Continue")').first
            if btn.is_visible() and btn.is_enabled():
                btn.click()
                log(f"-> {url_part} ({i}s)")
                break
            time.sleep(2)
        time.sleep(2)
        try: page.wait_for_url(f"**/new/{url_part}**", timeout=25000)
        except: pass
        log(f"{url_part}: {page.url.split('?')[0]}")

        if url_part == "comparisons":
            auto = page.locator('button:has-text("Auto-Generate")').first
            if auto.is_visible(timeout=3000):
                auto.click()
                time.sleep(1)
                log("Auto-generated comparisons")
        elif url_part == "config":
            sel = page.locator('select').first
            if sel.is_visible(timeout=3000):
                sel.select_option(label="Human")
                log("Human organism")
                time.sleep(1)

    # Start
    if "summary" in page.url:
        time.sleep(2)
        page.once("dialog", lambda d: d.accept())
        for i in range(30):
            btn = page.locator('button:has-text("Start Analysis")').first
            if btn.is_visible() and btn.is_enabled():
                btn.click()
                log("[OK] TMT ANALYSIS STARTED!")
                break
            time.sleep(2)
        time.sleep(3)
        try: page.wait_for_url("**/analysis/processing**", timeout=20000)
        except: pass
        log(f"Final URL: {page.url.split('?')[0]}")

    browser.close()
    log("Done")
