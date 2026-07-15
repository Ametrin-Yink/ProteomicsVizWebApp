"""Debug: check what TmtChannelMapping renders after waiting."""
import time
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:3000"

def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg.encode('ascii',errors='replace').decode()}", flush=True)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    page = ctx.new_page()

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

    # Continue
    for i in range(30):
        btn = page.locator('button:has-text("Continue")').first
        if btn.is_visible() and btn.is_enabled():
            btn.click()
            break
        time.sleep(2)
    time.sleep(3)

    # Wait incrementally and check
    for wait_sec in [5, 10, 15, 20, 30]:
        time.sleep(5)
        tables = page.locator('table').count()
        # Get text in the TMT Channel Mapping section
        page_text = page.locator('body').text_content()
        has_channels = "126" in page_text or "127" in page_text or "No TMT channels" in page_text
        log(f"After ~{wait_sec}s: tables={tables}, has_channel_text={has_channels}")

        if tables > 0:
            # Check table content
            for ti in range(tables):
                rows = page.locator('table').nth(ti).locator('tr').count()
                text = page.locator('table').nth(ti).text_content()[:200]
                log(f"  Table {ti}: {rows} rows, text: {text}")
            break

        if "No TMT channels" in page_text:
            log("  Shows 'No TMT channels detected' message")
            # Check if retry is possible
            break

    browser.close()
