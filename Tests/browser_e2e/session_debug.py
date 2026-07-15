"""Debug: trace session API and file channels on upload page."""
import time, json
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:3000"

def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg.encode('ascii',errors='replace').decode()}", flush=True)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    page = ctx.new_page()

    # Log ALL session API responses
    def handle_response(response):
        if '/api/sessions/' in response.url and response.request.method == 'GET':
            try:
                body = response.json()
                files = body.get('files', {}).get('proteomics', [])
                for f in files:
                    ch = f.get('tmt_channels', [])
                    log(f"Session file: {f.get('filename','?')[:40]} | tmt_channels={ch[:5] if ch else 'NONE'} (len={len(ch) if ch else 0})")
            except: pass
    page.on("response", handle_response)

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
    time.sleep(8)

    # Continue
    for i in range(30):
        btn = page.locator('button:has-text("Continue")').first
        if btn.is_visible() and btn.is_enabled():
            btn.click()
            break
        time.sleep(2)
    time.sleep(5)

    # Now on metadata page - wait for session API
    time.sleep(5)
    log(f"Metadata URL: {page.url.split('?')[0]}")
    log(f"Body text: {page.locator('body').text_content()[:300]}")

    browser.close()
