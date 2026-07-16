"""DIA pipeline only — using same navigation pattern that works for TMT."""
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:3000"

def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg.encode('ascii',errors='replace').decode()}", flush=True)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    page.set_default_timeout(60000)

    log("===== DIA ONLY =====")
    page.goto(f"{BASE}/", wait_until="networkidle"); time.sleep(2)
    page.locator('button:has-text("DIA")').first.click()
    page.wait_for_url("**/new/upload**"); time.sleep(3)

    # Open picker and wait
    page.locator('button:has-text("Browse File Library")').first.click()
    time.sleep(8)  # longer wait for new context

    # Navigate by clicking file list rows (same pattern that works for TMT)
    # Root folder should show E2E_DIA, E2E_TMT, proj
    page.locator('tr:has-text("E2E_DIA")').first.click()
    time.sleep(5)
    log(f"Files: {page.locator('tbody tr').count()}")

    # Select all
    page.locator('thead input[type="checkbox"]').first.check(); time.sleep(0.5)
    page.locator('button:has-text("Select")').last.click(timeout=10000); time.sleep(5)
    log("DIA: selected")

    # Continue
    for i in range(30):
        btn = page.locator('button:has-text("Continue")').first
        if btn.is_visible() and btn.is_enabled(): btn.click(); break
        time.sleep(2)
    time.sleep(3); page.wait_for_load_state("networkidle"); time.sleep(5)

    # Fill metadata
    meta = "{"
    c = ["Drug1","Drug1","Drug1","Drug2","Drug2","Drug2","Drug3","Drug3","Drug3","DMSO","DMSO","DMSO"]
    for i in range(12):
        meta += f"'dia_sample_{i+1:02d}_10000rows.txt':{{experiment:'Exp_{c[i]}',replicate:'{(i%3)+1}',Condition:'{c[i]}'}},"
    meta += "}"
    r = page.evaluate(f"() => {{ const fn = window.__setDiaMetadata; if (!fn) return 'nh'; fn({meta}); return 'ok'; }}")
    log(f"DIA fill: {r}")

    if r == 'nh':
        log("[FAIL] DIA metadata helper not available")
        browser.close()
        exit(1)

    # Continue to comparisons
    for i in range(30):
        btn = page.locator('button:has-text("Continue")').first
        if btn.is_visible() and btn.is_enabled(): btn.click(); break
        time.sleep(2)
    time.sleep(2); page.wait_for_url("**/new/comparisons**", timeout=30000); time.sleep(3)

    # Reference + Generate
    ref = page.locator('select').first
    if ref.is_visible(timeout=3000): ref.select_option(index=1); time.sleep(1)
    gen = page.locator('button:has-text("Generate")').first
    for w in range(30):
        if gen.is_visible() and gen.is_enabled(): gen.click(); log(f"DIA Generate ({w*2}s)"); time.sleep(2); break
        time.sleep(2)

    # Continue through config, summary
    for url_part in ["config", "summary"]:
        for i in range(90):
            btn = page.locator('button:has-text("Continue")').first
            if btn.is_visible() and btn.is_enabled(): btn.click(); log(f"-> {url_part} ({i}s)"); break
            time.sleep(2)
        time.sleep(3); page.wait_for_url(f"**/new/{url_part}**", timeout=30000)
        log(f"{url_part}: {page.url.split('?')[0]}")
        if url_part == "config":
            s = page.locator('select').first
            if s.is_visible(timeout=3000):
                try: s.select_option(label="Human")
                except: s.select_option(index=1)
                time.sleep(1)

    # Start
    if "summary" in page.url:
        time.sleep(2); page.once("dialog", lambda d: d.accept())
        for i in range(20):
            btn = page.locator('button:has-text("Start Analysis")').first
            if btn.is_visible() and btn.is_enabled(): btn.click(); log("[OK] DIA STARTED!"); break
            time.sleep(2)
        time.sleep(3)
        try: page.wait_for_url("**/analysis/processing**", timeout=20000)
        except: pass
        log(f"DIA final: {page.url.split('?')[0]}")

    browser.close()
    log("\n=== DIA COMPLETE ===")
