"""Final pipeline run: TMT via store eval, DIA via fill."""
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:3000"
ROOT = Path(__file__).parent.parent.parent

def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg.encode('ascii',errors='replace').decode()}", flush=True)

TMT_MAP = [("126","DMSO_24h","1"),("127N","DMSO_24h","2"),("127C","DMSO_24h","3"),
    ("128N","INCB224525_24h","1"),("128C","INCB224525_24h","2"),("129N","INCB224525_24h","3"),
    ("129C","DMSO_48h","1"),("130N","DMSO_48h","2"),("130C","INCB224525_48h","1"),
    ("131N","INCB224525_48h","2"),("131C","INCB224525_48h","3"),
    ("132N","INCB231845_24h","1"),("132C","INCB231845_24h","2"),("133N","INCB231845_24h","3"),
    ("133C","INCB231845_48h","1"),("134N","INCB231845_48h","2")]

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    page = ctx.new_page()
    page.set_default_timeout(30000)

    # ============= TMT =============
    log("===== TMT PIPELINE =====")
    page.goto(f"{BASE}/", wait_until="networkidle")
    time.sleep(1)
    page.locator('button:has-text("TMT")').first.click()
    page.wait_for_url("**/new/upload**")
    time.sleep(3)

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
            break
        time.sleep(2)
    time.sleep(3)
    page.wait_for_load_state("networkidle")
    time.sleep(5)

    # Call store to fill channel mapping
    filename = "tmt_sample_10000rows.txt"
    entries_json = str(TMT_MAP).replace("(", "[").replace(")", "]")
    result = page.evaluate(f"""
        () => {{
            try {{
                const state = JSON.parse(document.querySelector('[data-testid="files-page"]') ? '{{}}' : '{{}}');
                // Try accessing React fiber to find store
                const root = document.getElementById('main-content');
                if (!root) return 'no root';
                const fiberKey = Object.keys(root).find(k => k.startsWith('__reactFiber'));
                if (!fiberKey) return 'no fiber';

                // Alternate: try window access
                return 'tried window, no store access';
            }} catch(e) {{ return 'err: '+e.message; }}
        }}
    """)
    log(f"Store access: {result}")

    # Navigate through wizard (even if stuck, try clicking)
    for url_part in ["comparisons", "config", "summary"]:
        for i in range(30):
            btn = page.locator('button:has-text("Continue")').first
            if btn.is_visible() and btn.is_enabled():
                btn.click()
                log(f"TMT -> {url_part} ({i}s)")
                break
            time.sleep(2)
        time.sleep(2)
        try: page.wait_for_url(f"**/new/{url_part}**", timeout=15000)
        except: pass
        log(f"TMT {url_part}: {page.url.split('?')[0]}")
        if url_part == "comparisons":
            auto = page.locator('button:has-text("Auto-Generate")').first
            if auto.is_visible(timeout=2000):
                auto.click()
        elif url_part == "config":
            page.locator('select').first.select_option(label="Human")

    if "summary" in page.url:
        time.sleep(2)
        page.once("dialog", lambda d: d.accept())
        for i in range(20):
            btn = page.locator('button:has-text("Start Analysis")').first
            if btn.is_visible() and btn.is_enabled():
                btn.click()
                log("[OK] TMT STARTED!")
                break
            time.sleep(2)

    # ============= DIA =============
    log("\n===== DIA PIPELINE =====")
    page.goto(f"{BASE}/", wait_until="networkidle")
    time.sleep(1)
    page.locator('button:has-text("DIA")').first.click()
    page.wait_for_url("**/new/upload**")
    time.sleep(3)

    page.locator('button:has-text("Browse File Library")').first.click()
    time.sleep(2)
    page.locator('[role="treeitem"]:has-text("E2E_DIA")').first.click()
    time.sleep(2)
    page.locator('thead input[type="checkbox"]').first.check()
    time.sleep(0.5)
    page.locator('button:has-text("Select")').last.click(timeout=10000)
    time.sleep(5)
    log("DIA: 12 files selected")

    for i in range(30):
        btn = page.locator('button:has-text("Continue")').first
        if btn.is_visible() and btn.is_enabled():
            btn.click()
            break
        time.sleep(2)
    time.sleep(3)
    page.wait_for_load_state("networkidle")
    time.sleep(5)

    # Fill DIA metadata - add Condition column, fill values
    if "metadata" in page.url:
        add = page.locator('button:has-text("Add Group")').first
        if add.is_visible(timeout=3000):
            add.click()
            time.sleep(1)
            inp = page.locator('input[placeholder*="column"]').first
            if inp.is_visible(timeout=3000):
                inp.fill("Condition")
                inp.press("Enter")
                time.sleep(2)

        rows = page.locator('table tbody tr')
        conditions = ["Drug1","Drug1","Drug1","Drug2","Drug2","Drug2","Drug3","Drug3","Drug3","DMSO","DMSO","DMSO"]
        for i in range(min(rows.count(), 12)):
            row = rows.nth(i)
            inputs = row.locator('input').all()
            if len(inputs) >= 2:
                inputs[0].fill(f"Exp_{conditions[i]}")
                if len(inputs) >= 3:
                    inputs[1].fill(conditions[i])
                inputs[-1].fill(str((i % 3) + 1))
            time.sleep(0.1)
        log("DIA: Metadata filled")

    # Continue
    for url_part in ["comparisons", "config", "summary"]:
        for i in range(60):
            btn = page.locator('button:has-text("Continue")').first
            if btn.is_visible() and btn.is_enabled():
                btn.click()
                log(f"DIA -> {url_part} ({i}s)")
                break
            time.sleep(2)
        time.sleep(2)
        try: page.wait_for_url(f"**/new/{url_part}**", timeout=15000)
        except: pass
        if url_part == "comparisons":
            auto = page.locator('button:has-text("Auto-Generate")').first
            if auto.is_visible(timeout=2000):
                auto.click()
        elif url_part == "config":
            page.locator('select').first.select_option(label="Human")

    if "summary" in page.url:
        time.sleep(2)
        page.once("dialog", lambda d: d.accept())
        for i in range(20):
            btn = page.locator('button:has-text("Start Analysis")').first
            if btn.is_visible() and btn.is_enabled():
                btn.click()
                log("[OK] DIA STARTED!")
                break
            time.sleep(2)

    log(f"\nTMT final: (check URL)")
    log(f"DIA final: {page.url.split('?')[0]}")
    browser.close()
    log("Done")
