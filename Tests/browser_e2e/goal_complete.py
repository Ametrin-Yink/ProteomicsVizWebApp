"""Complete goal: TMT pipeline with store fill + DIA pipeline."""
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:3000"
ROOT = Path(__file__).parent.parent.parent

def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg.encode('ascii',errors='replace').decode()}", flush=True)

# Channel mapping for TMT (16-plex)
TMT_MAP = [
    ("126","DMSO_24h","1"),("127N","DMSO_24h","2"),("127C","DMSO_24h","3"),
    ("128N","INCB224525_24h","1"),("128C","INCB224525_24h","2"),("129N","INCB224525_24h","3"),
    ("129C","DMSO_48h","1"),("130N","DMSO_48h","2"),
    ("130C","INCB224525_48h","1"),("131N","INCB224525_48h","2"),("131C","INCB224525_48h","3"),
    ("132N","INCB231845_24h","1"),("132C","INCB231845_24h","2"),("133N","INCB231845_24h","3"),
    ("133C","INCB231845_48h","1"),("134N","INCB231845_48h","2"),
]

# Build JS string for store update
MAPPING_JS = "{"
for ch, cond, rep in TMT_MAP:
    MAPPING_JS += f"'{ch}':{{condition:'{cond}',replicate:{rep}}},"
MAPPING_JS += "}"
FILENAME = "tmt_sample_10000rows.txt"

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    page = ctx.new_page()
    page.set_default_timeout(30000)

    # ============= TMT PIPELINE =============
    log("===== TMT PIPELINE =====")
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
            log("TMT: Selected file")
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
    page.wait_for_load_state("networkidle")
    time.sleep(5)

    # Wait for channel table to render
    for w in range(15):
        rows = page.locator('table tr').count()
        if rows > 2:
            log(f"Channel table: {rows} rows")
            break
        time.sleep(2)

    # Fill channel mapping via exposed window helper
    result = page.evaluate(f"""
        () => {{
            const fn = window.__updateTmtMapping;
            if (!fn) return 'no-helper';
            const map = {MAPPING_JS};
            for (const [ch, groups] of Object.entries(map)) {{
                fn('{FILENAME}', ch, groups);
            }}
            return 'filled';
        }}
    """)
    log(f"TMT store fill: {result}")

    # Continue through wizard
    for url_part in ["comparisons", "config", "summary"]:
        for i in range(60):
            btn = page.locator('button:has-text("Continue")').first
            if btn.is_visible() and btn.is_enabled():
                btn.click()
                log(f"TMT -> {url_part} ({i}s)")
                break
            time.sleep(2)
        time.sleep(3)
        try: page.wait_for_url(f"**/new/{url_part}**", timeout=30000)
        except: pass
        log(f"TMT {url_part}: {page.url.split('?')[0]}")

        if url_part == "comparisons":
            auto = page.locator('button:has-text("Auto-Generate")').first
            if auto.is_visible(timeout=2000): auto.click(); time.sleep(2)
        elif url_part == "config":
            sel = page.locator('select').first
            if sel.is_visible(timeout=5000):
                try: sel.select_option(label="Human")
                except: sel.select_option(index=1)  # fallback if "Human" not found
                time.sleep(1)

    if "summary" in page.url:
        time.sleep(2)
        page.once("dialog", lambda d: d.accept())
        for i in range(20):
            btn = page.locator('button:has-text("Start Analysis")').first
            if btn.is_visible() and btn.is_enabled():
                btn.click()
                log("[OK] TMT ANALYSIS STARTED!")
                try: page.wait_for_url("**/analysis/processing**", timeout=20000)
                except: pass
                break
            time.sleep(2)

    # ============= DIA PIPELINE =============
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

    if "metadata" in page.url:
        # Fill metadata via exposed window helper
        conds = ["Drug1","Drug1","Drug1","Drug2","Drug2","Drug2","Drug3","Drug3","Drug3","DMSO","DMSO","DMSO"]
        meta_json = "{"
        for i in range(12):
            # Filename pattern from E2E_DIA: dia_sample_01_10000rows.txt, etc.
            fn = f"dia_sample_{i+1:02d}_10000rows.txt"
            meta_json += f"'{fn}':{{experiment:'Exp_{conds[i]}',replicate:'{(i%3)+1}',Condition:'{conds[i]}'}},"
        meta_json += "}"

        result = page.evaluate(f"""
            () => {{
                const fn = window.__setDiaMetadata;
                if (!fn) return 'no-helper';
                fn({meta_json});
                return 'filled-12-files';
            }}
        """)
        log(f"DIA store fill: {result}")

    # Continue through DIA wizard
    for url_part in ["comparisons", "config", "summary"]:
        for i in range(60):
            btn = page.locator('button:has-text("Continue")').first
            if btn.is_visible() and btn.is_enabled():
                btn.click()
                log(f"DIA -> {url_part} ({i}s)")
                break
            time.sleep(2)
        time.sleep(3)
        try: page.wait_for_url(f"**/new/{url_part}**", timeout=30000)
        except: pass
        log(f"DIA {url_part}: {page.url.split('?')[0]}")
        if url_part == "comparisons":
            auto = page.locator('button:has-text("Auto-Generate")').first
            if auto.is_visible(timeout=2000): auto.click(); time.sleep(2)
        elif url_part == "config":
            sel = page.locator('select').first
            if sel.is_visible(timeout=5000):
                try: sel.select_option(label="Human")
                except: sel.select_option(index=1)
                time.sleep(1)

    if "summary" in page.url:
        time.sleep(2)
        page.once("dialog", lambda d: d.accept())
        for i in range(20):
            btn = page.locator('button:has-text("Start Analysis")').first
            if btn.is_visible() and btn.is_enabled():
                btn.click()
                log("[OK] DIA ANALYSIS STARTED!")
                try: page.wait_for_url("**/analysis/processing**", timeout=20000)
                except: pass
                break
            time.sleep(2)

    log(f"\nTMT URL: (processing or visualization)")
    log(f"DIA URL: {page.url.split('?')[0]}")
    browser.close()
    log("\n=== GOAL ATTEMPT COMPLETE ===")
