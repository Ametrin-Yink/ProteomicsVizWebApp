"""Debug: log React state and API responses for dock5."""
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

    # Log API responses
    def handle_response(response):
        if '/api/files/tree' in response.url:
            try:
                body = response.json()
                path = body.get('path', '?')
                n_entries = len(body.get('entries', []))
                types = [e.get('type','?') for e in body.get('entries', [])]
                log(f"API tree?path={path}: {n_entries} entries, types={types}")
            except: pass
    page.on("response", handle_response)

    page.goto(f"{BASE}/files", wait_until="networkidle")
    time.sleep(3)

    # Navigate to proj
    page.locator('tr:has-text("proj")').first.click()
    time.sleep(3)

    # Check rendered state via browser console
    state = page.evaluate("""() => {
        // Check if there are any file rows with folder icon
        const rows = document.querySelectorAll('tbody tr');
        const result = { rowCount: rows.length };
        rows.forEach((r, i) => {
            result['row' + i] = r.textContent.substring(0, 100);
        });

        // Check what the filter type buttons show
        const allBtn = document.querySelector('button:has-text("All Files")');
        result['allFilesBtn'] = allBtn ? allBtn.className : 'NOT FOUND';

        const csvBtn = document.querySelector('button:has-text("CSV")');
        result['csvBtn'] = csvBtn ? csvBtn.className : 'NOT FOUND';

        return JSON.stringify(result);
    }""")
    log(f"After proj click: {state}")

    # Now click on "All Files" filter button
    all_btn = page.locator('button:has-text("All Files")').first
    if all_btn.is_visible(timeout=3000):
        log("Clicking 'All Files' filter...")
        all_btn.click()
        time.sleep(2)

        state2 = page.evaluate("""() => {
            const rows = document.querySelectorAll('tbody tr');
            const result = { rowCount: rows.length };
            rows.forEach((r, i) => {
                result['row' + i] = r.textContent.substring(0, 100);
            });
            return JSON.stringify(result);
        }""")
        log(f"After All Files click: {state2}")

    browser.close()
