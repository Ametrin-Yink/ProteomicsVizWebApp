"""Fill TMT channel mapping via store actions (reliable approach)."""
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:3000"

def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg.encode('ascii',errors='replace').decode()}", flush=True)

MAPPING = [
    ("126", "DMSO", "1"), ("127N", "DMSO", "2"), ("127C", "DMSO", "3"),
    ("128N", "INCB224525", "1"), ("128C", "INCB224525", "2"), ("129N", "INCB224525", "3"),
    ("129C", "DMSO", "1"), ("130N", "DMSO", "2"),
    ("130C", "INCB224525", "1"), ("131N", "INCB224525", "2"), ("131C", "INCB224525", "3"),
    ("132N", "INCB231845", "1"), ("132C", "INCB231845", "2"), ("133N", "INCB231845", "3"),
    ("133C", "INCB231845", "1"), ("134N", "INCB231845", "2"),
]

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    page = ctx.new_page()

    page.goto(f"{BASE}/", wait_until="networkidle")
    time.sleep(1)
    page.locator('button:has-text("TMT")').first.click()
    page.wait_for_url("**/new/upload**")
    time.sleep(3)

    # Select file from E2E_TMT
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

    for i in range(30):
        btn = page.locator('button:has-text("Continue")').first
        if btn.is_visible() and btn.is_enabled():
            btn.click()
            log(f"-> metadata ({i}s)")
            break
        time.sleep(2)
    time.sleep(3)
    page.wait_for_load_state("networkidle")
    time.sleep(5)

    # Wait for channel table
    for w in range(15):
        rows = page.locator('table tr').count()
        if rows > 2:
            log(f"Channel table: {rows} rows")
            break
        time.sleep(2)

    # Fill channel mapping via store — type each value into its input with native input events
    table_rows = page.locator('table tbody tr')
    for row_idx in range(table_rows.count()):
        row = table_rows.nth(row_idx)
        inputs = row.locator('input').all()
        first_cell = row.locator('td').first.text_content() or ""

        channel = None
        for ch, cond, rep in MAPPING:
            if ch in first_cell:
                channel, condition, replicate = ch, cond, rep
                break
        if not channel or len(inputs) < 2:
            continue

        log(f"Row {row_idx}: {channel} -> {condition}/{replicate}")

        # Fill using native input event dispatch (what React listens for)
        for inp_idx, value in [(0, "Exp1"), (1, condition) if len(inputs) >= 3 else None, (-1, replicate)]:
            if value is None or inp_idx is None:
                continue
            inp = inputs[inp_idx]
            # Dispatch native input event for React controlled components
            inp.evaluate(f"""
                (el) => {{
                    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                    nativeInputValueSetter.call(el, '{value}');
                    el.dispatchEvent(new Event('input', {{ bubbles: true }}));
                    el.dispatchEvent(new Event('change', {{ bubbles: true }}));
                    el.dispatchEvent(new FocusEvent('blur', {{ bubbles: true }}));
                }}
            """)
            time.sleep(0.02)

    log("All channels filled via native events")

    # Continue
    for url_part in ["comparisons", "config", "summary"]:
        for i in range(60):
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
        elif url_part == "config":
            page.locator('select').first.select_option(label="Human")
            time.sleep(1)

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
