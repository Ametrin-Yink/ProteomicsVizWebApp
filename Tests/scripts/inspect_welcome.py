"""Inspect welcome page structure."""
from playwright.sync_api import sync_playwright

def inspect_page():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        page = browser.new_page(viewport={'width': 1920, 'height': 1080})

        page.goto('http://localhost:3000')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(3000)

        # Take screenshot
        page.screenshot(path='Tests/screenshots/bug-fixes/inspect_welcome.png', full_page=True)

        # Print page content
        content = page.content()
        with open('Tests/screenshots/bug-fixes/page_content.html', 'w') as f:
            f.write(content)

        # Find all buttons
        buttons = page.locator('button').all()
        print(f"\nFound {len(buttons)} buttons:")
        for i, btn in enumerate(buttons[:10]):
            try:
                text = btn.text_content()
                visible = btn.is_visible()
                print(f"  {i}: '{text}' (visible: {visible})")
            except:
                print(f"  {i}: [error getting text]")

        # Find all links
        links = page.locator('a').all()
        print(f"\nFound {len(links)} links:")
        for i, link in enumerate(links[:10]):
            try:
                text = link.text_content()
                href = link.get_attribute('href')
                print(f"  {i}: '{text}' -> {href}")
            except:
                print(f"  {i}: [error getting link]")

        print("\nScreenshots and HTML saved to Tests/screenshots/bug-fixes/")
        browser.close()

if __name__ == "__main__":
    inspect_page()
