"""Debug metadata page state."""
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:3000"
ROOT = Path(__file__).parent.parent.parent

def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg.encode('ascii',errors='replace').decode()}", flush=True)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    page = ctx.new_page()

    page.goto(f"{BASE}/", wait_until="networkidle")
    time.sleep(1)
    page.locator('button:has-text("DIA")').first.click()
    page.wait_for_url("**/new/upload**")
    time.sleep(3)

    # Select files
    page.locator('button:has-text("Browse File Library")').first.click()
    time.sleep(2)
    page.locator('[role="treeitem"]:has-text("E2E_DIA")').first.click()
    time.sleep(2)
    page.locator('thead input[type="checkbox"]').first.check()
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

    time.sleep(5)
    log(f"URL: {page.url}")

    # Wait for page to fully render
    page.wait_for_load_state("networkidle")
    time.sleep(5)

    # Dump page content for the metadata section
    body = page.locator('body').text_content()
    log(f"Body text (first 1000): {body[:1000]}")

    # Count all tables
    tables = page.locator('table')
    log(f"Tables: {tables.count()}")
    for i in range(min(tables.count(), 5)):
        rows = tables.nth(i).locator('tr').count()
        text = tables.nth(i).text_content()[:200] if rows > 0 else "empty"
        log(f"  Table {i}: {rows} rows, text: {text}")

    # Count all inputs
    inputs = page.locator('input:not([type="hidden"])')
    log(f"Visible inputs: {inputs.count()}")
    for i in range(min(inputs.count(), 10)):
        try:
            inp_type = inputs.nth(i).get_attribute('type') or 'text'
            inp_val = inputs.nth(i).input_value()
            log(f"  Input {i}: type={inp_type}, value='{inp_val}'")
        except: pass

    # Check headings
    headings = page.locator('h1, h2, h3, h4')
    log(f"Headings: {headings.count()}")
    for i in range(min(headings.count(), 5)):
        log(f"  H{i}: {headings.nth(i).text_content()[:100]}")

    # Check what analysis type is active
    log(f"\nPage title: {page.title()}")

    browser.close()
