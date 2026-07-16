"""Goal: TMT pipeline first (with comparisons debug), then DIA."""
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

    # ===== TMT =====
    log("===== TMT =====")
    page.goto(f"{BASE}/", wait_until="networkidle"); time.sleep(1)
    page.locator('button:has-text("TMT")').first.click()
    page.wait_for_url("**/new/upload**"); time.sleep(3)

    page.locator('button:has-text("Browse File Library")').first.click(); time.sleep(2)
    page.locator('[role="treeitem"]:has-text("E2E_TMT")').first.click(); time.sleep(2)
    for i in range(page.locator('tbody tr').count()):
        row = page.locator('tbody tr').nth(i)
        if "tmt_sample" in (row.text_content() or "").lower():
            row.locator('input[type="checkbox"]').check(); break
    time.sleep(0.5)
    page.locator('button:has-text("Select")').last.click(timeout=10000); time.sleep(5)

    for i in range(30):
        btn = page.locator('button:has-text("Continue")').first
        if btn.is_visible() and btn.is_enabled(): btn.click(); break
        time.sleep(2)
    time.sleep(3); page.wait_for_load_state("networkidle"); time.sleep(5)

    # Fill TMT mapping
    result = page.evaluate(f"""
        () => {{
            const fn = window.__updateTmtMapping;
            if (!fn) return 'no-helper';
            const map = {{"126":{{condition:"DMSO_24h",replicate:1}},"127N":{{condition:"DMSO_24h",replicate:2}},"127C":{{condition:"DMSO_24h",replicate:3}},"128N":{{condition:"INCB224525_24h",replicate:1}},"128C":{{condition:"INCB224525_24h",replicate:2}},"129N":{{condition:"INCB224525_24h",replicate:3}},"129C":{{condition:"DMSO_48h",replicate:1}},"130N":{{condition:"DMSO_48h",replicate:2}},"130C":{{condition:"INCB224525_48h",replicate:1}},"131N":{{condition:"INCB224525_48h",replicate:2}},"131C":{{condition:"INCB224525_48h",replicate:3}},"132N":{{condition:"INCB231845_24h",replicate:1}},"132C":{{condition:"INCB231845_24h",replicate:2}},"133N":{{condition:"INCB231845_24h",replicate:3}},"133C":{{condition:"INCB231845_48h",replicate:1}},"134N":{{condition:"INCB231845_48h",replicate:2}}}};
            for (const [ch, groups] of Object.entries(map)) fn('tmt_sample_10000rows.txt', ch, groups);
            return 'filled';
        }}
    """)
    log(f"TMT fill: {result}")

    # Continue to comparisons
    for i in range(30):
        btn = page.locator('button:has-text("Continue")').first
        if btn.is_visible() and btn.is_enabled(): btn.click(); break
        time.sleep(2)
    time.sleep(2)
    try: page.wait_for_url("**/new/comparisons**", timeout=30000)
    except: pass
    log(f"TMT comparisons: {page.url.split('?')[0]}")

    if "comparisons" in page.url:
        time.sleep(3)
        # Debug: check what buttons are visible
        btns = page.locator('button').all()
        btn_texts = [b.text_content()[:40] for b in btns[:20] if b.is_visible()]
        log(f"Buttons: {btn_texts}")

        # Check condition cards
        cards_text = page.locator('body').text_content()
        has_conditions = "DMSO" in cards_text or "INCB" in cards_text
        log(f"Has condition text: {has_conditions}")

        # Wait for auto-generate button to become enabled, then click
        for text in ["Generate", "Auto-Generate", "Auto Generate"]:
            btn = page.locator(f'button:has-text("{text}")').first
            if btn.is_visible(timeout=2000):
                for w in range(30):
                    if btn.is_enabled():
                        btn.click()
                        log(f"Clicked: {text} (after {w*2}s)")
                        time.sleep(2)
                        break
                    time.sleep(2)
                break

        # Check if comparisons were created
        comps_text = page.locator('body').text_content()
        has_vs = "vs" in comps_text or "VS" in comps_text or "Group A" in comps_text
        log(f"Has comparisons: {has_vs}")

        # If no auto-generate, try manually adding from palette
        if not has_vs:
            log("Manually building comparison...")
            # Find condition cards and click A/B buttons
            a_btns = page.locator('button:has-text("A")')
            b_btns = page.locator('button:has-text("B")')
            log(f"A buttons: {a_btns.count()}, B buttons: {b_btns.count()}")
            if a_btns.count() > 0 and b_btns.count() > 0:
                a_btns.first.click(); time.sleep(0.5)
                b_btns.first.click(); time.sleep(0.5)
                log("Added one comparison manually")

    # Continue through config, summary
    for url_part in ["config", "summary"]:
        for i in range(60):
            btn = page.locator('button:has-text("Continue")').first
            if btn.is_visible() and btn.is_enabled(): btn.click(); log(f"TMT -> {url_part} ({i}s)"); break
            time.sleep(2)
        time.sleep(3)
        try: page.wait_for_url(f"**/new/{url_part}**", timeout=30000)
        except: pass
        log(f"TMT {url_part}: {page.url.split('?')[0]}")
        if url_part == "config":
            sel = page.locator('select').first
            if sel.is_visible(timeout=3000):
                try: sel.select_option(label="Human")
                except: sel.select_option(index=1)
                time.sleep(1)

    if "summary" in page.url:
        time.sleep(2)
        page.once("dialog", lambda d: d.accept())
        for i in range(20):
            btn = page.locator('button:has-text("Start Analysis")').first
            if btn.is_visible() and btn.is_enabled(): btn.click(); log("[OK] TMT STARTED!"); break
            time.sleep(2)
        time.sleep(3)
        try: page.wait_for_url("**/analysis/processing**", timeout=20000)
        except: pass
        log(f"TMT final: {page.url.split('?')[0]}")

    # ===== DIA =====
    log("\n===== DIA =====")
    page.goto(f"{BASE}/", wait_until="networkidle"); time.sleep(2)  # Extra wait after TMT
    page.locator('button:has-text("DIA")').first.click()
    page.wait_for_url("**/new/upload**"); time.sleep(3)

    page.locator('button:has-text("Browse File Library")').first.click(); time.sleep(2)
    page.locator('[role="treeitem"]:has-text("E2E_DIA")').first.click(); time.sleep(2)
    page.locator('thead input[type="checkbox"]').first.check(); time.sleep(0.5)
    page.locator('button:has-text("Select")').last.click(timeout=10000); time.sleep(5)

    for i in range(30):
        btn = page.locator('button:has-text("Continue")').first
        if btn.is_visible() and btn.is_enabled(): btn.click(); break
        time.sleep(2)
    time.sleep(3); page.wait_for_load_state("networkidle"); time.sleep(5)

    # Fill DIA metadata
    meta = "{"
    conds = ["Drug1","Drug1","Drug1","Drug2","Drug2","Drug2","Drug3","Drug3","Drug3","DMSO","DMSO","DMSO"]
    for i in range(12):
        fn = f"dia_sample_{i+1:02d}_10000rows.txt"
        meta += f"'{fn}':{{experiment:'Exp_{conds[i]}',replicate:'{(i%3)+1}',Condition:'{conds[i]}'}},"
    meta += "}"
    r = page.evaluate(f"() => {{ const fn = window.__setDiaMetadata; if (!fn) return 'nh'; fn({meta}); return 'ok'; }}")
    log(f"DIA fill: {r}")

    # Continue through DIA wizard
    for url_part in ["comparisons", "config", "summary"]:
        for i in range(60):
            btn = page.locator('button:has-text("Continue")').first
            if btn.is_visible() and btn.is_enabled(): btn.click(); log(f"DIA -> {url_part} ({i}s)"); break
            time.sleep(2)
        time.sleep(3)
        try: page.wait_for_url(f"**/new/{url_part}**", timeout=30000)
        except: pass
        log(f"DIA {url_part}: {page.url.split('?')[0]}")
        if url_part == "comparisons":
            time.sleep(2)
            # Wait for auto-generate to enable
            for text in ["Generate", "Auto-Generate"]:
                btn = page.locator(f'button:has-text("{text}")').first
                if btn.is_visible(timeout=2000):
                    for w in range(30):
                        if btn.is_enabled(): btn.click(); log(f"DIA clicked: {text} ({w*2}s)"); time.sleep(2); break
                        time.sleep(2)
                    break
            # Fallback: manual comparison
            a_btns = page.locator('button:has-text("A")')
            if a_btns.count() > 0:
                a_btns.first.click(); time.sleep(0.5)
                page.locator('button:has-text("B")').first.click(); time.sleep(0.5)
                log("DIA: manual comparison added")
        elif url_part == "config":
            sel = page.locator('select').first
            if sel.is_visible(timeout=3000):
                try: sel.select_option(label="Human")
                except: sel.select_option(index=1)
                time.sleep(1)

    if "summary" in page.url:
        time.sleep(2)
        page.once("dialog", lambda d: d.accept())
        for i in range(20):
            btn = page.locator('button:has-text("Start Analysis")').first
            if btn.is_visible() and btn.is_enabled(): btn.click(); log("[OK] DIA STARTED!"); break
            time.sleep(2)
        time.sleep(3)
        try: page.wait_for_url("**/analysis/processing**", timeout=20000)
        except: pass
        log(f"DIA final: {page.url.split('?')[0]}")

    browser.close()
    log("\n=== GOAL ATTEMPT COMPLETE ===")
