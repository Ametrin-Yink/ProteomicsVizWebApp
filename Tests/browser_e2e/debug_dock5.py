"""Debug: trace API calls for dock5 folder."""
import time, json
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

    # Log ALL network responses that go to /api/files
    api_calls = []
    def handle_response(response):
        url = response.url
        if '/api/files/' in url:
            try:
                body = response.json()
                api_calls.append({"url": url, "status": response.status, "body": str(body)[:500]})
            except:
                api_calls.append({"url": url, "status": response.status, "body": "not json"})

    page.on("response", handle_response)

    # Navigate to files page
    page.goto(f"{BASE}/files", wait_until="networkidle")
    time.sleep(3)

    # Click proj folder
    page.locator('tr:has-text("proj")').first.click()
    time.sleep(3)
    log("Navigated to proj/")

    # Click dock5 folder
    page.locator('tr:has-text("dock5")').first.click()
    time.sleep(3)
    log("Navigated to proj/dock5")

    # Print all API calls
    log("\n=== API Calls ===")
    for call in api_calls:
        log(f"\n{call['url']}")
        log(f"  Status: {call['status']}")
        log(f"  Body: {call['body']}")

    # Check what's rendered
    rows = page.locator('tbody tr').count()
    body_text = page.locator('[data-testid="file-list"]').text_content() if page.locator('[data-testid="file-list"]').count() > 0 else "no file-list"
    log(f"\nRendered rows: {rows}")
    log(f"Content: {body_text[:500]}")

    browser.close()
