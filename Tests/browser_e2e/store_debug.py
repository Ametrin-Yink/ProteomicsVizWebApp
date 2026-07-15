"""Debug: check Zustand store state on TMT metadata page."""
import time
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:3000"

def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg.encode('ascii',errors='replace').decode()}", flush=True)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    page = ctx.new_page()

    # Quick: go directly to an existing session's metadata page
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
            log("Selected TMT file")
            break
    time.sleep(0.5)
    page.locator('button:has-text("Select")').last.click(timeout=10000)
    time.sleep(8)  # Wait for file processing

    # Continue
    for i in range(30):
        btn = page.locator('button:has-text("Continue")').first
        if btn.is_visible() and btn.is_enabled():
            btn.click()
            log(f"Continue ({i}s)")
            break
        time.sleep(2)
    time.sleep(5)

    # Read store state
    state = page.evaluate("""() => {
        // Access Zustand store from window
        try {
            const store = window.__ZUSTAND_STORE__;
            if (!store) return 'NO_ZUSTAND_STORE';
            const s = store.getState();
            return JSON.stringify({
                analysisType: s.analysisType,
                fileType: s.config?.file_type,
                uploadedCount: s.uploadedFiles?.length || 0,
                files: (s.uploadedFiles || []).map(f => ({
                    name: f.filename,
                    channels: f.tmt_channels?.length || 0,
                    tmt_channels: f.tmt_channels
                })),
                mapping: s.config?.tmt_channel_mapping ? Object.keys(s.config.tmt_channel_mapping).length + ' entries' : 'none',
                pipe: s.config?.pipeline,
            }, null, 2);
        } catch(e) { return 'ERROR: '+e.message; }
    }""")
    log(f"Store state: {state}")

    # Check page HTML for TMT-related elements
    body = page.locator('body').text_content()
    has_tmt = "TMT Channel" in body or "channel" in body.lower()
    log(f"Has TMT channel text: {has_tmt}")
    log(f"Tables: {page.locator('table').count()}")
    log(f"Headings: {[h.text_content()[:60] for h in page.locator('h1,h2,h3').all()]}")

    browser.close()
