"""Manually fill TMT channel mapping cells using keyboard.type()."""
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:3000"
ROOT = Path(__file__).parent.parent.parent

def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg.encode('ascii',errors='replace').decode()}", flush=True)

# Channel mapping for tmt_sample_10000rows.txt (16 channels):
# Group by condition+time using DMSO, INCB224525, INCB231845, 24h/48h
MAPPING = [
    # channel: (condition, replicate)
    ("126", "DMSO_24h", "1"),
    ("127N", "DMSO_24h", "2"),
    ("127C", "DMSO_24h", "3"),
    ("128N", "INCB224525_24h", "1"),
    ("128C", "INCB224525_24h", "2"),
    ("129N", "INCB224525_24h", "3"),
    ("129C", "DMSO_48h", "1"),
    ("130N", "DMSO_48h", "2"),
    ("130C", "INCB224525_48h", "1"),
    ("131N", "INCB224525_48h", "2"),
    ("131C", "INCB224525_48h", "3"),
    ("132N", "INCB231845_24h", "1"),
    ("132C", "INCB231845_24h", "2"),
    ("133N", "INCB231845_24h", "3"),
    ("133C", "INCB231845_48h", "1"),
    ("134N", "INCB231845_48h", "2"),
]

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    page = ctx.new_page()
    page.set_default_timeout(30000)

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
            log(f"Channel table: {rows} rows")
            break
        time.sleep(2)

    # Add group columns if needed
    add_group = page.locator('button:has-text("Add Group")').first
    if add_group.is_visible(timeout=3000):
        add_group.click()
        time.sleep(1)
        inp = page.locator('input[placeholder*="column"]').first
        if inp.is_visible(timeout=3000):
            inp.click()
            time.sleep(0.2)
            page.keyboard.type("Condition")
            time.sleep(0.3)
            page.keyboard.press("Enter")
            time.sleep(2)
            log("Added Condition column")

    # Fill each channel row manually
    table_rows = page.locator('table tbody tr')
    for row_idx in range(table_rows.count()):
        row = table_rows.nth(row_idx)
        inputs = row.locator('input').all()

        # First cell text tells us which channel
        first_cell = row.locator('td').first.text_content() or ""

        # Find matching channel in mapping
        channel = None
        for ch, cond, rep in MAPPING:
            if ch in first_cell:
                channel = ch
                condition = cond
                replicate = rep
                break

        if not channel or len(inputs) < 2:
            continue

        log(f"Row {row_idx}: channel={channel}, condition={condition}, rep={replicate}")

        # Fill experiment (first input) — use fill() which triggers React onChange
        inputs[0].click()
        time.sleep(0.05)
        inputs[0].fill("Experiment_1")
        time.sleep(0.05)

        # Fill condition (second input)
        if len(inputs) >= 3:
            inputs[1].click()
            time.sleep(0.05)
            inputs[1].fill(condition)
            time.sleep(0.05)

        # Fill replicate (last input)
        inputs[-1].click()
        time.sleep(0.05)
        inputs[-1].fill(replicate)
        time.sleep(0.05)

        # Click away to trigger blur (click on the next row's first cell or table header)
        page.locator('table thead').click()
        time.sleep(0.05)

    log("All channels filled")

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
