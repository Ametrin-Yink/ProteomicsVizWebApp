"""Complete TMT + DIA pipelines using separate browser contexts."""
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:3000"
ROOT = Path(__file__).parent.parent.parent

def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg.encode('ascii',errors='replace').decode()}", flush=True)

def run_tmt(page):
    log("===== TMT PIPELINE =====")
    page.goto(f"{BASE}/", wait_until="networkidle"); time.sleep(2)
    page.locator('button:has-text("TMT")').first.click()
    page.wait_for_url("**/new/upload**"); time.sleep(3)

    # Select file
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

    # Fill TMT mapping via store
    r = page.evaluate("""
        () => {
            const fn = window.__updateTmtMapping;
            if (!fn) return 'nh';
            const map = {"126":{"condition":"DMSO_24h",replicate:1},"127N":{"condition":"DMSO_24h",replicate:2},"127C":{"condition":"DMSO_24h",replicate:3},"128N":{"condition":"INCB224525_24h",replicate:1},"128C":{"condition":"INCB224525_24h",replicate:2},"129N":{"condition":"INCB224525_24h",replicate:3},"129C":{"condition":"DMSO_48h",replicate:1},"130N":{"condition":"DMSO_48h",replicate:2},"130C":{"condition":"INCB224525_48h",replicate:1},"131N":{"condition":"INCB224525_48h",replicate:2},"131C":{"condition":"INCB224525_48h",replicate:3},"132N":{"condition":"INCB231845_24h",replicate:1},"132C":{"condition":"INCB231845_24h",replicate:2},"133N":{"condition":"INCB231845_24h",replicate:3},"133C":{"condition":"INCB231845_48h",replicate:1},"134N":{"condition":"INCB231845_48h",replicate:2}};
            for (const [ch, g] of Object.entries(map)) fn('tmt_sample_10000rows.txt', ch, g);
            return 'ok';
        }
    """)
    log(f"TMT fill: {r}")

    # Continue to comparisons
    for i in range(30):
        btn = page.locator('button:has-text("Continue")').first
        if btn.is_visible() and btn.is_enabled(): btn.click(); break
        time.sleep(2)
    time.sleep(2)
    try: page.wait_for_url("**/new/comparisons**", timeout=30000)
    except: pass
    time.sleep(3)

    # Auto-generate comparisons
    # First, select a reference condition (required for Generate button to enable)
    ref_select = page.locator('select').first  # The reference condition dropdown
    if ref_select.is_visible(timeout=3000):
        ref_select.select_option(index=1)  # Select first condition as reference
        log("TMT: Selected reference condition")
        time.sleep(1)

    gen_btn = page.locator('button:has-text("Generate")').first
    for w in range(30):
        if gen_btn.is_visible() and gen_btn.is_enabled():
            gen_btn.click(); log(f"TMT Generate ({w*2}s)"); time.sleep(2); break
        time.sleep(2)

    # Check store for comparison count
    comps = page.evaluate("() => { try { const s = JSON.parse(document.querySelector('body').getAttribute('data-store') || '{}'); return s.comparisons?.length || -1; } catch(e) { return -1; } }")
    body = page.locator('body').text_content()
    log(f"TMT comparisons: store={comps}, body_has_vs={'vs' in body or 'Group A' in body}")

    # Continue through remaining wizard — extended wait
    for url_part in ["config", "summary"]:
        for i in range(90):
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
    return "summary" in page.url

