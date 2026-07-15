"""TMT pipeline — upload PANC0203, use channel design CSV for auto-fill metadata."""
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:3000"
ROOT = Path(__file__).parent.parent.parent
CSV = str(ROOT / "Tests" / "fixtures" / "tmt_channel_design.csv")

def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg.encode('ascii',errors='replace').decode()}", flush=True)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    page = ctx.new_page()

    log("=== TMT Pipeline Full Run ===")

    # Direct upload of PANC0203 instead of file library picker
    page.goto(f"{BASE}/")
    page.wait_for_load_state("networkidle")
    time.sleep(1)

    # Click TMT
    page.locator('button:has-text("TMT")').first.click()
    page.wait_for_url("**/new/upload**")
    time.sleep(2)
    log("Upload page loaded")

    # Upload file directly via the upload drop zone's file input
    panc = str(ROOT / "SampleData" / "real_PD_files" / "20260424_DOCK5_PANC0203_PSMs.txt")
    file_input = page.locator('input[type="file"][multiple]').first
    file_input.set_input_files(panc)
    log(f"Uploaded PANC0203 file directly (bypassing picker)")
    time.sleep(3)

    # Wait for upload processing
    for i in range(60):
        btn = page.locator('button:has-text("Continue")').first
        if btn.is_visible() and btn.is_enabled():
            log(f"Continue enabled after {i}s")
            btn.click()
            break
        time.sleep(2)

    # Metadata page
    try: page.wait_for_url("**/new/metadata**", timeout=30000)
    except: pass
    time.sleep(2)
    log(f"Metadata URL: {page.url}")

    # Upload channel design CSV
    if "metadata" in page.url:
        fi = page.locator('input[type="file"]').first
        if fi.is_visible(timeout=3000):
            fi.set_input_files(CSV)
            log("Uploaded channel design CSV")
            time.sleep(3)

    # Continue through wizard
    for step, url_part in enumerate(["comparisons", "config", "summary"]):
        for i in range(30):
            btn = page.locator('button:has-text("Continue")').first
            if btn.is_visible() and btn.is_enabled():
                btn.click()
                log(f"Continue to {url_part} (waited {i}s)")
                break
            time.sleep(2)
        try: page.wait_for_url(f"**/new/{url_part}**", timeout=30000)
        except: pass
        time.sleep(2)
        log(f"{url_part} URL: {page.url}")

        if url_part == "comparisons":
            auto = page.locator('button:has-text("Auto-Generate")').first
            if auto.is_visible(timeout=3000):
                auto.click()
                log("Auto-generated comparisons")
                time.sleep(1)
        elif url_part == "config":
            sel = page.locator('select').first
            if sel.is_visible(timeout=3000):
                sel.select_option(label="Human")
                log("Selected organism")
                time.sleep(1)

    # Summary — start
    if "summary" in page.url:
        time.sleep(2)
        # Check TMT mapping in summary
        mapping = page.locator('text=TMT Channel Mapping').count()
        log(f"TMT Channel Mapping in summary: {'OK' if mapping > 0 else 'MISSING'}")

        page.once("dialog", lambda d: d.accept())
        for i in range(20):
            btn = page.locator('button:has-text("Start Analysis")').first
            if btn.is_visible() and btn.is_enabled():
                btn.click()
                log(f"Started TMT analysis after {i}s wait")
                break
            time.sleep(2)

        try: page.wait_for_url("**/analysis/processing**", timeout=30000)
        except: pass
        log(f"Processing URL: {page.url}")

        if "processing" in page.url:
            log("[OK] TMT pipeline submitted for processing!")
        elif "visualization" in page.url:
            log("[OK] TMT pipeline complete — results page reached!")

    log("\n=== DONE ===")
    browser.close()
