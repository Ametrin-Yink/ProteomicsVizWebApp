"""Debug: minimal test — navigate to proj and check state immediately."""
import time
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:3000"

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    page = ctx.new_page()

    browser_logs = []
    def handle_console(msg):
        browser_logs.append(f"[{msg.type}] {msg.text}")
    page.on("console", handle_console)

    api_calls = []
    def handle_response(response):
        url = response.url
        if '/api/files/tree' in url:
            try:
                body = response.json()
                api_calls.append({"url": url, "status": response.status, "entries": len(body.get('entries',[]))})
            except:
                pass
    page.on("response", handle_response)

    # Navigate to files page
    page.goto(f"{BASE}/files", wait_until="networkidle")
    time.sleep(3)

    # Click proj folder
    page.locator('tr').filter(has_text='proj').locator('td:nth-child(2)').first.click()
    page.wait_for_timeout(1000)
    
    current_path_el = page.locator('[data-testid="file-list"] [aria-current="page"]')
    if current_path_el.count() > 0:
        print(f"CURRENT PATH: {current_path_el.text_content()}")
    
    # Check rows
    rows = page.locator('tbody tr').count()
    print(f"ROWS: {rows}")
    
    # Check if empty message visible
    empty = page.locator('text=This folder is empty')
    print(f"EMPTY VISIBLE: {empty.count() > 0}")
    
    file_list_text = page.locator('[data-testid="file-list"]').text_content()[:500]
    print(f"FILE LIST: {file_list_text}")
    
    # Print console logs related to navigation
    print("\n=== CONSOLE LOGS (last 20) ===")
    for bl in browser_logs[-20:]:
        print(f"  {bl}")
    
    print("\n=== API CALLS ===")
    for call in api_calls:
        print(f"  {call['url']} → {call['entries']} entries")
    
    browser.close()
