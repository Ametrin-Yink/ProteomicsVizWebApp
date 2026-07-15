"""Verify TMT + DIA pipelines manually through browser — with screenshots."""
import time, os
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:3000"
ROOT = Path(__file__).parent.parent.parent
SDIR = ROOT / "Tests" / "browser_e2e" / "screenshots"
SDIR.mkdir(parents=True, exist_ok=True)
CHANNEL_CSV = str(ROOT / "Tests" / "fixtures" / "tmt_channel_design.csv")

def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg.encode('ascii',errors='replace').decode()}", flush=True)

def ss(page, name):
    """Take screenshot."""
    path = str(SDIR / f"{name}.png")
    page.screenshot(path=path, full_page=True)
    log(f"  screenshot: {name}")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    page = ctx.new_page()
    page.set_default_timeout(20000)

    # ===== TMT PIPELINE =====
    log("=" * 50)
    log("TMT PIPELINE")
    log("=" * 50)

    # Step 1: Home -> TMT
    page.goto(f"{BASE}/", wait_until="networkidle")
    time.sleep(1)
    ss(page, "tmt_01_home")
    page.locator('button:has-text("TMT")').first.click()
    page.wait_for_url("**/new/upload**")
    time.sleep(2)
    ss(page, "tmt_02_upload")
    log("Step 1: Upload page loaded")

    # Step 2: Open File Library Picker
    browse = page.locator('button:has-text("Browse File Library")').first
    browse.wait_for(state="visible")
    browse.click()
    time.sleep(2)
    ss(page, "tmt_03_picker_open")
    log("Step 2: Picker opened")

    # Step 3: Navigate to proj -> dock5 in picker tree
    # First, check what tree items are visible
    tree_items = page.locator('[role="treeitem"]')
    count = tree_items.count()
    log(f"  Tree items: {count}")
    for i in range(min(count, 5)):
        try:
            text = tree_items.nth(i).text_content()
            log(f"    [{i}] {text}")
        except: pass

    # Click proj to expand
    proj_item = page.locator('[role="treeitem"]:has-text("proj")').first
    if proj_item.is_visible(timeout=5000):
        proj_item.click()
        time.sleep(2)
        ss(page, "tmt_04_proj_expanded")

    # Now look for dock5
    dock5_item = page.locator('[role="treeitem"]:has-text("dock5")').first
    if dock5_item.is_visible(timeout=5000):
        dock5_item.click()
        time.sleep(2)
        ss(page, "tmt_05_dock5")

    # Step 4: Check what files are visible in picker file list
    # Check if there's an empty state
    empty_state = page.locator('text=No files').count()
    file_rows = page.locator('tbody tr').count()
    log(f"  Files visible: {file_rows}, Empty state: {empty_state}")

    # If empty, try clicking "All Files" filter
    if empty_state > 0 or file_rows == 0:
        log("  Trying to change filter...")
        # Look for filter buttons
        all_btn = page.locator('button:has-text("All Files")').first
        if all_btn.is_visible(timeout=3000):
            all_btn.click()
            time.sleep(1)
            file_rows = page.locator('tbody tr').count()
            log(f"  After filter change: {file_rows} files")

    ss(page, "tmt_06_files")

    # Step 5: Select files
    if file_rows > 0:
        # Check each row for DOCK5 or PANC
        for i in range(file_rows):
            row = page.locator('tbody tr').nth(i)
            try:
                name = row.text_content()
                if "PANC" in name or "DOCK5" in name:
                    cb = row.locator('input[type="checkbox"]')
                    if cb.is_visible():
                        cb.check()
                        log(f"  Selected: {name.strip()[:60]}")
                        break
            except: pass
        time.sleep(0.5)

    # Step 6: Click Select/Confirm
    # Look for the confirm button
    select_btn = page.locator('button:has-text("Select")').last  # last "Select" button, not first
    if select_btn.is_visible(timeout=3000):
        # If there's an overlay intercepting, try force click
        try:
            select_btn.click(timeout=5000)
            log("  Clicked Select (confirm)")
        except:
            # Try force click
            select_btn.click(force=True, timeout=5000)
            log("  Force-clicked Select")
    time.sleep(3)
    ss(page, "tmt_07_after_select")

    # Step 7: Wait for Continue to be enabled
    for i in range(60):
        btn = page.locator('button:has-text("Continue")').first
        try:
            if btn.is_enabled():
                log(f"  Continue enabled after {i}s")
                btn.click()
                break
        except: pass
        time.sleep(2)
    else:
        log("  [WARN] Continue never enabled")
        # Check page state
        ss(page, "tmt_08_stuck")
        log(f"  URL: {page.url}")

    # Step 8: Metadata page
    time.sleep(2)
    try: page.wait_for_url("**/new/metadata**", timeout=15000)
    except: pass
    ss(page, "tmt_09_metadata")
    log(f"  After Continue, URL: {page.url}")

    if "metadata" in page.url:
        # Upload channel CSV
        fi = page.locator('input[type="file"]').first
        if fi.is_visible(timeout=3000):
            fi.set_input_files(CHANNEL_CSV)
            log("  Uploaded channel design CSV")
            time.sleep(3)
        ss(page, "tmt_10_csv_uploaded")

    # Step 9: Continue through remaining wizard steps
    wizard_steps = [
        ("comparisons", "tmt_11_comparisons"),
        ("config", "tmt_12_config"),
        ("summary", "tmt_13_summary"),
    ]

    for url_part, ss_name in wizard_steps:
        # Click Continue
        for i in range(30):
            btn = page.locator('button:has-text("Continue")').first
            try:
                if btn.is_enabled():
                    btn.click()
                    log(f"  Continue -> {url_part}")
                    break
            except: pass
            time.sleep(2)
        time.sleep(2)
        try: page.wait_for_url(f"**/new/{url_part}**", timeout=20000)
        except: pass
        ss(page, ss_name)
        log(f"  {url_part} URL: {page.url.split('?')[0]}")

        if url_part == "comparisons":
            auto = page.locator('button:has-text("Auto-Generate")').first
            if auto.is_visible(timeout=3000):
                auto.click()
                log("  Auto-generated comparisons")
                time.sleep(1)
        elif url_part == "config":
            sel = page.locator('select').first
            if sel.is_visible(timeout=3000):
                sel.select_option(label="Human")
                log("  Selected organism")
                time.sleep(1)

    # Step 10: Start Analysis
    if "summary" in page.url:
        time.sleep(2)
        # Confirm dialog
        page.once("dialog", lambda d: d.accept())
        for i in range(20):
            btn = page.locator('button:has-text("Start Analysis")').first
            try:
                if btn.is_enabled():
                    btn.click()
                    log(f"  Started TMT analysis!")
                    break
            except: pass
            time.sleep(2)
        time.sleep(3)
        try: page.wait_for_url("**/analysis/processing**", timeout=20000)
        except: pass
        ss(page, "tmt_14_processing")
        log(f"  Final URL: {page.url.split('?')[0]}")

    # ===== DIA PIPELINE (quick path) =====
    log("\n" + "=" * 50)
    log("DIA PIPELINE")
    log("=" * 50)

    page.goto(f"{BASE}/", wait_until="networkidle")
    time.sleep(1)
    page.locator('button:has-text("DIA")').first.click()
    page.wait_for_url("**/new/upload**")
    time.sleep(2)
    ss(page, "dia_01_upload")

    # Open picker
    page.locator('button:has-text("Browse File Library")').first.click()
    time.sleep(2)
    ss(page, "dia_02_picker")

    # Navigate to E2E_DIA
    page.locator('[role="treeitem"]:has-text("E2E_DIA")').first.click()
    time.sleep(2)
    ss(page, "dia_03_e2edia")

    # Select all
    header_cb = page.locator('thead input[type="checkbox"]').first
    if header_cb.is_visible(timeout=3000):
        header_cb.check()
        log(f"  Selected all DIA files")
    time.sleep(0.5)

    # Confirm
    page.locator('button:has-text("Select")').last.click(timeout=5000)
    time.sleep(3)
    ss(page, "dia_04_selected")

    # Wait for files to process
    for i in range(60):
        btn = page.locator('button:has-text("Continue")').first
        try:
            if btn.is_enabled():
                log(f"  DIA Continue enabled after {i}s")
                break
        except: pass
        time.sleep(2)

    # Quick wizard navigation
    for url_part in ["metadata", "comparisons", "config", "summary"]:
        time.sleep(2)
        for i in range(20):
            btn = page.locator('button:has-text("Continue")').first
            try:
                if btn.is_enabled():
                    btn.click()
                    log(f"  DIA Continue -> {url_part}")
                    break
            except: pass
            time.sleep(2)
        try: page.wait_for_url(f"**/new/{url_part}**", timeout=15000)
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

    ss(page, "dia_05_summary")

    # Start DIA
    if "summary" in page.url:
        time.sleep(2)
        page.once("dialog", lambda d: d.accept())
        for i in range(20):
            btn = page.locator('button:has-text("Start Analysis")').first
            try:
                if btn.is_enabled():
                    btn.click()
                    log(f"  Started DIA analysis!")
                    break
            except: pass
            time.sleep(2)
        time.sleep(3)
        try: page.wait_for_url("**/analysis/processing**", timeout=20000)
        except: pass
        ss(page, "dia_06_processing")

    log(f"\n  TMT final URL: {page.url.split('?')[0]}")

    browser.close()
    log("\nDone. Screenshots in Tests/browser_e2e/screenshots/")
