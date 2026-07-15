"""Run TMT + DIA pipelines with proper metadata input."""
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:3000"
ROOT = Path(__file__).parent.parent.parent
TMT_CHANNEL_CSV = str(ROOT / "SampleData" / "real_PD_files" / "TMT-Channel-design.csv")

def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg.encode('ascii',errors='replace').decode()}", flush=True)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    page = ctx.new_page()
    page.set_default_timeout(30000)

    # ===== TMT PIPELINE =====
    log("=" * 50)
    log("TMT PIPELINE")
    log("=" * 50)

    page.goto(f"{BASE}/", wait_until="networkidle")
    time.sleep(1)
    page.locator('button:has-text("TMT")').first.click()
    page.wait_for_url("**/new/upload**")
    time.sleep(3)

    # Open picker, select tmt file from E2E_TMT
    page.locator('button:has-text("Browse File Library")').first.click()
    time.sleep(2)
    page.locator('[role="treeitem"]:has-text("E2E_TMT")').first.click()
    time.sleep(2)
    # Select tmt_sample
    for i in range(page.locator('tbody tr').count()):
        row = page.locator('tbody tr').nth(i)
        if "tmt_sample" in (row.text_content() or "").lower():
            row.locator('input[type="checkbox"]').check()
            log("TMT: Selected tmt_sample_10000rows.txt")
            break
    time.sleep(0.5)
    page.locator('button:has-text("Select")').last.click(timeout=10000)
    time.sleep(5)
    log("TMT: File selection confirmed")

    # Click Continue
    for i in range(30):
        btn = page.locator('button:has-text("Continue")').first
        if btn.is_visible() and btn.is_enabled():
            btn.click()
            log(f"TMT: Continue -> metadata ({i}s)")
            break
        time.sleep(2)

    # === METADATA PAGE ===
    time.sleep(2)
    try: page.wait_for_url("**/new/metadata**", timeout=20000)
    except: pass
    log(f"TMT metadata URL: {page.url.split('?')[0]}")

    if "metadata" in page.url:
        time.sleep(3)
        # Upload channel design CSV via file input
        file_inputs = page.locator('input[type="file"]')
        count = file_inputs.count()
        log(f"TMT: Found {count} file inputs on metadata page")

        # Try uploading via the Import Mapping CSV button
        # First check if there's a visible import button
        import_btn = page.locator('button:has-text("Import")').first
        if import_btn.is_visible(timeout=3000):
            # Click the import button - it might trigger a hidden file input
            import_btn.click()
            time.sleep(1)
            # Find the file input that appeared
            file_inputs = page.locator('input[type="file"]')
            if file_inputs.count() > 0:
                file_inputs.last.set_input_files(TMT_CHANNEL_CSV)
                log("TMT: Uploaded channel design CSV via import button")
                time.sleep(3)
        else:
            # Try direct file input upload
            visible_input = None
            for i in range(count):
                inp = file_inputs.nth(i)
                try:
                    inp.set_input_files(TMT_CHANNEL_CSV)
                    log(f"TMT: Uploaded CSV via input #{i}")
                    time.sleep(3)
                    break
                except: pass

        # Wait for channel mapping table to populate
        time.sleep(5)
        # Check if table rows appeared
        table_rows = page.locator('table tr').count()
        log(f"TMT: Channel mapping table has {table_rows} rows")

    # Click Continue through remaining wizard
    for url_part in ["comparisons", "config", "summary"]:
        for i in range(60):
            btn = page.locator('button:has-text("Continue")').first
            if btn.is_visible() and btn.is_enabled():
                btn.click()
                log(f"TMT: -> {url_part} ({i}s)")
                break
            time.sleep(2)
        time.sleep(2)
        try: page.wait_for_url(f"**/new/{url_part}**", timeout=25000)
        except: pass
        log(f"TMT {url_part} URL: {page.url.split('?')[0]}")

        if url_part == "comparisons":
            auto = page.locator('button:has-text("Auto-Generate")').first
            if auto.is_visible(timeout=3000):
                auto.click()
                time.sleep(1)
                log("TMT: Auto-generated comparisons")
            else:
                log("TMT: Auto-generate button not found")
        elif url_part == "config":
            sel = page.locator('select').first
            if sel.is_visible(timeout=3000):
                sel.select_option(label="Human")
                log("TMT: Selected organism Human")
                time.sleep(1)

    # START TMT
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

    # ===== DIA PIPELINE =====
    log("\n" + "=" * 50)
    log("DIA PIPELINE")
    log("=" * 50)

    page.goto(f"{BASE}/", wait_until="networkidle")
    time.sleep(1)
    page.locator('button:has-text("DIA")').first.click()
    page.wait_for_url("**/new/upload**")
    time.sleep(3)
    log("DIA: Upload page")

    # Open picker, select all E2E_DIA files
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
            log(f"DIA: Continue -> metadata ({i}s)")
            break
        time.sleep(2)

    # === DIA METADATA PAGE ===
    time.sleep(2)
    try: page.wait_for_url("**/new/metadata**", timeout=20000)
    except: pass
    time.sleep(3)
    log(f"DIA metadata URL: {page.url.split('?')[0]}")

    if "metadata" in page.url:
        # Fill in metadata for each DIA file
        # Pattern: every 3 files = one condition, files 10-12 = DMSO
        conditions = {
            range(0, 3): "Drug1_INCB224525",
            range(3, 6): "Drug2_INCB231845",
            range(6, 9): "Drug3",
            range(9, 12): "DMSO",
        }

        # Find all input rows in the metadata table
        table_rows = page.locator('table tbody tr')
        row_count = table_rows.count()
        log(f"DIA: Metadata table has {row_count} rows")

        for i in range(min(row_count, 12)):
            row = table_rows.nth(i)
            inputs = row.locator('input').all()

            # Determine condition based on file index
            cond_name = "DMSO"
            replicate = "1"
            if i < 3:
                cond_name = "Drug1_INCB224525"
                replicate = str(i + 1)
            elif i < 6:
                cond_name = "Drug2_INCB231845"
                replicate = str(i - 2)
            elif i < 9:
                cond_name = "Drug3"
                replicate = str(i - 5)
            else:
                cond_name = "DMSO"
                replicate = str(i - 8)

            log(f"DIA: Row {i} -> {cond_name}, rep {replicate}, inputs={len(inputs)}")

            # Inputs are: [experiment, condition_col_1, condition_col_2, ..., replicate, batch?]
            # DiaMetadataTable columns: experiment | condition columns... | replicate
            if len(inputs) >= 2:
                # First input = experiment name
                inputs[0].fill(f"Exp_{cond_name}")
                time.sleep(0.1)
                # Last input might be replicate
                if len(inputs) >= 2:
                    inputs[-1].fill(replicate)
                    time.sleep(0.1)

        log("DIA: Metadata filled")

        # Add condition columns if needed
        # Look for "Add Group" button
        add_group = page.locator('button:has-text("Add Group")').first
        if add_group.is_visible(timeout=3000):
            add_group.click()
            time.sleep(1)
            # Type condition column name
            group_input = page.locator('input[placeholder*="column"]').first
            if group_input.is_visible(timeout=3000):
                group_input.fill("Condition")
                group_input.press("Enter")
                time.sleep(1)
                log("DIA: Added Condition column")

                # Now fill condition values for each row
                table_rows = page.locator('table tbody tr')
                for i in range(min(table_rows.count(), 12)):
                    row = table_rows.nth(i)
                    inputs = row.locator('input').all()
                    if i < 3:
                        cond = "Drug1_INCB224525"
                    elif i < 6:
                        cond = "Drug2_INCB231845"
                    elif i < 9:
                        cond = "Drug3"
                    else:
                        cond = "DMSO"
                    # Find the condition input (not experiment, not replicate)
                    if len(inputs) >= 2:
                        # The condition input is between experiment and replicate
                        for j in range(len(inputs)):
                            val = inputs[j].input_value()
                            if val == "" and j > 0 and j < len(inputs) - 1:
                                inputs[j].fill(cond)
                                break
                        time.sleep(0.1)
                log("DIA: Condition values filled")

    # Continue through DIA wizard
    for url_part in ["comparisons", "config", "summary"]:
        for i in range(60):
            btn = page.locator('button:has-text("Continue")').first
            if btn.is_visible() and btn.is_enabled():
                btn.click()
                log(f"DIA: -> {url_part} ({i}s)")
                break
            time.sleep(2)
        time.sleep(2)
        try: page.wait_for_url(f"**/new/{url_part}**", timeout=25000)
        except: pass
        log(f"DIA {url_part} URL: {page.url.split('?')[0]}")

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
                log("DIA: Selected organism Human")
                time.sleep(1)

    # START DIA
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
