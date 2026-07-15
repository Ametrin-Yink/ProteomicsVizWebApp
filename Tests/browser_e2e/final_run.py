"""Use E2E_TMT + E2E_DIA for TMT and DIA pipelines."""
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:3000"
ROOT = Path(__file__).parent.parent.parent
CHANNEL_CSV = str(ROOT / "Tests" / "fixtures" / "tmt_channel_design.csv")

def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg.encode('ascii',errors='replace').decode()}", flush=True)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    page = ctx.new_page()
    page.set_default_timeout(30000)

    # ===== TMT PIPELINE (using E2E_TMT) =====
    log("===== TMT PIPELINE (E2E_TMT) =====")
    page.goto(f"{BASE}/", wait_until="networkidle")
    time.sleep(1)
    page.locator('button:has-text("TMT")').first.click()
    page.wait_for_url("**/new/upload**")
    time.sleep(3)
    log("Upload page")

    # Open picker, navigate to E2E_TMT
    page.locator('button:has-text("Browse File Library")').first.click()
    time.sleep(2)
    page.locator('[role="treeitem"]:has-text("E2E_TMT")').first.click()
    time.sleep(2)
    rows = page.locator('tbody tr').count()
    log(f"Files in E2E_TMT: {rows}")

    if rows > 0:
        # Select the tmt_sample file
        for i in range(rows):
            row = page.locator('tbody tr').nth(i)
            try:
                text = row.text_content() or ""
                if "tmt_sample" in text.lower():
                    row.locator('input[type="checkbox"]').check()
                    log(f"Selected: {text.strip()[:60]}")
                    break
            except: pass
        time.sleep(0.5)

        # Confirm in picker
        page.locator('button:has-text("Select")').last.click(timeout=10000)
        time.sleep(5)
        log("Confirmed selection")

        # Wait for Continue
        for i in range(60):
            btn = page.locator('button:has-text("Continue")').first
            if btn.is_visible() and btn.is_enabled():
                log(f"Continue enabled ({i}s)")
                btn.click()
                break
            time.sleep(2)

        # Metadata page
        time.sleep(2)
        try: page.wait_for_url("**/new/metadata**", timeout=20000)
        except: pass
        log(f"At: {page.url.split('?')[0]}")

        if "metadata" in page.url:
            fi = page.locator('input[type="file"]').first
            if fi.is_visible(timeout=5000):
                fi.set_input_files(CHANNEL_CSV)
                log("Channel CSV uploaded")
                time.sleep(3)

        # Continue through wizard
        for url_part in ["comparisons", "config", "summary"]:
            for i in range(40):
                btn = page.locator('button:has-text("Continue")').first
                if btn.is_visible() and btn.is_enabled():
                    btn.click()
                    log(f" -> {url_part} ({i}s)")
                    break
                time.sleep(2)
            time.sleep(2)
            try: page.wait_for_url(f"**/new/{url_part}**", timeout=25000)
            except: pass
            log(f"URL: {page.url.split('?')[0]}")

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
                    log("Organism: Human")
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
            log(f"TMT final: {page.url.split('?')[0]}")

    # ===== DIA PIPELINE (E2E_DIA) =====
    log("\n===== DIA PIPELINE (E2E_DIA) =====")
    page.goto(f"{BASE}/", wait_until="networkidle")
    time.sleep(1)
    page.locator('button:has-text("DIA")').first.click()
    page.wait_for_url("**/new/upload**")
    time.sleep(3)

    # Picker
    page.locator('button:has-text("Browse File Library")').first.click()
    time.sleep(2)
    page.locator('[role="treeitem"]:has-text("E2E_DIA")').first.click()
    time.sleep(2)
    rows = page.locator('tbody tr').count()
    log(f"Files in E2E_DIA: {rows}")

    # Select all
    page.locator('thead input[type="checkbox"]').first.check()
    time.sleep(0.5)
    page.locator('button:has-text("Select")').last.click(timeout=10000)
    time.sleep(5)
    log("Selected all DIA files")

    # Wait for Continue
    for i in range(60):
        btn = page.locator('button:has-text("Continue")').first
        if btn.is_visible() and btn.is_enabled():
            log(f"Continue enabled ({i}s)")
            btn.click()
            break
        time.sleep(2)

    # Quick wizard
    for url_part in ["metadata", "comparisons", "config", "summary"]:
        time.sleep(2)
        for i in range(30):
            btn = page.locator('button:has-text("Continue")').first
            if btn.is_visible() and btn.is_enabled():
                btn.click()
                log(f" -> {url_part} ({i}s)")
                break
            time.sleep(2)
        try: page.wait_for_url(f"**/new/{url_part}**", timeout=20000)
        except: pass

        if url_part == "comparisons":
            auto = page.locator('button:has-text("Auto-Generate")').first
            if auto.is_visible(timeout=3000):
                auto.click()
                time.sleep(1)
        elif url_part == "config":
            sel = page.locator('select').first
            if sel.is_visible(timeout=3000):
                sel.select_option(label="Human")
                time.sleep(1)

    # Start
    if "summary" in page.url:
        time.sleep(2)
        page.once("dialog", lambda d: d.accept())
        for i in range(30):
            btn = page.locator('button:has-text("Start Analysis")').first
            if btn.is_visible() and btn.is_enabled():
                btn.click()
                log("[OK] DIA ANALYSIS STARTED!")
                break
            time.sleep(2)
        time.sleep(3)
        try: page.wait_for_url("**/analysis/processing**", timeout=20000)
        except: pass
        log(f"DIA final: {page.url.split('?')[0]}")

    browser.close()
    log("\n=== DONE ===")
