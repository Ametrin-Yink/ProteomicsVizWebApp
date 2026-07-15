"""Complete TMT + DIA pipelines with proper React input handling."""
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

    # ============================================================
    # TMT PIPELINE
    # ============================================================
    log("===== TMT PIPELINE =====")

    page.goto(f"{BASE}/", wait_until="networkidle")
    time.sleep(1)
    page.locator('button:has-text("TMT")').first.click()
    page.wait_for_url("**/new/upload**")
    time.sleep(3)

    # Select TMT file from library
    page.locator('button:has-text("Browse File Library")').first.click()
    time.sleep(2)
    page.locator('[role="treeitem"]:has-text("E2E_TMT")').first.click()
    time.sleep(2)
    for i in range(page.locator('tbody tr').count()):
        row = page.locator('tbody tr').nth(i)
        if "tmt_sample" in (row.text_content() or "").lower():
            row.locator('input[type="checkbox"]').check()
            log("TMT: Selected file")
            break
    time.sleep(0.5)
    page.locator('button:has-text("Select")').last.click(timeout=10000)
    time.sleep(5)
    log("TMT: Confirmed")

    # Continue
    for i in range(30):
        btn = page.locator('button:has-text("Continue")').first
        if btn.is_visible() and btn.is_enabled():
            btn.click()
            log(f"TMT: -> metadata ({i}s)")
            break
        time.sleep(2)

    time.sleep(3)
    try: page.wait_for_url("**/new/metadata**", timeout=20000)
    except: pass
    log(f"TMT metadata: {page.url.split('?')[0]}")

    if "metadata" in page.url:
        page.wait_for_load_state("networkidle")
        time.sleep(5)

        # Check what's on the page
        body_snippet = page.locator('body').text_content()[:500]
        if "Something went wrong" in body_snippet:
            log("[ERROR] Error boundary on TMT metadata page!")
        else:
            log(f"Page OK: {body_snippet[:200]}")

        # Check for channel mapping table
        table = page.locator('table')
        t_count = table.count()
        log(f"Tables: {t_count}")
        for ti in range(min(t_count, 3)):
            rows = table.nth(ti).locator('tr').count()
            log(f"  Table {ti}: {rows} rows")

        # If channel table has rows, fill mapping manually
        if t_count > 0:
            # Wait for channels to load
            for w in range(10):
                rows = table.first.locator('tr').count()
                if rows > 2:
                    log(f"TMT: Channel table has {rows} rows")
                    break
                time.sleep(2)

            # Fill channel-to-condition mapping
            # Channels: 126=DMSO_24h, 127N=DMSO_24h, 127C=DMSO_24h,
            #           128N=INCB224525_24h, 128C=INCB224525_24h, 129N=INCB224525_24h,
            #           129C=DMSO_48h, 130N=DMSO_48h, 130C=INCB224525_48h,
            #           131N=INCB224525_48h, 131C=INCB224525_48h,
            #           132N=INCB231845_24h, 132C=INCB231845_24h, 133N=INCB231845_24h,
            #           133C=DMSO_48h, 134N=DMSO_48h
            channel_map = {
                # Channel: (condition_group, replicate)
                # Use simple column structure: experiment, condition, replicate
            }

            # Look for import button
            import_btns = page.locator('button:has-text("Import")')
            log(f"Import buttons: {import_btns.count()}")

            # Try clicking "Import Mapping CSV"
            for bi in range(import_btns.count()):
                btn = import_btns.nth(bi)
                if btn.is_visible():
                    log(f"  Import btn {bi}: {btn.text_content()}")

            # Try uploading via hidden file input - look for any file input
            all_inputs = page.locator('input')
            log(f"All inputs: {all_inputs.count()}")
            for ii in range(min(all_inputs.count(), 5)):
                inp = all_inputs.nth(ii)
                inp_type = inp.get_attribute('type') or ''
                inp_accept = inp.get_attribute('accept') or ''
                log(f"  Input {ii}: type={inp_type}, accept={inp_accept}")

    # Continue through wizard (TMT)
    for url_part in ["comparisons", "config", "summary"]:
        for i in range(120):
            btn = page.locator('button:has-text("Continue")').first
            if btn.is_visible() and btn.is_enabled():
                btn.click()
                log(f"TMT: -> {url_part} ({i}s)")
                break
            time.sleep(2)
        time.sleep(2)
        try: page.wait_for_url(f"**/new/{url_part}**", timeout=25000)
        except: pass
        log(f"TMT {url_part}: {page.url.split('?')[0]}")

        if url_part == "comparisons":
            auto = page.locator('button:has-text("Auto-Generate")').first
            if auto.is_visible(timeout=3000):
                auto.click()
                time.sleep(1)
                log("TMT: Auto-generated comparisons")
        elif url_part == "config":
            sel = page.locator('select').first
            if sel.is_visible(timeout=3000):
                sel.select_option(label="Human")
                log("TMT: Human organism")
                time.sleep(1)

    # Start TMT
    if "summary" in page.url:
        time.sleep(2)
        page.once("dialog", lambda d: d.accept())
        for i in range(30):
            btn = page.locator('button:has-text("Start Analysis")').first
            if btn.is_visible() and btn.is_enabled():
                btn.click()
                log("[OK] TMT STARTED!")
                break
            time.sleep(2)
        time.sleep(3)
        try: page.wait_for_url("**/analysis/processing**", timeout=20000)
        except: pass
        log(f"TMT final: {page.url.split('?')[0]}")

    # ============================================================
    # DIA PIPELINE
    # ============================================================
    log("\n===== DIA PIPELINE =====")

    page.goto(f"{BASE}/", wait_until="networkidle")
    time.sleep(1)
    page.locator('button:has-text("DIA")').first.click()
    page.wait_for_url("**/new/upload**")
    time.sleep(3)

    # Select all E2E_DIA files
    page.locator('button:has-text("Browse File Library")').first.click()
    time.sleep(2)
    page.locator('[role="treeitem"]:has-text("E2E_DIA")').first.click()
    time.sleep(2)
    page.locator('thead input[type="checkbox"]').first.check()
    time.sleep(0.5)
    page.locator('button:has-text("Select")').last.click(timeout=10000)
    time.sleep(5)
    log("DIA: 12 files selected")

    # Continue
    for i in range(30):
        btn = page.locator('button:has-text("Continue")').first
        if btn.is_visible() and btn.is_enabled():
            btn.click()
            log(f"DIA: -> metadata ({i}s)")
            break
        time.sleep(2)

    time.sleep(3)
    try: page.wait_for_url("**/new/metadata**", timeout=20000)
    except: pass
    page.wait_for_load_state("networkidle")
    time.sleep(5)
    log(f"DIA metadata: {page.url.split('?')[0]}")

    if "metadata" in page.url:
        # Check for error boundary
        body = page.locator('body').text_content()[:300]
        if "Something went wrong" in body:
            log("[ERROR] Error boundary on DIA metadata!")
        else:
            log("DIA metadata page OK")

        # Add Condition column if not present
        add_group = page.locator('button:has-text("Add Group")').first
        if add_group.is_visible(timeout=3000):
            add_group.click()
            time.sleep(1)
            group_input = page.locator('input[placeholder*="column"]').first
            if group_input.is_visible(timeout=3000):
                group_input.click()
                time.sleep(0.2)
                page.keyboard.type("Condition")
                time.sleep(0.3)
                page.keyboard.press("Enter")
                time.sleep(2)
                log("DIA: Added Condition column")

        # Fill metadata using keyboard.type() for React controlled inputs
        table_rows = page.locator('table tbody tr')
        row_count = table_rows.count()
        log(f"DIA: {row_count} rows to fill")

        conditions = [
            ("Drug1_INCB224525", "1"), ("Drug1_INCB224525", "2"), ("Drug1_INCB224525", "3"),
            ("Drug2_INCB231845", "1"), ("Drug2_INCB231845", "2"), ("Drug2_INCB231845", "3"),
            ("Drug3", "1"), ("Drug3", "2"), ("Drug3", "3"),
            ("DMSO", "1"), ("DMSO", "2"), ("DMSO", "3"),
        ]

        for i in range(min(row_count, 12)):
            row = table_rows.nth(i)
            inputs = row.locator('input').all()
            cond, rep = conditions[i]
            log(f"DIA row {i}: {cond}, rep={rep}, inputs={len(inputs)}")

            if len(inputs) >= 2:
                # Experiment name (first input)
                inputs[0].click()
                time.sleep(0.1)
                inputs[0].fill("")
                time.sleep(0.1)
                page.keyboard.type(f"Exp_{cond.split('_')[0]}")
                time.sleep(0.2)

                # Condition column (middle input if 3 inputs)
                if len(inputs) >= 3:
                    inputs[1].click()
                    time.sleep(0.1)
                    inputs[1].fill("")
                    time.sleep(0.1)
                    page.keyboard.type(cond)
                    time.sleep(0.2)

                # Replicate (last input)
                rep_input = inputs[-1]
                rep_input.click()
                time.sleep(0.1)
                rep_input.fill("")
                time.sleep(0.1)
                page.keyboard.type(rep)
                time.sleep(0.2)

            # Tab away to trigger blur/change
            page.keyboard.press("Tab")
            time.sleep(0.1)

        log("DIA: All metadata filled with keyboard.type()")

    # Continue through DIA wizard
    for url_part in ["comparisons", "config", "summary"]:
        for i in range(120):
            btn = page.locator('button:has-text("Continue")').first
            if btn.is_visible() and btn.is_enabled():
                btn.click()
                log(f"DIA: -> {url_part} ({i}s)")
                break
            time.sleep(2)
        time.sleep(2)
        try: page.wait_for_url(f"**/new/{url_part}**", timeout=25000)
        except: pass
        log(f"DIA {url_part}: {page.url.split('?')[0]}")

        if url_part == "comparisons":
            auto = page.locator('button:has-text("Auto-Generate")').first
            if auto.is_visible(timeout=3000):
                auto.click()
                time.sleep(1)
                log("DIA: Auto-generated comparisons")
        elif url_part == "config":
            sel = page.locator('select').first
            if sel.is_visible(timeout=3000):
                sel.select_option(label="Human")
                log("DIA: Human organism")
                time.sleep(1)

    # Start DIA
    if "summary" in page.url:
        time.sleep(2)
        page.once("dialog", lambda d: d.accept())
        for i in range(30):
            btn = page.locator('button:has-text("Start Analysis")').first
            if btn.is_visible() and btn.is_enabled():
                btn.click()
                log("[OK] DIA STARTED!")
                break
            time.sleep(2)
        time.sleep(3)
        try: page.wait_for_url("**/analysis/processing**", timeout=20000)
        except: pass
        log(f"DIA final: {page.url.split('?')[0]}")

    browser.close()
    log("\n=== DONE ===")
