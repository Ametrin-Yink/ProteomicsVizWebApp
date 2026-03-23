#!/usr/bin/env python3
"""
Quick browser check - take screenshot to see page structure
"""

from playwright.sync_api import sync_playwright
import time
import os

with sync_playwright() as p:
    browser = p.chromium.launch(headless=False, slow_mo=50)
    context = browser.new_context(viewport={'width': 1920, 'height': 1080})
    page = context.new_page()

    page.goto('http://localhost:3000/analysis')
    page.wait_for_load_state('networkidle')
    time.sleep(2)

    # Save screenshot
    os.makedirs('test-results', exist_ok=True)
    page.screenshot(path='test-results/page-check.png', full_page=True)
    print("Screenshot saved to test-results/page-check.png")

    # Print page content
    content = page.content()
    print("\nPage title:", page.title())

    # Find buttons
    buttons = page.locator('button').all()
    print(f"\nFound {len(buttons)} buttons:")
    for btn in buttons[:10]:
        text = btn.text_content()
        if text and text.strip():
            print(f"  - {text.strip()[:50]}")

    browser.close()
