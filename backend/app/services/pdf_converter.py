"""
PDF converter helper script - runs Playwright with default event loop.
Usage: python pdf_converter.py <html_file> <output_pdf>
"""
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

def main():
    if len(sys.argv) != 3:
        print(f"Usage: {sys.argv[0]} <html_file> <output_pdf>", file=sys.stderr)
        sys.exit(1)

    html_file = Path(sys.argv[1]).resolve()
    output_pdf = Path(sys.argv[2]).resolve()

    with open(html_file, encoding='utf-8') as f:
        html_content = f.read()

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.set_content(html_content, wait_until='networkidle')
        page.wait_for_timeout(1000)
        page.pdf(
            path=output_pdf,
            format='A4',
            margin={
                'top': '20mm',
                'right': '15mm',
                'bottom': '20mm',
                'left': '15mm'
            },
            print_background=True,
            display_header_footer=True,
            header_template='<div style="font-size: 9px; margin-left: 15mm; width: 100%;"><span class="title"></span></div>',
            footer_template='<div style="font-size: 9px; margin-left: 15mm; width: 100%;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>'
        )
        browser.close()

if __name__ == "__main__":
    main()