def run_dia(page):
    log("\n===== DIA PIPELINE =====")
    page.goto(f"{BASE}/", wait_until="networkidle"); time.sleep(2)
    page.locator('button:has-text("DIA")').first.click()
    page.wait_for_url("**/new/upload**"); time.sleep(3)

    page.locator('button:has-text("Browse File Library")').first.click(); time.sleep(5)
    # Navigate to E2E_DIA by clicking in the file list (more reliable than tree)
    for w in range(15):
        rows = page.locator('tbody tr').count()
        if rows > 2: break  # at least 3 files visible in root
        time.sleep(2)
    log(f"DIA root files: {page.locator('tbody tr').count()}")
    # Click E2E_DIA in the file list to navigate into it
    page.locator('tr:has-text("E2E_DIA")').first.click(); time.sleep(3)
    log(f"DIA files in E2E_DIA: {page.locator('tbody tr').count()}")
    page.locator('thead input[type="checkbox"]').first.check(); time.sleep(0.5)
    page.locator('button:has-text("Select")').last.click(timeout=10000); time.sleep(5)

    for i in range(30):
        btn = page.locator('button:has-text("Continue")').first
        if btn.is_visible() and btn.is_enabled(): btn.click(); break
        time.sleep(2)
    time.sleep(3); page.wait_for_load_state("networkidle"); time.sleep(5)

    # Fill DIA metadata
    meta = "{"
    c = ["Drug1","Drug1","Drug1","Drug2","Drug2","Drug2","Drug3","Drug3","Drug3","DMSO","DMSO","DMSO"]
    for i in range(12):
        fn = f"dia_sample_{i+1:02d}_10000rows.txt"
        meta += f"'{fn}':{{experiment:'Exp_{c[i]}',replicate:'{(i%3)+1}',Condition:'{c[i]}'}},"
    meta += "}"
    r = page.evaluate(f"() => {{ const fn = window.__setDiaMetadata; if (!fn) return 'nh'; fn({meta}); return 'ok'; }}")
    log(f"DIA fill: {r}")

    # Continue
    for i in range(30):
        btn = page.locator('button:has-text("Continue")').first
        if btn.is_visible() and btn.is_enabled(): btn.click(); break
        time.sleep(2)
    time.sleep(2)
    try: page.wait_for_url("**/new/comparisons**", timeout=30000)
    except: pass
    time.sleep(3)

    # Auto-generate DIA comparisons
    ref = page.locator('select').first
    if ref.is_visible(timeout=3000):
        ref.select_option(index=1); log("DIA: Selected reference"); time.sleep(1)
    gen = page.locator('button:has-text("Generate")').first
    for w in range(30):
        if gen.is_visible() and gen.is_enabled(): gen.click(); log(f"DIA Generate ({w*2}s)"); time.sleep(2); break
        time.sleep(2)
    body = page.locator('body').text_content()
    log(f"DIA has comparisons: {'vs' in body or 'Group A' in body}")

    for url_part in ["config", "summary"]:
        for i in range(90):
            btn = page.locator('button:has-text("Continue")').first
            if btn.is_visible() and btn.is_enabled(): btn.click(); log(f"DIA -> {url_part} ({i}s)"); break
            time.sleep(2)
        time.sleep(3)
        try: page.wait_for_url(f"**/new/{url_part}**", timeout=30000)
        except: pass
        log(f"DIA {url_part}: {page.url.split('?')[0]}")
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
            if btn.is_visible() and btn.is_enabled(): btn.click(); log("[OK] DIA STARTED!"); break
            time.sleep(2)
        time.sleep(3)
        try: page.wait_for_url("**/analysis/processing**", timeout=20000)
        except: pass
        log(f"DIA final: {page.url.split('?')[0]}")
    return "summary" in page.url

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)

    # Run TMT
    ctx1 = browser.new_context(viewport={"width": 1440, "height": 900})
    page1 = ctx1.new_page()
    tmt_ok = run_tmt(page1)
    ctx1.close()

    # Run DIA (separate context — clean state)
    ctx2 = browser.new_context(viewport={"width": 1440, "height": 900})
    page2 = ctx2.new_page()
    dia_ok = run_dia(page2)
    ctx2.close()

    browser.close()
    log(f"\n=== GOAL: TMT={'OK' if tmt_ok else 'FAIL'}, DIA={'OK' if dia_ok else 'FAIL'} ===")
